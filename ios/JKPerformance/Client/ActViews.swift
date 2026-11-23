import SwiftUI
import UIKit

// Act (plan-act-review.md, screens 2-4): This week, Today's work and In the
// session. Do the work: one thing on screen at a time, progress as quiet
// rings and lines.

/// GET /api/week, shared by This week and Today's work.
@MainActor
enum WeekLoader {
    static func load() async throws -> WeekPayload {
        try await APIClient.shared.get("/api/week")
    }
}

// MARK: - This week (Act root)

struct ActRoot: View {
    @Environment(AppSession.self) private var session
    @State private var week: WeekPayload?
    @State private var error: String?

    private var router: TabRouter { TabRouter.shared }

    var body: some View {
        NavigationStack(path: Bindable(TabRouter.shared).actPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    ParTopBar(coach: session.me?.coach, unread: router.unread > 0) { router.openJK() }
                    content
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.bottom, JK.Space.xxl)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .clientRoutes()
            .task { await load() }
            .onChange(of: router.actPath.count) { _, count in
                if count == 0 { Task { await load() } }
            }
            .onChange(of: router.client) { _, tab in
                if tab == .act { Task { await load() } }
            }
            .onChange(of: router.showJK) { _, open in
                if !open { Task { await load() } }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let week {
            if let error { ErrorBanner(message: error) }
            header(week)
            if let days = week.days, days.count == 7 {
                WeekLine(days: WeekText.lineDays(days))
            }
            todayCard(week)
            AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.m) {
                sessionCard(label: "Plan", session: week.plan, glyph: AnyView(DiamondGlyph(size: 12)), tab: .plan)
                sessionCard(label: "Review", session: week.review, glyph: AnyView(DottedCircleGlyph(size: 13)), tab: .review)
            }
            PrimaryButton("Begin today", arrow: true) { router.actPath.append(.todaysWork) }
        } else if let error {
            ErrorCard(message: error) { await load() }
        } else {
            LoadingCard()
        }
    }

