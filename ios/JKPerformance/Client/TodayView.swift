import SwiftUI

/// Today (atelier-spec.md, Client screens 1): one page a day, five blocks in a
/// fixed order, each rendered only when the plan includes it and something is
/// there: the header, the goal, today's habits, the one thing next, and JK's
/// line. Everything comes from GET /api/today.
struct TodayView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var today: TodayPayload?
    @State private var habits: [Habit] = []
    @State private var error: String?
    @State private var toast: String?
    /// Restores the habit just unticked ("Untick Water?" Undo).
    @State private var undo: (habit: Habit, input: HabitDayInput)?
    @State private var showHabits = false
    @State private var habitFocus: String?
    @State private var checkIn = false
    @State private var form: FormRequest?
    @State private var actionError: String?

    private var router: TabRouter { TabRouter.shared }
    private var api: APIClient { APIClient.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        NavigationStack(path: Bindable(TabRouter.shared).todayPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.section) {
                    TodayHeader(firstName: today?.firstName ?? session.me?.firstName ?? "there",
                                initials: Fmt.initials(session.me?.name ?? "?")) {
                        router.showAccount = true
                    }
                    content
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.vertical, JK.Space.l)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .clientRoutes()
            .task { await load() }
            .onChange(of: router.todayPath.count) { _, count in
                // Back on Today after a session or Your week: re-read.
                if count == 0 { Task { await load() } }
            }
        }
        .sheet(isPresented: Bindable(TabRouter.shared).showAccount) { AccountSheet() }
        .sheet(isPresented: $showHabits, onDismiss: { Task { await load() } }) {
            HabitSheet(focus: habitFocus)
        }
        .sheet(isPresented: $checkIn, onDismiss: { Task { await load() } }) { CheckInSheet() }
        .sheet(item: $form, onDismiss: { Task { await load() } }) { FormFillView(request: $0) }
        .jkToast($toast, actionTitle: undo == nil ? nil : "Undo") { restore() }
        .errorAlert($actionError)
    }

    @ViewBuilder
    private var content: some View {
        if let today {
            if let error { ErrorBanner(message: error) }
            goalBlock(today)
            habitsBlock(today)
            nextBlock(today)
            coachBlock(today)
        } else if let error {
            ErrorCard(message: error) { await load() }
        } else {
            LoadingCard()
        }
    }

    // MARK: Goal

    @ViewBuilder
    private func goalBlock(_ t: TodayPayload) -> some View {
        if gate.progress {
            if let goal = t.goal {
                Button { router.client = .progress } label: {
                    GoalLine(state: goal.isReached
                             ? .reached(sentence: goal.title)
                             : .set(sentence: goal.title, progress: goal.fraction,
                                    remaining: goal.remainingLabel ?? ""))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens Progress")
            } else if t.goalPending == true {
                GoalLine(state: .notSet)
            }
        }
    }

    // MARK: Habits

    @ViewBuilder
    private func habitsBlock(_ t: TodayPayload) -> some View {
        if gate.habits && !habits.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                habitsHeader(t)
                if typeSize.isAccessibilitySize {
                    VStack(spacing: JK.Space.s) {
                        ForEach(habits) { h in habitListRow(h, rest: t.rest != nil) }
                    }
                } else {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(habits.prefix(5)) { h in
                            habitMark(h, rest: t.rest != nil).frame(maxWidth: .infinity)
                        }
                    }
                }
                if let week = t.week, week.count == 7 {
                    WeekDots(days: week.map(Self.entry), showInitials: !typeSize.isAccessibilitySize) { day in
                        router.openWeek(day.id)
                    }
                }
            }
        }
    }

    static func entry(_ d: DayState) -> WeekDots.Entry {
        WeekDots.Entry(day: d.date, done: d.done == true, rest: d.rest == true,
                       future: d.future == true, isToday: d.today == true)
    }

    private func habitsHeader(_ t: TodayPayload) -> some View {
        let done = habits.filter(\.done).count
        return Button {
            habitFocus = nil
            showHabits = true
        } label: {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: JK.Space.s) {
                    if t.dayDone == true {
                        (Text("Day done").foregroundColor(JK.accent) + Text(" · \(done) of \(habits.count)").foregroundColor(JK.text))
                            .font(.jkHeadline.monospacedDigit())
                    } else {
                        Text("Habits").font(.jkHeadline).foregroundStyle(JK.text)
                        Text("\(done) of \(habits.count)").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    }
                    Icon(key: .chevron, size: 13).foregroundStyle(JK.textSecondary)
                    Spacer(minLength: 0)
                }
                if let line = headerLine(t) {
                    Text(line).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            .frame(minHeight: JK.Size.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens today's habits")
    }

    private func headerLine(_ t: TodayPayload) -> String? {
        if t.rest != nil { return "JK gave you today off" + (t.rest?.reason.map { ". \($0)" } ?? "") }
        if t.missedYesterday == true && t.dayDone != true { return "Yesterday slipped. Today keeps it going." }
        return nil
    }

    private func markState(_ h: Habit, rest: Bool) -> HabitMark.MarkState {
        if rest && !h.done { return .rest }
        if h.done { return .done }
        let f = h.fraction
        return f > 0 ? .partial(f) : .idle
    }

    private func habitMark(_ h: Habit, rest: Bool) -> some View {
        HabitMark(key: h.key, name: h.name, state: markState(h, rest: rest), valueText: valueText(h),
                  fromHealth: h.fromHealth,
                  onTap: { tap(h, rest: rest) },
                  onLongPress: {
                      habitFocus = h.id
                      showHabits = true
                  })
    }

    /// At accessibility sizes: glyph, label, value, the rule segment as a leading bar.
    private func habitListRow(_ h: Habit, rest: Bool) -> some View {
        Button { tap(h, rest: rest) } label: {
            HStack(spacing: JK.Space.m) {
                Rectangle()
                    .fill(h.done ? JK.accent : JK.track)
                    .frame(width: JK.Size.rule)
                    .frame(maxHeight: .infinity)
                    .accessibilityHidden(true)
                Icon(key: h.key, filled: h.done, size: JK.Size.iconHabit)
                    .foregroundStyle(h.done ? JK.accent : JK.textSecondary)
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Text(h.name).font(.jkBody).foregroundStyle(JK.text)
                    Text(valueText(h)).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: JK.Size.habitMarkMax)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(h.name)
        .accessibilityValue(valueText(h))
        .accessibilityAddTraits(h.done ? [.isButton, .isSelected] : .isButton)
    }

    private func valueText(_ h: Habit) -> String {
        HabitText.value(h)
    }

    // MARK: Ticking

    private func tap(_ h: Habit, rest: Bool) {
        if h.fromHealth {
            undo = nil
            toast = "Updates from Apple Health"
            return
        }
        if h.done {
            let restoreInput = HabitDayInput(value: h.value, done: h.isCount ? nil : true)
            let input = h.isCount ? HabitDayInput(value: 0, done: false) : HabitDayInput(value: nil, done: false)
            undo = (h, restoreInput)
            toast = "Untick \(h.name)?"
            Task { await set(h, input) }
        } else {
            undo = nil
            let input = h.isCount ? HabitDayInput(value: (h.value ?? 0) + h.increment, done: nil)
                                  : HabitDayInput(value: nil, done: true)
            Task { await set(h, input) }
        }
    }

    private func restore() {
        guard let pending = undo else { return }
        undo = nil
        Task { await set(pending.habit, pending.input) }
    }

    private func set(_ h: Habit, _ input: HabitDayInput) async {
        // Optimistic: show the tick at once, then take the server's word.
        if let i = habits.firstIndex(where: { $0.id == h.id }) {
            var local = habits[i]
            if let v = input.value { local.value = v }
            if let d = input.done { local.done = d } else if local.isCount { local.done = (local.value ?? 0) >= local.target }
            withAnimation(JK.Motion.respecting(reduceMotion, JK.Motion.tick)) { habits[i] = local }
        }
        do {
            let fresh: Habit = try await api.send("PUT", "/api/habits/\(seg(h.id))/days/\(today?.date ?? Day.today)", body: input)
            if let i = habits.firstIndex(where: { $0.id == fresh.id }) { habits[i] = fresh }
            await load(quiet: true)
        } catch {
            if let i = habits.firstIndex(where: { $0.id == h.id }) { habits[i] = h }
            actionError = error.readable
        }
    }

    // MARK: Next

    @ViewBuilder
    private func nextBlock(_ t: TodayPayload) -> some View {
        if let next = t.next {
            NextCard(icon: NextText.icon(next.kind), caption: NextText.caption(next.kind), title: next.title,
                     detail: next.detail, actionTitle: next.buttonLabel ?? "See your week",
                     alsoDue: NextText.alsoDue(next.alsoDue)) {
                act(next)
            }
        }
    }

    private func act(_ next: NextUp) {
        let item = next.item
        switch next.action {
        case "startSession", "viewSession":
            if let id = item?.workoutId { router.todayPath.append(.session(id)) } else { router.openWeek(item?.date) }
        case "join":
            if let link = item?.meetingUrl, let url = URL(string: link) { UIApplication.shared.open(url) } else { router.openWeek(item?.date) }
        case "checkin":
            checkIn = true
        case "form":
            Task { await openForm(item?.formRequestId) }
        case "membership":
            router.showMembership = true
            router.showAccount = true
        default:
            router.openWeek(item?.date)
        }
    }

    private func openForm(_ id: String?) async {
        do {
            let reply: FormRequestsResponse = try await api.get("/api/form-requests")
            form = reply.requests.first { $0.id == id } ?? reply.requests.first { $0.submittedAt == nil }
        } catch {
            actionError = error.readable
        }
    }

    // MARK: From JK

    @ViewBuilder
    private func coachBlock(_ t: TodayPayload) -> some View {
        if let line = t.coachLine, !CoachLineRule.isStale(line) {
            CoachNote(coach: session.me?.coach, caption: line.caption ?? "JK", quote: line.text,
                      unread: line.unread == true,
                      onOpen: { openLine(line) },
                      onReply: gate.messaging ? { reply(line) } : nil)
        }
    }

    private func openLine(_ line: CoachLine) {
        if let id = line.letterId {
            router.todayPath.append(.letter(id))
        } else {
            router.client = .jk
        }
    }

    private func reply(_ line: CoachLine) {
        if let id = line.letterId {
            router.replyQuote = .init(reportId: id, headline: line.text)
        }
        router.client = .jk
    }

    // MARK: Loading

    private func load(quiet: Bool = false) async {
        do {
            let fresh: TodayPayload = try await api.get("/api/today")
            today = fresh
            habits = fresh.habits ?? []
            error = nil
        } catch {
            if !error.isCancellation && !quiet { self.error = error.readable }
        }
        if !quiet {
            await session.refreshMe()
            await Reminders.shared.refresh(gate: gate, preferences: session.me?.preferences)
        }
    }
}

/// "Sunday 22 November", "Evening, Sam" in sans display Light, and the 36pt
/// avatar that opens the Account sheet.
struct TodayHeader: View {
    let firstName: String
    let initials: String
    let onAccount: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: JK.Space.m) {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(Fmt.fullDay(Date())).font(.jkCaption).foregroundStyle(JK.textSecondary)
                Text("\(Fmt.greeting()), \(firstName)")
                    .jkText(.display)
                    .foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            Button(action: onAccount) {
                Avatar(initials: initials, size: JK.Size.avatar)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Account")
        }
    }
}

/// Words for a habit's value.
enum HabitText {
    static func value(_ h: Habit) -> String {
        if h.healthKind == "sleep", let v = h.value { return "\(Fmt.minutes(v * 60)) of \(Fmt.number(h.target)) h" }
        if h.isCount {
            let unit = h.unit.isEmpty ? "" : " \(h.unit)"
            return "\(Fmt.number(h.value ?? 0)) of \(Fmt.number(h.target))\(unit)"
        }
        return h.done ? "Done" : "Not yet"
    }
}

/// The Next card's glyph and caption by kind.
enum NextText {
    static func icon(_ kind: String) -> IconKey {
        switch kind {
        case "session", "workout": return .workout
        case "videoCall": return .video
        case "checkin": return .checkIn
        case "form": return .form
        case "booking": return .oneToOne
        case "rest": return .rest
        case "membership": return .jk
        default: return .week
        }
    }

    static func caption(_ kind: String) -> String {
        switch kind {
        case "session": return "Next"
        case "videoCall": return "Video call"
        case "checkin": return "Check-in"
        case "form": return "From JK"
        case "workout": return "Later today"
        case "booking": return "Booked"
        case "rest": return "Today"
        case "membership": return "Coaching"
        default: return "Next"
        }
    }

    static func alsoDue(_ list: [AlsoDue]?) -> String? {
        let labels = (list ?? []).compactMap { $0.label ?? ($0.kind == "checkin" ? "Check-in" : nil) }
        return labels.isEmpty ? nil : "Also due: " + labels.joined(separator: ", ")
    }
}

/// Nothing JK said more than one rhythm ago is shown as if it were current:
/// the line hides after the plan's rhythm plus three days. The server already
/// drops older lines; this keeps a cached payload honest too.
enum CoachLineRule {
    static func isStale(_ line: CoachLine, now: Date = Date()) -> Bool {
        guard let at = line.at else { return false }
        let days = Double(line.staleAfterDays ?? 10)
        return now.timeIntervalSince(at) > days * 86_400
    }
}

extension View {
    /// The screens a client tab can push (ClientRoute).
    func clientRoutes() -> some View {
        navigationDestination(for: ClientRoute.self) { route in
            switch route {
            case .yourWeek(let day): YourWeekView(day: day)
            case .session(let id): WorkoutDetailLoader(workoutId: id)
            case .letter(let id): LetterView(reportId: id)
            case .guides: GuidesList()
            case .guide(let id): GuideView(guideId: id)
            case .challenges: ChallengesView()
            }
        }
    }
}
