import Foundation
import HealthKit
import Observation

/// Reads the last 30 days from Apple Health and POSTs daily totals to
/// /api/health/samples. WHOOP, Oura, Garmin and MyFitnessPal reach the app
/// through Apple Health, so this is the only device integration.
///
/// Sample ids are "<kind>-<YYYY-MM-DD>", so re-sending a day replaces it
/// server-side (the endpoint is idempotent on id). Runs on foreground at most
/// once per 15 minutes, and only after the person opts in.
@Observable
@MainActor
final class HealthSync {
    static let shared = HealthSync()

    private static let optInKey = "jk.health.optIn"
    private static let lastSyncKey = "jk.health.lastSync"
    private static let throttle: TimeInterval = 15 * 60
    private static let days = 30

    private(set) var optedIn: Bool
    private(set) var lastSync: Date?
    private(set) var syncing = false
    private(set) var lastError: String?
    private(set) var lastStored: Int?

    @ObservationIgnored private let store = HKHealthStore()

    init() {
        optedIn = UserDefaults.standard.bool(forKey: Self.optInKey)
        lastSync = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
    }

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.stepCount),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.bodyMass),
            HKQuantityType(.distanceWalkingRunning),
            HKCategoryType(.sleepAnalysis),
        ]
    }

    /// The Health & devices toggle turning on: ask iOS, remember the opt-in, sync.
    func enable() async {
        guard available else {
            lastError = "Apple Health isn't available on this device."
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            setOptIn(true)
            await sync()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Stops sending. iOS keeps the read permission until it's changed in
    /// Settings › Health › Data Access.
    func disable() {
        setOptIn(false)
    }

    private func setOptIn(_ value: Bool) {
        optedIn = value
        UserDefaults.standard.set(value, forKey: Self.optInKey)
    }

    /// Foreground hook: sync when opted in and the last run is over 15 min old.
    func syncIfDue(force: Bool = false) {
        guard optedIn, available, !syncing, APIClient.shared.token != nil else { return }
        if !force, let lastSync, Date().timeIntervalSince(lastSync) < Self.throttle { return }
        Task { await sync() }
    }

    func sync() async {
        guard optedIn, available, !syncing else { return }
        syncing = true
        defer { syncing = false }
        do {
            let samples = try await collect()
            var stored = 0
            for start in stride(from: 0, to: samples.count, by: 200) {
                let chunk = Array(samples[start..<min(start + 200, samples.count)])
                let reply: StoredResponse = try await APIClient.shared.send(
                    "POST", "/api/health/samples", body: HealthSamplesInput(samples: chunk))
                stored += reply.stored
            }
            lastStored = stored
            lastError = nil
            lastSync = Date()
            UserDefaults.standard.set(lastSync, forKey: Self.lastSyncKey)
        } catch {
            if !error.isCancellation { lastError = error.readable }
        }
    }

    // MARK: Reading

    private func collect() async throws -> [HealthSample] {
        let end = Date()
        let start = Day.add(-(Self.days - 1), to: Day.start(end))
        var out: [HealthSample] = []
        out += try await daily(.stepCount, kind: "steps", unit: .count(), option: .cumulativeSum, from: start, to: end)
        out += try await daily(.activeEnergyBurned, kind: "activeKcal", unit: .kilocalorie(), option: .cumulativeSum,
                               from: start, to: end)
        out += try await daily(.distanceWalkingRunning, kind: "distance", unit: .meterUnit(with: .kilo),
                               option: .cumulativeSum, from: start, to: end)
        out += try await daily(.restingHeartRate, kind: "restingHr", unit: HKUnit.count().unitDivided(by: .minute()),
                               option: .discreteAverage, from: start, to: end)
        out += try await daily(.bodyMass, kind: "weight", unit: .gramUnit(with: .kilo), option: .mostRecent,
                               from: start, to: end)
        out += try await sleep(from: Day.add(-1, to: start), to: end, keepFrom: start)
        return out
    }

    private func daily(_ id: HKQuantityTypeIdentifier, kind: String, unit: HKUnit, option: HKStatisticsOptions,
                       from start: Date, to end: Date) async throws -> [HealthSample] {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
            options: option,
            anchorDate: start,
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await descriptor.result(for: store)
        var samples: [HealthSample] = []
        collection.enumerateStatistics(from: start, to: end) { stats, _ in
            let quantity: HKQuantity?
            if option.contains(.cumulativeSum) {
                quantity = stats.sumQuantity()
            } else if option.contains(.mostRecent) {
                quantity = stats.mostRecentQuantity()
            } else {
                quantity = stats.averageQuantity()
            }
            guard let quantity else { return }
            let value = quantity.doubleValue(for: unit)
            samples.append(HealthSample(id: "\(kind)-\(Day.string(stats.startDate))", kind: kind,
                                        start: stats.startDate, end: stats.endDate,
                                        value: (value * 100).rounded() / 100))
        }
        return samples
    }

    /// Minutes asleep per night, credited to the day the night ends. Sources
    /// overlap (Watch and Oura both write), so intervals are merged first.
    private func sleep(from start: Date, to end: Date, keepFrom: Date) async throws -> [HealthSample] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let all = try await descriptor.result(for: store)
        let asleep = all.filter { sample in
            guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
            return HKCategoryValueSleepAnalysis.allAsleepValues.contains(value)
        }
        var byDay: [String: [(Date, Date)]] = [:]
        for s in asleep where s.endDate >= keepFrom {
            byDay[Day.string(s.endDate), default: []].append((s.startDate, s.endDate))
        }
        return byDay.compactMap { day, intervals in
            let sorted = intervals.sorted { $0.0 < $1.0 }
            var merged: [(Date, Date)] = []
            for interval in sorted {
                if let last = merged.last, interval.0 <= last.1 {
                    merged[merged.count - 1].1 = max(last.1, interval.1)
                } else {
                    merged.append(interval)
                }
            }
            let minutes = merged.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) / 60 }
            guard minutes > 0, let first = merged.first, let last = merged.last else { return nil }
            return HealthSample(id: "sleep-\(day)", kind: "sleep", start: first.0, end: last.1, value: minutes.rounded())
        }
    }
}
