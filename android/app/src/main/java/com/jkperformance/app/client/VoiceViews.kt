package com.jkperformance.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Media
import com.jkperformance.app.net.Message
import com.jkperformance.app.net.MessageInput
import com.jkperformance.app.net.VoiceConsent
import com.jkperformance.app.net.VoiceConsentInput
import com.jkperformance.app.net.VoiceCopy
import com.jkperformance.app.net.VoiceInfo
import com.jkperformance.app.net.VoiceState
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

// Voice notes both ways (docs/design/desk-v2.md F19, "Apps"; docs/api/wp6-ai-voice.md).
// The recorder is shared by the chat composers (300 s) and the letter composer
// (90 s); the bubble is chosen by kind == "voice", never by mediaId; one player
// per screen; the consent sheet comes before a client's first voice note.

// MARK: - Recorder

/**
 * Records an m4a (AAC in MPEG-4, mono 44.1 kHz) of at most [cap] seconds,
 * plays it back, and uploads it as [purpose] media (`voice` for chat, `letter`
 * for letters). State is Compose state; the screen calls [tick] about ten
 * times a second while recording or playing, which also samples the level.
 */
class VoiceRecorder(private val context: Context, val cap: Double, private val purpose: String) {
    var recording by mutableStateOf(false)
        private set
    var playing by mutableStateOf(false)
        private set
    var elapsed by mutableStateOf(0.0)
        private set
    var duration by mutableStateOf(0.0)
        private set
    var file by mutableStateOf<File?>(null)
        private set
    var error by mutableStateOf<String?>(null)

    /** Levels 0…1, newest last, while recording; kept as the preview's waveform. */
    val levels = mutableStateListOf<Float>()

    /** The playhead while previewing, seconds. */
    var position by mutableStateOf(0.0)
        private set

    private var recorder: MediaRecorder? = null
    private var player: MediaPlayer? = null
    private var startedAt = 0L

    /** 30 s before the cap (4:30 of 5:00). */
    val nearCap: Boolean get() = recording && cap - elapsed <= 30.0

