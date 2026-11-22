import SwiftUI

/// Your week (atelier-spec.md, Client screens 3): the programmed workouts,
/// 1:1s, classes, video calls and JK's rest days in one day-by-day list, this
/// week first and earlier weeks below, scrolled to the requested day. Every
/// action is a visible button. A month grid sits behind the toggle; booking
/// and the calendar feed live at the foot (plans with 'sessions').
struct YourWeekView: View {
    /// "YYYY-MM-DD" to scroll to; nil is today.
    let day: String?

    @Environment(AppSession.self) private var session
    @State private var workouts: [WorkoutSummary]?
    @State private var bookings: [Booking]?
    @State private var rests: [String: String] = [:]
    @State private var restDays: Set<String> = []
    @State private var error: String?
    @State private var actionError: String?
    @State private var month = false
    @State private var monthDay = Day.start(Date())
    @State private var calendarDraft: CalendarEventDraft?
    @State private var details: Booking?
    @State private var cancelling: Booking?

    private var api: APIClient { APIClient.shared }
    private var gate: Gate { session.gate }

    /// This week and next first, then the three weeks before.
    private var thisMonday: Date { Day.weekStart(Date()) }
    private var upcomingDays: [Date] { (0..<14).map { Day.add($0, to: thisMonday) } }
    private var earlierDays: [Date] { (1...21).map { Day.add(-$0, to: thisMonday) } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    if month {
                        MonthGrid(selected: $monthDay, marked: markedDays)
                        daySection(monthDay)
                    } else {
                        Loadable(value: workouts, error: error, retry: { await load() }) { _ in
                            ForEach(upcomingDays, id: \.self) { d in daySection(d).id(Day.string(d)) }
                            if earlierDays.contains(where: { !items(on: $0).isEmpty }) {
                                JKLabel("Earlier")
                                ForEach(earlierDays, id: \.self) { d in
                                    if !items(on: d).isEmpty || restDays.contains(Day.string(d)) {
                                        daySection(d).id(Day.string(d))
                                    }
                                }
                            }
                        }
                    }
                    foot
                }
                .padding(JK.Space.gutter)
            }
            .task {
                await load()
                proxy.scrollTo(day ?? Day.today, anchor: .top)
            }
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .navigationTitle("Your week")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { month.toggle() } label: {
                    Image(systemName: month ? "list.bullet" : IconKey.week.symbol)
                }
                .accessibilityLabel(month ? "Show the list" : "Show the month")
            }
        }
        .task(id: Day.string(Day.monthStart(monthDay))) { if month { await loadMonth() } }
        .onChange(of: month) { _, on in Task { if on { await loadMonth() } else { await load() } } }
        .addToCalendarSheet($calendarDraft)
        .sheet(item: $details) { BookingDetailsSheet(booking: $0).presentationDetents([.medium]) }
        .confirmationDialog("Cancel this booking?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }),
                            titleVisibility: .visible, presenting: cancelling) { b in
            Button("Cancel booking", role: .destructive) { Task { await cancel(b) } }
            Button("Keep it", role: .cancel) {}
        } message: { b in
            Text(b.refundable == false ? "It is within 24 hours, so the credit is not refunded." : "Cancelling 24 hours or more ahead refunds the credit.")
        }
        .errorAlert($actionError)
    }

    // MARK: Days

    private var markedDays: Set<String> {
        Set((bookings ?? []).filter(\.isMine).map { Day.string($0.start) } + (workouts ?? []).map(\.date))
    }

    private func items(on d: Date) -> [WeekItem] {
        let key = Day.string(d)
        let w = (workouts ?? []).filter { $0.date == key }.map(WeekItem.workout)
        let b = (bookings ?? []).filter { Day.string($0.start) == key && ($0.isMine || gate.sessions) }.map(WeekItem.booking)
        return (w + b).sorted { $0.sortKey < $1.sortKey }
    }

    private func daySection(_ d: Date) -> some View {
        let key = Day.string(d)
        let list = items(on: d)
        return VStack(alignment: .leading, spacing: JK.Space.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(Fmt.longDay(d)).font(.jkHeadline).foregroundStyle(Day.same(d, Date()) ? JK.text : JK.textSecondary)
                if Day.same(d, Date()) { Text("Today").font(.jkCaption).foregroundStyle(JK.textSecondary) }
                Spacer()
            }
            .accessibilityAddTraits(.isHeader)
            if restDays.contains(key) {
                HStack(spacing: JK.Space.s) {
                    Icon(key: .rest, size: 15).foregroundStyle(JK.textSecondary)
                    Text("Rest day from JK" + (rests[key].map { " · \($0)" } ?? "")).font(.jkCallout).foregroundStyle(JK.textSecondary)
                }
            }
            if list.isEmpty && !restDays.contains(key) {
                Text("Nothing planned").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            ForEach(list) { item in row(item) }
        }
    }

    private func row(_ item: WeekItem) -> some View {
        WeekItemRow(item: item,
                    onOpen: { open(item) },
                    onJoin: { join(item) },
                    onDetails: { if case .booking(let b) = item { details = b } },
                    onCancel: { if case .booking(let b) = item { cancelling = b } },
                    onClass: { join in Task { await joinOrLeave(item, join: join) } },
                    onCalendar: { calendarDraft = item.draft })
    }

    private func open(_ item: WeekItem) {
        if case .workout(let w) = item { TabRouter.shared.todayPath.append(.session(w.id)) }
    }

    private func join(_ item: WeekItem) {
        if case .booking(let b) = item, let link = b.meetingUrl, let url = URL(string: link) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Foot

    @ViewBuilder
    private var foot: some View {
        if gate.sessions {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                NavigationLink { BookSessionView(initialDay: max(monthDay, Day.start(Date()))) } label: {
                    HStack(spacing: JK.Space.m) {
                        Icon(key: .book).foregroundStyle(JK.textSecondary)
                        VStack(alignment: .leading, spacing: JK.Space.xs) {
                            Text("Book a session").font(.jkHeadline).foregroundStyle(JK.text)
                            Text(creditsLine).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                        }
                        Spacer()
                        Icon(key: .chevron, size: 13).foregroundStyle(JK.textSecondary)
                    }
                    .frame(minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                GroupDivider(inset: 0)
                CalendarSubscribeCard()
            }
        }
    }

    private var creditsLine: String {
        guard let m = session.me?.membership, let left = m.creditsLeft else { return "1:1s and video calls with JK" }
        return left == 1 ? "1 credit left" : "\(left) credits left"
    }

    // MARK: Loading and actions

    private func load() async {
        let from = Day.string(earlierDays.last ?? thisMonday)
        let to = Day.string(upcomingDays.last ?? thisMonday)
        await fetch(from: from, to: to)
    }

    private func loadMonth() async {
        let start = Day.monthStart(monthDay)
        let count = Day.calendar.range(of: .day, in: .month, for: start)?.count ?? 30
        await fetch(from: Day.string(start), to: Day.string(Day.add(count - 1, to: start)))
    }

    private func fetch(from: String, to: String) async {
        async let w: WorkoutsResponse = api.get("/api/workouts", query: ["from": from, "to": to])
        async let b: BookingsResponse = api.get("/api/bookings", query: ["from": from, "to": to])
        var failure: String?
        do { workouts = try await w.workouts } catch { if !error.isCancellation { failure = error.readable } }
        do { bookings = try await b.bookings } catch { if !error.isCancellation { failure = failure ?? error.readable } }
        if gate.habits, let week: HabitWeekResponse = try? await api.get("/api/habits/week", query: ["from": from, "to": to]) {
            for d in week.days where d.rest == true {
                restDays.insert(d.date)
                if let reason = d.restReason { rests[d.date] = reason }
            }
        }
        error = failure
        if workouts == nil && failure == nil { workouts = [] }
    }

    private func joinOrLeave(_ item: WeekItem, join: Bool) async {
        guard case .booking(let booking) = item else { return }
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
            await session.refreshMe()
            if reply.refunded != true, booking.usesCredit == true {
                actionError = "Cancelled. It was within 24 hours, so the credit wasn't refunded."
            }
        } catch {
            actionError = error.readable
        }
    }
}

