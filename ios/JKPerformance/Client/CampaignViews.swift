import SwiftUI

// Campaigns on the client's Act tab (desk-v2.md F13, "Client experience";
// contract docs/api/wp4-campaigns.md). An invitation states everything before
// anyone commits: dates, fee, kit and expected spend, places. Once in, the
// campaign card shows day N of M and today's ticks; the plan screen holds the
// phases, every day, the kit with what was spent, and the guides.
// Client screens are monochrome: silver, greys and words.

// MARK: - API

@MainActor
enum CampaignAPI {
    static func mine() async throws -> CampaignsMine {
        try await APIClient.shared.get("/api/campaigns/mine")
    }

    static func detail(_ enrolmentId: String) async throws -> EnrolmentDetail {
        try await APIClient.shared.get("/api/campaigns/mine/\(seg(enrolmentId))")
    }

    static func accept(_ enrolmentId: String) async throws -> CampaignAcceptReply {
        try await APIClient.shared.send("POST", "/api/campaigns/mine/\(seg(enrolmentId))/accept", body: CampaignAcceptInput())
    }

    static func decline(_ enrolmentId: String) async throws {
        let _: OK = try await APIClient.shared.send("POST", "/api/campaigns/mine/\(seg(enrolmentId))/decline", body: [String: String]())
    }

    static func tick(_ enrolmentId: String, item: String, done: Bool, spentPence: Int? = nil) async throws -> CampaignTickReply {
        try await APIClient.shared.send("POST", "/api/campaigns/mine/\(seg(enrolmentId))/items/\(seg(item))",
                                        body: CampaignTickInput(done: done, spentPence: spentPence))
    }
}

// MARK: - Act tab section

/// Invitations, then running campaigns, then ones finished in the last month.
struct CampaignTodaySection: View {
    let mine: CampaignsMine
    let reload: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            ForEach(mine.invitations) { invitation in
                InvitationCard(invitation: invitation, reload: reload)
            }
            ForEach(mine.current) { enrolment in
                CampaignCard(enrolment: enrolment, reload: reload)
            }
            ForEach(mine.finished) { enrolment in
                FinishedCampaignRow(enrolment: enrolment)
            }
        }
    }
}

// MARK: - Invitation

/// "An invitation from JK": name, dates, fee, kit with expected spend,
/// places left; Accept or Not this time. Nothing is charged until accepted.
struct InvitationCard: View {
    let invitation: CampaignInvitation
    var compact = true
    let reload: () async -> Void

    @State private var confirmJoin = false
    @State private var confirmDecline = false
    @State private var busy = false
    @State private var error: String?
    @State private var showOptional = false

