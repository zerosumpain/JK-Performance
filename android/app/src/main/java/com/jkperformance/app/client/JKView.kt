package com.jkperformance.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.CheckIn
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.FormRequest
import com.jkperformance.app.net.FormRequestsResponse
import com.jkperformance.app.net.Message
import com.jkperformance.app.net.MessageInput
import com.jkperformance.app.net.PlanUpdate
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.TimelineForm
import com.jkperformance.app.net.TimelineItem
import com.jkperformance.app.net.TimelineResponse
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

/** How often the JK timeline asks for news. */
private const val TIMELINE_POLL_MS = 15_000L

/**
 * The JK tab (atelier-spec.md, IA 3 and Client screens 7): JK's voice in one
 * place. A header with his reply line, the latest letter pinned, one
 * timeline of messages, letters, check-ins, forms and plan updates, and the
 * composer. Free clients see JK and his guides instead, so nothing here
 * calls a route their plan does not include.
 */
@Composable
fun JKView() {
    val gate = AppSession.gate
    if (gate.messaging || gate.checkin) JKTimelineView() else FreeJKView()
}

/**
 * The JK sheet (plan-act-review.md, Screens 9): JK's thread, restyled, with
 * the quiet More list one tap away. Opened from JK's avatar on every tab.
 */
@Composable
fun JKSheet() = JKView()

/**
 * The sheet's header: a grabber, JK's portrait at 56dp, his name and the reply
 * line his plan sets, then quiet links (past letters, More).
 */
@Composable
fun JKHeader(lettersOnly: Boolean, onLettersOnly: (Boolean) -> Unit) {
    val session = AppSession
    val gate = session.gate
    val nav = LocalNav.current
    val dismiss = LocalDismiss.current
    val coach = session.me?.coach
    val replyLine = coach?.replyLine
        ?: (if (gate.priority) coach?.replyExpectation?.priority else coach?.replyExpectation?.standard)
        ?: (if (gate.priority) "Same-day replies" else "JK replies most evenings")

    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(width = JKSpace.xxxl + JKSpace.s, height = JKSpace.xs)
                    .background(JKColors.trackStrong, CircleShape)
                    .clickable(onClickLabel = "Close", onClick = dismiss),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            JKAvatar(coach?.avatarMediaId, size = JKSize.sheetPortrait)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                Text(coach?.name ?: "JK", style = JKType.parCardTitle, color = JKColors.text, modifier = Modifier.semantics { heading() })
                Text(replyLine, style = JKType.meta, color = JKColors.textTertiary)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.l)) {
            if (gate.checkin) TextButton(if (lettersOnly) "All of it" else "Past letters", onClick = { onLettersOnly(!lettersOnly) })
            TextButton("More", onClick = { nav.push { JKMoreView() } })
        }
    }
}

