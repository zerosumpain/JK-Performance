package com.jkperformance.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.ReportPlan
import com.jkperformance.app.net.ReportStats
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.WorkoutSummary
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import java.time.LocalDate
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// The week's figures and plan, shown on the coach's report screens.

@Composable
fun ReportStatsGrid(stats: ReportStats) {
    // The grid's cells, in order; a three-column LazyVGrid lays them out row by row.
    val tiles = buildList<@Composable (Modifier) -> Unit> {
        add { StatTile("Sessions", "${stats.workoutsDone}/${stats.workoutsPlanned}", it) }
        add { StatTile("Sets logged", "${stats.setsLogged}", it) }
        add { StatTile("Habits", stats.habitsPct?.let { p -> "$p%" } ?: "–", it) }
        if (stats.healthShared) {
            add { StatTile("Avg steps", stats.avgSteps?.let { s -> Fmt.number(s, digits = 0) } ?: "–", it) }
            add { StatTile("Avg sleep", stats.avgSleepMinutes?.let { m -> Fmt.minutes(m) } ?: "–", it) }
            add {
                StatTile(
                    "Workouts",
                    stats.activities?.let { a -> "${a.count}" } ?: "–",
                    it,
                    delta = stats.activities?.let { a -> if (a.minutes > 0) Fmt.duration(a.minutes) else null },
                )
            }
        }
        val start = stats.weightStart
        val end = stats.weightEnd
        if (start != null && end != null) {
            add { StatTile("Weight", "${Fmt.number(end)} kg", it, delta = if (start == end) null else "${Fmt.delta(end - start)} kg") }
        }
        stats.checkin?.let { c ->
            add { StatTile("Energy", "${c.energy}/5", it) }
            add { StatTile("Sleep (felt)", "${c.sleep}/5", it) }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label(text = "The week in numbers")
        tiles.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { tile -> tile(Modifier.weight(1f)) }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        val types = stats.activities?.types
        if (!types.isNullOrEmpty()) {
            Text(types.joinToString(" · "), style = JKType.caption, color = JKColors.textTertiary)
        }
    }
}

/** Next week's workouts. A client taps through to a published one. */
@Composable
fun PlanList(plan: ReportPlan, linkWorkouts: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label(text = "Next week's plan", trailing = "${Fmt.dayMonth(plan.from)} – ${Fmt.dayMonth(plan.to)}")
        if (plan.workouts.isEmpty()) {
            Text("Not written yet.", style = JKType.caption, color = JKColors.textTertiary)
        } else {
            Column(Modifier.jkSurface(padding = 4.dp)) {
                plan.workouts.forEach { w ->
                    if (linkWorkouts && w.published) {
                        PlanRow(w, chevron = true, modifier = Modifier.navLink { WorkoutDetailLoader(workoutId = w.id) })
                    } else {
                        PlanRow(w, chevron = false)
                    }
                    if (w.id != plan.workouts.last().id) HorizontalDivider(thickness = 0.5.dp, color = JKColors.hairline)
                }
            }
        }
    }
}

@Composable
private fun PlanRow(w: WorkoutSummary, chevron: Boolean, modifier: Modifier = Modifier) {
    val day = Day.date(w.date) ?: LocalDate.now(Day.zone)
    UpcomingRow(
        weekday = Fmt.weekday(day),
        day = "${day.dayOfMonth}",
        title = w.title,
        detail = listOfNotNull(w.startsAt, "${w.itemCount} exercises", if (w.published) null else "Draft").joinToString(" · "),
        modifier = modifier,
        chevron = chevron,
    )
}
