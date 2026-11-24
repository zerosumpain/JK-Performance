package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.InstantSerializer
import com.jkperformance.app.net.Message
import com.jkperformance.app.net.MessageInput
import com.jkperformance.app.net.MessageThread
import com.jkperformance.app.net.MessagesResponse
import com.jkperformance.app.net.ThreadsResponse
import com.jkperformance.app.net.PlansResponse
import com.jkperformance.app.net.ClientsResponse
import com.jkperformance.app.net.VoiceCopy
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.mergeById
import com.jkperformance.app.net.readable
import java.time.Instant
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/** How often an open thread or the coach's thread list asks for news. */
private const val POLL_MS = 15_000L

/**
 * One-to-one thread between a client and their coach. A client passes
 * `clientId = null` (the server uses the caller); a coach passes the client's
 * id. Polls every 15 s while on screen.
 */
@Composable
fun MessagesThreadView(clientId: String?, otherName: String, subtitle: String) {
    val scope = rememberCoroutineScope()
    var messages by remember { mutableStateOf<List<Message>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }
    val list = rememberLazyListState()
    val myId = AppSession.me?.id
    var cursor by remember { mutableStateOf<String?>(null) }
    val pendingClock = remember { PendingVoiceClock() }
    val recorder = rememberVoiceRecorder(cap = AppSession.gate.voiceMaxSec.toDouble(), purpose = "voice")
    val (voice, voiceOverlay) = rememberVoiceStarter(recorder, asClient = clientId == null)
    val makingVoice = recorder.recording || recorder.file != null
    // A coach always has voice notes; a client only when their coach allows them.
    val voiceAllowed = AppSession.isCoach || AppSession.gate.voiceNotes

    /**
     * First load fetches the thread; each poll asks only for messages after
     * the last one's instant (exclusive) and appends them, and with `since`
     * picks up changed ones (a transcript that arrived), merged by id.
     */
    suspend fun load() {
        val last = messages?.lastOrNull()?.at
        try {
            val reply: MessagesResponse = APIClient.get(
                "/api/messages",
                mapOf("clientId" to clientId, "after" to last?.let(InstantSerializer::format), "since" to cursor),
            )
            val current = messages
            if (current != null) {
                val merged = mergeById(mergeById(current, reply.messages) { it.id }, reply.updated.orEmpty()) { it.id }
                if (merged != current) messages = merged
            } else {
                messages = mergeById(reply.messages, reply.updated.orEmpty()) { it.id }
            }
            reply.cursor?.let { cursor = it }
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun send() {
        val text = draft.trim()
        if (text.isEmpty()) return
        sending = true
        try {
            val sent: Message = APIClient.send("POST", "/api/messages", MessageInput(text = text, clientId = clientId, workoutId = null))
            draft = ""
            sendError = null
            messages = (messages ?: emptyList()) + sent
            // The natural moment to ask: they'll want to know when the reply comes.
            Reminders.offerIfUndecided(checkIn = clientId == null)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            sendError = e.readable
        } finally {
            sending = false
        }
    }

    suspend fun sendVoice() {
        sending = true
        try {
            val sent = sendVoiceNote(recorder, clientId = clientId, caption = draft.trim())
            draft = ""
            sendError = null
            messages = mergeById(messages ?: emptyList(), listOf(sent)) { it.id }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            sendError = e.readable
        } finally {
            sending = false
        }
    }

    // Poll while visible; leaving the screen cancels the effect.
    LaunchedEffect(clientId) {
        while (isActive) {
            load()
            delay(pendingClock.delayFor(messages.orEmpty().anyPendingVoice(), POLL_MS))
        }
    }

    // A thread opens at, and follows, its newest message.
    val shown = messages
    val lastId = shown?.lastOrNull()?.id
    val leading = (if (error != null) 1 else 0) + (if (shown?.isEmpty() == true) 1 else 0)
    LaunchedEffect(lastId) {
        if (shown != null && shown.isNotEmpty()) list.animateScrollToItem(leading + shown.size - 1)
    }

    VoicePlayerScope {
    Column(Modifier.jkScreen().keyboardAware()) {
        ThreadBar(otherName, subtitle)
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = list,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (shown != null) {
                error?.let { item(key = "error") { ErrorBanner(it) } }
                if (shown.isEmpty()) {
                    item(key = "empty") {
                        EmptyCard(title = "No messages yet", detail = "Say hello to $otherName.")
                    }
                }
                shown.forEachIndexed { index, m ->
                    item(key = m.id) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (index == 0 || !Day.same(shown[index - 1].at, m.at)) {
                                Text(dayLabel(m.at), style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.padding(top = 8.dp))
                                Spacer(Modifier.height(10.dp))
                            }
                            Bubble(message = m, mine = m.fromId == myId)
                        }
                    }
                }
            } else {
                item(key = "state") {
                    val e = error
                    if (e != null) ErrorCard(e) { load() } else LoadingCard()
                }
            }
        }
        sendError?.let { ErrorBanner(it, Modifier.padding(horizontal = 16.dp)) }
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            voiceOverlay()
            if (makingVoice) {
                VoiceRecordBar(recorder, sending = sending, onSend = { scope.launch { sendVoice() } })
            } else if (BuildConfig.DEBUG && voiceAllowed && recorder.testClipAvailable()) {
                // Debug builds only: the emulator has no microphone (desk-v2 WP10).
                TextButton(onClick = { voice.testClip() }, enabled = !sending) {
                    Glyph(IconKey.mic, JKType.caption)
                    Text("Send test clip", style = JKType.caption)
                }
            }
        }
        if (!makingVoice) Row(
            Modifier.fillMaxWidth().background(JKColors.bg).padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (voiceAllowed && draft.isBlank()) MicButton(enabled = !sending) { voice.start() }
            val style = JKType.body.copy(color = JKColors.text)
            val field = JKShape.sheetAll
            BasicTextField(
                value = draft,
                onValueChange = { draft = it },
                textStyle = style,
                minLines = 1,
                maxLines = 4,
                cursorBrush = SolidColor(JKColors.text),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(JKColors.surface, field)
                            .border(JKSize.hairline, JKColors.inputBorder, field)
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                    ) {
                        if (draft.isEmpty()) Text("Message", style = style, color = JKColors.textSecondary)
                        inner()
                    }
                },
            )
            val canSend = !sending && draft.trim().isNotEmpty()
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(JKColors.primaryFill, CircleShape)
                    .clickable(enabled = canSend) { scope.launch { send() } },
                contentAlignment = Alignment.Center,
            ) {
                if (sending) ProgressView() else Glyph(IconKey.send, JKType.body, JKColors.primaryLabel)
            }
        }
    }
    }
}

