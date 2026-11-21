package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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

/** Swift `ClientDetailView.Tab`. */
enum class ClientDetailTab(val label: String) { plan("Plan"), feedback("Feedback"), health("Health"), habits("Habits"), sessions("Sessions") }

/**
 * One client, for the coach: header from the summary, then Plan (edit and
 * publish workouts), Feedback (weekly write-ups and check-in replies),
 * Health (their phone's health data, if shared), Habits (habits and nutrition targets)
 * and Sessions (their bookings).
 */
@Composable
fun ClientDetailView(clientId: String, name: String, initialTab: ClientDetailTab = ClientDetailTab.plan) {
    // Saveable, so coming back from the message thread lands on the same tab.
    var tab by rememberSaveable { mutableStateOf(initialTab) }
    var detail by remember { mutableStateOf<ClientDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val fullName = detail?.client?.name ?: name
    val firstName = fullName.split(" ").firstOrNull { it.isNotEmpty() } ?: fullName

    LaunchedEffect(clientId) {
        try {
            detail = APIClient.get<ClientDetail>("/api/coach/clients/${seg(clientId)}")
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar("Clients") {
            Box(
                Modifier
                    .navLink { MessagesThreadView(clientId = clientId, otherName = fullName, subtitle = "Client") }
                    .padding(10.dp),
            ) { SystemImage("bubble.left", JKType.body, JK.text) }
        }
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ClientHeader(detail, name, error)
            Segmented(ClientDetailTab.entries, tab, { tab = it }) { it.label }
            when (tab) {
                ClientDetailTab.plan -> CoachPlanTab(clientId, fullName)
                ClientDetailTab.feedback -> {
                    CoachReportsSection(clientId = clientId, clientName = firstName)
                    Eyebrow(text = "Check-ins")
                    CoachNotesTab(clientId)
                    ClientAutomationSection(client = PersonRef(id = clientId, name = fullName))
                }
                ClientDetailTab.health -> CoachHealthTab(clientId = clientId, clientName = firstName)
                ClientDetailTab.habits -> CoachHabitsTab(clientId)
                ClientDetailTab.sessions -> CoachSessionsTab(PersonRef(id = clientId, name = fullName))
            }
        }
    }
}

@Composable
private fun ClientHeader(detail: ClientDetail?, name: String, error: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(initials = detail?.client?.displayInitials ?: Fmt.initials(name), size = 48.dp)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(detail?.client?.name ?: name, style = JKType.title2.semibold(), color = JK.text)
                Text(subtitle(detail), style = JKType.caption, color = JK.tertiary)
            }
        }
        if (error != null) ErrorBanner(error)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            chips(detail).forEach { t ->
                Text(
                    t,
                    style = JKType.system(10, FontWeight.Medium),
                    color = JK.secondary,
                    maxLines = 1,
                    modifier = Modifier.border(1.dp, JK.stroke, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
    }
}

/** "Monthly · since Mar 2025"; a blank line until the detail arrives, so the header doesn't jump. */
private fun subtitle(detail: ClientDetail?): String {
    val c = detail?.client ?: return " "
    val parts = mutableListOf(Fmt.planName(c.plan))
    c.since?.let(Day::date)?.let { parts += "since ${Fmt.monthYear(it)}" }
    return parts.joinToString(" · ")
}

/** The at-a-glance chips: urgent reasons first, then adherence, flags, health and the next workout. */
private fun chips(detail: ClientDetail?): List<String> {
    val d = detail ?: return emptyList()
    val out = mutableListOf<String>()
    d.client.demand?.urgent.orEmpty().forEach { out += "⚠︎ $it" }
    d.client.adherence?.let { out += "Adherence $it%" }
    d.client.flags.orEmpty().forEach { f -> out += flagText(f).replaceFirstChar { it.uppercase() } }
    if (d.client.checkinDue == true) out += "Check-in due"
    if (d.healthShared == false) out += "Health not shared"
    d.health?.let { h ->
        h.steps?.let { out += "${Fmt.number(it, digits = 0)} steps" }
        h.sleepMinutes?.let { out += "Slept ${Fmt.minutes(it)}" }
        h.restingHr?.let { out += "RHR ${Fmt.number(it, digits = 0)}" }
    }
    d.nextWorkout?.let { out += "Next: ${it.title} ${Fmt.dayMonth(it.date)}" }
    return out
}

/** Swift `ClientText.flag`: the server's flag slugs in words ("no-workout-7d" → "no workout in 7 days"). */
private fun flagText(f: String): String {
    if (f == "no-workout-yet") return "no workout yet"
    if (f == "checkin-overdue") return "check-in overdue"
    if (f.startsWith("no-workout-")) {
        f.removePrefix("no-workout-").dropLast(1).toIntOrNull()?.let { return "no workout in $it days" }
    }
    return f.replace("-", " ")
}

// MARK: - Shared bits

/** iOS's system red, for `role: .destructive` buttons. */
private val destructiveRed = Color(1f, 0.27f, 0.23f)

/** SwiftUI's alert/dialog surface in dark mode. */
private val alertSurface = Color(0.17f, 0.17f, 0.17f)

/**
 * `.overlay(RoundedRectangle(cornerRadius:).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4])))`:
 * the dashed outline of an "add" affordance, drawn inside the bounds.
 */
private fun Modifier.dashedBorder(radius: Dp, color: Color = JK.stroke): Modifier = drawBehind {
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
    ) { Label(text, systemImage = "plus", style = JKType.caption, color = JK.secondary) }
}

