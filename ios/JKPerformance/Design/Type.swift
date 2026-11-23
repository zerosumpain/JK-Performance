import SwiftUI
import UIKit

/// The Atelier type scale (docs/design/atelier-spec.md, "TYPE"). Two families:
/// the system sans for everything, and Newsreader (OFL, bundled, variable with
/// an opsz axis) for JK's voice only: his words, the goal sentence, letter and
/// guide headlines, empty-state lines. Never below 17pt.
///
/// Every size scales with Dynamic Type: sans tokens use the matching text style
/// where the size matches, otherwise UIFontMetrics; serif tokens use
/// Font.custom(_:size:relativeTo:). This is the only file allowed literal font
/// sizes (scripts/lint-design.sh).
///
/// CoreText applies automatic optical sizing to fonts with an opsz axis (the
/// axis tracks the point size), so the serif needs no per-token opsz setting.
/// Verify on a device; if it does not, set kCTFontOpticalSizeAttribute here.
enum JKType {
    /// PostScript names of the bundled variable fonts (default instance:
    /// wght 400, opsz 18), checked with fontTools.
    static let serifRoman = "Newsreader16pt-Regular"
    static let serifItalic = "Newsreader16pt-Italic"

    /// A sans size scaled like `style`.
    static func scaled(_ base: CGFloat, _ style: UIFont.TextStyle) -> CGFloat {
        UIFontMetrics(forTextStyle: style).scaledValue(for: base)
    }
}

extension Font {
    // MARK: Sans

    /// 34/40 Light, tracking −0.4 (greeting, screen titles). Caps at accessibility1: use `.jkDisplayText()`.
    static var jkDisplay: Font { .largeTitle.weight(.light) }
    /// 17/24 Semibold.
    static var jkHeadline: Font { .headline }
    /// 17/24 Regular.
    static var jkBody: Font { .body }
    /// 15/20 Medium: buttons and row labels.
    static var jkCallout: Font { .subheadline.weight(.medium) }
    /// 13/18 Medium, +0.2 tracking. The client screen floor.
    static var jkCaption: Font { .footnote.weight(.medium) }
    /// 11/14 Semibold, uppercase, +1.2 tracking: the one-per-screen label (use `JKLabel`).
    static var jkLabel: Font { .caption2.weight(.semibold) }
    /// 11 Medium: dense coach grids and calendar cell numbers only (below the
    /// client floor; a deviation kept for the month grid and coach agenda).
    static var jkMicro: Font { .caption2.weight(.medium) }
    /// 48/52 Light tabular, scaled like .largeTitle.
    static var jkNumberHero: Font {
        .system(size: JKType.scaled(48, .largeTitle), weight: .light).monospacedDigit()
    }
    /// 28/32 Regular tabular, scaled like .title.
    static var jkNumberTile: Font { .title.monospacedDigit() }
    /// Tabular figures at body size, for inline numbers.
    static var jkNumber: Font { .body.monospacedDigit() }

    // MARK: Serif (JK's voice)

    /// 30/36 Regular, relative to .title.
    static var jkLetterHeadline: Font { .custom(JKType.serifRoman, size: 30, relativeTo: .title) }
    /// 22/28 Regular, relative to .title2: the goal sentence, letter section heads.
    static var jkTitle: Font { .custom(JKType.serifRoman, size: 22, relativeTo: .title2) }
    /// 19/28 Italic, relative to .title3: JK's line.
    static var jkQuote: Font { .custom(JKType.serifItalic, size: 19, relativeTo: .title3) }
    /// 17/24 Italic inside sheets, relative to .body.
    static var jkQuoteSmall: Font { .custom(JKType.serifItalic, size: 17, relativeTo: .body) }
    /// 17/24 Regular serif, relative to .body: the empty-state line when upright.
    static var jkSerifBody: Font { .custom(JKType.serifRoman, size: 17, relativeTo: .body) }

    // MARK: Plan. Act. Review.

    /// Body 15/21 (textSecondary).
    static var jkBodySmall: Font { .subheadline }
    /// Card meta 12/16 (textTertiary).
    static var jkMeta: Font { .caption }
    /// A button label: 16 Semibold, scaled like .callout.
    static var jkButton: Font { .system(size: JKType.scaled(16, .callout), weight: .semibold) }
    /// The small SecondaryButton: 13 Semibold.
    static var jkButtonSmall: Font { .footnote.weight(.semibold) }
    /// The tab words and the tracked labels: 11 Semibold.
    static var jkTab: Font { .caption2.weight(.semibold) }

    /// Newsreader at one of the board's sizes, roman or italic.
    static func jkSerif(_ size: SerifSize, italic: Bool = false) -> Font {
        .custom(italic ? JKType.serifItalic : JKType.serifRoman, size: size.metrics.size, relativeTo: size.textStyle)
    }
}

/// The display serif sizes (plan-act-review.md, "Type").
enum SerifSize {
    /// 34/40: the exercise name, Welcome's "Plan. Act. Review."
    case hero
    /// 30/36: screen titles ("Today's work.").
    case title
    /// 24/30: the season's aim.
    case quote
    /// 19/27: JK's notes.
    case notes
    /// 18/24: card titles.
    case card
    /// 17/24: JK's cue (italic).
    case cue
    /// 15/20: priority and commitment titles.
    case small
    /// 13/16: annotations (italic) on a label row.
    case annotation

