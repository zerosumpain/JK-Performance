import SwiftUI

/// One client, for the coach: header from the summary, then Plan (edit and
/// publish workouts), Feedback (weekly write-ups and check-in replies),
/// Health (Apple Health, if shared), Habits (habits and nutrition targets)
/// and Sessions (their bookings).
struct ClientDetailView: View {
    enum Tab: String, CaseIterable { case plan = "Plan", feedback = "Feedback", health = "Health", habits = "Habits", sessions = "Sessions" }

    let clientId: String
    let name: String
    @State private var tab: Tab

    init(clientId: String, name: String, initialTab: Tab = .plan) {
        self.clientId = clientId
        self.name = name
        _tab = State(initialValue: initialTab)
    }
    @State private var detail: ClientDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let detail { ClientAboutCard(profile: detail.profile) }
                Segmented(options: Tab.allCases, selection: $tab) { $0.rawValue }
                switch tab {
                case .plan: CoachPlanTab(clientId: clientId, clientName: detail?.client.name ?? name)
                case .feedback:
                    CoachReportsSection(clientId: clientId, clientName: firstName)
                    Eyebrow(text: "Check-ins")
                    CoachNotesTab(clientId: clientId)
                    ClientAutomationSection(client: PersonRef(id: clientId, name: detail?.client.name ?? name))
                case .health: CoachHealthTab(clientId: clientId, clientName: firstName)
                case .habits: CoachHabitsTab(clientId: clientId)
                case .sessions: CoachSessionsTab(client: PersonRef(id: clientId, name: detail?.client.name ?? name))
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Clients")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    MessagesThreadView(clientId: clientId, otherName: detail?.client.name ?? name, subtitle: "Client")
                } label: { Image(systemName: "bubble.left") }
            }
        }
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Avatar(initials: detail?.client.displayInitials ?? Fmt.initials(name), size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(detail?.client.name ?? name).font(.jkDisplay).foregroundStyle(JK.text)
                    Text(subtitle).font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
            }
            if let error { ErrorBanner(message: error) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chips, id: \.self) { t in
                        Text(t)
                            .font(.jkMicro.weight(.medium))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
                            .foregroundStyle(JK.textSecondary)
                    }
                }
            }
        }
    }

    private var firstName: String {
        let full = detail?.client.name ?? name
        return full.split(separator: " ").first.map(String.init) ?? full
    }

    private var subtitle: String {
        guard let c = detail?.client else { return " " }
        var parts = [Fmt.planName(c.plan)]
        if let since = c.since, let d = Day.date(since) { parts.append("since \(Fmt.monthYear(d))") }
        return parts.joined(separator: " · ")
    }

    private var chips: [String] {
        guard let d = detail else { return [] }
        var out: [String] = []
        for reason in d.client.demand?.urgent ?? [] { out.append("⚠︎ \(reason)") }
        if let a = d.client.adherence { out.append("Adherence \(a)%") }
        out += (d.client.flags ?? []).map { ClientText.flag($0).prefix(1).uppercased() + ClientText.flag($0).dropFirst() }
        if d.client.checkinDue == true { out.append("Check-in due") }
        if d.healthShared == false { out.append("Health not shared") }
        if let h = d.health {
            if let steps = h.steps { out.append("\(Fmt.number(steps, digits: 0)) steps") }
            if let sleep = h.sleepMinutes { out.append("Slept \(Fmt.minutes(sleep))") }
            if let hr = h.restingHr { out.append("RHR \(Fmt.number(hr, digits: 0))") }
        }
        if let next = d.nextWorkout { out.append("Next: \(next.title) \(Fmt.dayMonth(next.date))") }
        return out
    }

    private func load() async {
        do {
            detail = try await APIClient.shared.get("/api/coach/clients/\(seg(clientId))")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
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
            Eyebrow(text: "Daily habits", trailing: "\(d.streak)-day streak")
            if d.habits.isEmpty {
                EmptyCard(systemName: "checklist", title: "No habits set")
            } else {
                VStack(spacing: 0) {
                    ForEach(d.habits) { h in
                        HStack(spacing: 12) {
                            Glyph(systemName: symbol(h.icon), size: 32)
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

    private func load() async {
        do {
            let d: HabitsResponse = try await api.get("/api/habits", query: ["clientId": clientId, "date": Day.today])
            data = d
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
    @State private var icon = "checkmark.circle"
    @State private var healthKind = "none"
    @State private var saving = false
    @State private var error: String?

    private let icons = ["checkmark.circle", "drop", "moon", "shoeprints.fill", "bolt", "leaf", "figure.walk", "pills", "book", "fork.knife"]

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
                        }
                    }
                    Eyebrow(text: "Icon")
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 8) {
                        ForEach(icons, id: \.self) { i in
                            Button { icon = i } label: {
                                Glyph(systemName: i, size: 40)
                                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.control).stroke(icon == i ? JK.text : .clear, lineWidth: 1.5))
                            }
                            .buttonStyle(.plain)
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
                    kind = "check"; target = "7"; unit = "h"; icon = "moon"
                    if name.isEmpty { name = "Sleep 7h+" }
                case "steps":
                    kind = "count"; target = "10000"; unit = "steps"; icon = "shoeprints.fill"
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
        let input = HabitInput(clientId: clientId, name: name.trimmingCharacters(in: .whitespaces), kind: kind,
                               target: (kind == "count" || fromHealth) ? (parseNumber(target) ?? 1) : 1,
                               unit: (kind == "count" || fromHealth) ? unit : "", icon: icon,
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
    @State private var replies: [String: String] = [:]
    @State private var sending: String?
    @State private var actionError: String?

    var body: some View {
        Loadable(value: checkins, error: error, retry: load) { list in
            if list.isEmpty {
                EmptyCard(systemName: "doc.text", title: "No check-ins yet")
            }
            ForEach(list) { c in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Week of \(Fmt.dayMonth(c.week))").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                        Spacer()
                        if c.reviewedAt != nil {
                            Label("Reviewed", systemImage: "checkmark").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                    }
                    HStack(spacing: 8) {
                        StatTile(label: "Energy", value: "\(c.energy)/5")
                        StatTile(label: "Sleep", value: "\(c.sleep)/5")
                        StatTile(label: "Pain", value: c.pain.isEmpty ? "None" : c.pain.joined(separator: ", "))
                    }
                    if let note = c.note, !note.isEmpty {
                        Text(note).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    if let reply = c.reply, !reply.isEmpty {
                        Label(reply, systemImage: "arrowshape.turn.up.left").font(.jkCaption).foregroundStyle(JK.text)
                    }
                    HStack(spacing: 8) {
                        TextField(c.reply == nil ? "Reply to this check-in" : "Update your reply",
                                  text: Binding(get: { replies[c.id] ?? "" }, set: { replies[c.id] = $0 }), axis: .vertical)
                            .lineLimit(1...4)
                            .font(.jkCaption)
                            .padding(10)
                            .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip))
                        Button {
                            Task { await reply(c) }
                        } label: {
                            if sending == c.id { ProgressView().controlSize(.small) } else { Image(systemName: "paperplane.fill") }
                        }
                        .disabled(sending != nil || (replies[c.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .jkCard()
            }
        }
        EmptyView()
            .task { await load() }
            .errorAlert($actionError)
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

    private func reply(_ c: CheckIn) async {
        let text = (replies[c.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = c.id
        defer { sending = nil }
        do {
            let fresh: CheckIn = try await APIClient.shared.send("POST", "/api/checkins/\(seg(c.id))/review", body: ReplyInput(reply: text))
            checkins = checkins?.map { $0.id == fresh.id ? fresh : $0 }
            replies[c.id] = nil
        } catch {
            actionError = error.readable
        }
    }
}
