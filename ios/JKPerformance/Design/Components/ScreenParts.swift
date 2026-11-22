import SwiftUI

// Screen parts moved out of the screen files (atelier-spec.md, PHASE 1) so the
// later Today, Progress and Your week rebuilds can reuse or retire them in one
// place. Restyled onto the tokens; structure unchanged.

struct DayStrip: View {
    let days: [Date]
    @Binding var selected: Date
    /// "YYYY-MM-DD" days to underline with a dot.
    var marked: Set<String> = []

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days, id: \.self) { d in
                let on = Day.same(d, selected)
                Button {
                    selected = Day.start(d)
                } label: {
                    VStack(spacing: 2) {
                        Text(Fmt.weekday(d)).font(.jkMicro)
                        Text("\(Day.calendar.component(.day, from: d))").font(.jkCallout.weight(.semibold))
                        Circle()
                            .fill(marked.contains(Day.string(d)) ? (on ? JK.onPrimary : JK.textSecondary) : .clear)
                            .frame(width: 4, height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .foregroundStyle(on ? JK.onPrimary : JK.text)
                    .background(on ? AnyShapeStyle(JK.primaryFill) : AnyShapeStyle(JK.surface),
                                in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous).stroke(JK.hairline, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct UpcomingRow: View {
    let weekday: String
    let day: String
    let title: String
    let detail: String
    var chevron = true

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text(weekday.uppercased()).font(.jkMicro.weight(.semibold)).foregroundStyle(JK.textTertiary)
                Text(day).font(.jkHeadline).foregroundStyle(JK.text)
            }
            .frame(width: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.jkCallout.weight(.medium)).foregroundStyle(JK.text)
                Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            Spacer()
            if chevron { Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary) }
        }
        .padding(12)
    }
}

struct DeltaBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.jkCaption.weight(.semibold))
            .foregroundStyle(JK.textSecondary)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
    }
}

struct StatTile: View {
    let label: String
    let value: String
    var delta: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.jkMicro).foregroundStyle(JK.textTertiary)
            Text(value).font(.jkHeadline.weight(.semibold)).foregroundStyle(JK.text)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let delta {
                Text(delta).font(.jkMicro).foregroundStyle(JK.textTertiary)
            }
        }
        .jkCard(padding: 10)
    }
}

struct RatingCard: View {
    let title: String
    let hint: String?
    @Binding var value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
            if let hint { Text(hint).font(.jkCaption).foregroundStyle(JK.textTertiary) }
            HStack(spacing: 8) {
                ForEach(1...5, id: \.self) { n in
                    Button {
                        value = n
                    } label: {
                        Text("\(n)")
                            .font(.jkCallout.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .foregroundStyle(value == n ? JK.onPrimary : JK.text)
                            .background(value == n ? AnyShapeStyle(JK.primaryFill) : AnyShapeStyle(JK.raised),
                                        in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .jkCard()
    }
}
