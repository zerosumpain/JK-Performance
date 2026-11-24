import Foundation

// Codable types for the Atelier additions (docs/API.md, "Atelier redesign
// additions"). Everything the server derives is optional, so an older server
// or a missing key never breaks decoding.

// MARK: - Features, preferences, coach settings

/// `Me.features`: plan features plus the coach's toggles. Every key optional.
struct Features: Codable, Equatable, Hashable {
    var programme: Bool?
    var messaging: Bool?
    var habits: Bool?
    var progress: Bool?
    var checkin: Bool?
    var sessions: Bool?
    var nutrition: Bool?
    var priority: Bool?
    var guides: Bool?
    var formChecks: Bool?
    var mealPhotos: Bool?
    var challenges: Bool?
    var hasMacroTargets: Bool?
    /// Voice notes (desk-v2 F19): show the mic in the composer.
    var voiceNotes: Bool?
    /// The chat recorder's cap (300). Letters stay at 90 s.
    var voiceMaxSec: Int?
    /// ask | on | off: a client's choice about transcription.
    var voiceTranscription: String?
    /// The AI audio model's provider, for the consent sheet, when the server names it.
    var voiceProvider: String?
}

/// What this client's plan includes. With no `features` (an older server)
/// everything a plan could promise shows, as before; coach toggles that did
/// not exist then stay off, except challenges, which every client saw.
struct Gate: Equatable {
    let features: Features?

    var known: Bool { features != nil }
    var programme: Bool { features?.programme ?? true }
    var messaging: Bool { features?.messaging ?? true }
    var habits: Bool { features?.habits ?? true }
    var progress: Bool { features?.progress ?? true }
    var checkin: Bool { features?.checkin ?? true }
    var sessions: Bool { features?.sessions ?? true }
    var nutrition: Bool { features?.nutrition ?? true }
    var priority: Bool { features?.priority ?? false }
    var guides: Bool { features?.guides ?? true }
    var formChecks: Bool { features?.formChecks ?? false }
    var mealPhotos: Bool { features?.mealPhotos ?? false }
    var challenges: Bool { features?.challenges ?? true }
    var hasMacroTargets: Bool? { features?.hasMacroTargets }
    /// Voice notes in the chat; off on a server that does not know them.
    var voiceNotes: Bool { features?.voiceNotes ?? false }
    var voiceMaxSec: Int { features?.voiceMaxSec ?? 300 }
    /// ask | on | off; nil on an older server.
    var voiceTranscription: String? { features?.voiceTranscription }
    /// Free: nothing but guides.
    var isFree: Bool { known && !messaging && !checkin && !habits && !progress }
}

extension Me {
    var gate: Gate { Gate(features: features) }
}

struct ReplyExpectation: Codable, Equatable, Hashable {
    var standard: String?
    var priority: String?
}

struct Preferences: Codable, Equatable, Hashable {
    var notificationsOn: Bool?
    /// "HH:MM" or nil.
    var eveningReminderTime: String?
}

struct RhythmSetting: Codable, Equatable, Hashable {
    /// weekly | fortnightly | none
    var every: String
    var media: Bool?
}

struct CoachSettings: Codable, Equatable, Hashable {
    var studioTools: Bool?
    var formChecks: Bool?
    var mealPhotos: Bool?
    var challenges: Bool?
    var replyExpectation: ReplyExpectation?
    var defaultMeetingUrl: String?
    var avatarMediaId: String?
    var signatureMediaId: String?
    var letterRhythm: [String: RhythmSetting]?
}

/// PATCH /api/coach/settings: only the keys set are sent.
struct CoachSettingsPatch: Encodable {
    var studioTools: Bool? = nil
    var formChecks: Bool? = nil
    var mealPhotos: Bool? = nil
    var challenges: Bool? = nil
    var replyExpectation: ReplyExpectation? = nil
}

struct ClientRhythm: Codable, Equatable, Hashable {
    var every: String?
    var days: Int?
    var media: Bool?
    var overridden: Bool?
}

struct CoachLineSetting: Codable, Equatable, Hashable {
    var text: String
    var setAt: Date?
}

struct ClientSettings: Codable, Equatable, Hashable {
    var dayMinimum: Int?
    var dayMinimumIsDefault: Bool?
    var letterRhythm: ClientRhythm?
    var letterRhythmOverride: String?
    var coachLine: CoachLineSetting?
}

/// PATCH /api/coach/clients/:id/settings.
struct ClientSettingsPatch: Encodable {
    var dayMinimum: Int?
    var letterRhythm: String?
}

// MARK: - Habits: the day rule

struct RestDay: Codable, Hashable, Identifiable {
    let date: String
    var reason: String?
    var grantedAt: Date?

    var id: String { date }
}

struct RestDayInput: Encodable {
    var date: String
    var reason: String?
}

struct Consistency: Codable, Hashable {
    var done: Int
    var days: Int
    var rest: Int?
    var window: Int?

    /// "22 of the last 27 days".
    var label: String { "\(done) of the last \(days) days" }
}

