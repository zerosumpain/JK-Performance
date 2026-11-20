import Foundation
import Observation

/// Who is signed in. RootView switches on `phase`; the role comes from the
/// server (`me.role`), never from the app.
@Observable
@MainActor
final class AppSession {
    enum Phase: Equatable {
        /// A token exists and /api/me is in flight (or failed without a 401).
        case restoring
        case signedOut
        case signedIn
    }

    private(set) var phase: Phase
    private(set) var me: Me?
    /// Set when restoring fails for a reason other than a 401 (offline).
    var restoreError: String?

    @ObservationIgnored let api = APIClient.shared

    init() {
        phase = APIClient.shared.token == nil ? .signedOut : .restoring
        api.onUnauthorized = { [weak self] in self?.clear() }
    }

    var isCoach: Bool { me?.isCoach == true }

    /// On launch: confirm the saved token by reading /api/me.
    func restore() async {
        guard api.token != nil else {
            phase = .signedOut
            return
        }
        restoreError = nil
        do {
            let fresh: Me = try await api.get("/api/me")
            me = fresh
            phase = .signedIn
        } catch APIError.unauthorized {
            clear()
        } catch {
            if !error.isCancellation { restoreError = error.readable }
        }
    }

    func refreshMe() async {
        guard phase == .signedIn else { return }
        if let fresh: Me = try? await api.get("/api/me") { me = fresh }
    }

    func update(_ fresh: Me) { me = fresh }

    struct AppleBody: Encodable {
        struct Name: Encodable {
            var givenName: String?
            var familyName: String?
        }
        var identityToken: String
        var fullName: Name?
    }

    func signInWithApple(identityToken: String, givenName: String?, familyName: String?) async throws {
        let name: AppleBody.Name? = (givenName == nil && familyName == nil)
            ? nil : AppleBody.Name(givenName: givenName, familyName: familyName)
        let session: Session = try await api.send("POST", "/api/auth/apple",
                                                  body: AppleBody(identityToken: identityToken, fullName: name))
        adopt(session)
    }

    func signInWithCode(_ code: String) async throws {
        let session: Session = try await api.send("POST", "/api/auth/code", body: ["code": code])
        adopt(session)
    }

    private func adopt(_ session: Session) {
        api.setToken(session.token)
        me = session.me
        restoreError = nil
        phase = .signedIn
        if !session.me.isCoach { HealthSync.shared.syncIfDue(force: true) }
    }

    func signOut() async {
        let _: OK? = try? await api.send("POST", "/api/auth/logout")
        clear()
    }

    /// DELETE /api/me erases the account; then the app is signed out.
    func deleteAccount() async throws {
        let _: OK = try await api.send("DELETE", "/api/me")
        clear()
    }

    func clear() {
        api.setToken(nil)
        me = nil
        restoreError = nil
        phase = .signedOut
    }
}
