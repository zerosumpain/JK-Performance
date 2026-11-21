import SwiftUI

/// "Morning, Sam": one card for today, the next booking, and four doors
/// (habits, progress, check-in, feedback). Kept short on purpose; the
/// detail lives behind each door.
struct ClientHomeView: View {
    @Environment(AppSession.self) private var session
    @State private var week: [WorkoutSummary]?
    @State private var habits: HabitsResponse?
    @State private var bookings: [Booking]?
    @State private var reports: ReportsResponse?
    @State private var checkins: CheckInsResponse?
    @State private var error: String?
    @State private var loaded = false

    private var api: APIClient { APIClient.shared }
    private let grid = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: Fmt.longDay(Date()),
                                 title: "\(Fmt.greeting()), \(session.me?.firstName ?? "there")") {
                        Text("JK")
                            .font(.caption.weight(.bold))
                            .frame(width: 30, height: 30)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.secondary, lineWidth: 1))
                    }

                    if let error, !loaded {
                        ErrorCard(message: error) { await load() }
                    } else if !loaded {
                        LoadingCard()
                    } else {
                        if let error { ErrorBanner(message: error) }
                        todayCard
                        nextBooking
                        newFeedback
                        healthPrompt
                        LazyVGrid(columns: grid, spacing: 10) {
                            HomeTile(title: "Habits", value: habitsValue, systemName: "checklist") { DailyHabitsView() }
                            HomeTile(title: "Progress", value: "Weight, records", systemName: "chart.line.downtrend.xyaxis") { ProgressScreen() }
                            HomeTile(title: "Check-in", value: checkinValue, systemName: "square.and.pencil",
                                     highlight: checkinValue == "Due") { WeeklyCheckInView() }
                            HomeTile(title: "Feedback", value: feedbackValue, systemName: "text.bubble",
                                     highlight: (reports?.unread ?? 0) > 0) { WeeklyFeedbackListView() }
                        }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
        }
    }

    private var coachName: String { session.me?.coach?.name ?? "your coach" }

    private func load() async {
        let today = Date()
        let days = Day.week(of: today)
        let from = Day.string(days[0]), to = Day.string(Day.add(7, to: days[6]))
        async let w: WorkoutsResponse = api.get("/api/workouts", query: ["from": from, "to": to])
        async let h: HabitsResponse = api.get("/api/habits", query: ["date": Day.today])
        async let b: BookingsResponse = api.get("/api/bookings", query: [
            "from": Day.today, "to": Day.string(Day.add(14, to: today)),
        ])
        async let r: ReportsResponse = api.get("/api/reports")
        async let c: CheckInsResponse = api.get("/api/checkins")
        var failures: [String] = []
        do { week = try await w.workouts } catch { if !error.isCancellation { failures.append(error.readable) } }
        do { habits = try await h } catch { if !error.isCancellation { failures.append(error.readable) } }
        do { bookings = try await b.bookings } catch { if !error.isCancellation { failures.append(error.readable) } }
        reports = try? await r
        checkins = try? await c
        await Reminders.shared.schedule(bookings: bookings ?? [], workouts: week ?? [])
        await session.refreshMe()
        error = failures.first
        loaded = week != nil || habits != nil || bookings != nil
    }

    // MARK: Today

    private var thisWeek: [WorkoutSummary] {
        let days = Set(Day.week(of: Date()).map(Day.string))
        return (week ?? []).filter { days.contains($0.date) }
    }

    private var todayWorkout: WorkoutSummary? {
        let mine = (week ?? []).filter { $0.date == Day.today }
        return mine.first { $0.completedAt == nil } ?? mine.first
    }

    private var nextWorkout: WorkoutSummary? {
        (week ?? []).filter { $0.date > Day.today && $0.completedAt == nil }.min { $0.date < $1.date }
    }

    private var weekLine: String {
        let done = thisWeek.filter { $0.completedAt != nil }.count
        return thisWeek.isEmpty ? "" : "\(done) of \(thisWeek.count) sessions done this week"
    }

    @ViewBuilder
    private var todayCard: some View {
        if let w = todayWorkout {
            let starts = w.startsAt.flatMap { Day.at(Date(), time: $0) }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Eyebrow(text: "Today")
                    Spacer()
                    if let badge = w.completedAt != nil ? "Done" : starts.flatMap({ Fmt.countdown(to: $0) }) {
                        Text(badge)
                            .font(.caption2)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(JK.cardRaised, in: Capsule())
                            .foregroundStyle(JK.secondary)
                    }
                }
                Text(w.title).font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                Text([w.startsAt, w.location?.isEmpty == false ? w.location : nil].compactMap { $0 }.joined(separator: " · ")
                     + (w.completedAt == nil ? "" : " · \(w.doneCount) of \(w.itemCount) exercises"))
                    .font(.caption).foregroundStyle(JK.secondary)
                NavigationLink { WorkoutDetailLoader(workoutId: w.id) } label: {
                    Label(w.completedAt == nil ? "Start workout" : "View workout", systemImage: w.completedAt == nil ? "play.fill" : "checkmark")
                }
                .buttonStyle(ChromeButtonStyle())
                .padding(.top, 4)
                if !weekLine.isEmpty { Text(weekLine).font(.caption2).foregroundStyle(JK.tertiary) }
            }
            .jkCard()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Today")
                Text("Rest day").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                Text(nextWorkout.map { w in
                    "Next: \(w.title), \(Day.date(w.date).map { Fmt.weekday($0) } ?? w.date)" + (w.startsAt.map { " \($0)" } ?? "")
                } ?? "Walk, recover and tick off your habits.")
                    .font(.caption).foregroundStyle(JK.secondary)
                if !weekLine.isEmpty { Text(weekLine).font(.caption2).foregroundStyle(JK.tertiary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .jkCard()
        }
    }

    @ViewBuilder
    private var nextBooking: some View {
        if let b = (bookings ?? []).filter({ $0.end > Date() && $0.isMine }).min(by: { $0.start < $1.start }) {
            NavigationLink { MyCalendarView(initialDay: b.start, embedded: true) } label: {
                UpcomingRow(weekday: Fmt.weekday(b.start), day: "\(Day.calendar.component(.day, from: b.start))",
                            title: b.title ?? b.kindLabel,
                            detail: [Fmt.time(b.start), b.location].compactMap { $0 }.joined(separator: " · "))
                    .jkCard(padding: 4)
            }
        }
    }

    @ViewBuilder
    private var newFeedback: some View {
        if let r = reports?.reports.first(where: \.isUnread), let id = r.id {
            NavigationLink { ReportDetailView(reportId: id) } label: {
                HStack(spacing: 12) {
                    IconTile(systemName: "text.bubble.fill")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("New feedback from \(coachName)").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text(r.weekLabel).font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                }
                .jkCard(padding: 12)
            }
        }
    }

    @ViewBuilder
    private var healthPrompt: some View {
        if !HealthSync.shared.optedIn, HealthSync.shared.available, session.me?.demo != true {
            NavigationLink { HealthDevicesView() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "heart.fill").foregroundStyle(.red)
                    Text("Connect Apple Health").font(.subheadline.weight(.medium)).foregroundStyle(JK.text)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [4])))
            }
        }
    }

    // MARK: Tiles

    private var habitsValue: String {
        guard let list = habits?.habits, !list.isEmpty else { return "None set" }
        return "\(list.filter(\.done).count) of \(list.count) today"
    }

    private var checkinValue: String {
        guard let c = checkins else { return "Weekly" }
        return c.checkins.contains { $0.week == c.dueWeek } ? "Sent" : "Due"
    }

    private var feedbackValue: String {
        guard let r = reports else { return "Weekly" }
        if r.unread > 0 { return r.unread == 1 ? "1 new" : "\(r.unread) new" }
        return r.reports.first.map { Fmt.dayMonth($0.week) } ?? "None yet"
    }
}