    fun start() {
        error = null
        discard()
        val out = File(context.cacheDir, "$purpose-${UUID.randomUUID()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(44_100)
            r.setAudioEncodingBitRate(96_000)
            r.setMaxDuration((cap * 1000).toInt())
            r.setOutputFile(out.absolutePath)
            r.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) stop()
            }
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release()
            out.delete()
            error = "Couldn't start recording. Check the microphone isn't in use."
            return
        }
        recorder = r
        file = out
        startedAt = SystemClock.elapsedRealtime()
        elapsed = 0.0
        recording = true
    }

    fun stop() {
        val r = recorder ?: return
        elapsed = minOf((SystemClock.elapsedRealtime() - startedAt) / 1000.0, cap)
        duration = elapsed
        try {
            r.stop()
        } catch (_: RuntimeException) {
            // Stopped before any audio was captured: nothing usable.
            file?.delete()
            file = null
            duration = 0.0
        }
        r.release()
        recorder = null
        recording = false
    }

    /** Cancel a recording in progress (or drop a finished one): nothing is kept. */
    fun cancel() {
        if (recording) stop()
        discard()
    }

    fun tick() {
        val r = recorder
        if (recording && r != null) {
            elapsed = minOf((SystemClock.elapsedRealtime() - startedAt) / 1000.0, cap)
            val amplitude = runCatching { r.maxAmplitude }.getOrDefault(0)
            // A soft curve, so speech fills the meter without clipping it.
            levels += sqrt((amplitude / 32767f).coerceIn(0f, 1f))
            if (levels.size > MAX_LEVELS) levels.removeAt(0)
            if (elapsed >= cap) stop()
        }
        player?.let { if (playing) position = it.currentPosition / 1000.0 }
    }

    /**
     * Debug builds only: take an m4a pushed to the app's external files
     * directory (`adb push clip.m4a /sdcard/Android/data/<app>/files/test-clip.m4a`)
     * as if it had just been recorded. The emulator runs without audio input.
     */
    fun loadTestClip(): Boolean {
        if (!BuildConfig.DEBUG) return false
        val source = File(context.getExternalFilesDir(null), TEST_CLIP).takeIf { it.exists() } ?: return false
        discard()
        val copy = File(context.cacheDir, "$purpose-${UUID.randomUUID()}.m4a")
        source.copyTo(copy, overwrite = true)
        val seconds = runCatching {
            MediaMetadataRetriever().run {
                try {
                    setDataSource(copy.absolutePath)
                    (extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0
                } finally {
                    release()
                }
            }
        }.getOrDefault(0.0)
        file = copy
        duration = seconds.coerceIn(1.0, cap)
        elapsed = duration
        levels.clear()
        levels.addAll(Waveform.bars(copy.name))
        return true
    }

    fun testClipAvailable(): Boolean = BuildConfig.DEBUG && File(context.getExternalFilesDir(null), TEST_CLIP).exists()

    fun togglePlay() {
        val f = file ?: return
        val p = player
        if (playing && p != null) {
            p.pause()
            playing = false
            return
        }
        try {
            val ready = p ?: MediaPlayer().also {
                it.setAudioAttributes(speechAttributes)
                it.setDataSource(f.absolutePath)
                it.setOnCompletionListener { done ->
                    done.seekTo(0)
                    position = 0.0
                    playing = false
                }
                it.prepare()
                player = it
            }
            ready.start()
            playing = true
        } catch (e: Exception) {
            error = "Couldn't play the recording."
        }
    }

    fun discard() {
        player?.release()
        player = null
        playing = false
        position = 0.0
        file?.delete()
        file = null
        duration = 0.0
        elapsed = 0.0
        levels.clear()
    }

    /** Stop everything when the screen goes; the recording file is deleted. */
    fun release() {
        if (recording) stop()
        discard()
    }

    /**
     * POST /api/media (audio/mp4, this recorder's purpose); returns the media
     * id. A coach names the client ([clientId]); a client leaves it null.
     */
    suspend fun upload(clientId: String?): String {
        val f = file ?: throw APIError.config("No recording to send.")
        val seconds = Math.round(duration).toInt().coerceIn(1, cap.toInt())
        val bytes = withContext(Dispatchers.IO) { f.readBytes() }
        val media = APIClient.upload<Media>(
            "/api/media", bytes, "audio/mp4",
            mapOf("purpose" to purpose, "clientId" to clientId, "durationSec" to "$seconds"),
        )
        return media.id
    }

    companion object {
        /** Letters keep their 90 s voice note. */
        const val LETTER_CAP = 90.0
        const val MAX_LEVELS = 48
        const val TEST_CLIP = "test-clip.m4a"

        val speechAttributes: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    }
}

@Composable
fun rememberVoiceRecorder(cap: Double, purpose: String): VoiceRecorder {
    val context = LocalContext.current
    val recorder = remember(cap, purpose) { VoiceRecorder(context.applicationContext, cap, purpose) }
    DisposableEffect(recorder) { onDispose { recorder.release() } }
    LaunchedEffect(recorder, recorder.recording, recorder.playing) {
        while (isActive && (recorder.recording || recorder.playing)) {
            recorder.tick()
            delay(TICK_MS)
        }
    }
    return recorder
}

private const val TICK_MS = 90L

// MARK: - The shared player

/**
 * One player per screen: starting a note stops the one playing. Audio
 * attributes are set once per player (speech). [speed] cycles 1×, 1.5×, 2×.
 */
class VoicePlayer(private val context: Context) {
    var currentId by mutableStateOf<String?>(null)
        private set
    var playing by mutableStateOf(false)
        private set
    var loadingId by mutableStateOf<String?>(null)
        private set
    var position by mutableStateOf(0.0)
        private set
    var length by mutableStateOf(0.0)
        private set
    var speed by mutableStateOf(1f)
        private set
    var failedId by mutableStateOf<String?>(null)
        private set

    private var player: MediaPlayer? = null

    suspend fun toggle(mediaId: String, path: String?) {
        val p = player
        if (currentId == mediaId && p != null) {
            if (playing) {
                p.pause()
                playing = false
            } else {
                start(p)
            }
            return
        }
        stop()
        loadingId = mediaId
        failedId = null
        try {
            val file = MediaFiles.file(context, mediaId, "audio", path)
            val mp = MediaPlayer()
            mp.setAudioAttributes(VoiceRecorder.speechAttributes)
            mp.setDataSource(file.absolutePath)
            withContext(Dispatchers.IO) { mp.prepare() }
            mp.setOnCompletionListener {
                playing = false
                position = 0.0
                it.seekTo(0)
            }
            player = mp
            currentId = mediaId
            length = mp.duration / 1000.0
            position = 0.0
            start(mp)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            failedId = mediaId
        } finally {
            loadingId = null
        }
    }

