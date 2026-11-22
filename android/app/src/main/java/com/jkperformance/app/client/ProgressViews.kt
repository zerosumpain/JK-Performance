package com.jkperformance.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.util.LruCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Challenge
import com.jkperformance.app.net.ChallengesResponse
import com.jkperformance.app.net.CheckIn
import com.jkperformance.app.net.CheckInInput
import com.jkperformance.app.net.CheckInsResponse
import com.jkperformance.app.net.MeasurementInput
import com.jkperformance.app.net.OK
import com.jkperformance.app.net.Photo
import com.jkperformance.app.net.PhotosResponse
import com.jkperformance.app.net.ProgressData
import com.jkperformance.app.net.StatBlock
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.max
import kotlin.math.roundToInt
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.Consistency
import com.jkperformance.app.net.Goal
import com.jkperformance.app.net.GoalResponse
import com.jkperformance.app.net.HabitHistory
import com.jkperformance.app.net.HabitHistoryEntry
import com.jkperformance.app.net.PersonalRecord
import kotlin.math.abs
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*


// MARK: - Progress

/** The Progress tab (plans with 'progress'). */
@Composable
fun ProgressTab() {
    ProgressScreen()
}

/**
 * Progress in three levels of detail (atelier-spec.md, Client screens 6):
 * the goal and three tiles; a tile's eight-week trend; then habit history,
 * best lifts, measurements and photos (and Challenges when JK turns them on).
 * Named ProgressScreen because Compose already owns `ProgressView` (States.kt).
 */