/** The timeline and composer, for plans with 'messaging' or 'checkin'. */
@Composable
private fun JKTimelineView() {
    val session = AppSession
    val gate = session.gate
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<TimelineItem>?>(null) }
    var nextBefore by remember { mutableStateOf<String?>(null) }
    var letters by remember { mutableStateOf<List<Report>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var lettersOnly by remember { mutableStateOf(false) }
    var loadingEarlier by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<FormRequest?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var cursor by remember { mutableStateOf<String?>(null) }
    val pendingClock = remember { PendingVoiceClock() }
    val list = rememberLazyListState()

    suspend fun refresh() {
        try {
            // `since` also returns `updated`: messages whose transcript arrived (F19 refresh rule).
            val page: TimelineResponse = APIClient.get("/api/timeline", mapOf("limit" to "50", "since" to cursor))
            val current = items
            if (current != null) {
                items = mergeById(mergeById(current, page.items) { it.id }, page.updated.orEmpty()) { it.id }
            } else {
                items = mergeById(page.items, page.updated.orEmpty()) { it.id }
                nextBefore = page.nextBefore
            }
            page.cursor?.let { cursor = it }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
        if (gate.checkin) {
            runCatching { APIClient.get<ReportsResponse>("/api/reports") }.getOrNull()?.let { reply ->
                letters = reply.reports.filter { it.isPublished }
                    .sortedByDescending { it.deliveredAt ?: it.publishedAt ?: Instant.EPOCH }
            }
        }
    }

    suspend fun loadEarlier() {
        val before = nextBefore ?: return
        loadingEarlier = true
        try {
            val page: TimelineResponse = APIClient.get("/api/timeline", mapOf("limit" to "50", "before" to before))
            val known = (items ?: emptyList()).map { it.id }.toSet()
            items = (items ?: emptyList()) + page.items.filter { it.id !in known }
            nextBefore = page.nextBefore
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        } finally {
            loadingEarlier = false
        }
    }

    suspend fun openForm(id: String) {
        try {
            val reply: FormRequestsResponse = APIClient.get("/api/form-requests")
            val r = reply.requests.firstOrNull { it.id == id } ?: return
            if (r.submittedAt == null) form = r else actionError = "You've already sent this one to JK."
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            refresh()
            val pending = items.orEmpty().mapNotNull { it.message }.anyPendingVoice()
            delay(pendingClock.delayFor(pending, TIMELINE_POLL_MS))
        }
    }

    // Oldest first, as a conversation reads.
    val shown = (items ?: emptyList()).sortedBy { it.at }
    val openLetter: (Report) -> Unit = { r -> r.id?.let { nav.push(ClientRoute.letter(it)) } }

    // Follow the newest item, as a thread does.
    val lastId = shown.lastOrNull()?.id
    LaunchedEffect(lastId, lettersOnly) {
        if (lastId != null && !lettersOnly) list.animateScrollToItem(maxOf(0, list.layoutInfo.totalItemsCount - 1))
    }

    VoicePlayerScope {
    Column(Modifier.jkScreen().jkKeyboardAware()) {
        // Pinned above the timeline, so Past letters and Guides stay in reach however long the history.
        Box(Modifier.padding(start = JKSpace.gutter, end = JKSpace.gutter, top = JKSpace.gutter)) {
            JKHeader(lettersOnly) { lettersOnly = it }
        }
        JKRefreshable(onRefresh = { refresh() }, modifier = Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                Modifier.fillMaxSize(),
                state = list,
                contentPadding = PaddingValues(JKSpace.gutter),
                verticalArrangement = Arrangement.spacedBy(JKSpace.l),
            ) {
                if (lettersOnly) {
                    if (letters.isEmpty()) item(key = "noLetters") { EmptyState("JK's letters will gather here.") }
                    letters.forEach { r ->
                        item(key = "letter-${r.id}") {
                            LetterCard(r.displayHeadline, LetterText.caption(r), unread = r.isUnread, milestone = r.isMilestone) { openLetter(r) }
                        }
                    }
                } else {
                    val latest = letters.firstOrNull()
                    if (gate.checkin && latest?.id != null) {
                        item(key = "pinned") {
                            LetterCard(
                                latest.displayHeadline,
                                LetterText.caption(latest),
                                excerpt = latest.adjustText.ifEmpty { null },
                                unread = latest.isUnread,
                                milestone = latest.isMilestone,
                            ) { openLetter(latest) }
                        }
                    }
                    val loaded = items
                    if (loaded == null) {
                        item(key = "state") {
                            val e = error
                            if (e != null) ErrorCard(e) { refresh() } else LoadingCard()
                        }
                    } else {
                        error?.let { item(key = "error") { ErrorBanner(it) } }
                        if (nextBefore != null) {
                            item(key = "earlier") {
                                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                    TextButton(if (loadingEarlier) "Loading…" else "Earlier", onClick = { scope.launch { loadEarlier() } }, enabled = !loadingEarlier)
                                }
                            }
                        }
                        if (loaded.isEmpty()) {
                            item(key = "empty") {
                                EmptyState(if (gate.messaging) "Say hello to JK. He reads everything." else "Your letters from JK arrive here.")
                            }
                        }
                        shown.forEach { entry ->
                            item(key = entry.id) {
                                TimelineCard(entry, openLetter = openLetter, openForm = { scope.launch { openForm(it) } })
                            }
                        }
                    }
                }
            }
        }
        if (gate.messaging && !lettersOnly) JKComposer(onSent = { refresh() })
    }
    }

    form?.let { request ->
        Sheet(onDismiss = {
            form = null
            scope.launch { refresh() }
        }) { FormFillView(request) }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun TimelineCard(item: TimelineItem, openLetter: (Report) -> Unit, openForm: (String) -> Unit) {
    val coach = AppSession.me?.coach
    when (item.kind) {
        "message" -> item.message?.let { m -> MessageBubble(m, mine = m.fromRole == "client", coachAvatarMediaId = coach?.avatarMediaId) }
        "letter" -> item.letter?.takeIf { it.id != null }?.let { r ->
            LetterCard(r.displayHeadline, LetterText.caption(r), unread = r.isUnread, milestone = r.isMilestone) { openLetter(r) }
        }
        "checkin" -> item.checkin?.let { CheckInCard(it) }
        "form" -> item.form?.let { f -> FormRequestCard(f) { openForm(f.id) } }
        "planUpdate" -> item.planUpdate?.let { p -> PlanUpdateCard(p) { TabRouter.openWeek(p.from) } }
    }
}

/** Words for a letter's caption. */
object LetterText {
    /** "Monday's letter · 16 Nov", or "A letter · 3 Dec" for a milestone. */
    fun caption(r: Report): String {
        val whenAt = r.deliveredAt ?: r.publishedAt
        val date = whenAt?.let { Fmt.dayMonth(it) } ?: Fmt.dayMonth(r.week)
        if (r.isMilestone) return "A letter · $date"
        if (whenAt == null) return "Week of ${Fmt.dayMonth(r.week)}"
        return "${Fmt.weekdayName(Day.start(whenAt))}'s letter · $date"
    }
}

// MARK: - Thread cards

/**
 * A message: the client's own on raised with bone text, JK's on surface with
 * his ringed avatar. Form checks and meal photos carry their media.
 */
@Composable
fun MessageBubble(message: Message, mine: Boolean, coachAvatarMediaId: String? = null) {
    val nav = LocalNav.current
    val caption = when (message.kind) {
        "answer" -> if (mine) "Your answer to JK's question" else null
        "formCheck" -> "Form check"
        "mealPhoto" -> "Meal photo"
        else -> if (message.reportId != null && mine) "About JK's letter" else null
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val widest = maxWidth - JKSpace.huge
        Row(
            Modifier
                .align(if (mine) Alignment.CenterEnd else Alignment.CenterStart)
                .semantics(mergeDescendants = true) {
                    contentDescription = (if (mine) "You" else "JK") + ", ${Fmt.time(message.at)}. ${message.text}"
                },
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (!mine) CoachAvatar(coachAvatarMediaId, size = JKSize.avatarSmall - JKSpace.s, contentDescription = null)
            Column(
                Modifier
                    .widthIn(max = widest)
                    .then(if (message.isVoice) Modifier.widthIn(min = widest * 0.8f) else Modifier)
                    .background(if (mine) JKColors.raised else JKColors.surface, JKShape.parCard)
                    .then(if (mine) Modifier else Modifier.border(JKSize.hairline, JKColors.hairline, JKShape.parCard))
                    .padding(JKSpace.m),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xs),
            ) {
                caption?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
                if (message.isVoice) {
                    // Chosen by kind, never by mediaId (voice notes carry none at the top level).
                    VoiceNoteBubble(message, asClient = true, onChangeConsent = { nav.push { PrivacyView() } })
                } else {
                    message.mediaId?.let { MessageMedia(it, isVideo = message.kind == "formCheck") }
                    if (message.text.isNotEmpty()) LinkedText(message.text, style = JKType.body, color = JKColors.text)
                }
                Text(Fmt.time(message.at), style = JKType.caption, color = JKColors.textSecondary)
            }
        }
    }
}