    private fun start(p: MediaPlayer) {
        if (speed != 1f) {
            // Setting a speed also starts a paused player.
            runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) }.onFailure { p.start() }
        } else {
            p.start()
        }
        playing = true
    }

    fun cycleSpeed() {
        speed = when (speed) {
            1f -> 1.5f
            1.5f -> 2f
            else -> 1f
        }
        val p = player ?: return
        if (playing) runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) }
    }

    fun tick() {
        player?.let { if (playing) position = it.currentPosition / 1000.0 }
    }

    fun stop() {
        player?.release()
        player = null
        playing = false
        currentId = null
        position = 0.0
    }
}

val LocalVoicePlayer = staticCompositionLocalOf<VoicePlayer?> { null }

/** Gives a screen its one voice player, released when the screen goes. */
@Composable
fun VoicePlayerScope(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val player = remember { VoicePlayer(context.applicationContext) }
    DisposableEffect(player) { onDispose { player.stop() } }
    LaunchedEffect(player, player.playing) {
        while (isActive && player.playing) {
            player.tick()
            delay(TICK_MS)
        }
    }
    CompositionLocalProvider(LocalVoicePlayer provides player, content = content)
}

// MARK: - Waveform

/** A note's bars: a calm, speech-like shape, the same every time for a given note. */
object Waveform {
    fun bar(seed: String, index: Int, count: Int): Float {
        var h = seed.hashCode() * 31 + index * 7919
        h = h xor (h ushr 13)
        h *= 0x5bd1e995
        h = h xor (h ushr 15)
        val noise = (abs(h) % 1000) / 1000f
        // An envelope: quiet at the ends, fuller in the middle, like a sentence.
        val x = index / (count - 1f).coerceAtLeast(1f)
        val envelope = 0.45f + 0.55f * (1f - (2f * x - 1f) * (2f * x - 1f))
        return (0.18f + 0.82f * noise * envelope).coerceIn(0.12f, 1f)
    }

    fun bars(seed: String, count: Int = 44): List<Float> = List(count) { bar(seed, it, count) }
}

/**
 * Bars 0…1 with the played part in [played] and the rest in [idle]. Decorative
 * (the time beside it carries the meaning).
 */
@Composable
fun WaveformBars(
    bars: List<Float>,
    progress: Float,
    modifier: Modifier = Modifier,
    played: Color = JKColors.text,
    idle: Color = JKColors.trackStrong,
) {
    Canvas(modifier.fillMaxWidth().height(JKSpace.xxl + JKSpace.xs)) {
        if (bars.isEmpty()) return@Canvas
        // Thin rounded bars spread across the width: a bar never grows wider than the rule.
        val slot = size.width / bars.size
        val w = minOf(JKSize.rule.toPx() * 1.5f, slot * 0.6f).coerceAtLeast(1f)
        val radius = CornerRadius(w / 2f, w / 2f)
        bars.forEachIndexed { i, v ->
            val h = (size.height * v).coerceAtLeast(size.height * 0.16f)
            val x = i * slot + (slot - w) / 2f
            val done = (i + 0.5f) / bars.size <= progress
            drawRoundRect(
                color = if (done) played else idle,
                topLeft = Offset(x, (size.height - h) / 2f),
                size = Size(w, h),
                cornerRadius = radius,
            )
        }
    }
}

// MARK: - The bubble

