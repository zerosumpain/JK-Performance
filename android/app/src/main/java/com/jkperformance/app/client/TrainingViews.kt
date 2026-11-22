package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Exercise
import com.jkperformance.app.net.ExercisesResponse
import com.jkperformance.app.net.LoggedSet
import com.jkperformance.app.net.NoteInput
import com.jkperformance.app.net.Outbox
import com.jkperformance.app.net.SetInput
import com.jkperformance.app.net.Workout
import com.jkperformance.app.net.WorkoutItem
import com.jkperformance.app.net.WorkoutSummary
import com.jkperformance.app.net.WorkoutsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// MARK: - Workout plan (Plan tab root)

/**
 * The Plan tab's state. It lives in a ViewModel, not `remember`, because the
 * NavHost disposes a covered screen: the logger pushed on top hands each
 * logged set back here, and an offline set must still be on screen when the
 * person comes back (SwiftUI keeps the covered view's @State alive). Keyed
 * by person so a different account on this phone starts clean.
 */
private class WorkoutPlanState : ViewModel() {
    var selected by mutableStateOf(LocalDate.now(Day.zone))
    var week by mutableStateOf<List<WorkoutSummary>?>(null)
    var weekKey by mutableStateOf("")
    var workout by mutableStateOf<Workout?>(null)
    var chosenId by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var loadingDetail by mutableStateOf(false)

    val days: List<LocalDate> get() = Day.week(selected)

    val dayWorkouts: List<WorkoutSummary>
        get() = (week ?: emptyList()).filter { it.date == Day.string(selected) }.sortedBy { it.startsAt ?: "" }

    suspend fun loadWeek(force: Boolean) {
        val key = Day.string(days[0])
        if (!force && key == weekKey && week != null) return
        try {
            val reply: WorkoutsResponse = APIClient.get("/api/workouts", mapOf("from" to key, "to" to Day.string(days[6])))
            week = reply.workouts
            weekKey = key
            error = null
            if (force) loadDetail()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun loadDetail() {
        if (week == null) return
        val options = dayWorkouts
        val target = options.firstOrNull { it.id == chosenId }
            ?: options.firstOrNull { it.completedAt == null }
            ?: options.firstOrNull()
        if (target == null) {
            workout = null
            return
        }
        if (workout?.id != target.id) workout = null
        loadingDetail = true
        try {
            workout = APIClient.get<Workout>("/api/workouts/${seg(target.id)}")
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            loadingDetail = false
        }
    }
}

/**
 * The week's day strip, the selected day's workout and its exercises with
 * the coach's prescription. Only published workouts reach a client.
 */
@Composable
fun WorkoutPlanView() {
    val s = viewModel(key = "WorkoutPlanView.${AppSession.me?.id}") { WorkoutPlanState() }
    val days = s.days

    LaunchedEffect(Day.string(days[0])) { s.loadWeek(force = false) }
    LaunchedEffect("${Day.string(s.selected)}|${s.chosenId ?: ""}|${s.week?.size ?: -1}") { s.loadDetail() }

    JKRefreshable(onRefresh = { s.loadWeek(force = true) }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ScreenHeader(eyebrow = "Week of ${Fmt.dayMonth(days[0])}", title = "Workout plan") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HeaderIcon("chevron.left", Modifier.clickable { s.selected = Day.add(-7, s.selected) })
                    HeaderIcon("chevron.right", Modifier.clickable { s.selected = Day.add(7, s.selected) })
                    HeaderIcon("plus", Modifier.navLink { ExercisesView() })
                }
            }
            DayStrip(
                days = days,
                selected = s.selected,
                onSelect = { s.selected = it },
                marked = (s.week ?: emptyList()).map { it.date }.toSet(),
            )

            val error = s.error
            val dayWorkouts = s.dayWorkouts
            when {
                error != null && s.week == null -> ErrorCard(error, retry = { s.loadWeek(force = true) })
                s.week == null -> LoadingCard()
                dayWorkouts.isEmpty() -> EmptyCard(title = "Nothing planned", detail = "No workout from your coach on ${Fmt.longDay(s.selected)}.")
                else -> {
                    if (error != null) ErrorBanner(error)
                    if (dayWorkouts.size > 1) {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            dayWorkouts.forEach { w ->
                                Chip(label = w.title, selected = w.id == s.workout?.id) { s.chosenId = w.id }
                            }
                        }
                    }
                    val workout = s.workout
                    if (workout != null) {
                        WorkoutBody(workout) { s.workout = it }
                    } else if (s.loadingDetail) {
                        LoadingCard()
                    }
                }
            }
        }
    }
}

