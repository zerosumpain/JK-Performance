@file:UseSerializers(InstantSerializer::class)

package com.jkperformance.app.net

import com.jkperformance.app.design.IconKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

// Serializable types for the Atelier additions (docs/API.md, "Atelier redesign
// additions"), ported from ios/JKPerformance/Net/AtelierModels.swift.
// Everything the server derives is optional, so an older server or a missing
// key never breaks decoding.

// MARK: - Features, preferences, coach settings

/** `Me.features`: plan features plus the coach's toggles. Every key optional. */
@Serializable
data class Features(
    var programme: Boolean? = null,
    var messaging: Boolean? = null,
    var habits: Boolean? = null,
    var progress: Boolean? = null,
    var checkin: Boolean? = null,
    var sessions: Boolean? = null,
    var nutrition: Boolean? = null,
    var priority: Boolean? = null,
    var guides: Boolean? = null,
    var formChecks: Boolean? = null,
    var mealPhotos: Boolean? = null,
    var challenges: Boolean? = null,
    var hasMacroTargets: Boolean? = null,
)

/**
 * What this client's plan includes. With no `features` (an older server)
 * everything a plan could promise shows, as before; coach toggles that did
 * not exist then stay off, except challenges, which every client saw.
 */
data class Gate(val features: Features?) {
    val known: Boolean get() = features != null
    val programme: Boolean get() = features?.programme ?: true
    val messaging: Boolean get() = features?.messaging ?: true
    val habits: Boolean get() = features?.habits ?: true
    val progress: Boolean get() = features?.progress ?: true
    val checkin: Boolean get() = features?.checkin ?: true
    val sessions: Boolean get() = features?.sessions ?: true
    val nutrition: Boolean get() = features?.nutrition ?: true
    val priority: Boolean get() = features?.priority ?: false
    val guides: Boolean get() = features?.guides ?: true
    val formChecks: Boolean get() = features?.formChecks ?: false
    val mealPhotos: Boolean get() = features?.mealPhotos ?: false
    val challenges: Boolean get() = features?.challenges ?: true
    val hasMacroTargets: Boolean? get() = features?.hasMacroTargets

    /** Free: nothing but guides. */
    val isFree: Boolean get() = known && !messaging && !checkin && !habits && !progress
}

@Serializable
data class ReplyExpectation(
    var standard: String? = null,
    var priority: String? = null,
)

@Serializable
data class Preferences(
    var notificationsOn: Boolean? = null,
    /** "HH:MM" or null. */
    var eveningReminderTime: String? = null,
)

@Serializable
data class RhythmSetting(
    /** weekly | fortnightly | none */
    var every: String,
    var media: Boolean? = null,
)

@Serializable
data class CoachSettings(
    var studioTools: Boolean? = null,
    var formChecks: Boolean? = null,
    var mealPhotos: Boolean? = null,
    var challenges: Boolean? = null,
    var replyExpectation: ReplyExpectation? = null,
    var defaultMeetingUrl: String? = null,
    var avatarMediaId: String? = null,
    var signatureMediaId: String? = null,
    var letterRhythm: Map<String, RhythmSetting>? = null,
)

/** PATCH /api/coach/settings: only the keys set are sent. */
@Serializable
data class CoachSettingsPatch(
    var studioTools: Boolean? = null,
    var formChecks: Boolean? = null,
    var mealPhotos: Boolean? = null,
    var challenges: Boolean? = null,
    var replyExpectation: ReplyExpectation? = null,
)

@Serializable
data class ClientRhythm(
    var every: String? = null,
    var days: Int? = null,
    var media: Boolean? = null,
    var overridden: Boolean? = null,
)

@Serializable
data class CoachLineSetting(
    var text: String,
    var setAt: Instant? = null,
)

@Serializable
data class ClientSettings(
    var dayMinimum: Int? = null,
    var dayMinimumIsDefault: Boolean? = null,
    var letterRhythm: ClientRhythm? = null,
    var letterRhythmOverride: String? = null,
    var coachLine: CoachLineSetting? = null,
)

/** PATCH /api/coach/clients/:id/settings. */
@Serializable
data class ClientSettingsPatch(
    var dayMinimum: Int? = null,
    var letterRhythm: String? = null,
)

