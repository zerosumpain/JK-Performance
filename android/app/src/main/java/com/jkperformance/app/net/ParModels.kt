@file:UseSerializers(InstantSerializer::class)

package com.jkperformance.app.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers

// Plan. Act. Review. (docs/design/plan-act-review.md, "API contract (client)").
// The server produces the words so both apps agree; every field is optional
// with a default, so a newer server adding keys or an older one missing them
// never breaks a screen.

// MARK: - GET /api/week

@Serializable
data class WeekPayload(
    val date: String = "",
    val dateLabel: String = "",
    val dayName: String = "",
    val greeting: String = "Hello",
    val firstName: String? = null,
    val days: List<WeekDayMark> = emptyList(),
    val today: WeekToday? = null,
    val plan: WeekSession? = null,
    val review: WeekSession? = null,
    val footer: String? = null,
    val unread: Int = 0,
)

@Serializable
data class WeekDayMark(
    val date: String = "",
    val letter: String = "",
    val today: Boolean = false,
    /** today | plan | review | null */
    val mark: String? = null,
    val done: Boolean = false,
)

@Serializable
data class WeekToday(
    val title: String = "",
    val progress: Double = 0.0,
    val workout: WeekWorkout? = null,
    val habits: List<WeekHabit> = emptyList(),
    val restDay: Boolean = false,
    val coachLine: String? = null,
)

@Serializable
data class WeekWorkout(
    val id: String,
    val title: String = "",
    val minutes: Int? = null,
    val completed: Boolean = false,
    val blocks: List<WeekBlock> = emptyList(),
)

@Serializable
data class WeekBlock(
    val itemId: String = "",
    val label: String = "",
    val done: Boolean = false,
)

@Serializable
data class WeekHabit(
    val id: String,
    val name: String = "",
    val iconKey: String? = null,
    /** check | count */
    val kind: String = "check",
    val doneToday: Boolean = false,
    val progress: Double = 0.0,
    val target: Double = 1.0,
    val value: Double? = null,
    val unit: String = "",
    /** Monday..Sunday: true done, false not done (past), null future or before the habit existed. */
    val week: List<Boolean?> = emptyList(),
) {
    val isCount: Boolean get() = kind == "count"
}

@Serializable
data class WeekSession(
    val bookingId: String? = null,
    val title: String = "",
    val `when`: String = "",
    val start: String? = null,
    val dayIndex: Int? = null,
)

// MARK: - GET /api/direction

@Serializable
data class DirectionPayload(
    val locked: Boolean = false,
    val feature: String? = null,
    val aim: String? = null,
    val plannedOn: String? = null,
    val plannedLabel: String? = null,
    val season: Season? = null,
    val priorities: List<Priority> = emptyList(),
    val planning: Planning? = null,
    val prep: Prep? = null,
)

@Serializable
data class Season(
    val start: String = "",
    val end: String = "",
    val today: String = "",
    val next: String? = null,
    val labels: SeasonLabels = SeasonLabels(),
    val progress: Double = 0.0,
    val phaseWord: String? = null,
)

@Serializable
data class SeasonLabels(
    val start: String = "",
    val next: String? = null,
    val end: String = "",
)

@Serializable
data class Priority(
    val id: String = "",
    val title: String = "",
    /** notyet | settling | building | strong */
    val status: String = "notyet",
    val statusWord: String? = null,
    val progress: Double? = null,
) {
    /** The ring's fill by status, when the server does not say. */
    val fraction: Double
        get() = progress ?: when (status) {
            "settling" -> 0.33
            "building" -> 0.66
            "strong" -> 1.0
            else -> 0.0
        }
    val word: String
        get() = statusWord ?: when (status) {
            "settling" -> "Settling in"
            "building" -> "Building"
            "strong" -> "Strong"
            else -> "Not yet"
        }
}

@Serializable
data class Planning(
    val bookingId: String? = null,
    val `when`: String = "",
    val whenShort: String? = null,
    val start: String? = null,
)

