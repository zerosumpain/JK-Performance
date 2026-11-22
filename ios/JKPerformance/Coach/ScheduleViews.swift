import SwiftUI

// MARK: - Day agenda

/// One day of sessions (atelier-spec.md, Coach screens 1): a time column with
/// a row per session, swipe or step between days, and Book. Replaces the
/// Schedule week grid; it opens from the strip on Today.
struct DayAgendaView: View {
    @Environment(AppSession.self) private var session
    @State private var day = Day.start(Date())
    @State private var bookings: [Booking]?
    @State private var error: String?
    @State private var booking = false
    @State private var editingAvailability = false

    private var sessions: [Booking] { (bookings ?? []).sorted { $0.start < $1.start } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                dayHeader
                if let error, bookings == nil {
                    ErrorCard(message: error) { await load() }
                } else if bookings == nil {
                    LoadingCard()
                } else {
                    if let error { ErrorBanner(message: error) }
                    agenda
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.vertical, JK.Space.l)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 40).onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                step(value.translation.width < 0 ? 1 : -1)
            })
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .navigationTitle("Agenda")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task(id: Day.string(day)) { await load() }
        .sheet(isPresented: $booking, onDismiss: { Task { await load() } }) {
            CoachBookSheet(day: Day.same(day, Date()) ? Date() : day)
        }
        .sheet(isPresented: $editingAvailability) { AvailabilityEditor() }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: JK.Space.m) {
                if session.studioTools {
                    Button { editingAvailability = true } label: { Image(systemName: "clock.badge.checkmark") }
                        .accessibilityLabel("Availability")
                }
                Button("Book") { booking = true }
            }
        }
    }

    private var dayHeader: some View {
        HStack(spacing: JK.Space.s) {
            Button { step(-1) } label: { Image(systemName: "chevron.left").frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch) }
                .accessibilityLabel("Previous day")
            VStack(spacing: 2) {
                Text(Fmt.fullDay(day)).font(.jkHeadline).foregroundStyle(JK.text)
                Text(summary).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            Button { step(1) } label: { Image(systemName: "chevron.right").frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch) }
                .accessibilityLabel("Next day")
        }
        .foregroundStyle(JK.textSecondary)
    }

    private var summary: String {
        if Day.same(day, Date()) {
            let done = sessions.filter { $0.end < Date() }.count
            return sessions.isEmpty ? "Today · nothing booked" : "Today · \(done) of \(sessions.count) sessions done"
        }
        return sessions.isEmpty ? "Nothing booked" : (sessions.count == 1 ? "1 session" : "\(sessions.count) sessions")
    }

    @ViewBuilder
    private var agenda: some View {
        if sessions.isEmpty {
            EmptyState(line: "Nothing booked. A quiet day.", actionTitle: "Book a session") { booking = true }
        } else {
            VStack(spacing: 0) {
                ForEach(sessions) { b in
                    NavigationLink { destination(b) } label: { DayAgendaRow(booking: b) }
                        .buttonStyle(.plain)
                    if b.id != sessions.last?.id { GroupDivider(inset: JK.Space.l + 52) }
                }
            }
            .surface(.group)
        }
    }

    @ViewBuilder
    private func destination(_ b: Booking) -> some View {
        if let c = b.client, !b.isGroup {
            ClientDetailView(clientId: c.id, name: c.name)
        } else {
            ClassDetailView(booking: b)
        }
    }

    private func step(_ days: Int) {
        day = Day.add(days, to: day)
    }

    private func load() async {
        let key = Day.string(day)
        do {
            let reply: BookingsResponse = try await APIClient.shared.get("/api/bookings", query: ["from": key, "to": key])
            guard key == Day.string(day) else { return }
            bookings = reply.bookings.filter { Day.same($0.start, day) }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// A time, then avatar, name, kind glyph and place.
struct DayAgendaRow: View {
    let booking: Booking

    private var done: Bool { booking.end < Date() }
    private var who: String {
        if booking.isGroup {
            let count = booking.attendeeCount ?? booking.attendees?.count ?? 0
            return "\(booking.title ?? "Class") · \(count) going"
        }
        return booking.client?.name ?? booking.title ?? booking.kindLabel
    }

    private var kind: IconKey {
        switch booking.kind {
        case "video": return .video
        case "group": return .group
        default: return .oneToOne
        }
    }

    var body: some View {
        HStack(spacing: JK.Space.m) {
            VStack(alignment: .leading, spacing: 0) {
                Text(Fmt.time(booking.start)).font(.jkCallout.monospacedDigit())
                Text(Fmt.time(booking.end)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
            }
            .frame(minWidth: 44, alignment: .leading)
            .foregroundStyle(JK.text)
            Avatar(initials: booking.client?.displayInitials ?? "G", size: JK.Size.avatarSmall)
            VStack(alignment: .leading, spacing: 2) {
                Text(who).font(.jkCallout).foregroundStyle(JK.text)
                HStack(spacing: JK.Space.xs) {
                    Icon(key: kind, size: 13, label: kind.accessibilityName).foregroundStyle(JK.textSecondary)
                    Text([booking.kindLabel, booking.location].compactMap { $0 }.joined(separator: " · "))
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if done {
                Icon(key: .done, size: 15, label: "Done").foregroundStyle(JK.textSecondary)
            }
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.m)
        .opacity(done ? 0.7 : 1)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Book: class or client session

struct CoachBookSheet: View {
    enum Mode: String, CaseIterable { case client = "Book a client", group = "Create a class" }

    let day: Date
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .client
    @State private var clients: [ClientSummary]?
    @State private var error: String?
    @State private var title = "Conditioning · Group"
    @State private var start = Date()
    @State private var minutes = 60
    @State private var capacity = 8
    @State private var location = "Studio 2"
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Segmented(options: Mode.allCases, selection: $mode) { $0.rawValue }
                    if mode == .client {
                        if let clients {
                            VStack(spacing: 0) {
                                ForEach(clients) { c in
                                    NavigationLink {
                                        BookSessionView(client: PersonRef(id: c.id, name: c.name, initials: c.initials), initialDay: day)
                                    } label: {
                                        HStack(spacing: 10) {
                                            Avatar(initials: c.displayInitials, size: 28)
                                            Text(c.name).font(.jkCallout).foregroundStyle(JK.text)
                                            Spacer()
                                            Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
                                        }
                                        .padding(10)
                                    }
                                }
                            }
                            .jkCard(padding: 2)
                        } else if let error {
                            ErrorCard(message: error) { await loadClients() }
                        } else {
                            LoadingCard()
                        }
                    } else {
                        JKField(label: "Title", text: $title)
                        DatePicker("Starts", selection: $start, in: Date()...)
                            .font(.jkCallout).foregroundStyle(JK.text)
                        Stepper("\(minutes) minutes", value: $minutes, in: 15...180, step: 15)
                            .font(.jkCallout).foregroundStyle(JK.text)
                        Stepper("Capacity \(capacity)", value: $capacity, in: 1...50)
                            .font(.jkCallout).foregroundStyle(JK.text)
                        JKField(label: "Location", text: $location)
                        if let error { ErrorBanner(message: error) }
                        Button {
                            Task { await createClass() }
                        } label: {
                            if saving { ProgressView().tint(JK.onPrimary) } else { Text("Create class") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                        Text("Clients see every class you create and join for free.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                start = Day.at(day, time: "17:00") ?? day
                if start < Date() { start = Date().addingTimeInterval(3600) }
                await loadClients()
            }
        }
    }

    private func loadClients() async {
        do {
            let reply: ClientsResponse = try await APIClient.shared.get("/api/coach/clients")
            clients = reply.clients
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func createClass() async {
        saving = true
        defer { saving = false }
        do {
            let _: Booking = try await APIClient.shared.send("POST", "/api/classes", body: ClassInput(
                title: title, start: start, end: start.addingTimeInterval(Double(minutes) * 60),
                capacity: capacity, location: location))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Availability

/// Weekly availability rules (weekday, start, end, kind). The server cuts
/// them into bookable slots.
struct AvailabilityEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var rules: [AvailabilityRule]?
    @State private var error: String?
    @State private var saving = false

    private let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    private let kinds = ["inperson", "video"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let error { ErrorBanner(message: error) }
                    if let rules {
                        if rules.isEmpty {
                            EmptyCard(systemName: "clock", title: "No availability", detail: "Clients can't book until you add hours.")
                        }
                        ForEach(Binding(get: { self.rules ?? [] }, set: { self.rules = $0 })) { $rule in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Picker("Day", selection: $rule.weekday) {
                                        ForEach(1...7, id: \.self) { d in Text(weekdays[d - 1]).tag(d) }
                                    }
                                    .pickerStyle(.menu)
                                    Spacer()
                                    Button(role: .destructive) {
                                        self.rules?.removeAll { $0.localId == rule.localId }
                                    } label: { Image(systemName: "trash") }
                                        .buttonStyle(.plain)
                                        .foregroundStyle(JK.textTertiary)
                                }
                                HStack(spacing: 8) {
                                    JKField(label: "Start", text: $rule.start, prompt: "07:00", keyboard: .numbersAndPunctuation)
                                    JKField(label: "End", text: $rule.end, prompt: "19:00", keyboard: .numbersAndPunctuation)
                                    JKField(label: "Slot min", text: Binding(get: { "\(rule.slotMinutes)" },
                                                                             set: { rule.slotMinutes = Int($0) ?? rule.slotMinutes }),
                                            keyboard: .numberPad)
                                        .frame(width: 64)
                                }
                                Segmented(options: kinds, selection: $rule.kind) { $0 == "inperson" ? "In person" : "Video" }
                                JKField(label: "Location", text: Binding(get: { rule.location ?? "" },
                                                                         set: { rule.location = $0.isEmpty ? nil : $0 }),
                                        prompt: rule.kind == "video" ? "Video call" : "Studio 2")
                            }
                            .jkCard()
                        }
                        Button {
                            let last = self.rules?.last
                            self.rules?.append(AvailabilityRule(weekday: min((last?.weekday ?? 0) + 1, 7), start: last?.start ?? "07:00",
                                                                end: last?.end ?? "19:00", kind: last?.kind ?? "inperson",
                                                                slotMinutes: last?.slotMinutes ?? 60, location: last?.location))
                        } label: { Label("Add hours", systemImage: "plus") }
                            .buttonStyle(SecondaryButtonStyle())
                        Button {
                            Task { await save() }
                        } label: {
                            if saving { ProgressView().tint(JK.onPrimary) } else { Text("Save availability") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(saving)
                        Text("Times are Europe/London. Existing bookings stay put.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    } else {
                        LoadingCard()
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle("Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            let reply: RulesPayload = try await APIClient.shared.get("/api/availability")
            rules = reply.rules.sorted { ($0.weekday, $0.start) < ($1.weekday, $1.start) }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func save() async {
        guard let rules else { return }
        saving = true
        defer { saving = false }
        do {
            let _: RulesPayload = try await APIClient.shared.send("PUT", "/api/availability", body: RulesPayload(rules: rules))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}
