import SwiftUI
import UIKit

/// Atelier tokens (docs/design/atelier-spec.md, "Tokens"). Every colour is a
/// semantic dark/light pair resolved from the trait collection: dark is the
/// signature and ships (the app is forced dark), light ("paper") is defined
/// and measured so it can later be a pure token swap.
///
/// Keep each colour on one line in the `pair(0xDARK, 0xLIGHT…)` form:
/// scripts/contrast-check.mjs reads this file and checks it against the spec.
enum JK {
    // MARK: Surfaces (elevation comes from surface steps only)

    static let bg = pair(0x0E0D0C, 0xF5F0E8)
    static let surface = pair(0x171614, 0xFBF8F3)
    static let raised = pair(0x211F1C, 0xEDE6DA)
    /// Letters and guides.
    static let paper = pair(0x1A1815, 0xFBF6EC)
    /// Decorative only: dividers and the Next card border. Never an input boundary or a state.
    static let hairline = pair(0x2E2B27, 0xDDD5C8)
    /// Text fields, steppers and outline buttons (3:1 non-text).
    static let inputBorder = pair(0x6B655C, 0x8F887E)
    /// The background of a ring or rule only; never carries state on its own.
    static let track = pair(0xF2EEE7, 0x1C1A17, darkAlpha: 0.10, lightAlpha: 0.08)
    /// The not-done week dot outline and idle states that carry meaning (3:1).
    static let trackStrong = pair(0xF2EEE7, 0x86817A, darkAlpha: 0.40)
    static let scrim = pair(0x0E0D0C, 0x0E0D0C, darkAlpha: 0.60, lightAlpha: 0.60)

    // MARK: Text

    /// Bone on dark, ink on light.
    static let text = pair(0xF2EEE7, 0x1C1A17)
    /// Stone.
    static let textSecondary = pair(0xA39D94, 0x5E5950)
    /// Never on `raised` (4.4:1): scripts/lint-design.sh flags it.
    static let textTertiary = pair(0x8A847B, 0x66615A)

    // MARK: Accent (exactly one): achievement and JK, nothing else

    /// Champagne. Never on buttons, tabs, toggles, body text, status or warnings.
    static let accent = pair(0xC8A970, 0x7A5C2C)
    static let accentPressed = pair(0xB08F52, 0x664C22)
    /// The goal target band only.
    static let accentWash = pair(0xC8A970, 0x7A5C2C, darkAlpha: 0.16, lightAlpha: 0.10)
    /// Toggles and selection tint: bone/ink, because toggles are not achievement.
    static let accentControl = pair(0xF2EEE7, 0x1C1A17)

    // MARK: Actions

    /// The ivory primary button fill (and any "selected" fill).
    static let primaryFill = pair(0xF2EEE7, 0x1C1A17)
    static let primaryPressed = pair(0xDCD6CC, 0x3A3631)
    /// Label on `primaryFill`.
    static let onPrimary = pair(0x0E0D0C, 0xFBF8F3)

    // MARK: Status (coach screens and Progress charts; always with a word and a glyph)

    /// Sage.
    static let onTrack = pair(0x9FB39A, 0x4F6B4A)
    /// Terracotta, "Worth a look". Coach only.
    static let attention = pair(0xD98E5B, 0x9A5530)
    /// Slate: value-free numbers and chart lines.
    static let data = pair(0x8FA3B3, 0x4A6072)
    /// Clay: system errors only.
    static let error = pair(0xC9735F, 0x9A4632)
    /// Coach app only.
    static let urgent = pair(0xE8816F, 0xA8432F)

    // MARK: Booking kinds (muted dots in the month grid and coach agenda only)

    static let kindInPerson = pair(0x8FA3B3, 0x4A6072)
    static let kindVideo = pair(0xA898C4, 0x6A5A8E)
    static let kindGroup = pair(0x9FB39A, 0x4F6B4A)

    /// The colour of a booking kind (`inperson`, `video`, `group`).
    static func slot(_ kind: String) -> Color {
        switch kind {
        case "video": return kindVideo
        case "group": return kindGroup
        default: return kindInPerson
        }
    }

    // MARK: Spacing, radii, sizes, motion

    /// The 4pt scale.
    enum Space {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 12
        static let l: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 24
        static let xxxl: CGFloat = 32
        static let huge: CGFloat = 48

        /// Screen gutter (16 on widths under 375).
        static let gutter: CGFloat = 20
        static let gutterCompact: CGFloat = 16
        static let cardPadding: CGFloat = 20
        static let section: CGFloat = 32
        static let row: CGFloat = 12
    }

    enum Radius {
        static let chip: CGFloat = 8
        static let control: CGFloat = 10
        static let button: CGFloat = 12
        static let card: CGFloat = 12
        static let sheet: CGFloat = 20
        static let pill: CGFloat = 999
    }

    enum Size {
        /// Minimum touch target.
        static let touch: CGFloat = 44
        static let buttonHeight: CGFloat = 52
        /// Habit marks: 56pt, scaled with @ScaledMetric up to 72pt.
        static let habitMark: CGFloat = 56
        static let habitMarkMax: CGFloat = 72
        static let avatar: CGFloat = 36
        static let avatarSmall: CGFloat = 32
        static let weekDot: CGFloat = 6
        /// The brand rule and the habit rule.
        static let rule: CGFloat = 2
        static let hairline: CGFloat = 1
        static let iconTab: CGFloat = 22
        static let iconInline: CGFloat = 20
        static let iconHabit: CGFloat = 24
        static let iconBadge: CGFloat = 10
    }

    enum Motion {
        /// Standard: 240ms, cubic-bezier(0.2, 0, 0, 1).
        static let standard = Animation.timingCurve(0.2, 0, 0, 1, duration: 0.24)
        static let tick = Animation.easeOut(duration: 0.36)
        static let dayDone = Animation.easeOut(duration: 0.6)
        static let rollUp = Animation.easeOut(duration: 0.4)
        static let letterOpen = Animation.easeOut(duration: 0.28)

        /// The animation, or nil (an instant change) with Reduce Motion on.
        static func respecting(_ reduceMotion: Bool, _ animation: Animation = standard) -> Animation? {
            reduceMotion ? nil : animation
        }
    }

    /// Old corner, kept for call sites that have not moved to a radius token.
    static let corner: CGFloat = Radius.card

    // MARK: Building pairs

    /// A dynamic colour: `dark` in dark mode, `light` otherwise; alpha per mode.
    static func pair(_ dark: UInt32, _ light: UInt32, darkAlpha: CGFloat = 1, lightAlpha: CGFloat = 1) -> Color {
        Color(uiPair(dark, light, darkAlpha: darkAlpha, lightAlpha: lightAlpha))
    }

    static func uiPair(_ dark: UInt32, _ light: UInt32, darkAlpha: CGFloat = 1, lightAlpha: CGFloat = 1) -> UIColor {
        UIColor { trait in
            trait.userInterfaceStyle == .light ? rgb(light, lightAlpha) : rgb(dark, darkAlpha)
        }
    }

    private static func rgb(_ hex: UInt32, _ alpha: CGFloat) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: alpha)
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

extension View {
    /// A scrolling screen on the warm off-black ground.
    func jkScreen() -> some View {
        self
            .background(JK.bg.ignoresSafeArea())
            .toolbarBackground(JK.bg, for: .navigationBar)
    }
}