/// One thing in the week: a programmed workout or a booking.
enum WeekItem: Identifiable {
    case workout(WorkoutSummary)
    case booking(Booking)

    var id: String {
        switch self {
        case .workout(let w): return "w" + w.id
        case .booking(let b): return "b" + b.id
        }
    }

    var sortKey: String {
        switch self {
        case .workout(let w): return w.startsAt ?? "99"
        case .booking(let b): return Fmt.time(b.start)
        }
    }

    var icon: IconKey {
        switch self {
        case .workout: return .workout
        case .booking(let b): return b.kind == "video" ? .video : b.isGroup ? .group : .oneToOne
        }
    }

    var title: String {
        switch self {
        case .workout(let w): return w.title
        case .booking(let b): return b.title ?? b.kindLabel
        }
    }

    var detail: String {
        switch self {
        case .workout(let w):
            let state = w.completedAt != nil ? "Done" : "\(w.itemCount) exercises"
            return [w.startsAt, w.location?.isEmpty == false ? w.location : nil, state].compactMap { $0 }.joined(separator: " · ")
        case .booking(let b):
            var parts = ["\(Fmt.time(b.start))–\(Fmt.time(b.end))"]
            if let place = b.location, !place.isEmpty { parts.append(place) }
            if b.isGroup, let cap = b.capacity { parts.append("\(b.attendeeCount ?? 0) of \(cap) going") }
            return parts.joined(separator: " · ")
        }
    }

