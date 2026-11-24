package com.jkperformance.app.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import kotlinx.serialization.Serializable
import org.junit.Test
import java.io.File

/** `GET /api/me`, just the part the fixture carries. */
@Serializable
data class FeaturesEnvelope(val features: Features)

/**
 * Decodes every voice fixture of the WP6 apps contract (docs/api/wp6-ai-voice.md,
 * copied into src/test/resources/fixtures/voice) with the app's one JSON setup.
 */
class VoiceDecodingTest {
    private fun text(name: String): String =
        javaClass.classLoader!!.getResource("fixtures/voice/$name.json")!!.readText()

    private fun message(name: String): Message = ApiJson.decodeFromString(Message.serializer(), text(name))

    @Test
    fun everyFixtureDecodes() {
        val dir = File(javaClass.classLoader!!.getResource("fixtures/voice")!!.toURI())
        val names = dir.listFiles()!!.map { it.nameWithoutExtension }.sorted()
        assertTrue("expected the contract's fixtures", names.size >= 15)
        for (name in names) {
            when (name) {
                "voice-consent" -> ApiJson.decodeFromString(VoiceConsent.serializer(), text(name))
                "voice-me-features" -> ApiJson.decodeFromString(FeaturesEnvelope.serializer(), text(name))
                "voice-messages-since" -> ApiJson.decodeFromString(MessagesResponse.serializer(), text(name))
                "voice-timeline-since" -> ApiJson.decodeFromString(TimelineResponse.serializer(), text(name))
                else -> assertTrue(name, message(name).isVoice)
            }
        }
    }

    @Test
    fun pendingHasAPlayerAndNoTranscript() {
        val m = message("voice-pending")
        val v = m.voice!!
        assertEquals(VoiceState.pending, v.state)
        assertNull(m.mediaId)
        assertNull(m.mediaUrl)
        assertEquals("audio", m.mediaKind)
        assertEquals("/api/media/md_Vt3kq0Lw8sYb", v.url)
        assertTrue(v.playable)
        assertNull(v.transcript)
        assertEquals("Transcribing…", VoiceCopy.status(v, asClient = true))
    }

    @Test
    fun coachViewCarriesTheAnalysis() {
        val v = message("voice-done-coach-view").voice!!
        assertEquals(VoiceState.done, v.state)
        assertTrue(v.hasAnalysis)
        assertEquals("steady", v.mood)
        assertEquals(-0.2, v.sentiment!!, 1e-9)
        assertEquals(listOf("knee", "running", "lunges"), v.topics)
        assertEquals("coach", v.actions!!.first().owner)
        assertEquals("pain", v.flags!!.single().kind)
        assertEquals("Pain", VoiceCopy.flag(v.flags!!.single().kind))
        assertEquals("Automatic transcript, may contain mistakes", VoiceCopy.status(v, asClient = false))
    }

    @Test
    fun clientViewHasNoAnalysis() {
        val v = message("voice-done-client-view").voice!!
        assertEquals(VoiceState.done, v.state)
        assertFalse(v.hasAnalysis)
        assertNull(v.summary)
        assertNull(v.flags)
        assertNotNull(v.transcript)
    }

    @Test
    fun stubTranscriptIsLabelled() {
        val v = message("voice-done-stub").voice!!
        assertEquals("Sample transcript (AI is off)", VoiceCopy.status(v, asClient = true))
    }

    @Test
    fun offReasonsHaveTheirCopy() {
        assertEquals("Transcripts are off", VoiceCopy.status(message("voice-off-aiOff").voice!!, asClient = true))
        assertEquals("Transcript not available today", VoiceCopy.status(message("voice-off-quota").voice!!, asClient = false))
        val noConsent = message("voice-off-noConsent").voice!!
        assertEquals("Not transcribed", VoiceCopy.status(noConsent, asClient = false))
        assertEquals("You chose no transcription", VoiceCopy.status(noConsent, asClient = true))
        assertTrue(VoiceCopy.offersChange(noConsent, asClient = true))
        assertFalse(VoiceCopy.offersChange(noConsent, asClient = false))
    }

    @Test
    fun failedAndUnknownStatus() {
        assertEquals("Couldn't transcribe this one", VoiceCopy.status(message("voice-failed").voice!!, asClient = true))
        val unknown = message("voice-unknown-status").voice!!
        assertEquals(VoiceState.failed, unknown.state)
        assertEquals("Couldn't transcribe this one", VoiceCopy.status(unknown, asClient = true))
    }

    @Test
    fun deletedHasNoPlayer() {
        val m = message("voice-deleted")
        val v = m.voice!!
        assertEquals(VoiceState.deleted, v.state)
        assertFalse(v.playable)
        assertEquals("Voice note deleted", VoiceCopy.status(v, asClient = true))
        assertEquals("Voice note deleted", m.text)
    }

    @Test
    fun coachCaptionIsTheText() {
        val m = message("voice-from-coach-caption")
        assertEquals("coach", m.fromRole)
        assertEquals("Plan for this week", m.text)
        assertEquals("Plan for this week", VoiceCopy.preview(m))
        assertEquals("0:27", VoiceCopy.clock(m.voice!!.durationSec))
    }

    @Test
    fun meFeaturesGateTheMic() {
        val features = ApiJson.decodeFromString(FeaturesEnvelope.serializer(), text("voice-me-features"))
        val gate = Gate(features.features)
        assertTrue(gate.voiceNotes)
        assertEquals(300, gate.voiceMaxSec)
        assertEquals("ask", gate.voiceTranscription)
        // An older server: no mic, and a sensible cap.
        val old = Gate(Features())
        assertFalse(old.voiceNotes)
        assertEquals(300, old.voiceMaxSec)
    }

    @Test
    fun messagesSinceMergesUpdatedById() {
        val reply = ApiJson.decodeFromString(MessagesResponse.serializer(), text("voice-messages-since"))
        assertEquals("2026-11-24T08:14:31.004Z", reply.cursor)
        val pending = message("voice-pending")
        val merged = mergeById(listOf(pending), reply.updated!!) { it.id }
        assertEquals(1, merged.size)
        assertEquals(VoiceState.done, merged.single().voice!!.state)
    }

    @Test
    fun timelineSinceMergesUpdatedById() {
        val reply = ApiJson.decodeFromString(TimelineResponse.serializer(), text("voice-timeline-since"))
        assertNotNull(reply.cursor)
        assertEquals(VoiceState.pending, reply.items.single().message!!.voice!!.state)
        val merged = mergeById(reply.items, reply.updated!!) { it.id }
        assertEquals(VoiceState.done, merged.single().message!!.voice!!.state)
    }

    @Test
    fun mergeAppendsUnknownRows() {
        val merged = mergeById(listOf("a" to 1, "b" to 2), listOf("b" to 3, "c" to 4)) { it.first }
        assertEquals(listOf("a" to 1, "b" to 3, "c" to 4), merged)
    }

    @Test
    fun clockRounds() {
        assertEquals("0:00", VoiceCopy.clock(null))
        assertEquals("0:42", VoiceCopy.clock(42.4))
        assertEquals("5:00", VoiceCopy.clock(300.0))
    }
}
