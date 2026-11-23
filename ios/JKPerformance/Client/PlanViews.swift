import SwiftUI

// Plan (plan-act-review.md, screens 5 and 6): Your direction and Before the
// session. Set direction together: a few sentences and three priorities,
// and honest thoughts beforehand.

// MARK: - Your direction (Plan root)

struct PlanRoot: View {
    @Environment(AppSession.self) private var session
    @State private var direction: DirectionPayload?
    @State private var error: String?

    private var router: TabRouter { TabRouter.shared }
    private var gate: Gate { session.gate }

    var body: some View {
        NavigationStack(path: Bindable(TabRouter.shared).planPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    ParTopBar(coach: session.me?.coach, unread: router.unread > 0) { router.openJK() }
                    content
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.bottom, JK.Space.xxl)
                .background(alignment: .top) {
                    FaintRings(center: UnitPoint(x: 0.5, y: 0.32))
                        .frame(height: 560)
                        .padding(.horizontal, -JK.Space.gutter)
                }
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .clientRoutes()
            .task { await load() }
            .onChange(of: router.planPath.count) { _, count in
                if count == 0 { Task { await load() } }
            }
            .onChange(of: router.client) { _, tab in
                if tab == .plan { Task { await load() } }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !gate.progress {
            locked
        } else if let direction {
            if direction.locked == true {
                locked
            } else {
                if let error { ErrorBanner(message: error) }
                aim(direction)
                if hasAim(direction) {
                    season(direction)
                    priorities(direction)
                }
                planningCard(direction)
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
                JKLabel("Plan")
                SerifText("Set direction, *together.*", size: .title).foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
            }
            LockedCard(title: "Plan with *JK*",
                       line: "A planning session sets what matters this season, in a few sentences and three priorities.") {
                router.openAccount(membership: true)
            }
        }
    }

    private func hasAim(_ d: DirectionPayload) -> Bool { !(d.aim ?? "").trimmingCharacters(in: .whitespaces).isEmpty }

    private func aim(_ d: DirectionPayload) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("Plan · This season")
            if hasAim(d) {
                SerifText("\u{201C}\(WeekText.plain(d.aim ?? ""))\u{201D}", size: .quote)
                    .foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
                if let planned = d.plannedLabel ?? d.plannedOn.flatMap({ Day.date($0) }).map({ "Planned together with JK, \(Fmt.dayMonth($0))" }) {
                    Text(planned).font(.jkMeta).foregroundStyle(JK.textTertiary)
                }
            } else {
                SerifText("Your direction is set together with JK at your first planning session.", size: .quote)
                    .foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.top, JK.Space.m)
    }

    @ViewBuilder
    private func season(_ d: DirectionPayload) -> some View {
        if let s = d.season {
            let pos = DirectionText.positions(s)
            VStack(alignment: .leading, spacing: JK.Space.l) {
                JKLabel("The season", trailing: s.phaseWord)
                SeasonLine(today: pos.today, next: pos.next,
                           startLabel: s.labels?.start ?? DirectionText.short(s.start),
                           nextLabel: s.labels?.next ?? (s.next.map { DirectionText.short($0) }),
                           endLabel: s.labels?.end ?? DirectionText.short(s.end))
            }
        }
    }

