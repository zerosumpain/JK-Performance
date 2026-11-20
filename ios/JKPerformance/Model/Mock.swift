import Foundation

// Mock data lifted from the design (docs/coach/screens-v1.webp). Replace with
// a real store once the backend exists.

struct Exercise: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let equipment: String
    let pattern: String
    let category: String
}

struct WorkoutSet: Identifiable {
    let id = UUID()
    let number: Int
    let previous: String
    var load: String
    var reps: Int?
    var done: Bool
}

struct WeightPoint: Identifiable {
    let id = UUID()
    let day: Int
    let kg: Double
}

struct PersonalRecord: Identifiable {
    let id = UUID()
    let lift: String
    let kg: Int
    let gain: Int
}

struct Habit: Identifiable {
    let id = UUID()
    let name: String
    let detail: String
    let systemName: String
    let fraction: Double
    var done: Bool
}

struct Device: Identifiable {
    let id = UUID()
    let name: String
    let detail: String
    let systemName: String
    var connected: Bool
}

struct LeaderRow: Identifiable {
    let id = UUID()
    let rank: Int
    let initials: String
    let name: String
    let km: Int
    var isYou = false
}

struct AttentionItem: Identifiable {
    let id = UUID()
    let initials: String
    let name: String
    let reason: String
    let systemName: String
}

struct ProgramTemplate: Identifiable {
    let id = UUID()
    let name: String
    let detail: String
    let audience: String
}

struct AutoflowStep: Identifiable {
    let id = UUID()
    let when: String
    let action: String
    let systemName: String
}

enum Mock {
    static let clientName = "Sam"
    static let coachName = "Coach JK"

    static let exerciseCategories = ["All", "Legs", "Push", "Pull", "Core", "Mobility"]

    static let exercises: [Exercise] = [
        Exercise(name: "Back Squat", equipment: "Barbell", pattern: "Legs", category: "Legs"),
        Exercise(name: "Kettlebell Swing", equipment: "Kettlebell", pattern: "Hinge", category: "Legs"),
        Exercise(name: "Romanian Deadlift", equipment: "Barbell", pattern: "Hinge", category: "Pull"),
        Exercise(name: "Goblet Squat", equipment: "Kettlebell", pattern: "Legs", category: "Legs"),
        Exercise(name: "Bench Press", equipment: "Barbell", pattern: "Push", category: "Push"),
        Exercise(name: "Pull-up", equipment: "Bodyweight", pattern: "Pull", category: "Pull"),
    ]

    static let recentlyUsed: [Exercise] = [
        Exercise(name: "Copenhagen Plank", equipment: "Bodyweight", pattern: "Core", category: "Core"),
        Exercise(name: "Hip Thrust", equipment: "Barbell", pattern: "Glutes", category: "Legs"),
    ]

    static let splitSquatSets: [WorkoutSet] = [
        WorkoutSet(number: 1, previous: "2×18 × 10", load: "2×20", reps: 10, done: true),
        WorkoutSet(number: 2, previous: "2×18 × 10", load: "2×20", reps: 10, done: true),
        WorkoutSet(number: 3, previous: "2×18 × 9", load: "2×20", reps: nil, done: false),
    ]

    static let bodyWeight: [WeightPoint] = {
        let values: [Double] = [82.5, 82.1, 82.3, 81.6, 81.2, 81.4, 80.6, 80.1, 80.4, 79.6, 79.3, 79.0, 78.8, 78.4]
        return values.enumerated().map { WeightPoint(day: $0.offset, kg: $0.element) }
    }()

    static let records: [PersonalRecord] = [
        PersonalRecord(lift: "Back Squat", kg: 120, gain: 20),
        PersonalRecord(lift: "Deadlift", kg: 160, gain: 25),
        PersonalRecord(lift: "Bench Press", kg: 90, gain: 12),
    ]

    static let progressPhotoDates = ["3 Mar", "12 Jun", "14 Nov"]

    static let habits: [Habit] = [
        Habit(name: "Water", detail: "2.1 / 3 L", systemName: "drop", fraction: 0.7, done: false),
        Habit(name: "Sleep 7h+", detail: "7h 40m", systemName: "moon", fraction: 1, done: true),
        Habit(name: "Steps", detail: "8,420 / 10k", systemName: "shoeprints.fill", fraction: 0.84, done: false),
        Habit(name: "Creatine", detail: "Taken", systemName: "bolt", fraction: 1, done: true),
    ]