/**
 * `.confirmationDialog(title, titleVisibility: .visible)` with one destructive
 * action: on Android a dark alert with the action in red and Cancel.
 */
@Composable
private fun ConfirmDestructive(title: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = JKType.headline, color = JK.text) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, style = JKType.body, color = destructiveRed) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body.semibold(), color = JK.text) }
        },
        containerColor = alertSurface,
        shape = rounded(14.dp),
    )
}

/** A plain trash-can button in the tertiary colour (`Button(role: .destructive) { … } label: { Image("trash") }`). */
@Composable
private fun TrashButton(onClick: () -> Unit) {
    Box(Modifier.clickable(onClick = onClick).padding(6.dp)) { SystemImage("trash", JKType.body, JK.tertiary) }
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
        Box(Modifier.clickable { day = Day.add(-7, day) }.padding(6.dp)) { SystemImage("chevron.left", JKType.body, JK.secondary) }
        Spacer(Modifier.weight(1f))
        Text("Week of ${Fmt.dayMonth(Day.weekStart(day))}", style = JKType.caption, color = JK.secondary)
        Spacer(Modifier.weight(1f))
        Box(Modifier.clickable { day = Day.add(7, day) }.padding(6.dp)) { SystemImage("chevron.right", JKType.body, JK.secondary) }
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
                Chip(label = "+ New workout", selected = draft != null && draft?.id == null) {
                    draft = WorkoutDraft(date = Day.string(day))
                    saved = null
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
                    systemName = "calendar.badge.plus",
                    title = "Nothing planned for ${Fmt.shortDay(day)}",
                    detail = "Tap “+ New workout” to write one for $clientName.",
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
            style = JKType.subheadline.semibold(), color = JK.text,
        )
        Text(statusLine(current, clientName), style = JKType.caption2, color = JK.tertiary)
    }
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        JKField("Title", current.title, { onChange(current.copy(title = it)) }, prompt = "Lower Body Strength")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JKField("Starts (HH:mm)", current.startsAt, { onChange(current.copy(startsAt = it)) }, Modifier.weight(1f), prompt = "11:00", keyboard = KeyboardType.Ascii)
            JKField("Location", current.location, { onChange(current.copy(location = it)) }, Modifier.weight(1f), prompt = "Studio 2")
        }
        JKField("Notes for the client", current.notes, { onChange(current.copy(notes = it)) }, prompt = "Optional")
    }
    ItemsEditor(items = current.items, onItemsChange = { onChange(current.copy(items = it)) })
    DashedAddRow("Add exercise from the library", Modifier.clickable(onClick = onPick))
    if (notice != null) Label(notice, systemImage = "checkmark.circle", style = JKType.caption, color = JK.secondary)
    if (error != null) ErrorBanner(error)
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        GhostButton("Save", onClick = { onSave(false) }, modifier = Modifier.weight(1f), enabled = !busy && valid && !unchanged)
        ChromeButton(
            onClick = { onSave(true) },
            modifier = Modifier.weight(1f),
            enabled = !busy && valid && !(current.published && unchanged),
        ) {
            if (busy) ProgressView(tint = Color.Black)
            else Text(if (current.published && unchanged) "Published" else "Publish to $firstName")
        }
    }
    if (current.id != null) {
        Text(
            "Delete workout",
            style = JKType.caption,
            color = destructiveRed,
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
private fun CoachHabitsTab(clientId: String) {
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

    suspend fun load() {
        try {
            val d = APIClient.get<HabitsResponse>("/api/habits", mapOf("clientId" to clientId, "date" to Day.today))
            data = d
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

    Loadable(value = data, error = error, retry = { load() }) { d ->
        Eyebrow(text = "Daily habits", trailing = "${d.streak}-day streak")
        if (d.habits.isEmpty()) {
            EmptyCard(systemName = "checklist", title = "No habits set")
        } else {
            Column(Modifier.jkCard(padding = 2.dp)) {
                d.habits.forEach { h ->
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconTile(systemName = symbol(h.icon), size = 32.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(h.name, style = JKType.subheadline.semibold(), color = JK.text)
                            Text(
                                if (h.isCount) "${Fmt.number(h.value ?: 0.0)} / ${Fmt.number(h.target)} ${h.unit} today"
                                else if (h.done) "Done today" else "Not done today",
                                style = JKType.caption2, color = JK.tertiary,
                            )
                        }
                        TrashButton { scope.launch { remove(h) } }
                    }
                }
            }
        }
        GhostButton(onClick = { adding = true }) { Label("Add habit", systemImage = "plus", style = JKType.subheadline.semibold()) }

        Eyebrow(text = "Nutrition targets", trailing = "Today ${Fmt.number(d.nutrition.totals.kcal, digits = 0)} kcal logged")
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                JKField("kcal", kcal, { kcal = it }, Modifier.weight(1f), prompt = "2500", keyboard = KeyboardType.Number)
                JKField("Protein g", protein, { protein = it }, Modifier.weight(1f), prompt = "170", keyboard = KeyboardType.Number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                JKField("Carbs g", carbs, { carbs = it }, Modifier.weight(1f), prompt = "260", keyboard = KeyboardType.Number)
                JKField("Fat g", fat, { fat = it }, Modifier.weight(1f), prompt = "80", keyboard = KeyboardType.Number)
            }
            notice?.let { Text(it, style = JKType.caption2, color = JK.secondary) }
            ChromeButton(
                onClick = { scope.launch { saveTargets() } },
                enabled = !savingTargets && listOf(kcal, protein, carbs, fat).none { parseNumber(it) == null },
            ) {
                if (savingTargets) ProgressView(tint = Color.Black) else Text("Save targets")
            }
        }
    }

    LaunchedEffect(clientId) { load() }
    if (adding) {
        Sheet(onDismiss = { adding = false }) { AddHabitSheet(clientId) { load() } }
    }
    ErrorAlert(actionError) { actionError = null }
}

private val habitIcons = listOf("checkmark.circle", "drop", "moon", "shoeprints.fill", "bolt", "leaf", "figure.walk", "pills", "book", "fork.knife")

@Composable
private fun AddHabitSheet(clientId: String, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("check") }
    var target by remember { mutableStateOf("1") }
    var unit by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("checkmark.circle") }
    var healthKind by remember { mutableStateOf("none") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // `.onChange(of: healthKind)`: picking a health source presets a sensible habit.
    fun selectHealthKind(hk: String) {
        if (hk == healthKind) return
        healthKind = hk
        when (hk) {
            "sleep" -> {
                kind = "check"; target = "7"; unit = "h"; icon = "moon"
                if (name.isEmpty()) name = "Sleep 7h+"
            }
            "steps" -> {
                kind = "count"; target = "10000"; unit = "steps"; icon = "shoeprints.fill"
                if (name.isEmpty()) name = "Steps"
            }
        }
    }

    suspend fun save() {
        saving = true
        // A health habit keeps its target whatever the kind ("Sleep 7h+" is check, 7 h).
        val fromHealth = healthKind != "none"
        val counted = kind == "count" || fromHealth
        val input = HabitInput(
            clientId = clientId, name = name.trim(), kind = kind,
            target = if (counted) parseNumber(target) ?: 1.0 else 1.0,
            unit = if (counted) unit else "", icon = icon,
            healthKind = if (fromHealth) healthKind else null,
        )
        try {
            APIClient.send<Habit, HabitInput>("POST", "/api/habits", input)
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
                }
            }
            Eyebrow(text = "Icon")
            // LazyVGrid of five flexible columns.
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                habitIcons.chunked(5).forEach { row ->
                    Row(Modifier.fillMaxWidth()) {
                        row.forEach { i ->
                            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                IconTile(
                                    systemName = i,
                                    size = 40.dp,
                                    modifier = Modifier
                                        .clickable { icon = i }
                                        .border(1.5.dp, if (icon == i) JK.text else Color.Transparent, rounded(10.dp)),
                                )
                            }
                        }
                    }
                }
            }
            Eyebrow(text = "Fill from health data")
            Segmented(listOf("none", "steps", "sleep"), healthKind, { selectHealthKind(it) }) {
                when (it) { "none" -> "None"; "steps" -> "Steps"; else -> "Sleep" }
            }
            if (healthKind != "none") {
                Text(
                    "Filled from the client's health data and done once the value reaches the target.",
                    style = JKType.caption2, color = JK.tertiary,
                )
            }
            error?.let { ErrorBanner(it) }
            ChromeButton(
                onClick = { scope.launch { save() } },
                enabled = !saving && name.isNotBlank() && !(kind == "count" && parseNumber(target) == null),
            ) {
                if (saving) ProgressView(tint = Color.Black) else Text("Add habit")
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
        Eyebrow(text = "Upcoming")
        if (upcoming.isEmpty()) Text("Nothing booked.", style = JKType.caption, color = JK.tertiary)
        upcoming.forEach { b -> key(b.id) { SessionBookingRow(b) } }
        DashedAddRow("Book a session for ${client.name}", Modifier.navLink { BookSessionView(client = client) })
        if (past.isNotEmpty()) {
            Eyebrow(text = "Past 30 days")
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
        modifier = Modifier.navLink { ClassDetailView(booking = b) }.jkCard(padding = 0.dp),
    )
}

