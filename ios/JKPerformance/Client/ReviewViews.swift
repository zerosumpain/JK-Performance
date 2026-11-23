import SwiftUI

// Review (plan-act-review.md, screens 7 and 8): Look back and the
// Accountability session. Be accountable: look back first, then agree a few
// commitments for the week ahead.

// MARK: - Look back (Review root)

struct ReviewRoot: View {
    @Environment(AppSession.self) private var session
    @State private var review: ReviewPayload?
    @State private var error: String?
    @State private var actionError: String?
    /// 0...1 on the dial: (feeling - 1) / 4.
    @State private var feeling: Double = 0.5
    @State private var feelingSet = false
    @State private var noticed = ""
    @State private var outcomes: [String: String?] = [:]
    @State private var sharedAt: String?
    /// Edited since it was last shared.
    @State private var dirty = false
    @State private var sharing = false
    @State private var saveTask: Task<Void, Never>?
    /// Review opened on the Accountability session once this launch.
    @State private var autoOpened = false

    private var router: TabRouter { TabRouter.shared }
    private var gate: Gate { session.gate }
    private var feelingValue: Int { Int((feeling * 4).rounded()) + 1 }

    var body: some View {
        NavigationStack(path: Bindable(TabRouter.shared).reviewPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    ParTopBar(coach: session.me?.coach, unread: router.unread > 0) { router.openJK() }
                    content
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.bottom, JK.Space.xxl)
            }
            .scrollDismissesKeyboard(.interactively)
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .clientRoutes()
            .task { await load() }
            .onChange(of: router.reviewPath.count) { _, count in
                if count == 0 { Task { await load() } }
            }
            .onChange(of: router.client) { _, tab in
                if tab == .review { Task { await load() } }
            }
            .onChange(of: router.reviewWantsSession) { _, wants in
                if wants { Task { await load() } }
            }
            .errorAlert($actionError)
        }
    }

    @ViewBuilder
    private var content: some View {
        if !gate.checkin {
            locked
        } else if let review {
            if review.locked == true {
                locked
            } else {
                if let error { ErrorBanner(message: error) }
                lookBack(review)
            }
        } else if let error {
            ErrorCard(message: error) { await load() }
        } else {
            LoadingCard()
        }
    }

    private var locked: some View {
        VStack(alignment: .leading, spacing: JK.Space.xxl) {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("Review")
                SerifText("Be *accountable.*", size: .title).foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
            }
            LockedCard(title: "Review with *JK*",
                       line: "A weekly accountability session: look back on the week, then agree a few commitments together.") {
                router.openAccount(membership: true)
            }
        }
    }

    @ViewBuilder
    private func lookBack(_ r: ReviewPayload) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel(r.label ?? (r.booking == nil ? "Review · This week" : "Review · Before your session"))
            SerifText("How did the week *feel?*", size: .title)
                .foregroundStyle(JK.text)
                .accessibilityAddTraits(.isHeader)
        }
        if r.session != nil {
            Button { router.reviewPath.append(.accountability) } label: {
                HStack(spacing: JK.Space.m) {
                    DottedCircleGlyph(size: 13)
                    Text(r.session?.pending == true ? "JK's notes and this week's commitments" : "Notes from your last session")
                        .font(.jkCallout).foregroundStyle(JK.text)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").fontWeight(.light).foregroundStyle(JK.textTertiary)
                        .accessibilityHidden(true)
                }
                .parCard()
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        Dial(value: Binding(get: { feeling }, set: { feeling = $0; feelingSet = true; dirty = true }),
             stops: 5, word: ReviewWords.feeling(feelingValue), lowWord: "Flat", highWord: "Strong",
             label: "How did the week feel?") { scheduleSave() }
        commitments(r)
        UnderlinedField(label: "One thing you noticed",
                        text: Binding(get: { noticed }, set: { noticed = $0; dirty = true; scheduleSave() }))
        Group {
            if sharedAt != nil && !dirty {
                PrimaryButton("Shared with JK") {}.disabled(true)
            } else {
                PrimaryButton("Share with JK", busy: sharing) { Task { await share() } }
            }
        }
        .padding(.top, JK.Space.s)
    }

    @ViewBuilder
    private func commitments(_ r: ReviewPayload) -> some View {
        let list = r.commitments ?? []
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                JKLabel("What you said you'd do")
                AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.s) {
                    ForEach(list) { c in commitment(c) }
                }
            }
        }
    }

    private func outcome(_ c: ReviewPayload.Commitment) -> String? {
        if let local = outcomes[c.id] { return local }
        return c.outcome
    }

    private func commitment(_ c: ReviewPayload.Commitment) -> some View {
        let o = outcome(c)
        let state: ProgressRing<EmptyView>.RingState
        switch o {
        case "kept": state = .done
        case "mostly": state = .progress(0.7)
        case "missed": state = .missed
        default: state = .progress(0)
        }
        return Button {
            outcomes[c.id] = .some(ReviewWords.next(o))
            dirty = true
            scheduleSave()
        } label: {
            VStack(spacing: JK.Space.s) {
                ProgressRing(state: state, size: JK.Size.ringCommitment)
                SerifText(WeekText.plain(c.text), size: .small)
                    .foregroundStyle(JK.text)
                    .multilineTextAlignment(.center)
                Text(ReviewWords.outcomeWord(o)?.uppercased() ?? " ")
                    .font(.jkTab)
                    .tracking(1.6)
                    .foregroundStyle(JK.textTertiary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, JK.Space.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(c.text)
        .accessibilityValue(ReviewWords.outcomeWord(o) ?? "Not marked")
        .accessibilityHint("Double tap to change: kept, mostly, missed")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: Saving

    private func input(share: Bool? = nil) -> ReflectionInput {
        ReflectionInput(feeling: feelingSet ? feelingValue : nil, noticed: noticed,
                        outcomes: outcomes.isEmpty ? nil : outcomes, share: share)
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    private func save() async {
        do {
            let fresh: ReviewPayload = try await APIClient.shared.send("POST", "/api/review/reflection", body: input())
            saveTask = nil
            outcomes = [:]
            review = fresh
        } catch {
            if !error.isCancellation { actionError = error.readable }
        }
    }

    private func share() async {
        saveTask?.cancel()
        saveTask = nil
        sharing = true
        defer { sharing = false }
        do {
            let fresh: ReviewPayload = try await APIClient.shared.send("POST", "/api/review/reflection", body: input(share: true))
            outcomes = [:]
            review = fresh
            sharedAt = fresh.reflection?.sharedAt ?? Day.today
            dirty = false
        } catch {
            actionError = error.readable
        }
    }

    private func load() async {
        guard gate.checkin else { return }
        do {
            let fresh: ReviewPayload = try await APIClient.shared.get("/api/review")
            review = fresh
            if saveTask == nil {
                if let f = fresh.reflection?.feeling {
                    feeling = Double(min(max(f, 1), 5) - 1) / 4
                    feelingSet = true
                }
                noticed = fresh.reflection?.noticed ?? noticed
                sharedAt = fresh.reflection?.sharedAt
                dirty = false
            }
            error = nil
            route(fresh)
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    /// Opens the Accountability session when one is waiting (once a launch,
    /// or when a letter notification asks), or a letter that isn't the latest.
    private func route(_ r: ReviewPayload) {
        guard router.reviewPath.isEmpty, router.client == .review else { return }
        if let letter = router.reviewLetter {
            router.reviewLetter = nil
            router.reviewWantsSession = false
            if r.session != nil, r.session?.letterId == letter || r.session?.letterId == nil {
                router.reviewPath = [.accountability]
            } else {
                router.reviewPath = [.letter(letter)]
            }
            return
        }
        let wants = router.reviewWantsSession
        router.reviewWantsSession = false
        if r.session?.pending == true && (!autoOpened || wants) {
            autoOpened = true
            router.reviewPath = [.accountability]
        }
    }
}

// MARK: - Accountability session

struct AccountabilityView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var review: ReviewPayload?
    @State private var error: String?
    @State private var actionError: String?
    @State private var accepting = false

    private var router: TabRouter { TabRouter.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                topRow
                if let review {
                    if let s = review.session {
                        content(s)
                    } else {
                        EmptyState(line: "JK's notes from your next session will appear here.")
                    }
                } else if let error {
                    ErrorCard(message: error) { await load() }
                } else {
                    LoadingCard()
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.bottom, JK.Space.xxl)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .errorAlert($actionError)
    }

    private var topRow: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").fontWeight(.light).foregroundStyle(JK.text)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to Look back")
            Spacer()
        }
    }

    @ViewBuilder
    private func content(_ s: ReviewPayload.Session) -> some View {
        HStack(spacing: JK.Space.m) {
            TopBarAvatar(coach: session.me?.coach, size: JK.Size.avatarSmall)
            VStack(alignment: .leading, spacing: 2) {
                Text("Accountability session").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
                Text(s.withLine ?? "With JK").font(.jkMeta).foregroundStyle(JK.textTertiary)
            }
            Spacer(minLength: 0)
        }
        notes(s.notes)
        shape(s.shape)
        agreed(s.agreed ?? [])
        actions(s)
    }

    @ViewBuilder
    private func notes(_ text: String?) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("JK's notes")
            let parts = AccountabilityText.split(text ?? "")
            if parts.lead.isEmpty {
                Text("JK's notes from the session will appear here.")
                    .font(.jkSerif(.notes))
                    .foregroundStyle(JK.textSecondary)
            } else {
                (Text(parts.lead).foregroundColor(JK.text) + Text(parts.rest.isEmpty ? "" : " " + parts.rest).foregroundColor(JK.textSecondary))
                    .font(.jkSerif(.notes))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func shape(_ shape: ReviewPayload.Session.MonthShape?) -> some View {
        let weeks = Array((shape?.weeks ?? []).suffix(4))
        if !weeks.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("The shape of your month", trailing: shape?.trend)
                ShapeBars(bars: weeks.enumerated().map { i, w in
                    ShapeBars.Bar(id: i, feeling: w.feeling ?? 3, word: w.word ?? ReviewWords.feeling(w.feeling ?? 3),
                                  latest: i == weeks.count - 1)
                })
                .padding(.vertical, JK.Space.s)
                .parCard()
            }
        }
    }

    @ViewBuilder
    private func agreed(_ list: [ReviewPayload.Session.Agreed]) -> some View {
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("Agreed in the session")
                AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.s) {
                    ForEach(Array(list.prefix(3).enumerated()), id: \.element.id) { i, a in
                        VStack(alignment: .leading, spacing: JK.Space.s) {
                            Text(NumberWords.roman(i))
                                .font(.jkSerif(.annotation, italic: true))
                                .foregroundStyle(JK.textTertiary)
                                .accessibilityHidden(true)
                            SerifText(WeekText.plain(a.text), size: .small).foregroundStyle(JK.text)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .parCard(padding: JK.Space.m)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actions(_ s: ReviewPayload.Session) -> some View {
        let pending = s.pending == true
        AdaptiveStack(verticalAlignment: .center, spacing: JK.Space.s) {
            if gate.messaging {
                Button("Message JK") {
                    router.composerDraft = ""
                    router.openJK()
                }
                .buttonStyle(SecondaryButtonStyle(fill: !pending))
                .fixedSize(horizontal: pending, vertical: false)
            }
            if pending {
                PrimaryButton("I'm in", busy: accepting) { Task { await accept(s) } }
            }
        }
        .padding(.top, JK.Space.l)
        if !pending, s.acceptedAt != nil {
            Text("You're in. These come back on Look back next week.")
                .font(.jkMeta).foregroundStyle(JK.textTertiary)
        }
    }

    private func accept(_ s: ReviewPayload.Session) async {
        accepting = true
        defer { accepting = false }
        do {
            let fresh: ReviewPayload = try await APIClient.shared.send("POST", "/api/review/accept",
                                                                       body: AcceptInput(week: s.agreedWeek))
            review = fresh
            router.reviewPath.removeAll { $0 == .accountability }
        } catch {
            actionError = error.readable
        }
    }

    private func load() async {
        do {
            review = try await APIClient.shared.get("/api/review")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

enum AccountabilityText {
    /// The first two sentences, and the rest (drawn quieter, as on the board).
    static func split(_ text: String) -> (lead: String, rest: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return ("", "") }
        var sentences: [String] = []
        trimmed.enumerateSubstrings(in: trimmed.startIndex..., options: .bySentences) { sub, _, _, _ in
            if let sub { sentences.append(sub.trimmingCharacters(in: .whitespacesAndNewlines)) }
        }
        guard sentences.count > 2 else { return (trimmed, "") }
        return (sentences.prefix(2).joined(separator: " "), sentences.dropFirst(2).joined(separator: " "))
    }
}
