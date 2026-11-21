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
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBackIos
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
import com.jkperformance.app.design.Avatar
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.EmptyCard
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.ErrorCard
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.IconTile
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKRefreshable
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Loadable
import com.jkperformance.app.design.LoadingCard
import com.jkperformance.app.design.LocalNav
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.InstantSerializer
import com.jkperformance.app.net.Message
import com.jkperformance.app.net.MessageInput
import com.jkperformance.app.net.MessageThread
import com.jkperformance.app.net.MessagesResponse
import com.jkperformance.app.net.ThreadsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import java.time.Instant
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

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

    /**
     * First load fetches the thread; each poll asks only for messages after
     * the last one's instant (exclusive) and appends them.
     */
    suspend fun load() {
        val last = messages?.lastOrNull()?.at
        try {
            val reply: MessagesResponse = APIClient.get(
                "/api/messages",
                mapOf("clientId" to clientId, "after" to last?.let(InstantSerializer::format)),
            )
            val current = messages
            if (current != null) {
                val known = current.map { it.id }.toSet()
                val fresh = reply.messages.filter { it.id !in known }
                if (fresh.isNotEmpty()) messages = current + fresh
            } else {
                messages = reply.messages
            }
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

    // Poll while visible; leaving the screen cancels the effect.
    LaunchedEffect(clientId) {
        while (isActive) {
            load()
            delay(POLL_MS)
        }
    }

    // A thread opens at, and follows, its newest message.
    val shown = messages
    val lastId = shown?.lastOrNull()?.id
    val leading = (if (error != null) 1 else 0) + (if (shown?.isEmpty() == true) 1 else 0)
    LaunchedEffect(lastId) {
        if (shown != null && shown.isNotEmpty()) list.animateScrollToItem(leading + shown.size - 1)
    }

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
                        EmptyCard(systemName = "bubble.left.and.bubble.right", title = "No messages yet", detail = "Say hello to $otherName.")
                    }
                }
                shown.forEachIndexed { index, m ->
                    item(key = m.id) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (index == 0 || !Day.same(shown[index - 1].at, m.at)) {
                                Text(dayLabel(m.at), style = JKType.caption2, color = JK.tertiary, modifier = Modifier.padding(top = 8.dp))
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
        Row(
            Modifier.fillMaxWidth().background(JK.bg).padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val style = JKType.body.copy(color = JK.text)
            val field = rounded(20.dp)
            BasicTextField(
                value = draft,
                onValueChange = { draft = it },
                textStyle = style,
                minLines = 1,
                maxLines = 4,
                cursorBrush = SolidColor(JK.text),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(JK.card, field)
                            .border(1.dp, JK.stroke, field)
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                    ) {
                        if (draft.isEmpty()) Text("Message", style = style, color = JK.tertiary)
                        inner()
                    }
                },
            )
            val canSend = !sending && draft.trim().isNotEmpty()
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(JK.chrome, CircleShape)
                    .clickable(enabled = canSend) { scope.launch { send() } },
                contentAlignment = Alignment.Center,
            ) {
                if (sending) ProgressView(tint = Color.Black) else SystemImage("paperplane.fill", JKType.body, Color.Black)
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
        Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (nav.depth > 0) {
            Icon(
                Icons.AutoMirrored.Rounded.ArrowBackIos,
                contentDescription = "Back",
                tint = JK.text,
                modifier = Modifier.clickable { nav.pop() }.padding(horizontal = 4.dp, vertical = 8.dp).size(18.dp),
            )
        } else {
            Spacer(Modifier.width(8.dp))
        }
        Avatar(initials = Fmt.initials(otherName), size = 26.dp)
        Column {
            Text(otherName, style = JKType.subheadline.semibold(), color = JK.text, maxLines = 1)
            Text(subtitle, style = JKType.system(10), color = JK.tertiary, maxLines = 1)
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

/**
 * One message. As on the iPhone, a bubble takes the width the row's
 * spacer leaves it (half the row, at most 280), mine on the right in chrome.
 */
@Composable
private fun Bubble(message: Message, mine: Boolean) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = minOf(280.dp, (maxWidth - 8.dp) / 2)
        val shape = rounded(14.dp)
        val ink = if (mine) Color.Black else JK.text
        Column(
            Modifier
                .align(if (mine) Alignment.CenterEnd else Alignment.CenterStart)
                .width(width)
                .then(if (mine) Modifier.background(JK.chrome, shape) else Modifier.background(JK.card, shape).border(1.dp, JK.stroke, shape))
                .padding(12.dp),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (message.workoutId != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconTile("dumbbell", size = 28.dp)
                    Column {
                        Text("Workout", style = JKType.caption.semibold(), color = ink)
                        Text("Plan updated · see your Plan tab", style = JKType.system(10), color = JK.tertiary)
                    }
                }
            }
            if (message.text.isNotEmpty()) {
                Text(message.text, style = JKType.footnote, color = ink, modifier = Modifier.fillMaxWidth())
            }
            Text(Fmt.time(message.at), style = JKType.system(9), color = if (mine) Color.Black.copy(alpha = 0.5f) else JK.tertiary)
        }
    }
}

// MARK: - Coach: thread list

@Composable
fun CoachThreadsView() {
    var threads by remember { mutableStateOf<List<MessageThread>?>(null) }
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

    LaunchedEffect(Unit) {
        while (isActive) {
            load()
            delay(POLL_MS)
        }
    }

    JKRefreshable(onRefresh = { load() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ScreenHeader(eyebrow = "Coach", title = "Messages")
            Loadable(value = threads, error = error, retry = { load() }) { list ->
                if (list.isEmpty()) {
                    EmptyCard(systemName = "bubble.left", title = "No conversations yet")
                } else {
                    Column(Modifier.jkCard(padding = 2.dp)) {
                        list.forEach { t -> ThreadRow(t) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ThreadRow(t: MessageThread) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(rounded(12.dp))
            .navLink { MessagesThreadView(clientId = t.client.id, otherName = t.client.name, subtitle = "Client") }
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(initials = t.client.displayInitials, size = 34.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t.client.name, style = JKType.subheadline.semibold(), color = JK.text, modifier = Modifier.weight(1f))
                t.last?.at?.let { at ->
                    Text(
                        if (Day.same(at, Instant.now())) Fmt.time(at) else Fmt.dayMonth(at),
                        style = JKType.caption2,
                        color = JK.tertiary,
                    )
                }
            }
            Text(t.last?.text ?: "No messages", style = JKType.caption2, color = JK.tertiary, maxLines = 1)
        }
        if (t.unread > 0) {
            Text(
                "${t.unread}",
                style = JKType.system(10, FontWeight.Bold),
                color = Color.Black,
                modifier = Modifier.background(JK.text, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
    }
}
