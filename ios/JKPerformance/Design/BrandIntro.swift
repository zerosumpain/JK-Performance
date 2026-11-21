import SwiftUI

/// The opening animation: a weight plate draws itself in, the JK tile traces
/// its edge and fills, a chrome sheen crosses it, then PERFORMANCE settles
/// and the tagline appears. About two seconds. Plays when the app opens
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
            Color.black
            RadialGradient(colors: [Color(white: 0.12), .black], center: UnitPoint(x: 0.5, y: centerY - 0.06),
                           startRadius: 0, endRadius: size.height * 0.65)
                .opacity(ease(t, 0, 0.9))

            // Plate rims, drawn round from staggered starting points.
            ForEach(rings.indices, id: \.self) { i in
                Circle()
                    .trim(from: 0, to: ease(t, 0.04 + Double(i) * 0.06, 0.62 + Double(i) * 0.06))
                    .stroke(Color.white.opacity(i < 4 ? 0.2 : 0.11), lineWidth: 0.7)
                    .rotationEffect(.degrees(-100 + Double(i) * 40))
                    .frame(width: rings[i] * 2, height: rings[i] * 2)
                    .position(c)
            }

            // Grip cut-outs.
            ForEach([-55.0, 68.0, 172.0], id: \.self) { angle in
                PlateSegment(center: angle, span: 26, inner: 120, outer: 146)
                    .stroke(Color.white.opacity(0.2), lineWidth: 0.8)
                    .background(PlateSegment(center: angle, span: 26, inner: 120, outer: 146).fill(Color.white.opacity(0.025)))
                    .frame(width: 300, height: 300)
                    .position(c)
                    .opacity(ease(t, 0.5, 0.95))
            }

            // "JK · PERFORMANCE · 20 KG" round the top of the plate.
            ZStack {
                ForEach(arcText.indices, id: \.self) { i in
                    Text(String(arcText[i]))
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.42))
                        .offset(y: -166)
                        .rotationEffect(.degrees(-52 + Double(i) * 3.4))
                }
            }
            .position(c)
            .opacity(ease(t, 0.6, 1.05))

            // Hub circle behind the tile.
            Circle()
                .trim(from: 0, to: ease(t, 0.3, 0.75))
                .stroke(Color.white.opacity(0.16), lineWidth: 0.8)
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
                .foregroundStyle(JK.secondary)
                .opacity(ease(t, 1.4, 1.8))
                .fixedSize()
                .position(x: c.x, y: c.y + 118)
        }
    }

    private func tile(t: Double) -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        let sheen = linear(t, 1.05, 1.5)
        return ZStack {
            shape.fill(Color(white: 0.06)).opacity(ease(t, 0.55, 1.0))
            Text("JK")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(JK.text)
                .opacity(ease(t, 0.7, 1.05))
                .scaleEffect(0.94 + 0.06 * ease(t, 0.7, 1.05))
            if sheen > 0 && sheen < 1 {
                LinearGradient(colors: [.clear, Color.white.opacity(0.85), Color(white: 0.75).opacity(0.6), .clear],
                               startPoint: .leading, endPoint: .trailing)
                    .frame(width: 70, height: 220)
                    .rotationEffect(.degrees(28))
                    .offset(x: -150 + 300 * sheen)
                    .blendMode(.plusLighter)
                    .mask(shape)
            }
            shape
                .trim(from: 0, to: ease(t, 0.3, 0.85))
                .stroke(Color.white.opacity(0.85), lineWidth: 1.2)
        }
        .frame(width: 104, height: 104)
        .shadow(color: .white.opacity(0.08 * ease(t, 0.9, 1.4)), radius: 24)
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
