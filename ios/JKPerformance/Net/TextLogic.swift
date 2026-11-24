import Foundation

// Plain-text rules shared by the guide renderer and message bubbles. Pure
// Foundation so the Linux decoder check (ios/JKPerformanceTests) runs them.

/// The guide's inline formatting (F14): `**bold**` and `_italic_` (an
/// underscore pair at word boundaries). Everything else, HTML-looking text
/// included, is text.
enum InlineMarkup {
    struct Run: Equatable {
        var text: String
        var bold = false
        var italic = false
    }

    static func runs(_ source: String) -> [Run] {
        var out: [Run] = []
        var buffer = ""
        var bold = false
        var italic = false
        let chars = Array(source)
        var i = 0

        func flush() {
            guard !buffer.isEmpty else { return }
            if let last = out.last, last.bold == bold, last.italic == italic {
                out[out.count - 1].text += buffer
            } else {
                out.append(Run(text: buffer, bold: bold, italic: italic))
            }
            buffer = ""
        }

        func isWord(_ c: Character?) -> Bool { c.map { $0.isLetter || $0.isNumber } ?? false }

        while i < chars.count {
            let c = chars[i]
            if c == "*", i + 1 < chars.count, chars[i + 1] == "*" {
                // Open only when a closing pair follows; close whatever is open.
                if bold || hasClosing(chars, from: i + 2, marker: "**") {
                    flush()
                    bold.toggle()
                    i += 2
                    continue
                }
            }
            if c == "_" {
                let before: Character? = i > 0 ? chars[i - 1] : nil
                let after: Character? = i + 1 < chars.count ? chars[i + 1] : nil
                if !italic, !isWord(before), after.map({ !$0.isWhitespace }) ?? false, hasClosingUnderscore(chars, from: i + 1) {
                    flush()
                    italic = true
                    i += 1
                    continue
                }
                if italic, !isWord(after), before.map({ !$0.isWhitespace }) ?? false {
                    flush()
                    italic = false
                    i += 1
                    continue
                }
            }
            buffer.append(c)
            i += 1
        }
        flush()
        return out
    }

    /// The text without markers (VoiceOver, previews).
    static func plain(_ source: String) -> String { runs(source).map(\.text).joined() }

    private static func hasClosing(_ chars: [Character], from start: Int, marker: String) -> Bool {
        guard start < chars.count else { return false }
        return String(chars[start...]).contains(marker)
    }

    private static func hasClosingUnderscore(_ chars: [Character], from start: Int) -> Bool {
        var j = start
        while j < chars.count {
            if chars[j] == "_", j > start, !chars[j - 1].isWhitespace {
                let after: Character? = j + 1 < chars.count ? chars[j + 1] : nil
                if !(after.map { $0.isLetter || $0.isNumber } ?? false) { return true }
            }
            j += 1
        }
        return false
    }
}

/// Links in plain text. Only https opens, so a message can never launch a
/// custom scheme or a plain-http page.
enum LinkScan {
    struct Match: Equatable {
        var range: Range<String.Index>
        var url: URL
    }

    /// The https links in `text`, in order. Trailing sentence punctuation is not part of a link.
    static func links(in text: String) -> [Match] {
        var out: [Match] = []
        var searchStart = text.startIndex
        while let hit = text.range(of: "https://", options: [.caseInsensitive], range: searchStart..<text.endIndex) {
            var end = hit.upperBound
            while end < text.endIndex, !text[end].isWhitespace, !"<>\"'".contains(text[end]) {
                end = text.index(after: end)
            }
            // Drop trailing punctuation a sentence puts after a link.
            while end > hit.upperBound, ".,;:!?)]}".contains(text[text.index(before: end)]) {
                end = text.index(before: end)
            }
            if end > hit.upperBound, let url = https(String(text[hit.lowerBound..<end])) {
                out.append(Match(range: hit.lowerBound..<end, url: url))
            }
            searchStart = end > hit.upperBound ? end : hit.upperBound
        }
        return out
    }

    /// The URL when it is a well-formed https link with a host, else nil.
    static func https(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string.trimmingCharacters(in: .whitespaces)),
              url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty else { return nil }
        return url
    }
}

/// The plan page links that invitations, nudges and guide shares carry
/// (F13: `/plan/<token>`, F14: `/plan/<token>/guide/<guideId>`). On our own
/// host the app opens them natively; the token's subject is an enrolment id.
enum PlanLink: Equatable {
    case enrolment(String)
    case guide(String)

    static func parse(_ url: URL, host: String?) -> PlanLink? {
        guard url.scheme?.lowercased() == "https", let host, url.host?.lowercased() == host.lowercased() else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 2, parts[0] == "plan" else { return nil }
        if parts.count == 4, parts[2] == "guide", parts[3].hasPrefix("gb_") { return .guide(parts[3]) }
        guard parts.count == 2 else { return nil }
        let subject = parts[1].split(separator: ".").first.map(String.init) ?? ""
        return subject.hasPrefix("ce_") ? .enrolment(subject) : nil
    }
}
