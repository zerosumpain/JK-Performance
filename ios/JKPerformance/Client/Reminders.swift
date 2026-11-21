import Foundation
import Observation
import UserNotifications

/// Reminders scheduled on the phone itself (no server, no push): the weekly
/// check-in on Friday evening, and an hour before each session or timed
/// workout in the next fortnight. Rescheduled whenever Home loads.
@Observable
@MainActor
final class Reminders {
    static let shared = Reminders()

    private static let key = "jk.reminders.on"
    private static let sessionPrefix = "jk.session."
    private static let checkInId = "jk.checkin"

    private(set) var enabled: Bool
    @ObservationIgnored private let center = UNUserNotificationCenter.current()

    init() { enabled = UserDefaults.standard.bool(forKey: Self.key) }

    /// Asks iOS once; returns whether reminders are now on.
    @discardableResult
    func enable() async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        set(granted)
        if granted { scheduleCheckIn() }
        return granted
    }

    func disable() {
        set(false)
        clearPending()
    }

    func clearPending() {
        center.removeAllPendingNotificationRequests()
    }

    private func set(_ value: Bool) {
        enabled = value
        UserDefaults.standard.set(value, forKey: Self.key)
    }

    private func scheduleCheckIn() {
        let content = UNMutableNotificationContent()
        content.title = "Weekly check-in"
        content.body = "Two minutes: how did your week go? Your coach reads it before planning the next one."
        content.sound = .default
        var when = DateComponents()
        when.weekday = 6 // Friday
        when.hour = 18
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
