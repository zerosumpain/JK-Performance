package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import java.time.ZoneOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.*
import com.jkperformance.app.net.*
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * One client, for the coach (atelier-spec.md, Coach screens 3): an Overview
 * with no segments. Goal, habit week with rest days, the latest check-in and
 * "Write this week's letter", the next session and three health numbers;
 * rows below open the plan, sessions, letters, forms and health detail.
 */
@Composable
fun ClientDetailView(clientId: String, name: String) {
    val scope = rememberCoroutineScope()
    val nav = LocalNav.current
    var detail by remember { mutableStateOf<ClientDetail?>(null) }
    var history by remember { mutableStateOf<HabitHistory?>(null) }
    var health by remember { mutableStateOf<HealthWeek?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var editingGoal by remember { mutableStateOf<Pair<Goal?, Boolean>?>(null) }
    var givingRest by remember { mutableStateOf(false) }

    val fullName = detail?.client?.name ?: name
    val firstName = Fmt.firstWord(fullName)
    val person = PersonRef(id = clientId, name = fullName, initials = detail?.client?.initials)
    val goal = detail?.goals.orEmpty().let { goals ->
        goals.firstOrNull { it.status == "active" } ?: goals.firstOrNull { it.isDraft } ?: goals.firstOrNull()
    }
    val lettersOn = (detail?.settings?.letterRhythm?.every ?: "weekly") != "none"

    suspend fun load() {
        try {
            detail = APIClient.get<ClientDetail>("/api/coach/clients/${seg(clientId)}")
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
        val week = Day.add(-6, LocalDate.now(Day.zone))
        history = runCatching {
            APIClient.get<HabitHistory>("/api/habits/history", mapOf("clientId" to clientId, "from" to Day.string(week), "to" to Day.today))
        }.getOrNull()
        health = runCatching { APIClient.get<HealthWeek>("/api/health/week", mapOf("clientId" to clientId)) }.getOrNull()
    }

    suspend fun removeRest(rest: RestDay) {
        try {
            APIClient.send<OK>("DELETE", "/api/clients/${seg(clientId)}/rest-days/${seg(rest.date)}")
            load()
        } catch (e: Throwable) {
            actionError = e.readable
        }
    }

    LaunchedEffect(clientId) { load() }

    Column(Modifier.jkScreen()) {
        TopBar(firstName) {
            Box(
                Modifier
                    .size(JKSize.touchTarget)
                    .navLink { MessagesThreadView(clientId = clientId, otherName = fullName, subtitle = Fmt.planName(detail?.client?.plan)) }
                    .semantics { contentDescription = "Messages with $firstName" },
                contentAlignment = Alignment.Center,
            ) { Glyph(IconKey.messages, tint = JKColors.text) }
        }
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
            ) {
                val d = detail
                val currentError = error
                when {
                    d == null && currentError != null -> ErrorCard(currentError, retry = { load() })
                    d == null -> LoadingCard()
                    else -> {
                        if (currentError != null) ErrorBanner(currentError)
                        OverviewHeader(d, name)
                        GoalCard(goal, onEdit = { editingGoal = goal to true })

                        // Habits and rest days
                        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                            val count = history?.habits?.size ?: 0
                            val minimum = d.settings?.dayMinimum
                            CoachSectionTitle("Habit week", trailing = if (minimum != null && count > 0) "Day done at $minimum of $count" else null)
                            val h = history
                            if (h != null) HabitWeekGrid(h, d.restDays.orEmpty())
                            else Text("Habit week unavailable.", style = JKType.caption, color = JKColors.textSecondary)
                            val upcoming = d.restDays.orEmpty().filter { it.date >= Day.today }
                            if (upcoming.isNotEmpty()) {
                                Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                                    upcoming.forEach { rest ->
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            CoachRowLabel(Fmt.longDay(rest.date), Modifier.weight(1f), icon = IconKey.rest, detail = rest.reason, chevron = false)
                                            TextButton("Remove", onClick = { scope.launch { removeRest(rest) } },
                                                modifier = Modifier.padding(end = JKSpace.m).semantics { contentDescription = "Remove the rest day on ${Fmt.longDay(rest.date)}" })
                                        }
                                    }
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                SecondaryButton("Edit habits", modifier = Modifier.weight(1f), onClick = {
                                    nav.push { CoachSubpage("Habits") { CoachHabitsTab(clientId, dayMinimum = d.settings?.dayMinimum) } }
                                })
                                SecondaryButton("Give a rest day", modifier = Modifier.weight(1f), onClick = { givingRest = true })
                            }
                        }

                        // Check-in and letter
                        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                            CoachSectionTitle("Latest check-in", trailing = d.latestCheckin?.submittedAt?.let { Fmt.relative(it) })
                            val c = d.latestCheckin
                            if (c != null) LatestCheckInCard(c)
                            else Text("No check-in yet.", style = JKType.caption, color = JKColors.textSecondary)
                            if (lettersOn) {
                                PrimaryButton("Write this week's letter", onClick = {
                                    nav.push { LetterComposer(client = person, week = c?.week?.week) }
                                })
                            }
                        }

                        // Next session
                        d.nextBooking?.let { b ->
                            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                CoachSectionTitle("Next session")
                                Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) { DayAgendaRow(b) }
                                Text(Fmt.longDay(b.start), style = JKType.caption, color = JKColors.textSecondary)
                            }
                        }

                        // Health
                        health?.let { h ->
                            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                                CoachSectionTitle("Health", trailing = if (h.shared) "Last 7 days" else null)
                                if (h.shared) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                                        HealthTile("Steps", h.days.lastOrNull()?.steps?.let { Fmt.number(it, digits = 0) }, h.days.map { it.steps }, Modifier.weight(1f))
                                        HealthTile("Sleep", h.days.lastOrNull()?.sleepMinutes?.let { Fmt.minutes(it) }, h.days.map { it.sleepMinutes }, Modifier.weight(1f))
                                        HealthTile("Resting HR", h.days.lastOrNull()?.restingHr?.let { Fmt.number(it, digits = 0) }, h.days.map { it.restingHr }, Modifier.weight(1f))
                                    }
                                } else {
                                    Text("$firstName hasn't shared their health data with you.", style = JKType.caption, color = JKColors.textSecondary)
                                }
                            }
                        }

                        // Links
                        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                            CoachRowLabel("Plan", Modifier.navLink { CoachSubpage("Plan") { CoachPlanTab(clientId, fullName) } },
                                icon = IconKey.workout, detail = "This week, swap an exercise, add a note")
                            GroupDivider()
                            CoachRowLabel("Sessions", Modifier.navLink { CoachSubpage("Sessions") { CoachSessionsTab(person) } }, icon = IconKey.week)
                            GroupDivider()
                            CoachRowLabel("Letters and check-ins", Modifier.navLink {
                                CoachSubpage("Letters") {
                                    CoachReportsSection(clientId = clientId, clientName = firstName, client = person)
                                    CoachSectionTitle("Check-ins")
                                    CoachNotesTab(clientId)
                                }
                            }, icon = IconKey.letter)
                            GroupDivider()
                            CoachRowLabel("Assign programme, send a form, read answers",
                                Modifier.navLink { CoachSubpage("Programme and forms") { ClientAutomationSection(client = person) } }, icon = IconKey.form)
                            GroupDivider()
                            CoachRowLabel("Health detail", Modifier.navLink {
                                CoachSubpage("Health") { CoachHealthTab(clientId = clientId, clientName = firstName) }
                            }, icon = IconKey.fromHealth)
                            val profile = d.profile
                            if (profile != null && !profile.isEmpty) {
                                GroupDivider()
                                CoachRowLabel("First-run answers", Modifier.navLink {
                                    CoachSubpage("About $firstName") { ClientAboutCard(profile) }
                                }, icon = IconKey.clients)
                            }
                        }
                    }
                }
            }
        }
    }

    editingGoal?.let { (g, _) ->
        Sheet(onDismiss = { editingGoal = null }) { GoalEditorSheet(clientId, g) { load() } }
    }
    if (givingRest) Sheet(onDismiss = { givingRest = false }) { RestDaySheet(clientId, firstName) { load() } }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun OverviewHeader(d: ClientDetail, name: String) {
    val c = d.client
    val subtitle = buildList {
        add(Fmt.planName(c.plan))
        c.since?.let(Day::date)?.let { add("since ${Fmt.monthYear(it)}") }
    }.joinToString(" · ")
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            Avatar(initials = c.displayInitials, size = JKSize.avatar + JKSpace.m)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(c.name.ifEmpty { name }, style = JKType.headline, color = JKColors.text)
                Text(subtitle, style = JKType.caption, color = JKColors.textSecondary)
            }
        }
        val pills = overviewPills(d)
        if (pills.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) { pills.forEach { (text, color) -> StatusPill(text, color) } }
        }
    }
}