    private var c: CampaignRef { invitation.campaign }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            JKLabel(invitation.isWaitlisted ? "On the waitlist" : "An invitation from JK",
                    trailing: invitation.respondBy.map { "reply by \(Fmt.dayMonth($0))" })
            VStack(alignment: .leading, spacing: JK.Space.s) {
                SerifText(SerifText.lastWordItalic(WeekText.plain(c.name)), size: .title).foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
                if let tagline = c.tagline, !tagline.isEmpty {
                    Text(tagline).font(.jkSerif(.cue, italic: true)).foregroundStyle(JK.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Label(CampaignDates.span(c), systemImage: "calendar")
                .font(.jkCallout)
                .foregroundStyle(JK.text)
            facts
            if let description = c.description, !description.isEmpty, !compact {
                Text(description).font(.jkBody).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            kit
            if let welcome = invitation.welcomeText, !welcome.isEmpty, !compact {
                Text("“\(welcome)”").font(.jkQuoteSmall).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
            }
            if let error { ErrorBanner(message: error) }
            if invitation.isWaitlisted {
                Text("This campaign is full. If a place opens, JK's invitation comes straight here.")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                actions
            }
        }
        .parCard(padding: JK.Space.xl)
        .confirmationDialog("Join \(c.name)?", isPresented: $confirmJoin, titleVisibility: .visible) {
            Button("Join the campaign") { Task { await accept() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(joinSummary)
        }
        .confirmationDialog("Not this time?", isPresented: $confirmDecline, titleVisibility: .visible) {
            Button("Not this time", role: .destructive) { Task { await decline() } }
            Button("Keep the invitation", role: .cancel) {}
        } message: {
            Text("JK will see you said no. He can always invite you again.")
        }
    }

    private var facts: some View {
        HStack(alignment: .top, spacing: 0) {
            fact(label: "Fee", value: invitation.dueFeePence > 0 ? Fmt.pounds(invitation.dueFeePence) : "Free",
                 note: (invitation.discountPence ?? 0) > 0 ? "after \(Fmt.pounds(invitation.discountPence ?? 0)) off" : nil)
            factDivider
            fact(label: "Kit to buy", value: Fmt.pounds(invitation.expectedSpendPence ?? invitation.kit?.requiredPence ?? 0),
                 note: (invitation.kit?.optionalPence ?? 0) > 0 ? "+ \(Fmt.pounds(invitation.kit?.optionalPence ?? 0)) optional" : nil)
            factDivider
            fact(label: "Places", value: invitation.placesLeft.map { $0 == 0 ? "Full" : "\($0) left" } ?? "Open",
                 note: invitation.placesLeft.map { $0 <= 3 && $0 > 0 ? "limited" : nil } ?? nil)
        }
        .padding(.vertical, JK.Space.m)
        .overlay(alignment: .top) { Rectangle().fill(JK.hairline).frame(height: JK.Size.hairline) }
        .overlay(alignment: .bottom) { Rectangle().fill(JK.hairline).frame(height: JK.Size.hairline) }
    }

    private var factDivider: some View {
        Rectangle().fill(JK.hairline).frame(width: JK.Size.hairline).padding(.horizontal, JK.Space.s)
            .accessibilityHidden(true)
    }

    private func fact(label: String, value: String, note: String?) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Text(label.uppercased()).jkText(.label).foregroundStyle(JK.textTertiary)
            Text(value).font(.jkSerif(.card)).foregroundStyle(JK.text).lineLimit(1).minimumScaleFactor(0.8)
            if let note { Text(note).font(.jkMicro).foregroundStyle(JK.textTertiary).lineLimit(2) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var kit: some View {
        if let kit = invitation.kit, !kit.required.isEmpty || !kit.optional.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                if !kit.required.isEmpty {
                    Text("You'll need").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    ForEach(Array(kit.required.enumerated()), id: \.offset) { _, line in kitLine(line, optional: false) }
                }
                if !kit.optional.isEmpty {
                    Button {
                        withAnimation(JK.Motion.standard) { showOptional.toggle() }
                    } label: {
                        HStack(spacing: JK.Space.xs) {
                            Text("Optional extras · \(Fmt.pounds(kit.optionalPence ?? 0))").font(.jkCaption).foregroundStyle(JK.textSecondary)
                            Image(systemName: "chevron.down").font(.jkMicro).foregroundStyle(JK.textTertiary)
                                .rotationEffect(.degrees(showOptional ? 180 : 0))
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: JK.Size.touch - JK.Space.s)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, JK.Space.xs)
                    if showOptional || !compact {
                        ForEach(Array(kit.optional.enumerated()), id: \.offset) { _, line in kitLine(line, optional: true) }
                    }
                }
            }
        }
    }

    private func kitLine(_ line: KitLine, optional: Bool) -> some View {
        HStack(spacing: JK.Space.s) {
            Image(systemName: optional ? "circle.dashed" : "bag").font(.jkMeta).foregroundStyle(JK.textTertiary)
                .accessibilityHidden(true)
            Text(line.name).font(.jkCallout).foregroundStyle(optional ? JK.textSecondary : JK.text)
            Spacer(minLength: JK.Space.s)
            Text(line.estPence.map(Fmt.pounds) ?? "").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var actions: some View {
        VStack(spacing: JK.Space.s) {
            Button {
                confirmJoin = true
            } label: {
                if busy { ProgressView().tint(JK.text) } else { Text("Accept") }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(busy)
            HStack {
                Button("Not this time") { confirmDecline = true }.buttonStyle(TextButtonStyle()).disabled(busy)
                Spacer(minLength: 0)
                if compact {
                    Button {
                        TabRouter.shared.push(.campaign(invitation.enrolmentId))
                    } label: {
                        HStack(spacing: JK.Space.xs) {
                            Text("See the plan")
                            Image(systemName: "arrow.right").fontWeight(.light)
                        }
                    }
                    .buttonStyle(TextButtonStyle())
                }
            }
        }
    }

    private var joinSummary: String {
        var parts: [String] = []
        parts.append(invitation.dueFeePence > 0 ? "\(Fmt.pounds(invitation.dueFeePence)) fee, invoiced by JK." : "No fee.")
        if let spend = invitation.expectedSpendPence, spend > 0 { parts.append("Kit to buy: about \(Fmt.pounds(spend)).") }
        parts.append(CampaignDates.span(c) + ".")
        return parts.joined(separator: " ")
    }

    private func accept() async {
        busy = true
        defer { busy = false }
        do {
            let reply = try await CampaignAPI.accept(invitation.enrolmentId)
            error = nil
            if reply.enrolment?.status == "waitlisted" {
                error = "It's full, so you're on the waitlist. JK will invite you if a place opens."
            }
            await reload()
        } catch {
            self.error = error.readable
        }
    }

    private func decline() async {
        busy = true
        defer { busy = false }
        do {
            try await CampaignAPI.decline(invitation.enrolmentId)
            error = nil
            await reload()
        } catch {
            self.error = error.readable
        }
    }
}

/// Dates in words.
enum CampaignDates {
    /// "1 Nov – 23 Jan · 12 weeks", or "Starts the day you join · 30 days".
    static func span(_ c: CampaignRef) -> String {
        let length = c.lengthDays.map(duration) ?? ""
        if c.startMode == "rolling" || c.startsOn == nil {
            return length.isEmpty ? "Starts the day you join" : "Starts the day you join · \(length)"
        }
        let start = Fmt.dayMonth(c.startsOn)
        let end = c.endsOn.map { " – \(Fmt.dayMonth($0))" } ?? ""
        return length.isEmpty ? "\(start)\(end)" : "\(start)\(end) · \(length)"
    }

    /// 84 → "12 weeks", 30 → "30 days".
    static func duration(_ days: Int) -> String {
        if days % 7 == 0 && days >= 14 { return "\(days / 7) weeks" }
        return days == 1 ? "1 day" : "\(days) days"
    }

    /// "Today", "Tomorrow", "Fri 27 Nov".
    static func day(_ iso: String?, today: String = Day.string(Date())) -> String {
        guard let iso else { return "" }
        if iso == today { return "Today" }
        if let t = Day.date(today), Day.string(Day.add(1, to: t)) == iso { return "Tomorrow" }
        if let t = Day.date(today), Day.string(Day.add(-1, to: t)) == iso { return "Yesterday" }
        return Day.date(iso).map(Fmt.shortDay) ?? iso
    }
}

// MARK: - Campaign card

/// A running campaign: the ring, day N of M, points and rank, and today's
/// activities with tick boxes and "Read guide".
struct CampaignCard: View {
    let enrolment: MyEnrolment
    let reload: () async -> Void

    @State private var today: [CampaignActivity] = []
    @State private var pct = 0
    @State private var points = 0
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            Button { TabRouter.shared.push(.campaign(enrolment.id)) } label: { header.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the campaign plan")
            if enrolment.status == "paused" {
                Text("Paused while your coaching is paused. Your days move forward when it restarts.")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
            } else if today.isEmpty {
                nothingToday
            } else {
                VStack(spacing: 0) {
                    ForEach(today) { activity in
                        CampaignActivityRow(activity: activity, enrolmentId: enrolment.id, enabled: enrolment.isActive) { updated, reply in
                            apply(updated, reply)
                        } onError: { error = $0 }
                        if activity.id != today.last?.id { GroupDivider(inset: JK.Size.touch + JK.Space.s) }
                    }
                }
            }
            if let error { ErrorBanner(message: error) }
            Button { TabRouter.shared.push(.campaign(enrolment.id)) } label: {
                HStack(spacing: JK.Space.xs) {
                    Text("The whole plan")
                    Image(systemName: "arrow.right").fontWeight(.light)
                }
            }
            .buttonStyle(TextButtonStyle())
        }
        .parCard(padding: JK.Space.xl)
        .onAppear { sync() }
        .onChange(of: enrolment) { _, _ in sync() }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: JK.Space.l) {
            ProgressRing(state: pct >= 100 ? .done : .progress(Double(pct) / 100), size: JK.Size.ringCommitment, showCheck: false) {
                Text("\(pct)%").font(.jkMicro.monospacedDigit()).foregroundStyle(JK.text)
            }
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                JKLabel(enrolment.status == "paused" ? "Paused" : "Campaign",
                        trailing: CampaignText.dayOf(enrolment.day, enrolment.lengthDays))
                SerifText(SerifText.lastWordItalic(WeekText.plain(enrolment.campaign.name)), size: .card).foregroundStyle(JK.text)
                    .multilineTextAlignment(.leading)
                Text(stats).font(.jkMeta.monospacedDigit()).foregroundStyle(JK.textTertiary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(enrolment.campaign.name). \(CampaignText.dayOf(enrolment.day, enrolment.lengthDays) ?? ""). \(pct) percent done. \(stats)")
    }

    private var stats: String {
        var parts = ["\(points) points"]
        if let rank = enrolment.rank { parts.append(CampaignText.rank(rank)) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var nothingToday: some View {
        if let next = enrolment.next?.first {
            let when = CampaignDates.day(next.date)
            Text("Nothing set for today. Next: \(next.title), \(when == "Tomorrow" ? "tomorrow" : when).")
                .font(.jkCallout).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
        } else {
            Text("Nothing set for today.").font(.jkCallout).foregroundStyle(JK.textSecondary)
        }
    }

    private func sync() {
        today = enrolment.today ?? []
        pct = enrolment.pct ?? 0
        points = enrolment.points ?? 0
    }

    private func apply(_ updated: CampaignActivity, _ reply: CampaignTickReply?) {
        if let i = today.firstIndex(where: { $0.id == updated.id }) { today[i] = updated }
        if let reply {
            pct = reply.pct ?? pct
            points = reply.points ?? points
        }
        error = nil
    }
}

/// One activity: the tick, the kind glyph, the title, points, and the guide.
/// Ticks optimistically and puts it back if the server says no.
struct CampaignActivityRow: View {
    let activity: CampaignActivity
    let enrolmentId: String
    let enabled: Bool
    var showDate = false
    let onChange: (CampaignActivity, CampaignTickReply?) -> Void
    var onError: (String) -> Void = { _ in }

    @State private var busy = false
    @State private var askSpend = false
    @State private var spendText = ""

    var body: some View {
        HStack(alignment: .top, spacing: JK.Space.s) {
            Button { Task { await toggle() } } label: {
                Image(systemName: activity.done ? "checkmark.circle.fill" : "circle")
                    .font(.title2.weight(.light))
                    .foregroundStyle(activity.done ? JK.silver : (enabled ? JK.trackStrong : JK.hairline))
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!enabled || busy)
            .accessibilityLabel(activity.title)
            .accessibilityValue(activity.done ? "Done" : "Not done")
            .accessibilityHint(enabled ? (activity.done ? "Untick" : "Tick when done") : "")
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                HStack(alignment: .firstTextBaseline, spacing: JK.Space.s) {
                    Text(activity.title)
                        .font(.jkCallout)
                        .foregroundStyle(activity.done ? JK.textSecondary : JK.text)
                        .strikethrough(activity.done, color: JK.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: JK.Space.s)
                    if let points = activity.points, points > 0 {
                        Text("+\(points)").font(.jkMicro.monospacedDigit()).foregroundStyle(JK.textTertiary)
                    }
                }
                HStack(spacing: JK.Space.xs) {
                    Image(systemName: CampaignText.symbol(activity.kind)).font(.jkMicro)
                    Text(meta).font(.jkMicro)
                }
                .foregroundStyle(JK.textTertiary)
                if let detail = activity.detail, !detail.isEmpty {
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
                }
                if activity.guideRef != nil || activity.kind == "purchase" {
                    HStack(spacing: JK.Space.s) {
                        if let guide = activity.guideRef {
                            Button { openGuide(guide) } label: {
                                Label("Read guide", systemImage: "book.closed").font(.jkCaption)
                            }
                            .buttonStyle(SmallPillStyle())
                        }
                        if activity.kind == "purchase", enabled {
                            Button {
                                spendText = activity.spentPence.map { String(format: "%.2f", Double($0) / 100) } ?? ""
                                askSpend = true
                            } label: {
                                Text(activity.spentPence.map { "Spent \(Fmt.pounds($0))" } ?? "I spent £…").font(.jkCaption)
                            }
                            .buttonStyle(SmallPillStyle())
                        }
                    }
                    .padding(.top, JK.Space.xs)
                }
            }
            .padding(.vertical, JK.Space.s)
        }
        .alert("What did you spend?", isPresented: $askSpend) {
            TextField("£", text: $spendText).keyboardType(.decimalPad)
            Button("Cancel", role: .cancel) {}
            Button("Save") { Task { await saveSpend() } }
        } message: {
            Text(activity.spendPence.map { "JK expected about \(Fmt.pounds($0)). Only JK sees this." } ?? "Only JK sees this.")
        }
    }

    private var meta: String {
        var parts = [CampaignText.kindWord(activity.kind)]
        if showDate, let date = activity.date { parts.insert(CampaignDates.day(date), at: 0) }
        if !activity.isRequired { parts.append("optional") }
        if activity.kind == "purchase", let spend = activity.spendPence, spend > 0, activity.spentPence == nil {
            parts.append("about \(Fmt.pounds(spend))")
        }
        return parts.joined(separator: " · ")
    }

    private func openGuide(_ guide: ActivityGuide) {
        if let id = guide.id {
            TabRouter.shared.push(.coachGuide(id))
        } else if let blocks = guide.blocks {
            TabRouter.shared.push(.inlineGuide(InlineGuide(title: guide.title ?? activity.title, blocks: blocks)))
        }
    }

    private func toggle() async {
        var updated = activity
        updated.done.toggle()
        updated.doneAt = updated.done ? Date() : nil
        onChange(updated, nil)
        busy = true
        defer { busy = false }
        do {
            let reply = try await CampaignAPI.tick(enrolmentId, item: activity.id, done: updated.done)
            onChange(updated, reply)
        } catch {
            onChange(activity, nil)
            onError(error.readable)
        }
    }

    private func saveSpend() async {
        guard let pence = CampaignText.pence(fromPounds: spendText) else {
            onError("Enter an amount in pounds, like 24.99.")
            return
        }
        var updated = activity
        updated.done = true
        updated.spentPence = pence
        busy = true
        defer { busy = false }
        do {
            let reply = try await CampaignAPI.tick(enrolmentId, item: activity.id, done: true, spentPence: pence)
            onChange(updated, reply)
        } catch {
            onError(error.readable)
        }
    }
}

/// A campaign finished in the last month: a quiet line that opens its plan.
struct FinishedCampaignRow: View {
    let enrolment: MyEnrolment

    var body: some View {
        Button { TabRouter.shared.push(.campaign(enrolment.id)) } label: {
            HStack(spacing: JK.Space.m) {
                ProgressRing(state: .done, size: JK.Size.ringCard)
                VStack(alignment: .leading, spacing: 2) {
                    Text(enrolment.campaign.name).font(.jkCallout).foregroundStyle(JK.text)
                    Text("Finished · \(enrolment.points ?? 0) points").font(.jkMeta).foregroundStyle(JK.textTertiary)
                }
                Spacer(minLength: 0)
                Icon(key: .chevron, size: 13).foregroundStyle(JK.textTertiary)
            }
            .padding(.horizontal, JK.Space.l)
            .padding(.vertical, JK.Space.m)
            .surface(.group)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The plan

/// One enrolment in full: the hero, the phases, today, the week ahead,
/// earlier days, the kit with what was spent, and every guide. An open
/// invitation shows the invitation with the plan beneath it.
struct CampaignDetailView: View {
    let enrolmentId: String

    @State private var detail: EnrolmentDetail?
    @State private var error: String?
    @State private var actionError: String?
    @State private var showEarlier = false

    private var today: String { Day.string(Date()) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                if let detail {
                    content(detail)
                } else if let error {
                    ErrorCard(message: error) { await load() }
                } else {
                    LoadingCard()
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.vertical, JK.Space.l)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .jkRefreshable { await load() }
        .task { await load() }
        .errorAlert($actionError)
    }

    @ViewBuilder
    private func content(_ d: EnrolmentDetail) -> some View {
        if let invitation = d.enrolment.invitation {
            InvitationCard(invitation: invitation, compact: false) { await load() }
            if !d.phases.isEmpty { phases(d, current: nil) }
            if !d.activities.isEmpty { firstWeek(d) }
        } else {
            hero(d)
            if !d.phases.isEmpty { phases(d, current: d.enrolment.day) }
            daySection("Today", activities(d) { $0.date == today }, d, emptyLine: "Nothing set for today.")
            daySection("Coming up", Array(activities(d) { ($0.date ?? "") > today }.prefix(10)), d, showDate: true, emptyLine: nil)
            earlier(d)
            if !d.kit.isEmpty { kit(d) }
            guides(d)
            if let link = LinkScan.https(d.enrolment.planUrl) {
                Link(destination: link) {
                    Label("Open the web plan", systemImage: "safari")
                }
                .buttonStyle(TextButtonStyle())
            }
        }
    }

    private func activities(_ d: EnrolmentDetail, _ keep: (CampaignActivity) -> Bool) -> [CampaignActivity] {
        d.activities.filter(keep).sorted { ($0.date ?? "", $0.day) < ($1.date ?? "", $1.day) }
    }

    private func hero(_ d: EnrolmentDetail) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            JKLabel(d.enrolment.status == "completed" ? "Finished" : (d.enrolment.status == "paused" ? "Paused" : "Campaign"),
                    trailing: CampaignText.dayOf(d.enrolment.day, d.enrolment.lengthDays))
            SerifText(SerifText.lastWordItalic(WeekText.plain(d.campaign.name)), size: .hero).foregroundStyle(JK.text)
                .accessibilityAddTraits(.isHeader)
            if let tagline = d.campaign.tagline, !tagline.isEmpty {
                Text(tagline).font(.jkSerif(.notes, italic: true)).foregroundStyle(JK.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: JK.Space.xl) {
                let pct = d.enrolment.pct ?? 0
                ProgressRing(state: pct >= 100 ? .done : .progress(Double(pct) / 100), size: JK.Size.ringCommitment + JK.Space.l,
                             showCheck: false) {
                    VStack(spacing: 0) {
                        Text("\(pct)%").font(.jkSerif(.card)).foregroundStyle(JK.text)
                        Text("done").font(.jkMicro).foregroundStyle(JK.textTertiary)
                    }
                }
                stat("\(d.enrolment.points ?? 0)", "points")
                if let rank = d.enrolment.rank { stat(CampaignText.ordinal(rank.position), "of \(rank.of)") }
                stat(CampaignDates.day(d.enrolment.endsOn), "last day")
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.jkSerif(.card)).foregroundStyle(JK.text).lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.jkMicro).foregroundStyle(JK.textTertiary)
        }
        .accessibilityElement(children: .combine)
    }

    /// The phases as one strip across the campaign, today marked, then each
    /// phase with its summary and guide.
    private func phases(_ d: EnrolmentDetail, current: Int?) -> some View {
        let length = max(1, d.campaign.lengthDays ?? d.enrolment.lengthDays ?? (d.phases.map(\.endDay).max() ?? 0) + 1)
        let day0 = current.map { max(0, $0 - 1) }
        return VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("Phases")
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    HStack(spacing: 2) {
                        ForEach(Array(d.phases.enumerated()), id: \.element.id) { i, p in
                            let span = CGFloat(p.endDay - p.startDay + 1) / CGFloat(length)
                            let isNow = day0.map { $0 >= p.startDay && $0 <= p.endDay } ?? false
                            let isPast = day0.map { $0 > p.endDay } ?? false
                            Capsule()
                                .fill(isNow ? JK.silver : (isPast ? JK.textTertiary : JK.trackStrong))
                                .frame(width: max(4, geo.size.width * span - 2))
                                .opacity(isNow || isPast ? 1 : 0.6 + 0.1 * Double(i % 2))
                        }
                    }
                    if let day0 {
                        Circle()
                            .fill(JK.text)
                            .overlay(Circle().strokeBorder(JK.bg, lineWidth: 2))
                            .frame(width: JK.Space.m, height: JK.Space.m)
                            .offset(x: min(geo.size.width - JK.Space.m, max(0, geo.size.width * CGFloat(day0) / CGFloat(length) - JK.Space.m / 2)))
                    }
                }
            }
            .frame(height: JK.Space.m)
            .accessibilityHidden(true)
            VStack(spacing: 0) {
                ForEach(d.phases) { p in
                    let isNow = day0.map { $0 >= p.startDay && $0 <= p.endDay } ?? false
                    HStack(alignment: .top, spacing: JK.Space.m) {
                        Circle().fill(isNow ? JK.silver : JK.trackStrong).frame(width: JK.Space.s, height: JK.Space.s)
                            .padding(.top, JK.Space.s)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: JK.Space.xs) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(p.name).font(.jkHeadline).foregroundStyle(JK.text)
                                if isNow { Text("now").font(.jkSerif(.annotation, italic: true)).foregroundStyle(JK.textSecondary) }
                                Spacer(minLength: 0)
                                Text("Days \(p.startDay + 1)–\(p.endDay + 1)").font(.jkMeta.monospacedDigit()).foregroundStyle(JK.textTertiary)
                            }
                            if let summary = p.summary, !summary.isEmpty {
                                Text(summary).font(.jkCaption).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
                            }
                            if let guide = p.guide, let id = guide.id {
                                Button { TabRouter.shared.push(.coachGuide(id)) } label: {
                                    Label(guide.title ?? "Read the guide", systemImage: "book.closed").font(.jkCaption)
                                }
                                .buttonStyle(SmallPillStyle())
                                .padding(.top, JK.Space.xs)
                            }
                        }
                    }
                    .padding(JK.Space.l)
                    .accessibilityElement(children: .contain)
                    if p.id != d.phases.last?.id { GroupDivider() }
                }
            }
            .surface(.group)
        }
    }

    @ViewBuilder
    private func daySection(_ title: String, _ list: [CampaignActivity], _ d: EnrolmentDetail, showDate: Bool = false,
                            emptyLine: String?) -> some View {
        if !list.isEmpty || emptyLine != nil {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel(title, trailing: title == "Today" ? "\(list.filter(\.done).count) of \(list.count) done" : nil)
                if list.isEmpty, let emptyLine {
                    Text(emptyLine).font(.jkCallout).foregroundStyle(JK.textSecondary)
                } else {
                    activityList(list, d, showDate: showDate)
                }
            }
        }
    }

    private func activityList(_ list: [CampaignActivity], _ d: EnrolmentDetail, showDate: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(list) { a in
                CampaignActivityRow(activity: a, enrolmentId: d.enrolment.id,
                                    enabled: d.enrolment.status == "active" && (a.date ?? "") <= today, showDate: showDate) { updated, reply in
                    apply(updated, reply)
                } onError: { actionError = $0 }
                .padding(.horizontal, JK.Space.s)
                if a.id != list.last?.id { GroupDivider(inset: JK.Size.touch + JK.Space.m) }
            }
        }
        .surface(.group)
    }

