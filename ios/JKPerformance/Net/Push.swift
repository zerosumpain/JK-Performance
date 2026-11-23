import Observation
import SwiftUI
import UIKit
import UserNotifications

/// A screen pushed inside a client tab or the JK sheet. One enum so a
/// tapped notification can open the right one.
enum ClientRoute: Hashable {
    /// Your week, scrolled to this "YYYY-MM-DD" day (nil: today).
    case yourWeek(String?)
    /// A workout: detail, logger and the session-complete page.
    case session(String)
    case letter(String)
    case letters
    case guides
    case guide(String)
    case challenges
    case progress
    /// Act › Today's work.
    case todaysWork
    /// Plan › Before the session.
    case prepare
    /// Review › Accountability session.
    case accountability
}

/// Which tab is showing, what is pushed in it, and the JK sheet (docs/design/
/// plan-act-review.md, "Navigation"). A tapped notification moves it, so the
/// tab bar, the stacks and the sheet bind to this.
@Observable
@MainActor
final class TabRouter {
    static let shared = TabRouter()

    /// The three client tabs: Plan · Act · Review (default Act).
    enum Client: Hashable { case plan, act, review }
    enum Coach: Hashable { case today, clients, messages }

    var client: Client = .act
    var coach: Coach = .today
    var planPath: [ClientRoute] = []
    var actPath: [ClientRoute] = []
    var reviewPath: [ClientRoute] = []
    /// The JK sheet: the thread with JK and the More list.
    var showJK = false
    var jkPath: [ClientRoute] = []
    /// The Account sheet, over the JK sheet.
    var showAccount = false
    /// Open the Account sheet at Membership.
    var showMembership = false
    /// Opens the composer quoting a letter ("Reply to JK").
    var replyQuote: ReplyQuote?
    /// Text to start the JK composer with ("Ask JK for a rest day").
    var composerDraft: String?
    /// A letter to show on Review: the Accountability session if it is the latest, else the letter.
    var reviewLetter: String?
    /// Review should open on the Accountability session when one is waiting.
    var reviewWantsSession = false
    /// Unread from JK (GET /api/week): the silver dot on his avatar.
    var unread = 0

    struct ReplyQuote: Equatable {
        let reportId: String
        let headline: String
    }

    /// Push on whatever is in front: the JK sheet's stack, else the current tab's.
    func push(_ route: ClientRoute) {
        if showJK {
            jkPath.append(route)
            return
        }
        switch client {
        case .plan: planPath.append(route)
        case .act: actPath.append(route)
        case .review: reviewPath.append(route)
        }
    }

    /// Opens the JK sheet. `after` lets a closing sheet get out of the way first.
    func openJK(path: [ClientRoute] = [], after delay: Double = 0) {
        Task { @MainActor in
            if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
            jkPath = path
            unread = 0
            showJK = true
        }
    }

    /// JK sheet › Account (at Membership when asked). The Account sheet sits
    /// over the JK sheet, so the JK sheet opens first.
    func openAccount(membership: Bool = false) {
        showMembership = membership
        let wasOpen = showJK
        showJK = true
        Task { @MainActor in
            if !wasOpen { try? await Task.sleep(for: .seconds(0.5)) }
            showAccount = true
        }
    }

    private func closeSheets() {
        showAccount = false
        showJK = false
    }

    /// Link and payload names, old and new: today, home and plan (old) →
    /// Act; messages and jk → the JK sheet; account → JK sheet › Account;
    /// checkin and review → Review; calendar → JK sheet › Your week.
    func openLegacy(_ name: String) {
        switch name {
        case "today", "home", "plan", "act":
            closeSheets()
            client = .act
        case "direction", "prepare":
            closeSheets()
            client = .plan
        case "calendar", "week":
            openJK(path: [.yourWeek(nil)])
        case "messages", "jk":
            openJK()
        case "account":
            openAccount()
        case "checkin", "review":
            closeSheets()
            client = .review
        default: break
        }
    }

    func open(kind: String?, id: String? = nil) {
        switch kind {
        case "message":
            coach = .messages
            openJK()
        case "report", "letter":
            closeSheets()
            client = .review
            reviewLetter = id
            reviewWantsSession = true
        case "booking":
            coach = .today
            openJK(path: [.yourWeek(nil)])
        case "checkin":
            coach = .today
            closeSheets()
            client = .review
        case "form":
            coach = .today
            openJK()
        case let other?: openLegacy(other)
        default: break
        }
    }

    /// Your week, scrolled to a day (in the JK sheet, where Your week lives).
    func openWeek(_ day: String?) {
        if showJK {
            jkPath.append(.yourWeek(day))
        } else {
            openJK(path: [.yourWeek(day)])
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
