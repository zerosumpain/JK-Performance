import SwiftUI

/// Plain text whose https links are tappable and underlined (F13: invitations
/// and nudges carry the plan link). Never markdown and never HTML: the text is
/// shown as typed, and only `https` links open. The tap goes through the
/// environment's `openURL`, so a screen can open our own plan links natively.
struct LinkedText: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(Self.attributed(text))
    }

    static func attributed(_ text: String) -> AttributedString {
        var out = AttributedString(text)
        for match in LinkScan.links(in: text) {
            let lower = text.distance(from: text.startIndex, to: match.range.lowerBound)
            let length = text.distance(from: match.range.lowerBound, to: match.range.upperBound)
            let start = out.index(out.startIndex, offsetByCharacters: lower)
            let end = out.index(start, offsetByCharacters: length)
            out[start..<end].link = match.url
            out[start..<end].underlineStyle = Text.LineStyle(pattern: .solid)
        }
        return out
    }
}

extension View {
    /// Our own plan links (`/plan/<token>` and its guides) open in the app for
    /// a client; everything else opens in the browser.
    func planLinksOpenInApp(_ open: Bool = true) -> some View {
        environment(\.openURL, OpenURLAction { url in
            guard open, let link = PlanLink.parse(url, host: APIClient.shared.baseURL.host) else { return .systemAction }
            switch link {
            case .enrolment(let id): TabRouter.shared.push(.campaign(id))
            case .guide(let id): TabRouter.shared.push(.coachGuide(id))
            }
            return .handled
        })
    }
}