/** At most two: a word plus a dot. */
@Composable
private fun overviewPills(d: ClientDetail): List<Pair<String, androidx.compose.ui.graphics.Color>> {
    val out = mutableListOf<Pair<String, androidx.compose.ui.graphics.Color>>()
    val check = d.latestCheckin
    if (!check?.pain.isNullOrEmpty() && check?.reviewedAt == null) out += "Pain flagged" to JKColors.urgent
    else if (!d.client.demand?.urgent.isNullOrEmpty()) out += "Needs you" to JKColors.urgent
    if (check != null && check.reviewedAt == null) out += "Check-in in" to JKColors.attention
    if ((d.client.unread ?: 0) > 0) out += "Message in" to JKColors.attention
    if (d.client.demand?.kind == "quiet" || d.client.demand?.kind == "inactive") out += "Gone quiet" to JKColors.textSecondary
    if (out.isEmpty()) out += "On track" to JKColors.onTrack
    return out.take(2)
}

@Composable
private fun HealthTile(label: String, value: String?, series: List<Double?>, modifier: Modifier = Modifier) {
    Column(
        modifier.background(JKColors.surface, JKShape.card).padding(JKSpace.m).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(JKSpace.xs),
    ) {
        Text(label, style = JKType.caption, color = JKColors.textSecondary)
        Text(value ?: "–", style = JKType.callout.monospacedDigit(), color = JKColors.text, maxLines = 1)
        Sparkline(series, Modifier.height(28.dp))
    }
}

