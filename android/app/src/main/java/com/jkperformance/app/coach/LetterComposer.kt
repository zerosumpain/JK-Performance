package com.jkperformance.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.core.content.ContextCompat
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.CheckIn
import com.jkperformance.app.net.LetterInput
import com.jkperformance.app.net.Media
import com.jkperformance.app.net.MilestoneSuggestion
import com.jkperformance.app.net.NeedsReason
import com.jkperformance.app.net.PersonRef
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import com.jkperformance.app.net.Feel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID

// MARK: - Letter composer (coach)

/**
 * This week's letter for one client (atelier-spec.md, "LETTER COMPOSER"):
 * the week's context pinned at the top, then Headline, Keep, Adjust and
 * Question, an optional voice note (90 s cap), and publish now or schedule
 * for Monday 07:00. Publishing marks the check-in replied. Only the
 * headline is required, so a voice note plus a headline is enough.
 *
 * `week` is the Monday the letter covers (null asks the server for the
 * suggested week); `milestone` is a milestone the server suggested.
 */
@Composable
fun LetterComposer(client: PersonRef, week: String? = null, milestone: NeedsReason? = null) {
    val dismiss = LocalDismiss.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val voice = rememberVoiceRecorder(cap = VoiceRecorder.LETTER_CAP, purpose = "letter")
    var report by remember { mutableStateOf<Report?>(null) }
    var loadedWeek by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var kind by remember { mutableStateOf("weekly") }
    var headline by remember { mutableStateOf("") }
    var keep by remember { mutableStateOf("") }
    var adjust by remember { mutableStateOf("") }
    var question by remember { mutableStateOf("") }
    var milestoneKey by remember { mutableStateOf<String?>(null) }
    var mediaId by remember { mutableStateOf<String?>(null) }
    var contextOpen by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    val firstName = client.firstName ?: Fmt.firstWord(client.name)
    val canSend = headline.isNotBlank() && !busy && !voice.recording

    fun fill(r: Report) {
        if (r.headline != null || r.summary.isNotEmpty()) headline = r.displayHeadline
        keep = r.keepText
        adjust = r.adjustText
        question = r.question ?: ""
        mediaId = r.mediaId
        if (milestone != null && milestone.kind == "milestone") {
            kind = "milestone"
            milestoneKey = milestone.milestoneKey
            headline = milestone.suggestedHeadline ?: headline
            keep = ""
            adjust = ""
            question = ""
            mediaId = null
        }
    }

    suspend fun load() {
        try {
            val monday = week ?: APIClient.get<ReportsResponse>("/api/reports", mapOf("clientId" to client.id)).suggestedWeek
            val r = APIClient.get<Report>("/api/reports/week/${seg(monday)}", mapOf("clientId" to client.id))
            loadedWeek = monday
            report = r
            fill(r)
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun save(status: String, deliverAt: String?) {
        busy = true
        try {
            if (voice.file != null && mediaId == null) mediaId = voice.upload(client.id)
            val weekly = kind == "weekly"
            val input = LetterInput(
                clientId = client.id,
                week = if (weekly) loadedWeek else null,
                id = if (weekly) report?.id else null,
                kind = kind,
                headline = headline.trim(),
                keep = keep.trim(),
                adjust = adjust.trim(),
                question = question.trim(),
                mediaId = mediaId,
                milestoneKey = if (weekly) null else milestoneKey,
                status = status,
                deliverAt = deliverAt,
            )
            val saved = APIClient.send<Report, LetterInput>("PUT", "/api/reports", input)
            // Keep the pinned context when the save reply leaves it out.
            val old = report
            report = if (saved.context == null) {
                saved.copy(context = old?.context, scoreTrio = saved.scoreTrio ?: old?.scoreTrio, weekDots = saved.weekDots ?: old?.weekDots)
            } else saved
            saveError = null
            if (status == "published") dismiss() else notice = "Saved as a draft."
        } catch (e: Throwable) {
            if (!e.isCancellation) saveError = e.readable
        } finally {
            busy = false
        }
    }

    LaunchedEffect(client.id, week) { load() }
    DisposableEffect(Unit) { onDispose { voice.release() } }

    CoachSubpage("Letter to $firstName") {
        val r = report
        val currentError = error
        when {
            r == null && currentError != null -> ErrorCard(currentError, retry = { load() })
            r == null -> LoadingCard()
            else -> {
                Text(letterStatus(r), style = JKType.caption, color = JKColors.textSecondary)
                ContextCard(r, open = contextOpen, onToggle = { contextOpen = !contextOpen })

                // Kind
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    Segmented(listOf("weekly", "milestone"), kind, { kind = it }) { if (it == "weekly") "Weekly" else "Milestone" }
                    if (kind == "milestone") {
                        val options = buildList {
                            addAll(r.context?.milestones.orEmpty())
                            val key = milestone?.milestoneKey
                            if (key != null && none { it.key == key }) {
                                add(0, MilestoneSuggestion(key = key, reason = milestone.text, suggestedHeadline = milestone.suggestedHeadline))
                            }
                        }
                        if (options.isEmpty()) {
                            Text("No milestone suggested this week. Write one anyway if it is earned.", style = JKType.caption, color = JKColors.textSecondary)
                        }
                        options.forEach { m ->
                            Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                                CoachRowLabel(
                                    m.reason ?: m.key,
                                    Modifier
                                        .clickable {
                                            milestoneKey = m.key
                                            m.suggestedHeadline?.let { headline = it }
                                        }
                                        .semantics { selected = milestoneKey == m.key },
                                    icon = IconKey.milestone,
                                    detail = m.suggestedHeadline,
                                    chevron = false,
                                )
                            }
                        }
                    }
                }

                // Fields
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    JKField("Headline", headline, { headline = it }, prompt = "Strongest week yet.")
                    JKField("Keep", keep, { keep = it }, prompt = "One win, with its number")
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                        JKField("Adjust", adjust, { adjust = it }, prompt = "This week: protein at breakfast.")
                        Text("Becomes the line on their Today.", style = JKType.caption, color = JKColors.textSecondary)
                    }
                    JKField("Question", question, { question = it }, prompt = "What got in the way on Thursday?")
                }

                VoiceSection(voice, attached = mediaId != null, onDiscard = { mediaId = null }, hadMedia = r.mediaId != null)

                // Actions
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    saveError?.let { ErrorBanner(it) }
                    notice?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
                    PrimaryButton(onClick = { scope.launch { save("published", null) } }, enabled = canSend) {
                        if (busy) ProgressView() else Text("Schedule for Monday 07:00")
                    }
                    SecondaryButton("Publish now", onClick = { scope.launch { save("published", "now") } }, enabled = canSend)
                    TextButton(
                        "Save draft",
                        onClick = { scope.launch { save("draft", null) } },
                        enabled = !busy && !voice.recording && r.letterStatus != "published",
                    )
                    Text(
                        "$firstName reads it on Monday morning, and their Today shows your Adjust line.",
                        style = JKType.caption, color = JKColors.textSecondary,
                    )
                }
            }
        }
    }
}

