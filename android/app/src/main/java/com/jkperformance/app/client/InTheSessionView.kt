package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.LoggedSet
import com.jkperformance.app.net.Outbox
import com.jkperformance.app.net.ParWords
import com.jkperformance.app.net.SetInput
import com.jkperformance.app.net.Workout
import com.jkperformance.app.net.WorkoutItem
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import java.time.Instant
import kotlinx.coroutines.launch

/**
 * In the session (plan-act-review.md, Screens 4): a full-screen cover over
 * the workout logger's data, one exercise at a time. "Set done" logs the next
 * set as prescribed (offline too, through the Outbox); a set circle opens the
 * existing logger to edit reps and load; after the last set of the last
 * exercise the button reads "Finish session" and opens the complete page.
 * Swipe sideways to move between exercises. Shown in a [Sheet].
 */
@Composable
fun InTheSessionView(workoutId: String) {
    val dismiss = LocalDismiss.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    var workout by remember { mutableStateOf<Workout?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var index by remember { mutableIntStateOf(-1) }
    var busy by remember { mutableStateOf(false) }

    suspend fun load() {
        if (Outbox.hasPending(workoutId)) Outbox.flush()
        if (workout != null && Outbox.hasPending(workoutId)) return
        try {
            val fresh: Workout = APIClient.get("/api/workouts/${seg(workoutId)}")
            workout = fresh
            if (index < 0) {
                val ordered = fresh.items.sortedBy { it.order }
                index = ordered.indexOfFirst { !it.isDone }.let { if (it < 0) maxOf(0, ordered.lastIndex) else it }
            }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    val w = workout
    val ordered = w?.items?.sortedBy { it.order } ?: emptyList()
    val item = ordered.getOrNull(index)

    fun nextSet(i: WorkoutItem): Int? = i.takeIf { it.sets > 0 }?.let { (1..it.sets).firstOrNull { n -> it.logged.none { s -> s.number == n } } }

    fun defaultLoad(i: WorkoutItem): String =
        i.logged.maxByOrNull { it.number }?.load ?: i.load.replace(" kg", "").replace("kg", "").trim()

    fun defaultReps(i: WorkoutItem): Int? =
        i.logged.maxByOrNull { it.number }?.reps ?: i.reps.takeWhile { it.isDigit() }.toIntOrNull()

    suspend fun logNext() {
        val current = workout ?: return
        val i = item ?: return
        val n = nextSet(i) ?: return
        val reps = defaultReps(i)
        if (reps == null) {
            // No number to log as prescribed: the logger asks for one.
            nav.push { WorkoutLoggerView(current, i.id) { workout = it } }
            return
        }
        busy = true
        val path = "/api/workouts/${seg(current.id)}/items/${seg(i.id)}/sets/$n"
        val input = SetInput(load = defaultLoad(i), reps = reps)
        try {
            workout = APIClient.send<Workout, SetInput>("PUT", path, input)
        } catch (e: Exception) {
            when {
                e.isCancellation -> throw e
                Outbox.isOffline(e) -> {
                    Outbox.enqueue("PUT", path, input)
                    workout = current.withLogged(i.id, LoggedSet(n, input.load, reps, null, Instant.now()), n)
                }
                else -> actionError = e.readable
            }
        } finally {
            busy = false
        }
        // The exercise is done: on to the next one.
        val after = workout?.items?.firstOrNull { it.id == i.id }
        if (after != null && after.isDone && index < ordered.lastIndex) index += 1
    }

    Box(Modifier.jkScreen()) {
        FaintRings(centerY = 0.55f)
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(end = JKSpace.gutter), verticalAlignment = Alignment.CenterVertically) {
                ParBackBar(onBack = dismiss, close = true, modifier = Modifier.width(JKSize.touchTarget + JKSpace.l))
                Text(
                    (w?.title ?: "Session").uppercase(), style = JKType.parLabel, color = JKColors.textTertiary,
                    textAlign = TextAlign.Center, modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(JKSize.touchTarget))
            }
            if (ordered.isNotEmpty()) {
                SegmentStrip(ordered.map { it.isDone }, index, Modifier.padding(horizontal = JKSpace.gutter, vertical = JKSpace.s))
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .pointerInput(ordered.size) {
                        var drag = 0f
                        val threshold = with(density) { JKSpace.huge.toPx() * 1.5f }
                        detectHorizontalDragGestures(
                            onDragStart = { drag = 0f },
                            onDragEnd = {
                                if (drag < -threshold && index < ordered.lastIndex) index += 1
                                if (drag > threshold && index > 0) index -= 1
                            },
                        ) { _, amount -> drag += amount }
                    }
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = JKSpace.gutter)
                    .padding(top = JKSpace.xxxl),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JKSpace.xl),
            ) {
                Loadable(value = w, error = error, retry = { load() }) { current ->
                    if (item == null) {
                        EmptyState("JK hasn't added exercises to this session yet.")
                        return@Loadable
                    }
                    ExercisePage(
                        item = item,
                        next = nextSet(item),
                        position = "${index + 1} of ${ordered.size}",
                        onEdit = { nav.push { WorkoutLoggerView(current, item.id) { workout = it } } },
                        onPrevious = if (index > 0) ({ index -= 1 }) else null,
                        onNext = if (index < ordered.lastIndex) ({ index += 1 }) else null,
                    )
                }
            }
            Column(
                Modifier.fillMaxWidth().padding(horizontal = JKSpace.gutter).padding(bottom = JKSpace.l),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JKSpace.m),
            ) {
                OfflineBanner()
                if (w != null && item != null) {
                    val allDone = ordered.all { it.isDone }
                    val next = nextSet(item)
                    when {
                        w.completedAt != null -> PrimaryButton("Done", onClick = dismiss)
                        allDone -> PrimaryButton("Finish session", onClick = {
                            nav.push { SessionCompleteView(w) { workout = it } }
                        })
                        next == null -> PrimaryButton("Next exercise", arrow = true, onClick = {
                            index = ordered.indexOfFirst { !it.isDone }.takeIf { it >= 0 } ?: minOf(index + 1, ordered.lastIndex)
                        })
                        else -> PrimaryButton("Set done", enabled = !busy, onClick = { scope.launch { logNext() } })
                    }
                    Text("Rest as long as you need", style = JKType.meta, color = JKColors.textTertiary)
                }
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

/** One exercise: NEXT or NOW, its name, the prescription in words, a circle per set, the tempo line and JK's cue. */
@Composable
private fun ExercisePage(
    item: WorkoutItem,
    next: Int?,
    position: String,
    onEdit: () -> Unit,
    onPrevious: (() -> Unit)?,
    onNext: (() -> Unit)?,
) {
    Column(
        Modifier.fillMaxWidth().semantics {
            customActions = listOfNotNull(
                onPrevious?.let { CustomAccessibilityAction("Previous exercise") { it(); true } },
                onNext?.let { CustomAccessibilityAction("Next exercise") { it(); true } },
            )
        },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        Text(
            if (item.logged.isEmpty()) "NEXT" else "NOW", style = JKType.parLabel, color = JKColors.textTertiary,
            modifier = Modifier.semantics { contentDescription = position },
        )
        ParTitle(lastWordItalic(item.exercise.name), style = JKType.parDisplay, align = TextAlign.Center)
        Text(ParWords.setsAndReps(item.sets, item.reps), style = JKType.parBody, color = JKColors.textSecondary, textAlign = TextAlign.Center)
        if (item.load.isNotBlank()) Text(item.load, style = JKType.meta, color = JKColors.textTertiary)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
        (1..maxOf(item.sets, 1)).forEach { n ->
            val logged = item.logged.firstOrNull { it.number == n }
            SetCircle(
                state = when {
                    logged != null -> SetCircleState.Logged
                    n == next -> SetCircleState.Next
                    else -> SetCircleState.Later
                },
                spoken = "Set $n" + (logged?.let { ", logged, ${it.reps} reps" + (it.load.takeIf { l -> l.isNotEmpty() }?.let { l -> " at $l" } ?: "") } ?: ", not yet"),
                onClick = onEdit,
                onLongClick = onEdit,
            )
        }
    }
    item.tempo?.takeIf { it.isNotBlank() }?.let { TempoLine(it, Modifier.padding(top = JKSpace.s)) }
    item.note?.takeIf { it.isNotBlank() }?.let { cue ->
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.l)) {
            Box(Modifier.width(JKSize.hairline).fillMaxHeight().background(JKColors.trackStrong))
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                Text("“$cue”", style = JKType.parCue, color = JKColors.textSecondary)
                Text("JK's cue", style = JKType.meta, color = JKColors.textTertiary)
            }
        }
    }
}