/** The latest check-in, read-only: the reply arrives as the letter. */
@Composable
fun LatestCheckInCard(checkin: LatestCheckIn) {
    val figures = listOfNotNull(
        checkin.energy?.let { "Energy $it" },
        checkin.stress?.let { "Stress $it" },
        checkin.sleep?.let { "Sleep $it" },
    ).joinToString(" · ").ifEmpty { "Checked in" }
    Column(Modifier.jkSurface().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Text(figures, style = JKType.callout.monospacedDigit(), color = JKColors.text)
        checkin.pain?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Pain", it.joinToString(", ")) }
        checkin.win?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Win", it) }
        checkin.struggle?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Struggle", it) }
        checkin.note?.takeIf { it.isNotEmpty() }?.let { CoachCheckLine("Note", it) }
        checkin.week?.feel.orEmpty().forEach { f ->
            Text(listOfNotNull(f.title, f.word ?: Feel.word(f.feel)).joinToString(" · "), style = JKType.caption, color = JKColors.textSecondary)
        }
        checkin.photoIds?.takeIf { it.isNotEmpty() }?.let {
            Text(if (it.size == 1) "1 photo" else "${it.size} photos", style = JKType.caption, color = JKColors.textSecondary)
        }
    }
}

/** "Label: text", the label quieter. */
@Composable
internal fun CoachCheckLine(label: String, text: String) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = JKColors.textSecondary)) { append("$label: ") }
            withStyle(SpanStyle(color = JKColors.text)) { append(text) }
        },
        style = JKType.caption,
    )
}

// MARK: - Goal editor

private val goalMetrics = listOf(
    "weight" to "Weight", "waist" to "Waist", "measurement" to "Measurement", "record" to "Lift", "habit" to "Habit", "custom" to "Other",
)

/** Edit the goal in place, or set it from a draft. JK writes the chapter name. */
@Composable
fun GoalEditorSheet(clientId: String, goal: Goal?, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf(goal?.title ?: "") }
    var metric by remember { mutableStateOf(goal?.metric ?: "weight") }
    var unit by remember { mutableStateOf(goal?.unit ?: "kg") }
    var baseline by remember { mutableStateOf(goal?.baseline?.let { Fmt.number(it, digits = 2).replace(",", "") } ?: "") }
    var target by remember { mutableStateOf(goal?.target?.let { Fmt.number(it, digits = 2).replace(",", "") } ?: "") }
    var hasDate by remember { mutableStateOf(goal == null || goal.targetDate != null) }
    var targetDate by remember { mutableStateOf(goal?.targetDate?.let(Day::date) ?: LocalDate.now(Day.zone).plusDays(84)) }
    var chapter by remember { mutableStateOf(goal?.chapterName ?: "") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickingDate by remember { mutableStateOf(false) }
    val setting = goal == null || goal.isDraft

    suspend fun save() {
        saving = true
        val input = GoalInput(
            clientId = if (goal == null) clientId else null,
            title = title.trim(),
            metric = metric,
            unit = unit.ifBlank { null },
            baseline = parseNumber(baseline.replace(",", "")),
            target = parseNumber(target.replace(",", "")),
            startDate = goal?.startDate ?: Day.today,
            targetDate = if (hasDate) Day.string(targetDate) else null,
            chapterName = chapter.trim().ifEmpty { null },
            status = if (setting) "active" else null,
        )
        try {
            if (goal != null) APIClient.send<Goal, GoalInput>("PATCH", "/api/goals/${seg(goal.id)}", input)
            else APIClient.send<Goal, GoalInput>("POST", "/api/goals", input)
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar("Goal", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.m),
        ) {
            val suggestion = goal?.suggestion
            if (suggestion != null && goal.isDraft) {
                Text("Suggested from onboarding: $suggestion.", style = JKType.caption, color = JKColors.textSecondary)
            }
            JKField("The goal, in their words", title, { title = it }, prompt = "Down to 75 kg by March")
            Text("Measured by", style = JKType.caption, color = JKColors.textSecondary)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                goalMetrics.forEach { (id, label) -> Chip(label = label, selected = metric == id) { metric = id } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                JKField("Start", baseline, { baseline = it }, Modifier.weight(1f), prompt = "84.6", keyboard = KeyboardType.Decimal)
                JKField("Target", target, { target = it }, Modifier.weight(1f), prompt = "75", keyboard = KeyboardType.Decimal)
                JKField("Unit", unit, { unit = it }, Modifier.weight(1f), prompt = "kg")
            }
            Row(Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget), verticalAlignment = Alignment.CenterVertically) {
                Text("Target date", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                JKSwitch(checked = hasDate, onCheckedChange = { hasDate = it })
            }
            if (hasDate) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).clickable { pickingDate = true },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("By", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                    Text(Fmt.longDay(targetDate), style = JKType.callout, color = JKColors.textSecondary)
                }
            }
            JKField("Chapter name (optional, shown on Progress)", chapter, { chapter = it }, prompt = "Base building")
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { save() } }, enabled = !saving && title.isNotBlank()) {
                if (saving) ProgressView() else Text(if (setting) "Set the goal" else "Save goal")
            }
            Text("Metrics tied to a lift or a habit are linked on the web desk.", style = JKType.caption, color = JKColors.textSecondary)
        }
    }
    if (pickingDate) {
        CoachDatePicker(initial = targetDate, onPick = { targetDate = it }, onDismiss = { pickingDate = false })
    }
}

// MARK: - Rest day

