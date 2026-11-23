import SwiftUI
import UIKit

/// One habit on Today: a 24pt glyph above its rule segment in a 56pt touch
/// target (scaled up to 72pt), with a caption. State is carried by shape as
/// well as colour: done is the filled glyph in champagne.
struct HabitMark: View {
    enum MarkState: Equatable {
        case idle
        /// 0...1 of the day's target.
        case partial(Double)
        case done
        /// JK granted a rest day: dimmed glyph, no segment, label "Rest".
        case rest
    }

    let key: IconKey
    let name: String
    let state: MarkState
    /// "2 of 3 glasses": the VoiceOver value.
    var valueText: String? = nil
    /// Filled from Apple Health: a 10pt heart badge.
    var fromHealth = false
    var onTap: () -> Void = {}
    var onLongPress: (() -> Void)? = nil

    @ScaledMetric(relativeTo: .body) private var target: CGFloat = JK.Size.habitMark
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var isDone: Bool { state == .done }
    private var fraction: Double {
        switch state {
        case .idle, .rest: return 0
        case .partial(let f): return min(max(f, 0), 1)
        case .done: return 1
        }
    }

    var body: some View {
        let side = min(target, JK.Size.habitMarkMax)
        Button {
            if !reduceMotion { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            onTap()
        } label: {
            VStack(spacing: JK.Space.xs) {
                ZStack(alignment: .topTrailing) {
                    Icon(key: key, filled: isDone, size: JK.Size.iconHabit)
                        .foregroundStyle(isDone ? JK.silver : JK.textSecondary)
                        .opacity(state == .rest ? 0.45 : 1)
                        .frame(width: side, height: side * 0.62)
                    if fromHealth {
                        Image(systemName: IconKey.fromHealth.symbol)
                            .font(.system(size: JK.Size.iconBadge))
                            .foregroundStyle(JK.textSecondary)
                            .offset(x: -JK.Space.s, y: JK.Space.xs)
                    }
                }
                HabitSegment(fraction: fraction, hidden: state == .rest)
                    .frame(width: side * 0.6)
                Text(state == .rest ? "Rest" : name)
                    .font(.jkCaption)
                    .foregroundStyle(isDone ? JK.silver : JK.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(minWidth: side, minHeight: side)
            .contentShape(Rectangle())
            .animation(JK.Motion.respecting(reduceMotion, JK.Motion.tick), value: state)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(LongPressGesture().onEnded { _ in onLongPress?() })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue(accessibilityValue)
        .accessibilityAddTraits(isDone ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(isDone ? "Double tap to untick." : "Double tap to tick.")
    }

    private var accessibilityValue: String {
        var parts: [String] = []
        switch state {
        case .done: parts.append(valueText ?? "Done")
        case .rest: parts.append("Rest day")
        case .idle, .partial: parts.append(valueText ?? "Not done")
        }
        if fromHealth { parts.append("from Apple Health") }
        return parts.joined(separator: ", ")
    }
}

/// One habit's part of the shared 2pt rule.
struct HabitSegment: View {
    let fraction: Double
    var hidden = false

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(JK.track)
                Rectangle().fill(JK.silver).frame(width: geo.size.width * fraction)
            }
        }
        .frame(height: JK.Size.rule)
        .opacity(hidden ? 0 : 1)
        .accessibilityHidden(true)
    }
}

/// The shared 2pt rule under a row of habits, one segment per habit.
struct HabitRule: View {
    let fractions: [Double]

    var body: some View {
        HStack(spacing: JK.Space.xs) {
            ForEach(fractions.indices, id: \.self) { i in
                HabitSegment(fraction: min(max(fractions[i], 0), 1))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Seven columns with a 6pt dot: done (champagne fill), not done (1.5pt
/// trackStrong outline), today (1.5pt text-colour ring), rest (no dot).
/// Shared by Today, the letter and the coach grid.
struct WeekDots: View {
    enum DayState: Equatable { case done, notDone, rest, future }

    struct Entry: Identifiable, Equatable {
        let id: String
        /// "M", "T"…
        let initial: String
        /// For VoiceOver: "Monday".
        let name: String
        let state: DayState
        var isToday = false
    }

    let days: [Entry]
    var showInitials = true
    var onSelect: ((Entry) -> Void)? = nil

    var body: some View {
        HStack(spacing: 0) {
            ForEach(days) { day in
                Button {
                    onSelect?(day)
                } label: {
                    VStack(spacing: JK.Space.xs) {
                        if showInitials {
                            Text(day.initial)
                                .font(.jkCaption)
                                .foregroundStyle(day.isToday ? JK.text : JK.textSecondary)
                        }
                        dot(day).frame(width: 14, height: 14)
                    }
                    .frame(maxWidth: .infinity, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(onSelect == nil)
                .accessibilityLabel(day.name)
                .accessibilityValue(value(day))
            }
        }
    }

    @ViewBuilder
    private func dot(_ day: Entry) -> some View {
        let d = JK.Size.weekDot
        ZStack {
            switch day.state {
            case .done: Circle().fill(JK.silver).frame(width: d, height: d)
            case .notDone: Circle().strokeBorder(JK.trackStrong, lineWidth: 1.5).frame(width: d + 1, height: d + 1)
            case .future: Circle().fill(JK.track).frame(width: d, height: d)
            case .rest: EmptyView()
            }
            if day.isToday {
                Circle().strokeBorder(JK.text, lineWidth: 1.5).frame(width: d + 6, height: d + 6)
            }
        }
    }

    private func value(_ day: Entry) -> String {
        let state: String
        switch day.state {
        case .done: state = "Day done"
        case .notDone: state = "Not done"
        case .rest: state = "Rest day"
        case .future: state = "To come"
        }
        return day.isToday ? "Today, \(state.lowercased())" : state
    }
}