/** A header action: an unboxed glyph in a 48dp target. */
@Composable
private fun HeaderIcon(name: String, modifier: Modifier = Modifier) {
    Box(
        modifier.size(JKSize.touchTarget),
        contentAlignment = Alignment.Center,
    ) {
        Glyph(IconKey.fromSymbol(name), JKType.body, JKColors.text)
    }
}

/** [WorkoutDetailLoader]'s state, kept across the logger being pushed on top (see [WorkoutPlanState]). */
private class WorkoutLoaderState : ViewModel() {
    var workout by mutableStateOf<Workout?>(null)
    var error by mutableStateOf<String?>(null)

    suspend fun load(workoutId: String) {
        if (Outbox.hasPending(workoutId)) Outbox.flush()
        // Still queued (offline): keep showing what was logged here rather than the server's older copy.
        if (workout != null && Outbox.hasPending(workoutId)) return
        try {
            workout = APIClient.get<Workout>("/api/workouts/${seg(workoutId)}")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }
}

/** Loads one workout by id (from Home's "Open workout"). */
@Composable
fun WorkoutDetailLoader(workoutId: String) {
    val s = viewModel(key = "WorkoutDetailLoader.${AppSession.me?.id}.$workoutId") { WorkoutLoaderState() }
    LaunchedEffect(workoutId) { s.load(workoutId) }

    Column(Modifier.jkScreen()) {
        TopBar(title = s.workout?.title ?: "Workout")
        JKRefreshable(onRefresh = { s.load(workoutId) }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Loadable(value = s.workout, error = s.error, retry = { s.load(workoutId) }) { workout ->
                    WorkoutBody(workout) { s.workout = it }
                }
            }
        }
    }
}

/**
 * A workout's summary card, its exercises and "Complete workout". Emits its
 * pieces straight into the caller's column, as the SwiftUI body does into the
 * parent VStack. `onChange` is the binding's setter: every change made here or
 * in the logger goes back through it.
 */
@Composable
fun WorkoutBody(workout: Workout, onChange: (Workout) -> Unit) {
    var completing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(workout.title, style = JKType.headline, color = JKColors.text, modifier = Modifier.weight(1f))
            val editedAt = workout.editedAt
            if (workout.editedBy == "coach" && editedAt != null) {
                IconLabel("Coach · ${Fmt.relative(editedAt)}", icon = IconKey.clients, style = JKType.caption, color = JKColors.textTertiary)
            } else {
                IconLabel("Shared with Coach", icon = IconKey.clients, style = JKType.caption, color = JKColors.textTertiary)
            }
        }
        Text(
            (listOfNotNull(workout.startsAt, workout.location).filter { it.isNotEmpty() } + "${workout.items.size} exercises")
                .joinToString(" · "),
            style = JKType.caption,
            color = JKColors.textTertiary,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ThinBar(
                fraction = if (workout.items.isEmpty()) 0.0 else workout.doneCount.toDouble() / workout.items.size,
                modifier = Modifier.weight(1f),
            )
            Text("${workout.doneCount} of ${workout.items.size} done", style = JKType.caption, color = JKColors.textTertiary)
        }
        val notes = workout.notes
        if (!notes.isNullOrEmpty()) {
            IconLabel(notes, icon = IconKey.messages, style = JKType.caption, color = JKColors.textSecondary)
        }
    }

    workout.items.sortedBy { it.order }.forEach { item ->
        PlanExerciseCard(item, Modifier.navLink { WorkoutLoggerView(workout, item.id, onChange) })
    }

    OfflineBanner()
    error?.let { ErrorBanner(it) }
    val done = workout.completedAt
    if (done != null) {
        Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
            IconLabel("Completed ${Fmt.relative(done)}", icon = IconKey.verified, style = JKType.callout.semibold(), color = JKColors.textSecondary)
        }
    } else if (workout.items.isNotEmpty()) {
        PrimaryButton(
            onClick = {
                scope.launch {
                    completing = true
                    val path = "/api/workouts/${seg(workout.id)}/complete"
                    try {
                        onChange(APIClient.send<Workout, NoteInput>("POST", path, NoteInput(note = null)))
                        error = null
                    } catch (e: Exception) {
                        when {
                            e.isCancellation -> throw e
                            Outbox.isOffline(e) -> {
                                // Queued after the sets logged offline, so the server sees them first.
                                Outbox.enqueue("POST", path, NoteInput(note = null))
                                onChange(workout.copy(completedAt = Instant.now()))
                                error = null
                            }
                            else -> error = e.readable
                        }
                    } finally {
                        completing = false
                    }
                }
            },
            enabled = !completing,
        ) {
            if (completing) {
                ProgressView()
            } else {
                IconLabel("Complete workout", icon = IconKey.done, style = LocalTextStyle.current, color = LocalContentColor.current)
            }
        }
    }
}