@Composable
fun ProgressScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val gate = AppSession.gate
    val nav = LocalNav.current
    var goal by remember { mutableStateOf<GoalResponse?>(null) }
    var progress by remember { mutableStateOf<ProgressData?>(null) }
    var history by remember { mutableStateOf<HabitHistory?>(null) }
    var photos by remember { mutableStateOf<List<Photo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var measuring by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var trend by remember { mutableStateOf<TrendKind?>(null) }

    suspend fun load() {
        try {
            progress = APIClient.get("/api/progress", mapOf("range" to "6m"))
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
        runCatching { APIClient.get<GoalResponse>("/api/goal") }.getOrNull()?.let { goal = it }
        if (gate.habits) {
            val from = Day.string(Day.add(-55, LocalDate.now(Day.zone)))
            runCatching { APIClient.get<HabitHistory>("/api/habits/history", mapOf("from" to from, "to" to Day.today)) }
                .getOrNull()?.let { history = it }
        }
    }

    suspend fun loadPhotos() {
        try {
            val reply: PhotosResponse = APIClient.get("/api/photos")
            photos = reply.photos.sortedBy { it.date }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            photos = photos ?: emptyList()
        }
    }

    suspend fun upload(uri: Uri) {
        uploading = true
        try {
            val jpeg = withContext(Dispatchers.IO) { MediaUpload.jpegForUpload(context, uri) }
            if (jpeg == null) {
                actionError = "Couldn't read that photo."
                return
            }
            val photo: Photo = APIClient.upload("/api/photos", jpeg, "image/jpeg", mapOf("date" to Day.today))
            photos = (photos ?: emptyList()) + photo
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        } finally {
            uploading = false
        }
    }

    suspend fun delete(photo: Photo) {
        try {
            APIClient.send<OK>("DELETE", "/api/photos/${seg(photo.id)}")
            photos = photos?.filter { it.id != photo.id }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { upload(uri) }
    }

    LaunchedEffect(Unit) { load() }
    LaunchedEffect(Unit) { loadPhotos() }

    val strength = progress?.let { strengthOf(it) }

    JKRefreshable(onRefresh = { load() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.section),
        ) {
            Text("Progress", style = JKType.display, color = JKColors.text, modifier = Modifier.semantics { heading() })
            Loadable(progress, error, retry = { load() }) { p ->
                // Level 1: the goal and three tiles.
                val g = goal?.goal
                if (g != null) GoalHero(g)
                else if (goal?.pending == true) Text("JK will set your goal with you this week.", style = quoteStyle(), color = JKColors.text)
                ProgressTiles(p, g, history, strength) { trend = it }

                // Level 3.
                val habits = history?.habits.orEmpty()
                if (gate.habits && habits.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                        SectionTitle("Habit history")
                        habits.forEach { HabitHistoryRow(it) }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    SectionTitle("Your best lifts")
                    if (p.records.isEmpty()) {
                        Text("Log sets in your sessions and your bests appear here.", style = JKType.caption, color = JKColors.textSecondary)
                    } else {
                        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = 0.dp)) {
                            p.records.forEachIndexed { i, pr ->
                                LiftRow(pr)
                                if (i < p.records.lastIndex) GroupDivider()
                            }
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SectionTitle("Measurements", Modifier.weight(1f))
                        TextButton("Add measurement", onClick = { measuring = true })
                    }
                    p.weight?.latest?.let { w ->
                        MeasureRow("Weight", "${Fmt.number(w)} kg", p.weight?.delta?.let { "${Fmt.delta(it)} kg" })
                    }
                    p.stats.forEach { s ->
                        s.latest?.let { latest ->
                            MeasureRow(Measure.label(s.kind), Fmt.number(latest) + Measure.unit(s.kind), s.delta?.let { Fmt.delta(it) + Measure.unit(s.kind) })
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SectionTitle("Photos", Modifier.weight(1f))
                        IconLabel("Private to you and JK", icon = IconKey.lock, style = JKType.caption, color = JKColors.textSecondary)
                    }
                    PhotoRow(
                        photos = photos ?: emptyList(),
                        uploading = uploading,
                        onAdd = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        onDelete = { photo -> scope.launch { delete(photo) } },
                    )
                }
                if (gate.challenges) {
                    ProgressRow(IconKey.record, "Challenges", "Walk, run or row with the group", Modifier.clickable { nav.push(ClientRoute.challenges) })
                }
            }
        }
    }

    if (measuring) {
        Sheet(onDismiss = { measuring = false }) {
            MeasurementSheet { input ->
                APIClient.send<ProgressData, MeasurementInput>("POST", "/api/measurements", input)
                load()
            }
        }
    }
    trend?.let { kind ->
        Sheet(onDismiss = { trend = null }) { TrendSheet(kind, goal?.goal, progress, history, strength) }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = JKType.headline, color = JKColors.text, modifier = modifier.semantics { heading() })
}

/** Level 1's three tiles: Goal, Consistency, and Strength (or Body for fat-loss goals). Each opens its trend. */
@Composable
private fun ProgressTiles(p: ProgressData, goal: Goal?, history: HabitHistory?, strength: StrengthSummary?, open: (TrendKind) -> Unit) {
    val tiles = buildList<Pair<TrendKind, @Composable (Modifier) -> Unit>> {
        if (goal != null) add(TrendKind.goal to { m ->
            MetricTile(
                "Goal",
                goal.remainingLabel ?: if (goal.isReached) "Reached" else "–",
                m,
                status = goal.onTrack?.let { if (it) "On track" else "Worth a look" },
                source = goal.sourceLabel,
            )
        })
        history?.consistency?.let { c ->
            add(TrendKind.consistency to { m ->
                MetricTile("Consistency", "${c.done} of ${c.days}", m, status = ConsistencyText.status(c), trend = consistencyTrend(history), source = "Days at JK's minimum")
            })
        }
        val bodyGoal = goal?.metric in listOf("weight", "waist")
        val body = if (bodyGoal) bodyTile(p) else null
        if (body != null) {
            add(TrendKind.body to { m -> MetricTile("Body", body.first, m, trend = body.second, source = body.third) })
        } else if (strength != null) {
            add(TrendKind.strength to { m ->
                MetricTile(
                    "Strength",
                    Fmt.delta(strength.percent, digits = 0) + "%",
                    m,
                    trend = if (strength.percent > 0) Trend.Up else Trend.Flat,
                    source = strength.since?.let { "Best lifts since $it" } ?: "Best logged lifts",
                )
            })
        }
    }
    if (tiles.isEmpty()) return
    val tap = { kind: TrendKind -> Modifier.clip(JKShape.card).clickable(onClickLabel = "Show the eight-week trend") { open(kind) } }
    if (isAccessibilityFontScale() || tiles.size > 2 && LocalDensity.current.fontScale > 1.15f) {
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) { tiles.forEach { (k, tile) -> tile(tap(k)) } }
    } else {
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            tiles.forEach { (k, tile) -> tile(tap(k).weight(1f).fillMaxHeight()) }
        }
    }
}

/** Waist change, else weight change, as the Body tile: value, trend glyph, source. */
private fun bodyTile(p: ProgressData): Triple<String, Trend, String>? {
    fun trendOf(d: Double) = if (d < 0) Trend.Down else if (d > 0) Trend.Up else Trend.Flat
    p.stats.firstOrNull { it.kind == "waist" }?.delta?.let { d ->
        return Triple("Waist ${Fmt.delta(d)} cm", trendOf(d), "From your measurements")
    }
    p.weight?.delta?.let { d -> return Triple("${Fmt.delta(d)} kg", trendOf(d), "From your weigh-ins") }
    return null
}

