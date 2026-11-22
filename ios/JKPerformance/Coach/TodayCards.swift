import SwiftUI

/// The coach's Today screen as a grid of cards: each says what's waiting,
/// how many, and when it's from or due, and opens the list behind it.
/// Urgent clients sit above the grid; today's sessions below it.
struct TodayCards: View {
    let today: CoachToday

    private let grid = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    private var sessions: [Booking] { today.sessions.sorted { $0.start < $1.start } }
    private var upcomingSessions: [Booking] { sessions.filter { $0.end > Date() } }

    var body: some View {
        if let urgent = today.urgent, !urgent.isEmpty {
            urgentCard(urgent)
        }

        LazyVGrid(columns: grid, spacing: 10) {
            nextSessionCard
            messagesCard
            NavigationLink {
                PeopleListView(title: "Check-ins to reply to", people: (today.checkinClients ?? []).map {
                    PeopleListView.Row(person: $0.ref, detail: $0.at.map { "Sent \(Fmt.relative($0))" } ?? "", tab: .feedback)
                })
            } label: {
                SummaryCard(systemName: "square.and.pencil", title: "Check-ins", count: today.checkinsToReview ?? 0,
                            detail: oldest(today.checkinClients).map { "Oldest \(Fmt.relative($0))" } ?? "All replied",
                            tint: (today.checkinsToReview ?? 0) > 0 ? JK.attention : nil)
            }
            .disabled((today.checkinsToReview ?? 0) == 0)
            NavigationLink { ProgramsView(initialTab: .forms) } label: {
                SummaryCard(systemName: "doc.text", title: "Forms to read", count: today.formsToReview ?? 0,
                            detail: names(today.formClients?.map(\.name)) ?? "Nothing new",
                            tint: (today.formsToReview ?? 0) > 0 ? JK.attention : nil)
            }
            feedbackCard
            NavigationLink {
                PeopleListView(title: "Not spoken to lately", people: (today.quiet ?? []).map {
                    PeopleListView.Row(person: $0.ref, detail: "No contact in \($0.days) days", tab: .plan)
                })
            } label: {
                SummaryCard(systemName: "moon.zzz", title: "Gone quiet", count: today.quiet?.count ?? 0,
                            detail: today.quiet?.first.map { "\($0.name.split(separator: " ").first ?? "") · \($0.days) days" } ?? "Everyone's in touch",
                            tint: nil)
            }
            .disabled((today.quiet ?? []).isEmpty)
            NavigationLink { ProgramsView(initialTab: .autoflows) } label: {
                SummaryCard(systemName: "bolt", title: "Autoflows", count: today.upcoming?.count ?? 0,
                            detail: autoflowDetail, tint: nil, countLabel: "this week")
            }
            Button { TabRouter.shared.coach = .schedule } label: {
                SummaryCard(systemName: "calendar", title: "This week", count: today.sessionsLeftThisWeek ?? 0,
                            detail: "sessions still to come", tint: nil)
            }
            .buttonStyle(.plain)
        }

        let inactive = (today.attention ?? []).filter { $0.kind == "inactive" }
        if !inactive.isEmpty {
            Eyebrow(text: "No training lately")
            VStack(spacing: 0) {
                ForEach(inactive, id: \.self) { item in
                    NavigationLink { ClientDetailView(clientId: item.client.id, name: item.client.name) } label: {
                        personRow(item.client, item.reason)
                    }
                }
            }
            .jkCard(padding: 2)
        }

        Eyebrow(text: "Sessions today", trailing: sessions.isEmpty ? nil : "\(upcomingSessions.count) to go")
        if sessions.isEmpty {
            Text("Nothing booked today.").font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        ForEach(sessions) { s in
            SessionRow(session: s, isNext: s.id == upcomingSessions.first?.id)
        }
    }

    // MARK: Cards

    private func urgentCard(_ items: [AttentionItem]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(items.count == 1 ? "Needs you first" : "\(items.count) need you first", systemImage: "exclamationmark.triangle.fill")
                .font(.jkCaption.weight(.semibold))
                .foregroundStyle(JK.urgent)
                .padding(.horizontal, 10).padding(.top, 8)
            ForEach(items, id: \.self) { item in
                NavigationLink { ClientDetailView(clientId: item.client.id, name: item.client.name, initialTab: .feedback) } label: {
                    personRow(item.client, item.reason)
                }
            }
        }
        .jkCard(padding: 2)
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.urgent.opacity(0.55), lineWidth: 1))
    }

    @ViewBuilder
    private var nextSessionCard: some View {
        if let next = upcomingSessions.first {
            NavigationLink {
                if let c = next.client, !next.isGroup {
                    ClientDetailView(clientId: c.id, name: c.name)
                } else {
                    ClassDetailView(booking: next)
                }
            } label: {
                SummaryCard(systemName: "clock", title: "Next session", value: Fmt.time(next.start),
                            detail: "\(next.client?.name ?? next.title ?? next.kindLabel) · \(Fmt.countdown(to: next.start) ?? "now")",
                            tint: JK.slot(next.kind))
            }
        } else {
            Button { TabRouter.shared.coach = .schedule } label: {
                SummaryCard(systemName: "clock", title: "Sessions today", value: sessions.isEmpty ? "None" : "Done",
                            detail: sessions.isEmpty ? "Nothing booked" : "All \(sessions.count) finished", tint: nil)
            }
            .buttonStyle(.plain)
        }
    }

    private var messagesCard: some View {
        Button { TabRouter.shared.coach = .messages } label: {
            SummaryCard(systemName: "bubble.left", title: "Messages", count: today.unread,
                        detail: today.unreadClients?.first?.at.map { "Newest \(Fmt.relative($0)) · \(names(today.unreadClients?.map(\.name)) ?? "")" } ?? "No unread",
                        tint: today.unread > 0 ? JK.attention : nil, countLabel: "unread")
        }
        .buttonStyle(.plain)
    }

    private var feedbackCard: some View {
        let due = today.feedbackDue
        let count = due?.clients.count ?? 0
        return NavigationLink {
            if let due { FeedbackDueView(due: due) }
        } label: {
            SummaryCard(systemName: "text.bubble", title: "Feedback to write", count: count,
                        detail: count == 0 ? "All published" : dueText(due), tint: count > 0 && isOverdue(due) ? JK.urgent : (count > 0 ? JK.attention : nil))
        }
        .disabled(count == 0)
    }

    private var autoflowDetail: String {
        guard let first = today.upcoming?.first else { return "Nothing due" }
        let when = Day.date(first.date).map { Day.same($0, Date()) ? "today" : Fmt.weekday($0) } ?? first.date
        return "\(first.client.name.split(separator: " ").first ?? "") · \(first.action) \(when)"
    }

    // MARK: Helpers

    private func personRow(_ p: PersonRef, _ reason: String) -> some View {
        HStack(spacing: 12) {
            Avatar(initials: p.displayInitials, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Text(reason).font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(2)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        .padding(10)
    }

    private func oldest(_ people: [PersonAt]?) -> Date? { people?.compactMap(\.at).min() }

    private func names(_ list: [String]?) -> String? {
        guard let list, !list.isEmpty else { return nil }
        let first = list.prefix(2).map { $0.split(separator: " ").first.map(String.init) ?? $0 }
        return first.joined(separator: ", ") + (list.count > 2 ? " +\(list.count - 2)" : "")
    }

    private func dueText(_ due: FeedbackDue?) -> String {
        guard let due, let by = due.dueBy.flatMap(Day.date) else { return "" }
        if isOverdue(due) { return "Week of \(Fmt.dayMonth(due.week)) · was due \(Fmt.weekday(by))" }
        return Day.same(by, Date()) ? "Due today" : "Due \(Fmt.weekday(by)) \(Fmt.dayMonth(by))"
    }

    private func isOverdue(_ due: FeedbackDue?) -> Bool {
        guard let by = due?.dueBy.flatMap(Day.date) else { return false }
        return Day.start(Date()) > by
    }
}

/// One card in the Today grid: an icon, a big number (or value), and when.
struct SummaryCard: View {
    let systemName: String
    let title: String
    var count: Int? = nil
    var value: String? = nil
    let detail: String
    let tint: Color?
    var countLabel: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: systemName).font(.jkCaption).foregroundStyle(tint ?? JK.textTertiary)
                Spacer()
                if let tint { Dot(color: tint, size: 7) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value ?? "\(count ?? 0)")
                    .font(.jkNumberTile)
                    .foregroundStyle((count ?? 1) == 0 && value == nil ? JK.textTertiary : JK.text)
                    .lineLimit(1).minimumScaleFactor(0.6)
                if let countLabel { Text(countLabel).font(.jkCaption).foregroundStyle(JK.textTertiary) }
            }
            Text(title).font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
            Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(2, reservesSpace: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(tint?.opacity(0.4) ?? JK.hairline, lineWidth: 1))
    }
}

/// A short list of clients behind a Today card, each opening their page.
struct PeopleListView: View {
    struct Row: Identifiable {
        let person: PersonRef
        let detail: String
        let tab: ClientDetailView.Tab
        var id: String { person.id }
    }

    let title: String
    let people: [Row]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ScreenHeader(eyebrow: "Today", title: title)
                if people.isEmpty {
                    EmptyCard(systemName: "checkmark", title: "Nothing waiting")
                }
                ForEach(people) { row in
                    NavigationLink { ClientDetailView(clientId: row.person.id, name: row.person.name, initialTab: row.tab) } label: {
                        HStack(spacing: 12) {
                            Avatar(initials: row.person.displayInitials, size: 32)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.person.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                                Text(row.detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        .jkCard(padding: 12)
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}
