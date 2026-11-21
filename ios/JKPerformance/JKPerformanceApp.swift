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
                .tint(.white)
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
                    if session.isCoach { CoachTabs() } else { ClientTabs() }
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
            Text("JK")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(JK.text)
                .frame(width: 76, height: 76)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(JK.secondary, lineWidth: 1))
            if let error = session.restoreError {
                Text(error).font(.caption).foregroundStyle(JK.secondary).multilineTextAlignment(.center)
                HStack(spacing: 10) {
                    Button("Try again") { Task { await session.restore() } }.buttonStyle(ChromeButtonStyle())
                    Button("Sign out") { session.clear() }.buttonStyle(GhostButtonStyle())
                }
                .padding(.horizontal, 24)
            } else {
                ProgressView().tint(JK.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JK.bg.ignoresSafeArea())
    }
}

struct ClientTabs: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        TabView(selection: Bindable(TabRouter.shared).client) {
            ClientHomeView()
                .tabItem { Label("Home", systemImage: "house") }
                .tag(TabRouter.Client.home)
            WorkoutPlanView()
                .tabItem { Label("Plan", systemImage: "dumbbell") }
                .tag(TabRouter.Client.plan)
            MyCalendarView()
                .tabItem { Label("Calendar", systemImage: "calendar") }
                .tag(TabRouter.Client.calendar)
            NavigationStack {
                MessagesThreadView(clientId: nil,
                                   otherName: session.me?.coach?.name ?? "Your coach",
                                   subtitle: "Usually replies within an hour")
            }
            .tabItem { Label("Messages", systemImage: "bubble.left") }
            .tag(TabRouter.Client.messages)
            AccountView()
                .tabItem { Label("Account", systemImage: "person") }
                .tag(TabRouter.Client.account)
        }
    }
}

struct CoachTabs: View {
    var body: some View {
        TabView(selection: Bindable(TabRouter.shared).coach) {
            CoachTodayView()
                .tabItem { Label("Today", systemImage: "clock") }
                .tag(TabRouter.Coach.today)
            ClientsView()
                .tabItem { Label("Clients", systemImage: "person.2") }
                .tag(TabRouter.Coach.clients)
            ScheduleView()
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(TabRouter.Coach.schedule)
            CoachThreadsView()
                .tabItem { Label("Messages", systemImage: "bubble.left") }
                .tag(TabRouter.Coach.messages)
            GuidesView()
                .tabItem { Label("Guides", systemImage: "book") }
                .tag(TabRouter.Coach.guides)
        }
    }
}