    var start: Date? {
        switch self {
        case .workout(let w): return w.startsAt.flatMap { t in Day.date(w.date).flatMap { Day.at($0, time: t) } }
        case .booking(let b): return b.start
        }
    }

    /// Something still ahead that can go in Apple Calendar.
    var draft: CalendarEventDraft? {
        guard let start, start > Date() else { return nil }
        switch self {
        case .workout(let w):
            return CalendarEventDraft(title: w.title, start: start, end: start.addingTimeInterval(3600), location: w.location,
                                      notes: "Training session in JK Performance")
        case .booking(let b):
            guard b.isMine else { return nil }
            return CalendarEventDraft(title: b.title ?? b.kindLabel, start: b.start, end: b.end, location: b.location,
                                      notes: "JK Performance · \(b.kindLabel)")
        }
    }
}

/// A row in Your week: glyph, title, time and place, and visible buttons
/// (Start, Join or Details, Cancel, Add to calendar). No long-press menus.
struct WeekItemRow: View {
    let item: WeekItem
    let onOpen: () -> Void
    let onJoin: () -> Void
    let onDetails: () -> Void
    let onCancel: () -> Void
    let onClass: (Bool) -> Void
    let onCalendar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            HStack(alignment: .top, spacing: JK.Space.m) {
                Icon(key: item.icon).foregroundStyle(JK.textSecondary)
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Text(item.title).font(.jkHeadline).foregroundStyle(JK.text)
                    Text(item.detail).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            buttons
        }
        .surface(.card, padding: JK.Space.l)
    }

    private var buttons: some View {
        AdaptiveStack(spacing: JK.Space.s) {
            primary
            if item.draft != nil {
                Button("Add to calendar", action: onCalendar).buttonStyle(SmallPillStyle())
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var primary: some View {
        switch item {
        case .workout(let w):
            Button(w.completedAt == nil && w.date <= Day.today ? "Start" : "View", action: onOpen).buttonStyle(SmallPillStyle())
        case .booking(let b):
            if b.isGroup {
                if b.joined == true {
                    if b.start > Date() { Button("Leave class") { onClass(false) }.buttonStyle(SmallPillStyle()) }
                } else if b.start > Date() {
                    Button("Join class") { onClass(true) }.buttonStyle(SmallPillStyle())
                }
            } else {
                if b.meetingUrl != nil && b.end > Date() {
                    Button("Join", action: onJoin).buttonStyle(SmallPillStyle())
                } else {
                    Button("Details", action: onDetails).buttonStyle(SmallPillStyle())
                }
                if b.cancellable == true && b.start > Date() {
                    Button("Cancel", action: onCancel).buttonStyle(SmallPillStyle())
                }
            }
        }
    }
}

/// When, where and how for one booking.
struct BookingDetailsSheet: View {
    let booking: Booking
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                Text(booking.title ?? booking.kindLabel).font(.jkHeadline).foregroundStyle(JK.text)
                Text("\(Fmt.longDay(booking.start)) · \(Fmt.time(booking.start))–\(Fmt.time(booking.end))")
                    .font(.jkCallout.monospacedDigit()).foregroundStyle(JK.textSecondary)
                if let place = booking.location, !place.isEmpty {
                    Text(place).font(.jkCallout).foregroundStyle(JK.textSecondary)
                }
                if booking.kind == "video" && booking.meetingUrl == nil {
                    Text("JK will send the link before the call.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Spacer()
            }
            .padding(JK.Space.gutter)
            .frame(maxWidth: .infinity, alignment: .leading)
            .jkScreen()
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// The month at a glance: a dot under each day with something on it.
struct MonthGrid: View {
    @Binding var selected: Date
    let marked: Set<String>

    private let columns = Array(repeating: GridItem(.flexible(), spacing: JK.Space.xs), count: 7)
    private var month: Date { Day.monthStart(selected) }
    private var days: [Date] {
        let count = Day.calendar.range(of: .day, in: .month, for: month)?.count ?? 30
        return (0..<count).map { Day.add($0, to: month) }
    }

    var body: some View {
        VStack(spacing: JK.Space.m) {
            HStack {
                Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch) }
                    .accessibilityLabel("Previous month")
                Spacer()
                Text(Fmt.month(month)).font(.jkHeadline).foregroundStyle(JK.text)
                Spacer()
                Button { shift(1) } label: { Image(systemName: "chevron.right").frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch) }
                    .accessibilityLabel("Next month")
            }
            .foregroundStyle(JK.textSecondary)
            LazyVGrid(columns: columns, spacing: JK.Space.s) {
                ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, d in
                    Text(d).font(.jkMicro).foregroundStyle(JK.textSecondary)
                }
                ForEach(0..<(Day.isoWeekday(month) - 1), id: \.self) { _ in Color.clear.frame(minHeight: JK.Size.touch) }
                ForEach(days, id: \.self) { d in cell(d) }
            }
        }
    }

    private func cell(_ d: Date) -> some View {
        let on = Day.same(d, selected)
        return Button { selected = d } label: {
            VStack(spacing: JK.Space.xs) {
                Text("\(Day.calendar.component(.day, from: d))")
                    .font(.jkCallout.monospacedDigit())
                    .foregroundStyle(on ? JK.onPrimary : JK.text)
                    .frame(minWidth: 32, minHeight: 32)
                    .background(on ? JK.primaryFill : Color.clear, in: Circle())
                Circle().fill(marked.contains(Day.string(d)) ? JK.textSecondary : Color.clear)
                    .frame(width: 4, height: 4)
            }
            .frame(maxWidth: .infinity, minHeight: JK.Size.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Fmt.longDay(d))
        .accessibilityValue(marked.contains(Day.string(d)) ? "Something planned" : "")
    }

    private func shift(_ by: Int) {
        if let next = Day.calendar.date(byAdding: .month, value: by, to: month) { selected = next }
    }
}