    var metrics: (size: CGFloat, line: CGFloat) {
        switch self {
        case .hero: return (34, 40)
        case .title: return (30, 36)
        case .quote: return (24, 30)
        case .notes: return (19, 27)
        case .card: return (18, 24)
        case .cue: return (17, 24)
        case .small: return (15, 20)
        case .annotation: return (13, 16)
        }
    }

    var textStyle: Font.TextStyle {
        switch self {
        case .hero: return .largeTitle
        case .title: return .title
        case .quote: return .title2
        case .notes: return .title3
        case .card: return .headline
        case .cue: return .body
        case .small: return .subheadline
        case .annotation: return .footnote
        }
    }
}

/// Serif text with one emphasised phrase in italic, written with asterisks
/// as on the board: "Good morning,\n*Sam.*", "Plan. *Act.* Review.". Wraps,
/// never truncates; scales with Dynamic Type.
struct SerifText: View {
    let markup: String
    var size: SerifSize = .title
    /// Draw every word in italic (JK's cue, annotations).
    var allItalic = false

    init(_ markup: String, size: SerifSize = .title, allItalic: Bool = false) {
        self.markup = markup
        self.size = size
        self.allItalic = allItalic
    }

    /// Roman/italic runs from "*…*" markup.
    static func runs(_ markup: String) -> [(text: String, italic: Bool)] {
        var out: [(text: String, italic: Bool)] = []
        var italic = false
        for (i, part) in markup.components(separatedBy: "*").enumerated() {
            if i > 0 { italic.toggle() }
            if !part.isEmpty { out.append((text: part, italic: italic)) }
        }
        return out
    }

    /// "Goblet squat" → "Goblet *squat*": the last word in italic.
    static func lastWordItalic(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard let space = trimmed.lastIndex(of: " ") else { return "*\(trimmed)*" }
        return "\(trimmed[..<space]) *\(trimmed[trimmed.index(after: space)...])*"
    }

    var body: some View {
        let m = size.metrics
        Self.runs(markup).reduce(Text("")) { acc, run in
            acc + Text(run.text).font(.jkSerif(size, italic: allItalic || run.italic))
        }
        .lineSpacing(max(0, m.line - m.size * 1.2))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityLabel(markup.replacingOccurrences(of: "*", with: ""))
    }
}

/// The type tokens as modifiers, for the parts a Font alone cannot carry:
/// line height, tracking, case and the accessibility switches.
enum JKTextStyle {
    case display, letterHeadline, title, quote, quoteSmall, headline, body, callout, caption, label,
         numberHero, numberTile

    var font: Font {
        switch self {
        case .display: return .jkDisplay
        case .letterHeadline: return .jkLetterHeadline
        case .title: return .jkTitle
        case .quote: return .jkQuote
        case .quoteSmall: return .jkQuoteSmall
        case .headline: return .jkHeadline
        case .body: return .jkBody
        case .callout: return .jkCallout
        case .caption: return .jkCaption
        case .label: return .jkLabel
        case .numberHero: return .jkNumberHero
        case .numberTile: return .jkNumberTile
        }
    }

    /// (size, line height) at the default text size.
    var metrics: (size: CGFloat, line: CGFloat) {
        switch self {
        case .display: return (34, 40)
        case .letterHeadline: return (30, 36)
        case .title: return (22, 28)
        case .quote: return (19, 28)
        case .quoteSmall: return (17, 24)
        case .headline, .body: return (17, 24)
        case .callout: return (15, 20)
        case .caption: return (13, 18)
        case .label: return (11, 14)
        case .numberHero: return (48, 52)
        case .numberTile: return (28, 32)
        }
    }

    var tracking: CGFloat {
        switch self {
        case .display: return -0.4
        case .caption: return 0.2
        case .label: return 1.6
        default: return 0
        }
    }

    /// Display and number tokens stop growing at accessibility1.
    var capsAtAccessibility1: Bool {
        switch self {
        case .display, .numberHero, .numberTile: return true
        default: return false
        }
    }

    var isItalicSerif: Bool { self == .quote || self == .quoteSmall }
}

private struct JKTextStyleModifier: ViewModifier {
    let style: JKTextStyle
    @Environment(\.dynamicTypeSize) private var size

    func body(content: Content) -> some View {
        let m = style.metrics
        let accessible = size.isAccessibilitySize
        content
            .font(font)
            .tracking(style == .label && accessible ? 0 : style.tracking)
            .lineSpacing(max(0, m.line - m.size * 1.2))
            .textCase(style == .label && !accessible ? .uppercase : nil)
            .dynamicTypeSize(style.capsAtAccessibility1 ? ...DynamicTypeSize.accessibility1 : ...DynamicTypeSize.accessibility5)
    }

    private var font: Font {
        // At AX3 and larger, italic quotes switch to the sans italic.
        if style.isItalicSerif && size >= .accessibility3 {
            return style == .quote ? .title3.italic() : .body.italic()
        }
        return style.font
    }
}

extension View {
    /// Applies a type token with its line height, tracking and accessibility rules.
    func jkText(_ style: JKTextStyle) -> some View {
        modifier(JKTextStyleModifier(style: style))
    }
}
