import SwiftUI

/// First run for a new client (`me.onboarded == false`), shown full screen
/// instead of the tabs. Seven short steps, each skippable: welcome, goals,
/// experience, their week, anything to know, notifications, and the coaching
/// plans. Answers stay in memory between steps (Back keeps them) and go to
/// PUT /api/me/onboarding once, at the end; the Me that comes back switches
/// the root to the tabs. Coaches never see this.
struct OnboardingView: View {
    enum Step: Int, CaseIterable {
        case welcome, goals, experience, week, notes, notifications, plans
    }

    @Environment(AppSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step: Step = .welcome
    @State private var goals: Set<String> = []
    @State private var experience: String?
    @State private var days: Int?
    @State private var time: String?
    @State private var injuries = ""
    @State private var plans: PlansResponse?
    @State private var plansError: String?
    @State private var touring = false
    @State private var saving = false
    @State private var error: String?
    @State private var failures = 0

    private static let injuriesLimit = 500
    private let grid = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
    private var count: Int { Step.allCases.count }
    private var coachName: String { session.me?.coach?.name ?? "your coach" }
    private var firstName: String { session.me?.firstName ?? "there" }
    private var currentPlan: String { session.me?.membership?.plan ?? "none" }

    var body: some View {
        ZStack {
            JK.bg.ignoresSafeArea()
            current
                .id(step)
                .transition(stepTransition)
        }
        .task { await loadPlans() }
        .fullScreenCover(isPresented: $touring) {
            PlanTourView(mode: .client)
        }
    }

    private var stepTransition: AnyTransition {
        reduceMotion ? AnyTransition.opacity
                     : AnyTransition.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                                removal: .opacity)
    }

    @ViewBuilder
    private var current: some View {
        switch step {
        case .welcome: welcomeStep
        case .goals: goalsStep
        case .experience: experienceStep
        case .week: weekStep
        case .notes: notesStep
        case .notifications: notificationsStep
        case .plans: plansStep
        }
    }

    private func go(_ next: Step) {
        error = nil
        if reduceMotion {
            step = next
        } else {
            withAnimation(.easeInOut(duration: 0.28)) { step = next }
        }
    }

    // MARK: 1. Welcome