    private func header(_ w: WeekPayload) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel(w.dateLabel ?? Fmt.fullDay(Date()))
            SerifText("\(w.greeting ?? Fmt.greeting()),\n*\(WeekText.plain(w.firstName ?? session.me?.firstName ?? "there")).*", size: .title)
                .foregroundStyle(JK.text)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private func todayCard(_ w: WeekPayload) -> some View {
        Button { router.actPath.append(.todaysWork) } label: {
            HStack(spacing: JK.Space.l) {
                ProgressRing(state: .progress(w.today?.progress ?? 0), size: JK.Size.ringHabit) {
                    Text("act")
                        .font(.jkSerif(.annotation, italic: true))
                        .foregroundStyle(JK.textSecondary)
                        .dynamicTypeSize(.large)
                }
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    JKLabel("Today")
                    SerifText(WeekText.plain(w.today?.title ?? "Today's work."), size: .card)
                        .foregroundStyle(JK.text)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .parCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Today. \(w.today?.title ?? "")")
        .accessibilityValue("\(Int(((w.today?.progress ?? 0) * 100).rounded())) percent done")
        .accessibilityHint("Opens today's work")
        .accessibilityAddTraits(.isButton)
    }

    /// PLAN / REVIEW half card. A missing session reads "Not booked yet" and opens the JK sheet.
    private func sessionCard(label: String, session s: WeekSession?, glyph: AnyView, tab: TabRouter.Client) -> some View {
        Button {
            if s == nil { router.openJK() } else { router.client = tab }
        } label: {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                glyph
                JKLabel(label)
                    .padding(.top, JK.Space.xs)
                SerifText(WeekText.plain(s?.title ?? "Not booked yet"), size: .small)
                    .foregroundStyle(s == nil ? JK.textSecondary : JK.text)
                    .multilineTextAlignment(.leading)
                Text(s?.when ?? "Ask JK to book one")
                    .font(.jkMeta)
                    .foregroundStyle(JK.textTertiary)
            }
            .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            .parCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label). \(s?.title ?? "Not booked yet")")
        .accessibilityValue(s?.when ?? "")
        .accessibilityHint(s == nil ? "Opens JK" : "Opens \(label)")
        .accessibilityAddTraits(.isButton)
    }

    private func load() async {
        do {
            let fresh = try await WeekLoader.load()
            week = fresh
            router.unread = fresh.unread ?? 0
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// Words and mappings for the week payload.
enum WeekText {
    /// Asterisks would turn into italics in SerifText.
    static func plain(_ s: String) -> String { s.replacingOccurrences(of: "*", with: "") }

    static let dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    static func lineDays(_ days: [WeekDayMark]) -> [WeekLine.Day] {
        days.enumerated().map { i, d in
            let mark: WeekLine.Mark
            switch d.mark {
            case "today": mark = .today
            case "plan": mark = .plan
            case "review": mark = .review
            default: mark = d.today == true ? .today : .none
            }
            return WeekLine.Day(id: i, letter: d.letter ?? String(dayNames[i % 7].prefix(1)), mark: mark,
                                done: d.done == true, today: d.today == true, name: dayNames[i % 7])
        }
    }

    /// Monday = 0 for a "YYYY-MM-DD" day.
    static func weekdayIndex(_ date: String?) -> Int? {
        guard let date, let d = Day.date(date) else { return nil }
        return Day.isoWeekday(d) - 1
    }
}

// MARK: - Today's work

struct TodaysWorkView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var week: WeekPayload?
    @State private var error: String?
    @State private var actionError: String?
    @State private var habitSheet = false
    @State private var habitFocus: String?
    @State private var sessionWorkout: SessionTarget?
    @State private var toast: String?
    /// A long press just opened the habit sheet: swallow the tap that follows on release.
    @State private var longPressed = false

    struct SessionTarget: Identifiable {
        let id: String
    }

    private var router: TabRouter { TabRouter.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                topRow
                content
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.bottom, JK.Space.xxl)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(isPresented: $habitSheet, onDismiss: {
            longPressed = false
            Task { await load() }
        }) { HabitSheet(focus: habitFocus) }
        .fullScreenCover(item: $sessionWorkout, onDismiss: { Task { await load() } }) { target in
            InSessionView(workoutId: target.id)
        }
        .jkToast($toast)
        .errorAlert($actionError)
    }

    private var topRow: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").fontWeight(.light).foregroundStyle(JK.text)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")
            Spacer()
            Button { router.openJK() } label: {
                TopBarAvatar(coach: session.me?.coach, unread: router.unread > 0)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch, alignment: .trailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("JK")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let week {
            if let error { ErrorBanner(message: error) }
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("Act · \(week.dayName ?? Fmt.weekdayName(Date()))")
                SerifText("Today's *work.*", size: .title).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
            }
            sessionCard(week.today)
            habitsBlock(week)
            footer(week.footer)
        } else if let error {
            ErrorCard(message: error) { await load() }
        } else {
            LoadingCard()
        }
    }

    // MARK: Session