/**
 * A voice message inside a bubble: play/pause through the screen's one
 * player, the bars, the time and speed; the caption when the sender typed
 * one; the "Transcript" disclosure with the copy for its state; and, only
 * when the server sent them (a coach reading a client's note), the summary,
 * mood, worded flags, topics and action items.
 *
 * [asClient]: the signed-in person is the client (changes two lines of copy).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VoiceNoteBubble(message: Message, asClient: Boolean, onChangeConsent: (() -> Unit)? = null) {
    val v = message.voice ?: return
    val player = LocalVoicePlayer.current
    val scope = rememberCoroutineScope()
    val id = v.mediaId
    val isCurrent = player != null && id != null && player.currentId == id
    val playing = isCurrent && player?.playing == true
    val loading = player != null && id != null && player.loadingId == id
    val length = (if (isCurrent) player?.length?.takeIf { it > 0 } else null) ?: v.durationSec ?: message.durationSec ?: 0.0
    val position = if (isCurrent) player?.position ?: 0.0 else 0.0
    val progress = if (length > 0) (position / length).toFloat().coerceIn(0f, 1f) else 0f
    val bars = remember(id) { Waveform.bars(id ?: message.id) }
    var open by remember(message.id) { mutableStateOf(false) }
    val caption = message.text.takeIf { it.isNotEmpty() && !it.startsWith("Voice note") }

    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        if (v.playable && id != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(JKSize.setCircle)
                        .clip(CircleShape)
                        .background(JKColors.primaryFill, CircleShape)
                        .clickable(enabled = player != null && !loading, role = Role.Button) {
                            scope.launch { player?.toggle(id, v.url) }
                        }
                        .semantics { contentDescription = if (playing) "Pause voice note" else "Play voice note, ${VoiceCopy.clock(length)}" },
                    contentAlignment = Alignment.Center,
                ) {
                    if (loading) ProgressView(tint = JKColors.primaryLabel, size = JKSize.iconSmall)
                    else Glyph(if (playing) IconKey.pause else IconKey.playArrow, size = JKSize.iconTab, tint = JKColors.primaryLabel, filled = true)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    WaveformBars(bars, progress)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (isCurrent && position > 0) "${VoiceCopy.clock(position)} / ${VoiceCopy.clock(length)}" else VoiceCopy.clock(length),
                            style = JKType.caption.monospacedDigit(),
                            color = JKColors.textSecondary,
                        )
                        Spacer(Modifier.weight(1f))
                        if (isCurrent && player != null) {
                            Text(
                                speedLabel(player.speed),
                                style = JKType.caption.monospacedDigit(),
                                color = JKColors.text,
                                modifier = Modifier
                                    .clip(JKShape.pill)
                                    .clickable(role = Role.Button) { player.cycleSpeed() }
                                    .border(JKSize.hairline, JKColors.inputBorder, JKShape.pill)
                                    .padding(horizontal = JKSpace.s, vertical = JKSpace.xs)
                                    .semantics { contentDescription = "Playback speed ${speedLabel(player.speed)}" },
                            )
                        }
                    }
                }
            }
            if (player?.failedId == id) Text("Couldn't play it. Try again.", style = JKType.caption, color = JKColors.textSecondary)
        } else {
            IconLabel("Voice note deleted", icon = IconKey.voiceNote, style = JKType.callout, color = JKColors.textSecondary)
        }

        caption?.let { LinkedText(it, style = JKType.body, color = JKColors.text) }

        // The coach's read first (it is what they act on), then the words in full behind the disclosure.
        if (v.hasAnalysis) Analysis(v)
        if (v.state != VoiceState.deleted) {
            TranscriptDisclosure(v, asClient, open, onToggle = { open = !open }, onChangeConsent = onChangeConsent)
        }
    }
}

private fun speedLabel(speed: Float): String = when (speed) {
    1.5f -> "1.5×"
    2f -> "2×"
    else -> "1×"
}

@Composable
private fun TranscriptDisclosure(v: VoiceInfo, asClient: Boolean, open: Boolean, onToggle: () -> Unit, onChangeConsent: (() -> Unit)?) {
    val transcript = v.transcript?.takeIf { v.state == VoiceState.done }
    val status = VoiceCopy.status(v, asClient)
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        Box(Modifier.fillMaxWidth().height(JKSize.hairline).background(JKColors.hairline))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = JKSpace.xxxl)
                .then(if (transcript != null) Modifier.clickable(role = Role.Button, onClick = onToggle) else Modifier)
                .semantics(mergeDescendants = true) {
                    if (transcript != null) stateDescription = if (open) "Shown" else "Hidden"
                },
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (v.state == VoiceState.pending) {
                Shimmering { Text(status, style = JKType.caption, color = JKColors.textSecondary) }
            } else {
                Text(if (transcript != null) "Transcript" else status, style = JKType.caption, color = if (transcript != null) JKColors.text else JKColors.textSecondary)
                if (VoiceCopy.offersChange(v, asClient) && onChangeConsent != null) {
                    Text("·", style = JKType.caption, color = JKColors.textSecondary)
                    Text(
                        "Change",
                        style = JKType.caption.semibold(),
                        color = JKColors.text,
                        modifier = Modifier.clickable(role = Role.Button, onClick = onChangeConsent).padding(vertical = JKSpace.xs),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            if (transcript != null) Glyph(if (open) IconKey.collapse else IconKey.expand, size = JKSize.iconSmall, tint = JKColors.textSecondary)
        }
        AnimatedVisibility(open && transcript != null) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                Text(transcript ?: "", style = JKType.parBody, color = JKColors.text)
                Text(status, style = JKType.meta, color = JKColors.textSecondary)
            }
        }
    }
}

/** The coach's read of a client's note: summary, mood, flags, topics and actions. Monochrome, always worded. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Analysis(v: VoiceInfo) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        v.summary?.takeIf { it.isNotEmpty() }?.let { summary ->
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                Box(Modifier.width(JKSize.rule).heightIn(min = JKSpace.xl).background(JKColors.silver))
                Text(summary, style = JKType.callout.regular(), color = JKColors.text, modifier = Modifier.weight(1f))
            }
        }
        val flags = v.flags.orEmpty()
        val mood = VoiceCopy.mood(v.mood)
        if (flags.isNotEmpty() || mood != null || !v.topics.isNullOrEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(JKSpace.xs), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                flags.forEach { f ->
                    val words = VoiceCopy.flag(f.kind) + (f.severity?.takeIf { it == "high" }?.let { " · high" } ?: "")
                    TagPill(words, icon = if (f.kind == "pain" || f.kind == "injury") IconKey.pain else IconKey.warning, strong = true)
                }
                mood?.let { TagPill(it) }
                v.topics.orEmpty().take(5).forEach { TagPill(it) }
            }
        }
        flags.firstOrNull { !it.quote.isNullOrEmpty() }?.let { f ->
            Text("“${f.quote}”", style = JKType.annotation, color = JKColors.textSecondary)
        }
        val actions = v.actions.orEmpty()
        if (actions.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                actions.forEach { a ->
                    Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.Top) {
                        Glyph(IconKey.checkboxBlank, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                        Text(a.text, style = JKType.caption, color = JKColors.text, modifier = Modifier.weight(1f))
                        a.owner?.let { Text(if (it == "coach") "You" else "Client", style = JKType.meta, color = JKColors.textSecondary) }
                    }
                }
            }
        }
    }
}

/** A small worded pill; [strong] is outlined in text colour (flags), the rest in the input border. */
@Composable
fun TagPill(text: String, icon: IconKey? = null, strong: Boolean = false) {
    Row(
        Modifier
            .border(JKSize.hairline, if (strong) JKColors.text else JKColors.inputBorder, JKShape.pill)
            .padding(horizontal = JKSpace.s, vertical = JKSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon?.let { Glyph(it, size = JKSize.iconSmall, tint = JKColors.text) }
        Text(text, style = JKType.caption, color = if (strong) JKColors.text else JKColors.textSecondary, maxLines = 1)
    }
}

/** A gentle breathing fade, for "Transcribing…" (still under reduced motion). */
@Composable
private fun Shimmering(content: @Composable () -> Unit) {
    if (rememberReduceMotion()) {
        content()
        return
    }
    val t = rememberInfiniteTransition(label = "shimmer")
    val a by t.animateFloat(0.45f, 1f, infiniteRepeatable(tween(JKMotion.STANDARD * 4), RepeatMode.Reverse), label = "alpha")
    Box(Modifier.alpha(a)) { content() }
}

// MARK: - Composer

/**
 * What the composer shows while a voice note is being made: recording (a
 * breathing dot, the clock against the cap, live bars, Cancel and Stop) or
 * the preview (play, the bars, the length, Re-record and Send).
 */
@Composable
fun VoiceRecordBar(recorder: VoiceRecorder, sending: Boolean, onSend: () -> Unit) {
    val capText = VoiceCopy.clock(recorder.cap)
    Column(
        Modifier
            .fillMaxWidth()
            .background(JKColors.surface, JKShape.parCard)
            .border(JKSize.hairline, JKColors.hairline, JKShape.parCard)
            .padding(JKSpace.m),
        verticalArrangement = Arrangement.spacedBy(JKSpace.s),
    ) {
        if (recorder.recording) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                Shimmering { Box(Modifier.size(JKSize.dot + JKSpace.xs).background(JKColors.text, CircleShape)) }
                Text(
                    "Recording · ${VoiceCopy.clock(recorder.elapsed)} of $capText",
                    style = JKType.callout.monospacedDigit(),
                    color = JKColors.text,
                    modifier = Modifier.weight(1f),
                )
                RoundAction(IconKey.close, "Cancel the recording", primary = false) { recorder.cancel() }
                RoundAction(IconKey.stop, "Stop recording", primary = true) { recorder.stop() }
            }
            LevelBars(recorder.levels)
            if (recorder.nearCap) {
                Text("${VoiceCopy.clock(recorder.cap - recorder.elapsed)} left: it stops at $capText.", style = JKType.caption, color = JKColors.textSecondary)
            }
        } else if (recorder.file != null) {
            val progress = if (recorder.duration > 0) (recorder.position / recorder.duration).toFloat().coerceIn(0f, 1f) else 0f
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                RoundAction(if (recorder.playing) IconKey.pause else IconKey.playArrow, if (recorder.playing) "Pause" else "Play the recording", primary = false) {
                    recorder.togglePlay()
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    val shape = if (recorder.levels.size >= 8) compress(recorder.levels, 44) else Waveform.bars(recorder.file?.name ?: "clip")
                    WaveformBars(shape, progress)
                    Text(
                        if (recorder.playing) "${VoiceCopy.clock(recorder.position)} / ${VoiceCopy.clock(recorder.duration)}" else "Voice note · ${VoiceCopy.clock(recorder.duration)}",
                        style = JKType.caption.monospacedDigit(),
                        color = JKColors.textSecondary,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                TextButton("Discard", onClick = { recorder.discard() }, enabled = !sending)
                Spacer(Modifier.weight(1f))
                Row(
                    Modifier
                        .heightIn(min = JKSize.touchTarget)
                        .clip(JKShape.pill)
                        .background(JKColors.primaryFill, JKShape.pill)
                        .clickable(enabled = !sending, role = Role.Button, onClick = onSend)
                        .padding(horizontal = JKSpace.l),
                    horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (sending) ProgressView(tint = JKColors.primaryLabel, size = JKSize.iconSmall)
                    else Glyph(IconKey.send, size = JKSize.iconSmall, tint = JKColors.primaryLabel)
                    Text(if (sending) "Sending…" else "Send", style = JKType.callout, color = JKColors.primaryLabel)
                }
            }
        }
        recorder.error?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
    }
}

