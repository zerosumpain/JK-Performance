import SwiftUI

/// The JK Performance look: black ground, near-black cards with a hairline
/// edge, white type, and one "chrome" gradient for the primary action.
/// Reference: docs/coach/screens-v1.webp.
enum JK {
    static let bg = Color.black
    static let card = Color(white: 0.07)
    static let cardRaised = Color(white: 0.12)
    static let stroke = Color.white.opacity(0.09)
    static let text = Color.white
    static let secondary = Color.white.opacity(0.6)
    static let tertiary = Color.white.opacity(0.38)
    static let track = Color.white.opacity(0.12)

    static let chrome = LinearGradient(
        colors: [Color(white: 0.96), Color(white: 0.66), Color(white: 0.92)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let corner: CGFloat = 14

    // The few colours that carry meaning: urgent, waiting, and the kinds of slot on the schedule.
    static let urgent = Color(red: 1.0, green: 0.42, blue: 0.38)
    static let waiting = Color(red: 1.0, green: 0.76, blue: 0.36)
    static let inPerson = Color(red: 0.40, green: 0.68, blue: 1.0)
    static let video = Color(red: 0.74, green: 0.56, blue: 1.0)
    static let group = Color(red: 0.36, green: 0.82, blue: 0.62)

    /// The colour of a booking kind (`inperson`, `video`, `group`).
    static func slot(_ kind: String) -> Color {
        switch kind {
        case "video": return video
        case "group": return group
        default: return inPerson
        }
    }
}

/// A small coloured dot, for keys and status.
struct Dot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle().fill(color).frame(width: size, height: size)
    }
}

// MARK: - Surfaces

struct CardModifier: ViewModifier {
    var padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(JK.card, in: RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }
}

extension View {
    func jkCard(padding: CGFloat = 14) -> some View {
        modifier(CardModifier(padding: padding))
    }

    /// A scrolling screen on the black ground.
    func jkScreen() -> some View {
        self
            .background(JK.bg.ignoresSafeArea())
            .toolbarBackground(JK.bg, for: .navigationBar)
    }
}

// MARK: - Type

/// Small spaced capitals above a title or section ("LIBRARY", "PERSONAL RECORDS").
struct Eyebrow: View {
    let text: String
    var trailing: String? = nil

    var body: some View {
        HStack {
            Text(text.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(1.4)
                .foregroundStyle(JK.tertiary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
            }
        }
    }
}

/// The large left-aligned title every top-level screen opens with.
struct ScreenHeader<Accessory: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow(text: eyebrow)
                Text(title)
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(JK.text)
            }
            Spacer()
            accessory()
        }
    }
}

extension ScreenHeader where Accessory == EmptyView {
    init(eyebrow: String, title: String) {
        self.init(eyebrow: eyebrow, title: title) { EmptyView() }
    }
}

// MARK: - Buttons

struct ChromeButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(JK.chrome, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(JK.text)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(JK.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(JK.stroke, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

// MARK: - Controls

/// A capsule filter chip ("All", "Legs", "Knee").
struct Chip: View {
    let label: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(selected ? Color.black : JK.text)
                .background(selected ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.card), in: Capsule())
                .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// The dark segmented control ("3M 6M All", "Week Month", "Programs Autoflows Forms").
struct Segmented<T: Hashable>: View {
    let options: [T]
    @Binding var selection: T
    let label: (T) -> String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                Button {
                    selection = option
                } label: {
                    Text(label(option))
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundStyle(selection == option ? JK.text : JK.tertiary)
                        .background(selection == option ? JK.cardRaised : Color.clear,
                                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(JK.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }
}

/// A thin white-on-grey bar.
struct ThinBar: View {
    let fraction: Double
    var height: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(JK.track)
                Capsule().fill(JK.text).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
    }
}

/// A rounded square holding an SF Symbol, the leading mark on list rows.
struct IconTile: View {
    let systemName: String
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.42))
            .foregroundStyle(JK.text)
            .frame(width: size, height: size)
            .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }
}

/// Initials in a circle (leaderboards, client lists).
struct Avatar: View {
    let initials: String
    var size: CGFloat = 30

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.34, weight: .semibold))
            .foregroundStyle(JK.text)
            .frame(width: size, height: size)
            .background(JK.cardRaised, in: Circle())
            .overlay(Circle().stroke(JK.stroke, lineWidth: 1))
    }
}

/// The round check at the end of a habit row.
struct CheckCircle: View {
    let on: Bool

    var body: some View {
        ZStack {
            Circle().stroke(on ? Color.clear : JK.tertiary, lineWidth: 1.5)
            if on {
                Circle().fill(JK.text)
                Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.black)
            }
        }
        .frame(width: 24, height: 24)
    }
}

/// Placeholder for a screen not built yet.
struct ComingSoon: View {
    let title: String
    let systemName: String

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: systemName).font(.system(size: 36)).foregroundStyle(JK.tertiary)
                Text(title).font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                Text("Not designed yet").font(.footnote).foregroundStyle(JK.tertiary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .jkScreen()
        }
    }
}
