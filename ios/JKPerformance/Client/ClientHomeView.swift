import SwiftUI

/// "Morning, Sam": today's session, streak, what's coming up, membership.
/// Daily habits, Progress, Challenges and the weekly check-in hang off it.
struct ClientHomeView: View {
    @Environment(AppSession.self) private var session
    @State private var week: [WorkoutSummary]?
    @State private var habits: HabitsResponse?
    @State private var bookings: [Booking]?
    @State private var error: String?
    @State private var loaded = false

    private var api: APIClient { APIClient.shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
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
                        todaySession
                        HStack(spacing: 10) {
                            streakTile
                            weekTile
                        }

                        Eyebrow(text: "Coming up")
                        upcoming
                    }

                    NavigationLink { MembershipView() } label: { membershipCard }

                    Eyebrow(text: "Your week")
                    VStack(spacing: 8) {
                        HomeLink(title: "Daily habits", detail: "Nutrition and habits set by \(coachName)", systemName: "checklist") { DailyHabitsView() }
                        HomeLink(title: "Progress", detail: "Weight, records and photos", systemName: "chart.line.downtrend.xyaxis") { ProgressScreen() }
                        HomeLink(title: "Challenges", detail: "Run, walk or row with the group", systemName: "trophy") { ChallengesView() }
                        HomeLink(title: "Weekly check-in", detail: "Reviewed by \(coachName)", systemName: "square.and.pencil") { WeeklyCheckInView() }
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
        let from = Day.string(days[0]), to = Day.string(days[6])
        async let w: WorkoutsResponse = api.get("/api/workouts", query: ["from": from, "to": to])
        async let h: HabitsResponse = api.get("/api/habits", query: ["date": Day.today])
        async let b: BookingsResponse = api.get("/api/bookings", query: [
            "from": Day.today, "to": Day.string(Day.add(14, to: today)),
        ])
        var failures: [String] = []
        do { week = try await w.workouts } catch { if !error.isCancellation { failures.append(error.readable) } }
        do { habits = try await h } catch { if !error.isCancellation { failures.append(error.readable) } }
        do { bookings = try await b.bookings } catch { if !error.isCancellation { failures.append(error.readable) } }
        await session.refreshMe()
        error = failures.first
        loaded = week != nil || habits != nil || bookings != nil
    }

    // MARK: Today

    private var todayWorkout: WorkoutSummary? {
        let mine = (week ?? []).filter { $0.date == Day.today }
        return mine.first { $0.completedAt == nil } ?? mine.first
    }

    @ViewBuilder
    private var todaySession: some View {
        if let w = todayWorkout {
            let starts = w.startsAt.flatMap { Day.at(Date(), time: $0) }
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Eyebrow(text: "Today · Session")
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
                Text([w.startsAt, "with \(coachName)"].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(JK.secondary)
                if let location = w.location, !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(JK.secondary)
                }
                Text("\(w.doneCount) of \(w.itemCount) exercises done").font(.caption2).foregroundStyle(JK.tertiary)
                HStack(spacing: 8) {
                    NavigationLink { WorkoutDetailLoader(workoutId: w.id) } label: {
                        Label("Open workout", systemImage: "play.fill")
                    }
                    .buttonStyle(ChromeButtonStyle())
                    NavigationLink {
                        MessagesThreadView(clientId: nil, otherName: coachName, subtitle: "About today's session")
                    } label: {
                        Image(systemName: "bubble.left").frame(width: 22)
                    }
                    .buttonStyle(GhostButtonStyle())
                    .frame(width: 52)
                }
            }
            .jkCard()
        } else {
            EmptyCard(systemName: "figure.cooldown", title: "No session today",
                      detail: "Rest, walk, and hit your habits. Your plan shows what's next.")
        }
    }

    private var streakTile: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "Streak")
            HStack(alignment: .bottom) {
                Text("\(habits?.streak ?? 0)").font(.title.weight(.semibold))
                    + Text(" days").font(.caption).foregroundColor(JK.tertiary)
                Spacer()
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(Array(weekBars.enumerated()), id: \.offset) { _, h in
                        Capsule().fill(JK.text).frame(width: 3, height: h)
                    }
                }
            }
            .foregroundStyle(JK.text)
        }
        .jkCard()
    }

    /// One bar per day this week: tall when a workout was completed, short
    /// when one was planned, a stub when nothing was.
    private var weekBars: [CGFloat] {
        Day.week(of: Date()).map { day in
            let key = Day.string(day)
            let mine = (week ?? []).filter { $0.date == key }
            if mine.contains(where: { $0.completedAt != nil }) { return 24 }
            return mine.isEmpty ? 4 : 12
        }
    }

    private var weekTile: some View {
        let planned = (week ?? []).count
        let done = (week ?? []).filter { $0.completedAt != nil }.count
        return HStack {
            ZStack {
                Circle().stroke(JK.track, lineWidth: 5)
                Circle().trim(from: 0, to: planned == 0 ? 0 : Double(done) / Double(planned))
                    .stroke(JK.text, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
            }
            .frame(width: 40, height: 40)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Eyebrow(text: "This week")
                Text("\(done)/\(planned)").font(.title2.weight(.semibold)).foregroundStyle(JK.text)
            }
        }
        .jkCard()
    }

    @ViewBuilder
    private var upcoming: some View {
        let items = Array((bookings ?? []).filter { $0.end > Date() && $0.isMine }.sorted { $0.start < $1.start }.prefix(3))
        if items.isEmpty {
            NavigationLink { BookSessionView() } label: {
                EmptyCard(systemName: "calendar.badge.plus", title: "Nothing booked", detail: "Tap to book a session")
            }
        } else {
            VStack(spacing: 0) {
                ForEach(items) { b in
                    NavigationLink { MyCalendarView(initialDay: b.start, embedded: true) } label: {
                        UpcomingRow(weekday: Fmt.weekday(b.start), day: "\(Day.calendar.component(.day, from: b.start))",
                                    title: b.title ?? b.kindLabel,
                                    detail: [Fmt.time(b.start), b.location].compactMap { $0 }.joined(separator: " · "))
                    }
                    if b.id != items.last?.id { Divider().overlay(JK.stroke) }
                }
            }
            .jkCard(padding: 4)
        }
    }

    private var membershipCard: some View {
        let m = session.me?.membership
        let active = m?.isActive == true
        var detail: [String] = []
        if active, let renews = m?.renewsOn { detail.append("Renews \(Fmt.dayMonth(renews))") }
        if active, let left = m?.creditsLeft, let total = m?.creditsTotal, total > 0 { detail.append("\(left) of \(total) credits") }
        if !active { detail.append("Choose a plan to unlock coaching") }
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(active ? "\(m?.displayName ?? "") membership" : "No membership").font(.subheadline.weight(.semibold))
                Text(detail.joined(separator: " · ")).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            Text(active ? "Active" : "Choose")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(JK.cardRaised, in: Capsule())
        }
        .foregroundStyle(JK.text)
        .jkCard()
    }
}

struct UpcomingRow: View {
    let weekday: String
    let day: String
    let title: String
    let detail: String

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
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
        }
        .padding(12)
    }
}

private struct HomeLink<Destination: View>: View {
    let title: String
    let detail: String
    let systemName: String
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                IconTile(systemName: systemName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
            }
            .jkCard(padding: 12)
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