/** Averages a long run of levels down to [count] bars. */
private fun compress(levels: List<Float>, count: Int): List<Float> {
    if (levels.size <= count) return levels.map { it.coerceAtLeast(0.12f) }
    val step = levels.size / count.toFloat()
    return List(count) { i ->
        val from = (i * step).toInt()
        val to = ((i + 1) * step).toInt().coerceAtMost(levels.size).coerceAtLeast(from + 1)
        levels.subList(from, to).average().toFloat().coerceAtLeast(0.12f)
    }
}

/** The live meter: the most recent levels, newest at the right. */
@Composable
private fun LevelBars(levels: List<Float>) {
    val shown = List(VoiceRecorder.MAX_LEVELS) { i ->
        val from = levels.size - VoiceRecorder.MAX_LEVELS + i
        if (from >= 0) levels[from].coerceAtLeast(0.08f) else 0.08f
    }
    WaveformBars(shown, progress = 1f, modifier = Modifier.semantics { contentDescription = "Microphone level" })
}

@Composable
private fun RoundAction(icon: IconKey, description: String, primary: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(JKSize.touchTarget)
            .clip(CircleShape)
            .background(if (primary) JKColors.primaryFill else JKColors.raised, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Glyph(icon, size = JKSize.iconInline, tint = if (primary) JKColors.primaryLabel else JKColors.text)
    }
}