    @ViewBuilder
    private func earlier(_ d: EnrolmentDetail) -> some View {
        let past = activities(d) { ($0.date ?? "") < today }
        if !past.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                Button {
                    withAnimation(JK.Motion.standard) { showEarlier.toggle() }
                } label: {
                    HStack {
                        JKLabel("Earlier", trailing: "\(past.filter(\.done).count) of \(past.count) done")
                        Image(systemName: "chevron.down").font(.jkMicro).foregroundStyle(JK.textTertiary)
                            .rotationEffect(.degrees(showEarlier ? 180 : 0))
                    }
                    .frame(minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(showEarlier ? "Hides earlier days" : "Shows earlier days")
                if showEarlier {
                    let missed = past.filter { !$0.done }
                    if !missed.isEmpty {
                        Text("Missed something? Tick it if you did it.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    activityList(Array(past.reversed()), d, showDate: true)
                }
            }
        }
    }

    private func kit(_ d: EnrolmentDetail) -> some View {
        let required = d.kit.filter { $0.required == true }.reduce(0) { $0 + ($1.estPence ?? 0) }
        let spent = d.kit.reduce(0) { $0 + ($1.spentPence ?? 0) }
            + d.activities.filter { $0.kind == "purchase" }.reduce(0) { $0 + ($1.spentPence ?? 0) }
        return VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("Kit and spend", trailing: "\(d.kit.filter { $0.bought == true }.count) of \(d.kit.count) bought")
            HStack(spacing: JK.Space.xl) {
                stat(Fmt.pounds(required), "expected, required kit")
                stat(Fmt.pounds(spent), "you've spent")
            }
            VStack(spacing: 0) {
                ForEach(d.kit) { item in
                    KitRow(item: item, enrolmentId: d.enrolment.id, enabled: d.enrolment.status == "active") { updated, _ in
                        guard var copy = detail, let i = copy.kit.firstIndex(where: { $0.id == updated.id }) else { return }
                        copy.kit[i] = updated
                        detail = copy
                    } onError: { actionError = $0 }
                    if item.id != d.kit.last?.id { GroupDivider(inset: JK.Size.touch + JK.Space.m) }
                }
            }
            .surface(.group)
            Text("Only JK sees what you spend. It helps him plan kit lists that fit.")
                .font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
    }

    @ViewBuilder
    private func guides(_ d: EnrolmentDetail) -> some View {
        let linked = uniqueGuides(d)
        if !linked.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("Guides")
                VStack(spacing: 0) {
                    ForEach(linked) { g in
                        Button { TabRouter.shared.push(.coachGuide(g.id)) } label: {
                            HStack(spacing: JK.Space.m) {
                                Icon(key: .guide).foregroundStyle(JK.textSecondary)
                                Text(g.title).font(.jkCallout).foregroundStyle(JK.text).multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                Icon(key: .chevron, size: 13).foregroundStyle(JK.textTertiary)
                            }
                            .padding(.horizontal, JK.Space.l)
                            .padding(.vertical, JK.Space.m)
                            .frame(minHeight: JK.Size.touch)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if g.id != linked.last?.id { GroupDivider() }
                    }
                }
                .surface(.group)
            }
        }
    }

    private struct GuideRef: Identifiable {
        let id: String
        let title: String
    }

    private func uniqueGuides(_ d: EnrolmentDetail) -> [GuideRef] {
        var seen = Set<String>()
        var out: [GuideRef] = []
        let refs = d.phases.compactMap(\.guide) + d.activities.compactMap(\.guide)
        for g in refs {
            guard let id = g.id, !seen.contains(id) else { continue }
            seen.insert(id)
            out.append(GuideRef(id: id, title: g.title ?? "Guide"))
        }
        return out
    }

    /// An invitation's plan preview: the first week's activities, read-only.
    private func firstWeek(_ d: EnrolmentDetail) -> some View {
        let first = d.activities.filter { $0.day < 7 }.sorted { $0.day < $1.day }
        return VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("The first week", trailing: "\(d.activities.count) activities in all")
            VStack(spacing: 0) {
                ForEach(first) { a in
                    HStack(alignment: .firstTextBaseline, spacing: JK.Space.m) {
                        Text("Day \(a.day + 1)").font(.jkMeta.monospacedDigit()).foregroundStyle(JK.textTertiary)
                            .frame(minWidth: JK.Space.huge, alignment: .leading)
                        Image(systemName: CampaignText.symbol(a.kind)).font(.jkMeta).foregroundStyle(JK.textTertiary)
                        Text(a.title).font(.jkCallout).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, JK.Space.l)
                    .padding(.vertical, JK.Space.m)
                    if a.id != first.last?.id { GroupDivider() }
                }
            }
            .surface(.group)
        }
    }