private fun letterStatus(r: Report): String {
    val weekText = "Week of ${Fmt.dayMonth(r.week)}"
    return when (r.letterStatus) {
        "published" -> "$weekText · delivered" + if (r.readAt != null) " · read" else ""
        "scheduled" -> "$weekText · scheduled" + (r.deliverAt?.let { " for ${Fmt.shortDay(it)} ${Fmt.time(it)}" } ?: "")
        else -> if (r.id == null) "$weekText · not started" else "$weekText · draft"
    }
}

/** The pinned context: score trio, week dots, check-in, session feel, goal and the rhythm note. Collapsible. */
@Composable
private fun ContextCard(r: Report, open: Boolean, onToggle: () -> Unit) {
    val context = r.context
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("This week", style = JKType.headline, color = JKColors.text, modifier = Modifier.weight(1f))
            Glyph(
                if (open) IconKey.collapse else IconKey.expand,
                size = JKSize.iconInline,
                tint = JKColors.textSecondary,
                contentDescription = if (open) "Hide" else "Show",
            )
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                r.scoreTrio?.takeIf { it.isNotEmpty() }?.let { ScoreTrio(it) }
                r.weekDots?.takeIf { it.isNotEmpty() }?.let { dots ->
                    WeekDots(dots.map { d ->
                        weekDayOf(d.date, done = d.done == true, rest = d.rest == true, future = d.future == true, isToday = d.date == Day.today)
                    })
                }
                val c: CheckIn? = context?.checkin
                if (c != null) {
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                        val figures = buildList {
                            add("Energy ${c.energy}")
                            c.stress?.let { add("Stress $it") }
                            add("Sleep ${c.sleep}")
                        }.joinToString(" · ")
                        Text(figures, style = JKType.callout.monospacedDigit(), color = JKColors.text)
                        if (c.pain.isNotEmpty()) CoachCheckLine("Pain", c.pain.joinToString(", "))
                        c.win?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Win", it) }
                        c.struggle?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Struggle", it) }
                        c.note?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Note", it) }
                    }
                } else {
                    Text("No check-in for this week yet.", style = JKType.caption, color = JKColors.textSecondary)
                }
                context?.week?.feel.orEmpty().forEach { f ->
                    Text(listOfNotNull(f.title, f.word ?: Feel.word(f.feel)).joinToString(" · "), style = JKType.caption, color = JKColors.textSecondary)
                }
                context?.goal?.takeIf { !it.isDraft }?.let { g ->
                    Text(
                        listOfNotNull(g.title, g.remainingLabel, g.delta?.let { "${Fmt.delta(it)} ${g.unit ?: ""} so far" }).joinToString(" · "),
                        style = JKType.caption, color = JKColors.textSecondary,
                    )
                }
                if (context?.rhythm?.media == true) {
                    Text("Elite letters carry a voice note.", style = JKType.caption, color = JKColors.textSecondary)
                }
            }
        }
    }
}

