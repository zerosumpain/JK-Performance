import SwiftUI

@main
struct JKPerformanceApp: App {
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
            guard phase == .active, session.phase == .signedIn, session.me?.isCoach == false else { return }
            HealthSync.shared.syncIfDue()
        }
    }
}

/// One app, two audiences: a client trains, a coach runs the business. The
/// server decides which (`me.role`); sign-up is open and coaches are made
/// server-side.
struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
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
        .task { await session.restore() }
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
        TabView {
            ClientHomeView()
                .tabItem { Label("Home", systemImage: "house") }
            WorkoutPlanView()
                .tabItem { Label("Plan", systemImage: "dumbbell") }
            MyCalendarView()
                .tabItem { Label("Calendar", systemImage: "calendar") }
            NavigationStack {
                MessagesThreadView(clientId: nil,
                                   otherName: session.me?.coach?.name ?? "Your coach",
                                   subtitle: "Usually replies within an hour")
            }
            .tabItem { Label("Messages", systemImage: "bubble.left") }
            AccountView()
                .tabItem { Label("Account", systemImage: "person") }
        }
    }
}

struct CoachTabs: View {
    var body: some View {
        TabView {
            CoachTodayView()
                .tabItem { Label("Today", systemImage: "clock") }
            ClientsView()
                .tabItem { Label("Clients", systemImage: "person.2") }
            ScheduleView()
                .tabItem { Label("Schedule", systemImage: "calendar") }
            CoachThreadsView()
                .tabItem { Label("Messages", systemImage: "bubble.left") }
            GuidesView()
                .tabItem { Label("Guides", systemImage: "book") }
        }
    }
}
