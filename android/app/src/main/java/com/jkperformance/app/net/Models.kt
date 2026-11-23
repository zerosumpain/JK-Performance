@file:UseSerializers(InstantSerializer::class)
@file:Suppress("ClassName")

package com.jkperformance.app.net

import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.IconKey
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Transient
import kotlinx.serialization.UseSerializers
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.util.UUID

// Serializable types for the v1 API (docs/API.md), ported one to one from
// ios/JKPerformance/Net/Models.swift. Field names match the contract exactly.
// Calendar days ("YYYY-MM-DD") stay strings; instants decode to `Instant`
// (InstantSerializer). Swift optionals are nullable with a null default;
// Swift `let` is `val` and `var` is `var`.

// MARK: - Auth & account

@Serializable
data class Session(
    val token: String,
    val me: Me,
)

@Serializable
data class Me(
    val id: String,
    var name: String,
    var email: String? = null,
    var role: String,
    var isDemo: Boolean? = null,
    var createdAt: Instant? = null,
    var membership: Membership? = null,
    var coach: PersonRef? = null,
    /** Clients: whether they've said yes to their coach seeing their health data. */
    var healthSharing: Boolean? = null,
    /** False for a new client who hasn't been through the first-run questions; null (older servers) counts as done. */
    var onboarded: Boolean? = null,
    /** Clients: their first-run answers, null until answered. */
    var profile: Profile? = null,
    /** Plan features plus coach toggles (docs/API.md, Atelier). Missing on an older server: show everything. */
    var features: Features? = null,
    var preferences: Preferences? = null,
    /** A coach's own settings; null for clients. */
    var coachSettings: CoachSettings? = null,
) {
    /** What this client's plan includes (everything, on an older server). */
    val gate: Gate get() = Gate(features)
    val isCoach: Boolean get() = role == "coach"
    val needsOnboarding: Boolean get() = !isCoach && onboarded == false
    val demo: Boolean get() = isDemo == true
    val firstName: String get() = name.split(" ").firstOrNull { it.isNotEmpty() } ?: name
}

@Serializable
data class Membership(
    var plan: String,
    var planName: String? = null,
    var since: String? = null,
    var renewsOn: String? = null,
    var creditsLeft: Int? = null,
    var creditsTotal: Int? = null,
    var creditsResetOn: String? = null,
) {
    val isActive: Boolean get() = plan != "none"
    val displayName: String get() = planName ?: Fmt.planName(plan)
}

@Serializable
data class PersonRef(
    val id: String,
    val name: String,
    var initials: String? = null,
    /** The coach's portrait (GET /api/media/:id with the session token); null until uploaded or on older servers. */
    var avatarMediaId: String? = null,
    var signatureMediaId: String? = null,
    var replyExpectation: ReplyExpectation? = null,
    /** The reply line this client sees ("Same-day replies" on plans with 'priority'). */
    var replyLine: String? = null,
    /** Clients in a needs-you item. */
    var firstName: String? = null,
    var plan: String? = null,
    var planName: String? = null,
) {
    val displayInitials: String get() = initials ?: Fmt.initials(name)
}

/**
 * A client's first-run answers. Every field may be missing: each question can be skipped.
 * goals: strength | muscle | fatloss | fitness | performance | mobility | health;
 * experience: new | some | experienced; preferredTime: morning | midday | evening | varies.
 */
@Serializable
data class Profile(
    var goals: List<String>? = null,
    var experience: String? = null,
    var daysPerWeek: Int? = null,
    var preferredTime: String? = null,
    var injuries: String? = null,
    var answeredAt: Instant? = null,
) {
    /** True when every question was skipped. */
    val isEmpty: Boolean
        get() = goals.isNullOrEmpty() && experience == null && daysPerWeek == null && preferredTime == null && injuries.isNullOrBlank()
}

/** PUT /api/me/onboarding. `done: false` saves answers without finishing. */
@Serializable
data class OnboardingInput(
    var goals: List<String>? = null,
    var experience: String? = null,
    var daysPerWeek: Int? = null,
    var preferredTime: String? = null,
    var injuries: String? = null,
    var done: Boolean = true,
)

@Serializable
data class Plan(
    val id: String,
    val name: String,
    val detail: String,
    val monthlyPence: Int,
    val annualPence: Int,
    val credits: Int,
    /** The longer sales line for the walkthrough. */
    var pitch: String? = null,
    /** The one "most popular" plan. */
    var featured: Boolean? = null,
    /** Feature ids, in catalogue order. */
    var features: List<String>? = null,
    var updatedAt: Instant? = null,
) {
    val isFree: Boolean get() = id == "none"
    val isFeatured: Boolean get() = featured == true
    val featureIds: List<String> get() = features.orEmpty()
}

/** One entry of the fixed feature catalogue; the apps draw each with its own icon and preview. */
@Serializable
data class Feature(
    val id: String,
    val title: String,
    val detail: String,
    var points: List<String> = emptyList(),
)