@Composable
private fun PlanExerciseCard(item: WorkoutItem, modifier: Modifier) {
    Column(modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CheckCircle(on = item.isDone)
            Text(item.exercise.name, style = JKType.callout.semibold(), color = JKColors.text, modifier = Modifier.weight(1f))
            if (item.logged.isNotEmpty() && !item.isDone) {
                Text("${item.logged.size}/${item.sets}", style = JKType.caption, color = JKColors.textTertiary)
            }
            Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrescriptionCell("Sets", "${item.sets}", Modifier.weight(1f))
            PrescriptionCell("Reps", item.reps, Modifier.weight(1f))
            PrescriptionCell("Load", item.load.ifEmpty { "–" }, Modifier.weight(1f))
        }
        val note = item.note
        if (!note.isNullOrEmpty()) {
            IconLabel(note, icon = IconKey.messages, style = JKType.caption, color = JKColors.textTertiary)
        }
    }
}

@Composable
private fun PrescriptionCell(label: String, value: String, modifier: Modifier) {
    Column(
        modifier.background(JKColors.raised, JKShape.chip).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = JKType.caption, color = JKColors.textTertiary)
        Text(value, style = JKType.callout.semibold(), color = JKColors.text)
    }
}

// MARK: - Exercise library

private val exerciseCategories = listOf("All", "Legs", "Push", "Pull", "Core", "Mobility", "Conditioning")

/** GET /api/exercises with the search text and category, debounced (a newer search cancels the wait). */
private object ExerciseSearch {
    suspend fun fetch(query: String, category: String): List<Exercise> {
        delay(250)
        val q = query.trim()
        val reply: ExercisesResponse = APIClient.get(
            "/api/exercises",
            mapOf("q" to q.ifEmpty { null }, "category" to category.takeIf { it != "All" }),
        )
        return reply.exercises
    }
}

/** The library's search box and category chips, shared by the browser and the picker. */
@Composable
private fun ExerciseFilters(query: String, onQuery: (String) -> Unit, category: String, onCategory: (String) -> Unit) {
    Row(
        Modifier.jkSurface(padding = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Glyph(IconKey.search, JKType.body, JKColors.textTertiary)
        BasicTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            textStyle = JKType.body.copy(color = JKColors.text),
            cursorBrush = SolidColor(JKColors.text),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            modifier = Modifier.weight(1f),
            decorationBox = { field ->
                Box {
                    if (query.isEmpty()) Text("Search exercises", style = JKType.body, color = JKColors.textTertiary)
                    field()
                }
            },
        )
    }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        exerciseCategories.forEach { c -> Chip(label = c, selected = category == c) { onCategory(c) } }
    }
}