    @ViewBuilder
    private func sessionCard(_ t: WeekToday?) -> some View {
        if gate.programme, let w = t?.workout {
            let blocks = (w.blocks ?? []).enumerated().map { BlockStrip.Block(id: $0.offset, label: $0.element.label ?? "", done: $0.element.done == true) }
            let started = blocks.contains(where: \.done)
            VStack(alignment: .leading, spacing: JK.Space.l) {
                JKLabel(w.minutes.map { "Session · About \($0) minutes" } ?? "Session")
                SerifText(WeekText.plain(w.title ?? "Today's session"), size: .card).foregroundStyle(JK.text)
                if !blocks.isEmpty { BlockStrip(blocks: blocks) }
                if w.completed == true {
                    PrimaryButton("Done today") {}
                        .disabled(true)
                } else {
                    PrimaryButton(started ? "Continue" : "Start session") { sessionWorkout = SessionTarget(id: w.id) }
                }
            }
            .parCard(padding: JK.Space.xl)
        } else {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                JKLabel("Today")
                SerifText("Rest *day.*", size: .card).foregroundStyle(JK.text)
                if let line = t?.coachLine?.text, !line.isEmpty {
                    SerifText(WeekText.plain(line), size: .cue, allItalic: true).foregroundStyle(JK.textSecondary)
                }
            }
            .parCard(padding: JK.Space.xl)
        }
    }

    // MARK: Habits

    @ViewBuilder
    private func habitsBlock(_ w: WeekPayload) -> some View {
        let habits = w.today?.habits ?? []
        if gate.habits && !habits.isEmpty {
            let todayIndex = WeekText.weekdayIndex(w.date)
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("Habits", trailing: "the work between sessions")
                if typeSize.isAccessibilitySize {
                    VStack(spacing: JK.Space.s) {
                        ForEach(habits) { h in habitCard(h, todayIndex: todayIndex, wide: true) }
                    }
                } else if habits.count <= 3 {
                    HStack(alignment: .top, spacing: JK.Space.s) {
                        ForEach(habits) { h in habitCard(h, todayIndex: todayIndex, wide: false) }
                    }
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: JK.Space.s) {
                            ForEach(habits) { h in
                                habitCard(h, todayIndex: todayIndex, wide: false)
                                    .containerRelativeFrame(.horizontal, count: 3, span: 1, spacing: JK.Space.s)
                            }
                        }
                    }
                }
            }
        }
    }

    private func ringState(_ h: WeekHabit) -> ProgressRing<EmptyView>.RingState {
        h.done ? .done : .progress(h.progress ?? 0)
    }

    @ViewBuilder
    private func habitCard(_ h: WeekHabit, todayIndex: Int?, wide: Bool) -> some View {
        let label = Button {
            if longPressed {
                longPressed = false
            } else {
                tap(h)
            }
        } label: {
            Group {
                if wide {
                    HStack(spacing: JK.Space.m) {
                        ProgressRing(state: ringState(h), size: JK.Size.ringHabit)
                        VStack(alignment: .leading, spacing: JK.Space.s) {
                            Text(h.name).font(.jkCaption).foregroundStyle(JK.text)
                            HabitWeekDots(week: h.week ?? [], todayIndex: todayIndex)
                        }
                        Spacer(minLength: 0)
                    }
                } else {
                    VStack(spacing: JK.Space.m) {
                        ProgressRing(state: ringState(h), size: JK.Size.ringHabit)
                        Text(h.name)
                            .font(.jkCaption)
                            .foregroundStyle(JK.text)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                            .frame(maxWidth: .infinity)
                        Spacer(minLength: 0)
                        HabitWeekDots(week: h.week ?? [], todayIndex: todayIndex)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .parCard(padding: JK.Space.m)
            .contentShape(Rectangle())
        }
        label
            .buttonStyle(.plain)
            .simultaneousGesture(LongPressGesture().onEnded { _ in
                longPressed = true
                openSheet(h)
            })
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(h.name)
            .accessibilityValue(habitValue(h))
            .accessibilityAddTraits(h.done ? [.isButton, .isSelected] : .isButton)
            .accessibilityHint(h.isCheck ? (h.done ? "Double tap to untick." : "Double tap to tick.") : "Opens the habit")
            .accessibilityAction(named: "Open details") { openSheet(h) }
    }

    private func habitValue(_ h: WeekHabit) -> String {
        let doneDays = (h.week ?? []).compactMap { $0 }.filter { $0 }.count
        let today: String
        if h.isCheck {
            today = h.done ? "Done today" : "Not yet today"
        } else {
            let unit = (h.unit ?? "").isEmpty ? "" : " \(h.unit ?? "")"
            today = "\(Fmt.number(h.value ?? 0)) of \(Fmt.number(h.target ?? 0))\(unit) today"
        }
        return "\(today), \(doneDays) \(doneDays == 1 ? "day" : "days") this week"
    }

    private func openSheet(_ h: WeekHabit) {
        habitFocus = h.id
        habitSheet = true
    }

    private func tap(_ h: WeekHabit) {
        guard h.isCheck else {
            openSheet(h)
            return
        }
        if !reduceMotion { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        Task { await toggle(h) }
    }

    private func toggle(_ h: WeekHabit) async {
        let date = week?.date ?? Day.today
        let before = week
        // Optimistic: show the tick at once, then take the server's word.
        if var w = week, var t = w.today, var list = t.habits, let i = list.firstIndex(where: { $0.id == h.id }) {
            list[i].doneToday = !h.done
            list[i].progress = h.done ? 0 : 1
            if let ti = WeekText.weekdayIndex(date), var wk = list[i].week, ti < wk.count {
                wk[ti] = !h.done
                list[i].week = wk
            }
            t.habits = list
            w.today = t
            withAnimation(JK.Motion.respecting(reduceMotion, JK.Motion.tick)) { week = w }
        }
        do {
            let _: Habit = try await APIClient.shared.send("PUT", "/api/habits/\(seg(h.id))/days/\(date)",
                                                           body: HabitDayInput(value: nil, done: !h.done))
            await load(quiet: true)
        } catch {
            week = before
            actionError = error.readable
        }
    }

    @ViewBuilder
    private func footer(_ text: String?) -> some View {
        if let text, !text.isEmpty {
            HStack(spacing: JK.Space.m) {
                Rectangle().fill(JK.hairline).frame(height: JK.Size.hairline)
                Text(text)
                    .font(.jkSerif(.annotation, italic: true))
                    .foregroundStyle(JK.textTertiary)
                    .multilineTextAlignment(.center)
                    .layoutPriority(1)
                Rectangle().fill(JK.hairline).frame(height: JK.Size.hairline)
            }
            .padding(.top, JK.Space.l)
        }
    }

    private func load(quiet: Bool = false) async {
        do {
            let fresh = try await WeekLoader.load()
            week = fresh
            router.unread = fresh.unread ?? router.unread
            error = nil
        } catch {
            if !error.isCancellation && !quiet { self.error = error.readable }
        }
    }
}

// MARK: - In the session

/// One exercise at a time over the existing workout logger data (screen 4):
/// the name, the sets as circles, the tempo, JK's cue, and "Set done". Swipe
/// between exercises. Offline logging keeps working through the Outbox.
struct InSessionView: View {
    let workoutId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var workout: Workout?
    @State private var error: String?
    @State private var actionError: String?
    @State private var page = 0
    @State private var busy = false
    @State private var editing: EditTarget?
    @State private var finishing = false
    @State private var closeAfterFinish = false
    /// A long press on "Set done" opened the editor: swallow the tap that follows on release.
    @State private var longPressed = false

    struct EditTarget: Identifiable {
        let id: String
    }

    private var ordered: [WorkoutItem] { (workout?.items ?? []).sorted { $0.order < $1.order } }
    private var current: WorkoutItem? { ordered.indices.contains(page) ? ordered[page] : nil }
    private var allDone: Bool { !ordered.isEmpty && ordered.allSatisfy(\.isDone) }

    var body: some View {
        ZStack {
            JK.bg.ignoresSafeArea()
            FaintRings(center: UnitPoint(x: 0.5, y: 0.45)).ignoresSafeArea()
            VStack(spacing: 0) {
                header
                if workout != nil {
                    if ordered.isEmpty {
                        Spacer()
                        EmptyState(line: "JK hasn't added exercises to this session yet.")
                            .padding(.horizontal, JK.Space.gutter)
                        Spacer()
                    } else {
                        TabView(selection: $page) {
                            ForEach(Array(ordered.enumerated()), id: \.element.id) { i, item in
                                exercisePage(item, index: i).tag(i)
                            }
                        }
                        .tabViewStyle(.page(indexDisplayMode: .never))
                        if let workout { footer(workout) }
                    }
                } else if let error {
                    Spacer()
                    ErrorCard(message: error) { await load() }.padding(.horizontal, JK.Space.gutter)
                    Spacer()
                } else {
                    Spacer()
                    LoadingCard()
                    Spacer()
                }
            }
        }
        .task { await load(initial: true) }
        .sheet(item: $editing, onDismiss: { longPressed = false }) { target in
            if let workout {
                NavigationStack {
                    WorkoutLoggerView(workout: workout, itemId: target.id) { self.workout = $0 }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { editing = nil } }
                        }
                }
            }
        }
        .fullScreenCover(isPresented: $finishing, onDismiss: {
            if closeAfterFinish { dismiss() }
        }) {
            if let workout {
                SessionCompleteView(workout: workout) { fresh in
                    self.workout = fresh
                    closeAfterFinish = fresh.completedAt != nil
                }
            }
        }
        .errorAlert($actionError)
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: JK.Space.m) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").fontWeight(.light).foregroundStyle(JK.text)
                        .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close session")
                Spacer()
                Text(workout?.title ?? "Session")
                    .jkText(.label)
                    .foregroundStyle(JK.textTertiary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Color.clear.frame(width: JK.Size.touch, height: 1)
            }
            if !ordered.isEmpty {
                HStack(spacing: JK.Space.xs) {
                    ForEach(Array(ordered.enumerated()), id: \.element.id) { i, item in
                        Capsule()
                            .fill(item.isDone ? JK.silver : (i == page ? JK.textSecondary : JK.track))
                            .frame(height: JK.Size.rule)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Exercise \(page + 1) of \(ordered.count)")
                .accessibilityValue("\(ordered.filter(\.isDone).count) done")
            }
        }
        .padding(.horizontal, JK.Space.gutter)
        .padding(.top, JK.Space.s)
    }

    // MARK: One exercise

    private func exercisePage(_ item: WorkoutItem, index: Int) -> some View {
        ScrollView {
            VStack(spacing: JK.Space.xl) {
                Text(item.isDone ? "Done" : (item.logged.isEmpty ? "Next" : "Now"))
                    .jkText(.label)
                    .foregroundStyle(JK.textTertiary)
                    .padding(.top, JK.Space.xxl)
                VStack(spacing: JK.Space.s) {
                    SerifText(SerifText.lastWordItalic(WeekText.plain(item.exercise.name)), size: .hero)
                        .foregroundStyle(JK.text)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text(NumberWords.prescription(sets: item.sets, reps: item.reps))
                        .font(.jkBodySmall)
                        .foregroundStyle(JK.textSecondary)
                    if !item.load.isEmpty {
                        Text(item.load).font(.jkMeta).foregroundStyle(JK.textTertiary)
                    }
                }
                setCircles(item)
                if let tempo = item.tempo, TempoLine.parse(tempo) != nil {
                    TempoLine(tempo: tempo)
                }
                if let note = item.note, !note.isEmpty {
                    cue(note)
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.bottom, JK.Space.xl)
            .frame(maxWidth: .infinity)
        }
        .accessibilityAction(named: "Next exercise") { if index + 1 < ordered.count { page = index + 1 } }
        .accessibilityAction(named: "Previous exercise") { if index > 0 { page = index - 1 } }
        .accessibilityAction(named: "Edit sets") { editing = EditTarget(id: item.id) }
    }

    private func setCircles(_ item: WorkoutItem) -> some View {
        let count = max(item.sets, 1)
        let next = (1...count).first { n in !item.logged.contains { $0.number == n } }
        return HStack(spacing: JK.Space.m) {
            ForEach(1...count, id: \.self) { n in
                let logged = item.logged.contains { $0.number == n }
                Button { editing = EditTarget(id: item.id) } label: {
                    SetCircle(state: logged ? .logged : (n == next ? .next : .later))
                        .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Set \(n)")
                .accessibilityValue(logged ? "Logged" : (n == next ? "Next" : "To come"))
                .accessibilityHint("Opens the set editor")
            }
        }
    }

    private func cue(_ note: String) -> some View {
        HStack(alignment: .top, spacing: JK.Space.m) {
            Rectangle().fill(JK.trackStrong).frame(width: JK.Size.hairline)
            VStack(alignment: .leading, spacing: JK.Space.s) {
                SerifText("\u{201C}\(WeekText.plain(note))\u{201D}", size: .cue, allItalic: true)
                    .foregroundStyle(JK.text)
                Text("JK's cue").font(.jkMeta).foregroundStyle(JK.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    // MARK: Footer

    private func footer(_ workout: Workout) -> some View {
        VStack(spacing: JK.Space.m) {
            OfflineBanner()
            Button {
                if longPressed {
                    longPressed = false
                } else {
                    primary(workout)
                }
            } label: {
                if busy { ProgressView().tint(JK.onChrome) } else { Text(primaryTitle(workout)) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || workout.completedAt != nil)
            .simultaneousGesture(LongPressGesture().onEnded { _ in
                if let current, workout.completedAt == nil {
                    longPressed = true
                    editing = EditTarget(id: current.id)
                }
            })
            Text("Rest as long as you need").font(.jkMeta).foregroundStyle(JK.textTertiary)
        }
        .padding(.horizontal, JK.Space.gutter)
        .padding(.bottom, JK.Space.s)
    }

    private func primaryTitle(_ workout: Workout) -> String {
        if workout.completedAt != nil { return "Done today" }
        if allDone { return "Finish session" }
        if current?.isDone == true { return "Next exercise" }
        return "Set done"
    }

    private func primary(_ workout: Workout) {
        if allDone {
            finishing = true
            return
        }
        guard let item = current else { return }
        if item.isDone {
            advance()
            return
        }
        Task { await logNext(item) }
    }

    /// To the next exercise with sets still to do.
    private func advance() {
        let after = ordered.indices.filter { $0 > page && !ordered[$0].isDone }
        let target = after.first ?? ordered.indices.first { !ordered[$0].isDone } ?? page
        withAnimation(JK.Motion.respecting(reduceMotion, JK.Motion.fade)) { page = target }
    }

    // MARK: Logging (as WorkoutLoggerView does, offline-safe)

    private func defaultLoad(_ item: WorkoutItem) -> String {
        if let last = item.logged.max(by: { $0.number < $1.number }) { return last.load }
        return item.load.replacingOccurrences(of: " kg", with: "").replacingOccurrences(of: "kg", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    private func defaultReps(_ item: WorkoutItem) -> Int? {
        if let last = item.logged.max(by: { $0.number < $1.number }) { return last.reps }
        return Int(String(item.reps.prefix { $0.isNumber }))
    }

    private func logNext(_ item: WorkoutItem) async {
        guard let workout, item.sets > 0,
              let n = (1...item.sets).first(where: { n in !item.logged.contains { $0.number == n } }) else { return }
        guard let reps = defaultReps(item) else {
            // "30s" or "AMRAP": the editor asks for the number.
            editing = EditTarget(id: item.id)
            return
        }
        busy = true
        defer { busy = false }
        let path = "/api/workouts/\(seg(workout.id))/items/\(seg(item.id))/sets/\(n)"
        let input = SetInput(load: defaultLoad(item), reps: reps, rpe: nil)
        do {
            let fresh: Workout = try await APIClient.shared.send("PUT", path, body: input)
            self.workout = fresh
        } catch let failure where Outbox.isOffline(failure) {
            Outbox.shared.enqueue("PUT", path, body: input)
            var local = workout
            local.setLogged(itemId: item.id, LoggedSet(number: n, load: input.load, reps: reps, rpe: nil, at: Date()), number: n)
            self.workout = local
        } catch {
            actionError = error.readable
        }
    }

    private func load(initial: Bool = false) async {
        if Outbox.shared.hasPending(workoutId: workoutId) { await Outbox.shared.flush() }
        if workout != nil, Outbox.shared.hasPending(workoutId: workoutId) { return }
        do {
            let fresh: Workout = try await APIClient.shared.get("/api/workouts/\(seg(workoutId))")
            workout = fresh
            error = nil
            if initial {
                let items = fresh.items.sorted { $0.order < $1.order }
                page = items.firstIndex { !$0.isDone } ?? 0
            }
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}