@Serializable
data class PlansResponse(
    val plans: List<Plan>,
    var features: List<Feature> = emptyList(),
)

/** PUT /api/coach/plans/:id: the full set of a plan's editable fields. */
@Serializable
data class PlanInput(
    var name: String,
    var detail: String,
    var pitch: String,
    var monthlyPence: Int,
    var annualPence: Int,
    var credits: Int,
    var featured: Boolean,
    var features: List<String>,
)

@Serializable
data class OK(
    var ok: Boolean? = null,
    var refunded: Boolean? = null,
)

// MARK: - Exercises

@Serializable
data class Exercise(
    val id: String,
    val name: String,
    val equipment: String,
    val pattern: String,
    val category: String,
    var videoUrl: String? = null,
)

@Serializable
data class ExercisesResponse(val exercises: List<Exercise>)

@Serializable
data class ExerciseInput(
    var name: String,
    var equipment: String,
    var pattern: String,
    var category: String,
    var videoUrl: String? = null,
)

// MARK: - Workouts

@Serializable
data class LoggedSet(
    val number: Int,
    val load: String,
    val reps: Int,
    /** 1–10, or null when not given. */
    var rpe: Double? = null,
    var at: Instant? = null,
)

@Serializable
data class WorkoutItem(
    val id: String,
    val order: Int,
    val exercise: Exercise,
    val sets: Int,
    val reps: String,
    val load: String,
    var rpe: String? = null,
    var note: String? = null,
    var logged: List<LoggedSet>,
    var previous: String? = null,
    /** "3-1-1" (down-pause-drive, optional top pause); null when JK set none. */
    var tempo: String? = null,
) {
    val isDone: Boolean get() = logged.size >= sets && sets > 0
}

@Serializable
data class Workout(
    val id: String,
    val clientId: String,
    val date: String,
    val title: String,
    var startsAt: String? = null,
    var location: String? = null,
    var notes: String? = null,
    var published: Boolean,
    var publishedAt: Instant? = null,
    var editedAt: Instant? = null,
    var editedBy: String? = null,
    var completedAt: Instant? = null,
    var createdBy: String? = null,
    var items: List<WorkoutItem>,
    var completionNote: String? = null,
    var feel: Int? = null,
    var feelWord: String? = null,
) {
    val doneCount: Int get() = items.count { it.isDone }
}

@Serializable
data class WorkoutSummary(
    val id: String,
    val clientId: String,
    val date: String,
    val title: String,
    var startsAt: String? = null,
    var location: String? = null,
    var notes: String? = null,
    var published: Boolean,
    var publishedAt: Instant? = null,
    var editedAt: Instant? = null,
    var editedBy: String? = null,
    var completedAt: Instant? = null,
    var createdBy: String? = null,
    var itemCount: Int,
    var doneCount: Int,
)

@Serializable
data class WorkoutsResponse(val workouts: List<WorkoutSummary>)

/**
 * One row of a workout or program being edited. `exerciseName` and `localId`
 * are app-only: the name is read from `exercise` on a Program item (falling
 * back to the id) and neither is ever sent.
 */
@Serializable(with = WorkoutItemInputSerializer::class)
data class WorkoutItemInput(
    /** Existing item id (keeps its logged sets on PUT); null for a new row. */
    var id: String? = null,
    var exerciseId: String,
    var exerciseName: String,
    var sets: Int = 3,
    var reps: String = "10",
    var load: String = "",
    var rpe: String? = null,
    var note: String? = null,
    /** Carried through untouched so a phone edit keeps the tempo the desk set. */
    var tempo: String? = null,
    val localId: UUID = UUID.randomUUID(),
) {
    constructor(item: WorkoutItem) : this(
        id = item.id, exerciseId = item.exercise.id, exerciseName = item.exercise.name, sets = item.sets,
        reps = item.reps, load = item.load, rpe = item.rpe, note = item.note, tempo = item.tempo,
    )
}

/** The wire shape of WorkoutItemInput: `exercise` is read leniently, never written. */
@Serializable
private class WorkoutItemInputWire(
    val id: String? = null,
    val exerciseId: String,
    val exercise: JsonElement? = null,
    val sets: Int,
    val reps: String,
    val load: String? = null,
    val rpe: String? = null,
    val note: String? = null,
    val tempo: String? = null,
)

object WorkoutItemInputSerializer : KSerializer<WorkoutItemInput> {
    override val descriptor: SerialDescriptor = WorkoutItemInputWire.serializer().descriptor

    override fun serialize(encoder: Encoder, value: WorkoutItemInput) =
        encoder.encodeSerializableValue(
            WorkoutItemInputWire.serializer(),
            WorkoutItemInputWire(value.id, value.exerciseId, null, value.sets, value.reps, value.load, value.rpe, value.note, value.tempo),
        )

