import SwiftUI

/// What the client is working towards: one serif sentence, the 2pt champagne
/// goal rule, and a tabular "x to go".
struct GoalLine: View {
    enum GoalState: Equatable {
        /// `progress` 0...1 along the rule; `remaining` e.g. "3.2 kg to go".
        case set(sentence: String, progress: Double, remaining: String)
        case notSet
        case reached(sentence: String)
    }

    let state: GoalState

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            switch state {
            case .set(let sentence, let progress, let remaining):
                Text(sentence).jkText(.title).foregroundStyle(JK.text)
                rule(progress)
                Text(remaining).jkText(.numberTile).foregroundStyle(JK.text)
            case .notSet:
                Text("JK will set your goal with you this week.").jkText(.quote).foregroundStyle(JK.text)
            case .reached(let sentence):
                Text(sentence).jkText(.title).foregroundStyle(JK.text)
                rule(1)
                Text("Reached. JK will set the next one with you").font(.jkCaption).foregroundStyle(JK.silver)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func rule(_ fraction: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(JK.track)
                Rectangle().fill(JK.silver).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: JK.Size.rule)
        .accessibilityHidden(true)
    }
}

/// What JK said: his avatar with a caption and unread dot, his line in serif
/// italic (at most two lines), and Reply.
struct CoachNote: View {
    let coach: PersonRef?
    /// "JK · Tuesday".
    let caption: String
    let quote: String
    var unread = false
    var onOpen: () -> Void = {}
    var onReply: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: JK.Space.m) {
                    HStack(spacing: JK.Space.s) {
                        CoachAvatar(coach: coach, size: JK.Size.avatarSmall, unread: unread)
                        Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    Text(quote)
                        .jkText(.quote)
                        .foregroundStyle(JK.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let onReply {
                Button("Reply", action: onReply).buttonStyle(TextButtonStyle())
            }
        }
    }
}

/// The one thing next: the only bordered card on Today. One item, one
/// primary button, an optional "also due" caption.
struct NextCard: View {
    let icon: IconKey
    /// "Next · 6:30 pm".
    let caption: String
    let title: String
    var detail: String? = nil
    let actionTitle: String
    var alsoDue: String? = nil
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            AdaptiveStack(verticalAlignment: .top) {
                Icon(key: icon).foregroundStyle(JK.textSecondary)
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    Text(title).font(.jkHeadline).foregroundStyle(JK.text)
                    if let detail { Text(detail).font(.jkCallout).foregroundStyle(JK.textSecondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            Button(actionTitle, action: action).buttonStyle(PrimaryButtonStyle())
            if let alsoDue {
                Text(alsoDue).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .surface(.next)
    }
}

/// A Progress tile: label, number, status word with its trend glyph, and
/// where the number comes from. Status is a word in textSecondary, never a colour.
struct MetricTile: View {
    enum Trend { case up, flat, down }

    let label: String
    let value: String
    var unit: String? = nil
    var status: String? = nil
    var trend: Trend? = nil
    /// "From Apple Health", "22 of the last 28 days".
    var source: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Text(label).font(.jkCaption).foregroundStyle(JK.textSecondary)
            (Text(value).font(.jkNumberTile).foregroundColor(JK.text)
             + Text(unit.map { " \($0)" } ?? "").font(.jkCaption).foregroundColor(JK.textSecondary))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if status != nil || trend != nil {
                HStack(spacing: JK.Space.xs) {
                    if let trend { Icon(key: key(trend), size: 13).foregroundStyle(JK.textSecondary) }
                    if let status { Text(status).font(.jkCaption).foregroundStyle(JK.textSecondary) }
                }
            }
            if let source {
                Text(source).font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surface(.card, padding: JK.Space.l)
        .accessibilityElement(children: .combine)
    }

    private func key(_ trend: Trend) -> IconKey {
        switch trend {
        case .up: return .trendUp
        case .flat: return .trendFlat
        case .down: return .trendDown
        }
    }
}

/// A letter from JK in the timeline: champagne rule, serif headline, the week
/// it covers, and whether it is new.
struct LetterCard: View {
    let headline: String
    /// "Week of 16 November".
    let caption: String
    var excerpt: String? = nil
    var unread = false
    var milestone = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                HStack(spacing: JK.Space.s) {
                    BrandRule(width: 24)
                    Icon(key: milestone ? .milestone : .letter, size: 15).foregroundStyle(JK.textSecondary)
                    Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    Spacer()
                    if unread {
                        Circle().fill(JK.silver).frame(width: 8, height: 8).accessibilityHidden(true)
                    }
                }
                Text(headline)
                    .jkText(.title)
                    .foregroundStyle(JK.text)
                    .multilineTextAlignment(.leading)
                if let excerpt {
                    Text(excerpt).font(.jkCallout).foregroundStyle(JK.textSecondary).lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .surface(.paper)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(milestone ? "Milestone letter" : "Letter") from JK, \(caption). \(headline)")
        .accessibilityValue(unread ? "New" : "")
    }
}
