import SwiftUI

/// The opening animation: a weight plate draws itself in bone, a champagne
/// ring traces round the hub and the JK monogram settles inside it, then
/// PERFORMANCE settles and the tagline appears. No sheen, no glow: Atelier
/// keeps to bone and champagne on the warm off-black. About two seconds. Plays when the app opens
/// (over the signed-in tabs) and behind the Welcome screen. With Reduce
/// Motion on it shows the finished frame at once.
struct BrandIntro: View {
    /// When the wordmark and tagline have landed; controls can follow.
    static let duration: Double = 1.9

    /// The plate's centre, as a fraction of the height.
    var centerY: CGFloat = 0.36

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start: Date?
    @State private var finished = false

    private let rings: [CGFloat] = [246, 241, 236, 231, 182]
    private let arcText = Array("JK    PERFORMANCE    ·    20 KG")

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: nil, paused: finished || reduceMotion)) { context in
                let t = reduceMotion || finished ? 10 : context.date.timeIntervalSince(start ?? context.date)
                scene(t: t, size: geo.size)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("JK Performance. Coaching, programming and accountability.")
        .task {
            if start == nil { start = Date() }
            try? await Task.sleep(for: .seconds(Self.duration + 0.4))
            finished = true
        }
    }

    // MARK: The frame at time t

    private func scene(t: Double, size: CGSize) -> some View {
        let c = CGPoint(x: size.width / 2, y: size.height * centerY)
        return ZStack {
            JK.bg

            // Plate rims, drawn round from staggered starting points.
            ForEach(rings.indices, id: \.self) { i in
                Circle()
                    .trim(from: 0, to: ease(t, 0.04 + Double(i) * 0.06, 0.62 + Double(i) * 0.06))
                    .stroke(JK.text.opacity(i < 4 ? 0.2 : 0.11), lineWidth: 0.7)
                    .rotationEffect(.degrees(-100 + Double(i) * 40))
                    .frame(width: rings[i] * 2, height: rings[i] * 2)
                    .position(c)
            }

            // Grip cut-outs.
            ForEach([-55.0, 68.0, 172.0], id: \.self) { angle in
                PlateSegment(center: angle, span: 26, inner: 120, outer: 146)
                    .stroke(JK.text.opacity(0.2), lineWidth: 0.8)
                    .background(PlateSegment(center: angle, span: 26, inner: 120, outer: 146).fill(JK.text.opacity(0.025)))
                    .frame(width: 300, height: 300)
                    .position(c)
                    .opacity(ease(t, 0.5, 0.95))
            }

            // "JK · PERFORMANCE · 20 KG" round the top of the plate.
            ZStack {
                ForEach(arcText.indices, id: \.self) { i in
                    Text(String(arcText[i]))
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(JK.text.opacity(0.42))
                        .offset(y: -166)
                        .rotationEffect(.degrees(-52 + Double(i) * 3.4))
                }
            }
            .position(c)
            .opacity(ease(t, 0.6, 1.05))

            // Hub circle behind the tile.
            Circle()
                .trim(from: 0, to: ease(t, 0.3, 0.75))
                .stroke(JK.text.opacity(0.16), lineWidth: 0.8)
                .rotationEffect(.degrees(90))
                .frame(width: 112, height: 112)
                .position(x: c.x, y: c.y + 8)

            tile(t: t).position(c)

            Text("PERFORMANCE")
                .font(.system(size: 15, weight: .semibold))
                .tracking(6 + 12 * (1 - ease(t, 1.1, 1.6)))
                .foregroundStyle(JK.text)
                .opacity(ease(t, 1.05, 1.45))
                .fixedSize()
                .position(x: c.x, y: c.y + 92)

            Text("Coaching, programming and accountability.")
                .font(.footnote)
                .foregroundStyle(JK.textSecondary)
                .opacity(ease(t, 1.4, 1.8))
                .fixedSize()
                .position(x: c.x, y: c.y + 118)
        }
    }

    /// The monogram inside a champagne ring that traces itself round.
    private func tile(t: Double) -> some View {
        ZStack {
            Circle().fill(JK.bg).opacity(ease(t, 0.55, 1.0))
            Circle()
                .trim(from: 0, to: ease(t, 0.3, 0.85))
                .stroke(JK.accent, lineWidth: 1.2)
                .rotationEffect(.degrees(-90))
            Monogram(size: 64)
                .opacity(ease(t, 0.7, 1.05))
                .scaleEffect(0.94 + 0.06 * ease(t, 0.7, 1.05))
        }
        .frame(width: 104, height: 104)
    }

    // MARK: Timing

    /// 0 before `a`, 1 after `b`, ease-out cubic between.
    private func ease(_ t: Double, _ a: Double, _ b: Double) -> Double {
        let x = linear(t, a, b)
        return 1 - pow(1 - x, 3)
    }

    private func linear(_ t: Double, _ a: Double, _ b: Double) -> Double {
        min(1, max(0, (t - a) / (b - a)))
    }
}

/// A ring-shaped wedge (an annular sector), centred in its frame.
private struct PlateSegment: Shape {
    let center: Double
    let span: Double
    let inner: CGFloat
    let outer: CGFloat

    func path(in rect: CGRect) -> Path {
        let mid = CGPoint(x: rect.midX, y: rect.midY)
        let a0 = Angle.degrees(center - span / 2), a1 = Angle.degrees(center + span / 2)
        var p = Path()
        p.addArc(center: mid, radius: outer, startAngle: a0, endAngle: a1, clockwise: false)
        p.addArc(center: mid, radius: inner, startAngle: a1, endAngle: a0, clockwise: true)
        p.closeSubpath()
        return p
    }
}
