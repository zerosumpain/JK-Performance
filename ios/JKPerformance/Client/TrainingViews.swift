import SwiftUI

// MARK: - Workout plan (Plan tab root)

/// The week's day strip, the selected day's workout and its exercises with
/// the coach's prescription. Only published workouts reach a client.
struct WorkoutPlanView: View {
    @State private var selected = Day.start(Date())
    @State private var week: [WorkoutSummary]?
    @State private var weekKey = ""
    @State private var workout: Workout?
    @State private var chosenId: String?
    @State private var error: String?
    @State private var loadingDetail = false

    private var api: APIClient { APIClient.shared }
    private var days: [Date] { Day.week(of: selected) }

    private var dayWorkouts: [WorkoutSummary] {
        (week ?? []).filter { $0.date == Day.string(selected) }.sorted { ($0.startsAt ?? "") < ($1.startsAt ?? "") }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Week of \(Fmt.dayMonth(days[0]))", title: "Workout plan") {
                        HStack(spacing: 8) {
                            Button { selected = Day.add(-7, to: selected) } label: { headerIcon("chevron.left") }
                            Button { selected = Day.add(7, to: selected) } label: { headerIcon("chevron.right") }
                            NavigationLink { ExercisesView() } label: { headerIcon("plus") }
                        }
                        .foregroundStyle(JK.text)
                    }
                    DayStrip(days: days, selected: $selected,
                             marked: Set((week ?? []).map(\.date)))

