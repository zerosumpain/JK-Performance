import Charts
import PhotosUI
import SwiftUI

/// The Progress tab (plans with 'progress').
struct ProgressTab: View {
    var body: some View {
        NavigationStack {
            ProgressScreen().clientRoutes()
        }
    }
}

/// Progress in three levels of detail (atelier-spec.md, Client screens 6):
/// the goal and three tiles; a tile's eight-week trend; then habit history,
/// best lifts, measurements and photos (and Challenges when JK turns them on).
/// Named ProgressScreen because SwiftUI already owns `ProgressView`.
struct ProgressScreen: View {
    @Environment(AppSession.self) private var session
    @State private var goal: GoalResponse?
    @State private var progress: ProgressData?
    @State private var history: HabitHistory?
    @State private var photos: [Photo]?
    @State private var error: String?
    @State private var actionError: String?
    @State private var measuring = false
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false
    @State private var trend: TrendKind?

    private var api: APIClient { APIClient.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.section) {
                Text("Progress").jkText(.display).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                Loadable(value: progress, error: error, retry: load) { p in
                    hero
                    tiles(p)
                    habitHistory
                    lifts(p)
                    measurements(p)
                    photosSection
                    if gate.challenges {
                        NavigationLink(value: ClientRoute.challenges) {
                            ProgressRow(icon: .record, title: "Challenges", detail: "Walk, run or row with the group")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .task { await loadPhotos() }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .sheet(isPresented: $measuring) {
            MeasurementSheet { input in
                let _: ProgressData = try await api.send("POST", "/api/measurements", body: input)
                await load()
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $trend) { kind in
            TrendSheet(kind: kind, goal: goal?.goal, progress: progress, history: history, strength: strength)
                .presentationDetents([.medium, .large])
        }
        .errorAlert($actionError)
    }

    // MARK: Level 1

    @ViewBuilder
    private var hero: some View {
        if let g = goal?.goal {
            GoalHero(goal: g)
        } else if goal?.pending == true {
            GoalLine(state: .notSet)
        }
    }

    private func tiles(_ p: ProgressData) -> some View {
        AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.s) {
            if let g = goal?.goal {
                tile(.goal) {
                    MetricTile(label: "Goal", value: g.remainingLabel ?? (g.isReached ? "Reached" : "–"),
                               status: g.onTrack.map { $0 ? "On track" : "Worth a look" }, source: g.sourceLabel)
                }
            }
            if let c = history?.consistency {
                tile(.consistency) {
                    MetricTile(label: "Consistency", value: "\(c.done) of \(c.days)",
                               status: ConsistencyText.status(c), trend: consistencyTrend, source: "Days at JK's minimum")
                }
            }
            if bodyGoal, let bodyMetric = bodyTile(p) {
                tile(.body) { bodyMetric }
            } else if let s = strength {
                tile(.strength) {
                    MetricTile(label: "Strength", value: Fmt.delta(s.percent, digits: 0) + "%",
                               trend: s.percent > 0 ? .up : .flat, source: s.since.map { "Best lifts since \($0)" } ?? "Best logged lifts")
                }
            }
        }
    }

    private func tile<Content: View>(_ kind: TrendKind, @ViewBuilder _ content: () -> Content) -> some View {
        Button { trend = kind } label: { content() }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the eight-week trend")
    }

    /// Fat-loss goals show Body instead of Strength.
    private var bodyGoal: Bool { ["weight", "waist"].contains(goal?.goal?.metric ?? "") }

    private func bodyTile(_ p: ProgressData) -> MetricTile? {
        if let waist = p.stats.first(where: { $0.kind == "waist" }), let d = waist.delta {
            return MetricTile(label: "Body", value: "Waist \(Fmt.delta(d)) cm", trend: d < 0 ? .down : d > 0 ? .up : .flat,
                              source: "From your measurements")
        }
        if let d = p.weight?.delta {
            return MetricTile(label: "Body", value: "\(Fmt.delta(d)) kg", trend: d < 0 ? .down : d > 0 ? .up : .flat,
                              source: "From your weigh-ins")
        }
        return nil
    }

    /// "+12% since July": the best lifts against where each started.
    private var strength: StrengthSummary? {
        guard let records = progress?.records else { return nil }
        let withGain = records.filter { ($0.gain ?? 0) > 0 && $0.kg > ($0.gain ?? 0) }
        guard !withGain.isEmpty else { return nil }
        let start = withGain.reduce(0) { $0 + ($1.kg - ($1.gain ?? 0)) }
        let gain = withGain.reduce(0) { $0 + ($1.gain ?? 0) }
        let since = progress?.since.flatMap(Day.date).map(Fmt.month)
        return StrengthSummary(percent: start > 0 ? gain / start * 100 : 0, since: since)
    }

    private var consistencyTrend: MetricTile.Trend? {
        let rates = (history?.habits ?? []).compactMap { h -> (Double, Double)? in
            guard let now = h.rate7, let before = h.rate7Prev else { return nil }
            return (now, before)
        }
        guard !rates.isEmpty else { return nil }
        let change = rates.reduce(0) { $0 + $1.0 - $1.1 } / Double(rates.count)
        return change > 0.05 ? .up : change < -0.05 ? .down : .flat
    }

    // MARK: Level 3

    @ViewBuilder
    private var habitHistory: some View {
        if gate.habits, let habits = history?.habits, !habits.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                Text("Habit history").font(.jkHeadline).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                ForEach(habits) { h in HabitHistoryRow(habit: h) }
            }
        }
    }

    @ViewBuilder
    private func lifts(_ p: ProgressData) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            Text("Your best lifts").font(.jkHeadline).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
            if p.records.isEmpty {
                Text("Log sets in your sessions and your bests appear here.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(p.records, id: \.exercise) { pr in
                        LiftRow(record: pr)
                        if pr.exercise != p.records.last?.exercise { GroupDivider() }
                    }
                }
                .surface(.group)
            }
        }
    }

    private func measurements(_ p: ProgressData) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            HStack {
                Text("Measurements").font(.jkHeadline).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Add measurement") { measuring = true }.buttonStyle(TextButtonStyle())
            }
            if let w = p.weight?.latest {
                MeasureRow(label: "Weight", value: "\(Fmt.number(w)) kg", delta: p.weight?.delta.map { "\(Fmt.delta($0)) kg" })
            }
            ForEach(p.stats, id: \.kind) { s in
                if let latest = s.latest {
                    MeasureRow(label: Measure.label(s.kind), value: Fmt.number(latest) + Measure.unit(s.kind),
                               delta: s.delta.map { Fmt.delta($0) + Measure.unit(s.kind) })
                }
            }
        }
    }

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            HStack {
                Text("Photos").font(.jkHeadline).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                Spacer()
                Label("Private to you and JK", systemImage: IconKey.lock.symbol).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            HStack(spacing: JK.Space.s) {
                ForEach((photos ?? []).suffix(3)) { photo in
                    AuthedPhoto(photo: photo)
                        .frame(height: 96)
                        .contextMenu {
                            Button(role: .destructive) { Task { await delete(photo) } } label: {
                                Label("Delete photo", systemImage: "trash")
                            }
                        }
                }
                PhotosPicker(selection: $picked, matching: .images) {
                    Group {
                        if uploading { ProgressView().tint(JK.textSecondary) } else { Icon(key: .mealPhoto) }
                    }
                    .foregroundStyle(JK.textSecondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous)
                        .strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                }
                .frame(height: 96)
                .accessibilityLabel("Add a progress photo")
                .disabled(uploading)
            }
        }
    }

    // MARK: Loading

    private func load() async {
        async let g: GoalResponse = api.get("/api/goal")
        async let p: ProgressData = api.get("/api/progress", query: ["range": "6m"])
        do {
            progress = try await p
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
        goal = try? await g
        if gate.habits {
            let from = Day.string(Day.add(-55, to: Date()))
            history = try? await api.get("/api/habits/history", query: ["from": from, "to": Day.today])
        }
    }

    private func loadPhotos() async {
        do {
            let reply: PhotosResponse = try await api.get("/api/photos")
            photos = reply.photos.sorted { $0.date < $1.date }
        } catch {
            if !error.isCancellation { photos = photos ?? [] }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        defer {
            uploading = false
            picked = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = image.jpegForUpload() else {
                actionError = "Couldn't read that photo."
                return
            }
            let photo: Photo = try await api.upload("/api/photos", data: jpeg, contentType: "image/jpeg", query: ["date": Day.today])
            photos = (photos ?? []) + [photo]
        } catch {
            actionError = error.readable
        }
    }

    private func delete(_ photo: Photo) async {
        do {
            let _: OK = try await api.send("DELETE", "/api/photos/\(seg(photo.id))")
            photos?.removeAll { $0.id == photo.id }
        } catch {
            actionError = error.readable
        }
    }
}

struct StrengthSummary {
    let percent: Double
    let since: String?
}

enum TrendKind: String, Identifiable {
    case goal, consistency, strength, body
    var id: String { rawValue }
}

enum ConsistencyText {
    /// A word, never a colour: On track, Steady or Worth a look.
    static func status(_ c: Consistency) -> String {
        guard c.days > 0 else { return "Steady" }
        let rate = Double(c.done) / Double(c.days)
        return rate >= 0.75 ? "On track" : rate >= 0.5 ? "Steady" : "Worth a look"
    }
}

/// Measurement names and units.
enum Measure {
    static func label(_ kind: String) -> String {
        switch kind {
        case "bodyFat": return "Body fat"
        case "waist": return "Waist"
        case "restingHr": return "Resting HR"
        case "weight": return "Weight"
        default: return kind
        }
    }

    static func unit(_ kind: String) -> String {
        switch kind {
        case "bodyFat": return "%"
        case "waist": return " cm"
        case "weight": return " kg"
        case "restingHr": return " bpm"
        default: return ""
        }
    }
}

// MARK: - Parts

/// The goal at the top of Progress: the serif sentence, a 120pt open ring,
/// the change in light tabular figures, start, now and target, the week line
/// and where the number comes from.
struct GoalHero: View {
    let goal: Goal

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            Text(goal.title).jkText(.title).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
            AdaptiveStack(verticalAlignment: .center, spacing: JK.Space.xl) {
                ZStack {
                    Ring(fraction: goal.fraction, sweep: 300, lineWidth: 8,
                         fill: goal.onTrack == false ? JK.text : JK.accent)
                    Text("\(Int((goal.fraction * 100).rounded()))%")
                        .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
                .frame(width: 120, height: 120)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Progress to your goal")
                .accessibilityValue("\(Int((goal.fraction * 100).rounded())) percent")
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    if let delta = goal.delta {
                        Text(Fmt.delta(delta) + (goal.unit.map { " \($0)" } ?? ""))
                            .jkText(.numberHero).foregroundStyle(JK.text)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                    Text(figures).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    if let w = goal.weekOf {
                        Text("Week \(w.week) of \(w.weeks)" + (goal.chapterName.map { " · \($0)" } ?? ""))
                            .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                    }
                }
            }
            if let source = goal.sourceLabel {
                Text(source).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
    }

    private var figures: String {
        let unit = goal.unit.map { " \($0)" } ?? ""
        let parts = [goal.baseline.map { "Start \(Fmt.number($0))\(unit)" },
                     goal.current.map { "Now \(Fmt.number($0))\(unit)" },
                     goal.target.map { "Target \(Fmt.number($0))\(unit)" }].compactMap { $0 }
        return parts.joined(separator: " · ")
    }
}

/// One habit over time: glyph, name, its last seven days, the consistency
/// figure and the change on last week (a glyph, never red).
struct HabitHistoryRow: View {
    let habit: HabitHistoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            HStack(spacing: JK.Space.m) {
                Icon(key: habit.key).foregroundStyle(JK.textSecondary)
                Text(habit.name).font(.jkCallout).foregroundStyle(JK.text)
                Spacer()
                if let change {
                    Icon(key: change > 0 ? .trendUp : change < 0 ? .trendDown : .trendFlat, size: 13)
                        .foregroundStyle(JK.textSecondary)
                        .accessibilityLabel(change > 0 ? "Up on last week" : change < 0 ? "Down on last week" : "Same as last week")
                }
            }
            HStack {
                WeekDots(days: habit.days.suffix(7).map {
                    WeekDots.Entry(day: $0.date, done: $0.done == true, rest: $0.rest == true, future: false, isToday: $0.date == Day.today)
                }, showInitials: false)
                .frame(maxWidth: 200)
                Spacer()
                Text(figure).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
        }
        .surface(.card, padding: JK.Space.l)
    }

    private var change: Double? {
        guard let now = habit.rate7, let before = habit.rate7Prev else { return nil }
        let d = now - before
        return abs(d) < 0.01 ? 0 : d
    }

    private var figure: String {
        let days = habit.days.suffix(28).filter { $0.rest != true }
        return "\(days.filter { $0.done == true }.count) of the last \(days.count) days"
    }
}

private struct LiftRow: View {
    let record: PersonalRecord

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Icon(key: .record, filled: record.isNewThisWeek == true)
                .foregroundStyle(record.isNewThisWeek == true ? JK.accent : JK.textSecondary)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(record.exercise).font(.jkCallout).foregroundStyle(JK.text)
                if record.isNewThisWeek == true {
                    Text("New best this week").font(.jkCaption).foregroundStyle(JK.accent)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(Fmt.number(record.kg)) kg").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                if let gain = record.gain {
                    Text("\(Fmt.delta(gain)) kg").font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
            }
        }
        .padding(JK.Space.l)
        .accessibilityElement(children: .combine)
    }
}