/**
 * The thread's inline bar: the other person's initials, name and subtitle
 * where iOS puts its principal toolbar item, after a back chevron when the
 * thread was pushed (a coach opening a client's thread).
 */
@Composable
private fun ThreadBar(otherName: String, subtitle: String) {
    val nav = LocalNav.current
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (nav.depth > 0) {
            Glyph(
                IconKey.back,
                modifier = Modifier.clickable { nav.pop() }.padding(horizontal = 4.dp, vertical = 8.dp),
                size = JKSize.iconTab,
                tint = JKColors.text,
                contentDescription = "Back",
            )
        } else {
            Spacer(Modifier.width(8.dp))
        }
        // A client's thread is with JK: his portrait (or the monogram) in the champagne ring.
        if (AppSession.isCoach) Avatar(initials = Fmt.initials(otherName), size = JKSize.avatarSmall)
        else CoachAvatar(AppSession.me?.coach?.avatarMediaId, size = JKSize.avatarSmall)
        Column {
            Text(otherName, style = JKType.callout.semibold(), color = JKColors.text, maxLines = 1)
            Text(subtitle, style = JKType.caption, color = JKColors.textSecondary, maxLines = 1)
        }
    }
}

private fun dayLabel(date: Instant): String =
    if (Day.same(date, Instant.now())) "Today ${Fmt.time(date)}" else "${Fmt.shortDay(date)} ${Fmt.time(date)}"

/**
 * Keeps the composer above the keyboard. The window draws edge to edge, so
 * the keyboard arrives as an inset; this pads by only the part of it that
 * overlaps this screen (the tab bar below already covers the rest), which
 * is what `imePadding()` alone can't know.
 */
@Composable
private fun Modifier.keyboardAware(): Modifier {
    val density = LocalDensity.current
    val view = LocalView.current
    val ime = WindowInsets.ime.getBottom(density)
    var below by remember { mutableIntStateOf(0) }
    return this
        .onGloballyPositioned { below = (view.rootView.height - it.boundsInWindow().bottom).roundToInt() }
        .padding(bottom = with(density) { (ime - below).coerceAtLeast(0).toDp() })
}

/** What a non-text message is, in a word or two. */
private fun bubbleTag(message: Message, mine: Boolean): Pair<IconKey, String>? = when (message.kind) {
    "formCheck" -> IconKey.formCheck to "Form check"
    "mealPhoto" -> IconKey.mealPhoto to "Meal photo"
    "answer" -> IconKey.reply to (if (mine) "Your answer to the letter" else "Answered your letter")
    "letter" -> IconKey.letter to "Letter delivered"
    "voice" -> IconKey.voiceNote to (if (mine) "Your voice note" else "Voice note")
    else -> if (message.workoutId != null) IconKey.workout to "Plan updated" else null
}

/**
 * One message: your own words sit raised, the other side's on surface. Form
 * checks and meal photos play or show their media.
 */
