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
import androidx.compose.material3.TextButton
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

// region Weekly feedback (coach)

/** The top of a client's Feedback tab: write this week's review, or open a past one. */
@Composable
fun CoachReportsSection(clientId: String, clientName: String) {
    var data by remember { mutableStateOf<ReportsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var editingWeek by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            data = APIClient.get<ReportsResponse>("/api/reports", query = mapOf("clientId" to clientId))
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Eyebrow(text = "Weekly feedback")
        Loadable(value = data, error = error, retry = { load() }) { d ->
            val current = d.reports.firstOrNull { it.week == d.suggestedWeek }
            ChromeButton(onClick = { editingWeek = d.suggestedWeek }) {
                Label(
                    if (current == null) "Write feedback · week of ${Fmt.dayMonth(d.suggestedWeek)}"
                    else "Edit feedback · week of ${Fmt.dayMonth(d.suggestedWeek)}",
                    systemImage = "square.and.pencil",
                    style = LocalTextStyle.current,
                )
            }
            d.reports.forEach { r ->
                key(r.week) {
                    Row(
                        Modifier.clickable { editingWeek = r.week }.jkCard(padding = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(r.weekLabel, style = JKType.subheadline.semibold(), color = JK.text)
                            Text(
                                if (r.isPublished) (if (r.readAt != null) "Published · read" else "Published · not read yet") else "Draft",
                                style = JKType.caption2,
                                color = JK.tertiary,
                            )
                        }
                        SystemImage("chevron.right", JKType.caption, JK.tertiary)
                    }
                }
            }
        }
    }
    LaunchedEffect(clientId) { load() }

    editingWeek?.let { week ->
        // Every way out (Close, publish, delete, system back) reloads the list, like the Swift onDismiss.
        Sheet(onDismiss = {
            editingWeek = null
            scope.launch { load() }
        }) {
            key(week) { ReportEditorSheet(clientId = clientId, clientName = clientName, week = week) }
        }
    }
}

/** Write or edit one week's feedback, with that week's figures and next week's plan alongside. */
@Composable
fun ReportEditorSheet(clientId: String, clientName: String, week: String) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    // The sheet can step to other weeks, so the week shown is its own state.
    var shown by remember { mutableStateOf(week) }
    var report by remember { mutableStateOf<Report?>(null) }
    var summary by remember { mutableStateOf("") }
    var wins by remember { mutableStateOf("") }
    var focus by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    val empty = listOf(summary, wins, focus).all { it.isBlank() }

    fun shift(days: Int) {
        val d = Day.date(shown) ?: return
        shown = Day.string(Day.add(days, d))
    }

    suspend fun load() {
        report = null
        try {
            val r: Report = APIClient.get("/api/reports/week/$shown", query = mapOf("clientId" to clientId))
            report = r
            summary = r.summary
            wins = r.wins
            focus = r.focus
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun save(status: String) {
        saving = true
        try {
            report = APIClient.send<Report, ReportInput>(
                "PUT",
                "/api/reports",
                ReportInput(clientId = clientId, week = shown, summary = summary, wins = wins, focus = focus, status = status),
            )
            error = null
            if (status == "published") dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    suspend fun remove() {
        val id = report?.id ?: return
        try {
            APIClient.send<OK>("DELETE", "/api/reports/${seg(id)}")
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = clientName, leading = { BarButton("Close") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SystemImage("chevron.left", JKType.body, JK.secondary, Modifier.clickable { shift(-7) })
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Week of ${Fmt.dayMonth(shown)}", style = JKType.headline, color = JK.text)
                    Text(
                        when {
                            report?.isPublished == true -> "Published"
                            report?.id == null -> "Not started"
                            else -> "Draft"
                        },
                        style = JKType.caption2,
                        color = JK.tertiary,
                    )
                }
                SystemImage("chevron.right", JKType.body, JK.secondary, Modifier.clickable { shift(7) })
            }

            error?.let { ErrorBanner(it) }
            val stats = report?.stats
            if (stats != null) {
                ReportStatsGrid(stats = stats)
                val c = stats.checkin
                if (c != null && (c.note.isNotEmpty() || c.pain.isNotEmpty())) {
                    val parts = listOfNotNull(
                        if (c.pain.isEmpty()) null else "pain " + c.pain.joinToString(", "),
                        c.note.ifEmpty { null },
                    )
                    Text("Check-in: " + parts.joinToString(" · "), style = JKType.caption, color = JK.secondary)
                }
                if (!stats.healthShared) {
                    Text("$clientName hasn't shared Apple Health with you.", style = JKType.caption2, color = JK.tertiary)
                }
            } else if (error == null) {
                LoadingCard()
            }

            ReportField("How the week went", summary) { summary = it }
            ReportField("Wins", wins) { wins = it }
            ReportField("Focus for next week", focus) { focus = it }

            report?.plan?.let { PlanList(plan = it) }

            ChromeButton(onClick = { scope.launch { save("published") } }, enabled = !saving && !empty) {
                if (saving) {
                    ProgressView(tint = Color.Black)
                } else {
                    Text(if (report?.isPublished == true) "Update" else "Publish to $clientName")
                }
            }
            GhostButton(
                if (report?.isPublished == true) "Unpublish (back to draft)" else "Save draft",
                onClick = { scope.launch { save("draft") } },
                enabled = !saving,
            )
            if (report?.id != null) {
                Text(
                    "Delete",
                    style = JKType.footnote,
                    color = SystemRed,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clickable { confirmDelete = true },
                )
            }
            Text(
                "Publishing shows it on $clientName's Home and sends them a message. You can also write these on the web: Guides › Coach desk on the web.",
                style = JKType.caption2,
                color = JK.tertiary,
            )
        }
    }
    LaunchedEffect(shown) { load() }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch { remove() }
                }) { Text("Delete", style = JKType.body.semibold(), color = SystemRed) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Cancel", style = JKType.body, color = JK.text) }
            },
            title = { Text("Delete this week's feedback?", style = JKType.headline, color = JK.text) },
            containerColor = DialogGround,
            shape = rounded(14.dp),
        )
    }
}