private struct MeasureRow: View {
    let label: String
    let value: String
    var delta: String?

    var body: some View {
        HStack {
            Text(label).font(.jkCallout).foregroundStyle(JK.textSecondary)
            Spacer()
            Text(value).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
            if let delta { Text(delta).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary) }
        }
        .frame(minHeight: JK.Size.touch)
        .accessibilityElement(children: .combine)
    }
}

struct ProgressRow: View {
    let icon: IconKey
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Icon(key: icon).foregroundStyle(JK.textSecondary)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(title).font(.jkHeadline).foregroundStyle(JK.text)
                Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            Spacer()
            Icon(key: .chevron, size: 13).foregroundStyle(JK.textSecondary)
        }
        .surface(.card, padding: JK.Space.l)
        .contentShape(Rectangle())
    }
}

// MARK: - Level 2: trends

/// One tile's eight weeks: a slate line, a dashed bone target, one baseline,
/// no fill, and what it is made from.
struct TrendSheet: View {
    let kind: TrendKind
    let goal: Goal?
    let progress: ProgressData?
    let history: HabitHistory?
    let strength: StrengthSummary?
    @Environment(\.dismiss) private var dismiss

    struct Point: Identifiable {
        let date: Date
        let value: Double
        var id: Date { date }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.l) {
                    chart
                    Text(madeFrom).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    if kind == .strength, let records = progress?.records {
                        ForEach(records.prefix(6), id: \.exercise) { r in
                            MeasureRow(label: r.exercise, value: "\(Fmt.number(r.kg)) kg", delta: r.gain.map { "\(Fmt.delta($0)) kg" })
                        }
                    }
                }
                .padding(JK.Space.gutter)
            }
            .jkScreen()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private var title: String {
        switch kind {
        case .goal: return "Goal"
        case .consistency: return "Consistency"
        case .strength: return "Strength"
        case .body: return "Body"
        }
    }

    private var eightWeeksAgo: Date { Day.add(-56, to: Date()) }

    private var points: [Point] {
        switch kind {
        case .goal, .body:
            return (progress?.weight?.series ?? []).compactMap { p in
                Day.date(p.date).map { Point(date: $0, value: p.value) }
            }.filter { $0.date >= eightWeeksAgo }
        case .consistency:
            // Days done per week (rest days left out), as a share.
            let days = history?.days ?? []
            var weeks: [Date: (done: Int, counted: Int)] = [:]
            for d in days where d.rest != true {
                guard let date = Day.date(d.date) else { continue }
                let start = Day.weekStart(date)
                var w = weeks[start] ?? (0, 0)
                w.counted += 1
                if d.dayDone == true { w.done += 1 }
                weeks[start] = w
            }
            return weeks.keys.sorted().map { k in
                let w = weeks[k]!
                return Point(date: k, value: w.counted > 0 ? Double(w.done) / Double(w.counted) * 100 : 0)
            }
        case .strength:
            return []
        }
    }

    private var target: Double? {
        switch kind {
        case .goal, .body: return goal?.metric == "weight" ? goal?.target : nil
        case .consistency: return 75
        case .strength: return nil
        }
    }

    @ViewBuilder
    private var chart: some View {
        let pts = points
        if pts.count >= 2 {
            let values = pts.map(\.value) + (target.map { [$0] } ?? [])
            let low = (values.min() ?? 0), high = (values.max() ?? 1)
            let pad = max((high - low) * 0.1, 0.5)
            Chart {
                ForEach(pts) { p in
                    LineMark(x: .value("Week", p.date), y: .value(title, p.value))
                        .foregroundStyle(JK.data)
                        .interpolationMethod(.monotone)
                }
                if let target {
                    RuleMark(y: .value("Target", target))
                        .foregroundStyle(JK.text)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                }
            }
            .chartYScale(domain: (low - pad)...(high + pad))
            .chartXAxis {
                AxisMarks(values: .stride(by: .weekOfYear, count: 2)) { _ in
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { _ in AxisValueLabel() }
            }
            .frame(minHeight: 200)
            .accessibilityLabel("\(title), the last eight weeks")
        } else if kind != .strength {
            Text("Not enough yet for a trend. A few more weeks and it appears here.")
                .jkText(.quoteSmall).foregroundStyle(JK.text)
        }
    }

    private var madeFrom: String {
        switch kind {
        case .goal: return goal?.sourceLabel ?? "From your weigh-ins"
        case .body: return "From your weigh-ins and measurements"
        case .consistency: return "Share of days each week you met JK's minimum; rest days left out. The dashed line is 75%, on track."
        case .strength: return strength?.since.map { "Your best logged loads, against where each lift started in \($0)." }
            ?? "Your best logged loads, against where each lift started."
        }
    }
}