/** "Check-in sent": the week's answers, and when the letter comes. */
@Composable
fun CheckInCard(checkin: CheckIn) {
    val figures = buildList {
        add("Energy ${checkin.energy} of 5")
        checkin.stress?.let { add("Stress $it of 5") }
        add("Sleep ${checkin.sleep} of 5")
        if (checkin.pain.isNotEmpty()) add(checkin.pain.joinToString(", "))
    }.joinToString(" · ")
    Column(
        Modifier.jkSurface(SurfaceVariant.Card, padding = JKSpace.l).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(JKSpace.s),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
            Glyph(IconKey.checkIn, size = JKSize.iconSmall, tint = JKColors.textSecondary)
            Text("Check-in sent · week of ${Fmt.dayMonth(checkin.week)}", style = JKType.caption, color = JKColors.textSecondary)
        }
        Text(figures, style = JKType.callout, color = JKColors.text)
        checkin.win?.takeIf { it.isNotEmpty() }?.let { Text("Win: $it", style = JKType.callout, color = JKColors.text) }
        checkin.struggle?.takeIf { it.isNotEmpty() }?.let { Text("Struggle: $it", style = JKType.callout, color = JKColors.text) }
        if (checkin.reviewedAt == null) {
            Text("Sent to JK. Your letter arrives Monday morning.", style = JKType.caption, color = JKColors.textSecondary)
        }
    }
}

