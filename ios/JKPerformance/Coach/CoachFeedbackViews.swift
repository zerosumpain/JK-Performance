import SwiftUI

// MARK: - Weekly feedback (coach)

/// The top of a client's Feedback tab: write this week's review, or open a past one.
struct CoachReportsSection: View {
    let clientId: String
    let clientName: String
    @State private var data: ReportsResponse?
    @State private var error: String?
    @State private var editingWeek: EditWeek?

    struct EditWeek: Identifiable { let id: String }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "Weekly feedback")
            Loadable(value: data, error: error, retry: load) { d in
                let current = d.reports.first { $0.week == d.suggestedWeek }
                Button {
                    editingWeek = EditWeek(id: d.suggestedWeek)
                } label: {
                    Label(current == nil ? "Write feedback · week of \(Fmt.dayMonth(d.suggestedWeek))"
                                         : "Edit feedback · week of \(Fmt.dayMonth(d.suggestedWeek))",
                          systemImage: "square.and.pencil")
                }
                .buttonStyle(PrimaryButtonStyle())
                ForEach(d.reports) { r in
                    Button { editingWeek = EditWeek(id: r.week) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.weekLabel).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                                Text(r.isPublished ? (r.readAt != nil ? "Published · read" : "Published · not read yet") : "Draft")
                                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        .jkCard(padding: 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .task { await load() }
        .sheet(item: $editingWeek, onDismiss: { Task { await load() } }) { w in
            ReportEditorSheet(clientId: clientId, clientName: clientName, week: w.id)
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

/// Write or edit one week's feedback, with that week's figures and next week's plan alongside.
struct ReportEditorSheet: View {
    let clientId: String
    let clientName: String
    @State var week: String
    @Environment(\.dismiss) private var dismiss
    @State private var report: Report?
    @State private var summary = ""
    @State private var wins = ""
    @State private var focus = ""
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    init(clientId: String, clientName: String, week: String) {
        self.clientId = clientId
        self.clientName = clientName
        _week = State(initialValue: week)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Button { shift(-7) } label: { Image(systemName: "chevron.left") }
                        Spacer()
                        VStack(spacing: 2) {
                            Text("Week of \(Fmt.dayMonth(week))").font(.jkHeadline).foregroundStyle(JK.text)
                            Text(report?.isPublished == true ? "Published" : (report?.id == nil ? "Not started" : "Draft"))
                                .font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        Spacer()
                        Button { shift(7) } label: { Image(systemName: "chevron.right") }
                    }
                    .foregroundStyle(JK.textSecondary)

                    if let error { ErrorBanner(message: error) }
                    if let stats = report?.stats {
                        ReportStatsGrid(stats: stats)
                        if let c = stats.checkin, !c.note.isEmpty || !c.pain.isEmpty {
                            Text("Check-in: " + ([c.pain.isEmpty ? nil : "pain " + c.pain.joined(separator: ", "), c.note.isEmpty ? nil : c.note]
                                .compactMap { $0 }.joined(separator: " · ")))
                                .font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                        if !stats.healthShared {
                            Text("\(clientName) hasn't shared Apple Health with you.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                    } else if error == nil {
                        LoadingCard()
                    }

                    editor("How the week went", text: $summary)
                    editor("Wins", text: $wins)
                    editor("Focus for next week", text: $focus)

                    if let plan = report?.plan { PlanList(plan: plan) }

                    Button {
                        Task { await save(status: "published") }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(report?.isPublished == true ? "Update" : "Publish to \(clientName)") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || empty)
                    Button(report?.isPublished == true ? "Unpublish (back to draft)" : "Save draft") {
                        Task { await save(status: "draft") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(saving)
                    if report?.id != nil {
                        Button("Delete", role: .destructive) { confirmDelete = true }
                            .font(.jkCaption)
                            .frame(maxWidth: .infinity)
                    }
                    Text("Publishing shows it on \(clientName)'s Home and sends them a message. You can also write these on the web: Guides › Coach desk on the web.")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle(clientName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .task(id: week) { await load() }
            .confirmationDialog("Delete this week's feedback?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await remove() } }
            }
        }
    }

    private var empty: Bool {
        [summary, wins, focus].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func editor(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.jkMicro).foregroundStyle(JK.textSecondary)
            TextField(title, text: text, axis: .vertical)
                .lineLimit(3...12)
                .font(.jkCallout)
                .padding(10)
                .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
        }
    }

    private func shift(_ days: Int) {
        guard let d = Day.date(week) else { return }
        week = Day.string(Day.add(days, to: d))
    }

    private func load() async {
        report = nil
        do {
            let r: Report = try await APIClient.shared.get("/api/reports/week/\(week)", query: ["clientId": clientId])
            report = r
            summary = r.summary
            wins = r.wins
            focus = r.focus
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func save(status: String) async {
        saving = true
        defer { saving = false }
        do {
            report = try await APIClient.shared.send("PUT", "/api/reports", body: ReportInput(
                clientId: clientId, week: week, summary: summary, wins: wins, focus: focus, status: status))
            error = nil
            if status == "published" { dismiss() }
        } catch {
            self.error = error.readable
        }
    }

    private func remove() async {
        guard let id = report?.id else { return }
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/reports/\(seg(id))")
            dismiss()
        } catch {
            self.error = error.readable
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