    override fun deserialize(decoder: Decoder): WorkoutItemInput {
        val w = decoder.decodeSerializableValue(WorkoutItemInputWire.serializer())
        val name = ((w.exercise as? JsonObject)?.get("name") as? JsonPrimitive)?.takeIf { it.isString }?.content
        return WorkoutItemInput(
            id = w.id, exerciseId = w.exerciseId, exerciseName = name ?: w.exerciseId, sets = w.sets,
            reps = w.reps, load = w.load ?: "", rpe = w.rpe, note = w.note, tempo = w.tempo,
        )
    }
}

@Serializable
data class WorkoutInput(
    var date: String,
    var title: String,
    var startsAt: String? = null,
    var location: String? = null,
    var notes: String? = null,
    var items: List<WorkoutItemInput>,
    var clientId: String? = null,
)

@Serializable
data class SetInput(
    var load: String,
    var reps: Int,
    /** 1–10; omitted when not given. */
    var rpe: Double? = null,
)

@Serializable
data class NoteInput(var note: String? = null)

// MARK: - Programs

@Serializable
data class ProgramWorkout(
    var dayOffset: Int,
    var title: String,
    var items: List<WorkoutItemInput>,
    @Transient val localId: UUID = UUID.randomUUID(),
) {
    val id: UUID get() = localId
}

/** ProgramInput plus `id`, `clientCount` and `updatedAt`; each item also carries its `exercise`. */
@Serializable
data class Program(
    val id: String,
    var name: String,
    var detail: String,
    var daysPerWeek: Int,
    var weeks: Int,
    var workouts: List<ProgramWorkout>,
    var clientCount: Int? = null,
    var updatedAt: Instant? = null,
)

@Serializable
data class ProgramInput(
    var name: String,
    var detail: String,
    var daysPerWeek: Int,
    var weeks: Int,
    var workouts: List<ProgramWorkout>,
)

@Serializable
data class ProgramsResponse(val programs: List<Program>)

@Serializable
data class AssignInput(var clientId: String, var startDate: String)

@Serializable
data class AssignResponse(val created: Int)

// MARK: - Habits & nutrition

@Serializable
data class Habit(
    val id: String,
    val name: String,
    val kind: String,
    val target: Double,
    val unit: String,
    val icon: String,
    /** "steps" | "sleep" when the phone's health data fills the value (sleep in hours). */
    var healthKind: String? = null,
    var value: Double? = null,
    var done: Boolean,
    var source: String? = null,
    /** The closed IconKey catalogue name; older servers send only `icon`. */
    var iconKey: String? = null,
    /** The +/- increment for count habits. */
    var step: Double? = null,
    var introducedAt: Instant? = null,
    var position: Int? = null,
) {
    val isCount: Boolean get() = kind == "count"
    val key: IconKey get() = IconKey.fromSymbol(iconKey ?: icon)
    /** One tap's worth: the coach's step, else a tenth of the target, at least 1. */
    val increment: Double get() = step ?: maxOf(1.0, Math.rint(target / 10))
    /** 0..1 of today's target. */
    val fraction: Double
        get() {
            if (done) return 1.0
            val v = value ?: return 0.0
            if (target <= 0) return 0.0
            return (v / target).coerceIn(0.0, 1.0)
        }
    val fromHealth: Boolean get() = source == "health" || healthKind != null
}

@Serializable
data class HabitInput(
    var clientId: String,
    var name: String,
    var kind: String,
    var target: Double,
    var unit: String,
    var icon: String,
    /** "steps" | "sleep" fills the habit from health data; null omits it. */
    var healthKind: String? = null,
)

@Serializable
data class HabitDayInput(
    var value: Double? = null,
    var done: Boolean? = null,
)

@Serializable
data class Macros(
    var kcal: Double,
    var protein: Double,
    var carbs: Double,
    var fat: Double,
)

@Serializable
data class FoodEntry(
    val id: String,
    val name: String,
    val kcal: Double,
    val protein: Double,
    val carbs: Double,
    val fat: Double,
    var at: Instant? = null,
)

@Serializable
data class Nutrition(
    val date: String,
    var targets: Macros? = null,
    var totals: Macros,
    var entries: List<FoodEntry>,
)

@Serializable
data class HabitsResponse(
    val date: String,
    val habits: List<Habit>,
    val streak: Int,
    val nutrition: Nutrition,
    var dayDone: Boolean? = null,
    var doneCount: Int? = null,
    var dayMinimum: Int? = null,
    var rest: RestDay? = null,
    var consistency: Consistency? = null,
    var missedYesterday: Boolean? = null,
)

@Serializable
data class TargetsInput(
    var clientId: String,
    var kcal: Double,
    var protein: Double,
    var carbs: Double,
    var fat: Double,
)

@Serializable
data class FoodInput(
    var date: String,
    var name: String,
    var kcal: Double,
    var protein: Double,
    var carbs: Double,
    var fat: Double,
)

// MARK: - Check-ins