    static let devices: [Device] = [
        Device(name: "Apple Watch", detail: "Live workout & rest timer", systemName: "applewatch", connected: true),
        Device(name: "WHOOP", detail: "Recovery & strain", systemName: "bolt.heart", connected: false),
        Device(name: "Oura", detail: "Sleep & readiness", systemName: "circle.circle", connected: true),
        Device(name: "Garmin", detail: "Runs & rides", systemName: "figure.run", connected: false),
        Device(name: "MyFitnessPal", detail: "Food diary sync", systemName: "fork.knife", connected: false),
    ]

    static let leaderboard: [LeaderRow] = [
        LeaderRow(rank: 1, initials: "PS", name: "Priya S.", km: 92),
        LeaderRow(rank: 2, initials: "AM", name: "Alex M.", km: 81),
        LeaderRow(rank: 3, initials: "LG", name: "Leo G.", km: 70),
        LeaderRow(rank: 7, initials: "SC", name: "You", km: 64, isYou: true),
    ]

    static let mrr: [WeightPoint] = {
        let values: [Double] = [1810, 1840, 1900, 1880, 1960, 2010, 2050, 2100, 2160, 2190, 2260, 2310, 2380, 2486]
        return values.enumerated().map { WeightPoint(day: $0.offset, kg: $0.element) }
    }()

    static let attention: [AttentionItem] = [
        AttentionItem(initials: "RK", name: "Rory K.", reason: "No workout logged in 9 days", systemName: "exclamationmark.triangle"),
        AttentionItem(initials: "TB", name: "Tom B.", reason: "Payment failed · retrying 22 Nov", systemName: "creditcard"),
        AttentionItem(initials: "LG", name: "Leo G.", reason: "Check-in overdue 2 days", systemName: "doc.text"),
    ]

    static let programs: [ProgramTemplate] = [
        ProgramTemplate(name: "12-Week Strength Block", detail: "4 days / week · 48 workouts", audience: "9 clients"),
        ProgramTemplate(name: "Fat Loss Foundations", detail: "3 days / week · habits + macros", audience: "6 clients"),
        ProgramTemplate(name: "Kettlebell Conditioning", detail: "Group · 2 days / week", audience: "12 members"),
    ]

    static let onboarding: [AutoflowStep] = [
        AutoflowStep(when: "Day 0", action: "Welcome message + intake form", systemName: "bolt"),
        AutoflowStep(when: "Day 1", action: "PAR-Q health questionnaire", systemName: "doc.text"),
        AutoflowStep(when: "Day 3", action: "Assign 12-Week Strength Block", systemName: "dumbbell"),
        AutoflowStep(when: "Every Sun", action: "Weekly check-in form", systemName: "bubble.left"),
    ]
}

// MARK: - Second design sheet (home, plan, calendar, messages, coach screens)

struct PlanDay: Identifiable {
    var id: Int { day }
    let weekday: String
    let day: Int
}

struct PlanExercise: Identifiable {
    let id = UUID()
    let name: String
    let sets: String
    let reps: String
    let load: String
    let note: String?
    let done: Bool
}

struct UpcomingItem: Identifiable {
    let id = UUID()
    let weekday: String
    let day: String
    let title: String
    let detail: String
}

struct CalendarEvent: Identifiable {
    let id = UUID()
    let time: String
    let title: String
    let detail: String
    let tag: String
}

struct Slot {
    let time: String
    let open: Bool
}

struct Plan: Identifiable {
    var id: String { name }
    let name: String
    let detail: String
    let monthly: String
    let annual: String
}

struct ChatMessage: Identifiable {
    let id = UUID()
    let text: String
    let time: String
    let fromCoach: Bool
    var attachment: String? = nil
}

struct Obligation: Identifiable {
    let id = UUID()
    let start: String
    let end: String
    let initials: String
    let name: String
    let detail: String
    var done = false
    var next = false
}

struct ClientSummary: Identifiable {
    let id = UUID()
    let initials: String
    let name: String
    let detail: String
}

