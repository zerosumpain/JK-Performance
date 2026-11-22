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
    var isDemo: Bool?
    var createdAt: Date?
    var membership: Membership?
    var coach: PersonRef?
    /// Clients: whether they've said yes to their coach seeing Apple Health.
    var healthSharing: Bool?
    /// Clients: false until they've finished the first-run questions. Older servers leave it out (treated as done).
    var onboarded: Bool?
    /// Clients: the first-run answers, null until answered.
    var profile: Profile?
    /// Plan features plus coach toggles (docs/API.md, Atelier). Missing on an older server: show everything.
    var features: Features?
    var preferences: Preferences?
    /// A coach's own settings; null for clients.
    var coachSettings: CoachSettings?

    var isCoach: Bool { role == "coach" }
    /// A client who hasn't been through onboarding yet. Coaches never are.
    var needsOnboarding: Bool { !isCoach && onboarded == false }
    var demo: Bool { isDemo == true }
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
    /// The coach's portrait (GET /api/media/:id). Absent on older servers and for clients.
    var avatarMediaId: String?
    var signatureMediaId: String?
    var replyExpectation: ReplyExpectation?
    /// The reply line this client sees ("Same-day replies" on plans with 'priority').
    var replyLine: String?
    /// Clients in a needs-you item.
    var firstName: String?
    var plan: String?
    var planName: String?

    var displayInitials: String { initials ?? Fmt.initials(name) }
}

/// A client's first-run answers. Every field may be missing: each question can be skipped.
struct Profile: Codable, Equatable, Hashable {
    var goals: [String]?
    /// `new` | `some` | `experienced`
    var experience: String?
    var daysPerWeek: Int?
    /// `morning` | `midday` | `evening` | `varies`
    var preferredTime: String?
    var injuries: String?
    var answeredAt: Date?

    var isEmpty: Bool {
        (goals ?? []).isEmpty && experience == nil && daysPerWeek == nil && preferredTime == nil
            && (injuries ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// PUT /api/me/onboarding. Nil fields are left out (skipped questions).
struct OnboardingInput: Encodable {
    var goals: [String]?
    var experience: String?
    var daysPerWeek: Int?
    var preferredTime: String?
    var injuries: String?
    var done: Bool
}

struct Plan: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    /// The one-line tagline.
    let detail: String
    let monthlyPence: Int
    let annualPence: Int
    let credits: Int
    /// The longer sales line for the walkthrough.
    var pitch: String?
    /// The one "most popular" plan.
    var featured: Bool?
    /// Feature ids, in catalogue order.
    var features: [String]?
    var updatedAt: Date?

    var isFree: Bool { id == "none" }
    var isFeatured: Bool { featured == true }
    var featureIds: [String] { features ?? [] }
}

/// One entry in the fixed feature catalogue the walkthrough steps through.
struct Feature: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    var points: [String]?
}

struct PlansResponse: Codable {
    let plans: [Plan]
    var features: [Feature]?
}

/// PUT /api/coach/plans/:id. The free plan leaves out price, credits and featured.
struct PlanInput: Encodable {
    var name: String
    var detail: String
    var pitch: String
    var monthlyPence: Int?
    var annualPence: Int?
    var credits: Int?
    var featured: Bool?
    var features: [String]
}

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
    /// 1–10, or null when not given.
    var rpe: Double?
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
    var completionNote: String?
    var feel: Int?
    var feelWord: String?

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
    /// Not part of the request body: the name to show while editing. Read
    /// from `exercise` on a Program item; never encoded.
    var exerciseName: String = ""
    var localId = UUID()

    enum CodingKeys: String, CodingKey { case id, exerciseId, exercise, sets, reps, load, rpe, note }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        exerciseId = try c.decode(String.self, forKey: .exerciseId)
        sets = try c.decode(Int.self, forKey: .sets)
        reps = try c.decode(String.self, forKey: .reps)
        load = try c.decodeIfPresent(String.self, forKey: .load) ?? ""
        rpe = try c.decodeIfPresent(String.self, forKey: .rpe)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        exerciseName = (try? c.decodeIfPresent(Exercise.self, forKey: .exercise))?.name ?? exerciseId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(id, forKey: .id)
        try c.encode(exerciseId, forKey: .exerciseId)
        try c.encode(sets, forKey: .sets)
        try c.encode(reps, forKey: .reps)
        try c.encode(load, forKey: .load)
        try c.encodeIfPresent(rpe, forKey: .rpe)
        try c.encodeIfPresent(note, forKey: .note)
    }

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
    /// 1–10; omitted when not given.
    var rpe: Double?
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

