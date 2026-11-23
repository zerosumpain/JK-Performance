import SwiftUI

/// The opening moment (plan-act-review.md, "The mark and icon"): the silver
/// JK. mark settles in the middle of the faint rings on near-black, then the
/// app fades in over it. About a second. With Reduce Motion on it shows the
/// finished frame at once.
struct BrandIntro: View {
    /// When the mark has landed.
    static let duration: Double = 0.9

    /// The mark's centre, as a fraction of the height.
    var centerY: CGFloat = 0.42

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                JK.bg
                FaintRings(center: UnitPoint(x: 0.5, y: centerY))
                WelcomeMark()
                    .scaleEffect(shown ? 1 : 0.94)
                    .opacity(shown ? 1 : 0)
                    .position(x: geo.size.width / 2, y: geo.size.height * centerY)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("JK Performance")
        .onAppear {
            if reduceMotion {
                shown = true
            } else {
                withAnimation(.easeOut(duration: Self.duration)) { shown = true }
            }
        }
    }
}