/** Give a rest day: neither done nor missed. */
@Composable
fun RestDaySheet(clientId: String, firstName: String, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var date by remember { mutableStateOf(LocalDate.now(Day.zone)) }
    var reason by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickingDate by remember { mutableStateOf(false) }

    suspend fun save() {
        saving = true
        try {
            APIClient.send<RestDay, RestDayInput>(
                "POST", "/api/clients/${seg(clientId)}/rest-days", RestDayInput(date = Day.string(date), reason = reason.trim().ifEmpty { null }),
            )
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar("Rest day", leading = { BarButton("Cancel") { dismiss() } })
        Column(Modifier.fillMaxWidth().padding(JKSpace.gutter), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).clickable { pickingDate = true },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Day", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                Text(Fmt.longDay(date), style = JKType.callout, color = JKColors.textSecondary)
            }
            JKField("Reason (optional)", reason, { reason = it }, prompt = "Travelling for work")
            Text("The day counts as neither done nor missed for $firstName.", style = JKType.caption, color = JKColors.textSecondary)
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { save() } }, enabled = !saving) {
                if (saving) ProgressView() else Text("Give the day off")
            }
        }
    }
    if (pickingDate) {
        CoachDatePicker(
            initial = date,
            earliest = LocalDate.now(Day.zone).minusDays(7),
            onPick = { date = it },
            onDismiss = { pickingDate = false },
        )
    }
}

/** A Material date picker in a dialog, from `earliest` onwards (today by default). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CoachDatePicker(
    initial: LocalDate,
    onPick: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
    earliest: LocalDate = LocalDate.now(Day.zone),
) {
    val floor = earliest.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    val state = rememberDatePickerState(
        initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis >= floor
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButtonStrong("Done", onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            })
        },
        dismissButton = { TextButton("Cancel", onClick = onDismiss) },
    ) { DatePicker(state = state) }
}

/** The client's first-run answers: goals, experience, their week, and anything they flagged. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ClientAboutCard(profile: Profile?) {
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Label(text = "About", trailing = profile?.answeredAt?.let { "Answered ${Fmt.dayMonth(it)}" })
        when {
            profile == null -> Text("Hasn't answered the first-run questions yet.", style = JKType.caption, color = JKColors.textTertiary)
            profile.isEmpty -> Text("Skipped the first-run questions.", style = JKType.caption, color = JKColors.textTertiary)
            else -> {
                val goals = profile.goals.orEmpty().mapNotNull { Answers.goal(it) }
                if (goals.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        goals.forEach { g ->
                            Row(
                                Modifier.background(JKColors.raised, CircleShape).padding(horizontal = 10.dp, vertical = 5.dp),
                                horizontalArrangement = Arrangement.spacedBy(5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Glyph(g.icon, size = JKSize.iconSmall, tint = JKColors.text)
                                Text(g.title, style = JKType.caption, color = JKColors.text)
                            }
                        }
                    }
                }
                Answers.experience(profile.experience)?.let { AboutLine("Experience", it.title) }
                val week = listOfNotNull(
                    profile.daysPerWeek?.let { if (it == 1) "1 day a week" else "$it days a week" },
                    Answers.time(profile.preferredTime)?.let { if (it.id == "varies") "time varies" else it.title.lowercase() },
                ).joinToString(", ").replaceFirstChar { it.uppercase() }
                if (week.isNotEmpty()) AboutLine("Training", week)
                profile.injuries?.takeIf { it.isNotBlank() }?.let { AboutLine("To know", it) }
            }
        }
    }
}

@Composable
private fun AboutLine(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.width(72.dp))
        Text(value, style = JKType.caption, color = JKColors.text, modifier = Modifier.weight(1f))
    }
}

// MARK: - Shared bits



/**
 * `.overlay(RoundedRectangle(cornerRadius:).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])))`:
 * the dashed outline of an "add" affordance, drawn inside the bounds.
 */
private fun Modifier.dashedBorder(radius: Dp, color: Color = JKColors.hairline): Modifier = drawBehind {
    val w = 1.dp.toPx()
    drawRoundRect(
        color = color,
        topLeft = Offset(w / 2, w / 2),
        size = Size(size.width - w, size.height - w),
        cornerRadius = CornerRadius(radius.toPx()),
        style = Stroke(width = w, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))),
    )
}

/** The dashed full-width "+ …" row (add an exercise, book a session). */
@Composable
private fun DashedAddRow(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier.fillMaxWidth().dashedBorder(12.dp).padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { IconLabel(text, icon = IconKey.add, style = JKType.caption, color = JKColors.textSecondary) }
}

/**
 * `.confirmationDialog(title, titleVisibility: .visible)` with one destructive
 * action: on Android a dark alert with the action in red and Cancel.
 */
@Composable
private fun ConfirmDestructive(title: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = JKType.headline, color = JKColors.text) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, style = JKType.body, color = JKColors.error) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body.semibold(), color = JKColors.text) }
        },
        containerColor = JKColors.raised,
        shape = JKShape.card,
    )
}

/** A plain trash-can button in the tertiary colour (`Button(role: .destructive) { … } label: { Image("trash") }`). */
@Composable
private fun TrashButton(onClick: () -> Unit) {
    Box(Modifier.clickable(onClick = onClick).padding(6.dp)) { Glyph(IconKey.delete, JKType.body, JKColors.textTertiary) }
}

// MARK: - Plan tab

/** The workout being edited: a copy of the server's, or a new one for `date`. */
private data class WorkoutDraft(
    val id: String? = null,
    val date: String,
    val title: String = "",
    val startsAt: String = "",
    val location: String = "",
    val notes: String = "",
    val items: List<WorkoutItemInput> = emptyList(),
    val published: Boolean = false,
    val editedBy: String? = null,
    val editedAt: Instant? = null,
    val completedAt: Instant? = null,
    val loggedSets: Int = 0,
) {
    constructor(w: Workout) : this(
        id = w.id,
        date = w.date,
        title = w.title,
        startsAt = w.startsAt ?: "",
        location = w.location ?: "",
        notes = w.notes ?: "",
        items = w.items.sortedBy { it.order }.map { WorkoutItemInput(it) },
        published = w.published,
        editedBy = w.editedBy,
        editedAt = w.editedAt,
        completedAt = w.completedAt,
        loggedSets = w.items.sumOf { it.logged.size },
    )

    fun input(clientId: String) = WorkoutInput(
        date = date, title = title.trim(),
        startsAt = startsAt.ifEmpty { null }, location = location.ifEmpty { null },
        notes = notes, items = items, clientId = if (id == null) clientId else null,
    )
}

