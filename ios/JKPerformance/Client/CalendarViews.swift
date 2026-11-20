import SwiftUI

// MARK: - My calendar (Calendar tab root)

/// Month grid with dots from bookings and workouts, then the chosen day's list.
struct MyCalendarView: View {
    var embedded = false
    @State private var selected: Date
    @State private var bookings: [Booking]?
    @State private var workouts: [WorkoutSummary]?
    @State private var loadedMonth = ""
    @State private var error: String?
    @State private var actionError: String?

    private let weekdays = ["M", "T", "W", "T", "F", "S", "S"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
    private var api: APIClient { APIClient.shared }

    init(initialDay: Date = Date(), embedded: Bool = false) {
        self.embedded = embedded
        _selected = State(initialValue: Day.start(initialDay))
    }

    private var month: Date { Day.monthStart(selected) }
    private var monthDays: [Date] {
        let count = Day.calendar.range(of: .day, in: .month, for: month)?.count ?? 30
        return (0..<count).map { Day.add($0, to: month) }
    }
    private var leadingBlanks: Int { Day.isoWeekday(month) - 1 }

    private var markedDays: Set<String> {
        Set((bookings ?? []).filter(\.isMine).map { Day.string($0.start) } + (workouts ?? []).map(\.date))
    }

    var body: some View {
        if embedded {
            content
        } else {
            NavigationStack { content.toolbar(.hidden, for: .navigationBar) }
        }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(eyebrow: "My calendar", title: Fmt.month(month)) {
                    HStack(spacing: 14) {
                        Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }
                        Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }
                    }
                    .foregroundStyle(JK.secondary)
                }

                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(Array(weekdays.enumerated()), id: \.offset) { _, d in
                        Text(d).font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 30) }
                    ForEach(monthDays, id: \.self) { day in
                        let on = Day.same(day, selected)
                        let past = day < Day.start(Date())
                        Button {
                            selected = day
                        } label: {
                            VStack(spacing: 2) {
                                Text("\(Day.calendar.component(.day, from: day))")
                                    .font(.subheadline.weight(on ? .bold : .regular))
                                    .foregroundStyle(on ? Color.black : (past ? JK.tertiary : JK.text))
                                    .frame(width: 30, height: 30)
                                    .background(on ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(Color.clear), in: Circle())
                                Circle()
                                    .fill(markedDays.contains(Day.string(day)) ? JK.secondary : .clear)
                                    .frame(width: 4, height: 4)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                let events = dayEvents
                Eyebrow(text: Fmt.longDay(selected), trailing: events.count == 1 ? "1 event" : "\(events.count) events")
                if let error, bookings == nil && workouts == nil {
                    ErrorCard(message: error) { await load(force: true) }
                } else if bookings == nil && workouts == nil {
                    LoadingCard()
                } else {
                    if let error { ErrorBanner(message: error) }
                    if events.isEmpty {
                        Text("Nothing on this day.").font(.caption).foregroundStyle(JK.tertiary)
                    }
                    ForEach(events) { event in
                        HStack(alignment: .top, spacing: 12) {
                            Text(event.time).font(.caption2).foregroundStyle(JK.tertiary).frame(width: 36, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(event.title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                    Spacer()
                                    Text(event.tag)
                                        .font(.system(size: 9, weight: .semibold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(JK.cardRaised, in: Capsule())
                                        .foregroundStyle(JK.secondary)
                                }
                                Text(event.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            .jkCard(padding: 12)
                            .contextMenu {
                                if let booking = event.booking {
                                    if booking.isGroup {
                                        if booking.joined == true {
                                            Button(role: .destructive) { Task { await joinOrLeave(booking, join: false) } } label: {
                                                Label("Leave class", systemImage: "xmark")
                                            }
                                        } else {
                                            Button { Task { await joinOrLeave(booking, join: true) } } label: {
                                                Label("Join class", systemImage: "plus")
                                            }
                                        }
                                    } else if booking.cancellable == true {
                                        Button(role: .destructive) { Task { await cancel(booking) } } label: {
                                            Label("Cancel booking", systemImage: "xmark")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                NavigationLink { BookSessionView(initialDay: max(selected, Day.start(Date()))) } label: {
                    Label("Request a session", systemImage: "plus")
                        .font(.subheadline)
                        .foregroundStyle(JK.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [4])))
                }
                Text("Press and hold a session to cancel it, or a class to join or leave. Cancelling 24 h or more ahead refunds the credit.")
                    .font(.caption2).foregroundStyle(JK.tertiary)
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load(force: true) }
        .task(id: Day.string(month)) { await load(force: false) }
        .errorAlert($actionError)
    }

    private struct DayEvent: Identifiable {
        let id: String
        let sort: String
        let time: String
        let title: String
        let detail: String
        let tag: String
        var booking: Booking?
    }

    private var dayEvents: [DayEvent] {
        let key = Day.string(selected)
        let fromBookings = (bookings ?? []).filter { Day.string($0.start) == key }.map { b in
            DayEvent(id: "b" + b.id, sort: Fmt.time(b.start), time: Fmt.time(b.start), title: b.title ?? b.kindLabel,
                     detail: ([b.kindLabel, b.location] + [Self.spaces(b)]).compactMap { $0 }.joined(separator: " · "),
                     tag: b.isGroup ? (b.joined == true ? "Joined" : "Class") : "Session", booking: b)
        }
        let fromWorkouts = (workouts ?? []).filter { $0.date == key }.map { w in
            DayEvent(id: "w" + w.id, sort: w.startsAt ?? "99", time: w.startsAt ?? "–", title: w.title,
                     detail: w.completedAt != nil ? "Completed" : "\(w.itemCount) exercises",
                     tag: "Plan")
        }
        return (fromBookings + fromWorkouts).sorted { $0.sort < $1.sort }
    }

    private static func spaces(_ b: Booking) -> String? {
        guard b.isGroup, let cap = b.capacity else { return nil }
        return "\(b.attendeeCount ?? b.attendees?.count ?? 0)/\(cap) going"
    }

    private func shiftMonth(_ by: Int) {
        if let next = Day.calendar.date(byAdding: .month, value: by, to: month) { selected = next }
    }

    private func load(force: Bool) async {
        let key = Day.string(month)
        if !force, key == loadedMonth { return }
        let from = key, to = Day.string(monthDays.last ?? month)
        async let b: BookingsResponse = api.get("/api/bookings", query: ["from": from, "to": to])
        async let w: WorkoutsResponse = api.get("/api/workouts", query: ["from": from, "to": to])
        var failure: String?
        do { bookings = try await b.bookings } catch { if !error.isCancellation { failure = error.readable } }
        do { workouts = try await w.workouts } catch { if !error.isCancellation { failure = failure ?? error.readable } }
        error = failure
        if failure == nil { loadedMonth = key }
    }

    private func joinOrLeave(_ booking: Booking, join: Bool) async {
        do {
            let fresh: Booking = try await api.send("POST", "/api/classes/\(seg(booking.id))/\(join ? "join" : "leave")")
            bookings = bookings?.map { $0.id == fresh.id ? fresh : $0 }
        } catch {
            actionError = error.readable
        }
    }

    private func cancel(_ booking: Booking) async {
        do {
            let reply: OK = try await api.send("DELETE", "/api/bookings/\(seg(booking.id))")
            bookings?.removeAll { $0.id == booking.id }
            if reply.refunded != true, booking.usesCredit == true {
                actionError = "Cancelled. It was within 24 hours, so the credit wasn't refunded."
            }
        } catch {
            actionError = error.readable
        }
    }
}

// MARK: - Book a session

/// Open slots from /api/slots, booked with POST /api/bookings. A coach passes
/// `client` to book on that client's behalf.
struct BookSessionView: View {
    enum Kind: String, CaseIterable {
        case inperson, video
        var label: String { self == .inperson ? "1:1 · in person" : "Video call" }
    }

    var client: PersonRef? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session
    @State private var day: Date
    @State private var kind: Kind = .inperson
    @State private var slots: [Slot]?
    @State private var chosen: Slot?
    @State private var error: String?
    @State private var booking = false
    @State private var bookError: String?

    init(client: PersonRef? = nil, initialDay: Date = Date()) {
        self.client = client
        _day = State(initialValue: Day.start(initialDay))
    }

    private var membership: Membership? { session.me?.membership }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let client {
                    HStack(spacing: 10) {
                        Avatar(initials: client.displayInitials, size: 34)
                        Text("Booking for \(client.name)").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    }
                    .jkCard()
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Eyebrow(text: "Session credits")
                        (Text("\(membership?.creditsLeft ?? 0)").font(.largeTitle.weight(.semibold))
                            + Text(" of \(membership?.creditsTotal ?? 0) left").font(.caption).foregroundColor(JK.secondary))
                            .foregroundStyle(JK.text)
                        Text(creditLine).font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    .jkCard()
                }

                HStack {
                    Button { day = max(Day.start(Date()), Day.add(-7, to: day)) } label: { Image(systemName: "chevron.left") }
                    Spacer()
                    Text("Week of \(Fmt.dayMonth(Day.weekStart(day)))").font(.caption).foregroundStyle(JK.secondary)
                    Spacer()
                    Button { day = Day.add(7, to: day) } label: { Image(systemName: "chevron.right") }
                }
                .foregroundStyle(JK.secondary)
                DayStrip(days: Day.week(of: day), selected: $day)
                Segmented(options: Kind.allCases, selection: $kind) { $0.label }

                if let error {
                    ErrorCard(message: error) { await loadSlots() }
                } else if let slots {
                    let upcoming = slots.filter { $0.start > Date() }
                    if upcoming.isEmpty {
                        EmptyCard(systemName: "clock", title: "No times this day", detail: "Try another day or session type.")
                    } else {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                            ForEach(upcoming) { slot in
                                let on = chosen?.start == slot.start
                                Button {
                                    chosen = slot
                                } label: {
                                    Text(Fmt.time(slot.start))
                                        .font(.subheadline.weight(.semibold))
                                        .strikethrough(!slot.open)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 12)
                                        .foregroundStyle(on ? Color.black : (slot.open ? JK.text : JK.tertiary))
                                        .background(on ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.card),
                                                    in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: slot.open ? [] : [3])))
                                }
                                .buttonStyle(.plain)
                                .disabled(!slot.open)
                            }
                        }
                    }
                } else {
                    LoadingCard(text: "Finding times…")
                }

                VStack(spacing: 10) {
                    HStack {
                        Text(chosen.map { "\(Fmt.shortDay($0.start)) · \(Fmt.time($0.start))–\(Fmt.time($0.end))" } ?? "Pick a time")
                            .font(.caption)
                        Spacer()
                        Text(chosen?.location ?? kind.label).font(.caption)
                    }
                    Divider().overlay(JK.stroke)
                    HStack {
                        Text("Uses 1 credit").font(.caption).foregroundStyle(JK.tertiary)
                        Spacer()
                        Text(kind.label).font(.caption).foregroundStyle(JK.tertiary)
                    }
                }
                .foregroundStyle(JK.text)
                .jkCard()

                if let bookError { ErrorBanner(message: bookError) }
                Button {
                    Task { await book() }
                } label: {
                    if booking { ProgressView().tint(.black) } else { Text("Confirm booking") }
                }
                .buttonStyle(ChromeButtonStyle())
                .disabled(chosen == nil || booking)
                Text("Free cancellation up to 24h before")
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle(client == nil ? "Book a session" : "Book a client")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(Day.string(day))|\(kind.rawValue)") { await loadSlots() }
    }

    private var creditLine: String {
        guard let m = membership, m.isActive else { return "No membership · choose a plan under Account" }
        let reset = m.creditsResetOn.map { " · resets \(Fmt.dayMonth($0))" } ?? ""
        return "\(m.displayName) plan\(reset)"
    }

    private func loadSlots() async {
        chosen = nil
        slots = nil
        do {
            let day = Day.string(self.day)
            let reply: SlotsResponse = try await APIClient.shared.get("/api/slots", query: [
                "from": day, "to": day, "kind": kind.rawValue,
            ])
            slots = reply.slots.sorted { $0.start < $1.start }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func book() async {
        guard let chosen else { return }
        booking = true
        defer { booking = false }
        do {
            let _: Booking = try await APIClient.shared.send("POST", "/api/bookings",
                                                             body: BookingInput(start: chosen.start, kind: kind.rawValue, clientId: client?.id))
            await session.refreshMe()
            dismiss()
        } catch {
            bookError = error.readable
        }
    }
}
