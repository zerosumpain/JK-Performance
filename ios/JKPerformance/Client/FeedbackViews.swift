import SwiftUI

// MARK: - Weekly feedback (client)

/// Every week the coach has written up, newest first; unread ones marked.
struct WeeklyFeedbackListView: View {
    @Environment(AppSession.self) private var session
    @State private var reports: [Report]?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "From \(session.me?.coach?.name ?? "your coach")", title: "Feedback")
                Loadable(value: reports, error: error, retry: load) { list in
                    if list.isEmpty {
                        EmptyCard(systemName: "text.bubble", title: "Nothing yet",
                                  detail: "Your coach's review of each week appears here, with the plan for the next one.")
                    }
                    ForEach(list) { r in
                        NavigationLink { ReportDetailView(reportId: r.id ?? "") } label: {
                            HStack(spacing: 12) {
                                IconTile(systemName: "text.bubble")
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(r.weekLabel).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                    Text(firstLine(r)).font(.caption2).foregroundStyle(JK.tertiary).lineLimit(2)
                                }
                                Spacer()
                                if r.isUnread {
                                    Circle().fill(JK.text).frame(width: 8, height: 8).accessibilityLabel("New")
                                }
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                            }
                            .jkCard(padding: 12)
                        }
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func firstLine(_ r: Report) -> String {
        [r.summary, r.wins, r.focus].first { !$0.isEmpty } ?? ""
    }

    private func load() async {
        do {
            let reply: ReportsResponse = try await APIClient.shared.get("/api/reports")
            reports = reply.reports
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// One week's feedback: the coach's words, the week's figures, next week's plan.
struct ReportDetailView: View {
    let reportId: String
    @State private var report: Report?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Loadable(value: report, error: error, retry: load) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        Eyebrow(text: "\(Fmt.dayMonth(r.week)) – \(Fmt.dayMonth(r.weekEnd))")
                        Text("Your week").font(.largeTitle.weight(.semibold)).foregroundStyle(JK.text)
                        if let by = r.coachName {
                            Text("From \(by)" + (r.publishedAt.map { " · \(Fmt.dayMonth($0))" } ?? ""))
                                .font(.caption).foregroundStyle(JK.tertiary)
                        }
                    }
                    ReportSection(title: "How it went", text: r.summary)
                    ReportSection(title: "Wins", text: r.wins)
                    ReportSection(title: "Focus for next week", text: r.focus)
                    if let stats = r.stats { ReportStatsGrid(stats: stats) }
                    if let plan = r.plan { PlanList(plan: plan, linkWorkouts: true) }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            report = try await APIClient.shared.get("/api/reports/\(seg(reportId))")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

private struct ReportSection: View {
    let title: String
    let text: String

    var body: some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: title)
                Text(text).font(.body).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .jkCard()
        }
    }
}

/// The week in numbers. Apple Health figures appear only when shared.
struct ReportStatsGrid: View {
    let stats: ReportStats
    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "The week in numbers")
            LazyVGrid(columns: columns, spacing: 8) {
                StatTile(label: "Sessions", value: "\(stats.workoutsDone)/\(stats.workoutsPlanned)")
                StatTile(label: "Sets logged", value: "\(stats.setsLogged)")
                StatTile(label: "Habits", value: stats.habitsPct.map { "\($0)%" } ?? "–")
                if stats.healthShared {
                    StatTile(label: "Avg steps", value: stats.avgSteps.map { Fmt.number($0, digits: 0) } ?? "–")
                    StatTile(label: "Avg sleep", value: stats.avgSleepMinutes.map { Fmt.minutes($0) } ?? "–")
                    StatTile(label: "Workouts", value: stats.activities.map { "\($0.count)" } ?? "–",
                             delta: stats.activities.flatMap { $0.minutes > 0 ? Fmt.duration($0.minutes) : nil })
                }
                if let start = stats.weightStart, let end = stats.weightEnd {
                    StatTile(label: "Weight", value: "\(Fmt.number(end)) kg", delta: start == end ? nil : "\(Fmt.delta(end - start)) kg")
                }
                if let c = stats.checkin {
                    StatTile(label: "Energy", value: "\(c.energy)/5")
                    StatTile(label: "Sleep (felt)", value: "\(c.sleep)/5")
                }
            }
            if let types = stats.activities?.types, !types.isEmpty {
                Text(types.joined(separator: " · ")).font(.caption2).foregroundStyle(JK.tertiary)
            }
        }
    }
}

/// Next week's workouts. A client taps through to a published one.
struct PlanList: View {
    let plan: ReportPlan
    var linkWorkouts = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "Next week's plan", trailing: "\(Fmt.dayMonth(plan.from)) – \(Fmt.dayMonth(plan.to))")
            if plan.workouts.isEmpty {
                Text("Not written yet.").font(.caption).foregroundStyle(JK.tertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(plan.workouts) { w in
                        if linkWorkouts && w.published {
                            NavigationLink { WorkoutDetailLoader(workoutId: w.id) } label: { row(w, chevron: true) }
                        } else {
                            row(w, chevron: false)
                        }
                        if w.id != plan.workouts.last?.id { Divider().overlay(JK.stroke) }
                    }
                }
                .jkCard(padding: 4)
            }
        }
    }

    private func row(_ w: WorkoutSummary, chevron: Bool) -> some View {
        let day = Day.date(w.date) ?? Date()
        return UpcomingRow(weekday: Fmt.weekday(day), day: "\(Day.calendar.component(.day, from: day))", title: w.title,
                           detail: [w.startsAt, "\(w.itemCount) exercises", w.published ? nil : "Draft"].compactMap { $0 }.joined(separator: " · "),
                           chevron: chevron)
    }
}
