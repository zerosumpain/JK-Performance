import Foundation

// Codable types for the v1 API (docs/API.md). Field names match the contract
// exactly; the decoder is camelCase as-is. Calendar days ("YYYY-MM-DD") stay
// strings (parse with `Day`); instants decode to `Date` (APIClient's ISO 8601
// strategy). Optional where the contract shows null or "?", or leaves it open.

// MARK: - Auth & account

struct Session: Codable {
    let token: String
    let me: Me
}

struct Me: Codable, Equatable {
    let id: String
    var name: String
    var email: String?
    var role: String
    var createdAt: Date?
    var membership: Membership?
    var coach: PersonRef?

    var isCoach: Bool { role == "coach" }
    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
}

struct Membership: Codable, Equatable {
    var plan: String
    var planName: String?
    var since: String?
    var renewsOn: String?
    var creditsLeft: Int?
    var creditsTotal: Int?
    var creditsResetOn: String?

    var isActive: Bool { plan != "none" }
    var displayName: String { planName ?? Fmt.planName(plan) }
}

struct PersonRef: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var initials: String?

    var displayInitials: String { initials ?? Fmt.initials(name) }
}

struct Plan: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let detail: String
    let monthlyPence: Int
    let annualPence: Int
    let credits: Int
}

struct PlansResponse: Codable { let plans: [Plan] }

struct OK: Codable {
    var ok: Bool?
    var refunded: Bool?
}

// MARK: - Exercises

struct Exercise: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let equipment: String
    let pattern: String
    let category: String
    var videoUrl: String?
}

struct ExercisesResponse: Codable { let exercises: [Exercise] }

struct ExerciseInput: Codable {
    var name: String
    var equipment: String
    var pattern: String
    var category: String
    var videoUrl: String?
}

// MARK: - Workouts

struct LoggedSet: Codable, Hashable {
    let number: Int
    let load: String
    let reps: Int
    /// The contract shows `null` only; accept a number or a string.
    var rpe: LooseString?
    var at: Date?
}

struct WorkoutItem: Codable, Identifiable, Hashable {
    let id: String
    let order: Int
    let exercise: Exercise
    let sets: Int
    let reps: String
    let load: String
    var rpe: String?
    var note: String?
    var logged: [LoggedSet]
    var previous: String?

    var isDone: Bool { logged.count >= sets && sets > 0 }
}

struct Workout: Codable, Identifiable, Hashable {
    let id: String
    let clientId: String
    let date: String
    let title: String
    var startsAt: String?
    var location: String?
    var notes: String?
    var published: Bool
    var publishedAt: Date?
    var editedAt: Date?
    var editedBy: String?
    var completedAt: Date?
    var createdBy: String?
    var items: [WorkoutItem]

    var doneCount: Int { items.filter(\.isDone).count }
}

struct WorkoutSummary: Codable, Identifiable, Hashable {
    let id: String
    let clientId: String
    let date: String
    let title: String
    var startsAt: String?
    var location: String?
    var notes: String?
    var published: Bool
    var publishedAt: Date?
    var editedAt: Date?
    var editedBy: String?
    var completedAt: Date?
    var createdBy: String?
    var itemCount: Int
    var doneCount: Int
}

struct WorkoutsResponse: Codable { let workouts: [WorkoutSummary] }

struct WorkoutItemInput: Codable, Hashable {
    /// Existing item id (keeps its logged sets on PUT); nil for a new row.
    var id: String?
    var exerciseId: String
    var sets: Int
    var reps: String
    var load: String
    var rpe: String?
    var note: String?
    /// Not part of the contract body: the name to show while editing. Never encoded.
    var exerciseName: String = ""
    var localId = UUID()

    enum CodingKeys: String, CodingKey { case id, exerciseId, sets, reps, load, rpe, note }

