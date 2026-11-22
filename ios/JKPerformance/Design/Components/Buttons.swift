import SwiftUI

/// One primary action per screen: an ivory fill with a dark label. Never gold,
/// never a gradient. Minimum (not fixed) height 52 so labels can wrap at
/// accessibility sizes.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jkHeadline)
            .multilineTextAlignment(.center)
            .foregroundStyle(JK.onPrimary)
            .tint(JK.onPrimary)
            .padding(.vertical, 14)
            .padding(.horizontal, JK.Space.l)
            .frame(maxWidth: .infinity, minHeight: JK.Size.buttonHeight)
            .background(configuration.isPressed ? JK.primaryPressed : JK.primaryFill,
                        in: RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}

/// Transparent with a 1pt inputBorder outline and a text-colour label.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous)
        configuration.label
            .font(.jkHeadline)
            .multilineTextAlignment(.center)
            .foregroundStyle(JK.text)
            .padding(.vertical, 14)
            .padding(.horizontal, JK.Space.l)
            .frame(maxWidth: .infinity, minHeight: JK.Size.buttonHeight)
            .background(configuration.isPressed ? JK.raised : Color.clear, in: shape)
            .overlay(shape.strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}

/// Text colour, 15 Medium, 44pt minimum target.
struct TextButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jkCallout)
            .foregroundStyle(JK.text)
            .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

/// A small outlined capsule for secondary row actions ("Try again", "Edit").
struct SmallPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jkCaption)
            .foregroundStyle(JK.text)
            .padding(.horizontal, JK.Space.m).padding(.vertical, 6)
            .frame(minHeight: 32)
            .overlay(Capsule().strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
            .contentShape(Capsule())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct PrimaryButton: View {
    let title: String
    var busy = false
    let action: () -> Void

    init(_ title: String, busy: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.busy = busy
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            if busy { ProgressView() } else { Text(title) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy)
    }
}

struct SecondaryButton: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(title, action: action).buttonStyle(SecondaryButtonStyle())
    }
}

struct TextButton: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(title, action: action).buttonStyle(TextButtonStyle())
    }
}
