import SwiftUI

/// "Morning, Sam": today's session, streak, what's coming up, membership.
/// Daily habits, Progress, Challenges and the weekly check-in hang off it.
struct ClientHomeView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(eyebrow: "Friday 20 Nov", title: "Morning, \(Mock.clientName)") {
                        Text("JK")
                            .font(.caption.weight(.bold))
                            .frame(width: 30, height: 30)
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.secondary, lineWidth: 1))
                    }

                    todaySession
                    HStack(spacing: 10) {
                        streakTile
                        weekTile
                    }

                    Eyebrow(text: "Coming up")
                    VStack(spacing: 0) {
                        ForEach(Mock.upcoming) { item in
                            UpcomingRow(item: item)
                            if item.id != Mock.upcoming.last?.id { Divider().overlay(JK.stroke) }
                        }
                    }
                    .jkCard(padding: 4)

                    NavigationLink { MembershipView() } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Elite membership").font(.subheadline.weight(.semibold))
                                Text("Renews 1 Dec · £149.00").font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                            Text("Active")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(JK.cardRaised, in: Capsule())
                        }
                        .foregroundStyle(JK.text)
                        .jkCard()
                    }

                    Eyebrow(text: "Your week")
                    VStack(spacing: 8) {
                        HomeLink(title: "Daily habits", detail: "Nutrition and habits set by Coach JK", systemName: "checklist") { DailyHabitsView() }
                        HomeLink(title: "Progress", detail: "Weight, records and photos", systemName: "chart.line.downtrend.xyaxis") { ProgressScreen() }
                        HomeLink(title: "Challenges", detail: "November 100 km", systemName: "trophy") { ChallengesView() }
                        HomeLink(title: "Weekly check-in", detail: "Due Sunday evening", systemName: "square.and.pencil") { WeeklyCheckInView() }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var todaySession: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow(text: "Today · Session")
                Spacer()
                Text("in 2h 16m")
                    .font(.caption2)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(JK.cardRaised, in: Capsule())
                    .foregroundStyle(JK.secondary)
            }
            Text("Lower Body Strength").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
            Text("11:00 – 12:00 · with Coach JK").font(.caption).foregroundStyle(JK.secondary)
            Label("Studio 2, Harbour St", systemImage: "mappin.and.ellipse").font(.caption).foregroundStyle(JK.secondary)
            HStack(spacing: 8) {
                NavigationLink { WorkoutLoggerView() } label: {
                    Label("Open workout", systemImage: "play.fill")
                }
                .buttonStyle(ChromeButtonStyle())
                Button {} label: {
                    Image(systemName: "bubble.left").frame(width: 22)
                }
                .buttonStyle(GhostButtonStyle())
                .frame(width: 52)
            }
        }
        .jkCard()
    }

    private var streakTile: some View {
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "Streak")
            HStack(alignment: .bottom) {
                Text("12").font(.title.weight(.semibold)) + Text(" days").font(.caption).foregroundColor(JK.tertiary)
                Spacer()
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach([10.0, 16, 12, 20, 18, 24, 22], id: \.self) { h in
                        Capsule().fill(JK.text).frame(width: 3, height: h)
                    }
                }
            }
            .foregroundStyle(JK.text)
        }
        .jkCard()
    }

    private var weekTile: some View {
        HStack {
            ZStack {
                Circle().stroke(JK.track, lineWidth: 5)
                Circle().trim(from: 0, to: 0.75).stroke(JK.text, style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(-90))
            }
            .frame(width: 40, height: 40)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Eyebrow(text: "This week")
                Text("3/4").font(.title2.weight(.semibold)).foregroundStyle(JK.text)
            }
        }
        .jkCard()
    }
}

private struct UpcomingRow: View {
    let item: UpcomingItem

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text(item.weekday.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundStyle(JK.tertiary)
                Text(item.day).font(.headline).foregroundStyle(JK.text)
            }
            .frame(width: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(JK.text)
                Text(item.detail).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
        }
        .padding(12)
    }
}

private struct HomeLink<Destination: View>: View {
    let title: String
    let detail: String
    let systemName: String
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                IconTile(systemName: systemName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
            }
            .jkCard(padding: 12)
        }
    }
}

// MARK: - Daily habits

struct DailyHabitsView: View {
    @State private var habits = Mock.habits

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(eyebrow: "Friday 20 Nov", title: "Daily habits")
                nutrition
                Eyebrow(text: "Habits set by Coach JK")
                ForEach($habits) { $habit in
                    Button {
                        habit.done.toggle()
                    } label: {
                        HStack(spacing: 12) {
                            IconTile(systemName: habit.systemName)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(habit.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                Text(habit.detail).font(.caption2).foregroundStyle(JK.tertiary)
                                ThinBar(fraction: habit.done ? 1 : habit.fraction)
                            }
                            CheckCircle(on: habit.done)
                        }
                        .jkCard(padding: 12)
                    }
                    .buttonStyle(.plain)
                }
                VStack(spacing: 6) {
                    HStack(spacing: 4) {
                        ForEach(0..<7, id: \.self) { i in
                            Capsule().fill(i < 6 ? JK.text : JK.track).frame(height: 3)
                        }
                    }
                    .padding(.horizontal, 40)
                    Text("6-day habit streak").font(.caption2).foregroundStyle(JK.tertiary)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .jkScreen()
    }

    private var nutrition: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "Nutrition · Today", trailing: "Coach target")
            HStack(spacing: 16) {
                ZStack {
                    Circle().stroke(JK.track, lineWidth: 6)
                    Circle().trim(from: 0, to: 1720.0 / 2500).stroke(JK.text, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text("1,720").font(.title3.weight(.semibold))
                        Text("of 2,500").font(.system(size: 9)).foregroundStyle(JK.tertiary)
                    }
                    .foregroundStyle(JK.text)
                }
                .frame(width: 82, height: 82)
                VStack(spacing: 10) {
                    MacroRow(name: "Protein", value: 128, target: 170)
                    MacroRow(name: "Carbs", value: 180, target: 260)
                    MacroRow(name: "Fat", value: 52, target: 80)
                }
            }
            HStack(spacing: 8) {
                Button {} label: { Label("Snap a meal", systemImage: "camera") }
                Button {} label: { Label("Log food", systemImage: "magnifyingglass") }
            }
            .buttonStyle(GhostButtonStyle())
        }
        .jkCard()
    }
}

private struct MacroRow: View {
    let name: String
    let value: Int
    let target: Int

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text(name).font(.caption2).foregroundStyle(JK.tertiary)
                Spacer()
                Text("\(value) / \(target) g").font(.caption2).foregroundStyle(JK.secondary)
            }
            ThinBar(fraction: Double(value) / Double(target))
        }
    }
}
