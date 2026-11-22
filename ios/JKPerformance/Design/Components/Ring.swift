import SwiftUI

/// The shared progress arc: GoalHero, the coach GoalCard and the Fuel kcal
/// ring. `sweep` is 360 for a full ring or 300 for the open GoalHero arc,
/// whose gap sits at the bottom. The track is decoration; the fill carries
/// the value, and the caller states it in words for VoiceOver.
struct Ring: View {
    /// 0...1 of the sweep.
    let fraction: Double
    var sweep: Double = 360
    /// Degrees clockwise from 12 o'clock where the arc starts; nil centres the gap at the bottom.
    var startAngle: Double? = nil
    var lineWidth: CGFloat = 6
    var fill: Color = JK.text
    var track: Color = JK.track

    private var start: Double { startAngle ?? (sweep >= 360 ? 0 : 180 + (360 - sweep) / 2) }

    var body: some View {
        let portion = sweep / 360
        ZStack {
            Circle()
                .trim(from: 0, to: portion)
                .stroke(track, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            Circle()
                .trim(from: 0, to: portion * min(max(fraction, 0), 1))
                .stroke(fill, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        }
        // Circle's trim starts at 3 o'clock; turn it so 0 is 12 o'clock, then to `start`.
        .rotationEffect(.degrees(-90 + start))
        .padding(lineWidth / 2)
        .accessibilityHidden(true)
    }
}
