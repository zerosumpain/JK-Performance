import SwiftUI

// MARK: - Schedule (week grid)

struct ScheduleView: View {
    enum Filter: String, CaseIterable {
        case all = "All", inperson = "1:1", video = "Video", group = "Group"
        func keeps(_ b: Booking) -> Bool {
            switch self {
            case .all: return true
            case .inperson: return b.kind == "inperson"
            case .video: return b.kind == "video"
            case .group: return b.kind == "group"
            }
        }
    }

    @State private var anchor = Day.start(Date())
    @State private var filter: Filter = .all
    @State private var bookings: [Booking]?
    @State private var error: String?
    @State private var booking = false
    @State private var editingAvailability = false
    @State private var openBooking: Booking?

    private let hours = Array(6...20)
    private let rowHeight: CGFloat = 34
    private var days: [Date] { Day.week(of: anchor) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenHeader(eyebrow: "Week of \(Fmt.dayMonth(days[0]))", title: "Schedule") {
                        HStack(spacing: 8) {
                            Button { editingAvailability = true } label: {
                                Image(systemName: "clock.badge.checkmark")
                                    .frame(width: 30, height: 30)
                                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.stroke, lineWidth: 1))
                            }
                            .foregroundStyle(JK.text)
                            .accessibilityLabel("Availability")
                            Button { booking = true } label: { Label("Book", systemImage: "plus") }
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(JK.chrome, in: Capsule())
                                .foregroundStyle(.black)
                        }
                    }
                    HStack {
                        Button { anchor = Day.add(-7, to: anchor) } label: { Image(systemName: "chevron.left") }
                        Spacer()
                        Button("This week") { anchor = Day.start(Date()) }.font(.caption)
                        Spacer()
                        Button { anchor = Day.add(7, to: anchor) } label: { Image(systemName: "chevron.right") }
                    }
                    .foregroundStyle(JK.secondary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(Filter.allCases, id: \.self) { f in
                                let count = (bookings ?? []).filter(f.keeps).count
                                Chip(label: f == .all ? "All · \(count)" : "\(f.rawValue) · \(count)", selected: filter == f) { filter = f }
                            }
                        }
                    }
                    if let error, bookings == nil {
                        ErrorCard(message: error) { await load() }
                    } else if bookings == nil {
                        LoadingCard()
                    } else {
                        if let error { ErrorBanner(message: error) }
                        grid
                        legend
                        Text("Tap a block for details. The clock button edits your weekly availability.")
                            .font(.caption2).foregroundStyle(JK.tertiary)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .task(id: Day.string(days[0])) { await load() }
            .navigationDestination(item: $openBooking) { b in
                if let c = b.client, !b.isGroup {
                    ClientDetailView(clientId: c.id, name: c.name)
                } else {
                    ClassDetailView(booking: b)
                }
            }
            .sheet(isPresented: $booking, onDismiss: { Task { await load() } }) {
                CoachBookSheet(day: Day.same(anchor, Date()) ? Date() : days[0])
            }
            .sheet(isPresented: $editingAvailability) { AvailabilitySheet() }
        }
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: 3) {
            VStack(spacing: 0) {
                Text(" ").font(.system(size: 9)).frame(height: 24)
                ForEach(hours, id: \.self) { h in
                    Text("\(h)").font(.system(size: 9)).foregroundStyle(JK.tertiary).frame(height: rowHeight, alignment: .top)
                }
            }
            .frame(width: 18)
            ForEach(days, id: \.self) { day in
                let today = Day.same(day, Date())
                VStack(spacing: 0) {
                    Text("\(Fmt.weekday(day).prefix(2)) \(Day.calendar.component(.day, from: day))")
                        .font(.system(size: 9, weight: today ? .bold : .regular))
                        .foregroundStyle(today ? Color.black : JK.tertiary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 20)
                        .background(today ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 5))
                        .padding(.bottom, 4)
                    ZStack(alignment: .top) {
                        VStack(spacing: 0) {
                            ForEach(hours, id: \.self) { _ in
                                Rectangle().fill(JK.stroke).frame(height: 1).frame(height: rowHeight, alignment: .top)
                            }
                        }
                        ForEach(blocks(on: day)) { b in
                            let start = hourOf(b.start), length = max(0.5, b.end.timeIntervalSince(b.start) / 3600)
                            Button { openBooking = b } label: {
                                Text(label(b))
                                    .font(.system(size: 8, weight: .semibold))
                                    .foregroundStyle(JK.text)
                                    .frame(maxWidth: .infinity, alignment: .topLeading)
                                    .padding(3)
                                    .frame(height: rowHeight * CGFloat(length) - 2, alignment: .top)
                                    .background(JK.slot(b.kind).opacity(0.24), in: RoundedRectangle(cornerRadius: 4))
                                    .overlay(alignment: .leading) {
                                        UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 4)
                                            .fill(JK.slot(b.kind)).frame(width: 2)
                                    }
                                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(JK.slot(b.kind).opacity(0.55), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .offset(y: rowHeight * CGFloat(start - Double(hours[0])))
                        }
                    }
                    .frame(height: rowHeight * CGFloat(hours.count), alignment: .top)
                    .clipped()
                }
            }
        }
    }

    /// The colour key for the kinds of session on the grid.
    private var legend: some View {
        HStack(spacing: 14) {
            ForEach([("inperson", "1:1 in person"), ("video", "Video call"), ("group", "Group class")], id: \.0) { item in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 2).fill(JK.slot(item.0)).frame(width: 10, height: 10)
                    Text(item.1).font(.caption2).foregroundStyle(JK.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func blocks(on day: Date) -> [Booking] {
        (bookings ?? []).filter { Day.same($0.start, day) && filter.keeps($0) }
    }

    private func hourOf(_ date: Date) -> Double {
        let c = Day.calendar.dateComponents([.hour, .minute], from: date)
        return Double(c.hour ?? 0) + Double(c.minute ?? 0) / 60
    }

    private func label(_ b: Booking) -> String {
        if b.isGroup { return "Grp" }
        if b.kind == "video" { return (b.client?.displayInitials ?? "") + " ☎︎" }
        return b.client?.displayInitials ?? (b.title ?? "1:1")
    }

    private func load() async {
        do {
            let reply: BookingsResponse = try await APIClient.shared.get("/api/bookings", query: [
                "from": Day.string(days[0]), "to": Day.string(days[6]),
            ])
            bookings = reply.bookings
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

// MARK: - Book: class or client session

private struct CoachBookSheet: View {
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
                                            Text(c.name).font(.subheadline).foregroundStyle(JK.text)
                                            Spacer()
                                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
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
                            .font(.subheadline).foregroundStyle(JK.text)
                        Stepper("\(minutes) minutes", value: $minutes, in: 15...180, step: 15)
                            .font(.subheadline).foregroundStyle(JK.text)
                        Stepper("Capacity \(capacity)", value: $capacity, in: 1...50)
                            .font(.subheadline).foregroundStyle(JK.text)
                        JKField(label: "Location", text: $location)
                        if let error { ErrorBanner(message: error) }
                        Button {
                            Task { await createClass() }
                        } label: {
                            if saving { ProgressView().tint(.black) } else { Text("Create class") }
                        }
                        .buttonStyle(ChromeButtonStyle())
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                        Text("Clients see every class you create and join for free.").font(.caption2).foregroundStyle(JK.tertiary)
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
private struct AvailabilitySheet: View {
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
                                        .foregroundStyle(JK.tertiary)
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
                            .buttonStyle(GhostButtonStyle())
                        Button {
                            Task { await save() }
                        } label: {
                            if saving { ProgressView().tint(.black) } else { Text("Save availability") }
                        }
                        .buttonStyle(ChromeButtonStyle())
                        .disabled(saving)
                        Text("Times are Europe/London. Existing bookings stay put.").font(.caption2).foregroundStyle(JK.tertiary)
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