/**
 * The composer's mic and everything before recording starts: the one-time
 * consent sheet for a client whose choice is still "ask", then the runtime
 * microphone prompt (with the letter composer's refusal copy), then the
 * recorder. [asClient]: a client's composer (consent applies); a coach's never asks.
 * Draw [Overlay] once in the composer.
 */
class VoiceStarter internal constructor(private val gate: (() -> Unit) -> Unit, private val record: () -> Unit, private val recorder: VoiceRecorder) {
    /** Tap on the mic. */
    fun start() = gate(record)

    /** Debug builds: the pushed test clip, through the same consent step. */
    fun testClip() = gate { if (!recorder.loadTestClip()) recorder.error = "No test clip on this device." }
}

@Composable
fun rememberVoiceStarter(recorder: VoiceRecorder, asClient: Boolean): Pair<VoiceStarter, @Composable () -> Unit> {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var afterConsent by remember { mutableStateOf<(() -> Unit)?>(null) }
    var refused by remember { mutableStateOf(false) }
    var consentError by remember { mutableStateOf<String?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        refused = !granted
        if (granted) recorder.start()
    }

    val starter = remember(recorder) {
        VoiceStarter(
            gate = { action ->
                if (asClient && AppSession.gate.voiceTranscription == "ask") afterConsent = action else action()
            },
            record = {
                refused = false
                val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                if (granted) recorder.start() else permission.launch(Manifest.permission.RECORD_AUDIO)
            },
            recorder = recorder,
        )
    }
    val overlay: @Composable () -> Unit = {
        afterConsent?.let { action ->
            VoiceConsentSheet(
                error = consentError,
                onChoice = { on ->
                    scope.launch {
                        try {
                            VoiceConsentStore.set(on)
                            consentError = null
                            afterConsent = null
                            action()
                        } catch (e: Exception) {
                            if (e.isCancellation) throw e
                            consentError = e.readable
                        }
                    }
                },
                onDismiss = {
                    afterConsent = null
                    consentError = null
                },
            )
        }
        if (refused) {
            Text(
                "The microphone is off for JK Performance. Turn it on in Settings › Apps › JK Performance › Permissions to record a voice note.",
                style = JKType.caption, color = JKColors.textSecondary,
            )
        }
    }
    return starter to overlay
}