@Serializable
data class CheckIn(
    val id: String,
    val clientId: String,
    val week: String,
    val energy: Int,
    val sleep: Int,
    val pain: List<String>,
    var note: String? = null,
    var submittedAt: Instant? = null,
    var reviewedAt: Instant? = null,
    var reply: String? = null,
    var stress: Int? = null,
    var win: String? = null,
    var struggle: String? = null,
    var photoIds: List<String>? = null,
)

@Serializable
data class CheckInsResponse(
    val checkins: List<CheckIn>,
    var dueWeek: String? = null,
)

@Serializable
data class CheckInInput(
    var energy: Int,
    var sleep: Int,
    var pain: List<String>,
    var note: String,
    var stress: Int? = null,
    var win: String? = null,
    var struggle: String? = null,
    var photoIds: List<String>? = null,
)

@Serializable
data class ReplyInput(var reply: String)

// MARK: - Messages

@Serializable
data class Message(
    val id: String,
    val clientId: String,
    val fromId: String,
    val fromRole: String,
    val text: String,
    var workoutId: String? = null,
    val at: Instant,
    var readAt: Instant? = null,
    /** text | letter | answer | formCheck | mealPhoto */
    var kind: String? = null,
    var reportId: String? = null,
    var exerciseId: String? = null,
    var mediaId: String? = null,
    var mediaUrl: String? = null,
)

@Serializable
data class MessagesResponse(val messages: List<Message>)

@Serializable
data class MessageThread(
    val client: PersonRef,
    var last: Message? = null,
    var unread: Int,
) {
    val id: String get() = client.id
}

@Serializable
data class ThreadsResponse(val threads: List<MessageThread>)

@Serializable
data class MessageInput(
    var text: String,
    var clientId: String? = null,
    var workoutId: String? = null,
    var reportId: String? = null,
    var exerciseId: String? = null,
    var mediaId: String? = null,
    var kind: String? = null,
)

// MARK: - Bookings & calendar

@Serializable
data class AvailabilityRule(
    /** 1 = Monday … 7 = Sunday. */
    var weekday: Int,
    var start: String,
    var end: String,
    var kind: String,
    var slotMinutes: Int,
    var location: String? = null,
    @Transient val localId: UUID = UUID.randomUUID(),
) {
    val id: UUID get() = localId
}

@Serializable
data class RulesPayload(var rules: List<AvailabilityRule>)

@Serializable
data class Slot(
    val start: Instant,
    val end: Instant,
    val kind: String,
    var location: String? = null,
    val open: Boolean,
) {
    val id: Instant get() = start
}

@Serializable
data class SlotsResponse(val slots: List<Slot>)

@Serializable
data class Booking(
    val id: String,
    val kind: String,
    val start: Instant,
    val end: Instant,
    var location: String? = null,
    var title: String? = null,
    var client: PersonRef? = null,
    var attendees: List<PersonRef>? = null,
    var attendeeCount: Int? = null,
    var capacity: Int? = null,
    var usesCredit: Boolean? = null,
    /** A client sees every group class of their coach; this says if they're in it. */
    var joined: Boolean? = null,
    var cancellable: Boolean? = null,
    var refundable: Boolean? = null,
    /** The booking's own meeting link, else the coach's default room for video calls. */
    var meetingUrl: String? = null,
    /** planning | review | null (Plan. Act. Review.). */
    var purpose: String? = null,
) {
    val isGroup: Boolean get() = kind == "group"

    /** Mine to show on a client's calendar: 1:1s, and classes they joined. */
    val isMine: Boolean get() = !isGroup || joined == true

    val kindLabel: String
        get() = when (kind) {
            "video" -> "Video"
            "group" -> "Group"
            else -> "1:1"
        }
}

@Serializable
data class BookingsResponse(val bookings: List<Booking>)

@Serializable
data class BookingInput(
    var start: Instant,
    var kind: String,
    var clientId: String? = null,
)

@Serializable
data class ClassInput(
    var title: String,
    var start: Instant,
    var end: Instant,
    var capacity: Int,
    var location: String,
)

// MARK: - Progress

@Serializable
data class SeriesPoint(
    val date: String,
    val value: Double,
)

@Serializable
data class WeightBlock(
    var latest: Double? = null,
    var delta: Double? = null,
    var series: List<SeriesPoint>,
)

@Serializable
data class StatBlock(
    val kind: String,
    var latest: Double? = null,
    var delta: Double? = null,
)

@Serializable
data class PersonalRecord(
    val exercise: String,
    val kg: Double,
    var gain: Double? = null,
    var date: String? = null,
    var isNewThisWeek: Boolean? = null,
)

@Serializable
data class ProgressData(
    var since: String? = null,
    var weight: WeightBlock? = null,
    var stats: List<StatBlock>,
    var records: List<PersonalRecord>,
)

@Serializable
data class MeasurementInput(
    var date: String,
    var kind: String,
    var value: Double,
)

@Serializable
data class Photo(
    val id: String,
    val date: String,
    var url: String? = null,
)

