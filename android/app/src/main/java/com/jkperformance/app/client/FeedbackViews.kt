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
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.Dot
import com.jkperformance.app.design.EmptyCard
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.IconTile
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKRefreshable
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Loadable
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.StatTile
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.UpcomingRow
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
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

// MARK: - Weekly feedback (client)

/** Every week the coach has written up, newest first; unread ones marked. */
@Composable
fun WeeklyFeedbackListView() {
    var reports by remember { mutableStateOf<List<Report>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ReportsResponse = APIClient.get("/api/reports")
            reports = reply.reports
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ScreenHeader(eyebrow = "From ${AppSession.me?.coach?.name ?: "your coach"}", title = "Feedback")
                Loadable(value = reports, error = error, retry = { load() }) { list ->
                    if (list.isEmpty()) {
                        EmptyCard(
                            systemName = "text.bubble",
                            title = "Nothing yet",
                            detail = "Your coach's review of each week appears here, with the plan for the next one.",
                        )
                    }
                    list.forEach { r ->
                        Row(
                            Modifier.clip(rounded(JK.corner)).navLink { ReportDetailView(reportId = r.id ?: "") }.jkCard(padding = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconTile("text.bubble")
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(r.weekLabel, style = JKType.subheadline.semibold(), color = JK.text)
                                Text(firstLine(r), style = JKType.caption2, color = JK.tertiary, maxLines = 2)
                            }
                            if (r.isUnread) Dot(JK.text, size = 8.dp, modifier = Modifier.semantics { contentDescription = "New" })
                            SystemImage("chevron.right", JKType.caption, JK.tertiary)
                        }
                    }
                }
            }
        }
    }
}

private fun firstLine(r: Report): String = listOf(r.summary, r.wins, r.focus).firstOrNull { it.isNotEmpty() } ?: ""

/** One week's feedback: the coach's words, the week's figures, next week's plan. */
@Composable
fun ReportDetailView(reportId: String) {
    var report by remember { mutableStateOf<Report?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            report = APIClient.get("/api/reports/${seg(reportId)}")
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    LaunchedEffect(reportId) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Loadable(value = report, error = error, retry = { load() }) { r ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Eyebrow(text = "${Fmt.dayMonth(r.week)} – ${Fmt.dayMonth(r.weekEnd)}")
                    Text("Your week", style = JKType.largeTitle.semibold(), color = JK.text)
                    r.coachName?.let { by ->
                        Text(
                            "From $by" + (r.publishedAt?.let { " · ${Fmt.dayMonth(it)}" } ?: ""),
                            style = JKType.caption,
                            color = JK.tertiary,
                        )
                    }
                }
                ReportSection(title = "How it went", text = r.summary)
                ReportSection(title = "Wins", text = r.wins)
                ReportSection(title = "Focus for next week", text = r.focus)
                r.stats?.let { ReportStatsGrid(stats = it) }
                r.plan?.let { PlanList(plan = it, linkWorkouts = true) }
            }
        }
    }
}

@Composable
private fun ReportSection(title: String, text: String) {
    if (text.isEmpty()) return
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Eyebrow(text = title)
        Text(text, style = JKType.body, color = JK.text)
    }
}

/** The week in numbers. Health figures appear only when shared. */
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
        Eyebrow(text = "The week in numbers")
        tiles.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { tile -> tile(Modifier.weight(1f)) }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        val types = stats.activities?.types
        if (!types.isNullOrEmpty()) {
            Text(types.joinToString(" · "), style = JKType.caption2, color = JK.tertiary)
        }
    }
}

/** Next week's workouts. A client taps through to a published one. */
@Composable
fun PlanList(plan: ReportPlan, linkWorkouts: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(text = "Next week's plan", trailing = "${Fmt.dayMonth(plan.from)} – ${Fmt.dayMonth(plan.to)}")
        if (plan.workouts.isEmpty()) {
            Text("Not written yet.", style = JKType.caption, color = JK.tertiary)
        } else {
            Column(Modifier.jkCard(padding = 4.dp)) {
                plan.workouts.forEach { w ->
                    if (linkWorkouts && w.published) {
                        PlanRow(w, chevron = true, modifier = Modifier.navLink { WorkoutDetailLoader(workoutId = w.id) })
                    } else {
                        PlanRow(w, chevron = false)
                    }
                    if (w.id != plan.workouts.last().id) HorizontalDivider(thickness = 0.5.dp, color = JK.stroke)
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