struct ClientPlanRow: Identifiable {
    let id = UUID()
    let name: String
    let prescription: String
    let badge: String?
}

struct ScheduleBlock: Identifiable {
    let id = UUID()
    /// 0 = Monday.
    let day: Int
    /// Hour of day, fractional.
    let start: CGFloat
    /// Hours.
    let length: CGFloat
    let label: String
}

struct Tip: Identifiable {
    let id = UUID()
    let title: String
    let body: String
    let systemName: String
}

extension Mock {
    static let planDays: [PlanDay] = [
        PlanDay(weekday: "Mon", day: 16), PlanDay(weekday: "Tue", day: 17), PlanDay(weekday: "Wed", day: 18),
        PlanDay(weekday: "Thu", day: 19), PlanDay(weekday: "Fri", day: 20), PlanDay(weekday: "Sat", day: 21),
    ]

    static let bookingDays: [PlanDay] = [
        PlanDay(weekday: "Mon", day: 23), PlanDay(weekday: "Tue", day: 24), PlanDay(weekday: "Wed", day: 25),
        PlanDay(weekday: "Thu", day: 26), PlanDay(weekday: "Fri", day: 27), PlanDay(weekday: "Sat", day: 28),
    ]

    static let planExercises: [PlanExercise] = [
        PlanExercise(name: "Back Squat", sets: "5", reps: "5", load: "100 kg", note: "Pause to at the bottom on sets 4–5", done: true),
        PlanExercise(name: "Romanian Deadlift", sets: "4", reps: "8", load: "80 kg", note: nil, done: true),
        PlanExercise(name: "Bulgarian Split Squat", sets: "3", reps: "10 / leg", load: "2×20 kg", note: "Updated by Coach JK · 2h ago", done: false),
        PlanExercise(name: "Hip Thrust", sets: "3", reps: "12", load: "90 kg", note: nil, done: false),
        PlanExercise(name: "Copenhagen Plank", sets: "3", reps: "30 s", load: "BW", note: nil, done: false),
    ]

    static let upcoming: [UpcomingItem] = [
        UpcomingItem(weekday: "Sat", day: "21", title: "Conditioning · Group", detail: "08:00 · Park Run Loop"),
        UpcomingItem(weekday: "Mon", day: "23", title: "Check-in call", detail: "18:30 · Video"),
        UpcomingItem(weekday: "Tue", day: "24", title: "Upper Body Hypertrophy", detail: "07:00 · Studio 2"),
    ]

    static let sessionDays: Set<Int> = [2, 4, 6, 9, 11, 13, 16, 18, 20, 21, 23, 24, 25, 27]

    static let dayEvents: [CalendarEvent] = [
        CalendarEvent(time: "07:30", title: "Mobility routine", detail: "Self-guided · 20 min", tag: "Plan"),
        CalendarEvent(time: "11:00", title: "Lower Body Strength", detail: "1:1 with Coach JK · Studio 2", tag: "Session"),
    ]

    static let slots: [Slot] = [
        Slot(time: "07:00", open: true), Slot(time: "08:00", open: false), Slot(time: "09:00", open: true),
        Slot(time: "11:00", open: true), Slot(time: "12:00", open: true), Slot(time: "14:00", open: false),
        Slot(time: "16:00", open: true), Slot(time: "17:00", open: false), Slot(time: "18:00", open: true),
    ]

    static let plans: [Plan] = [
        Plan(name: "Foundation", detail: "Programme + app messaging", monthly: "£59", annual: "£602"),
        Plan(name: "Performance", detail: "Programme, 2 sessions / month, weekly check-in", monthly: "£99", annual: "£1,010"),
        Plan(name: "Elite", detail: "Weekly 1:1 sessions, nutrition, priority messaging", monthly: "£149", annual: "£1,520"),
    ]

    static let thread: [ChatMessage] = [
        ChatMessage(text: "Morning Sam. I bumped the split squats to 2×20 kg today. You moved well last week.", time: "08:12", fromCoach: true),
        ChatMessage(text: "Sounds good. Left knee was a bit tight on Tuesday though.", time: "08:20", fromCoach: false),
        ChatMessage(text: "Noted. Do the 10 min mobility block first and we'll check it at 11.", time: "08:24", fromCoach: true),
        ChatMessage(text: "", time: "08:25", fromCoach: true, attachment: "Lower Body Strength"),
        ChatMessage(text: "👍 See you at 11", time: "08:31", fromCoach: false),
    ]