                    if let error, week == nil {
                        ErrorCard(message: error) { await loadWeek(force: true) }
                    } else if week == nil {
                        LoadingCard()
                    } else if dayWorkouts.isEmpty {
                        EmptyCard(systemName: "calendar", title: "Nothing planned",
                                  detail: "No workout from your coach on \(Fmt.longDay(selected)).")
                    } else {
                        if let error { ErrorBanner(message: error) }
                        if dayWorkouts.count > 1 {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(dayWorkouts) { w in
                                        Chip(label: w.title, selected: w.id == workout?.id) { chosenId = w.id }
                                    }
                                }
                            }
                        }
                        if let binding = Binding($workout) {
                            WorkoutBody(workout: binding)
                        } else if loadingDetail {
                            LoadingCard()
                        }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await loadWeek(force: true) }
            .toolbar(.hidden, for: .navigationBar)
            .task(id: Day.string(days[0])) { await loadWeek(force: false) }
            .task(id: "\(Day.string(selected))|\(chosenId ?? "")|\(week?.count ?? -1)") { await loadDetail() }
        }
    }

    private func headerIcon(_ name: String) -> some View {
        Image(systemName: name)
            .frame(width: 30, height: 30)
            .overlay(RoundedRectangle(cornerRadius: JK.Radius.chip).stroke(JK.hairline, lineWidth: 1))
    }

    private func loadWeek(force: Bool) async {
        let key = Day.string(days[0])
        if !force, key == weekKey, week != nil { return }
        do {
            let reply: WorkoutsResponse = try await api.get("/api/workouts", query: ["from": key, "to": Day.string(days[6])])
            week = reply.workouts
            weekKey = key
            error = nil
            if force { await loadDetail() }
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func loadDetail() async {
        guard week != nil else { return }
        let options = dayWorkouts
        guard let target = options.first(where: { $0.id == chosenId }) ?? options.first(where: { $0.completedAt == nil }) ?? options.first else {
            workout = nil
            return
        }
        if workout?.id != target.id { workout = nil }
        loadingDetail = true
        defer { loadingDetail = false }
        do {
            workout = try await api.get("/api/workouts/\(seg(target.id))")
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// Loads one workout by id (from Home's "Open workout").
struct WorkoutDetailLoader: View {
    let workoutId: String
    @State private var workout: Workout?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Loadable(value: workout, error: error, retry: load) { _ in
                    if let binding = Binding($workout) { WorkoutBody(workout: binding) }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .navigationTitle(workout?.title ?? "Workout")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        if Outbox.shared.hasPending(workoutId: workoutId) { await Outbox.shared.flush() }
        // Still queued (offline): keep showing what was logged here rather than the server's older copy.
        if workout != nil, Outbox.shared.hasPending(workoutId: workoutId) { return }
        do {
            workout = try await APIClient.shared.get("/api/workouts/\(seg(workoutId))")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// A workout's summary card, its exercises and "Complete workout".
struct WorkoutBody: View {
    @Binding var workout: Workout
    @State private var completing = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(workout.title).font(.jkHeadline).foregroundStyle(JK.text)
                Spacer()
                if workout.editedBy == "coach", let at = workout.editedAt {
                    Label("Coach · \(Fmt.relative(at))", systemImage: "person.2").font(.jkCaption).foregroundStyle(JK.textTertiary)
                } else {
                    Label("Shared with Coach", systemImage: "person.2").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
            }
            Text(([workout.startsAt, workout.location].compactMap { $0 }.filter { !$0.isEmpty }
                  + ["\(workout.items.count) exercises"]).joined(separator: " · "))
                .font(.jkCaption).foregroundStyle(JK.textTertiary)
            HStack {
                ThinBar(fraction: workout.items.isEmpty ? 0 : Double(workout.doneCount) / Double(workout.items.count))
                Text("\(workout.doneCount) of \(workout.items.count) done").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            if let notes = workout.notes, !notes.isEmpty {
                Label(notes, systemImage: "text.bubble").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .jkCard()

        ForEach(workout.items.sorted { $0.order < $1.order }) { item in
            NavigationLink {
                WorkoutLoggerView(workout: workout, itemId: item.id) { workout = $0 }
            } label: {
                PlanExerciseCard(item: item)
            }
            .buttonStyle(.plain)
        }

        OfflineBanner()
        if let error { ErrorBanner(message: error) }
        if let done = workout.completedAt {
            Label("Completed \(Fmt.relative(done))", systemImage: "checkmark.seal")
                .font(.jkCallout.weight(.semibold))
                .foregroundStyle(JK.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        } else if !workout.items.isEmpty {
            Button {
                Task { await complete() }
            } label: {
                if completing { ProgressView().tint(JK.onPrimary) } else { Label("Complete workout", systemImage: "checkmark") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(completing)
        }
    }

    private func complete() async {
        completing = true
        defer { completing = false }
        let path = "/api/workouts/\(seg(workout.id))/complete"
        do {
            workout = try await APIClient.shared.send("POST", path, body: NoteInput(note: nil))
            error = nil
        } catch let failure where Outbox.isOffline(failure) {
            // Queued after the sets logged offline, so the server sees them first.
            Outbox.shared.enqueue("POST", path, body: NoteInput(note: nil))
            workout.completedAt = Date()
            self.error = nil
        } catch {
            self.error = error.readable
        }
    }
}

private struct PlanExerciseCard: View {
    let item: WorkoutItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CheckCircle(on: item.isDone)
                Text(item.exercise.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Spacer()
                if !item.logged.isEmpty && !item.isDone {
                    Text("\(item.logged.count)/\(item.sets)").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            HStack(spacing: 8) {
                PrescriptionCell(label: "Sets", value: "\(item.sets)")
                PrescriptionCell(label: "Reps", value: item.reps)
                PrescriptionCell(label: "Load", value: item.load.isEmpty ? "–" : item.load)
            }
            if let note = item.note, !note.isEmpty {
                Label(note, systemImage: "text.bubble").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
        }
        .jkCard()
    }
}

private struct PrescriptionCell: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.jkMicro).foregroundStyle(JK.textSecondary)
            Text(value).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
    }
}

// MARK: - Exercise library

let exerciseCategories = ["All", "Legs", "Push", "Pull", "Core", "Mobility", "Conditioning"]

/// GET /api/exercises with the search text and category, debounced.
struct ExerciseSearch {
    static func fetch(query: String, category: String) async throws -> [Exercise] {
        try await Task.sleep(for: .milliseconds(250))
        let q = query.trimmingCharacters(in: .whitespaces)
        let reply: ExercisesResponse = try await APIClient.shared.get("/api/exercises", query: [
            "q": q.isEmpty ? nil : q,
            "category": category == "All" ? nil : category,
        ])
        return reply.exercises
    }
}

struct ExercisesView: View {
    @State private var query = ""
    @State private var category = "All"
    @State private var exercises: [Exercise]?
    @State private var error: String?

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Library", title: "Exercises")
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(JK.textTertiary)
                    TextField("Search exercises", text: $query)
                        .foregroundStyle(JK.text)
                        .autocorrectionDisabled()
                }
                .jkCard(padding: 10)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(exerciseCategories, id: \.self) { c in
                            Chip(label: c, selected: category == c) { category = c }
                        }
                    }
                }
                Loadable(value: exercises, error: error, retry: load) { list in
                    if list.isEmpty {
                        EmptyCard(systemName: "magnifyingglass", title: "No matches", detail: "Try another word or category.")
                    }
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(list) { exercise in
                            if let link = exercise.videoUrl.flatMap(URL.init(string:)) {
                                Link(destination: link) { ExerciseTile(exercise: exercise) }
                                    .buttonStyle(.plain)
                            } else {
                                ExerciseTile(exercise: exercise)
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .task(id: "\(query)|\(category)") { await load() }
    }

    private func load() async {
        do {
            exercises = try await ExerciseSearch.fetch(query: query, category: category)
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

private struct ExerciseTile: View {
    let exercise: Exercise

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                Rectangle().fill(JK.raised).frame(height: 84)
                Image(systemName: exercise.videoUrl == nil ? "figure.strengthtraining.traditional" : "play.circle")
                    .foregroundStyle(JK.textSecondary)
                    .padding(6)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name).font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(exercise.equipment) · \(exercise.pattern)").font(.jkMicro).foregroundStyle(JK.textTertiary)
            }
            .padding(10)
        }
        .background(JK.surface)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.hairline, lineWidth: 1))
    }
}

/// Library search in a sheet; tapping a row hands the exercise back.
struct ExercisePickerSheet: View {
    let onPick: (Exercise) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var category = "All"
    @State private var exercises: [Exercise]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.textTertiary)
                        TextField("Search exercises", text: $query).autocorrectionDisabled()
                    }
                    .jkCard(padding: 10)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(exerciseCategories, id: \.self) { c in
                                Chip(label: c, selected: category == c) { category = c }
                            }
                        }
                    }
                    Loadable(value: exercises, error: error, retry: load) { list in
                        if list.isEmpty {
                            EmptyCard(systemName: "magnifyingglass", title: "No matches")
                        }
                        VStack(spacing: 0) {
                            ForEach(list) { exercise in
                                Button {
                                    onPick(exercise)
                                    dismiss()
                                } label: {
                                    HStack(spacing: 12) {
                                        Glyph(systemName: "dumbbell", size: 34)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(exercise.name).font(.jkCallout.weight(.medium)).foregroundStyle(JK.text)
                                            Text("\(exercise.equipment) · \(exercise.pattern)").font(.jkCaption).foregroundStyle(JK.textTertiary)
                                        }
                                        Spacer()
                                        Image(systemName: "plus").foregroundStyle(JK.textTertiary)
                                    }
                                    .padding(10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .jkCard(padding: 4)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Add exercise")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task(id: "\(query)|\(category)") { await load() }
        }
    }

    private func load() async {
        do {
            exercises = try await ExerciseSearch.fetch(query: query, category: category)
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

// MARK: - Workout logger

/// Logging one exercise: coach demo, set table (PUT/DELETE per set), rest
/// timer (local only).
struct WorkoutLoggerView: View {
    @State var workout: Workout
    @State var itemId: String
    let onChange: (Workout) -> Void

    @State private var loads: [Int: String] = [:]
    @State private var reps: [Int: String] = [:]
    @State private var busy: Int?
    @State private var error: String?
    @State private var rest = 90
    @State private var resting = false
    /// Optional RPE for the next logged set, 1–10.
    @State private var rpe: Int?

    init(workout: Workout, itemId: String, onChange: @escaping (Workout) -> Void) {
        _workout = State(initialValue: workout)
        _itemId = State(initialValue: itemId)
        self.onChange = onChange
    }

    private var ordered: [WorkoutItem] { workout.items.sorted { $0.order < $1.order } }
    private var index: Int { ordered.firstIndex { $0.id == itemId } ?? 0 }
    private var item: WorkoutItem? { ordered.first { $0.id == itemId } }

    private func logged(_ n: Int) -> LoggedSet? { item?.logged.first { $0.number == n } }
    private var nextSet: Int? {
        guard let item, item.sets > 0 else { return nil }
        return (1...item.sets).first { logged($0) == nil }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let item {
                    demo(item)
                    setTable(item)
                    restTimer
                    rpeRow
                    OfflineBanner()
                    if let error { ErrorBanner(message: error) }
                    HStack(spacing: 10) {
                        if index + 1 < ordered.count {
                            Button {
                                itemId = ordered[index + 1].id
                            } label: { Label("Next exercise", systemImage: "forward") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        Button {
                            if let n = nextSet { Task { await log(n) } }
                        } label: {
                            Text(nextSet.map { "Log set \($0)" } ?? "All sets logged")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(nextSet == nil || busy != nil || workout.completedAt != nil)
                    }
                } else {
                    EmptyCard(systemName: "dumbbell", title: "Exercise removed", detail: "Your coach changed this workout.")
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle(workout.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text("\(index + 1) of \(ordered.count)").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
        }
        .task(id: resting) {
            while resting && rest > 0 && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if resting && rest > 0 { rest -= 1 }
            }
            if rest == 0 { resting = false }
        }
        .onChange(of: itemId) { _, _ in
            loads = [:]
            reps = [:]
        }
    }

    private func defaultLoad(_ item: WorkoutItem) -> String {
        if let last = item.logged.max(by: { $0.number < $1.number }) { return last.load }
        return item.load.replacingOccurrences(of: " kg", with: "").replacingOccurrences(of: "kg", with: "")
    }

    private func defaultReps(_ item: WorkoutItem) -> String {
        if let last = item.logged.max(by: { $0.number < $1.number }) { return "\(last.reps)" }
        return String(item.reps.prefix { $0.isNumber })
    }

    private func loadBinding(_ n: Int, _ item: WorkoutItem) -> Binding<String> {
        Binding(get: { loads[n] ?? logged(n)?.load ?? defaultLoad(item) }, set: { loads[n] = $0 })
    }

    private func repsBinding(_ n: Int, _ item: WorkoutItem) -> Binding<String> {
        Binding(get: { reps[n] ?? logged(n).map { "\($0.reps)" } ?? defaultReps(item) }, set: { reps[n] = $0 })
    }

    private func log(_ n: Int) async {
        guard let item else { return }
        let load = (loads[n] ?? defaultLoad(item)).trimmingCharacters(in: .whitespaces)
        guard let count = Int(reps[n] ?? defaultReps(item)) else {
            error = "Enter the reps for set \(n)."
            return
        }
        busy = n
        defer { busy = nil }
        let path = setPath(item, n)
        let input = SetInput(load: load, reps: count, rpe: rpe.map(Double.init))
        do {
            let fresh: Workout = try await APIClient.shared.send("PUT", path, body: input)
            apply(fresh)
            rest = 90
            resting = true
        } catch let failure where Outbox.isOffline(failure) {
            // No signal: keep the set on the phone and show it as logged now.
            Outbox.shared.enqueue("PUT", path, body: input)
            var local = workout
            local.setLogged(itemId: item.id, LoggedSet(number: n, load: load, reps: count, rpe: input.rpe, at: Date()), number: n)
            apply(local)
            rest = 90
            resting = true
        } catch {
            self.error = error.readable
        }
    }

    private func unlog(_ n: Int) async {
        guard let item else { return }
        busy = n
        defer { busy = nil }
        let path = setPath(item, n)
        do {
            let fresh: Workout = try await APIClient.shared.send("DELETE", path)
            apply(fresh)
        } catch let failure where Outbox.isOffline(failure) {
            Outbox.shared.enqueue("DELETE", path)
            var local = workout
            local.setLogged(itemId: item.id, nil, number: n)
            apply(local)
        } catch {
            self.error = error.readable
        }
    }

    private func setPath(_ item: WorkoutItem, _ n: Int) -> String {
        "/api/workouts/\(seg(workout.id))/items/\(seg(item.id))/sets/\(n)"
    }

    private func apply(_ fresh: Workout) {
        workout = fresh
        error = nil
        onChange(fresh)
    }

    private func demo(_ item: WorkoutItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Rectangle().fill(JK.raised).frame(height: 150)
                if let url = item.exercise.videoUrl.flatMap(URL.init(string:)) {
                    Link(destination: url) {
                        Image(systemName: "play.fill")
                            .foregroundStyle(JK.text)
                            .frame(width: 44, height: 44)
                            .background(JK.surface, in: Circle())
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Text("Coach demo")
                        .font(.jkCaption)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(JK.surface, in: Capsule())
                        .foregroundStyle(JK.textSecondary)
                        .padding(10)
                } else {
                    Image(systemName: "figure.strengthtraining.traditional")
                        .font(.largeTitle)
                        .foregroundStyle(JK.textTertiary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(height: 150)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.exercise.name).font(.jkHeadline.weight(.semibold)).foregroundStyle(JK.text)
                Text(["\(item.sets) × \(item.reps)", item.load.isEmpty ? nil : item.load,
                      item.rpe.map { "RPE \($0)" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
                if let note = item.note, !note.isEmpty {
                    Text(note).font(.jkCaption).foregroundStyle(JK.textSecondary).padding(.top, 4)
                }
            }
            .padding(14)
        }
        .background(JK.surface)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.hairline, lineWidth: 1))
    }

    private func setTable(_ item: WorkoutItem) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("SET").frame(width: 34, alignment: .leading)
                Text("PREVIOUS").frame(maxWidth: .infinity, alignment: .leading)
                Text("KG").frame(width: 56)
                Text("REPS").frame(width: 44)
                Spacer().frame(width: 28)
            }
            .font(.jkMicro.weight(.semibold))
            .foregroundStyle(JK.textTertiary)
            .padding(.horizontal, 12).padding(.vertical, 10)

            ForEach(Array(1...max(item.sets, 1)), id: \.self) { n in
                let done = logged(n) != nil
                HStack {
                    HStack(spacing: 3) {
                        Text("\(n)").font(.jkCallout.weight(.semibold))
                        if done && Outbox.shared.isPending("PUT", setPath(item, n)) {
                            Image(systemName: "icloud.and.arrow.up")
                                .font(.jkMicro)
                                .foregroundStyle(JK.textTertiary)
                                .accessibilityLabel("Waiting to send")
                        }
                    }
                    .frame(width: 34, alignment: .leading)
                    Text(item.previous ?? "–").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    TextField("kg", text: loadBinding(n, item))
                        .font(.jkCallout.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .frame(width: 56, height: 28)
                        .background(done ? Color.clear : JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip))
                        .disabled(done)
                    TextField("–", text: repsBinding(n, item))
                        .keyboardType(.numberPad)
                        .font(.jkCallout.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .frame(width: 36, height: 28)
                        .background(done ? Color.clear : JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip))
                        .frame(width: 44)
                        .disabled(done)
                    Button {
                        Task { if done { await unlog(n) } else { await log(n) } }
                    } label: {
                        if busy == n {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: done ? "checkmark.square.fill" : "square")
                                .font(.jkHeadline)
                                .foregroundStyle(done ? JK.text : JK.textTertiary)
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(width: 28)
                    .disabled(busy != nil || workout.completedAt != nil)
                }
                .foregroundStyle(JK.text)
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
        }
        .jkCard(padding: 0)
    }

    private var rpeRow: some View {
        HStack(spacing: 10) {
            Text("RPE").font(.jkMicro.weight(.semibold)).foregroundStyle(JK.textTertiary)
            Text(rpe.map { "\($0)" } ?? "–").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text).frame(minWidth: 20)
            Text("optional, for the next set").font(.jkCaption).foregroundStyle(JK.textTertiary)
            Spacer()
            Button("−") { rpe = rpe.map { $0 <= 1 ? nil : $0 - 1 } ?? nil }.buttonStyle(SmallPillStyle()).disabled(rpe == nil)
            Button("+") { rpe = min(10, (rpe ?? 6) + (rpe == nil ? 0 : 1)) }.buttonStyle(SmallPillStyle())
        }
        .jkCard(padding: 10)
    }

    private var restTimer: some View {
        HStack(spacing: 12) {
            ZStack {
                Ring(fraction: min(1, Double(rest) / 90), lineWidth: 4)
            }
            .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 0) {
                Text("REST").font(.jkMicro.weight(.semibold)).foregroundStyle(JK.textTertiary)
                Text(String(format: "%d:%02d", rest / 60, rest % 60))
                    .font(.jkNumberTile)
                    .foregroundStyle(JK.text)
            }
            Spacer()
            Button("−15s") { rest = max(0, rest - 15) }.buttonStyle(SmallPillStyle())
            Button("+15s") { rest += 15 }.buttonStyle(SmallPillStyle())
            Button {
                if rest == 0 { rest = 90 }
                resting.toggle()
            } label: {
                Image(systemName: resting ? "pause" : "play")
            }
            .buttonStyle(SmallPillStyle())
        }
        .jkCard()
    }
}

// MARK: - Offline

extension Workout {
    /// Set (or, with nil, clear) one logged set locally, as the server would.
    mutating func setLogged(itemId: String, _ set: LoggedSet?, number: Int) {
        guard let i = items.firstIndex(where: { $0.id == itemId }) else { return }
        items[i].logged.removeAll { $0.number == number }
        if let set { items[i].logged.append(set) }
        items[i].logged.sort { $0.number < $1.number }
    }
}

/// Quiet note while sets logged offline are waiting to send; and the one
/// error worth showing if the server later refused one.
struct OfflineBanner: View {
    private var outbox: Outbox { Outbox.shared }

    var body: some View {
        if outbox.pendingCount > 0 {
            Label(text, systemImage: "icloud.slash")
                .font(.jkCaption)
                .foregroundStyle(JK.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous).stroke(JK.hairline, lineWidth: 1))
        }
        if let error = outbox.lastError {
            ErrorBanner(message: error)
                .onTapGesture { outbox.lastError = nil }
        }
    }

    private var text: String {
        let sets = outbox.pendingSets
        if sets == 0 { return "Offline · your changes will send when you're back online" }
        return "Offline · \(sets) \(sets == 1 ? "set" : "sets") will send when you're back online"
    }
}
