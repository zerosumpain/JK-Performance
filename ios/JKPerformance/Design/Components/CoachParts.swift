import Charts
import SwiftUI

// Coach-only components (atelier-spec.md, "Components › COACH"): the habit
// week grid, the goal card, sparklines and the plain rows a client's page
// links from. Status colours appear here only, never on client screens.

/// One row per habit: glyph, name, the last seven days as WeekDots, the
/// week's count and the change on last week (a glyph, never red).
struct HabitWeekGrid: View {
    let history: HabitHistory
    var restDays: [RestDay] = []

    /// The seven days shown, oldest first.
    private var days: [String] {
        let fromDays = history.days?.map(\.date) ?? []
        let fromHabit = history.habits.first?.days.map(\.date) ?? []
        return Array((fromDays.isEmpty ? fromHabit : fromDays).suffix(7))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            if history.habits.isEmpty {
                Text("No habits set yet.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            ForEach(history.habits) { habit in
                HabitWeekRow(habit: habit, days: days)
            }
            ForEach(restInWeek) { rest in
                HStack(spacing: JK.Space.s) {
                    Icon(key: .rest, size: 15).foregroundStyle(JK.textSecondary)
                    Text(restLine(rest)).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private var restInWeek: [RestDay] {
        let shown = Set(days)
        return restDays.filter { shown.contains($0.date) }
    }

    private func restLine(_ rest: RestDay) -> String {
        let day = Day.date(rest.date).map { Fmt.weekdayName($0) } ?? rest.date
        if let reason = rest.reason, !reason.isEmpty { return "Rest day \(day) · \(reason)" }
        return "Rest day \(day)"
    }
}

private struct HabitWeekRow: View {
    let habit: HabitHistoryEntry
    let days: [String]

    private var entries: [WeekDots.Entry] {
        let byDate = Dictionary(habit.days.map { ($0.date, $0) }, uniquingKeysWith: { first, _ in first })
        return days.map { d in
            let day = byDate[d]
            return WeekDots.Entry(day: d, done: day?.done == true, rest: day?.rest == true, future: false, isToday: d == Day.today)
        }
    }

    var body: some View {
        let list = entries
        let done = list.filter { $0.state == .done }.count
        let counted = list.filter { $0.state != .rest }.count
        AdaptiveStack(spacing: JK.Space.s) {
            HStack(spacing: JK.Space.s) {
                Icon(key: habit.key, size: JK.Size.iconInline).foregroundStyle(JK.textSecondary)
                Text(habit.name).font(.jkCallout).foregroundStyle(JK.text).lineLimit(1)
            }
            .frame(minWidth: 96, alignment: .leading)
            WeekDots(days: list, showInitials: false)
            HStack(spacing: JK.Space.xs) {
                Text("\(done) of \(counted)").font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                if let trend {
                    Icon(key: trend, size: 13, label: trendWord).foregroundStyle(JK.textSecondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(habit.name), \(done) of \(counted) days this week")
    }

    private var change: Double? {
        guard let now = habit.rate7, let before = habit.rate7Prev else { return nil }
        return now - before
    }

    private var trend: IconKey? {
        guard let change else { return nil }
        if change > 0.05 { return .trendUp }
        if change < -0.05 { return .trendDown }
        return .trendFlat
    }

    private var trendWord: String {
        switch trend {
        case .trendUp?: return "Up on last week"
        case .trendDown?: return "Down on last week"
        default: return "Level with last week"
        }
    }
}

/// The client's goal on the coach's overview: the sentence, start, now and
/// target, weeks left and a 44pt arc. A draft says where it came from.
struct GoalCard: View {
    let goal: Goal?
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            if let goal, !goal.isDraft {
                setGoal(goal)
                Button("Edit goal", action: onEdit).buttonStyle(TextButtonStyle())
            } else {
                Text(draftLine).jkText(.quoteSmall).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Set the goal", action: onEdit).buttonStyle(SecondaryButtonStyle())
            }
        }
        .surface(.card)
    }

    private var draftLine: String {
        guard let goal else { return "No goal yet. Set one with them." }
        return "Suggested from onboarding: \(goal.suggestion ?? goal.title). Set the goal."
    }

    private func setGoal(_ goal: Goal) -> some View {
        HStack(alignment: .top, spacing: JK.Space.l) {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(goal.title).jkText(.title).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
                Text(figures(goal)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                Text(progressLine(goal)).font(.jkCaption).foregroundStyle(JK.textSecondary)
                if let chapter = goal.chapterName, !chapter.isEmpty {
                    Text(chapter).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            Spacer(minLength: 0)
            Ring(fraction: goal.fraction, sweep: 300, lineWidth: 4, fill: JK.silver)
                .frame(width: 44, height: 44)
        }
        .accessibilityElement(children: .combine)
    }

    private func figures(_ goal: Goal) -> String {
        let unit = goal.unit.map { " \($0)" } ?? ""
        let parts: [String?] = [
            goal.baseline.map { "Start \(Fmt.number($0))" },
            goal.current.map { "Now \(Fmt.number($0))" },
            goal.target.map { "Target \(Fmt.number($0))\(unit)" },
        ]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    private func progressLine(_ goal: Goal) -> String {
        var parts: [String] = []
        if goal.isReached { parts.append("Reached") } else if let label = goal.remainingLabel { parts.append(label) }
        if let w = goal.weekOf {
            let left = max(0, w.weeks - w.week)
            parts.append(left == 1 ? "1 week left" : "\(left) weeks left")
        }
        if let onTrack = goal.onTrack { parts.append(onTrack ? "On track" : "Worth a look") }
        return parts.joined(separator: " · ")
    }
}

/// A 7-day line in slate, for the coach's health numbers.
struct Sparkline: View {
    let values: [Double?]

    var body: some View {
        let points = values.enumerated().compactMap { i, v in v.map { (i, $0) } }
        if points.count >= 2 {
            let ys = points.map(\.1)
            let low = ys.min() ?? 0, high = ys.max() ?? 1
            let pad = max((high - low) * 0.15, 1)
            Chart(points, id: \.0) { point in
                LineMark(x: .value("Day", point.0), y: .value("Value", point.1))
                    .foregroundStyle(JK.data)
                    .interpolationMethod(.monotone)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartYScale(domain: (low - pad)...(high + pad))
            .accessibilityHidden(true)
        } else {
            Rectangle().fill(JK.track).frame(height: JK.Size.hairline).accessibilityHidden(true)
        }
    }
}

/// A pushed coach page: a scrolling column under an inline title.
struct CoachSubpage<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                content()
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.vertical, JK.Space.l)
        }
        .jkScreen()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// A row in an inset group: glyph, title, optional detail, chevron.
struct CoachRowLabel: View {
    var icon: IconKey? = nil
    let title: String
    var detail: String? = nil
    var chevron = true

    var body: some View {
        HStack(spacing: JK.Space.m) {
            if let icon {
                Icon(key: icon).foregroundStyle(JK.textSecondary).frame(width: JK.Size.iconInline + 8)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.jkCallout).foregroundStyle(JK.text)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            Spacer(minLength: JK.Space.s)
            if chevron {
                Image(systemName: IconKey.chevron.symbol).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, JK.Space.l)
        .frame(maxWidth: .infinity, minHeight: JK.Size.touch + JK.Space.s, alignment: .leading)
        .contentShape(Rectangle())
    }
}

/// A section heading on coach pages: headline weight, sentence case.
struct CoachSectionTitle: View {
    let text: String
    var trailing: String? = nil

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.jkHeadline).foregroundStyle(JK.text)
            Spacer(minLength: JK.Space.s)
            if let trailing {
                Text(trailing).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The 7-dot habit week from a ClientSummary (done, not done, rest gap).
struct ClientWeekDots: View {
    let week: [HabitWeekDay]

    var body: some View {
        WeekDots(days: week.map { d in
            WeekDots.Entry(day: d.date, done: d.state == "done", rest: d.state == "rest", future: false,
                           isToday: d.date == Day.today)
        }, showInitials: false)
    }
}
