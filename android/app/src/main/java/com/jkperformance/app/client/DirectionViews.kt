package com.jkperformance.app

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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.DirectionPayload
import com.jkperformance.app.net.ParWords
import com.jkperformance.app.net.Prep
import com.jkperformance.app.net.PrepInput
import com.jkperformance.app.net.Priority
import com.jkperformance.app.net.Season
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import java.time.temporal.ChronoUnit
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Your direction (plan-act-review.md, Screens 5), the Plan root: the
 * season's aim as a quote, the season as a line, the three priorities as
 * rings and the next planning session with "Prepare →". Plans without
 * 'progress' see one quiet card instead (never a 403).
 */
@Composable
fun YourDirectionView() {
    val gate = AppSession.gate
    val nav = LocalNav.current
    var direction by remember { mutableStateOf<DirectionPayload?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        if (!gate.progress) return
        try {
            direction = APIClient.get<DirectionPayload>("/api/direction")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(gate.progress) { load() }
    // Back from Before the session: pick up the saved prep.
    var wasCovered by remember { mutableStateOf(false) }
    LaunchedEffect(nav.depth) {
        if (nav.depth > 0) wasCovered = true
        else if (wasCovered) {
            wasCovered = false
            load()
        }
    }

    ParRootScreen(onRefresh = { load() }, rings = true) {
        if (!gate.progress) {
            PlanLocked()
            return@ParRootScreen
        }
        Loadable(value = direction, error = error, retry = { load() }) { d ->
            if (d.locked) {
                PlanLocked()
                return@Loadable
            }
            val aim = d.aim?.takeIf { it.isNotBlank() }
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                ParLabel("Plan · This season")
                Text(
                    if (aim != null) "“$aim”" else "Your direction is set together with JK at your first planning session.",
                    style = JKType.parQuote,
                    color = if (aim != null) JKColors.text else JKColors.textSecondary,
                )
                d.plannedLabel?.takeIf { aim != null }?.let { Text(it, style = JKType.meta, color = JKColors.textTertiary) }
            }
            if (aim != null) {
                d.season?.let { s ->
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                        ParLabel("The season", annotation = s.phaseWord)
                        SeasonLine(
                            today = s.progress.toFloat(),
                            next = nextFraction(s),
                            startLabel = s.labels.start,
                            nextLabel = s.labels.next,
                            endLabel = s.labels.end,
                        )
                    }
                }
                if (d.priorities.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                        ParLabel("What matters most")
                        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                            d.priorities.take(3).forEach { p -> PriorityCard(p, Modifier.weight(1f).fillMaxHeight()) }
                            repeat(3 - minOf(3, d.priorities.size)) { Box(Modifier.weight(1f)) }
                        }
                    }
                }
            }
            ParCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                        ParLabel("Planning session with JK")
                        Text(d.planning?.`when` ?: "Not booked yet", style = JKType.parCardTitle, color = if (d.planning == null) JKColors.textSecondary else JKColors.text)
                    }
                    SecondaryButton("Prepare", small = true, arrow = true, onClick = {
                        nav.push { BeforeTheSessionView(initial = d.prep, whenShort = d.planning?.whenShort) }
                    })
                }
            }
        }
    }
}

@Composable
private fun PlanLocked() {
    LockedCard(
        title = "Plan with *JK.*",
        line = "Coaching starts with a planning session: what matters this season, in a few sentences.",
        onSee = { TabRouter.openMembership() },
    )
}

/** Where the next planning session falls along the season, 0..1. */
private fun nextFraction(s: Season): Float? {
    val start = Day.date(s.start) ?: return null
    val end = Day.date(s.end) ?: return null
    val next = s.next?.let { Day.date(it) } ?: return null
    val total = ChronoUnit.DAYS.between(start, end).toFloat()
    if (total <= 0f) return null
    return (ChronoUnit.DAYS.between(start, next) / total).coerceIn(0f, 1f)
}

@Composable
private fun PriorityCard(p: Priority, modifier: Modifier) {
    ParCard(
        modifier.semantics(mergeDescendants = true) { contentDescription = "${p.title}, ${p.word}" },
        padding = JKSpace.m,
        spacing = JKSpace.s,
    ) {
        ParRing(p.fraction.toFloat(), JKSize.ringIcon)
        Box(Modifier.height(JKSpace.s))
        Text(p.title, style = JKType.parSmall, color = JKColors.text)
        Text(p.word, style = JKType.meta, color = JKColors.textTertiary)
    }
}

/**
 * Before the session (plan-act-review.md, Screens 6): how the month felt on a
 * dial and two short prompts JK reads before planning. Autosaves 800ms after
 * each change ("Saved" at the top right); "Share with JK" marks it shared and
 * edits still save after.
 */
@Composable
fun BeforeTheSessionView(initial: Prep?, whenShort: String?) {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var feeling by remember { mutableStateOf(initial?.feeling) }
    var easier by remember { mutableStateOf(initial?.easier ?: "") }
    var inTheWay by remember { mutableStateOf(initial?.inTheWay ?: "") }
    var shared by remember { mutableStateOf(initial?.sharedAt != null) }
    var dirty by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun save(share: Boolean = false) {
        try {
            val fresh: Prep = APIClient.send(
                "PUT", "/api/direction/prep",
                PrepInput(feeling = feeling, easier = easier, inTheWay = inTheWay, share = if (share) true else null),
            )
            if (fresh.sharedAt != null) shared = true
            saved = true
            dirty = false
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(feeling, easier, inTheWay) {
        if (!dirty) return@LaunchedEffect
        saved = false
        delay(JKMotion.AUTOSAVE)
        save()
    }

    Box(Modifier.jkScreen()) {
        FaintRings(centerY = 0.3f)
        Column(Modifier.fillMaxSize()) {
            ParBackBar(onBack = { nav.pop() }, trailing = if (saved) "Saved" else null)
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = JKSpace.gutter)
                    .padding(top = JKSpace.s, bottom = JKSpace.xxl),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    ParLabel("Plan · Before ${whenShort ?: "your session"}")
                    ParTitle("Come with a few *honest thoughts.*")
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    ParLabel("How has this month felt?")
                    Dial(
                        value = feeling?.let { it / 100f },
                        word = ParWords.prepFeeling(feeling),
                        startWord = "Hard going",
                        endWord = "Flowing",
                        label = "How has this month felt?",
                        onChange = {
                            feeling = (it * 100).roundToInt()
                            dirty = true
                        },
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    ParLabel("What felt easier?")
                    UnderlinedField(easier, { easier = it; dirty = true }, placeholder = "A line or two", label = "What felt easier?")
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    ParLabel("What keeps getting in the way?")
                    UnderlinedField(inTheWay, { inTheWay = it; dirty = true }, placeholder = "A line or two", label = "What keeps getting in the way?")
                }
                error?.let { ErrorBanner(it) }
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = JKSpace.gutter).padding(bottom = JKSpace.l)) {
                PrimaryButton(
                    if (shared) "Shared with JK" else "Share with JK",
                    enabled = !shared && !sharing,
                    onClick = {
                        sharing = true
                        scope.launch {
                            save(share = true)
                            sharing = false
                        }
                    },
                )
            }
        }
    }
}