/** A form JK sent: its name, how long, and Fill in. */
@Composable
fun FormRequestCard(form: TimelineForm, onFill: () -> Unit) {
    val n = form.questionCount?.let { if (it == 1) "1 question" else "$it questions" } ?: "A form from JK"
    val detail = if (form.submittedAt == null) n else "$n · sent"
    Row(
        Modifier.jkSurface(SurfaceVariant.Card, padding = JKSpace.l),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.form, tint = JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(form.name, style = JKType.headline, color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
        if (form.submittedAt == null) {
            Box(
                Modifier
                    .clip(JKShape.pill)
                    .background(JKColors.primaryFill, JKShape.pill)
                    .clickable(role = Role.Button, onClick = onFill)
                    .heightIn(min = JKSize.touchTarget)
                    .padding(horizontal = JKSpace.l),
                contentAlignment = Alignment.Center,
            ) { Text("Fill in", style = JKType.callout, color = JKColors.primaryLabel) }
        }
    }
}

/** "JK updated next week". */
@Composable
fun PlanUpdateCard(update: PlanUpdate, onOpen: () -> Unit) {
    val count = update.count?.let { if (it == 1) "1 session" else "$it sessions" } ?: "Sessions"
    val detail = update.from?.let { from ->
        val to = update.to?.let { if (it == from) "" else " to ${Fmt.dayMonth(it)}" } ?: ""
        "$count, ${Fmt.dayMonth(from)}$to"
    } ?: count
    Row(
        Modifier
            .clip(JKShape.card)
            .clickable(role = Role.Button, onClick = onOpen)
            .jkSurface(SurfaceVariant.Card, padding = JKSpace.l)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.week, tint = JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(update.text ?: "JK updated your plan", style = JKType.headline, color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
        Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
    }
}

// MARK: - Composer

/**
 * A written field: surface ground, 1dp input border, placeholder in
 * textSecondary. Shared by the JK composer and the letter's answer.
 */
@Composable
internal fun ComposerField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    minLines: Int = 1,
    maxLines: Int = 5,
    description: String? = null,
) {
    val style = JKType.body.copy(color = JKColors.text)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = style,
        minLines = minLines,
        maxLines = maxLines,
        cursorBrush = SolidColor(JKColors.text),
        modifier = modifier
            .fillMaxWidth()
            .then(if (description != null) Modifier.semantics { contentDescription = description } else Modifier),
        decorationBox = { inner ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = JKSize.touchTarget)
                    .background(JKColors.surface, JKShape.control)
                    .border(JKSize.hairline, JKColors.inputBorder, JKShape.control)
                    .padding(horizontal = JKSpace.m, vertical = JKSpace.s),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty()) Text(placeholder, style = style, color = JKColors.textSecondary)
                inner()
            }
        },
    )
}

/**
 * The composer, with "Ask JK" beneath it holding only what JK has switched
 * on (a form check, a meal photo). A letter's "Reply to JK" arrives here
 * quoting the letter.
 */
