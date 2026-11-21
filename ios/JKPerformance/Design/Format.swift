import SwiftUI

/// Calendar days as the API speaks them: "YYYY-MM-DD" in the phone's local day.
enum Day {
    /// Monday-first Gregorian calendar in the phone's time zone.
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        c.locale = Locale(identifier: "en_GB")
        c.timeZone = .current
        return c
    }()

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func date(_ string: String) -> Date? { formatter.date(from: String(string.prefix(10))) }
    static var today: String { string(Date()) }

    static func start(_ date: Date) -> Date { calendar.startOfDay(for: date) }
    static func add(_ days: Int, to date: Date) -> Date { calendar.date(byAdding: .day, value: days, to: date) ?? date }

    /// Monday of the week holding `date`.
    static func weekStart(_ date: Date) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? start(date)
    }

    static func week(of date: Date) -> [Date] {
        let monday = weekStart(date)
        return (0..<7).map { add($0, to: monday) }
    }

    static func monthStart(_ date: Date) -> Date {
        calendar.dateInterval(of: .month, for: date)?.start ?? start(date)
    }

    static func same(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }

    /// 1 = Monday … 7 = Sunday (the API's weekday numbering).
    static func isoWeekday(_ date: Date) -> Int {
        let w = calendar.component(.weekday, from: date) // 1 = Sunday
        return w == 1 ? 7 : w - 1
    }

    /// `date` at "HH:mm".
    static func at(_ date: Date, time: String) -> Date? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        return calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: date)
    }
}

/// Display formatting, en-GB.
enum Fmt {
    private static func make(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = .current
        f.setLocalizedDateFormatFromTemplate(format)
        return f
    }

    private static let longDayF = make("EEEE d MMM")
    private static let shortDayF = make("EEE d MMM")
    private static let dayMonthF = make("d MMM")
    private static let dayMonthYearF = make("d MMM yyyy")
    private static let monthYearF = make("MMM yyyy")
    private static let monthNameF = make("MMMM")
    private static let weekdayShortF = make("EEE")
    private static let hourMinuteF: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = .current
        f.dateFormat = "HH:mm"
        return f
    }()

    static func longDay(_ d: Date) -> String { longDayF.string(from: d).replacingOccurrences(of: ",", with: "") }
    static func shortDay(_ d: Date) -> String { shortDayF.string(from: d).replacingOccurrences(of: ",", with: "") }
    static func dayMonth(_ d: Date) -> String { dayMonthF.string(from: d) }
    static func dayMonthYear(_ d: Date) -> String { dayMonthYearF.string(from: d) }
    static func monthYear(_ d: Date) -> String { monthYearF.string(from: d) }
    static func month(_ d: Date) -> String { monthNameF.string(from: d) }
    static func weekday(_ d: Date) -> String { weekdayShortF.string(from: d) }
    static func time(_ d: Date) -> String { hourMinuteF.string(from: d) }

    /// "2026-12-01" → "1 Dec", or the input if it doesn't parse.
    static func dayMonth(_ s: String?) -> String {
        guard let s, let d = Day.date(s) else { return s ?? "" }
        return dayMonth(d)
    }

    static func pounds(_ pence: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "GBP"
        f.locale = Locale(identifier: "en_GB")
        f.maximumFractionDigits = pence % 100 == 0 ? 0 : 2
        f.minimumFractionDigits = pence % 100 == 0 ? 0 : 2
        return f.string(from: NSNumber(value: Double(pence) / 100)) ?? "£\(pence / 100)"
    }

    /// 2.0 → "2", 2.15 → "2.2", 8420 → "8,420".
    static func number(_ value: Double, digits: Int = 1) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_GB")
        f.maximumFractionDigits = digits
        f.minimumFractionDigits = 0
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Signed delta: "−4.1", "+12".
    static func delta(_ value: Double, digits: Int = 1) -> String {
        let n = number(abs(value), digits: digits)
        if value < 0 { return "−" + n }
        if value > 0 { return "+" + n }
        return n
    }

    static func initials(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }

    static func minutes(_ total: Double) -> String {
        let m = Int(total.rounded())
        return "\(m / 60)h \(String(format: "%02d", m % 60))m"
    }

    /// "32 min", or "1h 05m" from an hour.
    static func duration(_ minutes: Double) -> String {
        let m = Int(minutes.rounded())
        return m < 60 ? "\(m) min" : "\(m / 60)h \(String(format: "%02d", m % 60))m"
    }

    static func relative(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: Date())
    }

    /// "in 2h 16m" until a future instant.
    static func countdown(to date: Date) -> String? {
        let seconds = Int(date.timeIntervalSinceNow)
        guard seconds > 0 else { return nil }
        let h = seconds / 3600, m = (seconds % 3600) / 60
        return h > 0 ? "in \(h)h \(m)m" : "in \(m)m"
    }

    static func greeting(_ date: Date = Date()) -> String {
        switch Day.calendar.component(.hour, from: date) {
        case 5..<12: return "Morning"
        case 12..<18: return "Afternoon"
        default: return "Evening"
        }
    }

    static func planName(_ id: String?) -> String {
        guard let id, id != "none" else { return "No plan" }
        return id.prefix(1).uppercased() + id.dropFirst()
    }
}