class StrengthSummary(val percent: Double, val since: String?)

/** "+12% since July": the best lifts against where each started. */
private fun strengthOf(p: ProgressData): StrengthSummary? {
    val withGain = p.records.filter { (it.gain ?: 0.0) > 0 && it.kg > (it.gain ?: 0.0) }
    if (withGain.isEmpty()) return null
    val start = withGain.sumOf { it.kg - (it.gain ?: 0.0) }
    val gain = withGain.sumOf { it.gain ?: 0.0 }
    val since = p.since?.let { Day.date(it.take(10)) }?.let { Fmt.month(it) }
    return StrengthSummary(if (start > 0) gain / start * 100 else 0.0, since)
}

private fun consistencyTrend(history: HabitHistory?): Trend? {
    val rates = history?.habits.orEmpty().mapNotNull { h -> h.rate7?.let { now -> h.rate7Prev?.let { now to it } } }
    if (rates.isEmpty()) return null
    val change = rates.sumOf { it.first - it.second } / rates.size
    return if (change > 0.05) Trend.Up else if (change < -0.05) Trend.Down else Trend.Flat
}

enum class TrendKind { goal, consistency, strength, body }

object ConsistencyText {
    /** A word, never a colour: On track, Steady or Worth a look. */
    fun status(c: Consistency): String {
        if (c.days <= 0) return "Steady"
        val rate = c.done.toDouble() / c.days
        return if (rate >= 0.75) "On track" else if (rate >= 0.5) "Steady" else "Worth a look"
    }
}

/** Measurement names and units. */
object Measure {
    fun label(kind: String): String = when (kind) {
        "bodyFat" -> "Body fat"
        "waist" -> "Waist"
        "restingHr" -> "Resting HR"
        "weight" -> "Weight"
        else -> kind
    }

    fun unit(kind: String): String = when (kind) {
        "bodyFat" -> "%"
        "waist" -> " cm"
        "weight" -> " kg"
        "restingHr" -> " bpm"
        else -> ""
    }
}

// MARK: - Parts

/**
 * The goal at the top of Progress: the serif sentence, a 120dp open ring,
 * the change in light tabular figures, start, now and target, the week line
 * and where the number comes from.
 */
