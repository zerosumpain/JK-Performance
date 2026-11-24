@file:UseSerializers(InstantSerializer::class)

package com.jkperformance.app.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.time.Instant

// Campaigns and guides, the client side (docs/design/desk-v2.md F13, F14;
// docs/api/wp4-campaigns.md, "For the apps"). Money is integer pence, days are
// London "YYYY-MM-DD" strings. Everything the server derives is optional, so a
// missing key never breaks the Today screen.

/** The campaign as an invitation or enrolment carries it. */
@Serializable
data class CampaignRef(
    val id: String,
    var name: String = "",
    var tagline: String? = null,
    var description: String? = null,
    var coverUrl: String? = null,
    /** fixed | rolling */
    var startMode: String? = null,
    var startsOn: String? = null,
    var endsOn: String? = null,
    var lengthDays: Int? = null,
    var welcomeText: String? = null,
)

/** One kit line in an invitation: name and expected price. */
@Serializable
data class KitLine(
    var name: String = "",
    var estPence: Int = 0,
)

@Serializable
data class InvitationKit(
    var required: List<KitLine> = emptyList(),
    var optional: List<KitLine> = emptyList(),
    var requiredPence: Int = 0,
    var optionalPence: Int = 0,
)

/** What a client sees before committing (invitationOut). */
@Serializable
data class Invitation(
    val enrolmentId: String,
    /** invited | waitlisted */
    var status: String = "invited",
    val campaign: CampaignRef,
    var feePence: Int = 0,
    var discountPence: Int = 0,
    var discountCode: String? = null,
    var kit: InvitationKit = InvitationKit(),
    /** Required kit plus planned purchases; the fee is extra. */
    var expectedSpendPence: Int = 0,
    /** Null: no capacity limit. */
    var placesLeft: Int? = null,
    var respondBy: String? = null,
    var welcomeText: String? = null,
) {
    /** The fee after any discount. */
    val feeDuePence: Int get() = (feePence - discountPence).coerceAtLeast(0)
    val waitlisted: Boolean get() = status == "waitlisted"
}

/** A linked guide (`id`, `title`: fetch it) or inline blocks. */
@Serializable
data class GuideRef(
    var id: String? = null,
    var title: String? = null,
    var blocks: List<GuideBlock>? = null,
)

/** One dated activity (activityOut). */
@Serializable
data class CampaignActivity(
    val id: String,
    var day: Int = 0,
    var date: String? = null,
    var title: String = "",
    /** task | workout | habit | checkin | read | purchase | session | measure | custom */
    var kind: String = "task",
    var detail: String = "",
    var points: Int = 0,
    var required: Boolean = true,
    var spendPence: Int = 0,
    var guide: GuideRef? = null,
    var done: Boolean = false,
    var doneAt: Instant? = null,
    var spentPence: Int? = null,
)

@Serializable
data class CampaignRank(val position: Int, val of: Int)

/**
 * An enrolment of the client's (MyEnrolment). In the detail reply for an open
 * invitation it is only `{id, status, invitation}`, so everything else is optional.
 */
@Serializable
data class MyEnrolment(
    val id: String,
    /** active | paused | completed (or invited | waitlisted in a detail reply) */
    var status: String = "active",
    var campaign: CampaignRef? = null,
    var day: Int? = null,
    var lengthDays: Int? = null,
    var startOn: String? = null,
    var endsOn: String? = null,
    var pct: Int = 0,
    var points: Int = 0,
    var today: List<CampaignActivity> = emptyList(),
    var next: List<CampaignActivity> = emptyList(),
    var rank: CampaignRank? = null,
    var planUrl: String? = null,
    var invitation: Invitation? = null,
) {
    val active: Boolean get() = status == "active"
}

/** `GET /api/campaigns/mine`. */
@Serializable
data class MyCampaigns(
    var invitations: List<Invitation> = emptyList(),
    var enrolments: List<MyEnrolment> = emptyList(),
)

