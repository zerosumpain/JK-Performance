import SwiftUI

// Shared client words and routes (the old Today screen became Plan · Act ·
// Review; see ActViews.swift).

/// Words for a habit's value.
enum HabitText {
    static func value(_ h: Habit) -> String {
        if h.healthKind == "sleep", let v = h.value { return "\(Fmt.minutes(v * 60)) of \(Fmt.number(h.target)) h" }
        if h.isCount {
            let unit = h.unit.isEmpty ? "" : " \(h.unit)"
            return "\(Fmt.number(h.value ?? 0)) of \(Fmt.number(h.target))\(unit)"
        }
        return h.done ? "Done" : "Not yet"
    }
}

/// The Next card's glyph and caption by kind.
enum NextText {
    static func icon(_ kind: String) -> IconKey {
        switch kind {
        case "session", "workout": return .workout
        case "videoCall": return .video
        case "checkin": return .checkIn
        case "form": return .form
        case "booking": return .oneToOne
        case "rest": return .rest
        case "membership": return .jk
        default: return .week
        }
    }

    static func caption(_ kind: String) -> String {
        switch kind {
        case "session": return "Next"
        case "videoCall": return "Video call"
        case "checkin": return "Check-in"
        case "form": return "From JK"
        case "workout": return "Later today"
        case "booking": return "Booked"
        case "rest": return "Today"
        case "membership": return "Coaching"
        default: return "Next"
        }
    }

    static func alsoDue(_ list: [AlsoDue]?) -> String? {
        let labels = (list ?? []).compactMap { $0.label ?? ($0.kind == "checkin" ? "Check-in" : nil) }
        return labels.isEmpty ? nil : "Also due: " + labels.joined(separator: ", ")
    }
}

/// Nothing JK said more than one rhythm ago is shown as if it were current:
/// the line hides after the plan's rhythm plus three days. The server already
/// drops older lines; this keeps a cached payload honest too.
enum CoachLineRule {
    static func isStale(_ line: CoachLine, now: Date = Date()) -> Bool {
        guard let at = line.at else { return false }
        let days = Double(line.staleAfterDays ?? 10)
        return now.timeIntervalSince(at) > days * 86_400
    }
}

extension View {
    /// The screens a client tab can push (ClientRoute).
    func clientRoutes() -> some View {
        navigationDestination(for: ClientRoute.self) { route in
            switch route {
            case .yourWeek(let day): YourWeekView(day: day)
            case .session(let id): WorkoutDetailLoader(workoutId: id)
            case .letter(let id): LetterView(reportId: id)
            case .guides: GuidesList()
            case .guide(let id): GuideView(guideId: id)
            case .challenges: ChallengesView()
            case .progress: ProgressScreen()
            case .letters: PastLettersView()
            case .todaysWork: TodaysWorkView()
            case .prepare: BeforeSessionView()
            case .accountability: AccountabilityView()
            }
        }
    }
}
