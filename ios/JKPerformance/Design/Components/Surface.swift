import SwiftUI

/// Containers. No shadows: hierarchy comes from surface steps and hairlines
/// (plan-act-review.md: surface fill, 1pt hairline border, radius 16, padding 16).
/// - hero: no container, directly on the ground
/// - group: an inset surface for a grouped list (rows separated by `GroupDivider`)
/// - card, next: surface with a 1pt hairline
/// - paper: letters and guides
enum SurfaceStyle {
    case hero, group, card, next, paper
}

struct SurfaceModifier: ViewModifier {
    let style: SurfaceStyle
    var padding: CGFloat = JK.Space.cardPadding

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous)
        switch style {
        case .hero:
            content.frame(maxWidth: .infinity, alignment: .leading)
        case .group:
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(JK.surface, in: shape)
        case .card:
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(JK.surface, in: shape)
                .overlay(shape.strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        case .next:
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(JK.surface, in: shape)
                .overlay(shape.strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        case .paper:
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(JK.paper, in: shape)
                .overlay(shape.strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        }
    }
}

/// A container view, for call sites that read better as a wrapper.
struct Surface<Content: View>: View {
    var style: SurfaceStyle = .card
    var padding: CGFloat = JK.Space.cardPadding
    @ViewBuilder var content: () -> Content

    var body: some View {
        content().modifier(SurfaceModifier(style: style, padding: padding))
    }
}

/// The hairline between rows of a grouped list.
struct GroupDivider: View {
    var inset: CGFloat = JK.Space.l

    var body: some View {
        Rectangle()
            .fill(JK.hairline)
            .frame(height: JK.Size.hairline)
            .padding(.leading, inset)
            .accessibilityHidden(true)
    }
}

extension View {
    func surface(_ style: SurfaceStyle, padding: CGFloat = JK.Space.cardPadding) -> some View {
        modifier(SurfaceModifier(style: style, padding: padding))
    }

    /// The Plan. Act. Review. card: surface, 1pt hairline, radius 16, padding 16.
    func parCard(padding: CGFloat = JK.Space.l) -> some View {
        modifier(SurfaceModifier(style: .card, padding: padding))
    }

    /// The old card. It now draws `Surface.card`.
    func jkCard(padding: CGFloat = JK.Space.cardPadding) -> some View {
        modifier(SurfaceModifier(style: .card, padding: padding))
    }
}