    init(id: String? = nil, exerciseId: String, exerciseName: String, sets: Int = 3, reps: String = "10",
         load: String = "", rpe: String? = nil, note: String? = nil) {
        self.id = id
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.sets = sets
        self.reps = reps
        self.load = load
        self.rpe = rpe
        self.note = note
    }

    init(from item: WorkoutItem) {
        self.init(id: item.id, exerciseId: item.exercise.id, exerciseName: item.exercise.name, sets: item.sets,
                  reps: item.reps, load: item.load, rpe: item.rpe, note: item.note)
    }
}

struct WorkoutInput: Codable {
    var date: String
    var title: String
    var startsAt: String?
    var location: String?
    var notes: String?
    var items: [WorkoutItemInput]
    var clientId: String?
}

struct SetInput: Codable {
    var load: String
    var reps: Int
    var rpe: String?
}

struct NoteInput: Codable { var note: String? }

// MARK: - Programs

struct ProgramWorkout: Codable, Hashable, Identifiable {
    var dayOffset: Int
    var title: String
    var items: [WorkoutItemInput]
    var localId = UUID()

    var id: UUID { localId }

    enum CodingKeys: String, CodingKey { case dayOffset, title, items }
}

/// The contract defines `ProgramInput` and says a listed `Program` adds
/// `clientCount`; it is decoded as ProgramInput + `id` + `clientCount`.
struct Program: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var detail: String
    var daysPerWeek: Int
    var weeks: Int
    var workouts: [ProgramWorkout]
    var clientCount: Int?
}

struct ProgramInput: Codable {
    var name: String
    var detail: String
    var daysPerWeek: Int
    var weeks: Int
    var workouts: [ProgramWorkout]
}

struct ProgramsResponse: Codable { let programs: [Program] }
struct AssignInput: Codable { var clientId: String; var startDate: String }
struct AssignResponse: Codable { let created: Int }

// MARK: - Habits & nutrition

struct Habit: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let kind: String
    let target: Double
    let unit: String
    let icon: String
    /// "steps" | "sleep" when Apple Health fills the value (sleep in hours).
    var healthKind: String?
    var value: Double?
    var done: Bool
    var source: String?

    var isCount: Bool { kind == "count" }
    var fromHealth: Bool { source == "health" || healthKind != nil }
}

struct HabitInput: Codable {
    var clientId: String
    var name: String
    var kind: String
    var target: Double
    var unit: String
    var icon: String
}

struct HabitDayInput: Codable {
    var value: Double?
    var done: Bool?
}

struct Macros: Codable, Hashable {
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
}

struct FoodEntry: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let kcal: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    var at: Date?
}

struct Nutrition: Codable, Hashable {
    let date: String
    var targets: Macros?
    var totals: Macros
    var entries: [FoodEntry]
}

struct HabitsResponse: Codable {
    let date: String
    let habits: [Habit]
    let streak: Int
    let nutrition: Nutrition
}

struct TargetsInput: Codable {
    var clientId: String
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
}

struct FoodInput: Codable {
    var date: String
    var name: String
    var kcal: Double
    var protein: Double
    var carbs: Double
    var fat: Double
}

// MARK: - Check-ins

struct CheckIn: Codable, Identifiable, Hashable {
    let id: String
    let clientId: String
    let week: String
    let energy: Int
    let sleep: Int
    let pain: [String]
    var note: String?
    var submittedAt: Date?
    var reviewedAt: Date?
    var reply: String?
}

struct CheckInsResponse: Codable {
    let checkins: [CheckIn]
    var dueWeek: String?
}

struct CheckInInput: Codable {
    var energy: Int
    var sleep: Int
    var pain: [String]
    var note: String
}

struct ReplyInput: Codable { var reply: String }

// MARK: - Messages

struct Message: Codable, Identifiable, Hashable {
    let id: String
    let clientId: String
    let fromId: String
    let fromRole: String
    let text: String
    var workoutId: String?
    let at: Date
    var readAt: Date?
}