@Composable
private fun CoachPlanTab(clientId: String, clientName: String) {
    val scope = rememberCoroutineScope()
    var day by rememberSaveable { mutableStateOf(LocalDate.now(Day.zone)) }
    var week by remember { mutableStateOf<List<WorkoutSummary>?>(null) }
    var draft by remember { mutableStateOf<WorkoutDraft?>(null) }
    var saved by remember { mutableStateOf<WorkoutDraft?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    fun dayWorkouts() = week.orEmpty().filter { it.date == Day.string(day) }
    val firstName = clientName.split(" ").firstOrNull { it.isNotEmpty() } ?: clientName

    suspend fun weekQuery(): WorkoutsResponse {
        val days = Day.week(day)
        return APIClient.get("/api/workouts", mapOf("clientId" to clientId, "from" to Day.string(days[0]), "to" to Day.string(days[6])))
    }

    suspend fun open(id: String) {
        try {
            val w = APIClient.get<Workout>("/api/workouts/${seg(id)}")
            draft = WorkoutDraft(w)
            saved = draft
            notice = null
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun loadWeek() {
        try {
            week = weekQuery().workouts
            error = null
            val first = dayWorkouts().firstOrNull()
            if ((draft == null || draft?.date != Day.string(day)) && first != null) open(first.id)
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun refreshWeekQuietly() {
        runCatching { weekQuery() }.getOrNull()?.let { week = it.workouts }
    }

    // Save = PUT (or POST for a new one); Publish = save, then POST publish.
    suspend fun save(publish: Boolean) {
        val current = draft ?: return
        busy = true
        try {
            var w: Workout = if (current != saved || current.id == null) {
                if (current.id != null) APIClient.send("PUT", "/api/workouts/${seg(current.id)}", current.input(clientId))
                else APIClient.send("POST", "/api/workouts", current.input(clientId))
            } else {
                APIClient.get("/api/workouts/${seg(current.id)}")
            }
            if (publish && !w.published) w = APIClient.send("POST", "/api/workouts/${seg(w.id)}/publish")
            draft = WorkoutDraft(w)
            saved = draft
            notice = when {
                publish -> "Published. $clientName can see it now."
                w.published -> "Saved. The client sees the change."
                else -> "Saved as a draft."
            }
            error = null
            refreshWeekQuietly()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            busy = false
        }
    }

    suspend fun deleteWorkout() {
        val id = draft?.id ?: return
        try {
            APIClient.send<OK>("DELETE", "/api/workouts/${seg(id)}")
            draft = null
            saved = null
            refreshWeekQuietly()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.clickable { day = Day.add(-7, day) }.padding(6.dp)) { Glyph(IconKey.back, JKType.body, JKColors.textSecondary) }
        Spacer(Modifier.weight(1f))
        Text("Week of ${Fmt.dayMonth(Day.weekStart(day))}", style = JKType.caption, color = JKColors.textSecondary)
        Spacer(Modifier.weight(1f))
        Box(Modifier.clickable { day = Day.add(7, day) }.padding(6.dp)) { Glyph(IconKey.chevron, JKType.body, JKColors.textSecondary) }
    }
    DayStrip(days = Day.week(day), selected = day, onSelect = { day = it }, marked = week.orEmpty().map { it.date }.toSet())

    val currentError = error
    when {
        currentError != null && week == null -> ErrorCard(currentError, retry = { loadWeek() })
        week == null -> LoadingCard()
        else -> {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                dayWorkouts().forEach { w ->
                    Chip(label = if (w.published) w.title else "${w.title} · draft", selected = draft?.id == w.id) {
                        scope.launch { open(w.id) }
                    }
                }
                // Writing a workout from scratch is a desk job; on the phone it waits behind studio tools.
                if (AppSession.studioTools) {
                    Chip(label = "+ New workout", selected = draft != null && draft?.id == null) {
                        draft = WorkoutDraft(date = Day.string(day))
                        saved = null
                    }
                }
            }
            val current = draft
            if (current != null) {
                PlanEditor(
                    current = current,
                    day = day,
                    clientName = clientName,
                    firstName = firstName,
                    saved = saved,
                    busy = busy,
                    notice = notice,
                    error = error,
                    onChange = { draft = it },
                    onPick = { picking = true },
                    onSave = { publish -> scope.launch { save(publish) } },
                    onDelete = { confirmDelete = true },
                )
            } else if (dayWorkouts().isEmpty()) {
                EmptyCard(
                    title = "Nothing planned for ${Fmt.shortDay(day)}",
                    detail = if (AppSession.studioTools) "Tap “+ New workout” to write one for $clientName." else "Workouts are written on the web desk.",
                )
            }
        }
    }

    LaunchedEffect(Day.string(Day.weekStart(day))) { loadWeek() }
    // `.onChange(of: day)`: a new day opens its first workout, or clears the editor.
    // Runs only on a change, not when the tab first appears.
    var lastDay by remember { mutableStateOf(day) }
    LaunchedEffect(day) {
        if (day == lastDay) return@LaunchedEffect
        lastDay = day
        val id = dayWorkouts().firstOrNull()?.id
        if (id != null) open(id) else { draft = null; saved = null }
    }

    if (picking) {
        Sheet(onDismiss = { picking = false }) {
            ExercisePickerSheet { exercise ->
                draft = draft?.let { it.copy(items = it.items + WorkoutItemInput(exerciseId = exercise.id, exerciseName = exercise.name)) }
            }
        }
    }
    if (confirmDelete) {
        ConfirmDestructive(
            title = "Delete this workout?",
            action = "Delete workout",
            onConfirm = { scope.launch { deleteWorkout() } },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun PlanEditor(
    current: WorkoutDraft,
    day: LocalDate,
    clientName: String,
    firstName: String,
    saved: WorkoutDraft?,
    busy: Boolean,
    notice: String?,
    error: String?,
    onChange: (WorkoutDraft) -> Unit,
    onPick: () -> Unit,
    onSave: (publish: Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    val valid = current.title.isNotBlank() && current.items.isNotEmpty()
    val unchanged = current == saved

    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            "${Fmt.weekday(Day.date(current.date) ?: day)} · ${current.title.ifEmpty { "New workout" }}",
            style = JKType.callout.semibold(), color = JKColors.text,
        )
        Text(statusLine(current, clientName), style = JKType.caption, color = JKColors.textTertiary)
    }
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        JKField("Title", current.title, { onChange(current.copy(title = it)) }, prompt = "Lower Body Strength")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JKField("Starts (HH:mm)", current.startsAt, { onChange(current.copy(startsAt = it)) }, Modifier.weight(1f), prompt = "11:00", keyboard = KeyboardType.Ascii)
            JKField("Location", current.location, { onChange(current.copy(location = it)) }, Modifier.weight(1f), prompt = "Studio 2")
        }
        JKField("Notes for the client", current.notes, { onChange(current.copy(notes = it)) }, prompt = "Optional")
    }
    ItemsEditor(items = current.items, onItemsChange = { onChange(current.copy(items = it)) })
    DashedAddRow("Add exercise from the library", Modifier.clickable(onClick = onPick))
    if (notice != null) IconLabel(notice, icon = IconKey.custom, style = JKType.caption, color = JKColors.textSecondary)
    if (error != null) ErrorBanner(error)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SecondaryButton("Save", onClick = { onSave(false) }, modifier = Modifier.weight(1f), enabled = !busy && valid && !unchanged)
        PrimaryButton(
            onClick = { onSave(true) },
            modifier = Modifier.weight(1f),
            enabled = !busy && valid && !(current.published && unchanged),
        ) {
            if (busy) ProgressView()
            else Text(if (current.published && unchanged) "Published" else "Publish to $firstName")
        }
    }
    if (current.id != null) {
        Text(
            "Delete workout",
            style = JKType.caption,
            color = JKColors.error,
            modifier = Modifier.fillMaxWidth().clickable(onClick = onDelete).padding(vertical = 6.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

private fun statusLine(d: WorkoutDraft, clientName: String): String {
    val parts = mutableListOf<String>()
    parts += if (d.id == null) "Not saved yet" else if (d.published) "Published" else "Draft · the client can't see it"
    d.editedAt?.let { parts += "last edit by ${if (d.editedBy == "coach") "you" else clientName} ${Fmt.relative(it)}" }
    if (d.loggedSets > 0) parts += "${d.loggedSets} sets logged"
    if (d.completedAt != null) parts += "completed"
    return parts.joinToString(" · ")
}

// MARK: - Habits tab

@Composable
private fun CoachHabitsTab(clientId: String, dayMinimum: Int? = null) {
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<HabitsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }
    var kcal by remember { mutableStateOf("") }
    var protein by remember { mutableStateOf("") }
    var carbs by remember { mutableStateOf("") }
    var fat by remember { mutableStateOf("") }
    var savingTargets by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var minimum by remember { mutableStateOf(dayMinimum ?: 3) }
    var savingMinimum by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            val d = APIClient.get<HabitsResponse>("/api/habits", mapOf("clientId" to clientId, "date" to Day.today))
            data = d
            minimum = d.dayMinimum ?: dayMinimum ?: minimum
            error = null
            d.nutrition.targets?.let { t ->
                // Plain digits in the fields: no thousands separator to trip the number parse.
                fun plain(v: Double) = Fmt.number(v, digits = 0).replace(",", "")
                kcal = plain(t.kcal)
                protein = plain(t.protein)
                carbs = plain(t.carbs)
                fat = plain(t.fat)
            }
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun remove(h: Habit) {
        try {
            APIClient.send<OK>("DELETE", "/api/habits/${seg(h.id)}")
            load()
        } catch (e: Throwable) {
            actionError = e.readable
        }
    }

    suspend fun saveTargets() {
        val k = parseNumber(kcal) ?: return
        val p = parseNumber(protein) ?: return
        val c = parseNumber(carbs) ?: return
        val f = parseNumber(fat) ?: return
        savingTargets = true
        try {
            APIClient.send<Nutrition, TargetsInput>("PUT", "/api/nutrition/targets", TargetsInput(clientId, k, p, c, f))
            notice = "Targets saved."
        } catch (e: Throwable) {
            actionError = e.readable
        } finally {
            savingTargets = false
        }
    }

    suspend fun saveMinimum(count: Int) {
        savingMinimum = true
        try {
            val fresh = APIClient.send<ClientSettings, ClientSettingsPatch>(
                "PATCH", "/api/coach/clients/${seg(clientId)}/settings", ClientSettingsPatch(dayMinimum = minimum.coerceIn(1, maxOf(1, count))),
            )
            minimum = fresh.dayMinimum ?: minimum
            notice = "Day minimum saved."
        } catch (e: Throwable) {
            actionError = e.readable
        } finally {
            savingMinimum = false
        }
    }

    Loadable(value = data, error = error, retry = { load() }) { d ->
        CoachSectionTitle("Daily habits", trailing = "${d.habits.size} of 5")
        if (d.habits.isEmpty()) {
            EmptyCard(title = "No habits set")
        } else {
            Column(Modifier.jkSurface(padding = 2.dp)) {
                d.habits.forEach { h ->
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RowGlyph(h.key, slot = 32.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(h.name, style = JKType.callout, color = JKColors.text)
                            Text(
                                if (h.isCount) "${Fmt.number(h.value ?: 0.0)} / ${Fmt.number(h.target)} ${h.unit} today"
                                else if (h.done) "Done today" else "Not done today",
                                style = JKType.caption, color = JKColors.textSecondary,
                            )
                        }
                        TrashButton { scope.launch { remove(h) } }
                    }
                }
            }
        }
        SecondaryButton(onClick = { adding = true }, enabled = d.habits.size < 5) { IconLabel("Add habit", icon = IconKey.add, style = JKType.callout) }
        if (d.habits.size >= 5) {
            Text("Five habits is the most a client carries. Remove one to add another.", style = JKType.caption, color = JKColors.textSecondary)
        }
        if (d.habits.isNotEmpty()) {
            val count = d.habits.size
            Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                CoachStepper(
                    label = "A day is done at ${minOf(minimum, count)} of $count",
                    value = minOf(minimum, count),
                    range = 1..maxOf(1, count),
                    onValueChange = { minimum = it },
                )
                Text("The day minimum. The default is three in five.", style = JKType.caption, color = JKColors.textSecondary)
                SecondaryButton("Save minimum", onClick = { scope.launch { saveMinimum(count) } }, enabled = !savingMinimum)
            }
        }

        Label(text = "Nutrition targets", trailing = "Today ${Fmt.number(d.nutrition.totals.kcal, digits = 0)} kcal logged")
        Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                JKField("kcal", kcal, { kcal = it }, Modifier.weight(1f), prompt = "2500", keyboard = KeyboardType.Number)
                JKField("Protein g", protein, { protein = it }, Modifier.weight(1f), prompt = "170", keyboard = KeyboardType.Number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                JKField("Carbs g", carbs, { carbs = it }, Modifier.weight(1f), prompt = "260", keyboard = KeyboardType.Number)
                JKField("Fat g", fat, { fat = it }, Modifier.weight(1f), prompt = "80", keyboard = KeyboardType.Number)
            }
            notice?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
            PrimaryButton(
                onClick = { scope.launch { saveTargets() } },
                enabled = !savingTargets && listOf(kcal, protein, carbs, fat).none { parseNumber(it) == null },
            ) {
                if (savingTargets) ProgressView() else Text("Save targets")
            }
        }
    }

    LaunchedEffect(clientId) { load() }
    if (adding) {
        Sheet(onDismiss = { adding = false }) { AddHabitSheet(clientId) { load() } }
    }
    ErrorAlert(actionError) { actionError = null }
}

/** The closed catalogue the server accepts. */
private val habitIcons = listOf(
    IconKey.water, IconKey.sleep, IconKey.steps, IconKey.protein, IconKey.supplement, IconKey.energy,
    IconKey.mobility, IconKey.mindfulness, IconKey.reading, IconKey.sunlight, IconKey.custom,
)

@Composable
private fun AddHabitSheet(clientId: String, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("check") }
    var target by remember { mutableStateOf("1") }
    var unit by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf(IconKey.custom) }
    var step by remember { mutableStateOf("") }
    var healthKind by remember { mutableStateOf("none") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // `.onChange(of: healthKind)`: picking a health source presets a sensible habit.
    fun selectHealthKind(hk: String) {
        if (hk == healthKind) return
        healthKind = hk
        when (hk) {
            "sleep" -> {
                kind = "check"; target = "7"; unit = "h"; icon = IconKey.sleep
                if (name.isEmpty()) name = "Sleep 7h+"
            }
            "steps" -> {
                kind = "count"; target = "10000"; unit = "steps"; icon = IconKey.steps; step = "1000"
                if (name.isEmpty()) name = "Steps"
            }
        }
    }

    suspend fun save() {
        saving = true
        // A health habit keeps its target whatever the kind ("Sleep 7h+" is check, 7 h).
        val fromHealth = healthKind != "none"
        val counted = kind == "count" || fromHealth
        val input = HabitEdit(
            clientId = clientId, name = name.trim(), kind = kind,
            target = if (counted) parseNumber(target) ?: 1.0 else 1.0,
            unit = if (counted) unit else "", iconKey = icon.name, icon = icon.name,
            step = if (kind == "count") parseNumber(step) else null,
            healthKind = if (fromHealth) healthKind else null,
        )
        try {
            APIClient.send<Habit, HabitEdit>("POST", "/api/habits", input)
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar("New habit", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            JKField("Name", name, { name = it }, prompt = "Water")
            Segmented(listOf("check", "count"), kind, { kind = it }) { if (it == "check") "Tick off" else "Count to a target" }
            if (kind == "count" || healthKind != "none") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    JKField("Target", target, { target = it }, Modifier.weight(1f), prompt = "3", keyboard = KeyboardType.Decimal)
                    JKField("Unit", unit, { unit = it }, Modifier.weight(1f), prompt = "L")
                    if (kind == "count") JKField("Step", step, { step = it }, Modifier.weight(1f), prompt = "0.5", keyboard = KeyboardType.Decimal)
                }
            }
            Label(text = "Icon")
            // LazyVGrid of five flexible columns.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                habitIcons.chunked(5).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { i ->
                            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                Box(
                                    Modifier
                                        .size(JKSize.touchTarget)
                                        .clip(JKShape.control)
                                        .clickable { icon = i }
                                        .border(JKSize.hairline, if (icon == i) JKColors.inputBorder else Color.Transparent, JKShape.control)
                                        .semantics { contentDescription = i.name; selected = icon == i },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Glyph(i, size = JKSize.iconHabit, tint = if (icon == i) JKColors.text else JKColors.textSecondary, filled = icon == i)
                                }
                            }
                        }
                    }
                }
            }
            Label(text = "Fill from health data")
            Segmented(listOf("none", "steps", "sleep"), healthKind, { selectHealthKind(it) }) {
                when (it) { "none" -> "None"; "steps" -> "Steps"; else -> "Sleep" }
            }
            if (healthKind != "none") {
                Text(
                    "Filled from the client's health data and done once the value reaches the target.",
                    style = JKType.caption, color = JKColors.textTertiary,
                )
            }
            error?.let { ErrorBanner(it) }
            PrimaryButton(
                onClick = { scope.launch { save() } },
                enabled = !saving && name.isNotBlank() && !(kind == "count" && parseNumber(target) == null),
            ) {
                if (saving) ProgressView() else Text("Add habit")
            }
        }
    }
}

