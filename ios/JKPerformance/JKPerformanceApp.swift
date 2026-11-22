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

/// The client's three tabs (atelier-spec.md, IA): Today, Progress (plans with
/// 'progress') and JK. Account is the avatar sheet on Today.
struct ClientTabs: View {
    @Environment(AppSession.self) private var session
    /// JK's portrait, or the monogram until it loads or if there is none.
    @State private var jkTabImage = JKTabImage.monogram

    private var gate: Gate { session.me?.gate ?? Gate(features: nil) }

    var body: some View {
        TabView(selection: Bindable(TabRouter.shared).client) {
            TodayView()
                .tabItem { Label("Today", systemImage: IconKey.today.symbol) }
                .tag(TabRouter.Client.today)
            if gate.progress {
                ProgressTab()
                    .tabItem { Label("Progress", systemImage: IconKey.progress.symbol) }
                    .tag(TabRouter.Client.progress)
            }
            JKView()
                .tabItem {
                    Label {
                        Text("JK")
                    } icon: {
                        Image(uiImage: jkTabImage)
                    }
                    .accessibilityLabel("JK, your coach")
                }
                .tag(TabRouter.Client.jk)
        }
        .task(id: session.me?.coach?.avatarMediaId) {
            jkTabImage = await JKTabImage.load(for: session.me?.coach)
        }
        .onChange(of: gate.progress, initial: true) { _, has in
            if !has && TabRouter.shared.client == .progress { TabRouter.shared.client = .today }
        }
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