@Composable
private fun Bubble(message: Message, mine: Boolean) {
    val nav = LocalNav.current
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = minOf(if (message.isVoice) 340.dp else 300.dp, maxWidth - JKSpace.huge)
        Column(
            Modifier
                .align(if (mine) Alignment.CenterEnd else Alignment.CenterStart)
                .widthIn(max = width)
                .then(if (message.isVoice) Modifier.widthIn(min = width) else Modifier)
                .background(if (mine) JKColors.raised else JKColors.surface, JKShape.card)
                .padding(JKSpace.m)
                .semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(JKSpace.xs),
        ) {
            bubbleTag(message, mine)?.let { (key, text) ->
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.xs), verticalAlignment = Alignment.CenterVertically) {
                    Glyph(key, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                    Text(text, style = JKType.caption, color = JKColors.textSecondary)
                }
            }
            if (message.isVoice) {
                // Chosen by kind, never by mediaId: the coach view carries the analysis when the server sent it.
                VoiceNoteBubble(message, asClient = !AppSession.isCoach, onChangeConsent = { nav.push { PrivacyView() } })
            } else {
                if (message.text.isNotEmpty()) LinkedText(message.text, style = JKType.body, color = JKColors.text)
                message.mediaId?.let { MessageMedia(it, isVideo = message.kind == "formCheck") }
            }
            Text(Fmt.time(message.at), style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.align(Alignment.End))
        }
    }
}

// MARK: - Coach: thread list

/**
 * The coach's conversations, newest first. Threads from clients on a plan
 * with 'priority' carry the word "Priority".
 */
@Composable
fun CoachThreadsView() {
    var threads by remember { mutableStateOf<List<MessageThread>?>(null) }
    var priority by remember { mutableStateOf<Set<String>>(emptySet()) }
    var plans by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ThreadsResponse = APIClient.get("/api/threads")
            threads = reply.threads
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    /** Which clients are on a plan that includes 'priority'. */
    suspend fun loadPlans() {
        val catalogue = runCatching { APIClient.get<PlansResponse>("/api/plans") }.getOrNull() ?: return
        val clients = runCatching { APIClient.get<ClientsResponse>("/api/coach/clients") }.getOrNull() ?: return
        val priorityPlans = catalogue.plans.filter { "priority" in it.featureIds }.map { it.id }.toSet()
        priority = clients.clients.filter { (it.plan ?: "") in priorityPlans }.map { it.id }.toSet()
        plans = clients.clients.associate { it.id to (it.plan ?: "none") }
    }

    LaunchedEffect(Unit) { loadPlans() }
    LaunchedEffect(Unit) {
        while (isActive) {
            load()
            delay(POLL_MS)
        }
    }

    JKRefreshable(onRefresh = { load() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            Text("Messages", style = JKType.display, color = JKColors.text, modifier = Modifier.semantics { heading() })
            Loadable(value = threads, error = error, retry = { load() }) { list ->
                if (list.isEmpty()) {
                    EmptyState("No conversations yet.")
                } else {
                    Column(Modifier.jkSurface(SurfaceVariant.Group, padding = 0.dp)) {
                        list.forEachIndexed { i, t ->
                            val isPriority = t.client.id in priority
                            ThreadRow(t, isPriority, subtitle = if (isPriority) "Priority · same-day reply" else Fmt.planName(plans[t.client.id]))
                            if (i < list.lastIndex) GroupDivider(Modifier.padding(start = JKSpace.l + JKSize.avatar + JKSpace.m))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ThreadRow(t: MessageThread, priority: Boolean, subtitle: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .navLink { MessagesThreadView(clientId = t.client.id, otherName = t.client.name, subtitle = subtitle) }
            .padding(horizontal = JKSpace.l, vertical = JKSpace.m),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(initials = t.client.displayInitials)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                Text(t.client.name, style = JKType.callout, color = JKColors.text, maxLines = 1)
                if (priority) Text("Priority", style = JKType.caption, color = JKColors.textSecondary)
                Spacer(Modifier.weight(1f))
                t.last?.at?.let { at ->
                    Text(
                        if (Day.same(at, Instant.now())) Fmt.time(at) else Fmt.dayMonth(at),
                        style = JKType.caption,
                        color = JKColors.textSecondary,
                    )
                }
            }
            Text(threadPreview(t), style = JKType.caption, color = JKColors.textSecondary, maxLines = 1)
        }
        if (t.unread > 0) {
            Text(
                "${t.unread}",
                style = JKType.caption,
                color = JKColors.primaryLabel,
                modifier = Modifier
                    .background(JKColors.primaryFill, CircleShape)
                    .padding(horizontal = JKSpace.s, vertical = 2.dp)
                    .semantics { contentDescription = "${t.unread} unread" },
            )
        }
    }
}

private fun threadPreview(t: MessageThread): String {
    val last = t.last ?: return "No messages"
    val tail = if (last.text.isEmpty()) "" else " · ${last.text}"
    return when (last.kind) {
        "formCheck" -> "Form check$tail"
        "mealPhoto" -> "Meal photo$tail"
        "answer" -> "Answered your letter · ${last.text}"
        "voice" -> VoiceCopy.preview(last)
        else -> last.text
    }
}