// MARK: - Sessions tab

@Composable
private fun CoachSessionsTab(client: PersonRef) {
    var bookings by remember { mutableStateOf<List<Booking>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val now = Instant.now()
            val reply = APIClient.get<BookingsResponse>(
                "/api/bookings",
                mapOf(
                    "clientId" to client.id,
                    "from" to Day.string(Day.add(-30, now)),
                    "to" to Day.string(Day.add(60, now)),
                ),
            )
            bookings = reply.bookings.filter { b ->
                b.client?.id == client.id || b.attendees.orEmpty().any { it.id == client.id } || b.client == null
            }
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Loadable(value = bookings, error = error, retry = { load() }) { list ->
        val now = Instant.now()
        val upcoming = list.filter { it.end >= now }.sortedBy { it.start }
        val past = list.filter { it.end < now }.sortedByDescending { it.start }
        Label(text = "Upcoming")
        if (upcoming.isEmpty()) Text("Nothing booked.", style = JKType.caption, color = JKColors.textTertiary)
        upcoming.forEach { b -> key(b.id) { SessionBookingRow(b) } }
        DashedAddRow("Book a session for ${client.name}", Modifier.navLink { BookSessionView(client = client) })
        if (past.isNotEmpty()) {
            Label(text = "Past 30 days")
            past.forEach { b -> key(b.id) { SessionBookingRow(b) } }
        }
    }
    LaunchedEffect(client.id) { load() }
}

@Composable
private fun SessionBookingRow(b: Booking) {
    UpcomingRow(
        weekday = Fmt.weekday(b.start),
        day = "${b.start.atZone(Day.zone).dayOfMonth}",
        title = b.title ?: b.kindLabel,
        detail = listOfNotNull("${Fmt.time(b.start)}–${Fmt.time(b.end)}", b.kindLabel, b.location).joinToString(" · "),
        modifier = Modifier.navLink { ClassDetailView(booking = b) }.jkSurface(padding = 0.dp),
    )
}

// MARK: - Check-ins (read-only: the reply arrives as the letter)

@Composable
private fun CoachNotesTab(clientId: String) {
    var checkins by remember { mutableStateOf<List<CheckIn>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            checkins = APIClient.get<CheckInsResponse>("/api/checkins", mapOf("clientId" to clientId)).checkins.sortedByDescending { it.week }
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Loadable(value = checkins, error = error, retry = { load() }) { list ->
        if (list.isEmpty()) Text("No check-ins yet.", style = JKType.caption, color = JKColors.textSecondary)
        list.forEach { c ->
            key(c.id) {
                Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Week of ${Fmt.dayMonth(c.week)}", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                        if (c.reviewedAt != null) Text("Answered", style = JKType.caption, color = JKColors.textSecondary)
                    }
                    val figures = buildList {
                        add("Energy ${c.energy}")
                        c.stress?.let { add("Stress $it") }
                        add("Sleep ${c.sleep}")
                        add(if (c.pain.isEmpty()) "No pain" else "Pain: ${c.pain.joinToString(", ")}")
                    }.joinToString(" · ")
                    Text(figures, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                    listOfNotNull(c.win?.let { "Win: $it" }, c.struggle?.let { "Struggle: $it" }, c.note)
                        .filter { it.isNotEmpty() }
                        .forEach { Text(it, style = JKType.caption, color = JKColors.text) }
                    c.reply?.takeIf { it.isNotEmpty() }?.let { Text("Your reply: $it", style = JKType.caption, color = JKColors.textSecondary) }
                }
            }
        }
    }
    LaunchedEffect(clientId) { load() }
}
