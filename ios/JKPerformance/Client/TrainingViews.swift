import SwiftUI

// MARK: - Session (detail, logger and complete, one flow)

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

/// A workout's summary, its exercises and "Finish session", which opens the
/// session-complete page (feel word and note) before anything is sent.
struct WorkoutBody: View {
    @Binding var workout: Workout
    @State private var finishing = false

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            header
            exercises
            footer
        }
        .fullScreenCover(isPresented: $finishing) {
            SessionCompleteView(workout: workout) { workout = $0 }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text(workout.title).jkText(.display).foregroundStyle(JK.text)
            Text(([workout.startsAt, workout.location].compactMap { $0 }.filter { !$0.isEmpty }
                  + ["\(workout.items.count) exercises", "\(workout.doneCount) of \(workout.items.count) done"]).joined(separator: " · "))
                .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            if let notes = workout.notes, !notes.isEmpty {
                Text(notes).jkText(.quoteSmall).foregroundStyle(JK.text)
            }
        }
    }

    private var exercises: some View {
        ForEach(workout.items.sorted { $0.order < $1.order }) { item in
            NavigationLink {
                WorkoutLoggerView(workout: workout, itemId: item.id) { workout = $0 }
            } label: {
                PlanExerciseCard(item: item)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var footer: some View {
        OfflineBanner()
        if let done = workout.completedAt {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text("Done \(Fmt.relative(done))").font(.jkCallout).foregroundStyle(JK.textSecondary)
                if let word = workout.feelWord ?? Feel.word(workout.feel) {
                    Text("Felt \(word.lowercased())").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if !workout.items.isEmpty {
            Button("Finish session") { finishing = true }
                .buttonStyle(PrimaryButtonStyle())
        }
    }
}

/// The session-complete page, the most considered page in the app: the
/// serif "Done.", the session in figures, any new bests, how it felt in one
/// word, an optional note, and "JK will see this."
struct SessionCompleteView: View {
    let workout: Workout
    let onDone: (Workout) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var feel: Int?
    @State private var note = ""
    @State private var saving = false
    @State private var error: String?
    @State private var records: [PersonalRecord] = []

    private var sets: [LoggedSet] { workout.items.flatMap(\.logged) }
    private var volume: Double {
        sets.reduce(0) { sum, s in sum + (parseNumber(s.load) ?? 0) * Double(s.reps) }
    }
    private var minutes: Double? {
        let times = sets.compactMap(\.at).sorted()
        guard let first = times.first, let last = times.last, last > first else { return nil }
        return last.timeIntervalSince(first) / 60
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    Text("Done. \(workout.title).")
                        .jkText(.letterHeadline)
                        .foregroundStyle(JK.text)
                        .fixedSize(horizontal: false, vertical: true)
                    figures
                    if !records.isEmpty {
                        FlowChips(texts: records.map { "New best · \($0.exercise) \(Fmt.number($0.kg)) kg" })
                    }
                    VStack(alignment: .leading, spacing: JK.Space.m) {
                        Text("How did that feel?").font(.jkHeadline).foregroundStyle(JK.text)
                        FeelRow(selection: $feel)
                    }
                    VStack(alignment: .leading, spacing: JK.Space.xs) {
                        JKField(label: "A note (optional)", text: $note, prompt: "Knee felt fine on the last set")
                        Text("JK will see this.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    OfflineBanner()
                    if let error { ErrorBanner(message: error) }
                    PrimaryButton("Done", busy: saving) { Task { await finish() } }
                }
                .padding(JK.Space.gutter)
            }
            .jkScreen()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() } }
            }
            .task {
                let today = Day.today
                if let p: ProgressData = try? await APIClient.shared.get("/api/progress") {
                    let names = Set(workout.items.map(\.exercise.name))
                    records = p.records.filter { $0.date == today && names.contains($0.exercise) }
                }
            }
        }
    }

    private var figures: some View {
        AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.xl) {
            figure("\(sets.count)", "Sets")
            figure(volume > 0 ? "\(Fmt.number(volume, digits: 0)) kg" : "–", "Volume")
            figure(minutes.map { Fmt.duration($0) } ?? "–", "Duration")
        }
    }

    private func figure(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Text(value).jkText(.numberTile).foregroundStyle(JK.text).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func finish() async {
        saving = true
        defer { saving = false }
        let path = "/api/workouts/\(seg(workout.id))/complete"
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let input = CompleteInput(note: trimmed.isEmpty ? nil : trimmed, feel: feel)
        do {
            let fresh: Workout = try await APIClient.shared.send("POST", path, body: input)
            onDone(fresh)
            dismiss()
        } catch let failure where Outbox.isOffline(failure) {
            // Queued after the sets logged offline, so the server sees them first.
            Outbox.shared.enqueue("POST", path, body: input)
            var local = workout
            local.completedAt = Date()
            local.feel = feel
            onDone(local)
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

/// "How did that feel?": five words in one quiet segmented row, each at least
/// 44pt high. No numbers, no emoji, no animation.
struct FeelRow: View {
    @Binding var selection: Int?

    var body: some View {
        AdaptiveStack(spacing: JK.Space.xs) {
            ForEach(Array(Feel.words.enumerated()), id: \.offset) { i, word in
                let on = selection == i + 1
                Button { selection = on ? nil : i + 1 } label: {
                    Text(word)
                        .font(.jkCallout)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: JK.Size.touch)
                        .foregroundStyle(on ? JK.onPrimary : JK.text)
                        .background(on ? JK.primaryFill : JK.surface,
                                    in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// Hairline pills in champagne text: "New best · Squat 102.5 kg".
struct FlowChips: View {
    let texts: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            ForEach(texts, id: \.self) { t in
                Text(t)
                    .font(.jkCaption)
                    .foregroundStyle(JK.accent)
                    .padding(.horizontal, JK.Space.m)
                    .padding(.vertical, JK.Space.xs)
                    .overlay(Capsule().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
            }
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
    @Environment(AppSession.self) private var session
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
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text(item.exercise.name).jkText(.display).foregroundStyle(JK.text)
            Text(["\(item.sets) × \(item.reps)", item.load.isEmpty ? nil : item.load,
                  item.rpe.map { "RPE \($0)" }].compactMap { $0 }.joined(separator: " · "))
                .font(.jkCallout.monospacedDigit()).foregroundStyle(JK.textSecondary)
            if let note = item.note, !note.isEmpty {
                Text(note).jkText(.quoteSmall).foregroundStyle(JK.text)
            }
            AdaptiveStack(spacing: JK.Space.s) {
                if let url = item.exercise.videoUrl.flatMap(URL.init(string:)) {
                    Link(destination: url) { Label("How to do this", systemImage: IconKey.play.symbol) }
                        .buttonStyle(TextButtonStyle())
                } else {
                    NavigationLink { ExercisesView() } label: { Label("How to do this", systemImage: IconKey.guide.symbol) }
                        .buttonStyle(TextButtonStyle())
                }
                if session.gate.formChecks {
                    FormCheckButton(exerciseId: item.exercise.id, exerciseName: item.exercise.name, workoutId: workout.id)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