@Serializable
data class PhotosResponse(val photos: List<Photo>)

// MARK: - Health

@Serializable
data class HealthSample(
    val id: String,
    val kind: String,
    val start: Instant,
    val end: Instant,
    val value: Double,
)

@Serializable
data class HealthSamplesInput(val samples: List<HealthSample>)

@Serializable
data class StoredResponse(val stored: Int)

@Serializable
data class HealthSummary(
    var date: String? = null,
    var steps: Double? = null,
    var sleepMinutes: Double? = null,
    var restingHr: Double? = null,
    var activeKcal: Double? = null,
    var weight: Double? = null,
    var distanceKm: Double? = null,
)

@Serializable
data class HealthDevices(
    var appleHealth: Boolean,
    var lastSampleAt: Instant? = null,
    var activityCount: Int? = null,
    var lastActivityAt: Instant? = null,
    var sharing: Boolean? = null,
    var sharingSince: Instant? = null,
)

@Serializable
data class SharingInput(var share: Boolean)

/** A recorded workout from the phone's health data: a run, a ride, a gym session. */
@Serializable
data class HealthActivity(
    val id: String,
    val type: String,
    var date: String? = null,
    val start: Instant,
    val end: Instant,
    val minutes: Double,
    var kcal: Double? = null,
    var distanceKm: Double? = null,
    var avgHr: Double? = null,
    var source: String? = null,
) {
    val detail: String
        get() {
            val parts = mutableListOf(Fmt.duration(minutes))
            distanceKm?.takeIf { it > 0 }?.let { parts += "${Fmt.number(it)} km" }
            kcal?.takeIf { it > 0 }?.let { parts += "${Fmt.number(it, digits = 0)} kcal" }
            avgHr?.takeIf { it > 0 }?.let { parts += "${Fmt.number(it, digits = 0)} bpm" }
            return parts.joinToString(" · ")
        }
}

@Serializable
data class HealthActivitiesInput(val activities: List<HealthActivity>)

@Serializable
data class ActivitiesResponse(val activities: List<HealthActivity>)

/** Seven days of a client's health for their coach; empty unless shared. */
@Serializable
data class HealthWeek(
    val shared: Boolean,
    var sharedSince: Instant? = null,
    val days: List<HealthSummary>,
    val activities: List<HealthActivity>,
)

// MARK: - Challenges

@Serializable
data class LeaderRow(
    val rank: Int,
    val id: String,
    val name: String,
    var initials: String? = null,
    val value: Double,
    var isMe: Boolean? = null,
)

@Serializable
data class Challenge(
    val id: String,
    val title: String,
    var detail: String? = null,
    var metric: String? = null,
    val target: Double,
    var start: String? = null,
    var end: String? = null,
    var daysLeft: Int? = null,
    var members: Int? = null,
    var joined: Boolean? = null,
    /** Untyped in the contract: read as "my value" when a number and as "joined" when a bool. */
    var mine: LooseValue? = null,
    var leaderboard: List<LeaderRow>,
    var badges: Int? = null,
    var streak: Int? = null,
) {
    val myRow: LeaderRow? get() = leaderboard.firstOrNull { it.isMe == true }
    val isJoined: Boolean get() = joined ?: (myRow != null || mine?.flag == true || mine?.number != null)
    val myValue: Double get() = mine?.number ?: myRow?.value ?: 0.0
}

@Serializable
data class ChallengesResponse(val challenges: List<Challenge>)

// MARK: - Coach

@Serializable
data class CoachToday(
    var date: String? = null,
    val sessions: List<Booking>,
    val activeClients: Int,
    var totalClients: Int? = null,
    val unread: Int,
    var tip: Guide? = null,
    var feedbackDue: FeedbackDue? = null,
    var checkinsToReview: Int? = null,
    var attention: List<AttentionItem>? = null,
    var checkinClients: List<PersonAt>? = null,
    var formsToReview: Int? = null,
    var formClients: List<PersonAt>? = null,
    var unreadClients: List<PersonAt>? = null,
    var urgent: List<AttentionItem>? = null,
    var quiet: List<QuietClient>? = null,
    var upcoming: List<UpcomingStep>? = null,
    var sessionsLeftThisWeek: Int? = null,
)

/** A client with the moment something of theirs started waiting. */
@Serializable
data class PersonAt(
    val id: String,
    val name: String,
    var initials: String? = null,
    var at: Instant? = null,
) {
    val ref: PersonRef get() = PersonRef(id = id, name = name, initials = initials)
}

@Serializable
data class QuietClient(
    val id: String,
    val name: String,
    var initials: String? = null,
    val days: Int,
) {
    val ref: PersonRef get() = PersonRef(id = id, name = name, initials = initials)
}

@Serializable
data class UpcomingStep(
    val client: PersonRef,
    val date: String,
    val autoflow: String,
    val action: String,
)