@Serializable
data class CampaignPhase(
    val id: String,
    var name: String = "",
    var startDay: Int = 0,
    var endDay: Int = 0,
    var color: String? = null,
    var summary: String? = null,
    var startsOn: String? = null,
    var guide: GuideRef? = null,
)

/** A kit item with the client's bought tick and what they say they spent. */
@Serializable
data class CampaignKit(
    val id: String,
    var name: String = "",
    var estPence: Int = 0,
    var required: Boolean = false,
    var url: String? = null,
    var note: String = "",
    var position: Int = 0,
    var bought: Boolean = false,
    var spentPence: Int? = null,
)

/** `GET /api/campaigns/mine/:enrolmentId`. */
@Serializable
data class CampaignDetail(
    val enrolment: MyEnrolment,
    var campaign: CampaignRef? = null,
    var phases: List<CampaignPhase> = emptyList(),
    var activities: List<CampaignActivity> = emptyList(),
    var kit: List<CampaignKit> = emptyList(),
)

/** `POST /api/campaigns/mine/:enrolmentId/items/:itemId`. */
@Serializable
data class CampaignTick(
    var done: Boolean,
    var spentPence: Int? = null,
)

@Serializable
data class CampaignTickResult(
    var pct: Int? = null,
    var points: Int? = null,
    var pace: Double? = null,
)

@Serializable
data class StartOnInput(var startOn: String? = null)

@Serializable
data class AcceptResult(val enrolment: MyEnrolment)

@Serializable
data class OkResult(var ok: Boolean? = null)

// MARK: - Guides (F14)

/**
 * One guide block. The type is `t`; the rest depends on it, so every field is
 * optional and an unknown `t` is skipped by the renderer, never a decode error.
 */
@Serializable
data class GuideBlock(
    /** h | p | list | callout | image | video | audio | link | exercise | divider */
    val t: String,
    var text: String? = null,
    /** bullet | number | check */
    var style: String? = null,
    var items: List<String>? = null,
    /** tip | warn | info */
    var tone: String? = null,
    var mediaId: String? = null,
    var caption: String? = null,
    /** A media block: the client URL of the file. A link block: the https target. */
    var url: String? = null,
    var label: String? = null,
    var exerciseId: String? = null,
)

/** `GET /api/guides/coach/:guideId`. */
@Serializable
data class CoachGuide(
    val id: String,
    var title: String = "",
    var summary: String? = null,
    var tags: List<String>? = null,
    var readMinutes: Int? = null,
    var blocks: List<GuideBlock> = emptyList(),
    var updatedAt: Instant? = null,
)

@Serializable
data class CoachGuideResponse(val guide: CoachGuide)

/** Words for campaign figures, shared by the cards and the detail. */
object CampaignText {
    /** "Day 24 of 84". */
    fun dayOf(e: MyEnrolment): String? {
        val day = e.day ?: return null
        val length = e.lengthDays ?: e.campaign?.lengthDays ?: return "Day $day"
        return "Day ${day.coerceIn(1, length)} of $length"
    }

    /** "12 weeks" for a whole number of weeks, else "30 days". */
    fun length(days: Int?): String? = days?.let { if (it % 7 == 0 && it >= 14) "${it / 7} weeks" else "$it days" }

    /** "3rd of 4". */
    fun rank(r: CampaignRank): String {
        val n = r.position
        val suffix = if (n % 100 in 11..13) "th" else when (n % 10) { 1 -> "st"; 2 -> "nd"; 3 -> "rd"; else -> "th" }
        return "$n$suffix of ${r.of}"
    }

    /** "2 places left", "1 place left", or null without a limit. */
    fun places(left: Int?): String? = left?.let { if (it <= 0) "Full: you'd join the waitlist" else if (it == 1) "1 place left" else "$it places left" }

    /** A word for an activity kind. */
    fun kind(kind: String): String = when (kind) {
        "workout" -> "Workout"
        "habit" -> "Habit"
        "checkin" -> "Check-in"
        "read" -> "Read"
        "purchase" -> "Buy"
        "session" -> "Session"
        "measure" -> "Measure"
        else -> "Task"
    }
}
