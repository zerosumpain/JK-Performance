import SwiftUI

/// Today's habits in detail (atelier-spec.md, Client screens 2): one row per
/// habit with today's value, a stepper for count habits, the last seven days
/// and one consistency figure. On plans with 'nutrition' the Fuel habit holds
/// the nutrition view.
struct HabitSheet: View {
    /// The habit a long-press opened the sheet for.
    var focus: String? = nil

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var data: HabitsResponse?
    @State private var history: HabitHistory?
    @State private var error: String?
    @State private var actionError: String?
    @State private var logging = false
    @State private var toast: String?

    private var api: APIClient { APIClient.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: JK.Space.xxl) {
                        Loadable(value: data, error: error, retry: load) { d in
                            summary(d)
                            ForEach(d.habits) { h in
                                VStack(alignment: .leading, spacing: JK.Space.l) {
                                    HabitDetailRow(habit: h, rest: d.rest != nil, history: history?.habits.first { $0.id == h.id },
                                                   onSet: { input in Task { await set(h, input) } },
                                                   onHealth: { toast = "Updates from Apple Health" })
                                    if isFuel(h, in: d) { FuelPanel(nutrition: d.nutrition, hasTargets: hasTargets(d)) { logging = true } onDelete: { e in Task { await deleteEntry(e) } } }
                                }
                                .id(h.id)
                                GroupDivider(inset: 0)
                            }
                            if d.habits.isEmpty {
                                EmptyState(line: "JK will set your habits with you.")
                            }
                            if gate.nutrition && !d.habits.contains(where: { isFuel($0, in: d) }) {
                                FuelPanel(nutrition: d.nutrition, hasTargets: hasTargets(d)) { logging = true } onDelete: { e in Task { await deleteEntry(e) } }
                            }
                            restFoot(d)
                        }
                    }
                    .padding(JK.Space.gutter)
                }
                .onChange(of: data?.habits.count) { _, _ in
                    if let focus { withAnimation { proxy.scrollTo(focus, anchor: .top) } }
                }
            }
            .jkScreen()
            .navigationTitle("Habits")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
            .sheet(isPresented: $logging) {
                FoodLogSheet { input in
                    let fresh: Nutrition = try await api.send("POST", "/api/nutrition/entries", body: input)
                    replaceNutrition(fresh)
                }
            }
            .jkToast($toast)
            .errorAlert($actionError)
        }
    }

    private func summary(_ d: HabitsResponse) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            if d.dayDone == true {
                Text("Day done").font(.jkHeadline).foregroundStyle(JK.silver)
            }
            if let minimum = d.dayMinimum {
                Text("A day counts once you hit JK's minimum: \(minimum) of \(d.habits.count).")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if let c = d.consistency {
                Text(c.label).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func restFoot(_ d: HabitsResponse) -> some View {
        if let rest = d.rest {
            Text("JK gave you today off" + (rest.reason.map { ". \($0)" } ?? "."))
                .font(.jkCallout).foregroundStyle(JK.textSecondary)
        } else if gate.messaging {
            Button("Ask JK for a rest day") {
                TabRouter.shared.composerDraft = "Could I take a rest day on "
                dismiss()
                TabRouter.shared.openJK(after: 0.45)
            }
            .buttonStyle(TextButtonStyle())
        }
    }

    /// The Fuel habit: the protein glyph, on plans with 'nutrition'.
    private func isFuel(_ h: Habit, in d: HabitsResponse) -> Bool {
        gate.nutrition && h.key == .protein && d.habits.first(where: { $0.key == .protein })?.id == h.id
    }

    private func hasTargets(_ d: HabitsResponse) -> Bool {
        gate.hasMacroTargets ?? (d.nutrition.targets != nil)
    }

    private func replaceNutrition(_ fresh: Nutrition) {
        guard var current = data else { return }
        current = HabitsResponse(date: current.date, habits: current.habits, streak: current.streak, nutrition: fresh,
                                 dayDone: current.dayDone, doneCount: current.doneCount, dayMinimum: current.dayMinimum,
                                 rest: current.rest, consistency: current.consistency, missedYesterday: current.missedYesterday)
        data = current
    }

    private func load() async {
        do {
            data = try await api.get("/api/habits", query: ["date": Day.today])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
        if let h: HabitHistory = try? await api.get("/api/habits/history") { history = h }
    }

    private func set(_ habit: Habit, _ input: HabitDayInput) async {
        do {
            let _: Habit = try await api.send("PUT", "/api/habits/\(seg(habit.id))/days/\(Day.today)", body: input)
            if let again: HabitsResponse = try? await api.get("/api/habits", query: ["date": Day.today]) { data = again }
            if let h: HabitHistory = try? await api.get("/api/habits/history") { history = h }
        } catch {
            actionError = error.readable
        }
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

/// One habit: glyph, name, today's value (a stepper for count habits, a tick
/// for the rest), seven dots and its consistency figure.
private struct HabitDetailRow: View {
    let habit: Habit
    let rest: Bool
    let history: HabitHistoryEntry?
    let onSet: (HabitDayInput) -> Void
    let onHealth: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            AdaptiveStack(verticalAlignment: .center) {
                HStack(spacing: JK.Space.m) {
                    Icon(key: habit.key, filled: habit.done, size: JK.Size.iconHabit)
                        .foregroundStyle(habit.done ? JK.silver : JK.textSecondary)
                    VStack(alignment: .leading, spacing: JK.Space.xs) {
                        Text(habit.name).font(.jkHeadline).foregroundStyle(JK.text)
                        Text(HabitText.value(habit) + (habit.fromHealth ? " · from Apple Health" : ""))
                            .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                control
            }
            if let history {
                HStack(spacing: JK.Space.m) {
                    WeekDots(days: Self.lastSeven(history), showInitials: false)
                        .frame(maxWidth: 180)
                    Spacer(minLength: 0)
                    if let label = Self.consistency(history) {
                        Text(label).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var control: some View {
        if habit.fromHealth {
            Button("From Health", action: onHealth).buttonStyle(SmallPillStyle())
        } else if habit.isCount {
            HStack(spacing: JK.Space.s) {
                Button {
                    onSet(HabitDayInput(value: max(0, (habit.value ?? 0) - habit.increment), done: nil))
                } label: { Image(systemName: "minus").font(.jkCaption) }
                .buttonStyle(SmallPillStyle())
                .accessibilityLabel("Less \(habit.name)")
                .disabled((habit.value ?? 0) <= 0)
                Button {
                    onSet(HabitDayInput(value: (habit.value ?? 0) + habit.increment, done: nil))
                } label: { Image(systemName: IconKey.add.symbol).font(.jkCaption) }
                .buttonStyle(SmallPillStyle())
                .accessibilityLabel("More \(habit.name)")
            }
        } else {
            Button(habit.done ? "Done" : "Tick") {
                onSet(HabitDayInput(value: nil, done: !habit.done))
            }
            .buttonStyle(SmallPillStyle())
            .accessibilityLabel(habit.done ? "Untick \(habit.name)" : "Tick \(habit.name)")
        }
    }

    static func lastSeven(_ h: HabitHistoryEntry) -> [WeekDots.Entry] {
        h.days.suffix(7).map { d in
            WeekDots.Entry(day: d.date, done: d.done == true, rest: d.rest == true, future: false, isToday: d.date == Day.today)
        }
    }

    /// "22 of the last 28 days" over the days that were not rest days.
    static func consistency(_ h: HabitHistoryEntry) -> String? {
        let counted = h.days.filter { $0.rest != true }
        guard !counted.isEmpty else { return nil }
        return "\(counted.filter { $0.done == true }.count) of the last \(counted.count) days"
    }
}

/// The nutrition view under the Fuel habit: the kcal ring (only once JK has set
/// targets), three macro bars, today's food and "Log food". Over target is a
/// plain sentence, never red.
struct FuelPanel: View {
    let nutrition: Nutrition
    let hasTargets: Bool
    let onLog: () -> Void
    var onDelete: (FoodEntry) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            if hasTargets, let t = nutrition.targets {
                AdaptiveStack(verticalAlignment: .center, spacing: JK.Space.xl) {
                    kcalRing(t)
                    VStack(spacing: JK.Space.m) {
                        MacroBar(name: "Protein", value: nutrition.totals.protein, target: t.protein)
                        MacroBar(name: "Carbs", value: nutrition.totals.carbs, target: t.carbs)
                        MacroBar(name: "Fat", value: nutrition.totals.fat, target: t.fat)
                    }
                }
                if nutrition.totals.kcal > t.kcal {
                    Text("Over by \(Fmt.number(nutrition.totals.kcal - t.kcal, digits: 0)) kcal")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            } else {
                Text("JK will set your targets").jkText(.quoteSmall).foregroundStyle(JK.text)
                Text("\(Fmt.number(nutrition.totals.kcal, digits: 0)) kcal · \(Fmt.number(nutrition.totals.protein, digits: 0)) g protein today")
                    .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
            foods
            Button("Log food", action: onLog).buttonStyle(SecondaryButtonStyle())
        }
        .surface(.card)
    }

    private func kcalRing(_ t: Macros) -> some View {
        ZStack {
            Ring(fraction: t.kcal > 0 ? nutrition.totals.kcal / t.kcal : 0, lineWidth: 6, fill: JK.text)
            VStack(spacing: 0) {
                Text(Fmt.number(nutrition.totals.kcal, digits: 0)).font(.jkHeadline.monospacedDigit()).foregroundStyle(JK.text)
                Text("of \(Fmt.number(t.kcal, digits: 0))").font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
        }
        .frame(width: 96, height: 96)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Calories")
        .accessibilityValue("\(Fmt.number(nutrition.totals.kcal, digits: 0)) of \(Fmt.number(t.kcal, digits: 0)) kcal")
    }

    @ViewBuilder
    private var foods: some View {
        if !nutrition.entries.isEmpty {
            VStack(spacing: JK.Space.s) {
                ForEach(nutrition.entries) { entry in
                    HStack {
                        Text(entry.name).font(.jkCallout).foregroundStyle(JK.text)
                        Spacer()
                        Text("\(Fmt.number(entry.kcal, digits: 0)) kcal").font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                        Button { onDelete(entry) } label: {
                            Image(systemName: "xmark").font(.jkCaption).foregroundStyle(JK.textSecondary)
                                .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove \(entry.name)")
                    }
                }
            }
        }
    }
}

/// One macro: name, value of target, and a measure bar (text colour, not champagne).
private struct MacroBar: View {
    let name: String
    let value: Double
    let target: Double

    var body: some View {
        VStack(spacing: JK.Space.xs) {
            HStack {
                Text(name).font(.jkCaption).foregroundStyle(JK.textSecondary)
                Spacer()
                Text("\(Fmt.number(value, digits: 0)) of \(Fmt.number(target, digits: 0)) g")
                    .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(JK.track)
                    Rectangle().fill(JK.text).frame(width: geo.size.width * (target > 0 ? min(value / target, 1) : 0))
                }
            }
            .frame(height: JK.Size.rule)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
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
                VStack(alignment: .leading, spacing: JK.Space.m) {
                    JKField(label: "Food", text: $name, prompt: "Chicken, rice and greens")
                    JKField(label: "Calories (kcal)", text: $kcal, prompt: "0", keyboard: .numberPad)
                    AdaptiveStack(spacing: JK.Space.s) {
                        JKField(label: "Protein (g)", text: $protein, prompt: "0", keyboard: .decimalPad)
                        JKField(label: "Carbs (g)", text: $carbs, prompt: "0", keyboard: .decimalPad)
                        JKField(label: "Fat (g)", text: $fat, prompt: "0", keyboard: .decimalPad)
                    }
                    if let error { ErrorBanner(message: error) }
                    PrimaryButton("Log food", busy: saving) { Task { await submit() } }
                        .disabled(!valid)
                }
                .padding(JK.Space.gutter)
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