@Serializable
data class FeedbackDue(
    val week: String,
    var dueBy: String? = null,
    val clients: List<PersonRef>,
)

@Serializable
data class ClientSummary(
    val id: String,
    val name: String,
    var initials: String? = null,
    var plan: String? = null,
    var since: String? = null,
    var adherence: Int? = null,
    var lastWorkoutAt: Instant? = null,
    var checkinDue: Boolean? = null,
    var flags: List<String>? = null,
    var unread: Int? = null,
    var lastMessageAt: Instant? = null,
    var demand: Demand? = null,
    /** The seven days ending today: done | notDone | rest. */
    var habitWeek: List<HabitWeekDay>? = null,
) {
    val displayInitials: String get() = initials ?: Fmt.initials(name)
}

/** Why a client is where they are in the list (the server sorts by it). */
@Serializable
data class Demand(
    /** urgent | message | form | checkin | quiet | inactive | ok */
    val kind: String,
    var reason: String? = null,
    var at: Instant? = null,
    var urgent: List<String>? = null,
    var quietDays: Int? = null,
)

@Serializable
data class ClientsResponse(val clients: List<ClientSummary>)

@Serializable
data class ClientDetail(
    val client: ClientSummary,
    /** Their first-run answers; null until answered. */
    var profile: Profile? = null,
    var healthShared: Boolean? = null,
    var health: HealthSummary? = null,
    var nextWorkout: Workout? = null,
    var goals: List<Goal>? = null,
    var settings: ClientSettings? = null,
    var restDays: List<RestDay>? = null,
    var latestCheckin: LatestCheckIn? = null,
    var nextBooking: Booking? = null,
)

@Serializable
data class PenceSample(
    val date: String,
    val pence: Int,
)

@Serializable
data class AttentionItem(
    val client: PersonRef,
    val reason: String,
    val kind: String,
)

@Serializable
data class PlanCount(
    val id: String,
    val name: String,
    val members: Int,
    var monthlyPence: Int? = null,
)

@Serializable
data class Business(
    var period: String? = null,
    val mrrPence: Int,
    var mrrDeltaPct: Double? = null,
    var series: List<PenceSample>,
    val active: Int,
    val new: Int,
    val churned: Int,
    var adherence: Int? = null,
    var attention: List<AttentionItem>,
    var plans: List<PlanCount>? = null,
)

/**
 * `Guide`: `{id, title, minutes, tags, body}`. Decoded leniently, as Swift
 * does: the id falls back to the title, the body to detail/summary/text, and
 * a field of the wrong type reads as missing.
 */
@Serializable(with = GuideSerializer::class)
data class Guide(
    val id: String,
    val title: String,
    val body: String,
    var category: String? = null,
    var tags: List<String> = emptyList(),
    var minutes: Int? = null,
    var url: String? = null,
    var icon: String? = null,
    var format: String? = null,
)

object GuideSerializer : KSerializer<Guide> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("Guide")

    override fun deserialize(decoder: Decoder): Guide {
        val json = decoder as? JsonDecoder ?: throw SerializationException("Guide reads JSON only")
        val o = json.decodeJsonElement() as? JsonObject ?: throw SerializationException("Guide must be an object")
        fun str(key: String) = (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val title = str("title") ?: throw SerializationException("Field 'title' is required for type with serial name 'Guide', but it was missing")
        return Guide(
            id = str("id") ?: title,
            title = title,
            body = str("body") ?: str("detail") ?: str("summary") ?: str("text") ?: "",
            category = str("category"),
            tags = runCatching { o["tags"]?.jsonArray?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } }
                .getOrNull() ?: emptyList(),
            minutes = (o["minutes"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull,
            url = str("url"),
            icon = str("icon"),
            format = str("format"),
        )
    }

    override fun serialize(encoder: Encoder, value: Guide) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("Guide writes JSON only")
        val fields = buildMap<String, JsonElement> {
            put("id", JsonPrimitive(value.id))
            put("title", JsonPrimitive(value.title))
            put("body", JsonPrimitive(value.body))
            value.category?.let { put("category", JsonPrimitive(it)) }
            put("tags", kotlinx.serialization.json.JsonArray(value.tags.map(::JsonPrimitive)))
            value.minutes?.let { put("minutes", JsonPrimitive(it)) }
            value.url?.let { put("url", JsonPrimitive(it)) }
            value.icon?.let { put("icon", JsonPrimitive(it)) }
            value.format?.let { put("format", JsonPrimitive(it)) }
        }
        json.encodeJsonElement(JsonObject(fields))
    }
}

@Serializable
data class GuidesResponse(
    var featured: Guide? = null,
    var tips: List<Guide>,
)

// MARK: - Loose values

/** A bool or a number. Anything else reads as neither. */
@Serializable(with = LooseValueSerializer::class)
data class LooseValue(
    val flag: Boolean? = null,
    val number: Double? = null,
)

