import Charts
import SwiftUI

// MARK: - Today (coach tab root)

struct CoachTodayView: View {
    @State private var today: CoachToday?
    @State private var error: String?
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach · \(Fmt.shortDay(Date()))", title: "Today") {
                        Button { showAccount = true } label: {
                            Image(systemName: "person.crop.circle")
                                .font(.title3)
                                .frame(width: 30, height: 30)
                        }
                        .foregroundStyle(JK.text)
                        .accessibilityLabel("Account")
                        NavigationLink { BusinessView() } label: {
                            Text("JK")
                                .font(.caption.weight(.bold))
                                .frame(width: 30, height: 30)
                                .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.secondary, lineWidth: 1))
                        }
                        .foregroundStyle(JK.text)
                        .accessibilityLabel("Business")
                    }
                    Loadable(value: today, error: error, retry: load) { t in
                        TodayCards(today: t)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showAccount) { CoachAccountView() }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            today = try await APIClient.shared.get("/api/coach/today", query: ["date": Day.today])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// Clients whose feedback for the week isn't published yet.
struct FeedbackDueView: View {
    let due: FeedbackDue

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ScreenHeader(eyebrow: "Week of \(Fmt.dayMonth(due.week))", title: "Feedback to write")
                ForEach(due.clients) { c in
                    NavigationLink { ClientDetailView(clientId: c.id, name: c.name, initialTab: .feedback) } label: {
                        HStack(spacing: 12) {
                            Avatar(initials: c.displayInitials, size: 32)
                            Text(c.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                        }
                        .jkCard(padding: 12)
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct SessionRow: View {
    let session: Booking
    let isNext: Bool

    private var done: Bool { session.end < Date() }
    private var who: String {
        if let c = session.client { return c.name }
        return session.title ?? "Group"
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Fmt.time(session.start)).font(.caption2.weight(.semibold))
                Text(Fmt.time(session.end)).font(.system(size: 9)).foregroundStyle(JK.tertiary)
            }
            .frame(width: 38, alignment: .leading)
            .foregroundStyle(done ? JK.tertiary : JK.text)
            NavigationLink {
                if let c = session.client {
                    ClientDetailView(clientId: c.id, name: c.name)
                } else {
                    ClassDetailView(booking: session)
                }
            } label: {
                HStack(spacing: 10) {
                    Capsule().fill(JK.slot(session.kind).opacity(done ? 0.4 : 1)).frame(width: 3, height: 28)
                    Avatar(initials: session.client.map { $0.displayInitials } ?? "G", size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(session.isGroup ? "\(who) · \(session.attendeeCount ?? session.attendees?.count ?? 0) clients" : who)
                            .font(.subheadline.weight(.semibold))
                        Text([session.title, session.kindLabel].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                    if isNext {
                        Text("Next")
                            .font(.system(size: 9, weight: .semibold))
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(JK.text, in: Capsule())
                            .foregroundStyle(.black)
                    } else if done {
                        Image(systemName: "checkmark").font(.caption)
                    } else {
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                    }
                }
                .foregroundStyle(done ? JK.tertiary : JK.text)
                .padding(10)
                .background(JK.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isNext ? JK.secondary : JK.stroke, lineWidth: 1))
            }
        }
    }
}

/// A group class: who's coming, and cancel.
struct ClassDetailView: View {
    let booking: Booking
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var confirm = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(booking.title ?? booking.kindLabel).font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                    Text("\(Fmt.longDay(booking.start)) · \(Fmt.time(booking.start))–\(Fmt.time(booking.end))")
                        .font(.caption).foregroundStyle(JK.secondary)
                    if let location = booking.location { Text(location).font(.caption).foregroundStyle(JK.tertiary) }
                }
                Eyebrow(text: "Attendees", trailing: booking.capacity.map { "\(booking.attendeeCount ?? booking.attendees?.count ?? 0) of \($0)" })
                let people = booking.attendees ?? (booking.client.map { [$0] } ?? [])
                if people.isEmpty {
                    EmptyCard(systemName: "person.2", title: "Nobody yet")
                } else {
                    VStack(spacing: 0) {
                        ForEach(people) { p in
                            HStack(spacing: 10) {
                                Avatar(initials: p.displayInitials, size: 28)
                                Text(p.name).font(.subheadline).foregroundStyle(JK.text)
                                Spacer()
                            }
                            .padding(10)
                        }
                    }
                    .jkCard(padding: 2)
                }
                if let error { ErrorBanner(message: error) }
                if booking.cancellable != false && booking.start > Date() {
                    Button(booking.isGroup ? "Cancel class" : "Cancel booking", role: .destructive) { confirm = true }
                        .buttonStyle(GhostButtonStyle())
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Cancel this?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Cancel it", role: .destructive) { Task { await cancel() } }
        }
    }

