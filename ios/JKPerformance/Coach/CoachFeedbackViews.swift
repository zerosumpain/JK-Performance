import SwiftUI

// MARK: - Weekly feedback (coach)

/// A client's letters: write this week's, or open a past one in the composer.
struct CoachReportsSection: View {
    let clientId: String
    let clientName: String
    let client: PersonRef
    @State private var data: ReportsResponse?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            Loadable(value: data, error: error, retry: load) { d in
                NavigationLink { LetterComposer(client: client, week: d.suggestedWeek) } label: {
                    Text(d.reports.contains { $0.week == d.suggestedWeek && $0.kind != "milestone" }
                         ? "Edit the letter · week of \(Fmt.dayMonth(d.suggestedWeek))"
                         : "Write this week's letter")
                }
                .buttonStyle(PrimaryButtonStyle())
                if d.reports.isEmpty {
                    Text("No letters yet.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                } else {
                    VStack(spacing: 0) {
                        ForEach(d.reports) { r in
                            NavigationLink { LetterComposer(client: client, week: r.week) } label: {
                                CoachRowLabel(icon: r.isMilestone ? .milestone : .letter, title: r.displayHeadline, detail: state(r))
                            }
                            .buttonStyle(.plain)
                            .disabled(r.isMilestone)
                            if r.id != d.reports.last?.id { GroupDivider() }
                        }
                    }
                    .surface(.group)
                }
            }
        }
        .task { await load() }
    }

    private func state(_ r: Report) -> String {
        let week = "Week of \(Fmt.dayMonth(r.week))"
        switch r.letterStatus ?? (r.isPublished ? "published" : "draft") {
        case "published": return "\(week) · delivered" + (r.readAt != nil ? " · read" : "") + (r.answer != nil ? " · answered" : "")
        case "scheduled": return "\(week) · scheduled"
        default: return "\(week) · draft"
        }
    }

    private func load() async {
        do {
            data = try await APIClient.shared.get("/api/reports", query: ["clientId": clientId])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

// MARK: - Health tab (coach)

/// The client's last seven days from Apple Health and their workouts, if they share it.
struct CoachHealthTab: View {
    let clientId: String
    let clientName: String
    @State private var week: HealthWeek?
    @State private var error: String?

    var body: some View {
        Loadable(value: week, error: error, retry: load) { w in
            if !w.shared {
                EmptyCard(systemName: "heart.slash", title: "Not shared",
                          detail: "\(clientName) hasn't shared Apple Health with you. They can turn it on in Account › Apple Health.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: "Last 7 days", trailing: w.sharedSince.map { "Shared since \(Fmt.dayMonth($0))" })
                    VStack(spacing: 0) {
                        HStack {
                            Text("").frame(width: 44, alignment: .leading)
                            Text("Steps").frame(maxWidth: .infinity, alignment: .trailing)
                            Text("Sleep").frame(maxWidth: .infinity, alignment: .trailing)
                            Text("RHR").frame(maxWidth: .infinity, alignment: .trailing)
                            Text("kcal").frame(maxWidth: .infinity, alignment: .trailing)
                        }
                        .font(.jkCaption).foregroundStyle(JK.textTertiary).padding(.horizontal, 12).padding(.vertical, 8)
                        ForEach(w.days.reversed(), id: \.date) { d in
                            Divider().overlay(JK.hairline)
                            HStack {
                                Text(d.date.flatMap(Day.date).map { Fmt.weekday($0) } ?? "")
                                    .frame(width: 44, alignment: .leading).foregroundStyle(JK.textTertiary)
                                Text(d.steps.map { Fmt.number($0, digits: 0) } ?? "–").frame(maxWidth: .infinity, alignment: .trailing)
                                Text(d.sleepMinutes.map { Fmt.minutes($0) } ?? "–").frame(maxWidth: .infinity, alignment: .trailing)
                                Text(d.restingHr.map { Fmt.number($0, digits: 0) } ?? "–").frame(maxWidth: .infinity, alignment: .trailing)
                                Text(d.activeKcal.map { Fmt.number($0, digits: 0) } ?? "–").frame(maxWidth: .infinity, alignment: .trailing)
                            }
                            .font(.jkCaption.monospacedDigit()).foregroundStyle(JK.text)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                        }
                    }
                    .jkCard(padding: 0)
                    Eyebrow(text: "Workouts", trailing: w.activities.isEmpty ? nil : "\(w.activities.count) this week")
                    if w.activities.isEmpty {
                        Text("No workouts recorded this week.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(w.activities) { a in
                                ActivityRow(activity: a)
                                if a.id != w.activities.last?.id { Divider().overlay(JK.hairline) }
                            }
                        }
                        .jkCard(padding: 4)
                    }
                }
            }
        }
        EmptyView().task { await load() }
    }

    private func load() async {
        do {
            week = try await APIClient.shared.get("/api/health/week", query: ["clientId": clientId])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

// MARK: - Coach desk on the web

/// Shows a one-time code to type into the web desk (valid ten minutes).
struct WebDeskSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var link: LinkCode?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Write feedback and plans from a computer.").font(.jkCallout).foregroundStyle(JK.textSecondary)
                VStack(alignment: .leading, spacing: 6) {
                    Text("1. On your computer, open").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    Text(link?.url ?? "jk.strangeramblings.com/desk").font(.jkHeadline.monospaced()).foregroundStyle(JK.text)
                        .textSelection(.enabled)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("2. Type this code").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    if let link {
                        Text(link.code).font(.jkNumberHero.monospaced()).foregroundStyle(JK.text)
                            .textSelection(.enabled)
                        Text("Works once, until \(Fmt.time(link.expiresAt)).").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    } else if let error {
                        ErrorBanner(message: error)
                    } else {
                        ProgressView()
                    }
                }
                Button("New code") { Task { await load() } }.buttonStyle(SecondaryButtonStyle())
                Text("The browser stays signed in for 30 days. Sign out there when you're done on a shared computer.")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
                Spacer()
            }
            .padding(20)
            .jkScreen()
            .navigationTitle("Coach desk on the web")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            link = try await APIClient.shared.send("POST", "/api/auth/link-code")
            error = nil
        } catch {
            self.error = error.readable
        }
    }
}
