import Charts
import SwiftUI

// MARK: - Progress

/// Named ProgressScreen because SwiftUI already owns `ProgressView`.
struct ProgressScreen: View {
    enum Span: String, CaseIterable { case threeMonths = "3M", sixMonths = "6M", all = "All" }
    @State private var range: Span = .threeMonths

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Since 3 Mar 2026", title: "Progress") {
                    Segmented(options: Span.allCases, selection: $range) { $0.rawValue }
                        .frame(width: 130)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top) {
                        Eyebrow(text: "Body weight")
                        Spacer()
                        DeltaBadge(text: "−4.1 kg")
                    }
                    (Text("78.4").font(.largeTitle.weight(.semibold)) + Text(" kg").font(.caption).foregroundColor(JK.tertiary))
                        .foregroundStyle(JK.text)
                    Chart(Mock.bodyWeight) { p in
                        AreaMark(x: .value("Day", p.day), y: .value("kg", p.kg))
                            .foregroundStyle(LinearGradient(colors: [JK.text.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Day", p.day), y: .value("kg", p.kg))
                            .foregroundStyle(JK.text)
                    }
                    .chartYScale(domain: 76...84)
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .frame(height: 90)
                }
                .jkCard()

                HStack(spacing: 8) {
                    StatTile(label: "Body fat", value: "16.2%", delta: "−2.4")
                    StatTile(label: "Waist", value: "82 cm", delta: "−5")
                    StatTile(label: "Resting HR", value: "54", delta: "−6")
                }

                Eyebrow(text: "Personal records", trailing: "All lifts")
                VStack(spacing: 0) {
                    ForEach(Mock.records) { pr in
                        HStack {
                            Image(systemName: "trophy").foregroundStyle(JK.secondary)
                            Text(pr.lift).font(.subheadline.weight(.medium))
                            Spacer()
                            VStack(alignment: .trailing, spacing: 0) {
                                Text("\(pr.kg) kg").font(.subheadline.weight(.semibold))
                                Text("+\(pr.gain) kg").font(.caption2).foregroundStyle(JK.tertiary)
                            }
                        }
                        .foregroundStyle(JK.text)
                        .padding(12)
                    }
                }
                .jkCard(padding: 2)

                HStack {
                    Eyebrow(text: "Progress photos")
                    Spacer()
                    Label("Private to you and Coach", systemImage: "lock").font(.caption2).foregroundStyle(JK.tertiary)
                }
                HStack(spacing: 8) {
                    ForEach(Mock.progressPhotoDates, id: \.self) { date in
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 10).fill(JK.cardRaised)
                            Image(systemName: "figure.stand").font(.system(size: 40)).foregroundStyle(JK.tertiary)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                            Text(date).font(.system(size: 9)).foregroundStyle(JK.secondary).padding(6)
                        }
                        .frame(height: 90)
                    }
                    Button {} label: {
                        Image(systemName: "camera")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    }
                    .foregroundStyle(JK.secondary)
                    .frame(height: 90)
                }
            }
            .padding(16)
        }
        .jkScreen()
    }
}

struct DeltaBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(JK.secondary)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
    }
}

struct StatTile: View {
    let label: String
    let value: String
    var delta: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 10)).foregroundStyle(JK.tertiary)
            Text(value).font(.title3.weight(.semibold)).foregroundStyle(JK.text)
            if let delta {
                Text(delta).font(.system(size: 10)).foregroundStyle(JK.tertiary)
            }
        }
        .jkCard(padding: 10)
    }
}

// MARK: - Challenges

struct ChallengesView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Community", title: "Challenges")
                VStack(alignment: .leading, spacing: 8) {
                    Text("12 days left")
                        .font(.caption2)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(JK.cardRaised, in: Capsule())
                        .foregroundStyle(JK.secondary)
                    Spacer().frame(height: 50)
                    Text("November 100 km").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Run, walk or row. 24 members taking part.").font(.caption).foregroundStyle(JK.secondary)
                    HStack {
                        ThinBar(fraction: 0.64, height: 4)
                        Text("64 km").font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                    }
                }
                .jkCard()

                Eyebrow(text: "Leaderboard", trailing: "This week")
                VStack(spacing: 0) {
                    ForEach(Mock.leaderboard) { row in
                        HStack(spacing: 12) {
                            Text("\(row.rank)").font(.subheadline.weight(.semibold)).foregroundStyle(row.isYou ? JK.tertiary : JK.text).frame(width: 18)
                            Avatar(initials: row.initials, size: 26)
                            Text(row.name).font(.subheadline.weight(.medium))
                            Spacer()
                            Text("\(row.km) km").font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(JK.text)
                        .padding(12)
                    }
                }
                .jkCard(padding: 2)

                HStack(spacing: 10) {
                    BadgeTile(systemName: "trophy", text: "3 badges")
                    BadgeTile(systemName: "flame", text: "12-day streak")
                }
            }
            .padding(16)
        }
        .jkScreen()
    }
}

private struct BadgeTile: View {
    let systemName: String
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            IconTile(systemName: systemName, size: 32)
            Text(text).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
        }
        .jkCard(padding: 10)
    }
}

// MARK: - Weekly check-in

struct WeeklyCheckInView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var energy = 4
    @State private var sleep = 3
    @State private var pain = "Knee"
    @State private var note = "Left knee tight after split squats, fine by Thursday."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("How did this week feel, \(Mock.clientName)?").font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Coach JK reviews these every Sunday evening.").font(.caption).foregroundStyle(JK.secondary)
                }
                RatingCard(title: "Energy levels", hint: "1 = drained, 5 = excellent", value: $energy)
                RatingCard(title: "Sleep quality", hint: nil, value: $sleep)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Any pain or niggles?").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(["None", "Knee", "Back", "Shoulder", "Other"], id: \.self) { p in
                                Chip(label: p, selected: pain == p) { pain = p }
                            }
                        }
                    }
                    TextField("Tell Coach JK more", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                        .font(.footnote)
                        .padding(10)
                        .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 8))
                }
                .jkCard()
                HStack {
                    Label("Add weekly photos", systemImage: "camera").font(.subheadline.weight(.medium))
                    Spacer()
                    Text("Optional").font(.caption2).foregroundStyle(JK.tertiary)
                }
                .foregroundStyle(JK.text)
                .jkCard()
                Button("Next") { dismiss() }.buttonStyle(ChromeButtonStyle())
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Weekly check-in")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Text("2 of 4").font(.caption2).foregroundStyle(JK.tertiary) }
        }
    }
}

private struct RatingCard: View {
    let title: String
    let hint: String?
    @Binding var value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
            if let hint { Text(hint).font(.caption2).foregroundStyle(JK.tertiary) }
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        value = n
                    } label: {
                        Text("\(n)")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(value == n ? Color.black : JK.text)
                            .background(value == n ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.cardRaised),
                                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .jkCard()
    }
}