/// ProgramInput plus `id`, `clientCount` and `updatedAt`; each item also
/// carries its `exercise`.
struct Program: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var detail: String
    var daysPerWeek: Int
    var weeks: Int
    var workouts: [ProgramWorkout]
    var clientCount: Int?
    var updatedAt: Date?
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
    /// The closed IconKey catalogue name; older servers send only `icon`.
    var iconKey: String?
    /// The +/- increment for count habits.
    var step: Double?
    var introducedAt: Date?
    var position: Int?

    var isCount: Bool { kind == "count" }
    var key: IconKey { IconKey(stored: iconKey ?? icon) }
    /// One tap's worth: the coach's step, else a tenth of the target, at least 1.
    var increment: Double { step ?? max(1, (target / 10).rounded()) }
    /// 0...1 of today's target.
    var fraction: Double {
        if done { return 1 }
        guard target > 0, let value else { return 0 }
        return min(max(value / target, 0), 1)
    }
    var fromHealth: Bool { source == "health" || healthKind != nil }
}

struct HabitInput: Codable {
    var clientId: String
    var name: String
    var kind: String
    var target: Double
    var unit: String
    var icon: String
    /// "steps" | "sleep" fills the habit from Apple Health; nil omits it.
    var healthKind: String?
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
    var dayDone: Bool?
    var doneCount: Int?
    var dayMinimum: Int?
    var rest: RestDay?
    var consistency: Consistency?
    var missedYesterday: Bool?
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
    var stress: Int?
    var win: String?
    var struggle: String?
    var photoIds: [String]?
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
    var stress: Int?
    var win: String?
    var struggle: String?
    var photoIds: [String]?
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
    /// text | letter | answer | formCheck | mealPhoto
    var kind: String?
    var reportId: String?
    var exerciseId: String?
    var mediaId: String?
    var mediaUrl: String?
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
    var reportId: String? = nil
    var exerciseId: String? = nil
    var mediaId: String? = nil
    var kind: String? = nil
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
    /// The booking's own meeting link, else the coach's default room for video calls.
    var meetingUrl: String?

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
    var isNewThisWeek: Bool?
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
    var activityCount: Int?
    var lastActivityAt: Date?
    var sharing: Bool?
    var sharingSince: Date?
}

struct SharingInput: Codable { var share: Bool }

/// An Apple Health workout: a run, a ride, a gym session.
struct HealthActivity: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    var date: String?
    let start: Date
    let end: Date
    let minutes: Double
    var kcal: Double?
    var distanceKm: Double?
    var avgHr: Double?
    var source: String?

    var detail: String {
        var parts = [Fmt.duration(minutes)]
        if let km = distanceKm, km > 0 { parts.append("\(Fmt.number(km)) km") }
        if let kcal, kcal > 0 { parts.append("\(Fmt.number(kcal, digits: 0)) kcal") }
        if let hr = avgHr, hr > 0 { parts.append("\(Fmt.number(hr, digits: 0)) bpm") }
        return parts.joined(separator: " · ")
    }
}

struct HealthActivitiesInput: Codable { let activities: [HealthActivity] }
struct ActivitiesResponse: Codable { let activities: [HealthActivity] }

/// Seven days of a client's Health for their coach; empty unless shared.
struct HealthWeek: Codable {
    let shared: Bool
    var sharedSince: Date?
    let days: [HealthSummary]
    let activities: [HealthActivity]
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
    var feedbackDue: FeedbackDue?
    var checkinsToReview: Int?
    var attention: [AttentionItem]?
    var checkinClients: [PersonAt]?
    var formsToReview: Int?
    var formClients: [PersonAt]?
    var unreadClients: [PersonAt]?
    var urgent: [AttentionItem]?
    var quiet: [QuietClient]?
    var upcoming: [UpcomingStep]?
    var sessionsLeftThisWeek: Int?
}

/// A client with the moment something of theirs started waiting.
struct PersonAt: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var initials: String?
    var at: Date?

    var ref: PersonRef { PersonRef(id: id, name: name, initials: initials) }
}

struct QuietClient: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var initials: String?
    let days: Int

    var ref: PersonRef { PersonRef(id: id, name: name, initials: initials) }
}