object LooseValueSerializer : KSerializer<LooseValue> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun deserialize(decoder: Decoder): LooseValue {
        val json = decoder as? JsonDecoder ?: throw SerializationException("LooseValue reads JSON only")
        val p = json.decodeJsonElement() as? JsonPrimitive
        if (p == null || p is JsonNull || p.isString) return LooseValue()
        p.booleanOrNull?.let { return LooseValue(flag = it) }
        return LooseValue(number = p.doubleOrNull)
    }

    override fun serialize(encoder: Encoder, value: LooseValue) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("LooseValue writes JSON only")
        json.encodeJsonElement(value.number?.let(::JsonPrimitive) ?: JsonPrimitive(value.flag ?: false))
    }
}

// MARK: - Weekly feedback

@Serializable
data class ReportCheckIn(
    val energy: Int,
    val sleep: Int,
    val pain: List<String>,
    val note: String,
    var submittedAt: Instant? = null,
)

@Serializable
data class ActivityTotals(
    val count: Int,
    val minutes: Double,
    val types: List<String>,
)

/** The week's figures beside a report. Health ones are null unless shared. */
@Serializable
data class ReportStats(
    val workoutsPlanned: Int,
    val workoutsDone: Int,
    val setsLogged: Int,
    var habitsPct: Int? = null,
    var checkin: ReportCheckIn? = null,
    var weightStart: Double? = null,
    var weightEnd: Double? = null,
    val healthShared: Boolean,
    var avgSteps: Double? = null,
    var avgSleepMinutes: Double? = null,
    var activities: ActivityTotals? = null,
)

@Serializable
data class ReportPlan(
    val from: String,
    val to: String,
    val workouts: List<WorkoutSummary>,
)

/**
 * A coach's write-up of one client's week (Monday `week` to Sunday `weekEnd`).
 * `id` is null for a week the coach hasn't saved yet.
 */
@Serializable
data class Report(
    val id: String? = null,
    val clientId: String,
    val week: String,
    val weekEnd: String,
    var summary: String,
    var wins: String,
    var focus: String,
    val status: String,
    var publishedAt: Instant? = null,
    var readAt: Instant? = null,
    var updatedAt: Instant? = null,
    var coachName: String? = null,
    var stats: ReportStats? = null,
    var plan: ReportPlan? = null,
    // The letter (Atelier). Old servers leave these out; the old fields stand in.
    var kind: String? = null,
    var letterStatus: String? = null,
    var headline: String? = null,
    var keep: String? = null,
    var adjust: String? = null,
    var question: String? = null,
    var answer: String? = null,
    var answeredAt: Instant? = null,
    var mediaId: String? = null,
    var mediaKind: String? = null,
    var mediaUrl: String? = null,
    var durationSec: Double? = null,
    var goalId: String? = null,
    var deliverAt: Instant? = null,
    var deliveredAt: Instant? = null,
    var focusOverride: String? = null,
    var todayLine: String? = null,
    var milestoneKey: String? = null,
    var weekDots: List<LetterDot>? = null,
    var scoreTrio: List<Score>? = null,
    var context: LetterContext? = null,
) {
    val isPublished: Boolean get() = status == "published"
    val isUnread: Boolean get() = isPublished && readAt == null
    val isMilestone: Boolean get() = kind == "milestone"
    /** The headline, or the first sentence of an old report's summary. */
    val displayHeadline: String
        get() {
            headline?.takeIf { it.isNotEmpty() }?.let { return it }
            val first = summary.split('.', '!', '?').firstOrNull { it.isNotBlank() }?.trim()?.let { "$it." } ?: ""
            return first.ifEmpty { "Your week" }
        }
    val keepText: String get() = keep?.takeIf { it.isNotEmpty() } ?: wins
    val adjustText: String get() = adjust?.takeIf { it.isNotEmpty() } ?: focus
    val weekLabel: String get() = "Week of ${Fmt.dayMonth(week)}"
}

@Serializable
data class ReportsResponse(
    val reports: List<Report>,
    val unread: Int,
    val suggestedWeek: String,
)

@Serializable
data class ReportInput(
    var clientId: String,
    var week: String,
    var summary: String,
    var wins: String,
    var focus: String,
    var status: String,
)

// MARK: - Calendar feed and the web desk

@Serializable
data class CalendarFeed(
    val active: Boolean,
    var url: String? = null,
    var webcal: String? = null,
)

@Serializable
data class LinkCode(
    val code: String,
    val expiresAt: Instant,
    val url: String,
)

// MARK: - Forms

@Serializable
data class FormQuestion(
    var id: String,
    /** text | long | scale | yesno | choice */
    var kind: String,
    var label: String,
    var options: List<String>? = null,
    var flag: Boolean? = null,
    var required: Boolean? = null,
) {
    val isRequired: Boolean get() = required != false

    companion object {
        val kinds: List<Pair<String, String>> = listOf(
            "text" to "Short answer", "long" to "Long answer", "scale" to "Scale 1–5",
            "yesno" to "Yes / no", "choice" to "Choice",
        )

        fun kindName(kind: String): String = kinds.firstOrNull { it.first == kind }?.second ?: kind
    }
}

