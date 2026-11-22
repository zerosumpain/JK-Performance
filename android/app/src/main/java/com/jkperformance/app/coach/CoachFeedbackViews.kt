package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.*
import com.jkperformance.app.net.*
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// region Letters (coach)

/** A client's letters: write this week's, or open a past one in the composer. */
@Composable
fun CoachReportsSection(clientId: String, clientName: String, client: PersonRef) {
    val nav = LocalNav.current
    var data by remember { mutableStateOf<ReportsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            data = APIClient.get<ReportsResponse>("/api/reports", query = mapOf("clientId" to clientId))
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }
    LaunchedEffect(clientId) { load() }

    fun state(r: Report): String {
        val week = "Week of ${Fmt.dayMonth(r.week)}"
        return when (r.letterStatus ?: if (r.isPublished) "published" else "draft") {
            "published" -> "$week · delivered" + (if (r.readAt != null) " · read" else "") + (if (r.answer != null) " · answered" else "")
            "scheduled" -> "$week · scheduled"
            else -> "$week · draft"
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Loadable(value = data, error = error, retry = { load() }) { d ->
            val written = d.reports.any { it.week == d.suggestedWeek && it.kind != "milestone" }
            PrimaryButton(
                if (written) "Edit the letter · week of ${Fmt.dayMonth(d.suggestedWeek)}" else "Write this week's letter",
                onClick = { nav.push { LetterComposer(client = client, week = d.suggestedWeek) } },
            )
            if (d.reports.isEmpty()) {
                Text("No letters yet.", style = JKType.caption, color = JKColors.textSecondary)
            } else {
                Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                    d.reports.forEachIndexed { i, r ->
                        CoachRowLabel(
                            r.displayHeadline,
                            Modifier.clickable(enabled = !r.isMilestone) { nav.push { LetterComposer(client = client, week = r.week) } },
                            icon = if (r.isMilestone) IconKey.milestone else IconKey.letter,
                            detail = state(r),
                            chevron = !r.isMilestone,
                        )
                        if (i < d.reports.lastIndex) GroupDivider()
                    }
                }
            }
        }
    }
}

// endregion

// region Health tab (coach)

/** The client's last seven days from their phone's health data and their workouts, if they share it. */
@Composable
fun CoachHealthTab(clientId: String, clientName: String) {
    var week by remember { mutableStateOf<HealthWeek?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            week = APIClient.get<HealthWeek>("/api/health/week", query = mapOf("clientId" to clientId))
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Loadable(value = week, error = error, retry = { load() }) { w ->
        if (!w.shared) {
            EmptyCard(title = "Not shared", detail = "$clientName hasn't shared Apple Health with you. They can turn it on in Account › Apple Health.")
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label(text = "Last 7 days", trailing = w.sharedSince?.let { "Shared since ${Fmt.dayMonth(it)}" })
                Column(Modifier.jkSurface(padding = 0.dp)) {
                    HealthRow("", listOf("Steps", "Sleep", "RHR", "kcal"), header = true)
                    w.days.reversed().forEach { d ->
                        HorizontalDivider(thickness = Dp.Hairline, color = JKColors.hairline)
                        HealthRow(
                            d.date?.let(Day::date)?.let { Fmt.weekday(it) } ?: "",
                            listOf(
                                d.steps?.let { Fmt.number(it, digits = 0) } ?: "–",
                                d.sleepMinutes?.let { Fmt.minutes(it) } ?: "–",
                                d.restingHr?.let { Fmt.number(it, digits = 0) } ?: "–",
                                d.activeKcal?.let { Fmt.number(it, digits = 0) } ?: "–",
                            ),
                            header = false,
                        )
                    }
                }
                Label(text = "Workouts", trailing = if (w.activities.isEmpty()) null else "${w.activities.size} this week")
                if (w.activities.isEmpty()) {
                    Text("No workouts recorded this week.", style = JKType.caption, color = JKColors.textTertiary)
                } else {
                    Column(Modifier.jkSurface(padding = 4.dp)) {
                        w.activities.forEach { a ->
                            key(a.id) {
                                ActivityRow(activity = a)
                                if (a.id != w.activities.last().id) HorizontalDivider(thickness = Dp.Hairline, color = JKColors.hairline)
                            }
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(clientId) { load() }
}

/** One row of the seven-day table: the weekday, then four right-aligned figures (or the column titles). */
@Composable
private fun HealthRow(day: String, values: List<String>, header: Boolean) {
    val style = if (header) JKType.caption else JKType.caption.monospacedDigit()
    val ink = if (header) JKColors.textTertiary else JKColors.text
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(day, style = style, color = JKColors.textTertiary, modifier = Modifier.width(44.dp))
        values.forEach { Text(it, style = style, color = ink, textAlign = TextAlign.End, modifier = Modifier.weight(1f)) }
    }
}

// endregion

// region Coach desk on the web

/** Shows a one-time code to type into the web desk (valid ten minutes). */
@Composable
fun WebDeskSheet() {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var link by remember { mutableStateOf<LinkCode?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            link = APIClient.send<LinkCode>("POST", "/api/auth/link-code")
            error = null
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = "Coach desk on the web", trailing = { BarButton("Done", bold = true) { dismiss() } })
        Column(
            Modifier.fillMaxWidth().weight(1f).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Write feedback and plans from a computer.", style = JKType.callout, color = JKColors.textSecondary)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("1. On your computer, open", style = JKType.caption, color = JKColors.textTertiary)
                // Selectable, as `.textSelection(.enabled)`: long-press to copy the address.
                SelectionContainer {
                    Text(link?.url ?: "jk.strangeramblings.com/desk", style = JKType.headline.monospaced(), color = JKColors.text)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("2. Type this code", style = JKType.caption, color = JKColors.textTertiary)
                val code = link
                val failure = error
                when {
                    code != null -> {
                        SelectionContainer {
                            Text(code.code, style = JKType.display.monospaced(), color = JKColors.text)
                        }
                        Text("Works once, until ${Fmt.time(code.expiresAt)}.", style = JKType.caption, color = JKColors.textTertiary)
                    }
                    failure != null -> ErrorBanner(failure)
                    else -> ProgressView()
                }
            }
            SecondaryButton("New code", onClick = { scope.launch { load() } })
            Text(
                "The browser stays signed in for 30 days. Sign out there when you're done on a shared computer.",
                style = JKType.caption,
                color = JKColors.textTertiary,
            )
            Spacer(Modifier.weight(1f))
        }
    }
    LaunchedEffect(Unit) { load() }
}

// endregion