    private var welcomeStep: some View {
        StepScaffold(step: Step.welcome.rawValue, count: count,
                     title: "Welcome, \(firstName)",
                     subtitle: "A few quick questions so \(coachName) can build your plan. About a minute.",
                     mark: true, back: nil, skip: nil) {
            VStack(alignment: .leading, spacing: 16) {
                NumberedRow(number: 1, title: "Tell us about you", detail: "Your goals, your experience and your week.")
                NumberedRow(number: 2, title: "Your coach writes your programme", detail: "Planned around what you tell them.")
                NumberedRow(number: 3, title: "Train, log and check in", detail: "Everything in one place, with your coach a message away.")
            }
            .padding(.top, 6)
        } actions: {
            errorFooter
            Button("Let's start") { go(.goals) }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving)
            Button {
                Task { await finish(answers: false) }
            } label: {
                if saving { ProgressView().tint(JK.textSecondary) } else { Text("Skip for now") }
            }
            .font(.jkCallout)
            .foregroundStyle(JK.textSecondary)
            .frame(minHeight: 36)
            .disabled(saving)
        }
    }

    // MARK: 2. Goals

    private var goalsStep: some View {
        StepScaffold(step: Step.goals.rawValue, count: count,
                     title: "What are you training for?", subtitle: "Pick as many as you like.",
                     back: { go(.welcome) }, skip: { go(.experience) }) {
            LazyVGrid(columns: grid, spacing: 10) {
                ForEach(OnboardingCatalog.goals) { g in
                    ChoiceCard(systemName: g.systemName, title: g.title, selected: goals.contains(g.id), stacked: true) {
                        toggleGoal(g.id)
                    }
                }
            }
        } actions: {
            continueButton(to: .experience)
        }
    }

    private func toggleGoal(_ id: String) {
        if goals.contains(id) { goals.remove(id) } else { goals.insert(id) }
    }

    // MARK: 3. Experience

    private var experienceStep: some View {
        StepScaffold(step: Step.experience.rawValue, count: count,
                     title: "How much have you trained?", subtitle: "So your first weeks start at the right level.",
                     back: { go(.goals) }, skip: { go(.week) }) {
            VStack(spacing: 10) {
                ForEach(OnboardingCatalog.experience) { e in
                    ChoiceCard(systemName: e.systemName, title: e.title, detail: e.detail, selected: experience == e.id) {
                        experience = e.id
                    }
                }
            }
        } actions: {
            continueButton(to: .week)
        }
    }

    // MARK: 4. Your week

    private var weekStep: some View {
        StepScaffold(step: Step.week.rawValue, count: count,
                     title: "Your week", subtitle: "How many days a week can you train?",
                     back: { go(.experience) }, skip: { go(.notes) }) {
            VStack(alignment: .leading, spacing: 18) {
                daysPicker
                Text("When do you usually train?")
                    .font(.jkHeadline)
                    .foregroundStyle(JK.text)
                    .padding(.top, 4)
                LazyVGrid(columns: grid, spacing: 10) {
                    ForEach(OnboardingCatalog.times) { t in
                        ChoiceCard(systemName: t.systemName, title: t.title, selected: time == t.id, stacked: true) {
                            time = t.id
                        }
                    }
                }
            }
        } actions: {
            continueButton(to: .notes)
        }
    }

    private var daysPicker: some View {
        VStack(spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(days.map { "\($0)" } ?? "–")
                    .font(.jkNumberHero)
                    .monospacedDigit()
                    .foregroundStyle(JK.text)
                Text(days == 1 ? "day a week" : "days a week")
                    .font(.jkCallout)
                    .foregroundStyle(JK.textSecondary)
            }
            .accessibilityElement(children: .combine)
            HStack(spacing: 6) {
                ForEach(1...7, id: \.self) { n in
                    dayPill(n)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .jkCard()
    }

    private func dayPill(_ n: Int) -> some View {
        let on = days == n
        return Button {
            days = n
        } label: {
            Text("\(n)")
                .font(.jkCallout.weight(.semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .foregroundStyle(on ? JK.onPrimary : JK.text)
                .background(on ? AnyShapeStyle(JK.primaryFill) : AnyShapeStyle(JK.raised), in: Capsule())
                .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(n == 1 ? "1 day a week" : "\(n) days a week")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: 5. Anything to know

    private var notesStep: some View {
        StepScaffold(step: Step.notes.rawValue, count: count,
                     title: "Anything to know",
                     subtitle: "Injuries, conditions, or anything else your coach should know.",
                     back: { go(.week) }, skip: { go(.notifications) }) {
            VStack(alignment: .trailing, spacing: 6) {
                TextField("Optional. For example: sore left knee, or a shoulder operation last year.",
                          text: $injuries, axis: .vertical)
                    .lineLimit(5...10)
                    .font(.jkCallout)
                    .foregroundStyle(JK.text)
                    .jkCard()
                    .accessibilityLabel("Injuries, conditions or anything else")
                Text("\(injuries.count) / \(Self.injuriesLimit)")
                    .font(.jkCaption)
                    .monospacedDigit()
                    .foregroundStyle(JK.textTertiary)
                    .accessibilityLabel("\(injuries.count) of \(Self.injuriesLimit) characters")
            }
            .onChange(of: injuries) { _, value in
                if value.count > Self.injuriesLimit { injuries = String(value.prefix(Self.injuriesLimit)) }
            }
        } actions: {
            continueButton(to: .notifications)
        }
    }

    // MARK: 6. Notifications

    private var notificationsStep: some View {
        StepScaffold(step: Step.notifications.rawValue, count: count,
                     title: "Stay in the loop",
                     subtitle: "A nudge for the things that matter, and nothing else.",
                     back: { go(.notes) }, skip: { go(.plans) }) {
            VStack(alignment: .leading, spacing: 10) {
                reason("bubble.left", "Your coach's replies", "As soon as \(coachName) answers.")
                reason("calendar", "Session reminders", "An hour before each session.")
                reason("text.bubble", "Your weekly report", "When your feedback for the week is ready.")
            }
        } actions: {
            if Reminders.shared.enabled {
                Text("Notifications are on.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                continueButton(to: .plans)
            } else {
                Button("Turn on notifications") {
                    Task {
                        await Reminders.shared.enable()
                        go(.plans)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                Button("Not now") { go(.plans) }
                    .font(.jkCallout)
                    .foregroundStyle(JK.textSecondary)
                    .frame(minHeight: 36)
            }
        }
    }

    private func reason(_ systemName: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 12) {
            Glyph(systemName: systemName)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .jkCard(padding: 12)
        .accessibilityElement(children: .combine)
    }

    // MARK: 7. Coaching plans

    private var hasPlan: Bool { currentPlan != "none" }

    private var plansTitle: String {
        hasPlan ? "You're on \(session.me?.membership?.displayName ?? Fmt.planName(currentPlan))"
                : "Here's what coaching includes"
    }

    private var plansSubtitle: String {
        hasPlan ? "Here's what your plan includes."
                : "Start free and choose a plan whenever you're ready. The tour shows each one in detail."
    }

    private var plansStep: some View {
        StepScaffold(step: Step.plans.rawValue, count: count,
                     title: plansTitle, subtitle: plansSubtitle,
                     back: { go(.notifications) }, skip: nil) {
            plansContent
        } actions: {
            errorFooter
            if hasPlan {
                finishButton("Finish")
            } else {
                Button("Take the tour") { touring = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(saving)
                finishButton("Start with Free")
            }
        }
    }

    @ViewBuilder
    private var plansContent: some View {
        if let plans {
            if hasPlan {
                currentPlanFeatures(plans)
            } else {
                VStack(spacing: 8) {
                    ForEach(plans.plans.filter { !$0.isFree }) { p in
                        PlanRow(plan: p)
                    }
                }
            }
        } else if let plansError {
            ErrorCard(message: plansError) { await loadPlans() }
        } else {
            LoadingCard()
        }
    }

    @ViewBuilder
    private func currentPlanFeatures(_ r: PlansResponse) -> some View {
        let ids = r.plans.first { $0.id == currentPlan }?.featureIds ?? []
        let features = (r.features ?? []).filter { ids.contains($0.id) }
        if features.isEmpty {
            Text("Your coach will be in touch to get you started.")
                .font(.jkCallout).foregroundStyle(JK.textSecondary)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(features) { f in
                    FeatureRow(feature: f)
                }
            }
            .jkCard()
        }
    }

    // MARK: Shared pieces

    private func continueButton(to next: Step) -> some View {
        Button("Continue") { go(next) }
            .buttonStyle(PrimaryButtonStyle())
    }

    private func finishButton(_ title: String) -> some View {
        Button {
            Task { await finish(answers: true) }
        } label: {
            if saving { ProgressView().tint(JK.onPrimary) } else { Text(title) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(saving)
    }

    /// The save error, and after a second failure a way past it for this launch.
    @ViewBuilder
    private var errorFooter: some View {
        if let error {
            ErrorBanner(message: error)
            if failures >= 2 {
                Button("Continue anyway") { session.onboardingDeferred = true }
                    .buttonStyle(SecondaryButtonStyle())
                Text("We'll ask again next time you open the app.")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
        }
    }

    // MARK: Network

    private func loadPlans() async {
        do {
            plans = try await APIClient.shared.get("/api/plans")
            plansError = nil
        } catch {
            if !error.isCancellation { plansError = error.readable }
        }
    }

    private var answers: OnboardingInput {
        let note = injuries.trimmingCharacters(in: .whitespacesAndNewlines)
        let picked = OnboardingCatalog.goals.map(\.id).filter { goals.contains($0) }
        return OnboardingInput(goals: picked.isEmpty ? nil : picked,
                               experience: experience,
                               daysPerWeek: days,
                               preferredTime: time,
                               injuries: note.isEmpty ? nil : note,
                               done: true)
    }

    /// Saves the answers (or none, for "Skip for now") and marks onboarding done.
    private func finish(answers withAnswers: Bool) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let body = withAnswers ? answers : OnboardingInput(done: true)
        do {
            let fresh: Me = try await APIClient.shared.send("PUT", "/api/me/onboarding", body: body)
            error = nil
            session.update(fresh)
        } catch {
            if error.isCancellation { return }
            failures += 1
            self.error = error.readable
        }
    }
}