@Composable
private fun VoiceSection(voice: VoiceRecorder, attached: Boolean, hadMedia: Boolean, onDiscard: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refused by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        refused = !granted
        if (granted) voice.start()
    }
    // rememberVoiceRecorder ticks it while recording or playing (the clock and the 90 s cap).

    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Text("Voice note", style = JKType.headline, color = JKColors.text)
        when {
            voice.recording -> {
                Text("Recording · ${clock(voice.elapsed)} of 1:30", style = JKType.callout.monospacedDigit(), color = JKColors.text)
                SecondaryButton("Stop", onClick = { voice.stop() })
            }
            voice.file != null -> {
                Text(
                    (if (attached) "Attached · " else "Recorded · ") + clock(voice.duration),
                    style = JKType.callout.monospacedDigit(), color = JKColors.text,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    SecondaryButton(if (voice.playing) "Pause" else "Play", onClick = { voice.togglePlay() }, modifier = Modifier.weight(1f))
                    SecondaryButton("Discard", onClick = {
                        voice.discard()
                        onDiscard()
                    }, modifier = Modifier.weight(1f))
                }
            }
            else -> {
                if (hadMedia && attached) Text("A voice note is attached.", style = JKType.caption, color = JKColors.textSecondary)
                SecondaryButton(onClick = {
                    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                    if (granted) voice.start() else permission.launch(Manifest.permission.RECORD_AUDIO)
                }) { IconLabel("Record a voice note", icon = IconKey.voiceNote, style = JKType.callout) }
                Text("Up to 90 seconds.", style = JKType.caption, color = JKColors.textSecondary)
            }
        }
        if (refused) {
            Text(
                "The microphone is off for JK Performance. Turn it on in Settings › Apps › JK Performance › Permissions to record a voice note.",
                style = JKType.caption, color = JKColors.textSecondary,
            )
        }
        voice.error?.let { ErrorBanner(it) }
    }
}

private fun clock(seconds: Double): String {
    val s = Math.round(seconds).toInt()
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}
