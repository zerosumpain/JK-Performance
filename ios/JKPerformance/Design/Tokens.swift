import SwiftUI
import UIKit

/// Plan. Act. Review. tokens (docs/design/plan-act-review.md, "Look"):
/// monochrome silver on near-black. The app is forced dark and light mode is
/// out of scope for now, so each pair carries the dark value twice; the pair
/// form stays so light can later be a pure token swap.
///
/// Keep each colour on one line in the `pair(0xDARK, 0xLIGHT…)` form:
/// scripts/contrast-check.mjs reads this file and checks it against the spec.
enum JK {
    // MARK: Surfaces (elevation comes from surface steps only)

    static let bg = pair(0x0A0A0A, 0x0A0A0A)
    static let surface = pair(0x121212, 0x121212)
    /// Pressed cards and inputs.
    static let raised = pair(0x1A1A1A, 0x1A1A1A)
    /// Letters and guides: the card surface now.
    static let paper = pair(0x121212, 0x121212)
    /// Card borders (1pt) and dividers. Decorative: never the only boundary of an input.
    static let hairline = pair(0x262626, 0x262626)
    /// Text-field underlines, steppers and input outlines (3:1 non-text).
    static let inputBorder = pair(0x6B6B6B, 0x6B6B6B)
    /// The SecondaryButton outline. Its label identifies it, so it need not reach 3:1.
    static let buttonBorder = pair(0x3A3A3A, 0x3A3A3A)
    /// The empty track of a ring or rule; never carries state on its own.
    static let track = pair(0xFFFFFF, 0xFFFFFF, darkAlpha: 0.10, lightAlpha: 0.10)
    /// Idle states that carry meaning (missed, not yet) and the week-line rule (3:1).
    static let trackStrong = pair(0x6B6B6B, 0x6B6B6B)
    static let scrim = pair(0x000000, 0x000000, darkAlpha: 0.60, lightAlpha: 0.60)

    // MARK: Text

    static let text = pair(0xF2F2F2, 0xF2F2F2)
    /// Body copy and captions.
    static let textSecondary = pair(0xA3A3A3, 0xA3A3A3)
    /// Tracked labels and meta (5:1 even on raised).
    static let textTertiary = pair(0x8A8A8A, 0x8A8A8A)

    // MARK: Silver

    /// Filled ring progress, done marks, the selected tab dot.
    static let silver = pair(0xD9D9D9, 0xD9D9D9)
    /// The PrimaryButton's chrome: a vertical gradient through these three.
    static let chromeTop = pair(0xFAFAFA, 0xFAFAFA)
    static let chromeMid = pair(0xBEBEBE, 0xBEBEBE)
    static let chromeBottom = pair(0xE8E8E8, 0xE8E8E8)
    /// The 1pt highlight along the top of the chrome.
    static let chromeHighlight = pair(0xFFFFFF, 0xFFFFFF, darkAlpha: 0.60, lightAlpha: 0.60)
    /// Label on the chrome.
    static let onChrome = pair(0x0A0A0A, 0x0A0A0A)

    // MARK: Old names, now silver (no champagne anywhere)

    /// Was champagne; now silver. Achievement and JK marks only.
    static let accent = pair(0xD9D9D9, 0xD9D9D9)
    static let accentPressed = pair(0xBEBEBE, 0xBEBEBE)
    /// The goal target band only.
    static let accentWash = pair(0xD9D9D9, 0xD9D9D9, darkAlpha: 0.12, lightAlpha: 0.12)
    /// Toggles and selection tint.
    static let accentControl = pair(0xF2F2F2, 0xF2F2F2)

    // MARK: Actions

    /// Solid fills for selected chips and the send button.
    static let primaryFill = pair(0xE8E8E8, 0xE8E8E8)
    static let primaryPressed = pair(0xBEBEBE, 0xBEBEBE)
    /// Label on `primaryFill`.
    static let onPrimary = pair(0x0A0A0A, 0x0A0A0A)

    // MARK: Status (coach screens only; always with a word and a glyph)

    /// Sage.
    static let onTrack = pair(0x9FB39A, 0x9FB39A)
    /// Terracotta, "Worth a look". Coach only.
    static let attention = pair(0xD98E5B, 0xD98E5B)
    /// Value-free numbers and chart lines: silver grey, so client charts stay monochrome.
    static let data = pair(0xB0B0B0, 0xB0B0B0)
    /// Clay: system errors only.
    static let error = pair(0xC9735F, 0xC9735F)
    /// Coach app only.
    static let urgent = pair(0xE8816F, 0xE8816F)

    // MARK: Booking kinds (greys, always beside a word)

    static let kindInPerson = pair(0xD9D9D9, 0xD9D9D9)
    static let kindVideo = pair(0xA3A3A3, 0xA3A3A3)
    static let kindGroup = pair(0x8C8C8C, 0x8C8C8C)

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
        static let cardPadding: CGFloat = 16
        static let section: CGFloat = 32
        static let row: CGFloat = 12
    }

    enum Radius {
        static let chip: CGFloat = 8
        static let control: CGFloat = 10
        static let button: CGFloat = 12
        static let card: CGFloat = 16
        /// The JK. mark in the top bar.
        static let mark: CGFloat = 8
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
        static let weekDot: CGFloat = 5
        /// Rings: card icon, habit or priority, commitment; 1.5pt stroke.
        static let ringCard: CGFloat = 28
        static let ringHabit: CGFloat = 44
        static let ringCommitment: CGFloat = 56
        static let ringStroke: CGFloat = 1.5
        /// The top bar: the JK. mark and JK's avatar.
        static let topMark: CGFloat = 28
        static let topAvatar: CGFloat = 30
        /// The selected tab's dot.
        static let tabDot: CGFloat = 4
        /// The Welcome mark.
        static let welcomeMark: CGFloat = 120
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
        /// Plan. Act. Review.: 200ms fades and 400ms ring fills.
        static let fade = Animation.easeOut(duration: 0.2)
        static let ringFill = Animation.easeOut(duration: 0.4)

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
    /// A scrolling screen on the near-black ground.
    func jkScreen() -> some View {
        self
            .background(JK.bg.ignoresSafeArea())
            .toolbarBackground(JK.bg, for: .navigationBar)
    }
}