// MARK: - Habits: the day rule

@Serializable
data class RestDay(
    val date: String,
    var reason: String? = null,
    var grantedAt: Instant? = null,
) {
    val id: String get() = date
}

@Serializable
data class RestDayInput(
    var date: String,
    var reason: String? = null,
)

@Serializable
data class Consistency(
    var done: Int,
    var days: Int,
    var rest: Int? = null,
    var window: Int? = null,
) {
    /** "22 of the last 27 days". */
    val label: String get() = "$done of the last $days days"
}

/** One day in /api/habits/week and /api/today's `week`. */
@Serializable
data class DayState(
    val date: String,
    var done: Boolean? = null,
    var rest: Boolean? = null,
    var restReason: String? = null,
    var doneCount: Int? = null,
    var total: Int? = null,
    var minimum: Int? = null,
    var today: Boolean? = null,
    var future: Boolean? = null,
) {
    val id: String get() = date
}

@Serializable
data class HabitWeekResponse(
    var from: String? = null,
    var to: String? = null,
    var dayMinimum: Int? = null,
    val days: List<DayState>,
)

/** `ClientSummary.habitWeek`: done | notDone | rest. */
@Serializable
data class HabitWeekDay(
    val date: String,
    val state: String,
)

@Serializable
data class HabitHistoryDay(
    val date: String,
    var value: Double? = null,
    var done: Boolean? = null,
    var source: String? = null,
    var rest: Boolean? = null,
)

@Serializable
data class HabitHistoryEntry(
    val id: String,
    val name: String,
    var kind: String? = null,
    var target: Double? = null,
    var unit: String? = null,
    var icon: String? = null,
    var iconKey: String? = null,
    var days: List<HabitHistoryDay>,
    var rate7: Double? = null,
    var rate7Prev: Double? = null,
    var rate28: Double? = null,
) {
    val key: IconKey get() = IconKey.fromSymbol(iconKey ?: icon)
}

@Serializable
data class HistoryDay(
    val date: String,
    var dayDone: Boolean? = null,
    var rest: Boolean? = null,
    var restReason: String? = null,
    var doneCount: Int? = null,
    var total: Int? = null,
    var minimum: Int? = null,
)

@Serializable
data class HabitHistory(
    var from: String? = null,
    var to: String? = null,
    val habits: List<HabitHistoryEntry>,
    var days: List<HistoryDay>? = null,
    var consistency: Consistency? = null,
)

/** POST/PATCH /api/habits (coach). `icon` is kept for old builds. */
@Serializable
data class HabitEdit(
    var clientId: String? = null,
    var name: String,
    var kind: String,
    var target: Double,
    var unit: String,
    var iconKey: String,
    var icon: String,
    var step: Double? = null,
    var healthKind: String? = null,
)

// MARK: - Goals

@Serializable
data class WeekOf(
    val week: Int,
    val weeks: Int,
)

@Serializable
data class Goal(
    val id: String,
    var clientId: String? = null,
    var title: String,
    /** weight | waist | measurement | record | habit | custom */
    var metric: String,
    var exerciseId: String? = null,
    var exerciseName: String? = null,
    var measureKey: String? = null,
    var habitId: String? = null,
    var unit: String? = null,
    var baseline: Double? = null,
    var target: Double? = null,
    var startDate: String? = null,
    var targetDate: String? = null,
    var why: String? = null,
    /** draft | active | reached | paused */
    var status: String,
    var chapterName: String? = null,
    var suggestion: String? = null,
    var updatedAt: Instant? = null,
    var current: Double? = null,
    var delta: Double? = null,
    var progressPct: Double? = null,
    var remaining: Double? = null,
    var reached: Boolean? = null,
    var remainingLabel: String? = null,
    var weekOf: WeekOf? = null,
    var onTrack: Boolean? = null,
    var sourceLabel: String? = null,
) {
    val isDraft: Boolean get() = status == "draft"
    val isReached: Boolean get() = reached == true || status == "reached"
    val fraction: Double get() = ((progressPct ?: 0.0) / 100).coerceIn(0.0, 1.0)
}