struct MessagesResponse: Codable { let messages: [Message] }

struct MessageThread: Codable, Identifiable, Hashable {
    let client: PersonRef
    var last: Message?
    var unread: Int

    var id: String { client.id }
}

struct ThreadsResponse: Codable { let threads: [MessageThread] }

struct MessageInput: Codable {
    var text: String
    var clientId: String?
    var workoutId: String?
}

// MARK: - Bookings & calendar

struct AvailabilityRule: Codable, Hashable, Identifiable {
    /// 1 = Monday … 7 = Sunday.
    var weekday: Int
    var start: String
    var end: String
    var kind: String
    var slotMinutes: Int
    var location: String?
    var localId = UUID()

    var id: UUID { localId }

    enum CodingKeys: String, CodingKey { case weekday, start, end, kind, slotMinutes, location }
}

struct RulesPayload: Codable { var rules: [AvailabilityRule] }

struct Slot: Codable, Hashable, Identifiable {
    let start: Date
    let end: Date
    let kind: String
    var location: String?
    let open: Bool

    var id: Date { start }
}

struct SlotsResponse: Codable { let slots: [Slot] }

struct Booking: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let start: Date
    let end: Date
    var location: String?
    var title: String?
    var client: PersonRef?
    var attendees: [PersonRef]?
    var attendeeCount: Int?
    var capacity: Int?
    var usesCredit: Bool?
    /// A client sees every group class of their coach; this says if they're in it.
    var joined: Bool?
    var cancellable: Bool?
    var refundable: Bool?

    var isGroup: Bool { kind == "group" }
    /// Mine to show on a client's calendar: 1:1s, and classes they joined.
    var isMine: Bool { !isGroup || joined == true }

    var kindLabel: String {
        switch kind {
        case "video": return "Video"
        case "group": return "Group"
        default: return "1:1"
        }
    }
}

struct BookingsResponse: Codable { let bookings: [Booking] }

struct BookingInput: Codable {
    var start: Date
    var kind: String
    var clientId: String?
}

struct ClassInput: Codable {
    var title: String
    var start: Date
    var end: Date
    var capacity: Int
    var location: String
}

// MARK: - Progress

struct SeriesPoint: Codable, Hashable {
    let date: String
    let value: Double
}

struct WeightBlock: Codable, Hashable {
    var latest: Double?
    var delta: Double?
    var series: [SeriesPoint]
}

struct StatBlock: Codable, Hashable {
    let kind: String
    var latest: Double?
    var delta: Double?
}

struct PersonalRecord: Codable, Hashable {
    let exercise: String
    let kg: Double
    var gain: Double?
    var date: String?
}

struct ProgressData: Codable, Hashable {
    var since: String?
    var weight: WeightBlock?
    var stats: [StatBlock]
    var records: [PersonalRecord]
}

struct MeasurementInput: Codable {
    var date: String
    var kind: String
    var value: Double
}

struct Photo: Codable, Identifiable, Hashable {
    let id: String
    let date: String
    var url: String?
}

struct PhotosResponse: Codable { let photos: [Photo] }

// MARK: - Health

struct HealthSample: Codable {
    let id: String
    let kind: String
    let start: Date
    let end: Date
    let value: Double
}

struct HealthSamplesInput: Codable { let samples: [HealthSample] }
struct StoredResponse: Codable { let stored: Int }

struct HealthSummary: Codable, Hashable {
    var date: String?
    var steps: Double?
    var sleepMinutes: Double?
    var restingHr: Double?
    var activeKcal: Double?
    var weight: Double?
    var distanceKm: Double?
}

struct HealthDevices: Codable {
    var appleHealth: Bool
    var lastSampleAt: Date?
}

// MARK: - Challenges

struct LeaderRow: Codable, Hashable, Identifiable {
    let rank: Int
    let id: String
    let name: String
    var initials: String?
    let value: Double
    var isMe: Bool?
}

