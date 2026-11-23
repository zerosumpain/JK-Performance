import SwiftUI

/// The chrome fill: a vertical-ish linear gradient through the three chrome
/// tokens, with a 1pt white highlight along the top edge.
struct ChromeFill: View {
    var body: some View {
        Capsule()
            .fill(LinearGradient(colors: [JK.chromeTop, JK.chromeMid, JK.chromeBottom],
                                 startPoint: UnitPoint(x: 0.35, y: 0), endPoint: UnitPoint(x: 0.65, y: 1)))
            .overlay(alignment: .top) {
                Capsule()
                    .fill(JK.chromeHighlight)
                    .frame(height: 1)
                    .padding(.horizontal, JK.Space.xxl)
                    .padding(.top, 1)
            }
            .accessibilityHidden(true)
    }
}

/// One primary action per screen (plan-act-review.md): a chrome capsule,
/// at least 52pt high (labels wrap at accessibility sizes), 16 Semibold label
/// in onChrome.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jkButton)
            .multilineTextAlignment(.center)
            .foregroundStyle(JK.onChrome)
            .tint(JK.onChrome)
            .padding(.vertical, 14)
            .padding(.horizontal, JK.Space.xl)
            .frame(maxWidth: .infinity, minHeight: JK.Size.buttonHeight)
            .background(ChromeFill())
            .opacity(configuration.isPressed ? 0.85 : (enabled ? 1 : 0.45))
            .contentShape(Capsule())
    }
}

/// A transparent capsule with a 1pt outline and a text-colour label
/// ("Continue with a code", "Message JK"). `small` is the 32pt, 13pt variant
/// ("Prepare →").
struct SecondaryButtonStyle: ButtonStyle {
    var small = false
    /// Fill the width (the full-size button) or hug the label.
    var fill = true
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(small ? .jkButtonSmall : .jkButton)
            .multilineTextAlignment(.center)
            .foregroundStyle(JK.text)
            .padding(.vertical, small ? 6 : 14)
            .padding(.horizontal, small ? JK.Space.m : JK.Space.xl)
            .frame(maxWidth: fill && !small ? .infinity : nil, minHeight: small ? 32 : JK.Size.buttonHeight)
            .background(configuration.isPressed ? JK.raised : Color.clear, in: Capsule())
            .overlay(Capsule().strokeBorder(JK.buttonBorder, lineWidth: JK.Size.hairline))
            .opacity(enabled ? 1 : 0.45)
            .contentShape(Capsule())
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
    /// A trailing arrow glyph ("Begin today →").
    var arrow = false
    /// The Apple logo before the label (Sign in with Apple).
    var leadingSymbol: String? = nil
    let action: () -> Void

    init(_ title: String, busy: Bool = false, arrow: Bool = false, leadingSymbol: String? = nil,
         action: @escaping () -> Void) {
        self.title = title
        self.busy = busy
        self.arrow = arrow
        self.leadingSymbol = leadingSymbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            if busy {
                ProgressView().tint(JK.onChrome)
            } else {
                HStack(spacing: JK.Space.s) {
                    if let leadingSymbol { Image(systemName: leadingSymbol).accessibilityHidden(true) }
                    Text(title)
                    if arrow { Image(systemName: "arrow.right").fontWeight(.light).accessibilityHidden(true) }
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy)
    }
}

struct SecondaryButton: View {
    let title: String
    var small = false
    var arrow = false
    let action: () -> Void

    init(_ title: String, small: Bool = false, arrow: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.small = small
        self.arrow = arrow
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: JK.Space.xs) {
                Text(title)
                if arrow { Image(systemName: "arrow.right").fontWeight(.light).accessibilityHidden(true) }
            }
        }
        .buttonStyle(SecondaryButtonStyle(small: small))
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