// MARK: - Notes tab

@Composable
private fun CoachNotesTab(clientId: String) {
    val scope = rememberCoroutineScope()
    var checkins by remember { mutableStateOf<List<CheckIn>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val replies = remember { mutableStateMapOf<String, String>() }
    var sending by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            checkins = APIClient.get<CheckInsResponse>("/api/checkins", mapOf("clientId" to clientId)).checkins.sortedByDescending { it.week }
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun reply(c: CheckIn) {
        val text = replies[c.id].orEmpty().trim()
        if (text.isEmpty()) return
        sending = c.id
        try {
            val fresh = APIClient.send<CheckIn, ReplyInput>("POST", "/api/checkins/${seg(c.id)}/review", ReplyInput(text))
            checkins = checkins?.map { if (it.id == fresh.id) fresh else it }
            replies.remove(c.id)
        } catch (e: Throwable) {
            actionError = e.readable
        } finally {
            sending = null
        }
    }

    Loadable(value = checkins, error = error, retry = { load() }) { list ->
        if (list.isEmpty()) EmptyCard(systemName = "doc.text", title = "No check-ins yet")
        list.forEach { c ->
            key(c.id) {
                Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Week of ${Fmt.dayMonth(c.week)}", style = JKType.subheadline.semibold(), color = JK.text)
                        Spacer(Modifier.weight(1f))
                        if (c.reviewedAt != null) Label("Reviewed", systemImage = "checkmark", style = JKType.caption2, color = JK.tertiary)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatTile(label = "Energy", value = "${c.energy}/5", modifier = Modifier.weight(1f))
                        StatTile(label = "Sleep", value = "${c.sleep}/5", modifier = Modifier.weight(1f))
                        StatTile(label = "Pain", value = if (c.pain.isEmpty()) "None" else c.pain.joinToString(", "), modifier = Modifier.weight(1f))
                    }
                    c.note?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.footnote, color = JK.secondary) }
                    c.reply?.takeIf { it.isNotEmpty() }?.let { Label(it, systemImage = "arrowshape.turn.up.left", style = JKType.caption, color = JK.text) }
                    val draftReply = replies[c.id].orEmpty()
                    val canSend = sending == null && draftReply.isNotBlank()
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        ReplyField(
                            text = draftReply,
                            onTextChange = { replies[c.id] = it },
                            prompt = if (c.reply == null) "Reply to this check-in" else "Update your reply",
                            modifier = Modifier.weight(1f),
                        )
                        Box(
                            Modifier.size(32.dp).clickable(enabled = canSend) { scope.launch { reply(c) } },
                            contentAlignment = Alignment.Center,
                        ) {
                            if (sending == c.id) ProgressView(tint = JK.secondary, size = 16.dp)
                            else SystemImage("paperplane.fill", JKType.body, if (canSend) JK.text else JK.tertiary)
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(clientId) { load() }
    ErrorAlert(actionError) { actionError = null }
}

/** `TextField(prompt, text:, axis: .vertical).lineLimit(1...4)` on a raised ground: grows to four lines. */
@Composable
private fun ReplyField(text: String, onTextChange: (String) -> Unit, prompt: String, modifier: Modifier = Modifier) {
    val style = JKType.footnote.copy(color = JK.text)
    BasicTextField(
        value = text,
        onValueChange = onTextChange,
        textStyle = style,
        minLines = 1,
        maxLines = 4,
        cursorBrush = SolidColor(JK.text),
        modifier = modifier,
        decorationBox = { field ->
            Box(Modifier.fillMaxWidth().background(JK.cardRaised, rounded(8.dp)).padding(10.dp)) {
                if (text.isEmpty()) Text(prompt, style = style, color = JK.tertiary)
                field()
            }
        },
    )
}
