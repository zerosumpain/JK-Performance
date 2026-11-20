import SwiftUI

// MARK: - My calendar (Calendar tab root)

struct MyCalendarView: View {
    @State private var selected = 20
    private let weekdays = ["M", "T", "W", "T", "F", "S", "S"]
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
    /// November 2026 starts on a Sunday: six blanks before the 1st in a Monday-first grid.
    private let leadingBlanks = 6
    private let daysInMonth = 30

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(eyebrow: "My calendar", title: "November") {
                        HStack(spacing: 14) {
                            Image(systemName: "chevron.left")
                            Image(systemName: "chevron.right")
                        }
                        .foregroundStyle(JK.secondary)
                    }

                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(Array(weekdays.enumerated()), id: \.offset) { _, d in
                            Text(d).font(.caption2).foregroundStyle(JK.tertiary)
                        }
                        ForEach(0..<leadingBlanks, id: \.self) { _ in Color.clear.frame(height: 30) }
                        ForEach(1...daysInMonth, id: \.self) { day in
                            Button {
                                selected = day
                            } label: {
                                VStack(spacing: 2) {
                                    Text("\(day)")
                                        .font(.subheadline.weight(day == selected ? .bold : .regular))
                                        .foregroundStyle(day == selected ? Color.black : (day < 20 ? JK.tertiary : JK.text))
                                        .frame(width: 30, height: 30)
                                        .background(day == selected ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(Color.clear), in: Circle())
                                    Circle()
                                        .fill(Mock.sessionDays.contains(day) ? JK.secondary : .clear)
                                        .frame(width: 4, height: 4)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Eyebrow(text: "\(selected) November", trailing: "\(Mock.dayEvents.count) events")
                    ForEach(Mock.dayEvents) { event in
                        HStack(alignment: .top, spacing: 12) {
                            Text(event.time).font(.caption2).foregroundStyle(JK.tertiary).frame(width: 36, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(event.title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                    Spacer()
                                    Text(event.tag)
                                        .font(.system(size: 9, weight: .semibold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(JK.cardRaised, in: Capsule())
                                        .foregroundStyle(JK.secondary)
                                }
                                Text(event.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            .jkCard(padding: 12)
                        }
                    }
                    NavigationLink { BookSessionView() } label: {
                        Label("Request a session", systemImage: "plus")
                            .font(.subheadline)
                            .foregroundStyle(JK.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

// MARK: - Book a session

struct BookSessionView: View {
    enum Kind: String, CaseIterable { case inPerson = "1:1 · 60 min", video = "Video call · 30 min" }

    @Environment(\.dismiss) private var dismiss
    @State private var day = 25
    @State private var kind: Kind = .inPerson
    @State private var time = "11:00"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Eyebrow(text: "Session credits")
                    (Text("3").font(.largeTitle.weight(.semibold)) + Text(" of 4 left").font(.caption).foregroundColor(JK.secondary))
                        .foregroundStyle(JK.text)
                    Text("Elite plan · resets 1 Dec").font(.caption2).foregroundStyle(JK.tertiary)
                }
                .jkCard()

                DayStrip(days: Mock.bookingDays, selected: $day)
                Segmented(options: Kind.allCases, selection: $kind) { $0.rawValue }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(Mock.slots, id: \.time) { slot in
                        Button {
                            time = slot.time
                        } label: {
                            Text(slot.time)
                                .font(.subheadline.weight(.semibold))
                                .strikethrough(!slot.open)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .foregroundStyle(time == slot.time ? Color.black : (slot.open ? JK.text : JK.tertiary))
                                .background(time == slot.time ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.card),
                                            in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: slot.open ? [] : [3])))
                        }
                        .buttonStyle(.plain)
                        .disabled(!slot.open)
                    }
                }

                VStack(spacing: 10) {
                    HStack {
                        Text("Wed \(day) Nov · \(time)").font(.caption)
                        Spacer()
                        Text("Studio 2").font(.caption)
                    }
                    Divider().overlay(JK.stroke)
                    HStack {
                        Text("Uses 1 credit").font(.caption).foregroundStyle(JK.tertiary)
                        Spacer()
                        Label("Add to Calendar", systemImage: "calendar").font(.caption)
                    }
                }
                .foregroundStyle(JK.text)
                .jkCard()

                Button("Confirm booking") { dismiss() }.buttonStyle(ChromeButtonStyle())
                Text("Free cancellation up to 24h before")
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Book a session")
        .navigationBarTitleDisplayMode(.inline)
    }
}
