import Charts
import SwiftUI

/// One client, for the coach (atelier-spec.md, Coach screens 3): an Overview
/// with no segments. Goal, habit week with rest days, the latest check-in and
/// "Write this week's letter", the next session and three health numbers;
/// rows below open the plan, sessions, letters, forms and health detail.
struct ClientDetailView: View {
    let clientId: String
    let name: String

    init(clientId: String, name: String) {
        self.clientId = clientId
        self.name = name
    }

    @State private var detail: ClientDetail?
    @State private var history: HabitHistory?
    @State private var health: HealthWeek?
    @State private var error: String?
    @State private var actionError: String?
    @State private var editingGoal: GoalDraftRef?
    @State private var givingRest = false

    struct GoalDraftRef: Identifiable {
        let goal: Goal?
        var id: String { goal?.id ?? "new" }
    }

    private var fullName: String { detail?.client.name ?? name }
    private var firstName: String { Fmt.firstWord(fullName) }
    private var person: PersonRef { PersonRef(id: clientId, name: fullName, initials: detail?.client.initials) }
    private var goal: Goal? {
        let goals = detail?.goals ?? []
        return goals.first { $0.status == "active" } ?? goals.first { $0.isDraft } ?? goals.first
    }
    private var lettersOn: Bool { (detail?.settings?.letterRhythm?.every ?? "weekly") != "none" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                if let error, detail == nil {
                    ErrorCard(message: error) { await load() }
                } else if detail == nil {
                    LoadingCard()
                } else {
                    if let error { ErrorBanner(message: error) }
                    header
                    GoalCard(goal: goal) { editingGoal = GoalDraftRef(goal: goal) }
                    habitSection
                    checkinSection
                    nextSection
                    healthSection
                    links
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.vertical, JK.Space.l)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .navigationTitle(firstName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    MessagesThreadView(clientId: clientId, otherName: fullName, subtitle: Fmt.planName(detail?.client.plan))
                } label: { Image(systemName: IconKey.messages.symbol) }
                    .accessibilityLabel("Messages with \(firstName)")
            }
        }
        .task { await load() }
        .sheet(item: $editingGoal) { ref in
            GoalEditorSheet(clientId: clientId, goal: ref.goal) { await load() }
        }
        .sheet(isPresented: $givingRest) {
            RestDaySheet(clientId: clientId, firstName: firstName) { await load() }
                .presentationDetents([.medium])
        }
        .errorAlert($actionError)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            HStack(spacing: JK.Space.m) {
                Avatar(initials: detail?.client.displayInitials ?? Fmt.initials(name), size: JK.Size.avatar + JK.Space.m)
                VStack(alignment: .leading, spacing: 2) {
                    Text(fullName).font(.jkHeadline).foregroundStyle(JK.text)
                    Text(subtitle).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            if !pills.isEmpty {
                HStack(spacing: JK.Space.s) {
                    ForEach(pills, id: \.text) { pill in StatusPill(text: pill.text, tone: pill.tone) }
                }
            }
        }
    }

    private var subtitle: String {
        guard let c = detail?.client else { return " " }
        var parts = [Fmt.planName(c.plan)]
        if let since = c.since, let d = Day.date(since) { parts.append("since \(Fmt.monthYear(d))") }
        return parts.joined(separator: " · ")
    }

    /// At most two: a word plus a dot.
    private var pills: [(text: String, tone: StatusPill.Tone)] {
        guard let d = detail else { return [] }
        var out: [(text: String, tone: StatusPill.Tone)] = []
        let check = d.latestCheckin
        if let pain = check?.pain, !pain.isEmpty, check?.reviewedAt == nil { out.append((text: "Pain flagged", tone: .urgent)) }
        else if !(d.client.demand?.urgent ?? []).isEmpty { out.append((text: "Needs you", tone: .urgent)) }
        if check != nil, check?.reviewedAt == nil { out.append((text: "Check-in in", tone: .attention)) }
        if (d.client.unread ?? 0) > 0 { out.append((text: "Message in", tone: .attention)) }
        if d.client.demand?.kind == "quiet" || d.client.demand?.kind == "inactive" { out.append((text: "Gone quiet", tone: .neutral)) }
        if out.isEmpty { out.append((text: "On track", tone: .onTrack)) }
        return Array(out.prefix(2))
    }

    // MARK: Habits and rest days

    private var habitSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            CoachSectionTitle("Habit week", trailing: minimumLine)
            if let history {
                HabitWeekGrid(history: history, restDays: detail?.restDays ?? [])
            } else {
                Text("Habit week unavailable.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            restDayList
            HStack(spacing: JK.Space.s) {
                NavigationLink {
                    CoachSubpage(title: "Habits") {
                        CoachHabitsTab(clientId: clientId, dayMinimum: detail?.settings?.dayMinimum)
                    }
                } label: { Text("Edit habits") }
                    .buttonStyle(SecondaryButtonStyle())
                Button("Give a rest day") { givingRest = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    private var minimumLine: String? {
        guard let m = detail?.settings?.dayMinimum, let count = history?.habits.count, count > 0 else { return nil }
        return "Day done at \(m) of \(count)"
    }

    @ViewBuilder
    private var restDayList: some View {
        let upcoming = (detail?.restDays ?? []).filter { $0.date >= Day.today }
        if !upcoming.isEmpty {
            VStack(spacing: 0) {
                ForEach(upcoming) { rest in
                    HStack {
                        CoachRowLabel(icon: .rest, title: Fmt.longDay(rest.date), detail: rest.reason, chevron: false)
                        Button("Remove") { Task { await removeRest(rest) } }
                            .buttonStyle(TextButtonStyle())
                            .padding(.trailing, JK.Space.m)
                            .accessibilityLabel("Remove the rest day on \(Fmt.longDay(rest.date))")
                    }
                }
            }
            .surface(.group)
        }
    }

    // MARK: Check-in and letter

    @ViewBuilder
    private var checkinSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            CoachSectionTitle("Latest check-in", trailing: detail?.latestCheckin?.submittedAt.map { Fmt.relative($0) })
            if let c = detail?.latestCheckin {
                LatestCheckInCard(checkin: c)
            } else {
                Text("No check-in yet.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if lettersOn {
                NavigationLink { LetterComposer(client: person, week: detail?.latestCheckin?.week?.week) } label: {
                    Text("Write this week's letter")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    @ViewBuilder
    private var nextSection: some View {
        if let b = detail?.nextBooking {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                CoachSectionTitle("Next session")
                DayAgendaRow(booking: b).surface(.group)
                Text(Fmt.longDay(b.start)).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
    }

    // MARK: Health

    @ViewBuilder
    private var healthSection: some View {
        if let h = health {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                CoachSectionTitle("Health", trailing: h.shared ? "Last 7 days" : nil)
                if h.shared {
                    HStack(alignment: .top, spacing: JK.Space.m) {
                        healthTile("Steps", h.days.last?.steps.map { Fmt.number($0, digits: 0) }, h.days.map(\.steps))
                        healthTile("Sleep", h.days.last?.sleepMinutes.map { Fmt.minutes($0) }, h.days.map(\.sleepMinutes))
                        healthTile("Resting HR", h.days.last?.restingHr.map { Fmt.number($0, digits: 0) }, h.days.map(\.restingHr))
                    }
                } else {
                    Text("\(firstName) hasn't shared Apple Health with you.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
        }
    }

    private func healthTile(_ label: String, _ value: String?, _ series: [Double?]) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Text(label).font(.jkCaption).foregroundStyle(JK.textSecondary)
            Text(value ?? "–").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                .lineLimit(1).minimumScaleFactor(0.7)
            Sparkline(values: series).frame(height: 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surface(.card, padding: JK.Space.m)
        .accessibilityElement(children: .combine)
    }

    // MARK: Links

    private var links: some View {
        VStack(spacing: 0) {
            NavigationLink {
                CoachSubpage(title: "Plan") { CoachPlanTab(clientId: clientId, clientName: fullName) }
            } label: { CoachRowLabel(icon: .workout, title: "Plan", detail: "This week, swap an exercise, add a note") }
            GroupDivider()
            NavigationLink {
                CoachSubpage(title: "Sessions") { CoachSessionsTab(client: person) }
            } label: { CoachRowLabel(icon: .week, title: "Sessions") }
            GroupDivider()
            NavigationLink {
                CoachSubpage(title: "Letters") {
                    CoachReportsSection(clientId: clientId, clientName: firstName, client: person)
                    CoachSectionTitle("Check-ins")
                    CoachNotesTab(clientId: clientId)
                }
            } label: { CoachRowLabel(icon: .letter, title: "Letters and check-ins") }
            GroupDivider()
            NavigationLink {
                CoachSubpage(title: "Programme and forms") { ClientAutomationSection(client: person) }
            } label: { CoachRowLabel(icon: .form, title: "Assign programme, send a form, read answers") }
            GroupDivider()
            NavigationLink {
                CoachSubpage(title: "Health") { CoachHealthTab(clientId: clientId, clientName: firstName) }
            } label: { CoachRowLabel(icon: .fromHealth, title: "Health detail") }
            if let profile = detail?.profile, !profile.isEmpty {
                GroupDivider()
                NavigationLink {
                    CoachSubpage(title: "About \(firstName)") { ClientAboutCard(profile: profile) }
                } label: { CoachRowLabel(icon: .clients, title: "First-run answers") }
            }
        }
        .buttonStyle(.plain)
        .surface(.group)
    }

    // MARK: Loading

    private func load() async {
        let week = Day.add(-6, to: Date())
        async let d: ClientDetail = APIClient.shared.get("/api/coach/clients/\(seg(clientId))")
        async let h: HabitHistory = APIClient.shared.get("/api/habits/history", query: [
            "clientId": clientId, "from": Day.string(week), "to": Day.today,
        ])
        async let w: HealthWeek = APIClient.shared.get("/api/health/week", query: ["clientId": clientId])
        do {
            detail = try await d
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
        history = try? await h
        health = try? await w
    }

    private func removeRest(_ rest: RestDay) async {
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/clients/\(seg(clientId))/rest-days/\(seg(rest.date))")
            await load()
        } catch {
            actionError = error.readable
        }
    }
}

/// The latest check-in, read-only: the reply arrives as the letter.
struct LatestCheckInCard: View {
    let checkin: LatestCheckIn

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text(figures).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
            if let pain = checkin.pain, !pain.isEmpty { line("Pain", pain.joined(separator: ", ")) }
            if let win = checkin.win, !win.isEmpty { line("Win", win) }
            if let struggle = checkin.struggle, !struggle.isEmpty { line("Struggle", struggle) }
            if let note = checkin.note, !note.isEmpty { line("Note", note) }
            ForEach(Array((checkin.week?.feel ?? []).enumerated()), id: \.offset) { _, f in
                Text([f.title, f.word ?? Feel.word(f.feel)].compactMap { $0 }.joined(separator: " · "))
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if let photos = checkin.photoIds, !photos.isEmpty {
                Text(photos.count == 1 ? "1 photo" : "\(photos.count) photos").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .surface(.card)
        .accessibilityElement(children: .combine)
    }

    private var figures: String {
        var parts: [String] = []
        if let e = checkin.energy { parts.append("Energy \(e)") }
        if let s = checkin.stress { parts.append("Stress \(s)") }
        if let s = checkin.sleep { parts.append("Sleep \(s)") }
        return parts.isEmpty ? "Checked in" : parts.joined(separator: " · ")
    }

    private func line(_ label: String, _ text: String) -> some View {
        (Text("\(label): ").foregroundColor(JK.textSecondary) + Text(text).foregroundColor(JK.text))
            .font(.jkCaption)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Goal editor

/// Edit the goal in place, or set it from a draft. JK writes the chapter name.
struct GoalEditorSheet: View {
    let clientId: String
    let goal: Goal?
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var metric = "weight"
    @State private var unit = "kg"
    @State private var baseline = ""
    @State private var target = ""
    @State private var hasDate = true
    @State private var targetDate = Day.add(84, to: Date())
    @State private var chapter = ""
    @State private var saving = false
    @State private var error: String?

    private static let metrics: [(id: String, name: String)] = [
        ("weight", "Weight"), ("waist", "Waist"), ("measurement", "Measurement"), ("record", "Lift"), ("habit", "Habit"), ("custom", "Other"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.m) {
                    if let suggestion = goal?.suggestion, goal?.isDraft == true {
                        Text("Suggested from onboarding: \(suggestion).").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    JKField(label: "The goal, in their words", text: $title, prompt: "Down to 75 kg by March")
                    Picker("Measured by", selection: $metric) {
                        ForEach(Self.metrics, id: \.id) { m in Text(m.name).tag(m.id) }
                    }
                    .pickerStyle(.menu)
                    .font(.jkCallout)
                    HStack(spacing: JK.Space.s) {
                        JKField(label: "Start", text: $baseline, prompt: "84.6", keyboard: .decimalPad)
                        JKField(label: "Target", text: $target, prompt: "75", keyboard: .decimalPad)
                        JKField(label: "Unit", text: $unit, prompt: "kg")
                    }
                    Toggle("Target date", isOn: $hasDate).tint(JK.accentControl).font(.jkCallout)
                    if hasDate {
                        DatePicker("By", selection: $targetDate, in: Date()..., displayedComponents: .date)
                            .font(.jkCallout)
                    }
                    JKField(label: "Chapter name (optional, shown on Progress)", text: $chapter, prompt: "Base building")
                    if let error { ErrorBanner(message: error) }
                    PrimaryButton(goal == nil || goal?.isDraft == true ? "Set the goal" : "Save goal", busy: saving) {
                        Task { await save() }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    Text("Metrics tied to a lift or a habit are linked on the web desk.")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                .padding(JK.Space.gutter)
            }
            .jkScreen()
            .navigationTitle("Goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear(perform: fill)
        }
    }

    private func fill() {
        guard let goal else { return }
        title = goal.title
        metric = goal.metric
        unit = goal.unit ?? ""
        baseline = goal.baseline.map { Fmt.number($0, digits: 2) } ?? ""
        target = goal.target.map { Fmt.number($0, digits: 2) } ?? ""
        chapter = goal.chapterName ?? ""
        if let d = goal.targetDate.flatMap(Day.date) { targetDate = d } else { hasDate = goal.targetDate != nil }
    }

    private func number(_ text: String) -> Double? { parseNumber(text.replacingOccurrences(of: ",", with: "")) }

    private func save() async {
        saving = true
        defer { saving = false }
        let input = GoalInput(clientId: goal == nil ? clientId : nil, title: title.trimmingCharacters(in: .whitespaces),
                              metric: metric, unit: unit.isEmpty ? nil : unit, baseline: number(baseline), target: number(target),
                              startDate: goal?.startDate ?? Day.today, targetDate: hasDate ? Day.string(targetDate) : nil,
                              chapterName: chapter.trimmingCharacters(in: .whitespaces).isEmpty ? nil : chapter,
                              status: goal == nil || goal?.isDraft == true ? "active" : nil)
        do {
            if let id = goal?.id {
                let _: Goal = try await APIClient.shared.send("PATCH", "/api/goals/\(seg(id))", body: input)
            } else {
                let _: Goal = try await APIClient.shared.send("POST", "/api/goals", body: input)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Rest day

/// Give a rest day: neither done nor missed.
struct RestDaySheet: View {
    let clientId: String
    let firstName: String
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var reason = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                DatePicker("Day", selection: $date, in: Day.add(-7, to: Date())..., displayedComponents: .date)
                    .font(.jkCallout)
                JKField(label: "Reason (optional)", text: $reason, prompt: "Travelling for work")
                Text("The day counts as neither done nor missed for \(firstName).")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
                if let error { ErrorBanner(message: error) }
                PrimaryButton("Give the day off", busy: saving) { Task { await save() } }
                Spacer()
            }
            .padding(JK.Space.gutter)
            .jkScreen()
            .navigationTitle("Rest day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let text = reason.trimmingCharacters(in: .whitespaces)
        do {
            let _: RestDay = try await APIClient.shared.send("POST", "/api/clients/\(seg(clientId))/rest-days",
                                                             body: RestDayInput(date: Day.string(date), reason: text.isEmpty ? nil : text))
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Plan tab

private struct WorkoutDraft: Equatable {
    var id: String?
    var date: String
    var title = ""
    var startsAt = ""
    var location = ""
    var notes = ""
    var items: [WorkoutItemInput] = []
    var published = false
    var editedBy: String?
    var editedAt: Date?
    var completedAt: Date?
    var loggedSets = 0

    init(date: String) { self.date = date }

    init(_ w: Workout) {
        id = w.id
        date = w.date
        title = w.title
        startsAt = w.startsAt ?? ""
        location = w.location ?? ""
        notes = w.notes ?? ""
        items = w.items.sorted { $0.order < $1.order }.map { WorkoutItemInput(from: $0) }
        published = w.published
        editedBy = w.editedBy
        editedAt = w.editedAt
        completedAt = w.completedAt
        loggedSets = w.items.reduce(0) { $0 + $1.logged.count }
    }

    func input(clientId: String) -> WorkoutInput {
        WorkoutInput(date: date, title: title.trimmingCharacters(in: .whitespaces),
                     startsAt: startsAt.isEmpty ? nil : startsAt, location: location.isEmpty ? nil : location,
                     notes: notes, items: items, clientId: id == nil ? clientId : nil)
    }
}

private struct CoachPlanTab: View {
    let clientId: String
    let clientName: String
    @State private var day = Day.start(Date())
    @State private var week: [WorkoutSummary]?
    @State private var draft: WorkoutDraft?
    @State private var saved: WorkoutDraft?
    @State private var error: String?
    @State private var busy = false
    @State private var picking = false
    @State private var confirmDelete = false
    @State private var notice: String?

    private var api: APIClient { APIClient.shared }
    private var dayWorkouts: [WorkoutSummary] { (week ?? []).filter { $0.date == Day.string(day) } }

    var body: some View {
        HStack {
            Button { day = Day.add(-7, to: day) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text("Week of \(Fmt.dayMonth(Day.weekStart(day)))").font(.jkCaption).foregroundStyle(JK.textSecondary)
            Spacer()
            Button { day = Day.add(7, to: day) } label: { Image(systemName: "chevron.right") }
        }
        .foregroundStyle(JK.textSecondary)
        DayStrip(days: Day.week(of: day), selected: $day, marked: Set((week ?? []).map(\.date)))

        if let error, week == nil {
            ErrorCard(message: error) { await loadWeek() }
        } else if week == nil {
            LoadingCard()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(dayWorkouts) { w in
                        Chip(label: w.published ? w.title : "\(w.title) · draft", selected: draft?.id == w.id) {
                            Task { await open(w.id) }
                        }
                    }
                    Chip(label: "+ New workout", selected: draft != nil && draft?.id == nil) {
                        draft = WorkoutDraft(date: Day.string(day))
                        saved = nil
                    }
                }
            }
            if let draft { editor(draft) } else if dayWorkouts.isEmpty {
                EmptyCard(systemName: "calendar.badge.plus", title: "Nothing planned for \(Fmt.shortDay(day))",
                          detail: "Tap “+ New workout” to write one for \(clientName).")
            }
        }
        EmptyView()
            .task(id: Day.string(Day.weekStart(day))) { await loadWeek() }
            .onChange(of: day) { _, _ in
                if let id = dayWorkouts.first?.id { Task { await open(id) } } else { draft = nil; saved = nil }
            }
            .sheet(isPresented: $picking) {
                ExercisePickerSheet { exercise in
                    draft?.items.append(WorkoutItemInput(exerciseId: exercise.id, exerciseName: exercise.name))
                }
            }
            .confirmationDialog("Delete this workout?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete workout", role: .destructive) { Task { await deleteWorkout() } }
            }
    }

    @ViewBuilder
    private func editor(_ current: WorkoutDraft) -> some View {
        let binding = Binding<WorkoutDraft>(get: { draft ?? current }, set: { draft = $0 })
        VStack(alignment: .leading, spacing: 2) {
            Text("\(Fmt.weekday(Day.date(current.date) ?? day)) · \(current.title.isEmpty ? "New workout" : current.title)")
                .font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
            Text(statusLine(current)).font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        VStack(alignment: .leading, spacing: 8) {
            JKField(label: "Title", text: binding.title, prompt: "Lower Body Strength")
            HStack(spacing: 8) {
                JKField(label: "Starts (HH:mm)", text: binding.startsAt, prompt: "11:00", keyboard: .numbersAndPunctuation)
                JKField(label: "Location", text: binding.location, prompt: "Studio 2")
            }
            JKField(label: "Notes for the client", text: binding.notes, prompt: "Optional")
        }
        .jkCard()
        ItemsEditor(items: binding.items)
        Button { picking = true } label: {
            Label("Add exercise from the library", systemImage: "plus")
                .font(.jkCaption)
                .foregroundStyle(JK.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(RoundedRectangle(cornerRadius: JK.Radius.card).strokeBorder(JK.hairline, style: StrokeStyle(lineWidth: 1, dash: [4])))
        }
        if let notice { Label(notice, systemImage: "checkmark.circle").font(.jkCaption).foregroundStyle(JK.textSecondary) }
        if let error { ErrorBanner(message: error) }
        HStack(spacing: 10) {
            Button("Save") { Task { await save(publish: false) } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy || !valid(current) || (current == saved))
            Button {
                Task { await save(publish: true) }
            } label: {
                if busy { ProgressView().tint(JK.onPrimary) } else {
                    Text(current.published && current == saved ? "Published" : "Publish to \(clientName.split(separator: " ").first.map(String.init) ?? clientName)")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !valid(current) || (current.published && current == saved))
        }
        if current.id != nil {
            Button("Delete workout", role: .destructive) { confirmDelete = true }
                .font(.jkCaption)
                .frame(maxWidth: .infinity)
        }
    }

    private func valid(_ d: WorkoutDraft) -> Bool {
        !d.title.trimmingCharacters(in: .whitespaces).isEmpty && !d.items.isEmpty
    }

    private func statusLine(_ d: WorkoutDraft) -> String {
        var parts: [String] = []
        if d.id == nil { parts.append("Not saved yet") } else { parts.append(d.published ? "Published" : "Draft · the client can't see it") }
        if let at = d.editedAt { parts.append("last edit by \(d.editedBy == "coach" ? "you" : clientName) \(Fmt.relative(at))") }
        if d.loggedSets > 0 { parts.append("\(d.loggedSets) sets logged") }
        if d.completedAt != nil { parts.append("completed") }
        return parts.joined(separator: " · ")
    }

    private func loadWeek() async {
        let days = Day.week(of: day)
        do {
            let reply: WorkoutsResponse = try await api.get("/api/workouts", query: [
                "clientId": clientId, "from": Day.string(days[0]), "to": Day.string(days[6]),
            ])
            week = reply.workouts
            error = nil
            if draft == nil || draft?.date != Day.string(day), let first = dayWorkouts.first {
                await open(first.id)
            }
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func open(_ id: String) async {
        do {
            let w: Workout = try await api.get("/api/workouts/\(seg(id))")
            draft = WorkoutDraft(w)
            saved = draft
            notice = nil
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    /// Save = PUT (or POST for a new one); Publish = save, then POST publish.
    private func save(publish: Bool) async {
        guard let current = draft else { return }
        busy = true
        defer { busy = false }
        do {
            var w: Workout
            if current != saved || current.id == nil {
                if let id = current.id {
                    w = try await api.send("PUT", "/api/workouts/\(seg(id))", body: current.input(clientId: clientId))
                } else {
                    w = try await api.send("POST", "/api/workouts", body: current.input(clientId: clientId))
                }
            } else {
                w = try await api.get("/api/workouts/\(seg(current.id ?? ""))")
            }
            if publish && !w.published {
                w = try await api.send("POST", "/api/workouts/\(seg(w.id))/publish")
            }
            draft = WorkoutDraft(w)
            saved = draft
            notice = publish ? "Published. \(clientName) can see it now." : (w.published ? "Saved. The client sees the change." : "Saved as a draft.")
            error = nil
            await refreshWeekQuietly()
        } catch {
            self.error = error.readable
        }
    }

    private func refreshWeekQuietly() async {
        let days = Day.week(of: day)
        if let reply: WorkoutsResponse = try? await api.get("/api/workouts", query: [
            "clientId": clientId, "from": Day.string(days[0]), "to": Day.string(days[6]),
        ]) { week = reply.workouts }
    }

    private func deleteWorkout() async {
        guard let id = draft?.id else { return }
        do {
            let _: OK = try await api.send("DELETE", "/api/workouts/\(seg(id))")
            draft = nil
            saved = nil
            await refreshWeekQuietly()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Habits tab

private struct CoachHabitsTab: View {
    let clientId: String
    var dayMinimum: Int? = nil
    @State private var minimum = 3
    @State private var savingMinimum = false
    @State private var data: HabitsResponse?
    @State private var error: String?
    @State private var actionError: String?
    @State private var adding = false
    @State private var kcal = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var savingTargets = false
    @State private var notice: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        Loadable(value: data, error: error, retry: load) { d in
            CoachSectionTitle("Daily habits", trailing: "\(d.habits.count) of 5")
            if d.habits.isEmpty {
                EmptyCard(systemName: "checklist", title: "No habits set")
            } else {
                VStack(spacing: 0) {
                    ForEach(d.habits) { h in
                        HStack(spacing: 12) {
                            Icon(key: h.key).foregroundStyle(JK.textSecondary).frame(width: 32)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(h.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                                Text(h.isCount ? "\(Fmt.number(h.value ?? 0)) / \(Fmt.number(h.target)) \(h.unit) today" : (h.done ? "Done today" : "Not done today"))
                                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
                            }
                            Spacer()
                            Button(role: .destructive) { Task { await remove(h) } } label: { Image(systemName: "trash") }
                                .buttonStyle(.plain)
                                .foregroundStyle(JK.textTertiary)
                        }
                        .padding(10)
                    }
                }
                .jkCard(padding: 2)
            }
            Button { adding = true } label: { Label("Add habit", systemImage: "plus") }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(d.habits.count >= 5)
            if d.habits.count >= 5 {
                Text("Five habits is the most a client carries. Remove one to add another.")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if !d.habits.isEmpty { minimumCard(count: d.habits.count) }

            Eyebrow(text: "Nutrition targets", trailing: "Today \(Fmt.number(d.nutrition.totals.kcal, digits: 0)) kcal logged")
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    JKField(label: "kcal", text: $kcal, prompt: "2500", keyboard: .numberPad)
                    JKField(label: "Protein g", text: $protein, prompt: "170", keyboard: .numberPad)
                }
                HStack(spacing: 8) {
                    JKField(label: "Carbs g", text: $carbs, prompt: "260", keyboard: .numberPad)
                    JKField(label: "Fat g", text: $fat, prompt: "80", keyboard: .numberPad)
                }
                if let notice { Text(notice).font(.jkCaption).foregroundStyle(JK.textSecondary) }
                Button {
                    Task { await saveTargets() }
                } label: {
                    if savingTargets { ProgressView().tint(JK.onPrimary) } else { Text("Save targets") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(savingTargets || [kcal, protein, carbs, fat].contains { parseNumber($0) == nil })
            }
            .jkCard()
        }
        EmptyView()
            .task { await load() }
            .sheet(isPresented: $adding) {
                AddHabitSheet(clientId: clientId) { await load() }
            }
            .errorAlert($actionError)
    }

    private func minimumCard(count: Int) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Stepper(value: $minimum, in: 1...max(1, count)) {
                Text("A day is done at \(min(minimum, count)) of \(count)").font(.jkCallout).foregroundStyle(JK.text)
            }
            Text("The day minimum. The default is three in five.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            Button("Save minimum") { Task { await saveMinimum() } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(savingMinimum)
        }
        .surface(.card)
    }

    private func saveMinimum() async {
        savingMinimum = true
        defer { savingMinimum = false }
        do {
            let fresh: ClientSettings = try await api.send("PATCH", "/api/coach/clients/\(seg(clientId))/settings",
                                                           body: ClientSettingsPatch(dayMinimum: minimum, letterRhythm: nil))
            minimum = fresh.dayMinimum ?? minimum
            notice = "Day minimum saved."
        } catch {
            actionError = error.readable
        }
    }

    private func load() async {
        do {
            let d: HabitsResponse = try await api.get("/api/habits", query: ["clientId": clientId, "date": Day.today])
            data = d
            minimum = d.dayMinimum ?? dayMinimum ?? minimum
            error = nil
            if let t = d.nutrition.targets {
                kcal = Fmt.number(t.kcal, digits: 0).replacingOccurrences(of: ",", with: "")
                protein = Fmt.number(t.protein, digits: 0).replacingOccurrences(of: ",", with: "")
                carbs = Fmt.number(t.carbs, digits: 0).replacingOccurrences(of: ",", with: "")
                fat = Fmt.number(t.fat, digits: 0).replacingOccurrences(of: ",", with: "")
            }
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func remove(_ h: Habit) async {
        do {
            let _: OK = try await api.send("DELETE", "/api/habits/\(seg(h.id))")
            await load()
        } catch {
            actionError = error.readable
        }
    }

    private func saveTargets() async {
        guard let k = parseNumber(kcal), let p = parseNumber(protein), let c = parseNumber(carbs), let f = parseNumber(fat) else { return }
        savingTargets = true
        defer { savingTargets = false }
        do {
            let _: Nutrition = try await api.send("PUT", "/api/nutrition/targets",
                                                  body: TargetsInput(clientId: clientId, kcal: k, protein: p, carbs: c, fat: f))
            notice = "Targets saved."
        } catch {
            actionError = error.readable
        }
    }
}

private struct AddHabitSheet: View {
    let clientId: String
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind = "check"
    @State private var target = "1"
    @State private var unit = ""
    @State private var icon: IconKey = .custom
    @State private var step = ""
    @State private var healthKind = "none"
    @State private var saving = false
    @State private var error: String?

    /// The closed catalogue the server accepts.
    private let icons: [IconKey] = [.water, .sleep, .steps, .protein, .supplement, .energy, .mobility, .mindfulness, .reading, .sunlight, .custom]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    JKField(label: "Name", text: $name, prompt: "Water")
                    Segmented(options: ["check", "count"], selection: $kind) { $0 == "check" ? "Tick off" : "Count to a target" }
                    if kind == "count" || healthKind != "none" {
                        HStack(spacing: 8) {
                            JKField(label: "Target", text: $target, prompt: "3", keyboard: .decimalPad)
                            JKField(label: "Unit", text: $unit, prompt: "L")
                            JKField(label: "Step", text: $step, prompt: "0.5", keyboard: .decimalPad)
                        }
                    }
                    Eyebrow(text: "Icon")
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 8) {
                        ForEach(icons, id: \.self) { i in
                            Button { icon = i } label: {
                                Icon(key: i, filled: icon == i, size: JK.Size.iconHabit)
                                    .foregroundStyle(icon == i ? JK.text : JK.textSecondary)
                                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.control).stroke(icon == i ? JK.inputBorder : Color.clear, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(i.accessibilityName)
                            .accessibilityAddTraits(icon == i ? .isSelected : [])
                        }
                    }
                    Eyebrow(text: "Fill from Apple Health")
                    Segmented(options: ["none", "steps", "sleep"], selection: $healthKind) {
                        $0 == "none" ? "None" : $0 == "steps" ? "Steps" : "Sleep"
                    }
                    if healthKind != "none" {
                        Text("Filled from the client's Apple Health and done once the value reaches the target.")
                            .font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text("Add habit") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || (kind == "count" && parseNumber(target) == nil))
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("New habit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onChange(of: healthKind) { _, hk in
                switch hk {
                case "sleep":
                    kind = "check"; target = "7"; unit = "h"; icon = .sleep
                    if name.isEmpty { name = "Sleep 7h+" }
                case "steps":
                    kind = "count"; target = "10000"; unit = "steps"; icon = .steps; step = "1000"
                    if name.isEmpty { name = "Steps" }
                default: break
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        // A health habit keeps its target whatever the kind ("Sleep 7h+" is check, 7 h).
        let fromHealth = healthKind != "none"
        let input = HabitEdit(clientId: clientId, name: name.trimmingCharacters(in: .whitespaces), kind: kind,
                              target: (kind == "count" || fromHealth) ? (parseNumber(target) ?? 1) : 1,
                              unit: (kind == "count" || fromHealth) ? unit : "", iconKey: icon.rawValue, icon: icon.symbol,
                              step: kind == "count" ? parseNumber(step) : nil,
                              healthKind: fromHealth ? healthKind : nil)
        do {
            let _: Habit = try await APIClient.shared.send("POST", "/api/habits", body: input)
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Sessions tab

private struct CoachSessionsTab: View {
    let client: PersonRef
    @State private var bookings: [Booking]?
    @State private var error: String?

    var body: some View {
        Loadable(value: bookings, error: error, retry: load) { list in
            let upcoming = list.filter { $0.end >= Date() }.sorted { $0.start < $1.start }
            let past = list.filter { $0.end < Date() }.sorted { $0.start > $1.start }
            Eyebrow(text: "Upcoming")
            if upcoming.isEmpty { Text("Nothing booked.").font(.jkCaption).foregroundStyle(JK.textTertiary) }
            ForEach(upcoming) { b in row(b) }
            NavigationLink { BookSessionView(client: client) } label: {
                Label("Book a session for \(client.name)", systemImage: "plus")
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.card).strokeBorder(JK.hairline, style: StrokeStyle(lineWidth: 1, dash: [4])))
            }
            if !past.isEmpty {
                Eyebrow(text: "Past 30 days")
                ForEach(past) { b in row(b) }
            }
        }
        EmptyView().task { await load() }
    }

    private func row(_ b: Booking) -> some View {
        NavigationLink { ClassDetailView(booking: b) } label: {
            UpcomingRow(weekday: Fmt.weekday(b.start), day: "\(Day.calendar.component(.day, from: b.start))",
                        title: b.title ?? b.kindLabel,
                        detail: ["\(Fmt.time(b.start))–\(Fmt.time(b.end))", b.kindLabel, b.location].compactMap { $0 }.joined(separator: " · "))
                .jkCard(padding: 0)
        }
    }

    private func load() async {
        do {
            let reply: BookingsResponse = try await APIClient.shared.get("/api/bookings", query: [
                "clientId": client.id,
                "from": Day.string(Day.add(-30, to: Date())),
                "to": Day.string(Day.add(60, to: Date())),
            ])
            bookings = reply.bookings.filter { $0.client?.id == client.id || ($0.attendees ?? []).contains { $0.id == client.id } || $0.client == nil }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

// MARK: - Notes tab

private struct CoachNotesTab: View {
    let clientId: String
    @State private var checkins: [CheckIn]?
    @State private var error: String?

    var body: some View {
        Loadable(value: checkins, error: error, retry: load) { list in
            if list.isEmpty {
                Text("No check-ins yet.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            ForEach(list) { c in
                VStack(alignment: .leading, spacing: JK.Space.s) {
                    HStack {
                        Text("Week of \(Fmt.dayMonth(c.week))").font(.jkCallout).foregroundStyle(JK.text)
                        Spacer()
                        if c.reviewedAt != nil {
                            Text("Answered").font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                    }
                    Text(figures(c)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    ForEach(lines(c), id: \.self) { line in
                        Text(line).font(.jkCaption).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                    }
                    if let reply = c.reply, !reply.isEmpty {
                        Text("Your reply: \(reply)").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                }
                .surface(.card)
            }
        }
        EmptyView()
            .task { await load() }
    }

    private func figures(_ c: CheckIn) -> String {
        var parts = ["Energy \(c.energy)"]
        if let stress = c.stress { parts.append("Stress \(stress)") }
        parts.append("Sleep \(c.sleep)")
        parts.append(c.pain.isEmpty ? "No pain" : "Pain: \(c.pain.joined(separator: ", "))")
        return parts.joined(separator: " · ")
    }

    private func lines(_ c: CheckIn) -> [String] {
        [c.win.map { "Win: \($0)" }, c.struggle.map { "Struggle: \($0)" }, c.note]
            .compactMap { $0 }.filter { !$0.isEmpty }
    }

    private func load() async {
        do {
            let reply: CheckInsResponse = try await APIClient.shared.get("/api/checkins", query: ["clientId": clientId])
            checkins = reply.checkins.sorted { $0.week > $1.week }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}
