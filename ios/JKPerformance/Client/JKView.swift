import PhotosUI
import SwiftUI

/// The JK tab (atelier-spec.md, IA 3 and Client screens 7): JK's voice in one
/// place. A header with his reply line, the latest letter pinned, one
/// timeline of messages, letters, check-ins, forms and plan updates, and the
/// composer. Free clients see JK and his guides instead, so nothing here
/// calls a route their plan does not include.
struct JKView: View {
    @Environment(AppSession.self) private var session

    private var gate: Gate { session.gate }

    var body: some View {
        NavigationStack(path: Bindable(TabRouter.shared).jkPath) {
            Group {
                if gate.messaging || gate.checkin {
                    JKTimelineView()
                } else {
                    FreeJKView()
                }
            }
            .clientRoutes()
        }
    }
}

/// JK's name, the reply line his plan sets, and two quiet links.
struct JKHeader: View {
    @Environment(AppSession.self) private var session
    @Binding var lettersOnly: Bool

    private var gate: Gate { session.gate }
    private var replyLine: String {
        let coach = session.me?.coach
        return coach?.replyLine
            ?? (gate.priority ? coach?.replyExpectation?.priority : coach?.replyExpectation?.standard)
            ?? (gate.priority ? "Same-day replies" : "JK replies most evenings")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            HStack(spacing: JK.Space.m) {
                CoachAvatar(coach: session.me?.coach, size: JK.Size.avatar + JK.Space.m)
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Text(session.me?.coach?.name ?? "JK").font(.jkHeadline).foregroundStyle(JK.text)
                        .accessibilityAddTraits(.isHeader)
                    Text(replyLine).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: JK.Space.l) {
                if gate.checkin {
                    Button(lettersOnly ? "All of it" : "Past letters") { lettersOnly.toggle() }
                        .buttonStyle(TextButtonStyle())
                }
                if gate.guides {
                    Button("Guides") { TabRouter.shared.jkPath.append(.guides) }
                        .buttonStyle(TextButtonStyle())
                }
                Spacer(minLength: 0)
            }
        }
    }
}

/// The timeline and composer, for plans with 'messaging' or 'checkin'.
private struct JKTimelineView: View {
    @Environment(AppSession.self) private var session
    @State private var items: [TimelineItem]?
    @State private var nextBefore: String?
    @State private var letters: [Report] = []
    @State private var error: String?
    @State private var lettersOnly = false
    @State private var loadingEarlier = false
    @State private var form: FormRequest?
    @State private var actionError: String?

    private var api: APIClient { APIClient.shared }
    private var gate: Gate { session.gate }
    private var router: TabRouter { TabRouter.shared }