/// One day in /api/habits/week and /api/today's `week`.
struct DayState: Codable, Hashable, Identifiable {
    let date: String
    var done: Bool?
    var rest: Bool?
    var restReason: String?
    var doneCount: Int?
    var total: Int?
    var minimum: Int?
    var today: Bool?
    var future: Bool?

    var id: String { date }
}

struct HabitWeekResponse: Codable {
    var from: String?
    var to: String?
    var dayMinimum: Int?
    let days: [DayState]
}

/// `ClientSummary.habitWeek`: done | notDone | rest.
struct HabitWeekDay: Codable, Hashable {
    let date: String
    let state: String
}

struct HabitHistoryDay: Codable, Hashable {
    let date: String
    var value: Double?
    var done: Bool?
    var source: String?
    var rest: Bool?
}

struct HabitHistoryEntry: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var kind: String?
    var target: Double?
    var unit: String?
    var icon: String?
    var iconKey: String?
    var days: [HabitHistoryDay]
    var rate7: Double?
    var rate7Prev: Double?
    var rate28: Double?

    var key: IconKey { IconKey(stored: iconKey ?? icon) }
}

struct HistoryDay: Codable, Hashable {
    let date: String
    var dayDone: Bool?
    var rest: Bool?
    var restReason: String?
    var doneCount: Int?
    var total: Int?
    var minimum: Int?
}

struct HabitHistory: Codable {
    var from: String?
    var to: String?
    let habits: [HabitHistoryEntry]
    var days: [HistoryDay]?
    var consistency: Consistency?
}

/// POST/PATCH /api/habits (coach). `icon` is kept for old builds.
struct HabitEdit: Encodable {
    var clientId: String?
    var name: String
    var kind: String
    var target: Double
    var unit: String
    var iconKey: String
    var icon: String
    var step: Double?
    var healthKind: String?
}

// MARK: - Goals

struct WeekOf: Codable, Hashable {
    let week: Int
    let weeks: Int
}

struct Goal: Codable, Hashable, Identifiable {
    let id: String
    var clientId: String?
    var title: String
    /// weight | waist | measurement | record | habit | custom
    var metric: String
    var exerciseId: String?
    var exerciseName: String?
    var measureKey: String?
    var habitId: String?
    var unit: String?
    var baseline: Double?
    var target: Double?
    var startDate: String?
    var targetDate: String?
    var why: String?
    /// draft | active | reached | paused
    var status: String
    var chapterName: String?
    var suggestion: String?
    var updatedAt: Date?
    var current: Double?
    var delta: Double?
    var progressPct: Double?
    var remaining: Double?
    var reached: Bool?
    var remainingLabel: String?
    var weekOf: WeekOf?
    var onTrack: Bool?
    var sourceLabel: String?

    var isDraft: Bool { status == "draft" }
    var isReached: Bool { reached == true || status == "reached" }
    var fraction: Double { min(max((progressPct ?? 0) / 100, 0), 1) }
}

struct GoalResponse: Codable {
    var goal: Goal?
    var pending: Bool?
}

struct GoalsResponse: Codable { let goals: [Goal] }

/// POST /api/goals and PATCH /api/goals/:id.
struct GoalInput: Encodable {
    var clientId: String?
    var title: String
    var metric: String
    var unit: String?
    var baseline: Double?
    var target: Double?
    var startDate: String?
    var targetDate: String?
    var chapterName: String?
    var status: String?
}

// MARK: - Today

struct CoachLine: Codable, Hashable {
    let text: String
    /// letter | message | override
    var source: String?
    var letterId: String?
    var messageId: String?
    var unread: Bool?
    var at: Date?
    var caption: String?
    var staleAfterDays: Int?
}

struct NextItem: Codable, Hashable {
    var workoutId: String?
    var bookingId: String?
    var date: String?
    var start: String?
    var meetingUrl: String?
    var week: String?
    var formRequestId: String?
}

struct AlsoDue: Codable, Hashable {
    let kind: String
    var label: String?
}

struct NextUp: Codable, Hashable {
    /// session | videoCall | checkin | form | workout | booking | rest | membership
    let kind: String
    let title: String
    var detail: String?
    var buttonLabel: String?
    /// startSession | join | details | checkin | form | viewSession | yourWeek | membership
    var action: String?
    var item: NextItem?
    var alsoDue: [AlsoDue]?
}

struct TodayPayload: Codable {
    let date: String
    var firstName: String?
    var plan: String?
    var features: Features?
    var goal: Goal?
    var goalPending: Bool?
    var coachLine: CoachLine?
    var habits: [Habit]?
    var dayDone: Bool?
    var doneCount: Int?
    var dayMinimum: Int?
    var rest: RestDay?
    var consistency: Consistency?
    var missedYesterday: Bool?
    var week: [DayState]?
    var next: NextUp?
    var unreadMessages: Int?
}

// MARK: - Letters

struct LetterDot: Codable, Hashable {
    let date: String
    var done: Bool?
    var rest: Bool?
    var future: Bool?
}

struct Score: Codable, Hashable {
    let key: String
    let label: String
    let value: String
    var source: String?
}