@Serializable
data class GoalResponse(
    var goal: Goal? = null,
    var pending: Boolean? = null,
)

@Serializable
data class GoalsResponse(val goals: List<Goal>)

/** POST /api/goals and PATCH /api/goals/:id. */
@Serializable
data class GoalInput(
    var clientId: String? = null,
    var title: String,
    var metric: String,
    var unit: String? = null,
    var baseline: Double? = null,
    var target: Double? = null,
    var startDate: String? = null,
    var targetDate: String? = null,
    var chapterName: String? = null,
    var status: String? = null,
)

// MARK: - Today

@Serializable
data class CoachLine(
    val text: String,
    /** letter | message | override */
    var source: String? = null,
    var letterId: String? = null,
    var messageId: String? = null,
    var unread: Boolean? = null,
    var at: Instant? = null,
    var caption: String? = null,
    var staleAfterDays: Int? = null,
)

@Serializable
data class NextItem(
    var workoutId: String? = null,
    var bookingId: String? = null,
    var date: String? = null,
    var start: String? = null,
    var meetingUrl: String? = null,
    var week: String? = null,
    var formRequestId: String? = null,
)

@Serializable
data class AlsoDue(
    val kind: String,
    var label: String? = null,
)

@Serializable
data class NextUp(
    /** session | videoCall | checkin | form | workout | booking | rest | membership */
    val kind: String,
    val title: String,
    var detail: String? = null,
    var buttonLabel: String? = null,
    /** startSession | join | details | checkin | form | viewSession | yourWeek | membership */
    var action: String? = null,
    var item: NextItem? = null,
    var alsoDue: List<AlsoDue>? = null,
)

@Serializable
data class TodayPayload(
    val date: String,
    var firstName: String? = null,
    var plan: String? = null,
    var features: Features? = null,
    var goal: Goal? = null,
    var goalPending: Boolean? = null,
    var coachLine: CoachLine? = null,
    var habits: List<Habit>? = null,
    var dayDone: Boolean? = null,
    var doneCount: Int? = null,
    var dayMinimum: Int? = null,
    var rest: RestDay? = null,
    var consistency: Consistency? = null,
    var missedYesterday: Boolean? = null,
    var week: List<DayState>? = null,
    var next: NextUp? = null,
    var unreadMessages: Int? = null,
)

// MARK: - Letters

@Serializable
data class LetterDot(
    val date: String,
    var done: Boolean? = null,
    var rest: Boolean? = null,
    var future: Boolean? = null,
)

@Serializable
data class Score(
    val key: String,
    val label: String,
    val value: String,
    var source: String? = null,
)

@Serializable
data class FeelRating(
    var workoutId: String? = null,
    var title: String? = null,
    var date: String? = null,
    var feel: Int? = null,
    var word: String? = null,
)

/** GET /api/checkins/draft: the week's read-only figures. */
@Serializable
data class CheckinDraft(
    var week: String? = null,
    var weekEnd: String? = null,
    var avgSteps: Double? = null,
    var avgSleepMinutes: Double? = null,
    var healthShared: Boolean? = null,
    var habits: Consistency? = null,
    var sessionsDone: Int? = null,
    var sessionsPlanned: Int? = null,
    var feel: List<FeelRating>? = null,
)

@Serializable
data class MilestoneSuggestion(
    val key: String,
    var reason: String? = null,
    var suggestedHeadline: String? = null,
)

/** The composer's pinned context (coach reads only). */
@Serializable
data class LetterContext(
    var checkin: CheckIn? = null,
    var week: CheckinDraft? = null,
    var goal: Goal? = null,
    var rhythm: ClientRhythm? = null,
    var milestones: List<MilestoneSuggestion>? = null,
    var suggestedDeliverAt: Instant? = null,
)

/** `ClientDetail.latestCheckin`: a check-in whose `week` is the week's figures. */
@Serializable
data class LatestCheckIn(
    val id: String,
    var week: CheckinDraft? = null,
    var energy: Int? = null,
    var sleep: Int? = null,
    var pain: List<String>? = null,
    var note: String? = null,
    var submittedAt: Instant? = null,
    var reviewedAt: Instant? = null,
    var stress: Int? = null,
    var win: String? = null,
    var struggle: String? = null,
    var photoIds: List<String>? = null,
)

