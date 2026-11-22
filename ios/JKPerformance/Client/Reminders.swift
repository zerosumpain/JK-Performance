import Foundation
import Observation
import UserNotifications

/// Reminders scheduled on the phone itself: one evening reminder at the time
/// the client chose (atelier-spec.md: notifications are on/off plus one
/// time), the weekly check-in on Friday (plans with 'checkin'), and an hour
/// before each session or timed workout in the next fortnight. Rescheduled
/// whenever Today loads. `enabled` is also the switch for push notifications
/// from the server (see `Push`). Never countdown copy.
@Observable
@MainActor
final class Reminders {
    static let shared = Reminders()

    private static let key = "jk.reminders.on"
    private static let sessionPrefix = "jk.session."
    private static let checkInId = "jk.checkin"
    private static let eveningId = "jk.evening"
    private static let eveningKey = "jk.reminders.evening"

    private(set) var enabled: Bool
    /// "HH:MM", or nil for no evening reminder.
    private(set) var eveningTime: String? = UserDefaults.standard.string(forKey: "jk.reminders.evening")
    /// Whether this client's plan has the weekly check-in.
    @ObservationIgnored private var checkInOn = true
    @ObservationIgnored private let center = UNUserNotificationCenter.current()

    init() { enabled = UserDefaults.standard.bool(forKey: Self.key) }

    /// Asks iOS once; returns whether reminders are now on.
    /// Also turns on push from the server (messages, feedback, bookings).
    @discardableResult
    func enable(checkIn: Bool = true) async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        set(granted)
        if granted {
            if checkIn { scheduleCheckIn() }
            await Push.shared.registerIfAllowed()
        }
        return granted
    }

    /// Ask in context (after a first message) if they've never been asked.
    func offerIfUndecided(checkIn: Bool) async {
        guard !enabled, await center.notificationSettings().authorizationStatus == .notDetermined else { return }
        await enable(checkIn: checkIn)
    }

    func disable() {
        set(false)
        clearPending()
        Task { await Push.shared.turnOff() }
    }

    func clearPending() {
        center.removeAllPendingNotificationRequests()
    }

    private func set(_ value: Bool) {
        enabled = value
        UserDefaults.standard.set(value, forKey: Self.key)
    }

    func setEveningTime(_ time: String?) {
        eveningTime = time
        UserDefaults.standard.set(time, forKey: Self.eveningKey)
    }

    /// Today's refresh: the server's preferences win, then everything is rescheduled.
    func refresh(gate: Gate, preferences: Preferences?) async {
        if let prefs = preferences, prefs.notificationsOn != nil || prefs.eveningReminderTime != nil {
            setEveningTime(prefs.eveningReminderTime)
        }
        checkInOn = gate.checkin
        guard enabled else { return }
        scheduleEvening()
        if !checkInOn { center.removePendingNotificationRequests(withIdentifiers: [Self.checkInId]) }
        let from = Day.today, to = Day.string(Day.add(14, to: Date()))
        let bookings: BookingsResponse? = try? await APIClient.shared.get("/api/bookings", query: ["from": from, "to": to])
        let workouts: WorkoutsResponse? = try? await APIClient.shared.get("/api/workouts", query: ["from": from, "to": to])
        await schedule(bookings: bookings?.bookings ?? [], workouts: workouts?.workouts ?? [])
    }

    private func scheduleEvening() {
        center.removePendingNotificationRequests(withIdentifiers: [Self.eveningId])
        guard let time = eveningTime, let at = Day.at(Date(), time: time) else { return }
        let content = UNMutableNotificationContent()
        content.title = "Today's habits"
        content.body = "A quiet minute to tick off what you did today."
        content.sound = .default
        var when = DateComponents()
        when.hour = Day.calendar.component(.hour, from: at)
        when.minute = Day.calendar.component(.minute, from: at)
        center.add(UNNotificationRequest(identifier: Self.eveningId, content: content,
                                         trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
    }

    private func scheduleCheckIn() {
        guard checkInOn else { return }
        let content = UNMutableNotificationContent()
        content.title = "Your weekly check-in"
        content.body = "A minute on your week. JK reads it before he writes your letter."
        content.sound = .default
        var when = DateComponents()
        when.weekday = 6 // Friday, at the evening time if one is set
        let at = eveningTime.flatMap { Day.at(Date(), time: $0) }
        when.hour = at.map { Day.calendar.component(.hour, from: $0) } ?? 18
        when.minute = at.map { Day.calendar.component(.minute, from: $0) } ?? 0
        center.add(UNNotificationRequest(identifier: Self.checkInId, content: content,
                                         trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
    }

    /// Replace the session reminders with ones for these bookings and workouts.
    func schedule(bookings: [Booking], workouts: [WorkoutSummary]) async {
        guard enabled else { return }
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.sessionPrefix) })
        if !pending.contains(where: { $0.identifier == Self.checkInId }) { scheduleCheckIn() }

        let horizon = Day.add(14, to: Date())
        var items: [(id: String, title: String, detail: String, start: Date)] = []
        for b in bookings where b.isMine {
            items.append((b.id, b.title ?? b.kindLabel, [b.location].compactMap { $0 }.joined(), b.start))
        }
        for w in workouts where w.completedAt == nil && w.published {
            guard let time = w.startsAt, let day = Day.date(w.date), let start = Day.at(day, time: time) else { continue }
            items.append((w.id, w.title, w.location ?? "", start))
        }
        for item in items.sorted(by: { $0.start < $1.start }).prefix(40) {
            let fire = item.start.addingTimeInterval(-3600)
            guard fire > Date(), item.start < horizon else { continue }
            let content = UNMutableNotificationContent()
            content.title = "\(item.title) at \(Fmt.time(item.start))"
            content.body = item.detail.isEmpty ? "Starts in an hour." : "Starts in an hour · \(item.detail)"
            content.sound = .default
            let parts = Day.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            try? await center.add(UNNotificationRequest(identifier: Self.sessionPrefix + item.id, content: content,
                                                        trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
        }
    }
}