struct FeelRating: Codable, Hashable {
    var workoutId: String?
    var title: String?
    var date: String?
    var feel: Int?
    var word: String?
}

/// GET /api/checkins/draft: the week's read-only figures.
struct CheckinDraft: Codable, Hashable {
    var week: String?
    var weekEnd: String?
    var avgSteps: Double?
    var avgSleepMinutes: Double?
    var healthShared: Bool?
    var habits: Consistency?
    var sessionsDone: Int?
    var sessionsPlanned: Int?
    var feel: [FeelRating]?
}

struct MilestoneSuggestion: Codable, Hashable {
    let key: String
    var reason: String?
    var suggestedHeadline: String?
}

/// The composer's pinned context (coach reads only).
struct LetterContext: Codable, Hashable {
    var checkin: CheckIn?
    var week: CheckinDraft?
    var goal: Goal?
    var rhythm: ClientRhythm?
    var milestones: [MilestoneSuggestion]?
    var suggestedDeliverAt: Date?
}

/// `ClientDetail.latestCheckin`: a check-in whose `week` is the week's figures.
struct LatestCheckIn: Codable, Hashable {
    let id: String
    var week: CheckinDraft?
    var energy: Int?
    var sleep: Int?
    var pain: [String]?
    var note: String?
    var submittedAt: Date?
    var reviewedAt: Date?
    var stress: Int?
    var win: String?
    var struggle: String?
    var photoIds: [String]?
}

/// PUT /api/reports with the letter fields.
struct LetterInput: Encodable {
    var clientId: String
    var week: String?
    var id: String?
    var kind: String
    var headline: String
    var keep: String
    var adjust: String
    var question: String
    var mediaId: String?
    var milestoneKey: String?
    /// draft | published
    var status: String
    /// "now" or an ISO instant; nil = next Monday 07:00.
    var deliverAt: String?
}

struct AnswerInput: Encodable { var answer: String }
struct ReadReply: Codable { var ok: Bool?; var readAt: Date? }

// MARK: - Media

struct Media: Codable, Hashable, Identifiable {
    let id: String
    var kind: String?
    var mime: String?
    var bytes: Int?
    var durationSec: Double?
    var purpose: String?
    var url: String?
}

// MARK: - Timeline

struct TimelineForm: Codable, Hashable {
    let id: String
    let name: String
    var questionCount: Int?
    var submittedAt: Date?
}

struct PlanUpdate: Codable, Hashable {
    var from: String?
    var to: String?
    var count: Int?
    var text: String?
}

struct TimelineItem: Codable, Hashable, Identifiable {
    /// message | letter | checkin | form | planUpdate
    let kind: String
    let id: String
    let at: Date
    var message: Message?
    var letter: Report?
    var checkin: CheckIn?
    var form: TimelineForm?
    var planUpdate: PlanUpdate?
}

struct TimelineResponse: Codable {
    let items: [TimelineItem]
    var nextBefore: String?
    /// With `since=<cursor>`: message items changed or new since then (a transcript arriving).
    var updated: [TimelineItem]?
    var cursor: String?
}

// MARK: - Guides (client)

struct ClientGuide: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    var summary: String?
    var minutes: Int?
    var tags: [String]?
    /// Paragraphs split by a blank line; only on GET /api/client/guides/:id.
    var body: String?
}

struct ClientGuidesResponse: Codable { let guides: [ClientGuide] }

// MARK: - Workouts

struct CompleteInput: Encodable {
    var note: String?
    /// 1–5: Easy, Steady, Hard, Very hard, Max.
    var feel: Int?
}

enum Feel {
    static let words = ["Easy", "Steady", "Hard", "Very hard", "Max"]
    static func word(_ n: Int?) -> String? {
        guard let n, (1...5).contains(n) else { return nil }
        return words[n - 1]
    }
}

// MARK: - Coach: needs you

struct NeedsReason: Codable, Hashable {
    let kind: String
    let text: String
    var at: Date?
    var rank: Int?
    var iconKey: String?
    var milestoneKey: String?
    var suggestedHeadline: String?
}

struct NeedsAction: Codable, Hashable {
    /// reply | writeLetter | nudge | readAnswers
    let kind: String
    let label: String
}

struct NeedsItem: Codable, Hashable, Identifiable {
    let client: PersonRef
    var rank: Int?
    var priority: Bool?
    let reasons: [NeedsReason]
    var reasonLine: String?
    var primaryAction: NeedsAction?

    var id: String { client.id }
}

struct LettersDueClient: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var initials: String?
    var media: Bool?
    var every: String?
}

struct LettersDue: Codable, Hashable {
    var week: String?
    let count: Int
    var estMinutes: Int?
    var clients: [LettersDueClient]?
}

struct SessionsToday: Codable, Hashable {
    let total: Int
    let done: Int
    var next: Booking?
}

struct NeedsYou: Codable {
    var date: String?
    var sessionsToday: SessionsToday?
    var lettersDue: LettersDue?
    let items: [NeedsItem]
    var allCaughtUp: Bool?
}