/** One of the report's text boxes: a tiny caption over a raised field that grows from 3 to 12 lines. */
@Composable
private fun ReportField(title: String, text: String, onTextChange: (String) -> Unit) {
    val style = JKType.subheadline.copy(color = JK.text)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = JKType.system(10), color = JK.tertiary)
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            textStyle = style,
            minLines = 3,
            maxLines = 12,
            cursorBrush = SolidColor(JK.text),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { field ->
                Box(Modifier.fillMaxWidth().background(JK.cardRaised, rounded(10.dp)).padding(10.dp)) {
                    if (text.isEmpty()) Text(title, style = style, color = JK.tertiary)
                    field()
                }
            },
        )
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
            EmptyCard(
                systemName = "heart.slash",
                title = "Not shared",
                detail = "$clientName hasn't shared Apple Health with you. They can turn it on in Account › Apple Health.",
            )
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow(text = "Last 7 days", trailing = w.sharedSince?.let { "Shared since ${Fmt.dayMonth(it)}" })
                Column(Modifier.jkCard(padding = 0.dp)) {
                    HealthRow("", listOf("Steps", "Sleep", "RHR", "kcal"), header = true)
                    w.days.reversed().forEach { d ->
                        HorizontalDivider(thickness = Dp.Hairline, color = JK.stroke)
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
                Eyebrow(text = "Workouts", trailing = if (w.activities.isEmpty()) null else "${w.activities.size} this week")
                if (w.activities.isEmpty()) {
                    Text("No workouts recorded this week.", style = JKType.caption, color = JK.tertiary)
                } else {
                    Column(Modifier.jkCard(padding = 4.dp)) {
                        w.activities.forEach { a ->
                            key(a.id) {
                                ActivityRow(activity = a)
                                if (a.id != w.activities.last().id) HorizontalDivider(thickness = Dp.Hairline, color = JK.stroke)
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
    val style = if (header) JKType.caption2 else JKType.caption.monospacedDigit()
    val ink = if (header) JK.tertiary else JK.text
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(day, style = style, color = JK.tertiary, modifier = Modifier.width(44.dp))
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
            Text("Write feedback and plans from a computer.", style = JKType.subheadline, color = JK.secondary)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("1. On your computer, open", style = JKType.caption, color = JK.tertiary)
                // Selectable, as `.textSelection(.enabled)`: long-press to copy the address.
                SelectionContainer {
                    Text(link?.url ?: "jk.strangeramblings.com/desk", style = JKType.headline.monospaced(), color = JK.text)
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("2. Type this code", style = JKType.caption, color = JK.tertiary)
                val code = link
                val failure = error
                when {
                    code != null -> {
                        SelectionContainer {
                            Text(code.code, style = JKType.system(40, FontWeight.SemiBold).monospaced(), color = JK.text)
                        }
                        Text("Works once, until ${Fmt.time(code.expiresAt)}.", style = JKType.caption2, color = JK.tertiary)
                    }
                    failure != null -> ErrorBanner(failure)
                    else -> ProgressView()
                }
            }
            GhostButton("New code", onClick = { scope.launch { load() } })
            Text(
                "The browser stays signed in for 30 days. Sign out there when you're done on a shared computer.",
                style = JKType.caption2,
                color = JK.tertiary,
            )
            Spacer(Modifier.weight(1f))
        }
    }
    LaunchedEffect(Unit) { load() }
}

// endregion

/** The dark grey of an iOS action sheet. */
private val DialogGround = Color(0.17f, 0.17f, 0.17f)

/** iOS's dark-mode `systemRed`, the colour of a destructive role. */
private val SystemRed = Color(1.0f, 0.27f, 0.23f)