    private func apply(_ updated: CampaignActivity, _ reply: CampaignTickReply?) {
        guard var copy = detail else { return }
        if let i = copy.activities.firstIndex(where: { $0.id == updated.id }) { copy.activities[i] = updated }
        if let reply {
            copy.enrolment.pct = reply.pct ?? copy.enrolment.pct
            copy.enrolment.points = reply.points ?? copy.enrolment.points
        }
        detail = copy
    }

    private func load() async {
        do {
            detail = try await CampaignAPI.detail(enrolmentId)
            error = nil
        } catch {
            if !error.isCancellation {
                self.error = (error as? APIError)?.status == 404 ? "This campaign isn't available any more." : error.readable
            }
        }
    }
}

/// A kit item: bought, its price, the shop link (https), the note, and what was spent.
private struct KitRow: View {
    let item: CampaignKitItem
    let enrolmentId: String
    let enabled: Bool
    let onChange: (CampaignKitItem, CampaignTickReply?) -> Void
    let onError: (String) -> Void

    @State private var busy = false
    @State private var askSpend = false
    @State private var spendText = ""

    var body: some View {
        HStack(alignment: .top, spacing: JK.Space.s) {
            Button { Task { await save(bought: !(item.bought ?? false), spent: nil) } } label: {
                Image(systemName: item.bought == true ? "checkmark.circle.fill" : "circle")
                    .font(.title2.weight(.light))
                    .foregroundStyle(item.bought == true ? JK.silver : (enabled ? JK.trackStrong : JK.hairline))
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!enabled || busy)
            .accessibilityLabel(item.name)
            .accessibilityValue(item.bought == true ? "Bought" : "Not bought")
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.name).font(.jkCallout).foregroundStyle(JK.text)
                    Spacer(minLength: JK.Space.s)
                    Text(item.estPence.map(Fmt.pounds) ?? "").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
                Text(item.required == true ? "Required" : "Optional").font(.jkMicro).foregroundStyle(JK.textTertiary)
                if let note = item.note, !note.isEmpty {
                    Text(note).font(.jkCaption).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: JK.Space.s) {
                    if enabled {
                        Button {
                            spendText = item.spentPence.map { String(format: "%.2f", Double($0) / 100) } ?? ""
                            askSpend = true
                        } label: {
                            Text(item.spentPence.map { "Spent \(Fmt.pounds($0))" } ?? "I spent £…").font(.jkCaption)
                        }
                        .buttonStyle(SmallPillStyle())
                    } else if let spent = item.spentPence {
                        Text("Spent \(Fmt.pounds(spent))").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    if let url = item.httpsURL {
                        Link(destination: url) {
                            Label(url.host ?? "Shop", systemImage: "arrow.up.right").font(.jkCaption).lineLimit(1)
                        }
                        .buttonStyle(SmallPillStyle())
                    }
                }
                .padding(.top, JK.Space.xs)
            }
            .padding(.vertical, JK.Space.s)
        }
        .padding(.horizontal, JK.Space.s)
        .alert("What did you spend on \(item.name)?", isPresented: $askSpend) {
            TextField("£", text: $spendText).keyboardType(.decimalPad)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                guard let pence = CampaignText.pence(fromPounds: spendText) else {
                    onError("Enter an amount in pounds, like 24.99.")
                    return
                }
                Task { await save(bought: true, spent: pence) }
            }
        } message: {
            Text(item.estPence.map { "JK expected about \(Fmt.pounds($0)). Only JK sees this." } ?? "Only JK sees this.")
        }
    }

    private func save(bought: Bool, spent: Int?) async {
        var updated = item
        updated.bought = bought
        if let spent { updated.spentPence = spent }
        if !bought { updated.spentPence = nil }
        onChange(updated, nil)
        busy = true
        defer { busy = false }
        do {
            let reply = try await CampaignAPI.tick(enrolmentId, item: item.id, done: bought, spentPence: spent)
            onChange(updated, reply)
        } catch {
            onChange(item, nil)
            onError(error.readable)
        }
    }
}
