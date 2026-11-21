import EventKit
import EventKitUI
import SwiftUI

/// A session to put in Apple Calendar.
struct CalendarEventDraft: Identifiable {
    let id = UUID()
    let title: String
    let start: Date
    let end: Date
    var location: String?
    var notes: String?
}

/// Apple's own "New Event" screen, filled in. From iOS 17 it runs outside the
/// app, so no calendar permission is needed: the person picks the calendar
/// and taps Add (or Cancel).
struct AddToCalendarSheet: UIViewControllerRepresentable {
    let draft: CalendarEventDraft
    let onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        event.startDate = draft.start
        event.endDate = draft.end
        event.location = draft.location
        event.notes = draft.notes
        event.addAlarm(EKAlarm(relativeOffset: -60 * 60))
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onDone()
        }
    }
}

extension View {
    /// Presents Apple's New Event screen while `draft` is set.
    func addToCalendarSheet(_ draft: Binding<CalendarEventDraft?>) -> some View {
        sheet(item: draft) { d in
            AddToCalendarSheet(draft: d) { draft.wrappedValue = nil }
                .ignoresSafeArea()
        }
    }
}

/// Subscribe Apple Calendar to a private feed of every session, which stays
/// up to date by itself. The feed link is shown once by the server, so this
/// phone remembers it; making a new one stops the old.
struct CalendarSubscribeCard: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var active: Bool?
    @State private var busy = false
    @State private var error: String?
    @State private var saved: String?

    private var key: String { "jk.calendar.webcal.\(session.me?.id ?? "")" }
    private var isCoach: Bool { session.me?.isCoach == true }

    var body: some View {
        if session.me?.demo != true {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    IconTile(systemName: "calendar.badge.plus")
                    VStack(alignment: .leading, spacing: 2) {
                        Text(active == true ? "In Apple Calendar" : "Add all to Apple Calendar")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text(isCoach ? "Every booking and class, kept up to date"
                                     : "Your sessions, classes and timed workouts, kept up to date")
                            .font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                }
                if let error { ErrorBanner(message: error) }
                if active == true {
                    HStack(spacing: 8) {
                        if let saved, let url = URL(string: saved) {
                            Button("Open again") { openURL(url) }.buttonStyle(GhostButtonStyle())
                        } else {
                            Button("New link") { Task { await subscribe() } }.buttonStyle(GhostButtonStyle())
                        }
                        Button("Stop") { Task { await stop() } }.buttonStyle(GhostButtonStyle())
                    }
                    .disabled(busy)
                } else {
                    Button {
                        Task { await subscribe() }
                    } label: {
                        if busy { ProgressView().tint(.black) } else { Text("Subscribe in Calendar") }
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(busy || active == nil)
                }
            }
            .jkCard()
            .task {
                saved = UserDefaults.standard.string(forKey: key)
                if let feed: CalendarFeed = try? await APIClient.shared.get("/api/calendar/feed") { active = feed.active }
            }
        }
    }

    private func subscribe() async {
        busy = true
        defer { busy = false }
        do {
            let feed: CalendarFeed = try await APIClient.shared.send("POST", "/api/calendar/feed")
            active = feed.active
            saved = feed.webcal
            UserDefaults.standard.set(feed.webcal, forKey: key)
            error = nil
            if let link = feed.webcal, let url = URL(string: link) { openURL(url) }
        } catch {
            self.error = error.readable
        }
    }

    private func stop() async {
        busy = true
        defer { busy = false }
        do {
            let feed: CalendarFeed = try await APIClient.shared.send("DELETE", "/api/calendar/feed")
            active = feed.active
            saved = nil
            UserDefaults.standard.removeObject(forKey: key)
            error = nil
        } catch {
            self.error = error.readable
        }
    }
}