@Composable
fun ExercisesView() {
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("All") }
    var exercises by remember { mutableStateOf<List<Exercise>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val uriHandler = LocalUriHandler.current

    suspend fun load() {
        try {
            exercises = ExerciseSearch.fetch(query, category)
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }
    LaunchedEffect(query, category) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ScreenHeader(eyebrow = "Library", title = "Exercises")
            ExerciseFilters(query, { query = it }, category, { category = it })
            Loadable(value = exercises, error = error, retry = { load() }) { list ->
                if (list.isEmpty()) {
                    EmptyCard(title = "No matches", detail = "Try another word or category.")
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    list.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            pair.forEach { exercise ->
                                val link = exercise.videoUrl
                                ExerciseTile(
                                    exercise,
                                    Modifier.weight(1f).then(
                                        if (link != null) Modifier.clickable { runCatching { uriHandler.openUri(link) } } else Modifier,
                                    ),
                                )
                            }
                            if (pair.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExerciseTile(exercise: Exercise, modifier: Modifier) {
    val shape = JKShape.card
    Column(modifier.clip(shape).background(JKColors.surface).border(1.dp, JKColors.hairline, shape)) {
        Box(Modifier.fillMaxWidth().height(84.dp).background(JKColors.raised), contentAlignment = Alignment.BottomEnd) {
            Glyph(if (exercise.videoUrl == null) IconKey.workout else IconKey.play, JKType.body, JKColors.textSecondary, Modifier.padding(6.dp))
        }
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(exercise.name, style = JKType.caption.semibold(), color = JKColors.text)
            Text("${exercise.equipment} · ${exercise.pattern}", style = JKType.caption, color = JKColors.textTertiary)
        }
    }
}

/**
 * Library search in a sheet; tapping a row hands the exercise back. Show it
 * inside `Sheet(onDismiss) { ExercisePickerSheet { … } }`: Cancel and a pick
 * both close it through [LocalDismiss].
 */
@Composable
fun ExercisePickerSheet(onPick: (Exercise) -> Unit) {
    val dismiss = LocalDismiss.current
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("All") }
    var exercises by remember { mutableStateOf<List<Exercise>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            exercises = ExerciseSearch.fetch(query, category)
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }
    LaunchedEffect(query, category) { load() }

    Column(Modifier.jkScreen()) {
        TopBar(title = "Add exercise", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ExerciseFilters(query, { query = it }, category, { category = it })
            Loadable(value = exercises, error = error, retry = { load() }) { list ->
                if (list.isEmpty()) EmptyCard(title = "No matches")
                Column(Modifier.jkSurface(padding = 4.dp)) {
                    list.forEach { exercise ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onPick(exercise)
                                    dismiss()
                                }
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            RowGlyph(IconKey.workout, slot = 34.dp)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(exercise.name, style = JKType.callout, color = JKColors.text)
                                Text("${exercise.equipment} · ${exercise.pattern}", style = JKType.caption, color = JKColors.textTertiary)
                            }
                            Glyph(IconKey.add, JKType.body, JKColors.textTertiary)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Workout logger

/**
 * Logging one exercise: coach demo, set table (PUT/DELETE per set), rest
 * timer (local only). Sets logged with no signal go to the [Outbox] and show
 * as logged at once.
 */
@Composable
fun WorkoutLoggerView(workout: Workout, itemId: String, onChange: (Workout) -> Unit) {
    var current by remember { mutableStateOf(workout) }
    var itemIdState by remember { mutableStateOf(itemId) }
    val loads = remember { mutableStateMapOf<Int, String>() }
    val reps = remember { mutableStateMapOf<Int, String>() }
    var busy by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var rest by remember { mutableIntStateOf(90) }
    var resting by remember { mutableStateOf(false) }
    /** Optional RPE for the next logged set, 1–10. */
    var rpe by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current

    val ordered = current.items.sortedBy { it.order }
    val index = ordered.indexOfFirst { it.id == itemIdState }.coerceAtLeast(0)
    val item = ordered.firstOrNull { it.id == itemIdState }

    fun logged(n: Int): LoggedSet? = item?.logged?.firstOrNull { it.number == n }
    val nextSet: Int? = item?.takeIf { it.sets > 0 }?.let { (1..it.sets).firstOrNull { n -> logged(n) == null } }

    fun defaultLoad(item: WorkoutItem): String {
        item.logged.maxByOrNull { it.number }?.let { return it.load }
        return item.load.replace(" kg", "").replace("kg", "")
    }

    fun defaultReps(item: WorkoutItem): String {
        item.logged.maxByOrNull { it.number }?.let { return "${it.reps}" }
        return item.reps.takeWhile { it.isDigit() }
    }

    fun setPath(item: WorkoutItem, n: Int) = "/api/workouts/${seg(current.id)}/items/${seg(item.id)}/sets/$n"

    fun apply(fresh: Workout) {
        current = fresh
        error = null
        onChange(fresh)
    }

    suspend fun log(n: Int) {
        val item = item ?: return
        val load = (loads[n] ?: defaultLoad(item)).trim()
        val count = (reps[n] ?: defaultReps(item)).toIntOrNull()
        if (count == null) {
            error = "Enter the reps for set $n."
            return
        }
        busy = n
        val path = setPath(item, n)
        val input = SetInput(load = load, reps = count, rpe = rpe?.toDouble())
        try {
            apply(APIClient.send<Workout, SetInput>("PUT", path, input))
            rest = 90
            resting = true
        } catch (e: Exception) {
            when {
                e.isCancellation -> throw e
                Outbox.isOffline(e) -> {
                    // No signal: keep the set on the phone and show it as logged now.
                    Outbox.enqueue("PUT", path, input)
                    apply(current.withLogged(item.id, LoggedSet(n, load, count, input.rpe, Instant.now()), n))
                    rest = 90
                    resting = true
                }
                else -> error = e.readable
            }
        } finally {
            busy = null
        }
    }

    suspend fun unlog(n: Int) {
        val item = item ?: return
        busy = n
        val path = setPath(item, n)
        try {
            apply(APIClient.send<Workout>("DELETE", path))
        } catch (e: Exception) {
            when {
                e.isCancellation -> throw e
                Outbox.isOffline(e) -> {
                    Outbox.enqueue("DELETE", path)
                    apply(current.withLogged(item.id, null, n))
                }
                else -> error = e.readable
            }
        } finally {
            busy = null
        }
    }

    // The rest countdown: restarts whenever it is paused or resumed.
    LaunchedEffect(resting) {
        while (resting && rest > 0) {
            delay(1000)
            if (resting && rest > 0) rest -= 1
        }
        if (rest == 0) resting = false
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = current.title) {
            Text("${index + 1} of ${ordered.size}", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.padding(horizontal = 8.dp))
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (item != null) {
                LoggerDemo(item) { url -> runCatching { uriHandler.openUri(url) } }
                SetTable(
                    item = item,
                    logged = ::logged,
                    load = { n -> loads[n] ?: logged(n)?.load ?: defaultLoad(item) },
                    onLoad = { n, v -> loads[n] = v },
                    reps = { n -> reps[n] ?: logged(n)?.let { "${it.reps}" } ?: defaultReps(item) },
                    onReps = { n, v -> reps[n] = v },
                    pending = { n -> Outbox.isPending("PUT", setPath(item, n)) },
                    busy = busy,
                    locked = busy != null || current.completedAt != null,
                    onToggle = { n, done -> scope.launch { if (done) unlog(n) else log(n) } },
                )
                RestTimer(
                    rest = rest,
                    resting = resting,
                    onMinus = { rest = maxOf(0, rest - 15) },
                    onPlus = { rest += 15 },
                    onToggle = {
                        if (rest == 0) rest = 90
                        resting = !resting
                    },
                )
                RpeRow(
                    rpe = rpe,
                    onMinus = { rpe = rpe?.let { if (it <= 1) null else it - 1 } },
                    onPlus = { rpe = minOf(10, (rpe ?: 6) + (if (rpe == null) 0 else 1)) },
                )
                OfflineBanner()
                error?.let { ErrorBanner(it) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (index + 1 < ordered.size) {
                        SecondaryButton(
                            onClick = {
                                itemIdState = ordered[index + 1].id
                                loads.clear()
                                reps.clear()
                            },
                            modifier = Modifier.weight(1f),
                        ) {
                            IconLabel("Next exercise", icon = IconKey.skip, style = LocalTextStyle.current, color = LocalContentColor.current)
                        }
                    }
                    PrimaryButton(
                        text = nextSet?.let { "Log set $it" } ?: "All sets logged",
                        onClick = { nextSet?.let { n -> scope.launch { log(n) } } },
                        modifier = Modifier.weight(1f),
                        enabled = nextSet != null && busy == null && current.completedAt == null,
                    )
                }
            } else {
                EmptyCard(title = "Exercise removed", detail = "Your coach changed this workout.")
            }
        }
    }
}

/** The coach demo card: a play button when the exercise has a video, then the prescription and note. */
@Composable
private fun LoggerDemo(item: WorkoutItem, openVideo: (String) -> Unit) {
    val shape = JKShape.card
    Column(Modifier.fillMaxWidth().clip(shape).background(JKColors.surface).border(1.dp, JKColors.hairline, shape)) {
        Box(Modifier.fillMaxWidth().height(150.dp).background(JKColors.raised)) {
            val url = item.exercise.videoUrl
            if (url != null) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(JKColors.surface)
                        .clickable { openVideo(url) },
                    contentAlignment = Alignment.Center,
                ) {
                    Glyph(IconKey.playArrow, JKType.body, JKColors.text)
                }
                Text(
                    "Coach demo",
                    style = JKType.caption,
                    color = JKColors.textSecondary,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(10.dp)
                        .background(JKColors.surface, CircleShape)
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                )
            } else {
                Glyph(IconKey.workout, JKType.display, JKColors.textTertiary, Modifier.align(Alignment.Center))
            }
        }
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.exercise.name, style = JKType.headline, color = JKColors.text)
            Text(
                listOfNotNull("${item.sets} × ${item.reps}", item.load.ifEmpty { null }, item.rpe?.let { "RPE $it" }).joinToString(" · "),
                style = JKType.caption,
                color = JKColors.textTertiary,
            )
            val note = item.note
            if (!note.isNullOrEmpty()) {
                Text(note, style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.padding(top = 4.dp))
            }
        }
    }
}

/** SET / PREVIOUS / KG / REPS, one row per prescribed set; the square logs or un-logs it. */
@Composable
private fun SetTable(
    item: WorkoutItem,
    logged: (Int) -> LoggedSet?,
    load: (Int) -> String,
    onLoad: (Int, String) -> Unit,
    reps: (Int) -> String,
    onReps: (Int, String) -> Unit,
    pending: (Int) -> Boolean,
    busy: Int?,
    locked: Boolean,
    onToggle: (Int, Boolean) -> Unit,
) {
    val header = JKType.caption.semibold()
    Column(Modifier.jkSurface(padding = 0.dp)) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("SET", style = header, color = JKColors.textTertiary, modifier = Modifier.width(34.dp))
            Text("PREVIOUS", style = header, color = JKColors.textTertiary, modifier = Modifier.weight(1f))
            Text("KG", style = header, color = JKColors.textTertiary, textAlign = TextAlign.Center, modifier = Modifier.width(56.dp))
            Text("REPS", style = header, color = JKColors.textTertiary, textAlign = TextAlign.Center, modifier = Modifier.width(44.dp))
            Spacer(Modifier.width(28.dp))
        }
        (1..maxOf(item.sets, 1)).forEach { n ->
            val done = logged(n) != null
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.width(34.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("$n", style = JKType.callout.semibold(), color = JKColors.text)
                    if (done && pending(n)) {
                        Glyph(IconKey.upload, JKType.caption, JKColors.textTertiary, Modifier.semantics { contentDescription = "Waiting to send" })
                    }
                }
                Text(item.previous ?: "–", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.weight(1f))
                SetField(load(n), { onLoad(n, it) }, placeholder = "kg", width = 56.dp, done = done, keyboard = KeyboardType.Text)
                Box(Modifier.width(44.dp), contentAlignment = Alignment.Center) {
                    SetField(reps(n), { onReps(n, it) }, placeholder = "–", width = 36.dp, done = done, keyboard = KeyboardType.Number)
                }
                Box(
                    Modifier.width(28.dp).clickable(enabled = !locked) { onToggle(n, done) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (busy == n) {
                        ProgressView(tint = JKColors.textSecondary, size = 16.dp)
                    } else {
                        Glyph(if (done) IconKey.checkbox else IconKey.checkboxBlank, JKType.headline, if (done) JKColors.text else JKColors.textTertiary)
                    }
                }
            }
        }
    }
}

