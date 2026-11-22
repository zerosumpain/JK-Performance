import PhotosUI
import Charts
import SwiftUI

// MARK: - Today (coach tab root)

struct CoachTodayView: View {
    @Environment(AppSession.self) private var session
    @State private var data: NeedsYou?
    @State private var error: String?
    @State private var showAccount = false
    @State private var lettersOnly = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xl) {
                    header
                    Loadable(value: data, error: error, retry: load) { d in
                        NeedsYouList(data: d, lettersOnly: $lettersOnly)
                    }
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.vertical, JK.Space.l)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showAccount) { CoachAccountView() }
            .task { await load() }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(Fmt.fullDay(Date())).font(.jkCaption).foregroundStyle(JK.textSecondary)
                Text("\(Fmt.greeting()), \(Fmt.firstWord(session.me?.name ?? "Coach"))")
                    .jkText(.display)
                    .foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: JK.Space.s)
            Button { showAccount = true } label: {
                Avatar(initials: Fmt.initials(session.me?.name ?? "Coach"), mediaId: session.me?.coachSettings?.avatarMediaId)
                    .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Account")
        }
    }

    private func load() async {
        do {
            data = try await APIClient.shared.get("/api/coach/needs-you")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
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
                    Text(booking.title ?? booking.kindLabel).font(.jkDisplay).foregroundStyle(JK.text)
                    Text("\(Fmt.longDay(booking.start)) · \(Fmt.time(booking.start))–\(Fmt.time(booking.end))")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                    if let location = booking.location { Text(location).font(.jkCaption).foregroundStyle(JK.textTertiary) }
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
                                Text(p.name).font(.jkCallout).foregroundStyle(JK.text)
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
                        .buttonStyle(SecondaryButtonStyle())
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
                                            Text(item.client.name).font(.jkCallout.weight(.semibold))
                                            Text(item.reason).font(.jkCaption).foregroundStyle(JK.textTertiary)
                                        }
                                        Spacer()
                                        Image(systemName: Self.icon(item.kind)).font(.jkCaption).foregroundStyle(JK.textSecondary)
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
            Text(Fmt.pounds(b.mrrPence)).font(.jkNumberHero).foregroundStyle(JK.text)
            if points.count >= 2 {
                let values = points.map(\.1)
                let span = max((values.max() ?? 0) - (values.min() ?? 0), 1)
                let low = (values.min() ?? 0) - span * 0.1, high = (values.max() ?? 0) + span * 0.1
                Chart(points, id: \.0) { pt in
                    LineMark(x: .value("Day", pt.0), y: .value("£", pt.1)).foregroundStyle(JK.data)
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
                Glyph(systemName: "tag")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Plans & prices").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Names, prices, credits and what each plan includes").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            .jkCard(padding: 12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Clients (coach tab root)

struct ClientsView: View {
    @Environment(AppSession.self) private var session
    @State private var clients: [ClientSummary]?
    @State private var error: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .bottom) {
                        Text("Clients").jkText(.display).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                        Spacer()
                        if session.studioTools {
                            NavigationLink { ProgramsView() } label: { Text("Programs") }
                                .buttonStyle(SmallPillStyle())
                        }
                    }
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.textTertiary)
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
            if let title { CoachSectionTitle(title, trailing: "\(list.count)") }
            VStack(spacing: 0) {
                ForEach(list) { c in
                    NavigationLink { ClientDetailView(clientId: c.id, name: c.name) } label: {
                        ClientRow(client: c)
                    }
                    .buttonStyle(.plain)
                    if c.id != list.last?.id { GroupDivider(inset: JK.Space.l + JK.Size.avatar + JK.Space.m) }
                }
            }
            .surface(.group)
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
        HStack(spacing: JK.Space.m) {
            Avatar(initials: client.displayInitials)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                HStack(spacing: JK.Space.s) {
                    Text(client.name).font(.jkCallout).foregroundStyle(JK.text)
                    if let unread = client.unread, unread > 0 {
                        Icon(key: .unread, filled: true, size: 13, label: "Unread message").foregroundStyle(JK.textSecondary)
                    }
                }
                Text(ClientText.reason(client))
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .lineLimit(1)
                if let week = client.habitWeek, !week.isEmpty {
                    ClientWeekDots(week: week).frame(maxWidth: 160, alignment: .leading)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: IconKey.chevron.symbol).font(.jkCaption).foregroundStyle(JK.textSecondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.m)
        .contentShape(Rectangle())
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
        case "message", "form", "checkin": return JK.attention
        default: return nil
        }
    }

    /// Why they're where they are: "Sent you a message · 2 hr. ago", else the usual plan line.
    static func reason(_ c: ClientSummary) -> String {
        guard let d = c.demand, let reason = d.reason else { return line(c) }
        if let at = d.at, ["urgent", "message", "form", "checkin"].contains(d.kind) { return "\(reason) · \(Fmt.relative(at))" }
        return reason
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
                            .font(.jkCaption.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(JK.primaryFill, in: Capsule())
                            .foregroundStyle(JK.onPrimary)
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
            RoundedRectangle(cornerRadius: JK.Radius.control).fill(JK.raised).frame(width: 52, height: 52)
                .overlay(Image(systemName: "chart.xyaxis.line").foregroundStyle(JK.textSecondary))
            VStack(alignment: .leading, spacing: 4) {
                Text(p.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(p.daysPerWeek) days / week · \(p.weeks) weeks · \(p.workouts.count) workouts")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
                Text(p.clientCount.map { $0 == 1 ? "1 client" : "\($0) clients" } ?? "Template")
                    .font(.jkMicro.weight(.medium))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(JK.raised, in: Capsule())
                    .foregroundStyle(JK.textSecondary)
            }
            Spacer()
            Menu {
                Button { editing = ProgramDraft(p) } label: { Label("Edit", systemImage: "pencil") }
                Button { assigning = p } label: { Label("Assign to client", systemImage: "person.badge.plus") }
            } label: {
                Image(systemName: "ellipsis").frame(width: 30, height: 30).foregroundStyle(JK.textSecondary)
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
                    .font(.jkCaption)
                    .foregroundStyle(JK.text)

                    Eyebrow(text: "Workouts", trailing: "Day offset from the start date")
                    ForEach($draft.workouts) { $w in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                JKField(label: "Title", text: $w.title, prompt: "Lower Body Strength")
                                Stepper("Day \(w.dayOffset + 1)", value: $w.dayOffset, in: 0...(draft.weeks * 7 - 1))
                                    .font(.jkCaption).frame(width: 150)
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
                        .buttonStyle(SecondaryButtonStyle())

                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(draft.programId == nil ? "Create program" : "Save program") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty)
                    if draft.programId != nil {
                        Button("Delete program", role: .destructive) { confirmDelete = true }
                            .buttonStyle(SecondaryButtonStyle())
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
            Text("No exercises yet.").font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        ForEach(Array(items.enumerated()), id: \.element.localId) { index, item in
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(item.exerciseName.isEmpty ? item.exerciseId : item.exerciseName)
                        .font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    if item.id == nil {
                        Text("New")
                            .font(.jkMicro.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(JK.text, in: Capsule())
                            .foregroundStyle(JK.onPrimary)
                    }
                    Spacer()
                    Button { move(index, by: -1) } label: { Image(systemName: "arrow.up") }
                        .disabled(index == 0)
                    Button { move(index, by: 1) } label: { Image(systemName: "arrow.down") }
                        .disabled(index == items.count - 1)
                    Button(role: .destructive) { items.remove(at: index) } label: { Image(systemName: "trash") }
                }
                .font(.jkCaption)
                .foregroundStyle(JK.textSecondary)
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
            .background(JK.raised.opacity(0.5), in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
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
                    Text(program.name).font(.jkHeadline.weight(.semibold)).foregroundStyle(JK.text)
                    DatePicker("Start date", selection: $start, displayedComponents: .date)
                        .font(.jkCallout).foregroundStyle(JK.text)
                    Eyebrow(text: "Client")
                    if let clients {
                        VStack(spacing: 0) {
                            ForEach(clients) { c in
                                Button { clientId = c.id } label: {
                                    HStack(spacing: 10) {
                                        Avatar(initials: c.displayInitials, size: 28)
                                        Text(c.name).font(.jkCallout).foregroundStyle(JK.text)
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
                            .font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await assign() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(created == nil ? "Assign" : "Done") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
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

/// The coach's library of tips (the old Guides tab, now a row in Account).
struct GuidesView: View {
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
        Group {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach library", title: "Hints & guides")
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.textTertiary)
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
                            Text("Nothing matches.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        ForEach(tips) { tip in
                            Button { open = tip } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Glyph(systemName: symbol(tip.icon ?? "lightbulb", fallback: "lightbulb"), size: 32)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(tip.title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                                        Text(tip.body).font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(3)
                                            .multilineTextAlignment(.leading)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .jkCard(padding: 12)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .navigationTitle("Hints & guides")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(item: $open) { g in
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        Eyebrow(text: ([g.minutes.map { "\($0) min" }] + g.tags.map { Optional($0) }).compactMap { $0 }.joined(separator: " · "))
                        Text(g.title).font(.jkLetterHeadline).foregroundStyle(JK.text)
                        Text(g.body).font(.jkBody).foregroundStyle(JK.textSecondary)
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
                Rectangle().fill(JK.raised).frame(height: 110)
                    .overlay(Image(systemName: "book.pages").font(.largeTitle).foregroundStyle(JK.textTertiary))
                if let first = g.tags.first {
                    Text(first)
                        .font(.jkMicro.weight(.semibold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(JK.surface, in: Capsule())
                        .foregroundStyle(JK.textSecondary)
                        .padding(8)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: "Featured guide" + (g.minutes.map { " · \($0) min" } ?? ""))
                Text(g.title).font(.jkHeadline).foregroundStyle(JK.text).multilineTextAlignment(.leading)
                Text(g.body).font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(3).multilineTextAlignment(.leading)
            }
            .padding(14)
        }
        .background(JK.surface)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.hairline, lineWidth: 1))
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

/// The coach's account (atelier-spec.md, Coach screens 6): the web desk,
/// preview as a client, notifications, studio tools, letter rhythm, the two
/// reply lines, portrait, a one-line pulse. The desk-only editors (Programs,
/// Forms, Autoflows, Plans & prices, Business, availability) appear here only
/// with "Show studio tools" on; nothing is deleted in this release.
struct CoachAccountView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false
    @State private var showDesk = false
    @State private var switchError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xl) {
                    identity
                    PulseLine()
                    group {
                        Button { showDesk = true } label: { CoachRowLabel(icon: .settings, title: "Open the web desk", detail: "Programmes, forms and prices live there") }
                            .buttonStyle(.plain)
                        GroupDivider()
                        Button { Task { await previewAsClient() } } label: {
                            CoachRowLabel(icon: .clients, title: "Preview as client", detail: "Look round as the demo client, Sam Carter")
                        }
                        .buttonStyle(.plain)
                        GroupDivider()
                        NavigationLink { GuidesView() } label: { CoachRowLabel(icon: .guide, title: "Hints & guides") }
                            .buttonStyle(.plain)
                    }
                    if let switchError { ErrorBanner(message: switchError) }
                    CoachNotificationsRow()
                    StudioToolsRow()
                    if session.studioTools { studioTools }
                    RhythmSection(settings: session.me?.coachSettings)
                    ReplyLinesSection(settings: session.me?.coachSettings)
                    PortraitRow()
                    CalendarSubscribeCard()
                    WebSessionsRow()
                    group {
                        Link(destination: APIClient.shared.privacyURL) {
                            CoachRowLabel(icon: .lock, title: "Privacy policy", chevron: false)
                        }
                    }
                    Button("Sign out") { confirmSignOut = true }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.vertical, JK.Space.l)
            }
            .jkScreen()
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $showDesk) { WebDeskSheet() }
            .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private var identity: some View {
        HStack(spacing: JK.Space.m) {
            CoachAvatar(coach: PersonRef(id: session.me?.id ?? "", name: session.me?.name ?? "Coach",
                                         avatarMediaId: session.me?.coachSettings?.avatarMediaId),
                        size: JK.Size.avatar + JK.Space.m)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.me?.name ?? "Coach").font(.jkHeadline).foregroundStyle(JK.text)
                Text(session.me?.email ?? "Coach account").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
    }

    private var studioTools: some View {
        group {
            NavigationLink { ProgramsView() } label: { CoachRowLabel(icon: .workout, title: "Programs, autoflows and forms") }
                .buttonStyle(.plain)
            GroupDivider()
            NavigationLink { PlansPricesView() } label: { CoachRowLabel(icon: .settings, title: "Plans & prices") }
                .buttonStyle(.plain)
            GroupDivider()
            NavigationLink { BusinessView() } label: { CoachRowLabel(icon: .progress, title: "Business") }
                .buttonStyle(.plain)
            GroupDivider()
            NavigationLink { AvailabilityScreen() } label: { CoachRowLabel(icon: .week, title: "Availability") }
                .buttonStyle(.plain)
        }
    }

    private func group<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }.surface(.group)
    }

    private func previewAsClient() async {
        do {
            dismiss()
            try await session.switchToDemoClient()
        } catch {
            switchError = error.readable
        }
    }
}

/// "Show studio tools": the desk editors on the phone. Off by default.
private struct StudioToolsRow: View {
    @Environment(AppSession.self) private var session
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Toggle(isOn: Binding(get: { session.studioTools }, set: { on in Task { await set(on) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Show studio tools").font(.jkCallout).foregroundStyle(JK.text)
                    Text("Programs, forms, autoflows, plans and prices, business and availability on the phone. They stay on the web desk either way.")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            .tint(JK.accentControl)
            .disabled(busy)
            if let error { Text(error).font(.jkCaption).foregroundStyle(JK.textSecondary) }
        }
        .surface(.card, padding: JK.Space.l)
    }

    private func set(_ on: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await session.updateCoachSettings(CoachSettingsPatch(studioTools: on))
            error = nil
        } catch {
            self.error = error.readable
        }
    }
}

/// Letter rhythm per plan, as set on the desk.
private struct RhythmSection: View {
    let settings: CoachSettings?

    private let plans: [(id: String, name: String)] = [("elite", "Elite"), ("performance", "Performance"), ("foundation", "Foundation"), ("none", "Free")]

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            CoachSectionTitle("Letter rhythm")
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                ForEach(plans, id: \.id) { plan in
                    HStack {
                        Text(plan.name).font(.jkCallout).foregroundStyle(JK.text)
                        Spacer()
                        Text(line(settings?.letterRhythm?[plan.id])).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    .frame(minHeight: JK.Size.touch)
                }
            }
            .surface(.card, padding: JK.Space.l)
            Text("Per client, a letter can go fortnightly from their page on the desk.")
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    private func line(_ r: RhythmSetting?) -> String {
        guard let r, r.every != "none" else { return "No letters" }
        let every = r.every == "fortnightly" ? "Fortnightly" : "Weekly"
        return r.media == true ? "\(every), with a voice or video note" : "\(every), written"
    }
}

/// The two reply lines clients see under JK's name.
private struct ReplyLinesSection: View {
    @Environment(AppSession.self) private var session
    let settings: CoachSettings?
    @State private var standard = ""
    @State private var priority = ""
    @State private var busy = false
    @State private var notice: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            CoachSectionTitle("Reply lines")
            VStack(alignment: .leading, spacing: JK.Space.m) {
                JKField(label: "Standard", text: $standard, prompt: "JK replies most evenings")
                JKField(label: "Plans with priority replies", text: $priority, prompt: "Same-day replies")
                if let notice { Text(notice).font(.jkCaption).foregroundStyle(JK.textSecondary) }
                Button("Save reply lines") { Task { await save() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(busy || standard.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .surface(.card, padding: JK.Space.l)
        }
        .onAppear {
            standard = settings?.replyExpectation?.standard ?? "JK replies most evenings"
            priority = settings?.replyExpectation?.priority ?? "Same-day replies"
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let lines = ReplyExpectation(standard: standard.trimmingCharacters(in: .whitespaces),
                                         priority: priority.trimmingCharacters(in: .whitespaces))
            try await session.updateCoachSettings(CoachSettingsPatch(replyExpectation: lines))
            notice = "Saved."
        } catch {
            notice = error.readable
        }
    }
}

/// JK's portrait: the JK tab, From JK on Today, letters. Black and white sits best.
private struct PortraitRow: View {
    @Environment(AppSession.self) private var session
    @State private var picked: PhotosPickerItem?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            PhotosPicker(selection: $picked, matching: .images) {
                CoachRowLabel(icon: .photos, title: busy ? "Uploading…" : "Change portrait",
                              detail: "Shown on the JK tab, Today and letters")
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .surface(.group)
            if let error { ErrorBanner(message: error) }
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        busy = true
        defer {
            busy = false
            picked = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = Self.portraitJPEG(image) else {
                error = "Couldn't read that photo."
                return
            }
            let _: Media = try await APIClient.shared.upload("/api/media", data: jpeg, contentType: "image/jpeg",
                                                            query: ["purpose": "avatar"])
            await session.refreshMe()
            error = nil
        } catch {
            self.error = error.readable
        }
    }
}

extension PortraitRow {
    /// A square-ish portrait, at most 1024 px on the long side, as JPEG.
    static func portraitJPEG(_ image: UIImage) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > 1024 ? 1024 / longest : 1
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: 0.85)
    }
}

/// "12 active · £1,840 a month", from the business figures.
private struct PulseLine: View {
    @State private var business: Business?

    var body: some View {
        Text(line)
            .font(.jkCallout.monospacedDigit())
            .foregroundStyle(JK.textSecondary)
            .task { business = try? await APIClient.shared.get("/api/coach/business", query: ["period": "month"]) }
    }

    private var line: String {
        guard let b = business else { return " " }
        return "\(b.active) active · \(Fmt.pounds(b.mrrPence)) a month"
    }
}

/// Weekly availability, pushed from Account when studio tools are on.
struct AvailabilityScreen: View {
    @State private var open = false

    var body: some View {
        CoachSubpage(title: "Availability") {
            Text("Weekly hours clients can book. The web desk has the same editor.")
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
            Button("Edit availability") { open = true }.buttonStyle(PrimaryButtonStyle())
        }
        .sheet(isPresented: $open) { AvailabilityEditor() }
    }
}

/// Browsers signed in to the coach desk, and a button to sign them all out.
private struct WebSessionsRow: View {
    struct Sessions: Decodable { let count: Int; var latestSignIn: Date? }
    @State private var sessions: Sessions?
    @State private var busy = false

    var body: some View {
        HStack(spacing: 12) {
            Glyph(systemName: "desktopcomputer")
            VStack(alignment: .leading, spacing: 2) {
                Text("Coach desk on the web").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            Spacer()
            if (sessions?.count ?? 0) > 0 {
                Button("Sign out all") { Task { await endAll() } }
                    .font(.jkCaption.weight(.semibold))
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
                Glyph(systemName: "bell")
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
                        Text("Notifications").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                        Text("Client messages, check-ins and bookings").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
                .tint(JK.accentControl)
            }
            if let error { Text(error).font(.jkCaption).foregroundStyle(JK.textSecondary) }
        }
        .jkCard(padding: 12)
    }
}
