import SwiftUI

/// The one-per-screen label: 11 Semibold uppercase with +1.2 tracking in
/// textSecondary; sentence case without tracking at accessibility sizes.
/// (Named JKLabel so it does not shadow SwiftUI.Label; the spec calls it Label.)
struct JKLabel: View {
    let text: String
    var trailing: String? = nil

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).jkText(.label).foregroundStyle(JK.textSecondary)
            Spacer(minLength: JK.Space.s)
            if let trailing {
                Text(trailing).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The old section caption. Retired by the spec in favour of one JKLabel per
/// screen; until the screens are rebuilt it draws as a quiet sentence-case
/// caption so the many per-block uses do not all shout.
struct Eyebrow: View {
    let text: String
    var trailing: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text)
                .font(.jkCaption)
                .foregroundStyle(JK.textSecondary)
            Spacer(minLength: JK.Space.s)
            if let trailing {
                Text(trailing).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The large left-aligned title every top-level screen opens with: display
/// (34 Light) under its label.
struct ScreenHeader<Accessory: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                JKLabel(eyebrow)
                Text(title)
                    .jkText(.display)
                    .foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
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

/// A word plus a dot, for coach screens only (at most two per screen). The
/// word carries the meaning; the dot repeats it.
struct StatusPill: View {
    enum Tone { case onTrack, attention, urgent, data, neutral }

    let text: String
    var tone: Tone = .neutral

    private var color: Color {
        switch tone {
        case .onTrack: return JK.onTrack
        case .attention: return JK.attention
        case .urgent: return JK.urgent
        case .data: return JK.data
        case .neutral: return JK.textSecondary
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 6, height: 6).accessibilityHidden(true)
            Text(text).font(.jkCaption).foregroundStyle(color)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .overlay(Capsule().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
    }
}