struct UpcomingStep: Codable, Hashable {
    let client: PersonRef
    let date: String
    let autoflow: String
    let action: String
}

struct FeedbackDue: Decodable {
    let week: String
    var dueBy: String?
    let clients: [PersonRef]
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
    var lastMessageAt: Date?
    var demand: Demand?
    /// The seven days ending today: done | notDone | rest.
    var habitWeek: [HabitWeekDay]?

    var displayInitials: String { initials ?? Fmt.initials(name) }
}

/// Why a client is where they are in the list (the server sorts by it).
struct Demand: Codable, Hashable {
    let kind: String   // urgent | message | form | checkin | quiet | inactive | ok
    var reason: String?
    var at: Date?
    var urgent: [String]?
    var quietDays: Int?
}

struct ClientsResponse: Codable { let clients: [ClientSummary] }

struct ClientDetail: Codable {
    let client: ClientSummary
    /// The client's first-run answers; null until answered.
    var profile: Profile?
    var healthShared: Bool?
    var health: HealthSummary?
    var nextWorkout: Workout?
    var goals: [Goal]?
    var settings: ClientSettings?
    var restDays: [RestDay]?
    var latestCheckin: LatestCheckIn?
    var nextBooking: Booking?
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
    var monthlyPence: Int?
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


// MARK: - Weekly feedback

struct ReportCheckIn: Codable, Hashable {
    let energy: Int
    let sleep: Int
    let pain: [String]
    let note: String
    var submittedAt: Date?
}

struct ActivityTotals: Codable, Hashable {
    let count: Int
    let minutes: Double
    let types: [String]
}

/// The week's figures beside a report. Health ones are null unless shared.
struct ReportStats: Codable, Hashable {
    let workoutsPlanned: Int
    let workoutsDone: Int
    let setsLogged: Int
    var habitsPct: Int?
    var checkin: ReportCheckIn?
    var weightStart: Double?
    var weightEnd: Double?
    let healthShared: Bool
    var avgSteps: Double?
    var avgSleepMinutes: Double?
    var activities: ActivityTotals?
}

struct ReportPlan: Codable, Hashable {
    let from: String
    let to: String
    let workouts: [WorkoutSummary]
}

/// A coach's write-up of one client's week (Monday `week` to Sunday `weekEnd`).
/// `id` is nil for a week the coach hasn't saved yet.
struct Report: Codable, Identifiable, Hashable {
    let id: String?
    let clientId: String
    let week: String
    let weekEnd: String
    var summary: String
    var wins: String
    var focus: String
    let status: String
    var publishedAt: Date?
    var readAt: Date?
    var updatedAt: Date?
    var coachName: String?
    var stats: ReportStats?
    var plan: ReportPlan?
    // The letter (Atelier). Old servers leave these out; the old fields stand in.
    var kind: String?
    var letterStatus: String?
    var headline: String?
    var keep: String?
    var adjust: String?
    var question: String?
    var answer: String?
    var answeredAt: Date?
    var mediaId: String?
    var mediaKind: String?
    var mediaUrl: String?
    var durationSec: Double?
    var goalId: String?
    var deliverAt: Date?
    var deliveredAt: Date?
    var focusOverride: String?
    var todayLine: String?
    var milestoneKey: String?
    var weekDots: [LetterDot]?
    var scoreTrio: [Score]?
    var context: LetterContext?

    var isPublished: Bool { status == "published" }
    var isUnread: Bool { isPublished && readAt == nil }
    var isMilestone: Bool { kind == "milestone" }
    /// The headline, or the first sentence of an old report's summary.
    var displayHeadline: String {
        if let h = headline, !h.isEmpty { return h }
        let first = summary.split(whereSeparator: { ".!?".contains($0) }).first.map { String($0) + "." } ?? ""
        return first.isEmpty ? "Your week" : first
    }
    var keepText: String { (keep?.isEmpty == false ? keep : nil) ?? wins }
    var adjustText: String { (adjust?.isEmpty == false ? adjust : nil) ?? focus }
    var weekLabel: String { "Week of \(Fmt.dayMonth(week))" }
}

struct ReportsResponse: Codable {
    let reports: [Report]
    let unread: Int
    let suggestedWeek: String
}

struct ReportInput: Codable {
    var clientId: String
    var week: String
    var summary: String
    var wins: String
    var focus: String
    var status: String
}

// MARK: - Calendar feed and the web desk

struct CalendarFeed: Codable {
    let active: Bool
    var url: String?
    var webcal: String?
}

struct LinkCode: Codable {
    let code: String
    let expiresAt: Date
    let url: String
}

// MARK: - Forms

struct FormQuestion: Codable, Hashable, Identifiable {
    var id: String
    var kind: String   // text | long | scale | yesno | choice
    var label: String
    var options: [String]?
    var flag: Bool?
    var required: Bool?

