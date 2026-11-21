import Foundation
import Network
import Observation

/// Writes that couldn't reach the server, kept on disk until they can.
/// Gyms are often basements: a set logged with no signal must never be lost.
///
/// Only idempotent writes go in (a set's PUT/DELETE, completing a workout),
/// so a newer write to the same method and path replaces the older one and
/// re-sending is harmless. Sent in order on foreground, when the network
/// comes back, and after any request that succeeds. Kept per person: a
/// different account signing in on this phone drops them.
@Observable
@MainActor
final class Outbox {
    static let shared = Outbox()

    struct Write: Codable, Equatable {
        var method: String
        var path: String
        var body: Data?
        var createdAt: Date
    }

    private struct Stored: Codable {
        var userId: String?
        var writes: [Write]
    }

    private(set) var writes: [Write] = []
    /// Set when the server refused a queued write (a 4xx), so it was dropped.
    var lastError: String?
    private(set) var flushing = false

    @ObservationIgnored private var userId: String?
    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private let file: URL = {
        let dir = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return dir.appendingPathComponent("outbox.json")
    }()

    init() {
        if let data = try? Data(contentsOf: file), let stored = try? JSONDecoder().decode(Stored.self, from: data) {
            userId = stored.userId
            writes = stored.writes
        }
        monitor.pathUpdateHandler = { path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await Outbox.shared.flush() }
        }
        monitor.start(queue: DispatchQueue(label: "jk.outbox.network"))
    }

    var pendingCount: Int { writes.count }
    var pendingSets: Int { writes.filter { $0.path.contains("/sets/") }.count }

    func isPending(_ method: String, _ path: String) -> Bool {
        writes.contains { $0.method == method && $0.path == path }
    }

    func hasPending(workoutId: String) -> Bool {
        writes.contains { $0.path.hasPrefix("/api/workouts/\(seg(workoutId))/") }
    }

    /// True for the failures worth queueing: no signal, a dropped or slow
    /// connection, the server unreachable. Not for anything the server said.
    static func isOffline(_ error: Error) -> Bool {
        guard let url = error as? URLError else { return false }
        switch url.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
             .secureConnectionFailed, .callIsActive:
            return true
        default:
            return false
        }
    }

    func enqueue(_ method: String, _ path: String, body: (some Encodable)?) {
        let data = body.flatMap { try? APIClient.encoder.encode($0) }
        // Move a replaced write to the end, so PUT, DELETE, PUT on one set ends logged.
        writes.removeAll { $0.method == method && $0.path == path }
        writes.append(Write(method: method, path: path, body: data, createdAt: Date()))
        save()
    }

    func enqueue(_ method: String, _ path: String) {
        enqueue(method, path, body: Optional<Data>.none)
    }

    /// Called after any request succeeds: the network is evidently back.
    func kick() {
        guard !writes.isEmpty, !flushing else { return }
        Task { await flush() }
    }

    /// Send everything queued, oldest first. Stops at the first network or
    /// server-side failure and keeps the rest; drops a write the server
    /// refuses outright, since retrying it can never succeed.
    func flush() async {
        guard !flushing, !writes.isEmpty, APIClient.shared.token != nil else { return }
        flushing = true
        defer { flushing = false }
        while let next = writes.first {
            do {
                try await APIClient.shared.replay(next.method, next.path, body: next.body)
                writes.removeAll { $0 == next }
                save()
            } catch let APIError.server(status, message) where status < 500 && status != 408 && status != 429 {
                writes.removeAll { $0 == next }
                lastError = "A change made offline couldn't be saved: \(message)"
                save()
            } catch {
                break // offline, 5xx, rate-limited or signed out: try again later
            }
        }
    }

    /// A person is signed in. Writes left by someone else on this phone go.
    func adopt(userId id: String) {
        if userId != id {
            if userId != nil { writes = [] }
            userId = id
            save()
        }
    }

    private func save() {
        let stored = Stored(userId: userId, writes: writes)
        if let data = try? JSONEncoder().encode(stored) {
            try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }
}
