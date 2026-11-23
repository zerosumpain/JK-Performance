package com.jkperformance.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Habit
import com.jkperformance.app.net.HabitDayInput
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.WeekHabit
import com.jkperformance.app.net.WeekPayload
import com.jkperformance.app.net.WeekToday
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch

/**
 * Today's work (plan-act-review.md, Screens 3): the session as a strip of
 * blocks with "Start session", then up to three habits as rings with a week
 * of dots, and the next session in a quiet footer. Tapping a yes/no habit
 * ticks it; a counted one (or a long press) opens the habit sheet.
 */
@Composable
fun TodaysWorkView(initial: WeekPayload? = null) {
    val gate = AppSession.gate
    val scope = rememberCoroutineScope()
    val toast = rememberToastState()
    var week by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var habitFocus by remember { mutableStateOf<String?>(null) }
    var showHabits by remember { mutableStateOf(false) }
    var sessionId by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            week = APIClient.get<WeekPayload>("/api/week")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    fun todayIndex(p: WeekPayload): Int? = p.days.indexOfFirst { it.today }.takeIf { it >= 0 }

    suspend fun toggle(h: WeekHabit) {
        val p = week ?: return
        val done = !h.doneToday
        val i = todayIndex(p)
        // Optimistic: show the tick now, then take the server's word.
        week = p.copy(
            today = p.today?.copy(
                habits = p.today.habits.map { x ->
                    if (x.id != h.id) x
                    else x.copy(
                        doneToday = done,
                        progress = if (done) 1.0 else 0.0,
                        week = x.week.mapIndexed { k, v -> if (k == i) done else v },
                    )
                },
            ),
        )
        try {
            APIClient.send<Habit, HabitDayInput>(
                "PUT", "/api/habits/${seg(h.id)}/days/${p.date.ifEmpty { Day.today }}",
                HabitDayInput(value = null, done = done),
            )
            if (!done) toast.show("Unticked ${h.name}")
            load()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            week = p
            actionError = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    Box(Modifier.fillMaxSize()) {
    ParRootScreen(onRefresh = { load() }) {
        Loadable(value = week, error = error, retry = { load() }) { p ->
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                ParLabel("Act · ${p.dayName.ifEmpty { Fmt.weekdayName(java.time.LocalDate.now(Day.zone)) }}")
                ParTitle("Today\u2019s *work.*")
            }
            val t = p.today ?: WeekToday()
            if (t.workout != null || gate.programme) SessionCard(t, onStart = { sessionId = it })
            if (t.workout == null && !gate.programme && !(gate.habits && t.habits.isNotEmpty())) {
                LockedCard(
                    title = "Train with *JK*",
                    line = "Your sessions and habits arrive here once JK writes your programme.",
                    onSee = { TabRouter.openMembership() },
                )
            }
            if (gate.habits && t.habits.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    ParLabel("Habits", annotation = "the work between sessions")
                    HabitRow(
                        habits = t.habits,
                        todayIndex = todayIndex(p),
                        onTap = { h ->
                            if (h.isCount) {
                                habitFocus = h.id
                                showHabits = true
                            } else {
                                scope.launch { toggle(h) }
                            }
                        },
                        onLong = { h ->
                            habitFocus = h.id
                            showHabits = true
                        },
                    )
                }
            }
            p.footer?.let { FooterLine(it) }
        }
    }
    ToastHost(toast)
    }

    if (showHabits) {
        Sheet(onDismiss = {
            showHabits = false
            scope.launch { load() }
        }) { HabitSheet(focus = habitFocus) }
    }
    sessionId?.let { id ->
        Sheet(onDismiss = {
            sessionId = null
            scope.launch { load() }
        }) { InTheSessionView(workoutId = id) }
    }
    ErrorAlert(actionError) { actionError = null }
}

/** SESSION · ABOUT 45 MINUTES, the title, the block strip and Start session; or the rest day. */
@Composable
private fun SessionCard(t: WeekToday, onStart: (String) -> Unit) {
    val w = t.workout
    ParCard(Modifier.fillMaxWidth(), padding = JKSpace.xl, spacing = JKSpace.l) {
        if (w == null) {
            ParLabel("Session")
            Text("Rest day", style = JKType.parQuote, color = JKColors.text)
            t.coachLine?.takeIf { it.isNotEmpty() }?.let { Text(it, style = quoteStyle(inSheet = true), color = JKColors.textSecondary) }
            return@ParCard
        }
        ParLabel(listOfNotNull("Session", w.minutes?.let { "about $it minutes" }).joinToString(" · "))
        Text(w.title, style = JKType.parQuote, color = JKColors.text)
        if (w.blocks.isNotEmpty()) BlockStrip(w.blocks.map { StripBlock(it.label, it.done) })
        val started = w.blocks.any { it.done }
        PrimaryButton(
            text = when {
                w.completed -> "Done today"
                started -> "Continue"
                else -> "Start session"
            },
            enabled = !w.completed,
            onClick = { onStart(w.id) },
        )
    }
}

/** Habit cards, three to a row; more scroll sideways. */
@Composable
private fun HabitRow(habits: List<WeekHabit>, todayIndex: Int?, onTap: (WeekHabit) -> Unit, onLong: (WeekHabit) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = JKSpace.s
        val cardWidth = (maxWidth - gap * 2) / 3
        Row(
            Modifier.fillMaxWidth().then(if (habits.size > 3) Modifier.horizontalScroll(rememberScrollState()) else Modifier),
            horizontalArrangement = Arrangement.spacedBy(gap),
        ) {
            habits.forEach { h ->
                ParCard(
                    Modifier
                        .width(cardWidth)
                        .heightIn(min = JKSize.ringCommitment * 2)
                        .semantics {
                            contentDescription = h.name
                            stateDescription = when {
                                h.doneToday -> "Done today"
                                h.isCount -> "${Fmt.number(h.value ?: 0.0)} of ${Fmt.number(h.target)} ${h.unit}".trim()
                                else -> "Not yet"
                            }
                        },
                    onClick = { onTap(h) },
                    onClickLabel = if (h.isCount) "Open" else if (h.doneToday) "Untick" else "Tick",
                    onLongClick = { onLong(h) },
                    padding = JKSpace.m,
                    spacing = JKSpace.m,
                ) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                        ParRing(
                            h.progress.toFloat(), JKSize.ringHabit,
                            state = if (h.doneToday) RingState.Done else RingState.Progress,
                        )
                        Text(h.name, style = JKType.habitName, color = JKColors.text, textAlign = TextAlign.Center, maxLines = 3)
                        if (h.week.isNotEmpty()) HabitWeekDots(h.week, todayIndex)
                    }
                }
            }
        }
    }
}