/**
 * One answer: text, a 1–5 number, yes/no, or a choice (text). On the wire it
 * is a bare JSON string, integer or boolean, like Swift's single-value coding.
 */
@Serializable(with = FormAnswerSerializer::class)
sealed class FormAnswer {
    data class text(val value: String) : FormAnswer()
    data class number(val value: Int) : FormAnswer()
    data class yes(val value: Boolean) : FormAnswer()

    val display: String
        get() = when (this) {
            is text -> value
            is number -> "$value / 5"
            is yes -> if (value) "Yes" else "No"
        }
}

object FormAnswerSerializer : KSerializer<FormAnswer> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun deserialize(decoder: Decoder): FormAnswer {
        val json = decoder as? JsonDecoder ?: throw SerializationException("FormAnswer reads JSON only")
        val p = json.decodeJsonElement().jsonPrimitive
        if (p is JsonNull) throw SerializationException("A form answer can't be null")
        if (p.isString) return FormAnswer.text(p.content)
        p.booleanOrNull?.let { return FormAnswer.yes(it) }
        p.doubleOrNull?.takeIf { it % 1.0 == 0.0 }?.let { return FormAnswer.number(it.toInt()) }
        throw SerializationException("Not a form answer: $p")
    }

    override fun serialize(encoder: Encoder, value: FormAnswer) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("FormAnswer writes JSON only")
        json.encodeJsonElement(
            when (value) {
                is FormAnswer.text -> JsonPrimitive(value.value)
                is FormAnswer.number -> JsonPrimitive(value.value)
                is FormAnswer.yes -> JsonPrimitive(value.value)
            },
        )
    }
}

@Serializable
data class FormTemplate(
    val name: String,
    var intro: String? = null,
    val questions: List<FormQuestion>,
)

@Serializable
data class CoachForm(
    val id: String,
    var name: String,
    var intro: String? = null,
    var questions: List<FormQuestion>,
    var sent: Int? = null,
    var waiting: Int? = null,
    var toReview: Int? = null,
)

@Serializable
data class FormsResponse(
    val forms: List<CoachForm>,
    var templates: List<FormTemplate>? = null,
)

@Serializable
data class FormInput(
    var name: String,
    var intro: String,
    var questions: List<FormQuestion>,
)

@Serializable
data class FormRequest(
    val id: String,
    var formId: String? = null,
    val name: String,
    var intro: String? = null,
    val questions: List<FormQuestion>,
    var client: PersonRef? = null,
    val sentAt: Instant,
    var answers: Map<String, FormAnswer>? = null,
    var submittedAt: Instant? = null,
    var reviewedAt: Instant? = null,
    var flagged: List<String>? = null,
    var fromAutoflow: Boolean? = null,
) {
    val isFlagged: Boolean get() = !flagged.isNullOrEmpty()
}

@Serializable
data class FormRequestsResponse(val requests: List<FormRequest>)

@Serializable
data class FormAnswersInput(val answers: Map<String, FormAnswer>)

@Serializable
data class ClientIdInput(val clientId: String)

// MARK: - Autoflows

@Serializable
data class AutoflowStep(
    var id: String,
    var day: Int,
    /** message | form | program */
    var action: String,
    var text: String? = null,
    var formId: String? = null,
    var programId: String? = null,
    var label: String? = null,
) {
    /** The SF Symbol name the iPhone shows; the screens map it to a Material icon. */
    val icon: String
        get() = when (action) {
            "message" -> "bubble.left"
            "form" -> "doc.text"
            else -> "dumbbell"
        }
}

@Serializable
data class AutoflowRun(
    val id: String,
    val autoflowId: String,
    var autoflowName: String? = null,
    var client: PersonRef? = null,
    val startDay: String,
    val stepsDone: Int,
    val steps: Int,
    var stoppedAt: Instant? = null,
    var next: Next? = null,
    var log: List<LogEntry>? = null,
) {
    @Serializable
    data class Next(val day: Int, val date: String, val label: String)

    @Serializable
    data class LogEntry(val stepId: String, val label: String, val at: Instant, val outcome: String)
}

@Serializable
data class Autoflow(
    val id: String,
    var name: String,
    /** join | manual */
    var trigger: String,
    var active: Boolean,
    var steps: List<AutoflowStep>,
    var runs: List<AutoflowRun>? = null,
)

@Serializable
data class AutoflowsResponse(val autoflows: List<Autoflow>)

@Serializable
data class AutoflowRunsResponse(val runs: List<AutoflowRun>)

@Serializable
data class AutoflowInput(
    var name: String,
    var trigger: String,
    var active: Boolean,
    var steps: List<AutoflowStep>,
)

@Serializable
data class EnrolInput(
    val clientId: String,
    var startDate: String? = null,
)