    /// Oldest first, as a conversation reads.
    private var shown: [TimelineItem] { (items ?? []).sorted { $0.at < $1.at } }
    private var latestLetter: Report? { letters.first }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: JK.Space.l) {
                        JKHeader(lettersOnly: $lettersOnly)
                        if lettersOnly {
                            pastLetters
                        } else {
                            if gate.checkin, let r = latestLetter, let id = r.id { pinned(r, id: id) }
                            timeline
                        }
                    }
                    .padding(JK.Space.gutter)
                }
                .onChange(of: shown.last?.id) { _, last in
                    if let last, !lettersOnly { withAnimation { proxy.scrollTo(last, anchor: .bottom) } }
                }
            }
            if gate.messaging && !lettersOnly {
                JKComposer { await refresh() }
            }
        }
        .jkScreen()
        .toolbar(.hidden, for: .navigationBar)
        .jkRefreshable { await refresh() }
        .sheet(item: $form, onDismiss: { Task { await refresh() } }) { FormFillView(request: $0) }
        .errorAlert($actionError)
        .task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    private func pinned(_ r: Report, id: String) -> some View {
        LetterCard(headline: r.displayHeadline, caption: LetterText.caption(r), excerpt: r.adjustText.isEmpty ? nil : r.adjustText,
                   unread: r.isUnread, milestone: r.isMilestone) {
            router.jkPath.append(.letter(id))
        }
    }

    @ViewBuilder
    private var timeline: some View {
        if let items {
            if let error { ErrorBanner(message: error) }
            if nextBefore != nil {
                Button(loadingEarlier ? "Loading…" : "Earlier") { Task { await loadEarlier() } }
                    .buttonStyle(TextButtonStyle())
                    .frame(maxWidth: .infinity)
                    .disabled(loadingEarlier)
            }
            if items.isEmpty {
                EmptyState(line: gate.messaging ? "Say hello to JK. He reads everything." : "Your letters from JK arrive here.")
            }
            ForEach(shown) { item in
                card(item).id(item.id)
            }
        } else if let error {
            ErrorCard(message: error) { await refresh() }
        } else {
            LoadingCard()
        }
    }

    @ViewBuilder
    private func card(_ item: TimelineItem) -> some View {
        switch item.kind {
        case "message":
            if let m = item.message {
                MessageBubble(message: m, mine: m.fromRole == "client", coach: session.me?.coach)
            }
        case "letter":
            if let r = item.letter, let id = r.id {
                LetterCard(headline: r.displayHeadline, caption: LetterText.caption(r), unread: r.isUnread, milestone: r.isMilestone) {
                    router.jkPath.append(.letter(id))
                }
            }
        case "checkin":
            if let c = item.checkin { CheckInCard(checkin: c) }
        case "form":
            if let f = item.form {
                FormRequestCard(form: f) { Task { await openForm(f.id) } }
            }
        case "planUpdate":
            if let p = item.planUpdate {
                PlanUpdateCard(update: p) { router.openWeek(p.from) }
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var pastLetters: some View {
        if letters.isEmpty {
            EmptyState(line: "JK's letters will gather here.")
        }
        ForEach(letters, id: \.id) { r in
            if let id = r.id {
                LetterCard(headline: r.displayHeadline, caption: LetterText.caption(r), unread: r.isUnread, milestone: r.isMilestone) {
                    router.jkPath.append(.letter(id))
                }
            }
        }
    }

    private func refresh() async {
        do {
            let page: TimelineResponse = try await api.get("/api/timeline", query: ["limit": "50"])
            if let current = items {
                let fresh = Dictionary(page.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
                var merged = current.map { fresh[$0.id] ?? $0 }
                let known = Set(current.map(\.id))
                merged += page.items.filter { !known.contains($0.id) }
                items = merged
            } else {
                items = page.items
                nextBefore = page.nextBefore
            }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
        if gate.checkin, let reply: ReportsResponse = try? await api.get("/api/reports") {
            letters = reply.reports.filter(\.isPublished).sorted { ($0.deliveredAt ?? $0.publishedAt ?? .distantPast) > ($1.deliveredAt ?? $1.publishedAt ?? .distantPast) }
        }
    }

    private func loadEarlier() async {
        guard let before = nextBefore else { return }
        loadingEarlier = true
        defer { loadingEarlier = false }
        do {
            let page: TimelineResponse = try await api.get("/api/timeline", query: ["limit": "50", "before": before])
            let known = Set((items ?? []).map(\.id))
            items = (items ?? []) + page.items.filter { !known.contains($0.id) }
            nextBefore = page.nextBefore
        } catch {
            actionError = error.readable
        }
    }

    private func openForm(_ id: String) async {
        do {
            let reply: FormRequestsResponse = try await api.get("/api/form-requests")
            if let r = reply.requests.first(where: { $0.id == id }) {
                if r.submittedAt == nil { form = r } else { actionError = "You've already sent this one to JK." }
            }
        } catch {
            actionError = error.readable
        }
    }
}

/// Words for a letter's caption.
enum LetterText {
    /// "Monday's letter · 16 Nov", or "A letter · 3 Dec" for a milestone.
    static func caption(_ r: Report) -> String {
        let when = r.deliveredAt ?? r.publishedAt
        let date = when.map { Fmt.dayMonth($0) } ?? Fmt.dayMonth(r.week)
        if r.isMilestone { return "A letter · \(date)" }
        guard let when else { return "Week of \(Fmt.dayMonth(r.week))" }
        return "\(Fmt.weekdayName(when))'s letter · \(date)"
    }
}

// MARK: - Thread cards

/// A message: the client's own on raised with bone text, JK's on surface with
/// his ringed avatar. Form checks and meal photos carry their media.
struct MessageBubble: View {
    let message: Message
    let mine: Bool
    var coach: PersonRef? = nil

    var body: some View {
        HStack(alignment: .bottom, spacing: JK.Space.s) {
            if mine { Spacer(minLength: JK.Space.huge) } else { CoachAvatar(coach: coach, size: JK.Size.avatarSmall - JK.Space.s) }
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                if let caption { Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary) }
                if let id = message.mediaId {
                    MessageMedia(mediaId: id, isVideo: message.kind == "formCheck")
                }
                if !message.text.isEmpty {
                    Text(message.text).font(.jkBody).foregroundStyle(JK.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(Fmt.time(message.at)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
            .padding(JK.Space.m)
            .background(mine ? JK.raised : JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous))
            if !mine { Spacer(minLength: JK.Space.huge) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel((mine ? "You" : "JK") + ", \(Fmt.time(message.at)). \(message.text)")
    }

    private var caption: String? {
        switch message.kind {
        case "answer": return mine ? "Your answer to JK's question" : nil
        case "formCheck": return "Form check"
        case "mealPhoto": return "Meal photo"
        default: return message.reportId != nil && mine ? "About JK's letter" : nil
        }
    }
}

/// "Check-in sent": the week's answers, and when the letter comes.
struct CheckInCard: View {
    let checkin: CheckIn

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            HStack(spacing: JK.Space.s) {
                Icon(key: .checkIn, size: 15).foregroundStyle(JK.textSecondary)
                Text("Check-in sent · week of \(Fmt.dayMonth(checkin.week))").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            Text(figures).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
            if let win = checkin.win, !win.isEmpty { Text("Win: \(win)").font(.jkCallout).foregroundStyle(JK.text) }
            if let struggle = checkin.struggle, !struggle.isEmpty { Text("Struggle: \(struggle)").font(.jkCallout).foregroundStyle(JK.text) }
            if checkin.reviewedAt == nil {
                Text("Sent to JK. Your letter arrives Monday morning.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .surface(.card, padding: JK.Space.l)
        .accessibilityElement(children: .combine)
    }

    private var figures: String {
        var parts = ["Energy \(checkin.energy) of 5"]
        if let stress = checkin.stress { parts.append("Stress \(stress) of 5") }
        parts.append("Sleep \(checkin.sleep) of 5")
        if !checkin.pain.isEmpty { parts.append(checkin.pain.joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }
}

/// A form JK sent: its name, how long, and Fill in.
struct FormRequestCard: View {
    let form: TimelineForm
    let onFill: () -> Void

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Icon(key: .form).foregroundStyle(JK.textSecondary)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(form.name).font(.jkHeadline).foregroundStyle(JK.text)
                Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            Spacer(minLength: 0)
            if form.submittedAt == nil {
                Button("Fill in", action: onFill).buttonStyle(SmallPillStyle())
            }
        }
        .surface(.card, padding: JK.Space.l)
    }

    private var detail: String {
        let n = form.questionCount.map { $0 == 1 ? "1 question" : "\($0) questions" } ?? "A form from JK"
        return form.submittedAt == nil ? n : "\(n) · sent"
    }
}

/// "JK updated next week".
struct PlanUpdateCard: View {
    let update: PlanUpdate
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: JK.Space.m) {
                Icon(key: .week).foregroundStyle(JK.textSecondary)
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Text(update.text ?? "JK updated your plan").font(.jkHeadline).foregroundStyle(JK.text)
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
                Icon(key: .chevron, size: 13).foregroundStyle(JK.textSecondary)
            }
            .surface(.card, padding: JK.Space.l)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens your week")
    }

    private var detail: String {
        let count = update.count.map { $0 == 1 ? "1 session" : "\($0) sessions" } ?? "Sessions"
        guard let from = update.from else { return count }
        let to = update.to.map { $0 == from ? "" : " to \(Fmt.dayMonth($0))" } ?? ""
        return "\(count), \(Fmt.dayMonth(from))\(to)"
    }
}

// MARK: - Composer

/// The composer, with "Ask JK" beneath it holding only what JK has switched
/// on (a form check, a meal photo). A letter's "Reply to JK" arrives here
/// quoting the letter.
private struct JKComposer: View {
    let onSent: () async -> Void

    @Environment(AppSession.self) private var session
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var mealItem: PhotosPickerItem?
    @State private var clipItem: PhotosPickerItem?
    @FocusState private var focused: Bool

    private var router: TabRouter { TabRouter.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            if let quote = router.replyQuote {
                HStack(spacing: JK.Space.s) {
                    BrandRule(width: 16)
                    Text("Replying to: \(quote.headline)").font(.jkCaption).foregroundStyle(JK.textSecondary).lineLimit(1)
                    Spacer(minLength: 0)
                    Button { router.replyQuote = nil } label: { Image(systemName: "xmark").font(.jkCaption) }
                        .foregroundStyle(JK.textSecondary)
                        .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                        .accessibilityLabel("Stop quoting the letter")
                }
            }
            if let error { ErrorBanner(message: error) }
            HStack(alignment: .bottom, spacing: JK.Space.s) {
                TextField("Message JK", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($focused)
                    .font(.jkBody)
                    .foregroundStyle(JK.text)
                    .padding(.horizontal, JK.Space.m)
                    .padding(.vertical, JK.Space.s)
                    .frame(minHeight: JK.Size.touch)
                    .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous)
                        .strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                Button { Task { await send() } } label: {
                    Group {
                        if sending { ProgressView().tint(JK.onPrimary) } else { Image(systemName: "arrow.up") }
                    }
                    .font(.jkHeadline)
                    .foregroundStyle(JK.onPrimary)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                    .background(JK.primaryFill, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(sending || trimmed.isEmpty)
                .accessibilityLabel("Send")
            }
            askJK
        }
        .padding(.horizontal, JK.Space.gutter)
        .padding(.vertical, JK.Space.s)
        .background(JK.bg)
        .onChange(of: router.composerDraft, initial: true) { _, text in
            if let text {
                draft = text
                router.composerDraft = nil
                focused = true
            }
        }
        .onChange(of: router.replyQuote, initial: true) { _, quote in if quote != nil { focused = true } }
        .onChange(of: mealItem) { _, item in if let item { Task { await sendMeal(item) } } }
        .onChange(of: clipItem) { _, item in if let item { Task { await sendClip(item) } } }
    }

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    @ViewBuilder
    private var askJK: some View {
        if gate.formChecks || gate.mealPhotos {
            HStack(spacing: JK.Space.l) {
                if gate.formChecks {
                    PhotosPicker(selection: $clipItem, matching: .videos) {
                        Label("Send a form check", systemImage: IconKey.formCheck.symbol)
                    }
                    .buttonStyle(TextButtonStyle())
                }
                if gate.mealPhotos {
                    PhotosPicker(selection: $mealItem, matching: .images) {
                        Label("Send a meal photo", systemImage: IconKey.mealPhoto.symbol)
                    }
                    .buttonStyle(TextButtonStyle())
                }
                Spacer(minLength: 0)
            }
            .font(.jkCaption)
        }
    }

    private func send() async {
        let text = trimmed
        guard !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let _: Message = try await APIClient.shared.send("POST", "/api/messages", body: MessageInput(
                text: text, clientId: nil, workoutId: nil, reportId: router.replyQuote?.reportId))
            draft = ""
            router.replyQuote = nil
            error = nil
            await onSent()
            // The natural moment to ask: they'll want to know when the reply comes.
            await Reminders.shared.offerIfUndecided(checkIn: session.gate.checkin)
        } catch {
            self.error = error.readable
        }
    }

    private func sendMeal(_ item: PhotosPickerItem) async {
        defer { mealItem = nil }
        sending = true
        defer { sending = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                error = "Couldn't read that photo."
                return
            }
            let media = try await MediaUpload.image(image, purpose: "mealPhoto")
            let _: Message = try await APIClient.shared.send("POST", "/api/messages", body: MessageInput(
                text: trimmed.isEmpty ? "Meal photo" : trimmed, clientId: nil, workoutId: nil, mediaId: media.id, kind: "mealPhoto"))
            draft = ""
            error = nil
            await onSent()
        } catch {
            self.error = error.readable
        }
    }

    private func sendClip(_ item: PhotosPickerItem) async {
        defer { clipItem = nil }
        sending = true
        defer { sending = false }
        do {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                error = "Couldn't read that clip."
                return
            }
            let media = try await MediaUpload.video(at: movie.url, purpose: "formCheck")
            let _: Message = try await APIClient.shared.send("POST", "/api/messages", body: MessageInput(
                text: trimmed.isEmpty ? "Form check" : trimmed, clientId: nil, workoutId: nil, mediaId: media.id, kind: "formCheck"))
            draft = ""
            error = nil
            await onSent()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Free

/// No 'messaging': JK, a line, his guides inline, and what coaching includes.
private struct FreeJKView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                VStack(alignment: .leading, spacing: JK.Space.m) {
                    CoachAvatar(coach: session.me?.coach, size: JK.Size.avatar * 2)
                    Text(session.me?.coach?.name ?? "JK").jkText(.display).foregroundStyle(JK.text)
                        .accessibilityAddTraits(.isHeader)
                    Text("New guides from JK appear here.").jkText(.quote).foregroundStyle(JK.text)
                }
                GuidesListContent()
                Button("See what coaching includes") {
                    TabRouter.shared.showMembership = true
                    TabRouter.shared.client = .today
                    TabRouter.shared.showAccount = true
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .toolbar(.hidden, for: .navigationBar)
    }
}