    @ViewBuilder
    private func priorities(_ d: DirectionPayload) -> some View {
        let list = Array((d.priorities ?? []).prefix(3))
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKLabel("What matters most")
                AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.s) {
                    ForEach(list) { p in priorityCard(p) }
                }
            }
        }
    }

    private func priorityCard(_ p: DirectionPayload.Priority) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            ProgressRing(state: p.status == "strong" ? .done : .progress(p.fraction), size: JK.Size.ringCard + 8, showCheck: false)
            VStack(alignment: .leading, spacing: 2) {
                SerifText(WeekText.plain(p.title), size: .small).foregroundStyle(JK.text)
                Text(p.word).font(.jkMeta).foregroundStyle(JK.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .parCard(padding: JK.Space.m)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(p.title)
        .accessibilityValue(p.word)
    }

    private func planningCard(_ d: DirectionPayload) -> some View {
        AdaptiveStack(verticalAlignment: .center, spacing: JK.Space.m) {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                JKLabel("Planning session with JK")
                SerifText(WeekText.plain(d.planning?.when ?? "Not booked yet"), size: .card)
                    .foregroundStyle(d.planning == nil ? JK.textSecondary : JK.text)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SecondaryButton("Prepare", small: true, arrow: true) { router.planPath.append(.prepare) }
                .accessibilityHint("Your thoughts before the planning session")
        }
        .parCard()
        .padding(.top, JK.Space.l)
    }

    private func load() async {
        guard gate.progress else { return }
        do {
            direction = try await APIClient.shared.get("/api/direction")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

enum DirectionText {
    /// Where today and the next planning session sit along the season.
    static func positions(_ s: DirectionPayload.Season) -> (today: Double, next: Double?) {
        let start = s.start.flatMap { Day.date($0) }
        let end = s.end.flatMap { Day.date($0) }
        func frac(_ day: String?) -> Double? {
            guard let start, let end, let d = day.flatMap({ Day.date($0) }), end > start else { return nil }
            return min(max(d.timeIntervalSince(start) / end.timeIntervalSince(start), 0), 1)
        }
        let today = s.progress ?? frac(s.today) ?? frac(Day.today) ?? 0
        return (today, frac(s.next))
    }

    /// "4 Nov".
    static func short(_ day: String?) -> String {
        guard let day, let d = Day.date(day) else { return "" }
        return Fmt.dayMonth(d)
    }
}

// MARK: - Before the session

struct BeforeSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var direction: DirectionPayload?
    @State private var error: String?
    @State private var actionError: String?
    /// 0...1 on the dial (feeling / 100).
    @State private var feeling: Double = 0.5
    @State private var feelingSet = false
    @State private var easier = ""
    @State private var inTheWay = ""
    @State private var sharedAt: String?
    @State private var saved = false
    @State private var sharing = false
    @State private var saveTask: Task<Void, Never>?
    @State private var loaded = false

    private var feelingValue: Int { Int((feeling * 100).rounded()) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                topRow
                if loaded {
                    form
                } else if let error {
                    ErrorCard(message: error) { await load() }
                } else {
                    LoadingCard()
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.bottom, JK.Space.xxl)
            .background(alignment: .top) {
                FaintRings(center: UnitPoint(x: 0.5, y: 0.45))
                    .frame(height: 620)
                    .padding(.horizontal, -JK.Space.gutter)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .jkScreen()
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .onDisappear { flush() }
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
            .accessibilityLabel("Back")
            Spacer()
            SavedNote(shown: saved)
        }
    }

    private var shared: Bool { sharedAt != nil }

    @ViewBuilder
    private var form: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKLabel("Plan · Before \(direction?.planning?.whenShort ?? "your session")")
            SerifText("Come with a few *honest thoughts.*", size: .title)
                .foregroundStyle(JK.text)
                .accessibilityAddTraits(.isHeader)
        }
        VStack(alignment: .leading, spacing: JK.Space.l) {
            JKLabel("How has this month felt?")
            Dial(value: Binding(get: { feeling }, set: { feeling = $0; feelingSet = true }),
                 stops: nil, word: PrepWords.word(feelingValue), lowWord: "Hard going", highWord: "Flowing",
                 label: "How has this month felt?") { scheduleSave() }
        }
        UnderlinedField(label: "What felt easier?",
                        text: Binding(get: { easier }, set: { easier = $0; scheduleSave() }))
        UnderlinedField(label: "What keeps getting in the way?",
                        text: Binding(get: { inTheWay }, set: { inTheWay = $0; scheduleSave() }))
        Group {
            if shared {
                PrimaryButton("Shared with JK") {}.disabled(true)
            } else {
                PrimaryButton("Share with JK", busy: sharing) { Task { await share() } }
            }
        }
        .padding(.top, JK.Space.l)
        if shared {
            Text("JK will read this before your session. Changes still save.")
                .font(.jkMeta).foregroundStyle(JK.textTertiary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    private func input(share: Bool? = nil) -> PrepInput {
        PrepInput(feeling: feelingSet ? feelingValue : nil, easier: easier, inTheWay: inTheWay, share: share)
    }

    /// Autosave 800ms after the last change.
    private func scheduleSave() {
        saveTask?.cancel()
        saved = false
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await save()
        }
    }

    /// Leaving with a save still waiting: send it now.
    private func flush() {
        guard let pending = saveTask, !pending.isCancelled else { return }
        pending.cancel()
        let body = input()
        Task { let _: Prep? = try? await APIClient.shared.send("PUT", "/api/direction/prep", body: body) }
    }

    private func save() async {
        do {
            let fresh: Prep = try await APIClient.shared.send("PUT", "/api/direction/prep", body: input())
            sharedAt = fresh.sharedAt ?? sharedAt
            saveTask = nil
            withAnimation(JK.Motion.fade) { saved = true }
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
            let fresh: Prep = try await APIClient.shared.send("PUT", "/api/direction/prep", body: input(share: true))
            sharedAt = fresh.sharedAt ?? Day.today
            withAnimation(JK.Motion.fade) { saved = true }
        } catch {
            actionError = error.readable
        }
    }

    private func load() async {
        do {
            let fresh: DirectionPayload = try await APIClient.shared.get("/api/direction")
            direction = fresh
            if let p = fresh.prep {
                if let f = p.feeling {
                    feeling = Double(min(max(f, 0), 100)) / 100
                    feelingSet = true
                }
                easier = p.easier ?? ""
                inTheWay = p.inTheWay ?? ""
                sharedAt = p.sharedAt
            }
            error = nil
            loaded = true
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}
