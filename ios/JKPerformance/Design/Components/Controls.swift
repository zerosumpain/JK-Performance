import SwiftUI

/// A capsule filter chip ("All", "Legs", "Knee"). Selected is the ivory fill.
struct Chip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.jkCaption)
                .padding(.horizontal, JK.Space.m)
                .padding(.vertical, 6)
                .frame(minHeight: 32)
                .foregroundStyle(selected ? JK.onPrimary : JK.text)
                .background(selected ? JK.primaryFill : Color.clear, in: Capsule())
                .overlay(Capsule().strokeBorder(selected ? Color.clear : JK.inputBorder, lineWidth: JK.Size.hairline))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The segmented control ("3M 6M All", "Week Month").
struct Segmented<T: Hashable>: View {
    let options: [T]
    @Binding var selection: T
    let label: (T) -> String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                let on = selection == option
                Button {
                    selection = option
                } label: {
                    Text(label(option))
                        .font(.jkCaption)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .foregroundStyle(on ? JK.text : JK.textSecondary)
                        .background(on ? JK.raised : Color.clear,
                                    in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
    }
}

/// A thin bar on its track (macros, budgets). The fill is the text colour, not
/// champagne: a bar is a measure, not an achievement.
struct ThinBar: View {
    let fraction: Double
    var height: CGFloat = 3
    var fill: Color = JK.text

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(JK.track)
                Capsule().fill(fill).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// The round check at the end of a habit row (until HabitMark replaces it):
/// an outline when open, a filled champagne check when done.
struct CheckCircle: View {
    let on: Bool

    var body: some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .font(.system(size: JK.Size.iconHabit, weight: .regular))
            .foregroundStyle(on ? JK.accent : JK.trackStrong)
            .frame(width: JK.Size.iconHabit, height: JK.Size.iconHabit)
            .accessibilityHidden(true)
    }
}

/// Placeholder for a screen not built yet.
struct ComingSoon: View {
    let title: String
    let systemName: String

    var body: some View {
        NavigationStack {
            VStack(spacing: JK.Space.m) {
                Glyph(systemName: systemName, size: JK.Space.huge)
                Text(title).font(.jkHeadline).foregroundStyle(JK.text)
                Text("Not designed yet").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .jkScreen()
        }
    }
}

/// Field styling for forms inside cards and sheets: a 1pt inputBorder on surface.
struct JKField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Text(label).font(.jkCaption).foregroundStyle(JK.textSecondary)
            TextField(prompt, text: $text)
                .keyboardType(keyboard)
                .font(.jkBody)
                .foregroundStyle(JK.text)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(minHeight: JK.Size.touch)
                .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous)
                    .strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                .accessibilityLabel(label)
        }
    }
}