    static let obligations: [Obligation] = [
        Obligation(start: "06:30", end: "07:30", initials: "AM", name: "Alex Morgan", detail: "Upper Body · 1:1", done: true),
        Obligation(start: "09:00", end: "09:30", initials: "PS", name: "Priya Shah", detail: "Assessment · Video", done: true),
        Obligation(start: "11:00", end: "12:00", initials: "SC", name: "Sam Carter", detail: "Lower Body Strength", next: true),
        Obligation(start: "13:30", end: "14:00", initials: "LG", name: "Leo Grant", detail: "Check-in call · Video"),
        Obligation(start: "17:00", end: "18:00", initials: "G", name: "Group · 6 clients", detail: "Conditioning"),
    ]

    static let clients: [ClientSummary] = [
        ClientSummary(initials: "SC", name: "Sam Carter", detail: "Elite · adherence 86%"),
        ClientSummary(initials: "AM", name: "Alex Morgan", detail: "Performance · adherence 92%"),
        ClientSummary(initials: "PS", name: "Priya Shah", detail: "Elite · adherence 95%"),
        ClientSummary(initials: "LG", name: "Leo Grant", detail: "Foundation · check-in overdue"),
        ClientSummary(initials: "RK", name: "Rory Kane", detail: "Performance · no workout in 9 days"),
        ClientSummary(initials: "TB", name: "Tom Burke", detail: "Foundation · payment failed"),
    ]

    static let clientPlan: [ClientPlanRow] = [
        ClientPlanRow(name: "Back Squat", prescription: "5×5 · 100 kg", badge: nil),
        ClientPlanRow(name: "Romanian Deadlift", prescription: "4×8 · 80 kg", badge: nil),
        ClientPlanRow(name: "Bulgarian Split Squat", prescription: "3×10 · 2×20 kg", badge: "Edited"),
        ClientPlanRow(name: "Hip Thrust", prescription: "3×12 · 90 kg", badge: nil),
        ClientPlanRow(name: "Copenhagen Plank", prescription: "3×30 s · BW", badge: "New"),
    ]

    static let scheduleBlocks: [ScheduleBlock] = [
        ScheduleBlock(day: 0, start: 7, length: 1, label: "AM"), ScheduleBlock(day: 0, start: 12, length: 1, label: "LG"),
        ScheduleBlock(day: 0, start: 17, length: 1, label: "Grp"),
        ScheduleBlock(day: 1, start: 7.5, length: 1, label: "SC"), ScheduleBlock(day: 1, start: 11, length: 1, label: "PS"),
        ScheduleBlock(day: 1, start: 17, length: 1, label: "Grp"),
        ScheduleBlock(day: 2, start: 7, length: 1, label: "AM"), ScheduleBlock(day: 2, start: 13, length: 0.5, label: "Call"),
        ScheduleBlock(day: 2, start: 18, length: 1, label: "RK"),
        ScheduleBlock(day: 3, start: 9, length: 1, label: "RK"), ScheduleBlock(day: 3, start: 12, length: 1, label: "TB"),
        ScheduleBlock(day: 3, start: 16, length: 1, label: "Assess"),
        ScheduleBlock(day: 4, start: 6.5, length: 1, label: "AM"), ScheduleBlock(day: 4, start: 9, length: 0.5, label: "PS"),
        ScheduleBlock(day: 4, start: 11, length: 1, label: "SC"), ScheduleBlock(day: 4, start: 13.5, length: 0.5, label: "LG"),
        ScheduleBlock(day: 4, start: 17, length: 1, label: "Grp"),
        ScheduleBlock(day: 5, start: 8, length: 1, label: "Group run"),
    ]

    static let tips: [Tip] = [
        Tip(title: "Missed two sessions?", body: "Message within 24h with one easy win, not a reschedule link.", systemName: "lightbulb"),
        Tip(title: "Progressive overload cue", body: "If all sets hit top reps at RPE ≤ 7, add 2.5 kg next session.", systemName: "dumbbell"),
    ]
}