@Composable
private fun JKComposer(onSent: suspend () -> Unit) {
    val context = LocalContext.current
    val gate = AppSession.gate
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val quote = TabRouter.replyQuote
    val trimmed = draft.trim()
    val recorder = rememberVoiceRecorder(cap = gate.voiceMaxSec.toDouble(), purpose = "voice")
    val (voice, voiceOverlay) = rememberVoiceStarter(recorder, asClient = true)
    val makingVoice = recorder.recording || recorder.file != null

    LaunchedEffect(TabRouter.composerDraft) {
        TabRouter.composerDraft?.let {
            draft = it
            TabRouter.composerDraft = null
            runCatching { focus.requestFocus() }
        }
    }
    LaunchedEffect(quote) { if (quote != null) runCatching { focus.requestFocus() } }

    suspend fun post(input: MessageInput) {
        APIClient.send<Message, MessageInput>("POST", "/api/messages", input)
        draft = ""
        error = null
        onSent()
    }

    suspend fun send() {
        if (trimmed.isEmpty()) return
        sending = true
        try {
            post(MessageInput(text = trimmed, reportId = TabRouter.replyQuote?.reportId))
            TabRouter.replyQuote = null
            // The natural moment to ask: they'll want to know when the reply comes.
            Reminders.offerIfUndecided(checkIn = gate.checkin)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            sending = false
        }
    }

    suspend fun sendVoice() {
        sending = true
        try {
            sendVoiceNote(recorder, clientId = null, caption = trimmed)
            draft = ""
            error = null
            onSent()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            sending = false
        }
    }

    val mealPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            sending = true
            try {
                val media = MediaUpload.image(context, uri, purpose = "mealPhoto")
                post(MessageInput(text = trimmed.ifEmpty { "Meal photo" }, mediaId = media.id, kind = "mealPhoto"))
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                sending = false
            }
        }
    }
    val clipPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            sending = true
            try {
                val media = MediaUpload.video(context, uri, purpose = "formCheck")
                post(MessageInput(text = trimmed.ifEmpty { "Form check" }, mediaId = media.id, kind = "formCheck"))
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                sending = false
            }
        }
    }

    Column(
        Modifier.fillMaxWidth().background(JKColors.bg).padding(horizontal = JKSpace.gutter, vertical = JKSpace.s),
        verticalArrangement = Arrangement.spacedBy(JKSpace.s),
    ) {
        if (quote != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                BrandRule()
                Text(
                    "Replying to: ${quote.headline}",
                    style = JKType.caption,
                    color = JKColors.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                        .clickable(role = Role.Button) { TabRouter.replyQuote = null }
                        .semantics { contentDescription = "Stop quoting the letter" },
                    contentAlignment = Alignment.Center,
                ) { Glyph(IconKey.close, size = JKSize.iconSmall, tint = JKColors.textSecondary) }
            }
        }
        error?.let { ErrorBanner(it) }
        voiceOverlay()
        if (makingVoice) VoiceRecordBar(recorder, sending = sending, onSend = { scope.launch { sendVoice() } })
        if (!makingVoice) Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.Bottom) {
            if (gate.voiceNotes && trimmed.isEmpty()) MicButton(enabled = !sending) { voice.start() }
            ComposerField(draft, { draft = it }, "Message JK", Modifier.weight(1f).focusRequester(focus))
            val canSend = !sending && trimmed.isNotEmpty()
            Box(
                Modifier
                    .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                    .clip(CircleShape)
                    .background(if (canSend || sending) JKColors.primaryFill else JKColors.raised, CircleShape)
                    .clickable(enabled = canSend, role = Role.Button) { scope.launch { send() } }
                    .semantics { contentDescription = "Send" },
                contentAlignment = Alignment.Center,
            ) {
                if (sending) ProgressView(tint = JKColors.primaryLabel)
                else Glyph(IconKey.send, size = JKSize.iconInline, tint = if (canSend) JKColors.primaryLabel else JKColors.textSecondary)
            }
        }
        val testClip = BuildConfig.DEBUG && gate.voiceNotes && !makingVoice && recorder.testClipAvailable()
        if (!makingVoice && (gate.formChecks || gate.mealPhotos || testClip)) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.l)) {
                if (testClip) {
                    // Debug builds only: the emulator has no microphone (desk-v2 WP10).
                    TextButton(onClick = { voice.testClip() }, enabled = !sending) {
                        Glyph(IconKey.mic, JKType.caption)
                        Text("Send test clip", style = JKType.caption)
                    }
                }
                if (gate.formChecks) {
                    TextButton(onClick = { clipPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) }, enabled = !sending) {
                        Glyph(IconKey.formCheck, JKType.caption)
                        Text("Send a form check", style = JKType.caption)
                    }
                }
                if (gate.mealPhotos) {
                    TextButton(onClick = { mealPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !sending) {
                        Glyph(IconKey.mealPhoto, JKType.caption)
                        Text("Send a meal photo", style = JKType.caption)
                    }
                }
            }
        }
    }
}

// MARK: - Free

/** No 'messaging': JK, a line, his guides inline, and what coaching includes. */
@Composable
private fun FreeJKView() {
    val coach = AppSession.me?.coach
    Column(
        Modifier.jkScreen().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
        verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
            JKAvatar(coach?.avatarMediaId, size = JKSize.sheetPortrait)
            Text(coach?.name ?: "JK", style = JKType.display, color = JKColors.text, modifier = Modifier.semantics { heading() })
            Text("New guides from JK appear here.", style = quoteStyle(), color = JKColors.text)
        }
        GuidesListContent()
        SecondaryButton("See what coaching includes", onClick = { TabRouter.openMembership() })
        JKMoreList()
    }
}

/**
 * Keeps the composer above the keyboard. The window draws edge to edge, so
 * the keyboard arrives as an inset; this pads by only the part of it that
 * overlaps this screen (the tab bar below already covers the rest).
 */
@Composable
internal fun Modifier.jkKeyboardAware(): Modifier {
    val density = LocalDensity.current
    val view = LocalView.current
    val ime = WindowInsets.ime.getBottom(density)
    var below by remember { mutableIntStateOf(0) }
    return this
        .onGloballyPositioned { below = (view.rootView.height - it.boundsInWindow().bottom).roundToInt() }
        .padding(bottom = with(density) { (ime - below).coerceAtLeast(0).toDp() })
}