    private func cancel() async {
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/bookings/\(seg(booking.id))")
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Business

struct BusinessView: View {
    enum Period: String, CaseIterable { case week = "Week", month = "Month" }
    @State private var period: Period = .month
    @State private var data: Business?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Coach · \(Fmt.month(Date()))", title: "Business") {
                    Segmented(options: Period.allCases, selection: $period) { $0.rawValue }.frame(width: 120)
                }
                Loadable(value: data, error: error, retry: load) { b in
                    mrrCard(b)
                    HStack(spacing: 8) {
                        StatTile(label: "Active", value: "\(b.active)")
                        StatTile(label: "New", value: "\(b.new)")
                        StatTile(label: "Churned", value: "\(b.churned)")
                        StatTile(label: "Adherence", value: b.adherence.map { "\($0)%" } ?? "–")
                    }
                    if let plans = b.plans, !plans.isEmpty {
                        Eyebrow(text: "Members by plan")
                        HStack(spacing: 8) {
                            ForEach(plans, id: \.id) { p in StatTile(label: p.name, value: "\(p.members)") }
                        }
                    }
                    PlansPricesLink()
                    Eyebrow(text: "Needs attention", trailing: "Auto-flagged")
                    if b.attention.isEmpty {
                        EmptyCard(systemName: "checkmark.seal", title: "Everyone's on track")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(b.attention, id: \.self) { item in
                                NavigationLink { ClientDetailView(clientId: item.client.id, name: item.client.name) } label: {
                                    HStack(spacing: 12) {
                                        Avatar(initials: item.client.displayInitials)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.client.name).font(.subheadline.weight(.semibold))
                                            Text(item.reason).font(.caption2).foregroundStyle(JK.tertiary)
                                        }
                                        Spacer()
                                        Image(systemName: Self.icon(item.kind)).font(.caption).foregroundStyle(JK.secondary)
                                    }
                                    .foregroundStyle(JK.text)
                                    .padding(12)
                                }
                            }
                        }
                        .jkCard(padding: 2)
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .task(id: period) { await load() }
    }

    private static func icon(_ kind: String) -> String {
        switch kind {
        case "payment": return "creditcard"
        case "checkin": return "doc.text"
        default: return "exclamationmark.triangle"
        }
    }

    @ViewBuilder
    private func mrrCard(_ b: Business) -> some View {
        let points = b.series.compactMap { s in Day.date(s.date).map { ($0, Double(s.pence) / 100) } }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Eyebrow(text: "Monthly recurring revenue")
                Spacer()
                if let delta = b.mrrDeltaPct { DeltaBadge(text: "\(Fmt.delta(delta, digits: 0))%") }
            }
            Text(Fmt.pounds(b.mrrPence)).font(.largeTitle.weight(.semibold)).foregroundStyle(JK.text)
            if points.count >= 2 {
                let values = points.map(\.1)
                let span = max((values.max() ?? 0) - (values.min() ?? 0), 1)
                let low = (values.min() ?? 0) - span * 0.1, high = (values.max() ?? 0) + span * 0.1
                Chart(points, id: \.0) { pt in
                    AreaMark(x: .value("Day", pt.0), yStart: .value("£", low), yEnd: .value("£", pt.1))
                        .foregroundStyle(LinearGradient(colors: [JK.text.opacity(0.3), .clear], startPoint: .top, endPoint: .bottom))
                    LineMark(x: .value("Day", pt.0), y: .value("£", pt.1)).foregroundStyle(JK.text)
                }
                .chartYScale(domain: low...high)
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .frame(height: 90)
            }
        }
        .jkCard()
    }

    private func load() async {
        do {
            data = try await APIClient.shared.get("/api/coach/business", query: ["period": period.rawValue.lowercased()])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// The row into Plans & prices, on Business and the coach's Account.
struct PlansPricesLink: View {
    var body: some View {
        NavigationLink {
            PlansPricesView()
        } label: {
            HStack(spacing: 12) {
                IconTile(systemName: "tag")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Plans & prices").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Names, prices, credits and what each plan includes").font(.caption2).foregroundStyle(JK.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
            }
            .jkCard(padding: 12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Clients (coach tab root)

struct ClientsView: View {
    @State private var clients: [ClientSummary]?
    @State private var error: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach", title: "Clients") {
                        NavigationLink { ProgramsView() } label: {
                            Label("Programs", systemImage: "square.stack")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
                        }
                        .foregroundStyle(JK.text)
                    }
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.tertiary)
                        TextField("Search clients", text: $query).autocorrectionDisabled()
                    }
                    .jkCard(padding: 10)
                    Loadable(value: clients, error: error, retry: load) { list in
                        let shown = list.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
                        if shown.isEmpty {
                            EmptyCard(systemName: "person.2", title: list.isEmpty ? "No clients yet" : "No matches",
                                      detail: list.isEmpty ? "Clients appear here when they sign up." : nil)
                        } else if query.isEmpty {
                            // The server sends them most-in-need first; group them so the line between is clear.
                            let now = shown.filter { ClientText.needsYou($0) }
                            let later = shown.filter { $0.demand?.kind == "quiet" || $0.demand?.kind == "inactive" }
                            let fine = shown.filter { !ClientText.needsYou($0) && $0.demand?.kind != "quiet" && $0.demand?.kind != "inactive" }
                            clientGroup("Needs you", now)
                            clientGroup("Check in with", later)
                            clientGroup("On track", fine)
                        } else {
                            clientGroup(nil, shown)
                        }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
        }
    }

    @ViewBuilder
    private func clientGroup(_ title: String?, _ list: [ClientSummary]) -> some View {
        if !list.isEmpty {
            if let title { Eyebrow(text: title, trailing: "\(list.count)") }
            VStack(spacing: 0) {
                ForEach(list) { c in
                    NavigationLink { ClientDetailView(clientId: c.id, name: c.name, initialTab: ClientText.tab(for: c)) } label: {
                        ClientRow(client: c)
                    }
                }
            }
            .jkCard(padding: 2)
        }
    }

    private func load() async {
        do {
            let reply: ClientsResponse = try await APIClient.shared.get("/api/coach/clients")
            clients = reply.clients
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

private struct ClientRow: View {
    let client: ClientSummary

    var body: some View {
        HStack(spacing: 12) {
            Avatar(initials: client.displayInitials, size: 34)
                .overlay(alignment: .topTrailing) {
                    if let tint = ClientText.tint(client) { Dot(color: tint, size: 9).overlay(Circle().stroke(JK.card, lineWidth: 2)) }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(client.name).font(.subheadline.weight(.semibold))
                Text(ClientText.reason(client))
                    .font(.caption2)
                    .foregroundStyle(client.demand?.kind == "urgent" ? JK.urgent : JK.tertiary)
                    .lineLimit(1)
            }
            Spacer()
            if let unread = client.unread, unread > 0 {
                Image(systemName: "bubble.left.fill").font(.caption2).foregroundStyle(JK.secondary)
            }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
        }
        .foregroundStyle(JK.text)
        .padding(12)
    }
}

/// Human text for a client summary's plan, adherence and flags.
enum ClientText {
    /// Something of theirs is waiting on the coach.
    static func needsYou(_ c: ClientSummary) -> Bool {
        ["urgent", "message", "form", "checkin"].contains(c.demand?.kind ?? "")
    }

    static func tint(_ c: ClientSummary) -> Color? {
        switch c.demand?.kind {
        case "urgent": return JK.urgent
        case "message", "form", "checkin": return JK.waiting
        default: return nil
        }
    }

    /// Why they're where they are: "Sent you a message · 2 hr. ago", else the usual plan line.
    static func reason(_ c: ClientSummary) -> String {
        guard let d = c.demand, let reason = d.reason else { return line(c) }
        if let at = d.at, ["urgent", "message", "form", "checkin"].contains(d.kind) { return "\(reason) · \(Fmt.relative(at))" }
        return reason
    }

    /// The tab that answers what they need.
    static func tab(for c: ClientSummary) -> ClientDetailView.Tab {
        switch c.demand?.kind {
        case "urgent", "form", "checkin": return .feedback
        default: return .plan
        }
    }

    static func flag(_ f: String) -> String {
        if f == "no-workout-yet" { return "no workout yet" }
        if f == "checkin-overdue" { return "check-in overdue" }
        if f.hasPrefix("no-workout-"), let days = Int(f.dropFirst("no-workout-".count).dropLast()) {
            return "no workout in \(days) days"
        }
        return f.replacingOccurrences(of: "-", with: " ")
    }

    static func line(_ c: ClientSummary) -> String {
        var parts = [Fmt.planName(c.plan)]
        if let first = c.flags?.first {
            parts.append(flag(first))
        } else if let a = c.adherence {
            parts.append("adherence \(a)%")
        } else if c.checkinDue == true {
            parts.append("check-in due")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Programs

struct ProgramsView: View {
    enum Tab: String, CaseIterable { case programs = "Programs", autoflows = "Autoflows", forms = "Forms" }
    @State private var tab: Tab
    @State private var programs: [Program]?
    @State private var error: String?
    @State private var editing: ProgramDraft?
    @State private var assigning: Program?

    init(initialTab: Tab = .programs) {
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Templates & automation", title: tab.rawValue) {
                    if tab == .programs {
                        Button { editing = ProgramDraft() } label: { Label("New", systemImage: "plus") }
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(JK.chrome, in: Capsule())
                            .foregroundStyle(.black)
                    }
                }
                Segmented(options: Tab.allCases, selection: $tab) { $0.rawValue }
                switch tab {
                case .programs:
                    Loadable(value: programs, error: error, retry: load) { list in
                        if list.isEmpty {
                            EmptyCard(systemName: "square.stack", title: "No programs yet",
                                      detail: "Build a template once, then assign it to any client with a start date.")
                        }
                        ForEach(list) { p in programRow(p) }
                    }
                case .autoflows:
                    AutoflowsTab()
                case .forms:
                    FormsTab()
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .task { await load() }
        .sheet(item: $editing) { draft in
            ProgramEditorSheet(draft: draft) { await load() }
        }
        .sheet(item: $assigning) { program in
            AssignProgramSheet(program: program) { await load() }
        }
    }

    private func programRow(_ p: Program) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10).fill(JK.cardRaised).frame(width: 52, height: 52)
                .overlay(Image(systemName: "chart.xyaxis.line").foregroundStyle(JK.tertiary))
            VStack(alignment: .leading, spacing: 4) {
                Text(p.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(p.daysPerWeek) days / week · \(p.weeks) weeks · \(p.workouts.count) workouts")
                    .font(.caption2).foregroundStyle(JK.tertiary)
                Text(p.clientCount.map { $0 == 1 ? "1 client" : "\($0) clients" } ?? "Template")
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(JK.cardRaised, in: Capsule())
                    .foregroundStyle(JK.secondary)
            }
            Spacer()
            Menu {
                Button { editing = ProgramDraft(p) } label: { Label("Edit", systemImage: "pencil") }
                Button { assigning = p } label: { Label("Assign to client", systemImage: "person.badge.plus") }
            } label: {
                Image(systemName: "ellipsis").frame(width: 30, height: 30).foregroundStyle(JK.secondary)
            }
        }
        .jkCard(padding: 12)
        .contentShape(Rectangle())
        .onTapGesture { editing = ProgramDraft(p) }
    }

    private func load() async {
        do {
            let reply: ProgramsResponse = try await APIClient.shared.get("/api/programs")
            programs = reply.programs
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

struct ProgramDraft: Identifiable {
    let id = UUID()
    var programId: String?
    var name = ""
    var detail = ""
    var daysPerWeek = 3
    var weeks = 4
    var workouts: [ProgramWorkout] = []

    init() {}

    init(_ p: Program) {
        programId = p.id
        name = p.name
        detail = p.detail
        daysPerWeek = p.daysPerWeek
        weeks = p.weeks
        workouts = p.workouts
    }

    var input: ProgramInput {
        ProgramInput(name: name, detail: detail, daysPerWeek: daysPerWeek, weeks: weeks,
                     workouts: workouts.sorted { $0.dayOffset < $1.dayOffset })
    }
}

struct ProgramEditorSheet: View {
    @State var draft: ProgramDraft
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var picking: UUID?
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    JKField(label: "Name", text: $draft.name, prompt: "12-Week Strength Block")
                    JKField(label: "Description", text: $draft.detail, prompt: "4 days / week, barbell focus")
                    HStack(spacing: 12) {
                        Stepper("\(draft.daysPerWeek) days / week", value: $draft.daysPerWeek, in: 1...7)
                        Stepper("\(draft.weeks) wk", value: $draft.weeks, in: 1...52)
                    }
                    .font(.caption)
                    .foregroundStyle(JK.text)

                    Eyebrow(text: "Workouts", trailing: "Day offset from the start date")
                    ForEach($draft.workouts) { $w in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                JKField(label: "Title", text: $w.title, prompt: "Lower Body Strength")
                                Stepper("Day \(w.dayOffset + 1)", value: $w.dayOffset, in: 0...(draft.weeks * 7 - 1))
                                    .font(.caption).frame(width: 150)
                            }
                            ItemsEditor(items: $w.items)
                            HStack {
                                Button { picking = w.localId } label: { Label("Add exercise", systemImage: "plus") }
                                    .buttonStyle(SmallPillStyle())
                                Spacer()
                                Button(role: .destructive) {
                                    draft.workouts.removeAll { $0.localId == w.localId }
                                } label: { Label("Remove workout", systemImage: "trash") }
                                    .buttonStyle(SmallPillStyle())
                            }
                        }
                        .jkCard()
                    }
                    Button {
                        let next = (draft.workouts.map(\.dayOffset).max() ?? -1) + 1
                        draft.workouts.append(ProgramWorkout(dayOffset: min(next, draft.weeks * 7 - 1), title: "Workout \(draft.workouts.count + 1)", items: []))
                    } label: { Label("Add workout", systemImage: "plus") }
                        .buttonStyle(GhostButtonStyle())

                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView().tint(.black) } else { Text(draft.programId == nil ? "Create program" : "Save program") }
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
                    if draft.programId != nil {
                        Button("Delete program", role: .destructive) { confirmDelete = true }
                            .buttonStyle(GhostButtonStyle())
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle(draft.programId == nil ? "New program" : "Edit program")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .sheet(isPresented: Binding(get: { picking != nil }, set: { if !$0 { picking = nil } })) {
                ExercisePickerSheet { exercise in
                    guard let target = picking, let i = draft.workouts.firstIndex(where: { $0.localId == target }) else { return }
                    draft.workouts[i].items.append(WorkoutItemInput(exerciseId: exercise.id, exerciseName: exercise.name))
                }
            }
            .confirmationDialog("Delete this program?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Workouts already assigned to clients stay.")
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let id = draft.programId {
                let _: Program = try await APIClient.shared.send("PUT", "/api/programs/\(seg(id))", body: draft.input)
            } else {
                let _: Program = try await APIClient.shared.send("POST", "/api/programs", body: draft.input)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }

    private func delete() async {
        guard let id = draft.programId else { return }
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/programs/\(seg(id))")
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

/// Rows of exercise prescriptions: sets, reps, load, RPE, note; reorder and
/// delete. Shared by the program editor and the client plan editor.
struct ItemsEditor: View {
    @Binding var items: [WorkoutItemInput]

    var body: some View {
        if items.isEmpty {
            Text("No exercises yet.").font(.caption2).foregroundStyle(JK.tertiary)
        }
        ForEach(Array(items.enumerated()), id: \.element.localId) { index, item in
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(item.exerciseName.isEmpty ? item.exerciseId : item.exerciseName)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    if item.id == nil {
                        Text("New")
                            .font(.system(size: 9, weight: .semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(JK.text, in: Capsule())
                            .foregroundStyle(.black)
                    }
                    Spacer()
                    Button { move(index, by: -1) } label: { Image(systemName: "arrow.up") }
                        .disabled(index == 0)
                    Button { move(index, by: 1) } label: { Image(systemName: "arrow.down") }
                        .disabled(index == items.count - 1)
                    Button(role: .destructive) { items.remove(at: index) } label: { Image(systemName: "trash") }
                }
                .font(.caption)
                .foregroundStyle(JK.secondary)
                .buttonStyle(.plain)
                HStack(spacing: 6) {
                    JKField(label: "Sets", text: Binding(get: { "\(items[index].sets)" },
                                                         set: { items[index].sets = Int($0) ?? items[index].sets }),
                            keyboard: .numberPad)
                        .frame(width: 52)
                    JKField(label: "Reps", text: $items[index].reps, prompt: "10")
                    JKField(label: "Load", text: $items[index].load, prompt: "60 kg")
                    JKField(label: "RPE", text: Binding(get: { items[index].rpe ?? "" },
                                                        set: { items[index].rpe = $0.isEmpty ? nil : $0 }), prompt: "7–8")
                        .frame(width: 56)
                }
                JKField(label: "Note", text: Binding(get: { items[index].note ?? "" },
                                                     set: { items[index].note = $0.isEmpty ? nil : $0 }),
                        prompt: "Cue for the client")
            }
            .padding(10)
            .background(JK.cardRaised.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func move(_ index: Int, by offset: Int) {
        let target = index + offset
        guard items.indices.contains(target) else { return }
        items.swapAt(index, target)
    }
}

struct AssignProgramSheet: View {
    let program: Program
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var clients: [ClientSummary]?
    @State private var clientId: String?
    @State private var start = Day.add(1, to: Day.start(Date()))
    @State private var error: String?
    @State private var saving = false
    @State private var created: Int?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(program.name).font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                    DatePicker("Start date", selection: $start, displayedComponents: .date)
                        .font(.subheadline).foregroundStyle(JK.text)
                    Eyebrow(text: "Client")
                    if let clients {
                        VStack(spacing: 0) {
                            ForEach(clients) { c in
                                Button { clientId = c.id } label: {
                                    HStack(spacing: 10) {
                                        Avatar(initials: c.displayInitials, size: 28)
                                        Text(c.name).font(.subheadline).foregroundStyle(JK.text)
                                        Spacer()
                                        CheckCircle(on: clientId == c.id)
                                    }
                                    .padding(10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .jkCard(padding: 2)
                    } else {
                        LoadingCard()
                    }
                    if let created {
                        Label("Created \(created) draft workouts. Publish them from the client's Plan tab.", systemImage: "checkmark.circle")
                            .font(.caption).foregroundStyle(JK.secondary)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await assign() }
                    } label: {
                        if saving { ProgressView().tint(.black) } else { Text(created == nil ? "Assign" : "Done") }
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(saving || (created == nil && clientId == nil))
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Assign program")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                do {
                    let reply: ClientsResponse = try await APIClient.shared.get("/api/coach/clients")
                    clients = reply.clients
                } catch {
                    if !error.isCancellation { self.error = error.readable }
                }
            }
        }
    }

    private func assign() async {
        if created != nil {
            await onDone()
            dismiss()
            return
        }
        guard let clientId else { return }
        saving = true
        defer { saving = false }
        do {
            let reply: AssignResponse = try await APIClient.shared.send(
                "POST", "/api/programs/\(seg(program.id))/assign",
                body: AssignInput(clientId: clientId, startDate: Day.string(start)))
            created = reply.created
            error = nil
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Hints & guides (coach tab root)

struct GuidesView: View {
    @State private var switchError: String?
    @State private var showDesk = false
    @Environment(AppSession.self) private var session
    @State private var query = ""
    @State private var filter = "All"
    @State private var guides: GuidesResponse?
    @State private var error: String?
    @State private var open: Guide?

    private var tags: [String] {
        let all = (guides?.tips ?? []).flatMap(\.tags) + (guides?.featured?.tags ?? [])
        var seen: [String] = []
        for t in all where !seen.contains(t) { seen.append(t) }
        return ["All"] + seen
    }

    private func matches(_ g: Guide) -> Bool {
        (filter == "All" || g.tags.contains(filter))
            && (query.isEmpty || g.title.localizedCaseInsensitiveContains(query) || g.body.localizedCaseInsensitiveContains(query))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach library", title: "Hints & guides")
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.tertiary)
                        TextField("Search guides and cues", text: $query)
                    }
                    .jkCard(padding: 10)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tags, id: \.self) { f in
                                Chip(label: f, selected: filter == f) { filter = f }
                            }
                        }
                    }
                    Loadable(value: guides, error: error, retry: load) { g in
                        if let featured = g.featured, matches(featured) {
                            Button { open = featured } label: { featuredCard(featured) }
                                .buttonStyle(.plain)
                        }
                        Eyebrow(text: "Quick tips")
                        let tips = g.tips.filter(matches)
                        if tips.isEmpty {
                            Text("Nothing matches.").font(.caption).foregroundStyle(JK.tertiary)
                        }
                        ForEach(tips) { tip in
                            Button { open = tip } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    IconTile(systemName: symbol(tip.icon ?? "lightbulb", fallback: "lightbulb"), size: 32)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(tip.title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                        Text(tip.body).font(.caption2).foregroundStyle(JK.tertiary).lineLimit(3)
                                            .multilineTextAlignment(.leading)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .jkCard(padding: 12)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Button { showDesk = true } label: {
                        Label("Coach desk on the web", systemImage: "desktopcomputer")
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .padding(.top, 20)
                    Text("Write weekly feedback and plans from a computer.")
                        .font(.caption2).foregroundStyle(JK.tertiary)
                    Button {
                        Task {
                            do { try await session.switchToDemoClient() } catch { switchError = error.readable }
                        }
                    } label: {
                        Label("View the app as a client (demo: Sam Carter)", systemImage: "arrow.left.arrow.right")
                    }
                    .buttonStyle(GhostButtonStyle())
                    if let switchError { ErrorBanner(message: switchError) }
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(GhostButtonStyle())
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showDesk) { WebDeskSheet() }
            .task { await load() }
            .sheet(item: $open) { g in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: ([g.minutes.map { "\($0) min" }] + g.tags.map { Optional($0) }).compactMap { $0 }.joined(separator: " · "))
                        Text(g.title).font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                        Text(g.body).font(.body).foregroundStyle(JK.secondary)
                    }
                    .padding(20)
                }
                .background(JK.bg.ignoresSafeArea())
                .presentationDetents([.medium, .large])
            }
        }
    }

    private func featuredCard(_ g: Guide) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topTrailing) {
                Rectangle().fill(JK.cardRaised).frame(height: 110)
                    .overlay(Image(systemName: "book.pages").font(.largeTitle).foregroundStyle(JK.tertiary))
                if let first = g.tags.first {
                    Text(first)
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(JK.card, in: Capsule())
                        .foregroundStyle(JK.secondary)
                        .padding(8)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Featured guide" + (g.minutes.map { " · \($0) min" } ?? ""))
                Text(g.title).font(.headline).foregroundStyle(JK.text).multilineTextAlignment(.leading)
                Text(g.body).font(.caption).foregroundStyle(JK.tertiary).lineLimit(3).multilineTextAlignment(.leading)
            }
            .padding(14)
        }
        .background(JK.card)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }

    private func load() async {
        do {
            guides = try await APIClient.shared.get("/api/guides")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}


// MARK: - Coach account

/// The coach's own account: who is signed in, privacy, and signing out (to
/// switch to another account, such as the demo client with "I have a code").
struct CoachAccountView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        Avatar(initials: initialsOf(session.me?.name ?? "Coach"), size: 48)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.me?.name ?? "Coach").font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                            Text(session.me?.email ?? "Coach account").font(.caption).foregroundStyle(JK.tertiary)
                        }
                    }
                    Text("Signed in as the coach. Clients who sign up are assigned to you.")
                        .font(.footnote).foregroundStyle(JK.secondary)
                    Link(destination: APIClient.shared.privacyURL) {
                        HStack(spacing: 12) {
                            IconTile(systemName: "hand.raised")
                            Text("Privacy policy").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(JK.tertiary)
                        }
                        .jkCard(padding: 12)
                    }
                    PlansPricesLink()
                    CoachNotificationsRow()
                    CalendarSubscribeCard()
                    WebSessionsRow()
                    Button("Sign out") { confirmSignOut = true }
                        .buttonStyle(ChromeButtonStyle())
                        .padding(.top, 12)
                    Text("To see the client side, use Guides › View the app as a client.")
                        .font(.caption2).foregroundStyle(JK.tertiary)
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func initialsOf(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

/// Browsers signed in to the coach desk, and a button to sign them all out.
private struct WebSessionsRow: View {
    struct Sessions: Decodable { let count: Int; var latestSignIn: Date? }
    @State private var sessions: Sessions?
    @State private var busy = false

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: "desktopcomputer")
            VStack(alignment: .leading, spacing: 2) {
                Text("Coach desk on the web").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            if (sessions?.count ?? 0) > 0 {
                Button("Sign out all") { Task { await endAll() } }
                    .font(.caption.weight(.semibold))
                    .disabled(busy)
            }
        }
        .jkCard(padding: 12)
        .task { sessions = try? await APIClient.shared.get("/api/auth/web-sessions") }
    }

    private var detail: String {
        guard let s = sessions else { return " " }
        if s.count == 0 { return "Not signed in on any browser" }
        let browsers = s.count == 1 ? "1 browser" : "\(s.count) browsers"
        return browsers + (s.latestSignIn.map { " · last sign-in \(Fmt.relative($0))" } ?? "")
    }

    private func endAll() async {
        busy = true
        defer { busy = false }
        struct Ended: Decodable { let ended: Int }
        do {
            let _: Ended = try await APIClient.shared.send("DELETE", "/api/auth/web-sessions")
            sessions = Sessions(count: 0, latestSignIn: nil)
        } catch {}
    }
}

/// Push for the coach: client messages, check-ins, bookings made or cancelled.
private struct CoachNotificationsRow: View {
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                IconTile(systemName: "bell")
                Toggle(isOn: Binding(get: { Reminders.shared.enabled }, set: { on in
                    Task {
                        if on {
                            error = await Reminders.shared.enable(checkIn: false)
                                ? nil : "Notifications are off for JK Performance. Turn them on in Settings › Notifications."
                        } else {
                            Reminders.shared.disable()
                        }
                    }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Notifications").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text("Client messages, check-ins and bookings").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                }
                .tint(.green)
            }
            if let error { Text(error).font(.caption2).foregroundStyle(JK.secondary) }
        }
        .jkCard(padding: 12)
    }
}