@Serializable
data class Prep(
    val id: String? = null,
    val feeling: Int? = null,
    val feelingWord: String? = null,
    val easier: String? = null,
    val inTheWay: String? = null,
    val sharedAt: String? = null,
)

/** PUT /api/direction/prep. Absent fields are left as they are. */
@Serializable
data class PrepInput(
    val feeling: Int? = null,
    val easier: String? = null,
    val inTheWay: String? = null,
    val share: Boolean? = null,
)

// MARK: - GET /api/review

@Serializable
data class ReviewPayload(
    val locked: Boolean = false,
    val feature: String? = null,
    val week: String? = null,
    val label: String? = null,
    val booking: ReviewBooking? = null,
    val reflection: Reflection? = null,
    val commitments: List<Commitment> = emptyList(),
    val session: ReviewSession? = null,
)

@Serializable
data class ReviewBooking(
    val bookingId: String? = null,
    val `when`: String = "",
    val start: String? = null,
)

@Serializable
data class Reflection(
    val feeling: Int? = null,
    val feelingWord: String? = null,
    val noticed: String? = null,
    val sharedAt: String? = null,
)

@Serializable
data class Commitment(
    val id: String,
    val text: String = "",
    /** kept | mostly | missed | null */
    val outcome: String? = null,
)

@Serializable
data class ReviewSession(
    val pending: Boolean = false,
    val with: String? = null,
    val notes: String = "",
    val letterId: String? = null,
    val shape: MonthShape? = null,
    val agreed: List<Commitment> = emptyList(),
    val agreedWeek: String? = null,
    val acceptedAt: String? = null,
)

@Serializable
data class MonthShape(
    val weeks: List<ShapeWeekEntry> = emptyList(),
    val trend: String? = null,
)

@Serializable
data class ShapeWeekEntry(
    val week: String = "",
    val feeling: Int = 3,
    val word: String = "",
)

/** POST /api/review/reflection: autosave-friendly partial input. An outcome of null clears it. */
@Serializable
data class ReflectionInput(
    val feeling: Int? = null,
    val noticed: String? = null,
    val outcomes: Map<String, String?>? = null,
    val share: Boolean? = null,
)

@Serializable
data class AcceptInput(val week: String)

/** Words the server also sends, for the moments before it answers (and older servers). */
object ParWords {
    val reviewFeelings = listOf("Flat", "Stretched", "Steady", "Good", "Strong")

    /** 1–5. */
    fun reviewFeeling(feeling: Int?): String = feeling?.let { reviewFeelings.getOrNull(it - 1) } ?: "How was it?"

    /** 0–100. */
    fun prepFeeling(feeling: Int?): String = when {
        feeling == null -> "How was it?"
        feeling < 20 -> "Hard going"
        feeling < 40 -> "Up and down"
        feeling < 60 -> "Okay"
        feeling < 80 -> "Mostly good"
        else -> "Flowing"
    }

    fun outcome(outcome: String?): String? = when (outcome) {
        "kept" -> "KEPT"
        "mostly" -> "MOSTLY"
        "missed" -> "MISSED"
        else -> null
    }

    /** none → kept → mostly → missed → none. */
    fun nextOutcome(outcome: String?): String? = when (outcome) {
        null -> "kept"
        "kept" -> "mostly"
        "mostly" -> "missed"
        else -> null
    }

    private val numbers = listOf("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve")

    /** "Three sets of eight", for the session; falls back to figures. */
    fun setsAndReps(sets: Int, reps: String): String {
        val s = numbers.getOrNull(sets)?.takeIf { it.isNotEmpty() } ?: "$sets"
        val noun = if (sets == 1) "set" else "sets"
        val r = reps.trim().toIntOrNull()
        val repWord = r?.let { numbers.getOrNull(it)?.lowercase() } ?: reps.trim()
        if (repWord.isEmpty()) return "$s $noun"
        return "$s $noun of $repWord"
    }

    private val romans = listOf("i", "ii", "iii", "iv", "v")
    fun roman(index: Int): String = romans.getOrElse(index) { "${index + 1}" }
}
