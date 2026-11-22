import SwiftUI

// MARK: - Book a session

/// Open slots from /api/slots, booked with POST /api/bookings. A coach passes
/// `client` to book on that client's behalf.
struct BookSessionView: View {
    enum Kind: String, CaseIterable {
        case inperson, video
        var label: String { self == .inperson ? "1:1 · in person" : "Video call" }
    }

    var client: PersonRef? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session
    @State private var day: Date
    @State private var kind: Kind = .inperson
    @State private var slots: [Slot]?
    @State private var chosen: Slot?
    @State private var error: String?
    @State private var booking = false
    @State private var bookError: String?

    init(client: PersonRef? = nil, initialDay: Date = Date()) {
        self.client = client
        _day = State(initialValue: Day.start(initialDay))
    }

    private var membership: Membership? { session.me?.membership }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let client {
                    HStack(spacing: 10) {
                        Avatar(initials: client.displayInitials, size: 34)
                        Text("Booking for \(client.name)").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    }
                    .jkCard()
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Eyebrow(text: "Session credits")
                        (Text("\(membership?.creditsLeft ?? 0)").font(.jkNumberHero)
                            + Text(" of \(membership?.creditsTotal ?? 0) left").font(.jkCaption).foregroundColor(JK.textSecondary))
                            .foregroundStyle(JK.text)
                        Text(creditLine).font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                    .jkCard()
                }

                HStack {
                    Button { day = max(Day.start(Date()), Day.add(-7, to: day)) } label: { Image(systemName: "chevron.left") }
                    Spacer()
                    Text("Week of \(Fmt.dayMonth(Day.weekStart(day)))").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    Spacer()
                    Button { day = Day.add(7, to: day) } label: { Image(systemName: "chevron.right") }
                }
                .foregroundStyle(JK.textSecondary)
                DayStrip(days: Day.week(of: day), selected: $day)
                Segmented(options: Kind.allCases, selection: $kind) { $0.label }

                if let error {
                    ErrorCard(message: error) { await loadSlots() }
                } else if let slots {
                    let upcoming = slots.filter { $0.start > Date() }
                    if upcoming.isEmpty {
                        EmptyCard(systemName: "clock", title: "No times this day", detail: "Try another day or session type.")
                    } else {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                            ForEach(upcoming) { slot in
                                let on = chosen?.start == slot.start
                                Button {
                                    chosen = slot
                                } label: {
                                    Text(Fmt.time(slot.start))
                                        .font(.jkCallout.weight(.semibold))
                                        .strikethrough(!slot.open)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 12)
                                        .foregroundStyle(on ? JK.onPrimary : (slot.open ? JK.text : JK.textTertiary))
                                        .background(on ? AnyShapeStyle(JK.primaryFill) : AnyShapeStyle(JK.surface),
                                                    in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous)
                                            .strokeBorder(JK.hairline, style: StrokeStyle(lineWidth: 1, dash: slot.open ? [] : [3])))
                                }
                                .buttonStyle(.plain)
                                .disabled(!slot.open)
                            }
                        }
                    }
                } else {
                    LoadingCard(text: "Finding times…")
                }

                VStack(spacing: 10) {
                    HStack {
                        Text(chosen.map { "\(Fmt.shortDay($0.start)) · \(Fmt.time($0.start))–\(Fmt.time($0.end))" } ?? "Pick a time")
                            .font(.jkCaption)
                        Spacer()
                        Text(chosen?.location ?? kind.label).font(.jkCaption)
                    }
                    Divider().overlay(JK.hairline)
                    HStack {
                        Text("Uses 1 credit").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        Spacer()
                        Text(kind.label).font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
                .foregroundStyle(JK.text)
                .jkCard()

                if let bookError { ErrorBanner(message: bookError) }
                Button {
                    Task { await book() }
                } label: {
                    if booking { ProgressView().tint(JK.onPrimary) } else { Text("Confirm booking") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(chosen == nil || booking)
                Text("Free cancellation up to 24h before")
                    .font(.jkCaption)
                    .foregroundStyle(JK.textTertiary)
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle(client == nil ? "Book a session" : "Book a client")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(Day.string(day))|\(kind.rawValue)") { await loadSlots() }
    }

    private var creditLine: String {
        guard let m = membership, m.isActive else { return "No membership · choose a plan under Account" }
        let reset = m.creditsResetOn.map { " · resets \(Fmt.dayMonth($0))" } ?? ""
        return "\(m.displayName) plan\(reset)"
    }

    private func loadSlots() async {
        chosen = nil
        slots = nil
        do {
            let day = Day.string(self.day)
            let reply: SlotsResponse = try await APIClient.shared.get("/api/slots", query: [
                "from": day, "to": day, "kind": kind.rawValue,
            ])
            slots = reply.slots.sorted { $0.start < $1.start }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func book() async {
        guard let chosen else { return }
        booking = true
        defer { booking = false }
        do {
            let _: Booking = try await APIClient.shared.send("POST", "/api/bookings",
                                                             body: BookingInput(start: chosen.start, kind: kind.rawValue, clientId: client?.id))
            await session.refreshMe()
            dismiss()
        } catch {
            bookError = error.readable
        }
    }
}