/** The mic button beside the field. */
@Composable
fun MicButton(enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
            .clip(CircleShape)
            .background(JKColors.raised, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Record a voice note" },
        contentAlignment = Alignment.Center,
    ) {
        Glyph(IconKey.mic, size = JKSize.iconInline, tint = if (enabled) JKColors.text else JKColors.textSecondary)
    }
}

/**
 * Uploads the finished recording as a voice note and sends it into the
 * thread: `POST /api/media?purpose=voice` then `POST /api/messages
 * {kind:'voice', mediaId, text?}`. The coach passes [clientId].
 */
suspend fun sendVoiceNote(recorder: VoiceRecorder, clientId: String?, caption: String): Message {
    val mediaId = recorder.upload(clientId)
    val sent: Message = try {
        APIClient.send("POST", "/api/messages", MessageInput(text = caption, clientId = clientId, mediaId = mediaId, kind = "voice"))
    } catch (e: APIError.server) {
        // 403 not_enabled: the coach switched voice notes off meanwhile.
        if (e.code == 403 && e.message == "not_enabled") throw APIError.server(403, "Voice notes are off") else throw e
    }
    recorder.discard()
    return sent
}

// MARK: - Consent (D16)

/** Reads and writes the client's transcription choice, then refreshes `me` so the composer knows. */
object VoiceConsentStore {
    suspend fun set(on: Boolean): VoiceConsent {
        val reply: VoiceConsent = APIClient.send("PUT", "/api/voice/consent", VoiceConsentInput(if (on) "on" else "off"))
        AppSession.refreshMe()
        return reply
    }

    suspend fun get(): VoiceConsent = APIClient.get("/api/voice/consent")
}

/** The sheet's words, from the spec (D16). The provider fills in when the server names it. */
fun consentCopy(provider: String?): String {
    val service = if (provider.isNullOrBlank()) "OpenRouter" else "OpenRouter, using $provider"
    return "Voice notes are transcribed and summarised for JK by an AI service ($service). The summary is seen only by JK."
}