@Composable
fun GoalHero(goal: Goal) {
    val unit = goal.unit?.let { " $it" } ?: ""
    val figures = listOfNotNull(
        goal.baseline?.let { "Start ${Fmt.number(it)}$unit" },
        goal.current?.let { "Now ${Fmt.number(it)}$unit" },
        goal.target?.let { "Target ${Fmt.number(it)}$unit" },
    ).joinToString(" · ")
    val percent = (goal.fraction * 100).roundToInt()
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
        Text(goal.title, style = JKType.title, color = JKColors.text)
        AdaptiveStack(spacing = JKSpace.xl) { _ ->
            Ring(
                fraction = goal.fraction,
                lineWidth = 8.dp,
                modifier = Modifier.size(120.dp).clearAndSetSemantics {
                    contentDescription = "Progress to your goal, $percent percent"
                },
                color = if (goal.onTrack == false) JKColors.text else JKColors.accent,
                sweep = 300f,
            ) {
                Text("$percent%", style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
            }
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                goal.delta?.let { d ->
                    FittingText(Fmt.delta(d) + unit, style = JKType.numberHero, color = JKColors.text, minimumScaleFactor = 0.6f)
                }
                if (figures.isNotEmpty()) Text(figures, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                goal.weekOf?.let { w ->
                    Text("Week ${w.week} of ${w.weeks}" + (goal.chapterName?.let { " · $it" } ?: ""), style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                }
            }
        }
        goal.sourceLabel?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
    }
}

/**
 * One habit over time: glyph, name, its last seven days, the consistency
 * figure and the change on last week (a glyph, never red).
 */
@Composable
fun HabitHistoryRow(habit: HabitHistoryEntry) {
    val change = habit.rate7?.let { now -> habit.rate7Prev?.let { before -> (now - before).let { if (abs(it) < 0.01) 0.0 else it } } }
    val counted = habit.days.takeLast(28).filter { it.rest != true }
    val figure = "${counted.count { it.done == true }} of the last ${counted.size} days"
    Column(Modifier.jkSurface(SurfaceVariant.Card, padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            Glyph(habit.key, tint = JKColors.textSecondary)
            Text(habit.name, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
            change?.let {
                Glyph(
                    if (it > 0) IconKey.trendUp else if (it < 0) IconKey.trendDown else IconKey.trendFlat,
                    size = JKSize.iconSmall,
                    tint = JKColors.textSecondary,
                    contentDescription = if (it > 0) "Up on last week" else if (it < 0) "Down on last week" else "Same as last week",
                )
            }
        }
        AdaptiveStack(spacing = JKSpace.m) { _ ->
            HistoryDots(habit.days.takeLast(7).map {
                weekDayOf(it.date, done = it.done == true, rest = it.rest == true, future = false, isToday = it.date == Day.today)
            })
            Text(figure, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
        }
    }
}

/** Seven dots without day letters (the row's own figure says what they are). */
@Composable
private fun HistoryDots(days: List<WeekDay>) {
    Row(
        Modifier.semantics(mergeDescendants = true) { contentDescription = days.joinToString(". ") { it.spoken } },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        days.forEach { day ->
            val dot = Modifier.size(JKSize.dot + JKSize.outline * 2)
            when (day.state) {
                DotState.Done -> Box(dot.background(JKColors.accent, CircleShape))
                DotState.NotDone, DotState.Future -> Box(dot.border(JKSize.outline, JKColors.trackStrong, CircleShape))
                DotState.Today -> Box(dot.border(JKSize.outline, JKColors.text, CircleShape))
                DotState.Rest -> Box(dot)
            }
        }
    }
}

@Composable
private fun LiftRow(record: PersonalRecord) {
    val fresh = record.isNewThisWeek == true
    Row(
        Modifier.fillMaxWidth().padding(JKSpace.l).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.record, filled = fresh, tint = if (fresh) JKColors.accent else JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(record.exercise, style = JKType.callout, color = JKColors.text)
            if (fresh) Text("New best this week", style = JKType.caption, color = JKColors.accent)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text("${Fmt.number(record.kg)} kg", style = JKType.callout.monospacedDigit(), color = JKColors.text)
            record.gain?.let { Text("${Fmt.delta(it)} kg", style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary) }
        }
    }
}

@Composable
private fun MeasureRow(label: String, value: String, delta: String? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JKType.callout, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
        Text(value, style = JKType.callout.monospacedDigit(), color = JKColors.text)
        delta?.let { Text(it, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary) }
    }
}

@Composable
fun ProgressRow(icon: IconKey, title: String, detail: String, modifier: Modifier = Modifier) {
    Row(
        modifier.jkSurface(SurfaceVariant.Card, padding = JKSpace.l).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(icon, tint = JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(title, style = JKType.headline, color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
        Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
    }
}

/** The last three photos, each with a long-press Delete, then the add tile. */
@Composable
private fun PhotoRow(photos: List<Photo>, uploading: Boolean, onAdd: () -> Unit, onDelete: (Photo) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        photos.takeLast(3).forEach { photo ->
            var menu by remember(photo.id) { mutableStateOf(false) }
            Box(
                Modifier
                    .weight(1f)
                    .height(96.dp)
                    .pointerInput(photo.id) { detectTapGestures(onLongPress = { menu = true }) },
            ) {
                AuthedPhoto(photo, Modifier.fillMaxSize())
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Delete photo", style = JKType.body, color = JKColors.text) },
                        leadingIcon = { Glyph(IconKey.delete, tint = JKColors.textSecondary) },
                        onClick = {
                            menu = false
                            onDelete(photo)
                        },
                    )
                }
            }
        }
        Box(
            Modifier
                .weight(1f)
                .height(96.dp)
                .clip(JKShape.control)
                .border(JKSize.hairline, JKColors.inputBorder, JKShape.control)
                .clickable(enabled = !uploading, onClickLabel = "Add a progress photo", onClick = onAdd)
                .semantics { contentDescription = "Add a progress photo" },
            contentAlignment = Alignment.Center,
        ) {
            if (uploading) ProgressView(tint = JKColors.textSecondary) else Glyph(IconKey.mealPhoto, tint = JKColors.textSecondary)
        }
    }
}

// MARK: - Level 2: trends

/**
 * One tile's eight weeks: a slate line, a dashed bone target, no fill, and
 * what it is made from.
 */
