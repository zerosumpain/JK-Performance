import SwiftUI

@main
struct JKPerformanceApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = AppSession()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .preferredColorScheme(.dark)
                .tint(JK.accentControl)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await Outbox.shared.flush() } }
            guard phase == .active, session.phase == .signedIn, session.me?.isCoach == false, session.me?.demo == false else { return }
            HealthSync.shared.syncIfDue()
        }
    }
}

/// One app, two audiences: a client trains, a coach runs the business. The
/// server decides which (`me.role`); sign-up is open and coaches are made
/// server-side.
struct RootView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The opening animation over the app; the Welcome screen plays its own.
    @State private var intro: Bool

    init() {
        _intro = State(initialValue: APIClient.shared.token != nil)
    }

    var body: some View {
        ZStack {
            Group {
                switch session.phase {
                case .signedOut:
                    WelcomeView()
                case .restoring:
                    RestoringView()
                case .signedIn:
                    if session.isCoach {
                        CoachTabs()
                    } else if session.me?.needsOnboarding == true && !session.onboardingDeferred {
                        OnboardingView()
                    } else {
                        ClientTabs()
                    }
                }
            }
            if intro && session.phase != .signedOut {
                BrandIntro()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .task { await session.restore() }
        .onChange(of: session.phase, initial: true) { _, phase in
            // Each launch and sign-in: refresh this phone's push token on the server.
            if phase == .signedIn { Task { await Push.shared.registerIfAllowed() } }
        }
        .task {
            guard intro else { return }
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.4 : BrandIntro.duration + 0.3))
            withAnimation(.easeOut(duration: 0.4)) { intro = false }
        }
    }
}

private struct RestoringView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(spacing: 14) {
            Monogram(size: 76)
            if let error = session.restoreError {
                Text(error).font(.jkCaption).foregroundStyle(JK.textSecondary).multilineTextAlignment(.center)
                HStack(spacing: 10) {
                    Button("Try again") { Task { await session.restore() } }.buttonStyle(PrimaryButtonStyle())
                    Button("Sign out") { session.clear() }.buttonStyle(SecondaryButtonStyle())
                }
                .padding(.horizontal, 24)
            } else {
                ProgressView().tint(JK.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JK.bg.ignoresSafeArea())
    }
}

/// The client's three tabs (plan-act-review.md, "Navigation"): PLAN · ACT ·
/// REVIEW in words, default Act. Each tab keeps its own stack (all three stay
/// alive so switching back keeps your place); JK's avatar on each root opens
/// the JK sheet with the thread and More.
struct ClientTabs: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var router: TabRouter { TabRouter.shared }

    var body: some View {
        ZStack {
            PlanRoot().tabLayer(router.client == .plan)
            ActRoot().tabLayer(router.client == .act)
            ReviewRoot().tabLayer(router.client == .review)
        }
        .animation(JK.Motion.respecting(reduceMotion, JK.Motion.fade), value: router.client)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ParTabBar(selection: Bindable(TabRouter.shared).client)
        }
        .background(JK.bg.ignoresSafeArea())
        .sheet(isPresented: Bindable(TabRouter.shared).showJK) { JKSheet() }
    }
}

private extension View {
    /// One tab's stack: shown, or kept alive out of sight and out of VoiceOver.
    func tabLayer(_ on: Bool) -> some View {
        self
            .opacity(on ? 1 : 0)
            .allowsHitTesting(on)
            .accessibilityHidden(!on)
            .zIndex(on ? 1 : 0)
    }
}

/// The coach's three tabs: Today (needs you), Clients and Messages. Schedule
/// became the day agenda behind Today's strip; Guides moved to Account.
struct CoachTabs: View {
    var body: some View {
        TabView(selection: Bindable(TabRouter.shared).coach) {
            CoachTodayView()
                .tabItem { Label("Today", systemImage: IconKey.coachToday.symbol) }
                .tag(TabRouter.Coach.today)
            ClientsView()
                .tabItem { Label("Clients", systemImage: IconKey.clients.symbol) }
                .tag(TabRouter.Coach.clients)
            CoachThreadsView()
                .tabItem { Label("Messages", systemImage: IconKey.messages.symbol) }
                .tag(TabRouter.Coach.messages)
        }
    }
}