/**
 * The one-time sheet before a client's first voice note: [Allow] or
 * [Send without transcription]. Either choice can be changed in Account › Privacy.
 */
@Composable
fun VoiceConsentSheet(error: String?, onChoice: (Boolean) -> Unit, onDismiss: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(error) { if (error != null) busy = false }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().navigationBarsPadding().padding(JKSpace.s), contentAlignment = Alignment.BottomCenter) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(JKColors.surface, JKShape.sheetAll)
                    .border(JKSize.hairline, JKColors.hairline, JKShape.sheetAll)
                    .padding(JKSpace.xxl),
                verticalArrangement = Arrangement.spacedBy(JKSpace.l),
            ) {
                Box(
                    Modifier.size(JKSize.setCircle + JKSpace.s).background(JKColors.raised, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Glyph(IconKey.voiceNote, size = JKSize.iconTab, tint = JKColors.text) }
                ParLabel("Voice notes")
                Text("Before your first voice note", style = JKType.parCardTitle, color = JKColors.text)
                Text(consentCopy(AppSession.me?.features?.voiceAiProvider), style = JKType.parBody, color = JKColors.text)
                Text(
                    "Your recording always reaches JK. You can change this any time in Account › Privacy.",
                    style = JKType.caption, color = JKColors.textSecondary,
                )
                error?.let { ErrorBanner(it) }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    PrimaryButton(onClick = {
                        busy = true
                        onChoice(true)
                    }, enabled = !busy) { Text("Allow") }
                    SecondaryButton("Send without transcription", onClick = {
                        busy = true
                        onChoice(false)
                    }, enabled = !busy)
                }
            }
        }
    }
}

/** Account › Privacy: "Transcribe my voice notes", on the same endpoint as the sheet. */
@Composable
fun VoicePrivacySection() {
    val scope = rememberCoroutineScope()
    val gate = AppSession.gate
    var on by remember { mutableStateOf(gate.voiceTranscription == "on") }
    var asked by remember { mutableStateOf(gate.voiceTranscription != "ask") }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        runCatching { VoiceConsentStore.get() }.getOrNull()?.let {
            on = it.voice == "on"
            asked = it.voice != "ask"
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Text("Transcribe my voice notes", style = JKType.body, color = JKColors.text)
                    Text(
                        if (!asked) "Not chosen yet: you'll be asked before your first voice note."
                        else if (on) "On: JK gets a transcript and a short summary."
                        else "Off: JK hears the recording only.",
                        style = JKType.caption, color = JKColors.textSecondary,
                    )
                }
                JKSwitch(checked = on, onCheckedChange = { value ->
                    val before = on
                    on = value
                    scope.launch {
                        try {
                            VoiceConsentStore.set(value)
                            asked = true
                            error = null
                        } catch (e: Exception) {
                            if (e.isCancellation) throw e
                            on = before
                            error = e.readable
                        }
                    }
                })
            }
            Text(consentCopy(AppSession.me?.features?.voiceAiProvider), style = JKType.caption, color = JKColors.textSecondary)
            Text(
                "Turning it off stops new notes being transcribed at once. Transcripts already made stay; ask JK, or delete your account, to remove them.",
                style = JKType.caption, color = JKColors.textSecondary,
            )
        }
        error?.let { ErrorBanner(it) }
    }
}

// MARK: - Refresh

/**
 * The refresh rule: while a visible voice note is pending, poll every 10 s
 * for up to 2 minutes from when the pending note was first seen; otherwise
 * the screen's normal pace.
 */
class PendingVoiceClock {
    private var since: Long? = null

    fun delayFor(anyPending: Boolean, normal: Long): Long {
        if (!anyPending) {
            since = null
            return normal
        }
        val now = SystemClock.elapsedRealtime()
        val start = since ?: now.also { since = it }
        return if (now - start <= PENDING_WINDOW_MS) PENDING_POLL_MS else normal
    }

    companion object {
        const val PENDING_POLL_MS = 10_000L
        const val PENDING_WINDOW_MS = 120_000L
    }
}

/** Whether a message list holds a pending voice note. */
fun List<Message>.anyPendingVoice(): Boolean = any { it.isVoice && it.voice?.state == VoiceState.pending }
