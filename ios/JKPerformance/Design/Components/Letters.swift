import SwiftUI

/// Three tabular numbers from the week, each with what it is made from on
/// tap. Shared by the letter and the coach's letter composer.
struct ScoreTrio: View {
    let scores: [Score]
    @State private var open: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            AdaptiveStack(verticalAlignment: .top, spacing: JK.Space.l) {
                ForEach(scores.prefix(3), id: \.key) { score in
                    Button {
                        open = open == score.key ? nil : score.key
                    } label: {
                        VStack(alignment: .leading, spacing: JK.Space.xs) {
                            Text(score.value)
                                .font(.jkNumberTile)
                                .foregroundStyle(JK.text)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                            Text(score.label).font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: JK.Size.touch, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityHint(score.source ?? "")
                }
            }
            if let key = open, let source = scores.first(where: { $0.key == key })?.source {
                Text(source)
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
    }
}

/// A row of seven WeekDots from "YYYY-MM-DD" day states, Monday first.
extension WeekDots.Entry {
    /// "M", "T"…
    static func initial(_ day: String) -> String {
        guard let d = Day.date(day) else { return "" }
        return String(Fmt.weekday(d).prefix(1))
    }

    static func name(_ day: String) -> String {
        guard let d = Day.date(day) else { return day }
        return Fmt.weekdayName(d)
    }

    init(day: String, done: Bool, rest: Bool, future: Bool, isToday: Bool) {
        let state: WeekDots.DayState = rest ? .rest : done ? .done : future ? .future : .notDone
        self.init(id: day, initial: Self.initial(day), name: Self.name(day), state: state, isToday: isToday)
    }
}