/** PUT /api/reports with the letter fields. */
@Serializable
data class LetterInput(
    var clientId: String,
    var week: String? = null,
    var id: String? = null,
    var kind: String,
    var headline: String,
    var keep: String,
    var adjust: String,
    var question: String,
    var mediaId: String? = null,
    var milestoneKey: String? = null,
    /** draft | published */
    var status: String,
    /** "now" or an ISO instant; null = next Monday 07:00. */
    var deliverAt: String? = null,
)

@Serializable
data class AnswerInput(var answer: String)

@Serializable
data class ReadReply(var ok: Boolean? = null, var readAt: Instant? = null)

// MARK: - Media

@Serializable
data class Media(
    val id: String,
    var kind: String? = null,
    var mime: String? = null,
    var bytes: Int? = null,
    var durationSec: Double? = null,
    var purpose: String? = null,
    var url: String? = null,
)

// MARK: - Timeline

@Serializable
data class TimelineForm(
    val id: String,
    val name: String,
    var questionCount: Int? = null,
    var submittedAt: Instant? = null,
)

@Serializable
data class PlanUpdate(
    var from: String? = null,
    var to: String? = null,
    var count: Int? = null,
    var text: String? = null,
)

@Serializable
data class TimelineItem(
    /** message | letter | checkin | form | planUpdate */
    val kind: String,
    val id: String,
    val at: Instant,
    var message: Message? = null,
    var letter: Report? = null,
    var checkin: CheckIn? = null,
    var form: TimelineForm? = null,
    var planUpdate: PlanUpdate? = null,
)

@Serializable
data class TimelineResponse(
    val items: List<TimelineItem>,
    var nextBefore: String? = null,
)

// MARK: - Guides (client)

@Serializable
data class ClientGuide(
    val id: String,
    val title: String,
    var summary: String? = null,
    var minutes: Int? = null,
    var tags: List<String>? = null,
    /** Paragraphs split by a blank line; only on GET /api/client/guides/:id. */
    var body: String? = null,
)

@Serializable
data class ClientGuidesResponse(val guides: List<ClientGuide>)

// MARK: - Workouts

@Serializable
data class CompleteInput(
    var note: String? = null,
    /** 1–5: Easy, Steady, Hard, Very hard, Max. */
    var feel: Int? = null,
)

object Feel {
    val words = listOf("Easy", "Steady", "Hard", "Very hard", "Max")
    fun word(n: Int?): String? = n?.takeIf { it in 1..5 }?.let { words[it - 1] }
}

// MARK: - Coach: needs you

@Serializable
data class NeedsReason(
    val kind: String,
    val text: String,
    var at: Instant? = null,
    var rank: Int? = null,
    var iconKey: String? = null,
    var milestoneKey: String? = null,
    var suggestedHeadline: String? = null,
)

@Serializable
data class NeedsAction(
    /** reply | writeLetter | nudge | readAnswers */
    val kind: String,
    val label: String,
)

@Serializable
data class NeedsItem(
    val client: PersonRef,
    var rank: Int? = null,
    var priority: Boolean? = null,
    val reasons: List<NeedsReason>,
    var reasonLine: String? = null,
    var primaryAction: NeedsAction? = null,
) {
    val id: String get() = client.id
}

@Serializable
data class LettersDueClient(
    val id: String,
    val name: String,
    var initials: String? = null,
    var media: Boolean? = null,
    var every: String? = null,
)

@Serializable
data class LettersDue(
    var week: String? = null,
    val count: Int,
    var estMinutes: Int? = null,
    var clients: List<LettersDueClient>? = null,
)

@Serializable
data class SessionsToday(
    val total: Int,
    val done: Int,
    var next: Booking? = null,
)

@Serializable
data class NeedsYou(
    var date: String? = null,
    var sessionsToday: SessionsToday? = null,
    var lettersDue: LettersDue? = null,
    val items: List<NeedsItem>,
    var allCaughtUp: Boolean? = null,
)
