package com.jkperformance.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AcceptInput
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.Commitment
import com.jkperformance.app.net.ParWords
import com.jkperformance.app.net.ReflectionInput
import com.jkperformance.app.net.ReviewPayload
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Look back (plan-act-review.md, Screens 7), the Review root: how the week
 * felt on a five-stop dial, what the client said they'd do (tap a ring to
 * cycle kept, mostly, missed), one thing noticed, and "Share with JK".
 * Autosaves as a partial reflection. When JK has agreed commitments the
 * client hasn't accepted, the Accountability session opens over it.
 */
@Composable
fun LookBackView() {
    val gate = AppSession.gate
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var review by remember { mutableStateOf<ReviewPayload?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var feeling by remember { mutableStateOf<Int?>(null) }
    var noticed by remember { mutableStateOf("") }
    val outcomes = remember { mutableStateMapOf<String, String?>() }
    var dirty by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var openedSessionFor by remember { mutableStateOf<String?>(null) }

    fun adopt(p: ReviewPayload, fields: Boolean) {
        review = p
        if (fields) {
            feeling = p.reflection?.feeling
            noticed = p.reflection?.noticed ?: ""
            outcomes.clear()
            p.commitments.forEach { outcomes[it.id] = it.outcome }
            dirty = false
        }
    }

    suspend fun load() {
        if (!gate.checkin) return
        try {
            adopt(APIClient.get("/api/review"), fields = !dirty)
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun save(share: Boolean = false) {
        try {
            val fresh: ReviewPayload = APIClient.send(
                "POST", "/api/review/reflection",
                ReflectionInput(
                    feeling = feeling,
                    noticed = noticed,
                    outcomes = outcomes.toMap().ifEmpty { null },
                    share = if (share) true else null,
                ),
            )
            dirty = false
            adopt(fresh, fields = false)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    fun openSession() {
        val p = review ?: return
        nav.push { AccountabilitySessionView(p, onAccepted = { adopt(it, fields = !dirty) }) }
    }

    LaunchedEffect(gate.checkin) { load() }
    LaunchedEffect(feeling, noticed, outcomes.toMap()) {
        if (!dirty) return@LaunchedEffect
        delay(JKMotion.AUTOSAVE)
        save()
    }
    // A pending session (agreed commitments not yet accepted) opens over Look back, once per week.
    LaunchedEffect(review?.session?.pending, review?.session?.agreedWeek) {
        val s = review?.session ?: return@LaunchedEffect
        val key = s.agreedWeek ?: s.letterId ?: "session"
        if (s.pending && openedSessionFor != key && nav.depth == 0) {
            openedSessionFor = key
            openSession()
        }
    }
    // A tapped letter: the Accountability session when it is the latest, else the letter itself.
    LaunchedEffect(TabRouter.reviewLetter, review) {
        val id = TabRouter.reviewLetter ?: return@LaunchedEffect
        val p = review ?: if (gate.checkin) return@LaunchedEffect else null
        TabRouter.reviewLetter = null
        nav.popToRoot()
        if (p?.session != null && p.session.letterId == id) openSession() else nav.push(ClientRoute.letter(id))
    }
    // Back from the session or a letter: re-read.
    var wasCovered by remember { mutableStateOf(false) }
    LaunchedEffect(nav.depth) {
        if (nav.depth > 0) wasCovered = true
        else if (wasCovered) {
            wasCovered = false
            load()
        }
    }

    val p = review
    val shared = p?.reflection?.sharedAt != null
    ParRootScreen(
        onRefresh = { load() },
        footer = if (p != null && !p.locked && gate.checkin) ({
            PrimaryButton(
                if (shared && !dirty) "Shared with JK" else "Share with JK",
                enabled = !sharing,
                onClick = {
                    sharing = true
                    scope.launch {
                        save(share = true)
                        sharing = false
                    }
                },
            )
        }) else null,
    ) {
        if (!gate.checkin) {
            ReviewLocked()
            return@ParRootScreen
        }
        Loadable(value = p, error = error, retry = { load() }) { r ->
            if (r.locked) {
                ReviewLocked()
                return@Loadable
            }
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                ParLabel(r.label ?: if (r.booking != null) "Review · Before your session" else "Review · This week")
                ParTitle("How did the week *feel?*")
            }
            Dial(
                value = feeling?.let { (it - 1) / 4f },
                word = ParWords.reviewFeeling(feeling),
                startWord = "Flat",
                endWord = "Strong",
                stops = 5,
                label = "How did the week feel?",
                onChange = {
                    feeling = (it * 4).roundToInt() + 1
                    dirty = true
                },
            )
            if (r.commitments.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
                    ParLabel("What you said you'd do")
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                        r.commitments.take(3).forEach { c ->
                            CommitmentRing(c, outcomes[c.id], Modifier.weight(1f).fillMaxHeight()) {
                                outcomes[c.id] = ParWords.nextOutcome(outcomes[c.id])
                                dirty = true
                            }
                        }
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                ParLabel("One thing you noticed")
                UnderlinedField(noticed, { noticed = it; dirty = true }, placeholder = "A line is plenty", label = "One thing you noticed")
            }
            val s = r.session
            if (s != null && !s.pending) {
                ParCard(Modifier.fillMaxWidth(), onClick = { openSession() }, onClickLabel = "Open the accountability session") {
                    ParLabel("From your session with JK")
                    Text(s.with ?: "Accountability session", style = JKType.parSmall, color = JKColors.text)
                }
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun ReviewLocked() {
    LockedCard(
        title = "Review with *JK.*",
        line = "A weekly accountability session: look back, then agree a few commitments for the week ahead.",
        onSee = { TabRouter.openMembership() },
    )
}

/** A commitment as a 56dp ring: kept full with a check, mostly 70%, missed dashed. Tap cycles the outcome. */
@Composable
private fun CommitmentRing(c: Commitment, outcome: String?, modifier: Modifier, onCycle: () -> Unit) {
    val word = ParWords.outcome(outcome)
    Column(
        modifier
            .clickable(role = Role.Button, onClickLabel = "Change", onClick = onCycle)
            .semantics(mergeDescendants = true) {
                contentDescription = c.text
                stateDescription = word?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "Not marked"
            }
            .padding(vertical = JKSpace.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(JKSpace.s),
    ) {
        ParRing(
            0f, JKSize.ringCommitment,
            state = when (outcome) {
                "kept" -> RingState.Done
                "mostly" -> RingState.Mostly
                "missed" -> RingState.Missed
                else -> RingState.Progress
            },
            idleStrong = true,
        )
        Text(c.text, style = JKType.parSmall, color = JKColors.text, textAlign = TextAlign.Center)
        Text(word ?: " ", style = JKType.parLabel.copy(fontSize = JKType.markSmall.fontSize), color = JKColors.textTertiary)
    }
}

/**
 * Accountability session (plan-act-review.md, Screens 8): JK's notes, the
 * shape of the month, and what was agreed. "I'm in" accepts the commitments
 * and returns to Look back; "Message JK" opens the composer.
 */
@Composable
fun AccountabilitySessionView(initial: ReviewPayload, onAccepted: (ReviewPayload) -> Unit) {
    val nav = LocalNav.current
    val gate = AppSession.gate
    val scope = rememberCoroutineScope()
    val session = initial.session
    var accepting by remember { mutableStateOf(false) }
    var accepted by remember { mutableStateOf(session?.acceptedAt != null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun accept() {
        val week = session?.agreedWeek ?: return
        accepting = true
        try {
            val fresh: ReviewPayload = APIClient.send("POST", "/api/review/accept", AcceptInput(week))
            accepted = true
            onAccepted(fresh)
            nav.pop()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            accepting = false
        }
    }

    Column(Modifier.jkScreen()) {
        ParBackBar(onBack = { nav.pop() })
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = JKSpace.gutter)
                .padding(bottom = JKSpace.xxl),
            verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                JKAvatar(AppSession.me?.coach?.avatarMediaId, size = JKSize.sessionAvatar)
                Column {
                    Text("Accountability session", style = JKType.parHeadline, color = JKColors.text)
                    session?.with?.let { Text(it, style = JKType.meta, color = JKColors.textTertiary) }
                }
            }
            if (session == null) {
                EmptyState("JK's notes from your session will be here.")
                return@Column
            }
            if (session.notes.isNotBlank()) {
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    ParLabel("JK's notes")
                    Text(notesText(session.notes), style = JKType.parNotes)
                }
            }
            session.shape?.takeIf { it.weeks.isNotEmpty() }?.let { shape ->
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    ParLabel("The shape of your month", annotation = shape.trend)
                    ShapeBars(shape.weeks.map { ShapeWeek(it.feeling, it.word.ifEmpty { ParWords.reviewFeeling(it.feeling) }) })
                }
            }
            if (session.agreed.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    ParLabel("Agreed in the session")
                    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                        session.agreed.take(3).forEachIndexed { i, c ->
                            ParCard(Modifier.weight(1f).fillMaxHeight(), padding = JKSpace.m, spacing = JKSpace.xs) {
                                Text(ParWords.roman(i), style = JKType.annotation, color = JKColors.textTertiary)
                                Text(c.text, style = JKType.parSmall, color = JKColors.text)
                            }
                        }
                        if (session.agreed.size == 1) Box(Modifier.weight(1f))
                    }
                }
            }
            error?.let { ErrorBanner(it) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = JKSpace.gutter).padding(bottom = JKSpace.l),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        ) {
            if (gate.messaging) {
                SecondaryButton("Message JK", onClick = { TabRouter.openJK() }, modifier = Modifier.weight(1f))
            }
            if (session != null && session.agreed.isNotEmpty()) {
                PrimaryButton(
                    if (accepted) "You're in" else "I'm in",
                    enabled = !accepted && !accepting,
                    onClick = { scope.launch { accept() } },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** The first two sentences in text colour, the rest in textSecondary, as the board sets JK's notes. */
private fun notesText(notes: String) = buildAnnotatedString {
    val sentences = notes.trim().split(Regex("(?<=[.?!])\\s+"))
    sentences.forEachIndexed { i, s ->
        if (i > 0) append(" ")
        withStyle(SpanStyle(color = if (i < 2) JKColors.text else JKColors.textSecondary)) { append(s) }
    }
}
