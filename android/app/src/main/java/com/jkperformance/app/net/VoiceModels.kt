package com.jkperformance.app.net

import kotlinx.serialization.Serializable

// Voice notes in messages (docs/design/desk-v2.md F19, docs/api/wp6-ai-voice.md,
// "Apps contract"). A voice note is a message with kind "voice": its audio is in
// `voice.url`, never in the top-level mediaId (old builds would draw that as a
// photo). Every field but `status` is optional, and an unknown status reads as
// failed. Analysis fields arrive only when the server decides the caller is the
// coach; there are no coach builds.

/** One action item the analysis found ("Send a deload week", owner coach). */
@Serializable
data class VoiceAction(
    var text: String = "",
    /** coach | client */
    var owner: String? = null,
)

/** One worded flag (pain, injury, illness, mentalHealth, safeguarding, cancelIntent, billing). */
@Serializable
data class VoiceFlag(
    var kind: String = "",
    var quote: String? = null,
    /** low | medium | high */
    var severity: String? = null,
)

/** The `voice` block of a voice message. */
@Serializable
data class VoiceInfo(
    /** pending | done | failed | off | deleted; anything else reads as failed ([state]). */
    val status: String,
    /** Null only when deleted. */
    var mediaId: String? = null,
    /** `/api/media/md_…`, a signed-in GET of an AAC m4a. Null only when deleted. */
    var url: String? = null,
    /** The server's probed length; may be null on a server without ffmpeg. */
    var durationSec: Double? = null,
    /** aiOff | quota | noConsent, only when off. */
    var reason: String? = null,
    /** Only when done (and null again after the retention rule). */
    var transcript: String? = null,
    /** stub | openrouter, only when done. */
    var provider: String? = null,
    var model: String? = null,
    // Coach view only (a client never receives these).
    var summary: String? = null,
    var mood: String? = null,
    var sentiment: Double? = null,
    var topics: List<String>? = null,
    var actions: List<VoiceAction>? = null,
    var flags: List<VoiceFlag>? = null,
    var listenedAt: String? = null,
) {
    val state: VoiceState get() = VoiceState.from(status)

    /** The audio can be played (everything but a deleted note). */
    val playable: Boolean get() = state != VoiceState.deleted && url != null

    /** Whether the server sent any coach-only analysis. */
    val hasAnalysis: Boolean
        get() = summary != null || mood != null || !topics.isNullOrEmpty() || !actions.isNullOrEmpty() || !flags.isNullOrEmpty()
}

enum class VoiceState {
    pending, done, failed, off, deleted;

    companion object {
        /** The contract: an unknown status decodes as failed. */
        fun from(raw: String?): VoiceState = entries.firstOrNull { it.name == raw } ?: failed
    }
}

/** What each state says, coach and client (the copy table in the contract). */
object VoiceCopy {
    /** The line under the player. [asClient]: the signed-in person is the client. */
    fun status(v: VoiceInfo, asClient: Boolean): String = when (v.state) {
        VoiceState.pending -> "Transcribing…"
        VoiceState.done -> when {
            v.transcript == null -> "Transcript removed"
            v.provider == "stub" -> "Sample transcript (AI is off)"
            else -> "Automatic transcript, may contain mistakes"
        }
        VoiceState.failed -> "Couldn't transcribe this one"
        VoiceState.off -> when (v.reason) {
            "quota" -> "Transcript not available today"
            "noConsent" -> if (asClient) "You chose no transcription" else "Not transcribed"
            else -> "Transcripts are off"
        }
        VoiceState.deleted -> "Voice note deleted"
    }

    /** The client may change a "no transcription" choice from the bubble. */
    fun offersChange(v: VoiceInfo, asClient: Boolean): Boolean =
        asClient && v.state == VoiceState.off && v.reason == "noConsent"

    /** A flag in words: "Pain", "Wants to cancel". */
    fun flag(kind: String): String = when (kind) {
        "pain" -> "Pain"
        "injury" -> "Injury"
        "illness" -> "Illness"
        "mentalHealth" -> "Low mood"
        "safeguarding" -> "Safeguarding"
        "cancelIntent" -> "Wants to cancel"
        "billing" -> "Billing"
        else -> kind.replaceFirstChar { it.uppercase() }
    }

    /** "Mood: low". */
    fun mood(mood: String?): String? = mood?.takeIf { it.isNotEmpty() && it != "unknown" }?.let { "Mood: $it" }

    /** 42.0 → "0:42"; null or negative → "0:00". */
    fun clock(seconds: Double?): String {
        val s = Math.round((seconds ?: 0.0).coerceAtLeast(0.0)).toInt()
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }

    /** Thread-list preview of a voice message: its text is already "Voice note · 0:42" or the caption. */
    fun preview(m: Message): String = when {
        m.text.isNotEmpty() -> m.text
        else -> "Voice note · ${clock(m.voice?.durationSec ?: m.durationSec)}"
    }
}

/** `GET /api/voice/consent` and the reply of `PUT /api/voice/consent`. */
@Serializable
data class VoiceConsent(
    /** ask | on | off */
    var voice: String = "ask",
    var at: String? = null,
)

@Serializable
data class VoiceConsentInput(
    /** on | off */
    var voice: String,
)

/** The reply of `POST /api/media?purpose=voice`. */
@Serializable
data class VoiceUpload(
    val id: String,
    var kind: String? = null,
    var mime: String? = null,
    var durationSec: Double? = null,
    var url: String? = null,
)

/** Merges `updated` (from a `since=` poll) into a list by id: changed rows replace, unknown ones append. */
fun <T> mergeById(current: List<T>, updated: List<T>, id: (T) -> String): List<T> {
    if (updated.isEmpty()) return current
    val fresh = updated.associateBy(id)
    val known = current.map(id).toSet()
    return current.map { fresh[id(it)] ?: it } + updated.filter { id(it) !in known }
}