/// An SF Symbol, or a fallback when the server names one that doesn't exist.
func symbol(_ name: String, fallback: String = "checkmark.circle") -> String {
    UIImage(systemName: name) != nil ? name : fallback
}

// MARK: - Loading, empty and error states

struct LoadingCard: View {
    var text = "Loading…"

    var body: some View {
        HStack(spacing: 10) {
            ProgressView().tint(JK.secondary)
            Text(text).font(.caption).foregroundStyle(JK.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

struct EmptyCard: View {
    let systemName: String
    let title: String
    var detail: String? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemName).font(.title2).foregroundStyle(JK.tertiary)
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
            if let detail {
                Text(detail).font(.caption2).foregroundStyle(JK.tertiary).multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .jkCard()
    }
}

struct ErrorCard: View {
    let message: String
    var retry: (() async -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Couldn't load", systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(JK.text)
            Text(message).font(.caption).foregroundStyle(JK.secondary)
            if let retry {
                Button("Try again") { Task { await retry() } }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(SmallPillStyle())
            }
        }
        .jkCard()
    }
}

/// A one-line error under a header when a refresh or action fails but
/// earlier data is still on screen.
struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.caption)
            .foregroundStyle(JK.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// Wraps a load so a screen shows a spinner, the content, or an error.
struct Loadable<Value, Content: View>: View {
    let value: Value?
    let error: String?
    var loadingText = "Loading…"
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        if let value {
            if let error { ErrorBanner(message: error) }
            content(value)
        } else if let error {
            ErrorCard(message: error, retry: retry)
        } else {
            LoadingCard(text: loadingText)
        }
    }
}

extension View {
    /// `.refreshable` shielded from SwiftUI's cancellation: a bare one is
    /// cancelled by the redraw its own load causes.
    func jkRefreshable(_ action: @escaping @MainActor () async -> Void) -> some View {
        refreshable { await Task { @MainActor in await action() }.value }
    }

    /// Shows an alert while `message` is non-nil.
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("Something went wrong", isPresented: Binding(
            get: { message.wrappedValue != nil },
            set: { if !$0 { message.wrappedValue = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}

/// Field styling for forms inside cards and sheets.
struct JKField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 10)).foregroundStyle(JK.tertiary)
            TextField(prompt, text: $text)
                .keyboardType(keyboard)
                .font(.subheadline)
                .foregroundStyle(JK.text)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

/// "12.5" or "12,5" → 12.5.
func parseNumber(_ text: String) -> Double? {
    Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
}