@Composable
fun TrendSheet(kind: TrendKind, goal: Goal?, progress: ProgressData?, history: HabitHistory?, strength: StrengthSummary?) {
    val dismiss = LocalDismiss.current
    val title = when (kind) {
        TrendKind.goal -> "Goal"
        TrendKind.consistency -> "Consistency"
        TrendKind.strength -> "Strength"
        TrendKind.body -> "Body"
    }
    val eightWeeksAgo = LocalDate.now(Day.zone).minusDays(56)
    val points: List<Pair<LocalDate, Double>> = when (kind) {
        TrendKind.goal, TrendKind.body -> progress?.weight?.series.orEmpty()
            .mapNotNull { p -> Day.date(p.date)?.let { it to p.value } }
            .filter { !it.first.isBefore(eightWeeksAgo) }
        TrendKind.consistency -> {
            // Days done per week (rest days left out), as a share.
            val weeks = sortedMapOf<LocalDate, IntArray>()
            history?.days.orEmpty().filter { it.rest != true }.forEach { d ->
                val date = Day.date(d.date) ?: return@forEach
                val w = weeks.getOrPut(Day.weekStart(date)) { IntArray(2) }
                w[1]++
                if (d.dayDone == true) w[0]++
            }
            weeks.map { (k, w) -> k to if (w[1] > 0) w[0].toDouble() / w[1] * 100 else 0.0 }
        }
        TrendKind.strength -> emptyList()
    }
    val target = when (kind) {
        TrendKind.goal, TrendKind.body -> if (goal?.metric == "weight") goal.target else null
        TrendKind.consistency -> 75.0
        TrendKind.strength -> null
    }
    val madeFrom = when (kind) {
        TrendKind.goal -> goal?.sourceLabel ?: "From your weigh-ins"
        TrendKind.body -> "From your weigh-ins and measurements"
        TrendKind.consistency -> "Share of days each week you met JK's minimum; rest days left out. The dashed line is 75%, on track."
        TrendKind.strength -> strength?.since?.let { "Your best logged loads, against where each lift started in $it." }
            ?: "Your best logged loads, against where each lift started."
    }

    Column(Modifier.jkScreen()) {
        TopBar(title, leading = {}, trailing = { BarButton("Done", bold = true) { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            if (points.size >= 2) {
                TrendChart(points, target, Modifier.fillMaxWidth().height(200.dp).semantics { contentDescription = "$title, the last eight weeks" })
                Row {
                    Text(Fmt.dayMonth(points.first().first), style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
                    Text(Fmt.dayMonth(points.last().first), style = JKType.caption, color = JKColors.textSecondary)
                }
            } else if (kind != TrendKind.strength) {
                Text("Not enough yet for a trend. A few more weeks and it appears here.", style = quoteStyle(inSheet = true), color = JKColors.text)
            }
            Text(madeFrom, style = JKType.caption, color = JKColors.textSecondary)
            if (kind == TrendKind.strength) {
                progress?.records.orEmpty().take(6).forEach { r ->
                    MeasureRow(r.exercise, "${Fmt.number(r.kg)} kg", r.gain?.let { "${Fmt.delta(it)} kg" })
                }
            }
        }
    }
}

/** A slate line over time with an optional dashed bone target line. No fill, no axes. */
@Composable
private fun TrendChart(points: List<Pair<LocalDate, Double>>, target: Double?, modifier: Modifier) {
    val values = points.map { it.second } + listOfNotNull(target)
    val low0 = values.minOrNull() ?: 0.0
    val high0 = values.maxOrNull() ?: 1.0
    val pad = max((high0 - low0) * 0.1, 0.5)
    val low = low0 - pad
    val high = high0 + pad
    val line = JKColors.data
    val dash = JKColors.text
    Canvas(modifier) {
        val firstDay = points.minOf { it.first.toEpochDay() }
        val span = max(1L, points.maxOf { it.first.toEpochDay() } - firstDay).toFloat()
        fun x(d: LocalDate) = (d.toEpochDay() - firstDay) / span * size.width
        fun y(v: Double) = (size.height * (1 - (v - low) / (high - low))).toFloat()
        target?.let { t ->
            drawLine(
                dash,
                Offset(0f, y(t)),
                Offset(size.width, y(t)),
                strokeWidth = 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
            )
        }
        val path = Path()
        points.forEachIndexed { i, (d, v) -> if (i == 0) path.moveTo(x(d), y(v)) else path.lineTo(x(d), y(v)) }
        drawPath(path, line, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