struct Challenge: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    var detail: String?
    var metric: String?
    let target: Double
    var start: String?
    var end: String?
    var daysLeft: Int?
    var members: Int?
    var joined: Bool?
    /// Untyped in the contract: read as "my value" when a number and as
    /// "joined" when a bool.
    var mine: LooseValue?
    var leaderboard: [LeaderRow]
    var badges: Int?
    var streak: Int?

    var myRow: LeaderRow? { leaderboard.first { $0.isMe == true } }
    var isJoined: Bool { joined ?? (myRow != nil || mine?.flag == true || mine?.number != nil) }
    var myValue: Double { mine?.number ?? myRow?.value ?? 0 }
}

struct ChallengesResponse: Codable { let challenges: [Challenge] }

// MARK: - Coach

struct CoachToday: Decodable {
    var date: String?
    let sessions: [Booking]
    let activeClients: Int
    var totalClients: Int?
    let unread: Int
    var tip: Guide?
}

struct ClientSummary: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var initials: String?
    var plan: String?
    var since: String?
    var adherence: Int?
    var lastWorkoutAt: Date?
    var checkinDue: Bool?
    var flags: [String]?
    var unread: Int?

    var displayInitials: String { initials ?? Fmt.initials(name) }
}

struct ClientsResponse: Codable { let clients: [ClientSummary] }

struct ClientDetail: Codable {
    let client: ClientSummary
    var health: HealthSummary?
    var nextWorkout: Workout?
}

struct PenceSample: Codable, Hashable {
    let date: String
    let pence: Int
}

struct AttentionItem: Codable, Hashable {
    let client: PersonRef
    let reason: String
    let kind: String
}

struct PlanCount: Codable, Hashable {
    let id: String
    let name: String
    let members: Int
}

struct Business: Codable {
    var period: String?
    let mrrPence: Int
    var mrrDeltaPct: Double?
    var series: [PenceSample]
    let active: Int
    let new: Int
    let churned: Int
    var adherence: Int?
    var attention: [AttentionItem]
    var plans: [PlanCount]?
}

/// `Guide`: `{id, title, minutes, tags, body}`. Decoded leniently.
struct Guide: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let body: String
    var category: String?
    var tags: [String]
    var minutes: Int?
    var url: String?
    var icon: String?
    var format: String?

    enum CodingKeys: String, CodingKey { case id, title, body, detail, summary, text, category, tags, minutes, url, icon, format }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? title
        body = (try? c.decodeIfPresent(String.self, forKey: .body))
            ?? (try? c.decodeIfPresent(String.self, forKey: .detail))
            ?? (try? c.decodeIfPresent(String.self, forKey: .summary))
            ?? (try? c.decodeIfPresent(String.self, forKey: .text)) ?? ""
        category = try? c.decodeIfPresent(String.self, forKey: .category)
        tags = ((try? c.decodeIfPresent([String].self, forKey: .tags)) ?? nil) ?? []
        minutes = try? c.decodeIfPresent(Int.self, forKey: .minutes)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
        icon = try? c.decodeIfPresent(String.self, forKey: .icon)
        format = try? c.decodeIfPresent(String.self, forKey: .format)
    }
}

struct GuidesResponse: Decodable {
    var featured: Guide?
    var tips: [Guide]
}

// MARK: - Loose values

/// A string the contract does not pin down; numbers are rendered as text.
struct LooseString: Codable, Hashable {
    let value: String

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            value = s
        } else if let d = try? c.decode(Double.self) {
            value = Fmt.number(d)
        } else {
            value = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

/// A bool or a number.
struct LooseValue: Codable, Hashable {
    let flag: Bool?
    let number: Double?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) {
            flag = b
            number = nil
        } else if let d = try? c.decode(Double.self) {
            flag = nil
            number = d
        } else {
            flag = nil
            number = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        if let number { try c.encode(number) } else { try c.encode(flag ?? false) }
    }
}