struct UpcomingRow: View {
    let weekday: String
    let day: String
    let title: String
    let detail: String
    var chevron = true

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text(weekday.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(JK.tertiary)
                Text(day).font(.headline).foregroundStyle(JK.text)
            }
            .frame(width: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(JK.text)
                Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            if chevron { Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary) }
        }
        .padding(12)
    }
}

/// A square door on Home: icon, name, one line of state.
private struct HomeTile<Destination: View>: View {
    let title: String
    let value: String
    let systemName: String
    var highlight = false
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: systemName).font(.title3).foregroundStyle(JK.text)
                    Spacer()
                    if highlight { Circle().fill(JK.text).frame(width: 7, height: 7) }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(value).font(.caption2).foregroundStyle(highlight ? JK.text : JK.tertiary).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .jkCard(padding: 14)
        }
    }
}

// MARK: - Daily habits

struct DailyHabitsView: View {
    @Environment(AppSession.self) private var session
    @State private var data: HabitsResponse?
    @State private var error: String?
    @State private var editing: Habit?
    @State private var logging = false
    @State private var actionError: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(eyebrow: Fmt.longDay(Date()), title: "Daily habits")
                Loadable(value: data, error: error, retry: load) { data in
                    nutrition(data.nutrition)
                    Eyebrow(text: "Habits set by \(session.me?.coach?.name ?? "your coach")")
                    if data.habits.isEmpty {
                        EmptyCard(systemName: "checklist", title: "No habits yet",
                                  detail: "Your coach will add daily habits here.")
                    }
                    ForEach(data.habits) { habit in
                        habitRow(habit)
                    }
                    VStack(spacing: 6) {
                        HStack(spacing: 4) {
                            ForEach(0..<7, id: \.self) { i in
                                Capsule().fill(i < min(data.streak, 7) ? JK.text : JK.track).frame(height: 3)
                            }
                        }
                        .padding(.horizontal, 40)
                        Text("\(data.streak)-day habit streak").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .task { await load() }
        .sheet(item: $editing) { habit in
            HabitValueSheet(habit: habit) { value in
                await setDay(habit, HabitDayInput(value: value, done: nil))
            }
            .presentationDetents([.height(260)])
        }
        .sheet(isPresented: $logging) {
            FoodLogSheet { input in
                let fresh: Nutrition = try await api.send("POST", "/api/nutrition/entries", body: input)
                replaceNutrition(fresh)
            }
        }
        .errorAlert($actionError)
    }

    private func replaceNutrition(_ fresh: Nutrition) {
        guard let current = data else { return }
        data = HabitsResponse(date: current.date, habits: current.habits, streak: current.streak, nutrition: fresh)
    }

    private func load() async {
        do {
            data = try await api.get("/api/habits", query: ["date": Day.today])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func setDay(_ habit: Habit, _ input: HabitDayInput) async {
        do {
            let fresh: Habit = try await api.send("PUT", "/api/habits/\(seg(habit.id))/days/\(Day.today)", body: input)
            if let current = data {
                let habits = current.habits.map { $0.id == fresh.id ? fresh : $0 }
                data = HabitsResponse(date: current.date, habits: habits, streak: current.streak, nutrition: current.nutrition)
            }
            // The streak is computed server-side; re-read it quietly.
            if let again: HabitsResponse = try? await api.get("/api/habits", query: ["date": Day.today]) { data = again }
        } catch {
            actionError = error.readable
        }
    }

    private func habitRow(_ habit: Habit) -> some View {
        Button {
            if habit.fromHealth { return }
            if habit.isCount {
                editing = habit
            } else {
                Task { await setDay(habit, HabitDayInput(value: nil, done: !habit.done)) }
            }
        } label: {
            HStack(spacing: 12) {
                IconTile(systemName: symbol(habit.icon))
                VStack(alignment: .leading, spacing: 6) {
                    Text(habit.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(detail(habit)).font(.caption2).foregroundStyle(JK.tertiary)
                    ThinBar(fraction: habit.done ? 1 : (habit.target > 0 ? (habit.value ?? 0) / habit.target : 0))
                }
                CheckCircle(on: habit.done)
            }
            .jkCard(padding: 12)
        }
        .buttonStyle(.plain)
    }

    private func detail(_ habit: Habit) -> String {
        var text: String
        if habit.healthKind == "sleep" {
            text = habit.value.map { "\(Fmt.minutes($0 * 60)) / \(Fmt.number(habit.target))h" } ?? "No sleep data yet"
        } else if habit.isCount || habit.value != nil {
            text = "\(Fmt.number(habit.value ?? 0)) / \(Fmt.number(habit.target)) \(habit.unit)"
        } else {
            text = habit.done ? "Done" : "Tap when done"
        }
        if habit.fromHealth { text += " · from Apple Health" }
        return text
    }

    private func nutrition(_ n: Nutrition) -> some View {
        let target = n.targets
        return VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "Nutrition · Today", trailing: target == nil ? "No target set" : "Coach target")
            HStack(spacing: 16) {
                ZStack {
                    Circle().stroke(JK.track, lineWidth: 6)
                    Circle().trim(from: 0, to: min(1, (target?.kcal ?? 0) > 0 ? n.totals.kcal / target!.kcal : 0))
                        .stroke(JK.text, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text(Fmt.number(n.totals.kcal, digits: 0)).font(.title3.weight(.semibold))
                        Text(target.map { "of \(Fmt.number($0.kcal, digits: 0))" } ?? "kcal")
                            .font(.system(size: 9)).foregroundStyle(JK.tertiary)
                    }
                    .foregroundStyle(JK.text)
                }
                .frame(width: 82, height: 82)
                VStack(spacing: 10) {
                    MacroRow(name: "Protein", value: n.totals.protein, target: target?.protein)
                    MacroRow(name: "Carbs", value: n.totals.carbs, target: target?.carbs)
                    MacroRow(name: "Fat", value: n.totals.fat, target: target?.fat)
                }
            }
            if !n.entries.isEmpty {
                VStack(spacing: 6) {
                    ForEach(n.entries) { entry in
                        HStack {
                            Text(entry.name).font(.caption).foregroundStyle(JK.text)
                            Spacer()
                            Text("\(Fmt.number(entry.kcal, digits: 0)) kcal").font(.caption2).foregroundStyle(JK.tertiary)
                            Button {
                                Task { await deleteEntry(entry) }
                            } label: {
                                Image(systemName: "xmark").font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(entry.name)")
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                // No photo recognition yet: both open the same quick log.
                Button { logging = true } label: { Label("Snap a meal", systemImage: "camera") }
                Button { logging = true } label: { Label("Log food", systemImage: "magnifyingglass") }
            }
            .buttonStyle(GhostButtonStyle())
        }
        .jkCard()
    }

    private func deleteEntry(_ entry: FoodEntry) async {
        do {
            let fresh: Nutrition = try await api.send("DELETE", "/api/nutrition/entries/\(seg(entry.id))")
            replaceNutrition(fresh)
        } catch {
            actionError = error.readable
        }
    }
}

private struct MacroRow: View {
    let name: String
    let value: Double
    let target: Double?

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text(name).font(.caption2).foregroundStyle(JK.tertiary)
                Spacer()
                Text(target.map { "\(Fmt.number(value, digits: 0)) / \(Fmt.number($0, digits: 0)) g" }
                     ?? "\(Fmt.number(value, digits: 0)) g")
                    .font(.caption2).foregroundStyle(JK.secondary)
            }
            ThinBar(fraction: (target ?? 0) > 0 ? value / target! : 0)
        }
    }
}

/// Sets the value of a "count" habit (litres of water, minutes…).
private struct HabitValueSheet: View {
    let habit: Habit
    let save: (Double) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(habit.name).font(.title3.weight(.semibold)).foregroundStyle(JK.text)
            JKField(label: "Today (\(habit.unit)) · target \(Fmt.number(habit.target))", text: $text,
                    prompt: "0", keyboard: .decimalPad)
            Button {
                guard let value = parseNumber(text) else { return }
                saving = true
                Task {
                    await save(value)
                    saving = false
                    dismiss()
                }
            } label: {
                if saving { ProgressView().tint(.black) } else { Text("Save") }
            }
            .buttonStyle(ChromeButtonStyle())
            .disabled(parseNumber(text) == nil || saving)
        }
        .padding(20)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(JK.bg.ignoresSafeArea())
        .onAppear { text = habit.value.map { Fmt.number($0, digits: 2) } ?? "" }
    }
}

/// Quick food log: name, kcal and macros.
struct FoodLogSheet: View {
    let save: (FoodInput) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kcal = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    JKField(label: "Food", text: $name, prompt: "Chicken, rice and greens")
                    JKField(label: "Calories (kcal)", text: $kcal, prompt: "0", keyboard: .numberPad)
                    HStack(spacing: 8) {
                        JKField(label: "Protein (g)", text: $protein, prompt: "0", keyboard: .decimalPad)
                        JKField(label: "Carbs (g)", text: $carbs, prompt: "0", keyboard: .decimalPad)
                        JKField(label: "Fat (g)", text: $fat, prompt: "0", keyboard: .decimalPad)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await submit() }
                    } label: {
                        if saving { ProgressView().tint(.black) } else { Text("Log food") }
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(!valid || saving)
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Log food")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && parseNumber(kcal) != nil
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        let input = FoodInput(date: Day.today, name: name.trimmingCharacters(in: .whitespaces),
                              kcal: parseNumber(kcal) ?? 0, protein: parseNumber(protein) ?? 0,
                              carbs: parseNumber(carbs) ?? 0, fat: parseNumber(fat) ?? 0)
        do {
            try await save(input)
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}
