import Observation
import SwiftUI
import UIKit
import UserNotifications

/// Which tab is showing. A tapped notification moves it (a message opens
/// Messages, a booking the calendar), so the tab bars bind to this.
@Observable
@MainActor
final class TabRouter {
    static let shared = TabRouter()

    enum Client: Hashable { case home, plan, calendar, messages, account }
    enum Coach: Hashable { case today, clients, schedule, messages, guides }

    var client: Client = .home
    var coach: Coach = .today

    func open(kind: String?) {
        switch kind {
        case "message": client = .messages; coach = .messages
        case "report": client = .home
        case "booking": client = .calendar; coach = .schedule
        case "checkin": coach = .today
        default: break
        }
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
        let kind = response.notification.request.content.userInfo["kind"] as? String
        await MainActor.run { TabRouter.shared.open(kind: kind) }
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