    var isRequired: Bool { required != false }

    static let kinds: [(String, String)] = [("text", "Short answer"), ("long", "Long answer"), ("scale", "Scale 1–5"), ("yesno", "Yes / no"), ("choice", "Choice")]
    static func kindName(_ kind: String) -> String { kinds.first { $0.0 == kind }?.1 ?? kind }
}

/// One answer: text, a 1–5 number, yes/no, or a choice (text).
enum FormAnswer: Codable, Hashable {
    case text(String)
    case number(Int)
    case yes(Bool)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .yes(b) }
        else if let n = try? c.decode(Int.self) { self = .number(n) }
        else { self = .text(try c.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let t): try c.encode(t)
        case .number(let n): try c.encode(n)
        case .yes(let b): try c.encode(b)
        }
    }

    var display: String {
        switch self {
        case .text(let t): return t
        case .number(let n): return "\(n) / 5"
        case .yes(let b): return b ? "Yes" : "No"
        }
    }
}

struct FormTemplate: Codable, Hashable {
    let name: String
    var intro: String?
    let questions: [FormQuestion]
}

struct CoachForm: Codable, Hashable, Identifiable {
    let id: String
    var name: String
    var intro: String?
    var questions: [FormQuestion]
    var sent: Int?
    var waiting: Int?
    var toReview: Int?
}

struct FormsResponse: Codable {
    let forms: [CoachForm]
    var templates: [FormTemplate]?
}

struct FormInput: Codable {
    var name: String
    var intro: String
    var questions: [FormQuestion]
}

struct FormRequest: Codable, Hashable, Identifiable {
    let id: String
    var formId: String?
    let name: String
    var intro: String?
    let questions: [FormQuestion]
    var client: PersonRef?
    let sentAt: Date
    var answers: [String: FormAnswer]?
    var submittedAt: Date?
    var reviewedAt: Date?
    var flagged: [String]?
    var fromAutoflow: Bool?

    var isFlagged: Bool { !(flagged ?? []).isEmpty }
}

struct FormRequestsResponse: Codable { let requests: [FormRequest] }
struct FormAnswersInput: Codable { let answers: [String: FormAnswer] }
struct ClientIdInput: Codable { let clientId: String }

// MARK: - Autoflows

struct AutoflowStep: Codable, Hashable, Identifiable {
    var id: String
    var day: Int
    var action: String   // message | form | program
    var text: String?
    var formId: String?
    var programId: String?
    var label: String?

    var icon: String {
        switch action {
        case "message": return "bubble.left"
        case "form": return "doc.text"
        default: return "dumbbell"
        }
    }

    enum CodingKeys: String, CodingKey { case id, day, action, text, formId, programId, label }
}

struct AutoflowRun: Codable, Hashable, Identifiable {
    struct Next: Codable, Hashable { let day: Int; let date: String; let label: String }
    struct LogEntry: Codable, Hashable { let stepId: String; let label: String; let at: Date; let outcome: String }

    let id: String
    let autoflowId: String
    var autoflowName: String?
    var client: PersonRef?
    let startDay: String
    let stepsDone: Int
    let steps: Int
    var stoppedAt: Date?
    var next: Next?
    var log: [LogEntry]?
}

struct Autoflow: Codable, Hashable, Identifiable {
    let id: String
    var name: String
    var trigger: String   // join | manual
    var active: Bool
    var steps: [AutoflowStep]
    var runs: [AutoflowRun]?
}

struct AutoflowsResponse: Codable { let autoflows: [Autoflow] }
struct AutoflowRunsResponse: Codable { let runs: [AutoflowRun] }

struct AutoflowInput: Codable {
    var name: String
    var trigger: String
    var active: Bool
    var steps: [AutoflowStep]
}

struct EnrolInput: Codable {
    let clientId: String
    var startDate: String?
}
