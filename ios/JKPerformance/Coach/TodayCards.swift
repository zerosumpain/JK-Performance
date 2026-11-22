import SwiftUI

// MARK: - Coach Today: one ranked "Needs you" list

/// The coach's Today (atelier-spec.md, Coach screens 1): a thin strip with
/// the next session, the letters-due line, then one ranked list with each
/// client once and one action, ending "All caught up". From
/// GET /api/coach/needs-you.
struct NeedsYouList: View {
    let data: NeedsYou
    @Binding var lettersOnly: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xl) {
            SessionsStrip(sessions: data.sessionsToday)
            if let due = data.lettersDue, due.count > 0 {
                LettersDueHeader(due: due, filtering: $lettersOnly)
            }
            if lettersOnly, let due = data.lettersDue {
                lettersDueList(due)
            } else {
                itemsList
            }
            AllCaughtUp(done: data.items.isEmpty)
        }
    }

    @ViewBuilder
    private var itemsList: some View {
        if !data.items.isEmpty {
            VStack(spacing: 0) {
                ForEach(data.items) { item in
                    NeedsYouRow(item: item)
                    if item.id != data.items.last?.id { GroupDivider(inset: JK.Space.l + JK.Size.avatar + JK.Space.m) }
                }
            }
            .surface(.group)
        }
    }

    private func lettersDueList(_ due: LettersDue) -> some View {
        VStack(spacing: 0) {
            ForEach(due.clients ?? []) { c in
                let person = PersonRef(id: c.id, name: c.name, initials: c.initials)
                HStack(spacing: JK.Space.m) {
                    NavigationLink { ClientDetailView(clientId: c.id, name: c.name) } label: {
                        HStack(spacing: JK.Space.m) {
                            Avatar(initials: c.initials ?? Fmt.initials(c.name))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.name).font(.jkCallout).foregroundStyle(JK.text)
                                Text(c.media == true ? "Weekly letter with a voice note" : "Weekly letter")
                                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    NavigationLink { LetterComposer(client: person, week: due.week) } label: {
                        Text("Write letter")
                    }
                    .buttonStyle(SmallPillStyle())
                }
                .padding(.horizontal, JK.Space.l)
                .padding(.vertical, JK.Space.m)
            }
        }
        .surface(.group)
    }
}

/// "Next: Sam · 07:00 · Studio" and "3 of 5 sessions today"; opens the day agenda.
struct SessionsStrip: View {
    let sessions: SessionsToday?

    var body: some View {
        NavigationLink { DayAgendaView() } label: {
            HStack(spacing: JK.Space.m) {
                Icon(key: .week).foregroundStyle(JK.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(nextLine).font(.jkCallout).foregroundStyle(JK.text)
                    Text(countLine).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
                Image(systemName: IconKey.chevron.symbol).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, JK.Space.s)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the day agenda.")
    }

    private var nextLine: String {
        guard let next = sessions?.next else {
            return (sessions?.total ?? 0) == 0 ? "No sessions today" : "No more sessions today"
        }
        let who = next.isGroup ? (next.title ?? "Class") : (next.client.map { Fmt.firstWord($0.name) } ?? next.title ?? next.kindLabel)
        return (["Next: \(who)", Fmt.time(next.start), next.location].compactMap { $0 }).joined(separator: " · ")
    }

    private var countLine: String {
        guard let s = sessions, s.total > 0 else { return "See the day agenda" }
        return "\(s.done) of \(s.total) sessions today"
    }
}

/// "Letters due: 6 · about 40 min". Tapping filters the list to them.
struct LettersDueHeader: View {
    let due: LettersDue
    @Binding var filtering: Bool

    var body: some View {
        Button {
            filtering.toggle()
        } label: {
            HStack(spacing: JK.Space.s) {
                Icon(key: .letter).foregroundStyle(JK.textSecondary)
                Text(line).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                Spacer(minLength: 0)
                Text(filtering ? "Show all" : "Show").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            .frame(minHeight: JK.Size.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(filtering ? .isSelected : [])
    }

    private var line: String {
        let time = due.estMinutes.map { " · about \($0) min" } ?? ""
        return "Letters due: \(due.count)\(time)"
    }
}

/// One client, once: avatar, reason glyphs, one-line reason and one action.
struct NeedsYouRow: View {
    let item: NeedsItem

    private var glyphs: [IconKey] {
        var seen: [IconKey] = []
        for reason in item.reasons {
            let key = IconKey(stored: reason.iconKey)
            if !seen.contains(key) { seen.append(key) }
        }
        return Array(seen.prefix(3))
    }

    var body: some View {
        HStack(alignment: .center, spacing: JK.Space.m) {
            NavigationLink { ClientDetailView(clientId: item.client.id, name: item.client.name) } label: {
                summary
            }
            .buttonStyle(.plain)
            if let action = item.primaryAction {
                NavigationLink { destination(action) } label: { Text(action.label) }
                    .buttonStyle(SmallPillStyle())
            }
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.m)
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: JK.Space.m) {
            Avatar(initials: item.client.displayInitials)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                HStack(spacing: JK.Space.s) {
                    Text(item.client.name).font(.jkCallout).foregroundStyle(JK.text)
                    ForEach(glyphs, id: \.self) { key in
                        Icon(key: key, size: 15, label: key.accessibilityName).foregroundStyle(JK.textSecondary)
                    }
                }
                Text(item.reasonLine ?? item.reasons.first?.text ?? "")
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// A milestone letter only when the milestone is the top reason.
    private var milestone: NeedsReason? {
        guard let top = item.reasons.first, top.kind == "milestone" else { return nil }
        return top
    }

    @ViewBuilder
    private func destination(_ action: NeedsAction) -> some View {
        switch action.kind {
        case "writeLetter":
            LetterComposer(client: item.client, milestone: milestone)
        case "readAnswers":
            CoachSubpage(title: "Forms") { ClientAutomationSection(client: item.client) }
        default:
            MessagesThreadView(clientId: item.client.id, otherName: item.client.name,
                               subtitle: item.client.planName ?? Fmt.planName(item.client.plan))
        }
    }
}

/// The end of the list: the brand rule and one serif line.
struct AllCaughtUp: View {
    var done = true

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            BrandRule()
            Text("All caught up.")
                .jkText(.quote)
                .foregroundStyle(JK.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, JK.Space.l)
        .accessibilityElement(children: .combine)
    }
}

extension Fmt {
    /// "Sam Carter" → "Sam".
    static func firstWord(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }
}
