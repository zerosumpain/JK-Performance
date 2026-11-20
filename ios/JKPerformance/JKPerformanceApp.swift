import SwiftUI

@main
struct JKPerformanceApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
                .tint(.white)
        }
    }
}

/// One app, two audiences: a client trains, a coach runs the business.
/// Chosen on the welcome screen; "Sign out" under Account / Guides returns there.
enum AppRole: String {
    case signedOut
    case client
    case coach
}

struct RootView: View {
    @AppStorage("jk.role") private var role: AppRole = .signedOut

    var body: some View {
        switch role {
        case .signedOut: WelcomeView()
        case .client: ClientTabs()
        case .coach: CoachTabs()
        }
    }
}

struct ClientTabs: View {
    var body: some View {
        TabView {
            ClientHomeView()
                .tabItem { Label("Home", systemImage: "house") }
            WorkoutPlanView()
                .tabItem { Label("Plan", systemImage: "dumbbell") }
            MyCalendarView()
                .tabItem { Label("Calendar", systemImage: "calendar") }
            MessagesView(otherName: Mock.coachName, otherInitials: "JK", subtitle: "Usually replies within an hour")
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
            MessagesView(otherName: "Sam Carter", otherInitials: "SC", subtitle: "Elite plan")
                .tabItem { Label("Messages", systemImage: "bubble.left") }
            GuidesView()
                .tabItem { Label("Guides", systemImage: "book") }
        }
    }
}