/** One cell of the set table: a small raised field, flat (and locked) once the set is logged. */
@Composable
private fun SetField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    width: Dp,
    done: Boolean,
    keyboard: KeyboardType,
) {
    val style = JKType.callout.semibold().copy(color = JKColors.text, textAlign = TextAlign.Center)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        enabled = !done,
        singleLine = true,
        textStyle = style,
        cursorBrush = SolidColor(JKColors.text),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
        modifier = Modifier.width(width).heightIn(min = 28.dp),
        decorationBox = { field ->
            Box(
                Modifier.fillMaxSize().background(if (done) Color.Transparent else JKColors.raised, JKShape.chip),
                contentAlignment = Alignment.Center,
            ) {
                if (value.isEmpty()) Text(placeholder, style = style.copy(color = JKColors.textTertiary))
                field()
            }
        },
    )
}

@Composable
private fun RpeRow(rpe: Int?, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(
        Modifier.jkSurface(padding = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("RPE", style = JKType.caption.semibold(), color = JKColors.textTertiary)
        Text(rpe?.toString() ?: "–", style = JKType.callout.semibold(), color = JKColors.text, modifier = Modifier.widthIn(min = 20.dp))
        Text("optional, for the next set", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.weight(1f))
        TextButton("−", onClick = onMinus, enabled = rpe != null)
        TextButton("+", onClick = onPlus)
    }
}

@Composable
private fun RestTimer(rest: Int, resting: Boolean, onMinus: () -> Unit, onPlus: () -> Unit, onToggle: () -> Unit) {
    Row(
        Modifier.jkSurface(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Ring(fraction = minOf(1.0, rest / 90.0), lineWidth = 4.dp, modifier = Modifier.size(38.dp))
        Column(Modifier.weight(1f)) {
            Text("REST", style = JKType.caption.semibold(), color = JKColors.textTertiary)
            Text("%d:%02d".format(rest / 60, rest % 60), style = JKType.numberTile, color = JKColors.text)
        }
        TextButton("−15s", onClick = onMinus)
        TextButton("+15s", onClick = onPlus)
        TextButton(onClick = onToggle) {
            Glyph(if (resting) IconKey.pause else IconKey.play, LocalTextStyle.current, LocalContentColor.current)
        }
    }
}

// MARK: - Offline

/** The workout with one set logged (or, with null, cleared) locally, as the server would. */
private fun Workout.withLogged(itemId: String, set: LoggedSet?, number: Int): Workout =
    copy(
        items = items.map { item ->
            if (item.id != itemId) item
            else item.copy(logged = (item.logged.filterNot { it.number == number } + listOfNotNull(set)).sortedBy { it.number })
        },
    )

/**
 * Quiet note while sets logged offline are waiting to send; and the one
 * error worth showing if the server later refused one (tap to clear it).
 */
@Composable
fun OfflineBanner() {
    if (Outbox.pendingCount > 0) {
        val sets = Outbox.pendingSets
        val text = if (sets == 0) {
            "Offline · your changes will send when you're back online"
        } else {
            "Offline · $sets ${if (sets == 1) "set" else "sets"} will send when you're back online"
        }
        IconLabel(text, icon = IconKey.offline, style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier
                .fillMaxWidth()
                .background(JKColors.surface, JKShape.control)
                .border(1.dp, JKColors.hairline, JKShape.control)
                .padding(10.dp))
    }
    Outbox.lastError?.let { message ->
        ErrorBanner(message, Modifier.clickable { Outbox.lastError = null })
    }
}
