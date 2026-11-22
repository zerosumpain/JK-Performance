import Observation
import SwiftUI
import UIKit
import UserNotifications

/// A screen pushed inside a client tab (Today or JK). One enum so a tapped
/// notification can open the right one.
enum ClientRoute: Hashable {
    /// Your week, scrolled to this "YYYY-MM-DD" day (nil: today).
    case yourWeek(String?)
    /// A workout: detail, logger and the session-complete page.
    case session(String)
    case letter(String)
    case guides
    case guide(String)
    case challenges
}

/// Which tab is showing and what is pushed in it. A tapped notification moves
/// it (a message opens JK, a letter opens the letter, a booking Your week), so
/// the tab bars and stacks bind to this.
@Observable
@MainActor
final class TabRouter {
    static let shared = TabRouter()

    /// The three client tabs (atelier-spec.md, IA).
    enum Client: Hashable { case today, progress, jk }
    enum Coach: Hashable { case today, clients, messages }

    var client: Client = .today
    var coach: Coach = .today
    var todayPath: [ClientRoute] = []
    var jkPath: [ClientRoute] = []
    /// The Account sheet over Today (Account is no longer a tab).
    var showAccount = false
    /// Open the Account sheet at Membership.
    var showMembership = false
    /// Opens the composer quoting a letter ("Reply to JK").
    var replyQuote: ReplyQuote?
    /// Text to start the JK composer with ("Ask JK for a rest day").
    var composerDraft: String?

    struct ReplyQuote: Equatable {
        let reportId: String
        let headline: String
    }

    /// The old tab names, kept so existing payloads and links still land:
    /// home → today; plan and calendar → today, then Your week; messages → JK;
    /// account → today, then the Account sheet.
    func openLegacy(_ name: String) {
        switch name {
        case "home": client = .today
        case "plan", "calendar":
            client = .today
            todayPath = [.yourWeek(nil)]
        case "messages": client = .jk
        case "account":
            client = .today
            showAccount = true
        default: break
        }
    }

    func open(kind: String?, id: String? = nil) {
        switch kind {
        case "message":
            client = .jk
            coach = .messages
        case "report":
            client = .jk
            if let id { jkPath = [.letter(id)] }
        case "booking":
            client = .today
            todayPath = [.yourWeek(nil)]
            coach = .today
        case "checkin": coach = .today
        case "form":
            client = .today
            coach = .today
        case let other?: openLegacy(other)
        default: break
        }
    }

    /// Your week from Today, scrolled to a day.
    func openWeek(_ day: String?) {
        client = .today
        todayPath.append(.yourWeek(day))
    }
}

/// Push notifications from the server: a coach's reply, published feedback, a
/// check-in, a booking made or cancelled. They share the Notifications switch
/// with the phone's own reminders (`Reminders.enabled`): one switch, one ask.
///
/// The phone's APNs token goes to the server after every launch (Apple can
/// change it) and is taken off the server when notifications are switched
/// off or the person signs out.
@MainActor
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()

    private static let tokenKey = "jk.push.token"
    private(set) var token: String? {
        get { UserDefaults.standard.string(forKey: Self.tokenKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.tokenKey) }
    }

    func start() {
        UNUserNotificationCenter.current().delegate = self
    }

    /// Ask Apple for this phone's token, if the person has notifications on.
    /// The answer arrives in the app delegate, then `didRegister`.
    func registerIfAllowed() async {
        guard Reminders.shared.enabled else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(_ deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await upload() }
    }

    private struct TokenBody: Encodable {
        let token: String
        let env: String
    }

    private func upload() async {
        guard let token, APIClient.shared.token != nil, Reminders.shared.enabled else { return }
        // TestFlight and App Store builds are signed for production APNs.
        let _: OK? = try? await APIClient.shared.send("PUT", "/api/push/token",
                                                      body: TokenBody(token: token, env: "production"))
    }

    /// Notifications switched off: the server stops sending to this phone.
    func turnOff() async {
        guard let token, APIClient.shared.token != nil else { return }
        let _: OK? = try? await APIClient.shared.send("DELETE", "/api/push/token", query: ["token": token])
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Shown as a banner even with the app open; Messages refreshes itself.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let kind = info["kind"] as? String
        let id = info["id"] as? String
        await MainActor.run { TabRouter.shared.open(kind: kind, id: id) }
    }
}

/// The app delegate exists only for the push token callbacks.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Push.shared.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Push.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push registration failed: \(error.localizedDescription)")
    }
}
