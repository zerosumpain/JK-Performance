import SwiftUI

/// A short message at the foot of the screen, with an optional action
/// ("Untick Water?" Undo; "Updates from Apple Health"). Raised, no shadow.
struct Toast: View {
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Text(message)
                .font(.jkCallout)
                .foregroundStyle(JK.text)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(TextButtonStyle())
            }
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.s)
        .frame(minHeight: JK.Size.touch + JK.Space.s)
        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous))
        .padding(.horizontal, JK.Space.gutter)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isStaticText)
    }
}

extension View {
    /// Shows `message` as a toast at the bottom for a few seconds (instantly
    /// with Reduce Motion), announcing it to VoiceOver.
    func jkToast(_ message: Binding<String?>, actionTitle: String? = nil, action: (() -> Void)? = nil,
                 seconds: Double = 4) -> some View {
        modifier(ToastModifier(message: message, actionTitle: actionTitle, action: action, seconds: seconds))
    }
}

private struct ToastModifier: ViewModifier {
    @Binding var message: String?
    let actionTitle: String?
    let action: (() -> Void)?
    let seconds: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let text = message {
                Toast(message: text, actionTitle: actionTitle) {
                    action?()
                    message = nil
                }
                .padding(.bottom, JK.Space.l)
                .transition(.opacity)
                .task(id: text) {
                    UIAccessibility.post(notification: .announcement, argument: text)
                    try? await Task.sleep(for: .seconds(seconds))
                    withAnimation(JK.Motion.respecting(reduceMotion)) { message = nil }
                }
            }
        }
        .animation(JK.Motion.respecting(reduceMotion), value: message)
    }
}

/// Nothing to show: the brand rule and one serif italic line ("Nothing due.
/// Enjoy the evening."), with an optional action beneath.
struct EmptyState: View {
    let line: String
    var detail: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            BrandRule()
            Text(line)
                .jkText(.quote)
                .foregroundStyle(JK.text)
                .fixedSize(horizontal: false, vertical: true)
            if let detail {
                Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(SecondaryButtonStyle())
                    .padding(.top, JK.Space.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, JK.Space.xl)
        .accessibilityElement(children: .contain)
    }
}

/// A horizontal arrangement that turns vertical at accessibility text sizes.
struct AdaptiveStack<Content: View>: View {
    var horizontalAlignment: HorizontalAlignment = .leading
    var verticalAlignment: VerticalAlignment = .center
    var spacing: CGFloat? = JK.Space.m
    @ViewBuilder var content: () -> Content
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: horizontalAlignment, spacing: spacing, content: content)
        } else {
            HStack(alignment: verticalAlignment, spacing: spacing, content: content)
        }
    }
}
