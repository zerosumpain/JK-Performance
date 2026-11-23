import SwiftUI
import UIKit

// The Plan. Act. Review. components (docs/design/plan-act-review.md, "Shapes
// and components"). Monochrome: silver on near-black, no colour. Every
// drawing here is decorative to VoiceOver unless it says otherwise; the
// screens state values in words.

// MARK: - Glyphs

/// The plan glyph: a diamond (a square on its point).
struct DiamondShape: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.midX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
        p.closeSubpath()
        return p
    }
}

/// Plan: a diamond outline (filled for the season's start).
struct DiamondGlyph: View {
    var size: CGFloat = 12
    var filled = false
    var color: Color = JK.text

    var body: some View {
        ZStack {
            DiamondShape().fill(filled ? color : JK.bg)
            DiamondShape().stroke(color, lineWidth: 1)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Review: a circle with a dot at its centre.
struct DottedCircleGlyph: View {
    var size: CGFloat = 13
    var color: Color = JK.text

    var body: some View {
        ZStack {
            Circle().fill(JK.bg)
            Circle().strokeBorder(color, lineWidth: 1)
            Circle().fill(color).frame(width: max(2, size * 0.26), height: max(2, size * 0.26))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Ring

/// The quiet ring (spec "Ring"): a 1.5pt stroke over the track, a silver arc
/// from 12 o'clock with round caps. Done is a full ring with a check inside;
/// missed is a dashed trackStrong ring. Fills animate over 400ms (instantly
/// with Reduce Motion). Named ProgressRing because `Ring` is the older arc.
struct ProgressRing<Center: View>: View {
    enum RingState: Equatable {
        case progress(Double)
        case done
        case missed
    }

    let state: RingState
    var size: CGFloat = JK.Size.ringHabit
    var showCheck = true
    @ViewBuilder var center: () -> Center

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    private var target: Double {
        switch state {
        case .progress(let f): return min(max(f, 0), 1)
        case .done: return 1
        case .missed: return 0
        }
    }

    var body: some View {
        ZStack {
            if state == .missed {
                Circle()
                    .inset(by: JK.Size.ringStroke / 2)
                    .stroke(JK.trackStrong, style: StrokeStyle(lineWidth: JK.Size.ringStroke, dash: [2, 3.5]))
            } else {
                Circle()
                    .inset(by: JK.Size.ringStroke / 2)
                    .stroke(JK.track, lineWidth: JK.Size.ringStroke)
                Circle()
                    .inset(by: JK.Size.ringStroke / 2)
                    .trim(from: 0, to: shown)
                    .stroke(JK.silver, style: StrokeStyle(lineWidth: JK.Size.ringStroke, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if state == .done && showCheck {
                    Image(systemName: "checkmark")
                        .font(.system(size: size * 0.3, weight: .light))
                        .foregroundStyle(JK.silver)
                }
            }
            center()
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onAppear { animate() }
        .onChange(of: state) { _, _ in animate() }
    }

    private func animate() {
        withAnimation(JK.Motion.respecting(reduceMotion, JK.Motion.ringFill)) { shown = target }
    }
}

extension ProgressRing where Center == EmptyView {
    init(state: RingState, size: CGFloat = JK.Size.ringHabit, showCheck: Bool = true) {
        self.init(state: state, size: size, showCheck: showCheck) { EmptyView() }
    }
}

/// One set in the session: filled with a check when logged, the next one
/// outlined in text colour, later ones in trackStrong.
struct SetCircle: View {
    enum SetState { case logged, next, later }

    let state: SetState
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            switch state {
            case .logged:
                Circle().fill(JK.silver)
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.36, weight: .medium))
                    .foregroundStyle(JK.onChrome)
            case .next:
                Circle().strokeBorder(JK.text, lineWidth: JK.Size.ringStroke)
            case .later:
                Circle().strokeBorder(JK.trackStrong, lineWidth: JK.Size.ringStroke)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Week dots and lines

/// Seven 5pt dots for one habit's week (Monday first): silver = done,
/// trackStrong outline = not done, faint = to come; today slightly larger.
struct HabitWeekDots: View {
    /// true done, false not done, nil to come (or before the habit existed).
    let week: [Bool?]
    /// 0 = Monday.
    var todayIndex: Int?

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { i in
                let d: CGFloat = i == todayIndex ? JK.Size.weekDot + 2 : JK.Size.weekDot
                let state: Bool? = i < week.count ? week[i] : nil
                Group {
                    switch state {
                    case true?: Circle().fill(JK.silver)
                    case false?: Circle().strokeBorder(JK.trackStrong, lineWidth: 1)
                    case nil: Circle().fill(JK.track)
                    }
                }
                .frame(width: d, height: d)
            }
        }
        .accessibilityHidden(true)
    }
}

/// This week as one line (screen 2): TODAY / PLAN / REVIEW above the days
/// they mark, a hairline with seven nodes, the day letters beneath.
struct WeekLine: View {
    enum Mark { case none, today, plan, review }

    struct Day: Identifiable {
        let id: Int
        let letter: String
        let mark: Mark
        let done: Bool
        let today: Bool
        /// "Monday", for VoiceOver.
        var name = ""
    }

    let days: [Day]

    var body: some View {
        VStack(spacing: JK.Space.s) {
            HStack(spacing: 0) {
                ForEach(days) { d in
                    Text(label(d))
                        .font(.jkTab)
                        .tracking(1.6)
                        .foregroundStyle(JK.textTertiary)
                        .lineLimit(1)
                        .fixedSize()
                        .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 0) {
                ForEach(days) { d in
                    ZStack {
                        HStack(spacing: 0) {
                            Rectangle().fill(d.id > 0 ? JK.hairline : Color.clear).frame(height: JK.Size.hairline)
                            Rectangle().fill(d.id < days.count - 1 ? JK.hairline : Color.clear).frame(height: JK.Size.hairline)
                        }
                        node(d)
                    }
                    .frame(maxWidth: .infinity, minHeight: 18)
                }
            }
            HStack(spacing: 0) {
                ForEach(days) { d in
                    Text(d.letter)
                        .font(.jkMeta.weight(d.today ? .semibold : .regular))
                        .foregroundStyle(d.today ? JK.text : JK.textTertiary)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("This week")
        .accessibilityValue(summary)
    }

    private func label(_ d: Day) -> String {
        switch d.mark {
        case .today: return "TODAY"
        case .plan: return "PLAN"
        case .review: return "REVIEW"
        case .none: return " "
        }
    }

    @ViewBuilder
    private func node(_ d: Day) -> some View {
        switch d.mark {
        case .today:
            ZStack {
                Circle().fill(JK.bg).frame(width: 15, height: 15)
                Circle().strokeBorder(JK.textSecondary, lineWidth: 1).frame(width: 15, height: 15)
                Circle().fill(JK.silver).frame(width: 8, height: 8)
            }
        case .plan:
            DiamondGlyph(size: 12)
        case .review:
            DottedCircleGlyph(size: 13)
        case .none:
            Circle().fill(d.done ? JK.silver : JK.trackStrong).frame(width: 4, height: 4)
        }
    }

    private var summary: String {
        var parts: [String] = []
        if let t = days.first(where: { $0.today }) { parts.append("Today is \(t.name)") }
        if let p = days.first(where: { $0.mark == .plan }) { parts.append("planning \(p.name)") }
        if let r = days.first(where: { $0.mark == .review }) { parts.append("review \(r.name)") }
        let done = days.filter(\.done).count
        parts.append(done == 1 ? "1 day done" : "\(done) days done")
        return parts.joined(separator: ", ")
    }
}

/// The season as a line (screen 5): a start diamond, today's dot, the next
/// planning diamond and the end diamond, with dates beneath.
struct SeasonLine: View {
    /// 0...1 positions along the line.
    let today: Double
    var next: Double?
    let startLabel: String
    var nextLabel: String?
    let endLabel: String

    @ScaledMetric(relativeTo: .caption) private var labelHeight: CGFloat = 18

    static func xPos(_ f: Double, width: CGFloat, inset: CGFloat) -> CGFloat {
        inset + max(1, width - inset * 2) * CGFloat(min(max(f, 0), 1))
    }

    var body: some View {
        VStack(spacing: JK.Space.s) {
            GeometryReader { geo in
                let w = geo.size.width
                let y = geo.size.height / 2
                let inset: CGFloat = 6
                let x = { (f: Double) -> CGFloat in Self.xPos(f, width: w, inset: inset) }
                ZStack {
                    Path { p in
                        p.move(to: CGPoint(x: inset, y: y))
                        p.addLine(to: CGPoint(x: w - inset, y: y))
                    }
                    .stroke(JK.trackStrong, lineWidth: JK.Size.hairline)
                    Path { p in
                        p.move(to: CGPoint(x: inset, y: y))
                        p.addLine(to: CGPoint(x: x(today), y: y))
                    }
                    .stroke(JK.silver, lineWidth: JK.Size.ringStroke)
                    DiamondGlyph(size: 11, filled: true, color: JK.silver).position(x: x(0), y: y)
                    DiamondGlyph(size: 11).position(x: x(1), y: y)
                    if let next { DiamondGlyph(size: 11).position(x: x(next), y: y) }
                    Circle().fill(JK.silver).frame(width: 6, height: 6).position(x: x(today), y: y)
                }
            }
            .frame(height: 14)
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .topLeading) {
                    Text(startLabel).font(.jkMeta).foregroundStyle(JK.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(endLabel).font(.jkMeta).foregroundStyle(JK.textTertiary)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    if let nextLabel, let next, next > 0.12, next < 0.88 {
                        Text(nextLabel).font(.jkMeta.weight(.semibold)).foregroundStyle(JK.text)
                            .fixedSize()
                            .position(x: 6 + (w - 12) * CGFloat(next), y: labelHeight / 2)
                    }
                }
            }
            .frame(height: labelHeight)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("The season")
        .accessibilityValue("From \(startLabel) to \(endLabel)" + (nextLabel.map { ", next planning \($0)" } ?? ""))
    }
}

// MARK: - Dial

/// A 200° arc gauge (screen 6 and 7): a hairline track with ticks and one
/// silver knob, the current word in Newsreader italic in the middle and the
/// two end words beneath. Drag or tap to set; VoiceOver adjusts it with
/// swipe up and down.
struct Dial: View {
    /// 0...1.
    @Binding var value: Double
    /// Discrete stops (5 on Look back), or nil for a continuous dial.
    var stops: Int?
    let word: String
    let lowWord: String
    let highWord: String
    /// What VoiceOver calls it ("How has this month felt?").
    let label: String
    /// After a drag ends or an adjustment: save.
    var onCommit: () -> Void = {}

    private static let startDeg: Double = 190
    private static let sweepDeg: Double = 200

    private var step: Double { stops.map { 1 / Double(max($0 - 1, 1)) } ?? 0.1 }

    var body: some View {
        VStack(spacing: JK.Space.xs) {
            GeometryReader { geo in
                let size = geo.size
                let r = min(size.width / 2 - 10, size.height - 16)
                let c = CGPoint(x: size.width / 2, y: r + 10)
                ZStack {
                    arc(c: c, r: r).stroke(JK.trackStrong, lineWidth: JK.Size.hairline)
                    ticks(c: c, r: r).stroke(JK.trackStrong, lineWidth: JK.Size.hairline)
                    Text(word)
                        .font(.jkSerif(.quote, italic: true))
                        .foregroundStyle(JK.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .frame(width: r * 1.5)
                        .position(x: c.x, y: c.y - r * 0.28)
                        .animation(nil, value: word)
                    let k = point(c: c, r: r, v: value)
                    Circle().fill(JK.bg).frame(width: 18, height: 18).position(k)
                    Circle().fill(JK.silver).frame(width: 11, height: 11).position(k)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in set(from: g.location, c: c) }
                        .onEnded { _ in onCommit() }
                )
            }
            .frame(height: 150)
            HStack {
                Text(lowWord)
                Spacer(minLength: JK.Space.s)
                Text(highWord)
            }
            .font(.jkMeta)
            .foregroundStyle(JK.textTertiary)
            .padding(.horizontal, JK.Space.s)
        }
        .frame(maxWidth: 300)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(word)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = min(1, snap(value + step))
            case .decrement: value = max(0, snap(value - step))
            @unknown default: break
            }
            onCommit()
        }
    }

    private func angle(_ v: Double) -> Double { (Self.startDeg - Self.sweepDeg * v) * .pi / 180 }

    private func point(c: CGPoint, r: CGFloat, v: Double) -> CGPoint {
        let a = angle(min(max(v, 0), 1))
        return CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y - r * CGFloat(sin(a)))
    }

    private func arc(c: CGPoint, r: CGFloat) -> Path {
        Path { p in
            let n = 80
            for i in 0...n {
                let pt = point(c: c, r: r, v: Double(i) / Double(n))
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
        }
    }

    private func ticks(c: CGPoint, r: CGFloat) -> Path {
        Path { p in
            let count = (stops ?? 5) - 1
            for i in 0...max(count, 1) {
                let a = angle(Double(i) / Double(max(count, 1)))
                let outer = CGPoint(x: c.x + (r - 5) * CGFloat(cos(a)), y: c.y - (r - 5) * CGFloat(sin(a)))
                let inner = CGPoint(x: c.x + (r - 11) * CGFloat(cos(a)), y: c.y - (r - 11) * CGFloat(sin(a)))
                p.move(to: outer)
                p.addLine(to: inner)
            }
        }
    }

    private func set(from location: CGPoint, c: CGPoint) {
        var deg = atan2(Double(c.y - location.y), Double(location.x - c.x)) * 180 / .pi
        if deg < -90 { deg += 360 }
        deg = min(max(deg, Self.startDeg - Self.sweepDeg), Self.startDeg)
        let fresh = snap((Self.startDeg - deg) / Self.sweepDeg)
        if fresh != value {
            value = fresh
            if stops != nil { UISelectionFeedbackGenerator().selectionChanged() }
        }
    }

    private func snap(_ v: Double) -> Double {
        let clamped = min(max(v, 0), 1)
        if stops != nil { return (clamped / step).rounded() * step }
        return (clamped * 100).rounded() / 100
    }
}

// MARK: - Session parts

/// The session as a strip of blocks (screen 3): a 2pt rule per block,
/// silver when done, with the block's short label beneath.
struct BlockStrip: View {
    struct Block: Identifiable {
        let id: Int
        let label: String
        let done: Bool
    }

    let blocks: [Block]

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            ForEach(blocks) { b in
                VStack(alignment: .leading, spacing: 6) {
                    Capsule()
                        .fill(b.done ? JK.silver : JK.track)
                        .frame(height: JK.Size.rule)
                    Text(b.label)
                        .font(.jkMeta)
                        .foregroundStyle(JK.textTertiary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Blocks")
        .accessibilityValue(blocks.map { "\($0.label)\($0.done ? ", done" : "")" }.joined(separator: "; "))
    }
}

/// The exercise's tempo ("3-1-1" = down, pause, drive) drawn as a line:
/// the slow descent, the pause at the bottom, the drive back up.
struct TempoLine: View {
    let tempo: String

    /// [down, pause, drive, top] in seconds, or nil if the pattern isn't one.
    static func parse(_ tempo: String) -> [Int]? {
        let parts = tempo.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 3, parts.count <= 4, parts.count == tempo.split(separator: "-").count else { return nil }
        return parts
    }

    var body: some View {
        if let p = Self.parse(tempo) {
            let down = max(Double(p[0]), 0.5), pause = max(Double(p[1]), 0.5), drive = max(Double(p[2]), 0.5)
            let top = p.count > 3 ? max(Double(p[3]), 0.8) : 1.2
            let total = down + pause + drive + top
            GeometryReader { geo in
                let w = geo.size.width
                let topY: CGFloat = 12
                let bottomY = geo.size.height - 26
                let x1 = w * CGFloat(down / total)
                let x2 = w * CGFloat((down + pause) / total)
                let x3 = w * CGFloat((down + pause + drive) / total)
                ZStack {
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: topY))
                        path.addLine(to: CGPoint(x: x1, y: bottomY))
                        path.addLine(to: CGPoint(x: x2, y: bottomY))
                        path.addLine(to: CGPoint(x: x3, y: topY))
                    }
                    .stroke(JK.textSecondary, style: StrokeStyle(lineWidth: JK.Size.ringStroke, lineCap: .round, lineJoin: .round))
                    Path { path in
                        path.move(to: CGPoint(x: x3, y: topY))
                        path.addLine(to: CGPoint(x: w, y: topY))
                    }
                    .stroke(JK.trackStrong, lineWidth: JK.Size.hairline)
                    Circle().fill(JK.text).frame(width: 4, height: 4).position(x: x1, y: bottomY)
                    Circle().fill(JK.text).frame(width: 4, height: 4).position(x: x2, y: bottomY)
                    word("slow down").position(x: x1 * 0.45, y: (topY + bottomY) / 2 + 14)
                    word("pause").position(x: (x1 + x2) / 2, y: bottomY + 14)
                    word("drive").position(x: min(w - 20, x3 + 22), y: topY + 14)
                }
            }
            .frame(height: 96)
            .frame(maxWidth: 280)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Tempo \(tempo)")
            .accessibilityValue("\(seconds(p[0])) down, \(seconds(p[1])) pause, \(seconds(p[2])) drive")
        }
    }

    private func word(_ text: String) -> some View {
        Text(text)
            .font(.jkSerif(.annotation, italic: true))
            .foregroundStyle(JK.textTertiary)
            .fixedSize()
    }

    private func seconds(_ n: Int) -> String { n == 1 ? "1 second" : "\(n) seconds" }
}

/// The month's shape (screen 8): one vertical capsule per week, height by
/// feeling 1-5, the latest bright, the word beneath in italic.
struct ShapeBars: View {
    struct Bar: Identifiable {
        let id: Int
        let feeling: Int
        let word: String
        var latest = false
    }

    let bars: [Bar]

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(bars) { b in
                VStack(spacing: JK.Space.s) {
                    ZStack(alignment: .bottom) {
                        Capsule().fill(JK.track)
                        Capsule()
                            .fill(b.latest ? JK.silver : JK.trackStrong)
                            .frame(height: 64 * CGFloat(min(max(b.feeling, 1), 5)) / 5)
                    }
                    .frame(width: 10, height: 64)
                    Text(b.word)
                        .font(.jkSerif(.annotation, italic: true))
                        .foregroundStyle(b.latest ? JK.textSecondary : JK.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(b.latest ? "Last week" : "Week \(b.id + 1)")
                .accessibilityValue(b.word)
            }
        }
    }
}

// MARK: - Ground

/// Very faint concentric circles behind a hero element (Welcome, Your
/// direction, In the session, Before the session). Decorative.
struct FaintRings: View {
    /// Where the centre sits, as a fraction of the space.
    var center: UnitPoint = .center
    var spacing: CGFloat = 14

    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width * center.x, y: size.height * center.y)
            let maxR = hypot(max(c.x, size.width - c.x), max(c.y, size.height - c.y))
            var r: CGFloat = spacing * 3
            var i = 0
            while r < maxR {
                let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
                let alpha = i % 3 == 0 ? 0.04 : 0.03
                ctx.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(alpha)), lineWidth: 1)
                r += spacing
                i += 1
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Chrome: tab bar and top bar

/// The three words, no icons: PLAN · ACT · REVIEW. Selected is text colour
/// with a 4pt silver dot beneath; the others textTertiary.
struct ParTabBar: View {
    @Binding var selection: TabRouter.Client

    private struct Tab: Identifiable {
        let id: TabRouter.Client
        let word: String
        let index: Int
    }

    private let tabs = [Tab(id: .plan, word: "Plan", index: 1), Tab(id: .act, word: "Act", index: 2),
                        Tab(id: .review, word: "Review", index: 3)]

    var body: some View {
        HStack(spacing: JK.Space.l) {
            ForEach(tabs) { t in
                let tab = t.id
                let word = t.word
                let on = selection == tab
                Button {
                    selection = tab
                } label: {
                    VStack(spacing: 6) {
                        Text(word.uppercased())
                            .font(.jkTab)
                            .tracking(1.6)
                            .foregroundStyle(on ? JK.text : JK.textTertiary)
                        Circle()
                            .fill(on ? JK.silver : Color.clear)
                            .frame(width: JK.Size.tabDot, height: JK.Size.tabDot)
                    }
                    .frame(minWidth: 72, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(word)
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                .accessibilityHint("Tab \(t.index) of 3")
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .frame(maxWidth: .infinity)
        .padding(.top, JK.Space.xs)
        .background(JK.bg.ignoresSafeArea(edges: .bottom))
    }
}

/// The small JK. mark: a 28pt rounded square with a hairline border.
struct JKSmallMark: View {
    var body: some View {
        Text("JK.")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(JK.text)
            .frame(width: JK.Size.topMark, height: JK.Size.topMark)
            .overlay(RoundedRectangle(cornerRadius: JK.Radius.mark, style: .continuous)
                .strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
            .dynamicTypeSize(.large)
            .accessibilityLabel("JK Performance")
    }
}

/// JK's avatar in the top bar: a 30pt circle, portrait or initials, with a
/// small silver dot when something is unread.
struct TopBarAvatar: View {
    var coach: PersonRef?
    var unread = false
    var size: CGFloat = JK.Size.topAvatar

    var body: some View {
        ZStack {
            Circle().fill(JK.raised)
            Text(coach.map { $0.initials ?? Fmt.initials($0.name) } ?? "JK")
                .font(.system(size: size * 0.32, weight: .semibold))
                .foregroundStyle(JK.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let id = coach?.avatarMediaId { PortraitImage(mediaId: id) }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        .overlay(alignment: .topTrailing) {
            if unread {
                Circle().fill(JK.silver)
                    .frame(width: 7, height: 7)
                    .overlay(Circle().stroke(JK.bg, lineWidth: 1.5))
                    .offset(x: 1, y: -1)
            }
        }
        .dynamicTypeSize(.large)
        .accessibilityHidden(true)
    }
}

/// The top bar on the three tab roots: the JK. mark at the left and JK's
/// avatar at the right, which opens the JK sheet.
struct ParTopBar: View {
    var coach: PersonRef?
    var unread = false
    let onJK: () -> Void

    var body: some View {
        HStack {
            JKSmallMark()
            Spacer()
            Button(action: onJK) {
                TopBarAvatar(coach: coach, unread: unread)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch, alignment: .trailing)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(unread ? "JK, new messages" : "JK")
            .accessibilityHint("Opens messages and more")
        }
    }
}

/// The silver JK. badge (the app icon's art), drawn large on Welcome.
struct WelcomeMark: View {
    var size: CGFloat = JK.Size.welcomeMark

    var body: some View {
        Image("JKMark")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
            .accessibilityLabel("JK Performance")
    }
}

// MARK: - Fields and quiet cards

/// A multi-line field with only an underline (screens 6 and 7).
struct UnderlinedField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var focus: FocusState<Bool>.Binding? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            JKLabel(label)
            field
                .font(.jkBody)
                .foregroundStyle(JK.text)
                .lineLimit(1...6)
                .padding(.bottom, JK.Space.s)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(JK.inputBorder).frame(height: JK.Size.hairline)
                }
                .accessibilityLabel(label)
        }
    }

    @ViewBuilder
    private var field: some View {
        if let focus {
            TextField(prompt, text: $text, axis: .vertical).focused(focus)
        } else {
            TextField(prompt, text: $text, axis: .vertical)
        }
    }
}

/// The quiet card a tab shows when the plan doesn't include it ("Plan with
/// JK", one line, "See what coaching includes"). Never a 403.
struct LockedCard: View {
    let title: String
    let line: String
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            SerifText(title, size: .card).foregroundStyle(JK.text)
            Text(line).font(.jkBodySmall).foregroundStyle(JK.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            SecondaryButton("See what coaching includes", action: action)
                .padding(.top, JK.Space.xs)
        }
        .parCard()
    }
}

/// The two-word "Saved" note at the top right after an autosave.
struct SavedNote: View {
    let shown: Bool

    var body: some View {
        Text("Saved")
            .font(.jkMeta)
            .foregroundStyle(JK.textTertiary)
            .opacity(shown ? 1 : 0)
            .accessibilityHidden(!shown)
    }
}
