package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.CheckCircle
import com.jkperformance.app.design.Dot
import com.jkperformance.app.design.EmptyCard
import com.jkperformance.app.design.ErrorAlert
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.ErrorCard
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.GhostButton
import com.jkperformance.app.design.IconTile
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKField
import com.jkperformance.app.design.JKRefreshable
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Label
import com.jkperformance.app.design.LoadingCard
import com.jkperformance.app.design.Loadable
import com.jkperformance.app.design.LocalDismiss
import com.jkperformance.app.design.LocalNav
import com.jkperformance.app.design.ProgressRing
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.ThinBar
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.BarButton
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.Sheet
import com.jkperformance.app.design.UpcomingRow
import com.jkperformance.app.design.bold
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.medium
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.parseNumber
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.design.symbol
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.BookingsResponse
import com.jkperformance.app.net.CheckInsResponse
import com.jkperformance.app.net.FoodEntry
import com.jkperformance.app.net.FoodInput
import com.jkperformance.app.net.Habit
import com.jkperformance.app.net.HabitDayInput
import com.jkperformance.app.net.HabitsResponse
import com.jkperformance.app.net.Nutrition
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.WorkoutSummary
import com.jkperformance.app.net.WorkoutsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** iOS's `.red`, for the Health prompt's heart. */
private val SystemRed = Color(1f, 0.23f, 0.19f)

/**
 * A card that is also a NavigationLink: the press dim is clipped to the
 * card's rounded corners rather than its bounding box.
 */
@Composable
private fun Modifier.cardLink(corner: Dp = JK.corner, destination: @Composable () -> Unit): Modifier =
    this.clip(rounded(corner)).navLink(destination = destination)

/**
 * "Morning, Sam": one card for today, the next booking, and four doors
 * (habits, progress, check-in, feedback). Kept short on purpose; the
 * detail lives behind each door.
 */
@Composable
fun ClientHomeView() {
    val session = AppSession
    var week by remember { mutableStateOf<List<WorkoutSummary>?>(null) }
    var habits by remember { mutableStateOf<HabitsResponse?>(null) }
    var bookings by remember { mutableStateOf<List<Booking>?>(null) }
    var reports by remember { mutableStateOf<ReportsResponse?>(null) }
    var checkins by remember { mutableStateOf<CheckInsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var reloads by remember { mutableIntStateOf(0) }

    suspend fun load() {
        val today = LocalDate.now(Day.zone)
        val days = Day.week(today)
        val from = Day.string(days[0])
        val to = Day.string(Day.add(7, days[6]))
        // The five reads run together; one failing doesn't stop the others.
        coroutineScope {
            val w = async { runCatching { APIClient.get<WorkoutsResponse>("/api/workouts", mapOf("from" to from, "to" to to)) } }
            val h = async { runCatching { APIClient.get<HabitsResponse>("/api/habits", mapOf("date" to Day.today)) } }
            val b = async {
                runCatching {
                    APIClient.get<BookingsResponse>("/api/bookings", mapOf("from" to Day.today, "to" to Day.string(Day.add(14, today))))
                }
            }
            val r = async { runCatching { APIClient.get<ReportsResponse>("/api/reports") } }
            val c = async { runCatching { APIClient.get<CheckInsResponse>("/api/checkins") } }
            val failures = mutableListOf<String>()
            fun note(e: Throwable) {
                if (!e.isCancellation) failures += e.readable
            }
            w.await().onSuccess { week = it.workouts }.onFailure(::note)
            h.await().onSuccess { habits = it }.onFailure(::note)
            b.await().onSuccess { bookings = it.bookings }.onFailure(::note)
            // Reports and check-ins only label the tiles: a failure just blanks them.
            reports = r.await().getOrNull()
            checkins = c.await().getOrNull()
            Reminders.schedule(bookings = bookings ?: emptyList(), workouts = week ?: emptyList())
            session.refreshMe()
            error = failures.firstOrNull()
            loaded = week != null || habits != null || bookings != null
            reloads += 1
        }
    }

    LaunchedEffect(Unit) { load() }

    val coachName = session.me?.coach?.name ?: "your coach"

    JKRefreshable(onRefresh = { load() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ScreenHeader(
                eyebrow = Fmt.longDay(LocalDate.now(Day.zone)),
                title = "${Fmt.greeting()}, ${session.me?.firstName ?: "there"}",
            ) {
                Box(
                    Modifier.size(30.dp).border(1.dp, JK.secondary, rounded(7.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("JK", style = JKType.caption.bold(), color = JK.text)
                }
            }

            val failure = error
            if (failure != null && !loaded) {
                ErrorCard(failure) { load() }
            } else if (!loaded) {
                LoadingCard()
            } else {
                if (failure != null) ErrorBanner(failure)
                ClientFormsCard(refresh = reloads)
                TodayCard(week)
                NextBooking(bookings)
                NewFeedback(reports, coachName)
                HealthPrompt()
                val habitList = habits?.habits
                val habitsValue = if (habitList.isNullOrEmpty()) "None set" else "${habitList.count { it.done }} of ${habitList.size} today"
                val checkinValue = checkins?.let { c -> if (c.checkins.any { it.week == c.dueWeek }) "Sent" else "Due" } ?: "Weekly"
                val feedbackValue = reports?.let { r ->
                    when {
                        r.unread > 0 -> if (r.unread == 1) "1 new" else "${r.unread} new"
                        else -> r.reports.firstOrNull()?.let { Fmt.dayMonth(it.week) } ?: "None yet"
                    }
                } ?: "Weekly"
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HomeTile("Habits", habitsValue, "checklist", Modifier.weight(1f)) { DailyHabitsView() }
                        HomeTile("Progress", "Weight, records", "chart.line.downtrend.xyaxis", Modifier.weight(1f)) { ProgressScreen() }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HomeTile("Check-in", checkinValue, "square.and.pencil", Modifier.weight(1f), highlight = checkinValue == "Due") {
                            WeeklyCheckInView()
                        }
                        HomeTile("Feedback", feedbackValue, "text.bubble", Modifier.weight(1f), highlight = (reports?.unread ?: 0) > 0) {
                            WeeklyFeedbackListView()
                        }
                    }
                }
            }
        }
    }
}

// MARK: Today

@Composable
private fun TodayCard(week: List<WorkoutSummary>?) {
    val all = week ?: emptyList()
    val today = Day.today
    val weekDays = Day.week(LocalDate.now(Day.zone)).map(Day::string).toSet()
    val thisWeek = all.filter { it.date in weekDays }
    val mine = all.filter { it.date == today }
    val todayWorkout = mine.firstOrNull { it.completedAt == null } ?: mine.firstOrNull()
    val nextWorkout = all.filter { it.date > today && it.completedAt == null }.minByOrNull { it.date }
    val weekLine = if (thisWeek.isEmpty()) "" else "${thisWeek.count { it.completedAt != null }} of ${thisWeek.size} sessions done this week"

    if (todayWorkout != null) {
        val w = todayWorkout
        val nav = LocalNav.current
        val starts = w.startsAt?.let { Day.at(LocalDate.now(Day.zone), it) }
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Eyebrow(text = "Today", modifier = Modifier.weight(1f))
                val badge = if (w.completedAt != null) "Done" else starts?.let { Fmt.countdown(it) }
                if (badge != null) {
                    Text(
                        badge,
                        style = JKType.caption2,
                        color = JK.secondary,
                        modifier = Modifier.background(JK.cardRaised, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            Text(w.title, style = JKType.title3.semibold(), color = JK.text)
            Text(
                listOfNotNull(w.startsAt, w.location?.takeIf { it.isNotEmpty() }).joinToString(" · ") +
                    (if (w.completedAt == null) "" else " · ${w.doneCount} of ${w.itemCount} exercises"),
                style = JKType.caption,
                color = JK.secondary,
            )
            ChromeButton(onClick = { nav.push { WorkoutDetailLoader(workoutId = w.id) } }, modifier = Modifier.padding(top = 4.dp)) {
                Label(
                    if (w.completedAt == null) "Start workout" else "View workout",
                    systemImage = if (w.completedAt == null) "play.fill" else "checkmark",
                    style = JKType.subheadline.semibold(),
                )
            }
            if (weekLine.isNotEmpty()) Text(weekLine, style = JKType.caption2, color = JK.tertiary)
        }
    } else {
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow(text = "Today")
            Text("Rest day", style = JKType.title3.semibold(), color = JK.text)
            Text(
                nextWorkout?.let { w ->
                    "Next: ${w.title}, ${Day.date(w.date)?.let { Fmt.weekday(it) } ?: w.date}" + (w.startsAt?.let { " $it" } ?: "")
                } ?: "Walk, recover and tick off your habits.",
                style = JKType.caption,
                color = JK.secondary,
            )
            if (weekLine.isNotEmpty()) Text(weekLine, style = JKType.caption2, color = JK.tertiary)
        }
    }
}

@Composable
private fun NextBooking(bookings: List<Booking>?) {
    val now = Instant.now()
    val b = bookings.orEmpty().filter { it.end > now && it.isMine }.minByOrNull { it.start } ?: return
    val day = Day.start(b.start)
    UpcomingRow(
        weekday = Fmt.weekday(b.start),
        day = "${day.dayOfMonth}",
        title = b.title ?: b.kindLabel,
        detail = listOfNotNull(Fmt.time(b.start), b.location).joinToString(" · "),
        modifier = Modifier.cardLink { MyCalendarView(initialDay = day, embedded = true) }.jkCard(padding = 4.dp),
    )
}

@Composable
private fun NewFeedback(reports: ReportsResponse?, coachName: String) {
    val r = reports?.reports?.firstOrNull { it.isUnread } ?: return
    val id = r.id ?: return
    Row(
        Modifier.cardLink { ReportDetailView(reportId = id) }.jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile("text.bubble.fill")
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("New feedback from $coachName", style = JKType.subheadline.semibold(), color = JK.text)
            Text(r.weekLabel, style = JKType.caption2, color = JK.tertiary)
        }
        SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

/**
 * The nudge to share health data, until the client has. Android reads it
 * from Health Connect, so the iPhone's "Apple Health" is named that here.
 */
@Composable
private fun HealthPrompt() {
    if (HealthSync.optedIn || !HealthSync.available || AppSession.me?.demo == true) return
    Row(
        Modifier
            .fillMaxWidth()
            .cardLink(12.dp) { HealthDevicesView() }
            .drawBehind {
                val line = 1.dp.toPx()
                val dash = 4.dp.toPx()
                drawRoundRect(
                    color = JK.stroke,
                    topLeft = Offset(line / 2, line / 2),
                    size = Size(size.width - line, size.height - line),
                    cornerRadius = CornerRadius(12.dp.toPx() - line / 2),
                    style = Stroke(line, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash))),
                )
            }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SystemImage("heart.fill", JKType.body, SystemRed)
        Text("Connect Health Connect", style = JKType.subheadline.medium(), color = JK.text, modifier = Modifier.weight(1f))
        SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

/** A square door on Home: icon, name, one line of state. */
@Composable
private fun HomeTile(
    title: String,
    value: String,
    systemName: String,
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
    destination: @Composable () -> Unit,
) {
    Column(modifier.cardLink(destination = destination).jkCard(padding = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SystemImage(systemName, JKType.title3, JK.text)
            Spacer(Modifier.weight(1f))
            if (highlight) Dot(JK.text, size = 7.dp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            Text(value, style = JKType.caption2, color = if (highlight) JK.text else JK.tertiary, maxLines = 1)
        }
    }
}

// MARK: - Daily habits

@Composable
fun DailyHabitsView() {
    val session = AppSession
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<HabitsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<Habit?>(null) }
    var logging by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }

    fun replaceNutrition(fresh: Nutrition) {
        val current = data ?: return
        data = current.copy(nutrition = fresh)
    }

    suspend fun load() {
        try {
            data = APIClient.get("/api/habits", mapOf("date" to Day.today))
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun setDay(habit: Habit, input: HabitDayInput) {
        try {
            val fresh: Habit = APIClient.send("PUT", "/api/habits/${seg(habit.id)}/days/${Day.today}", input)
            data?.let { current -> data = current.copy(habits = current.habits.map { if (it.id == fresh.id) fresh else it }) }
            // The streak is computed server-side; re-read it quietly.
            runCatching { APIClient.get<HabitsResponse>("/api/habits", mapOf("date" to Day.today)) }.getOrNull()?.let { data = it }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    suspend fun deleteEntry(entry: FoodEntry) {
        try {
            replaceNutrition(APIClient.send("DELETE", "/api/nutrition/entries/${seg(entry.id)}"))
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ScreenHeader(eyebrow = Fmt.longDay(LocalDate.now(Day.zone)), title = "Daily habits")
                Loadable(value = data, error = error, retry = { load() }) { d ->
                    NutritionCard(
                        n = d.nutrition,
                        onLog = { logging = true },
                        onDelete = { entry -> scope.launch { deleteEntry(entry) } },
                    )
                    Eyebrow(text = "Habits set by ${session.me?.coach?.name ?: "your coach"}")
                    if (d.habits.isEmpty()) {
                        EmptyCard(systemName = "checklist", title = "No habits yet", detail = "Your coach will add daily habits here.")
                    }
                    d.habits.forEach { habit ->
                        HabitRow(habit) {
                            if (habit.fromHealth) return@HabitRow
                            if (habit.isCount) {
                                editing = habit
                            } else {
                                scope.launch { setDay(habit, HabitDayInput(value = null, done = !habit.done)) }
                            }
                        }
                    }
                    Column(
                        Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(Modifier.padding(horizontal = 40.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            repeat(7) { i ->
                                Box(
                                    Modifier
                                        .weight(1f)
                                        .height(3.dp)
                                        .background(if (i < minOf(d.streak, 7)) JK.text else JK.track, CircleShape),
                                )
                            }
                        }
                        Text("${d.streak}-day habit streak", style = JKType.caption2, color = JK.tertiary)
                    }
                }
            }
        }
    }

    editing?.let { habit ->
        HabitValueSheet(habit = habit, onDismiss = { editing = null }) { value ->
            setDay(habit, HabitDayInput(value = value, done = null))
        }
    }
    if (logging) {
        Sheet(onDismiss = { logging = false }) {
            FoodLogSheet { input ->
                replaceNutrition(APIClient.send<Nutrition, FoodInput>("POST", "/api/nutrition/entries", input))
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun HabitRow(habit: Habit, onTap: () -> Unit) {
    Row(
        Modifier.clip(rounded(JK.corner)).clickable(onClick = onTap).jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(symbol(habit.icon))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(habit.name, style = JKType.subheadline.semibold(), color = JK.text)
            Text(habitDetail(habit), style = JKType.caption2, color = JK.tertiary)
            ThinBar(fraction = if (habit.done) 1.0 else if (habit.target > 0) (habit.value ?: 0.0) / habit.target else 0.0)
        }
        CheckCircle(on = habit.done)
    }
}

private fun habitDetail(habit: Habit): String {
    var text = when {
        habit.healthKind == "sleep" ->
            habit.value?.let { "${Fmt.minutes(it * 60)} / ${Fmt.number(habit.target)}h" } ?: "No sleep data yet"
        habit.isCount || habit.value != null -> "${Fmt.number(habit.value ?: 0.0)} / ${Fmt.number(habit.target)} ${habit.unit}"
        else -> if (habit.done) "Done" else "Tap when done"
    }
    if (habit.fromHealth) text += " · from Health Connect"
    return text
}

@Composable
private fun NutritionCard(n: Nutrition, onLog: () -> Unit, onDelete: (FoodEntry) -> Unit) {
    val target = n.targets
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Eyebrow(text = "Nutrition · Today", trailing = if (target == null) "No target set" else "Coach target")
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            val kcalTarget = target?.kcal ?: 0.0
            ProgressRing(
                fraction = if (kcalTarget > 0) minOf(1.0, n.totals.kcal / kcalTarget) else 0.0,
                lineWidth = 6.dp,
                modifier = Modifier.size(82.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(Fmt.number(n.totals.kcal, digits = 0), style = JKType.title3.semibold(), color = JK.text)
                    Text(
                        target?.let { "of ${Fmt.number(it.kcal, digits = 0)}" } ?: "kcal",
                        style = JKType.system(9),
                        color = JK.tertiary,
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                MacroRow(name = "Protein", value = n.totals.protein, target = target?.protein)
                MacroRow(name = "Carbs", value = n.totals.carbs, target = target?.carbs)
                MacroRow(name = "Fat", value = n.totals.fat, target = target?.fat)
            }
        }
        if (n.entries.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                n.entries.forEach { entry ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.name, style = JKType.caption, color = JK.text, modifier = Modifier.weight(1f))
                        Text("${Fmt.number(entry.kcal, digits = 0)} kcal", style = JKType.caption2, color = JK.tertiary)
                        SystemImage(
                            "xmark",
                            JKType.caption2,
                            JK.tertiary,
                            Modifier
                                .padding(start = 8.dp)
                                .clickable { onDelete(entry) }
                                .semantics { contentDescription = "Remove ${entry.name}" },
                        )
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // No photo recognition yet: both open the same quick log.
            GhostButton(onClick = onLog, modifier = Modifier.weight(1f)) {
                Label("Snap a meal", systemImage = "camera", style = JKType.subheadline.semibold())
            }
            GhostButton(onClick = onLog, modifier = Modifier.weight(1f)) {
                Label("Log food", systemImage = "magnifyingglass", style = JKType.subheadline.semibold())
            }
        }
    }
}

@Composable
private fun MacroRow(name: String, value: Double, target: Double?) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row {
            Text(name, style = JKType.caption2, color = JK.tertiary, modifier = Modifier.weight(1f))
            Text(
                target?.let { "${Fmt.number(value, digits = 0)} / ${Fmt.number(it, digits = 0)} g" }
                    ?: "${Fmt.number(value, digits = 0)} g",
                style = JKType.caption2,
                color = JK.secondary,
            )
        }
        ThinBar(fraction = if ((target ?: 0.0) > 0) value / target!! else 0.0)
    }
}

/**
 * Sets the value of a "count" habit (litres of water, minutes…). A short
 * sheet from the bottom, as the iPhone's 260-point detent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HabitValueSheet(habit: Habit, onDismiss: () -> Unit, save: suspend (Double) -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf(habit.value?.let { Fmt.number(it, digits = 2) } ?: "") }
    var saving by remember { mutableStateOf(false) }

    fun dismiss() {
        scope.launch { state.hide() }.invokeOnCompletion { onDismiss() }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = JK.bg,
        contentColor = JK.text,
        dragHandle = null,
        shape = rounded(14.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(habit.name, style = JKType.title3.semibold(), color = JK.text)
            JKField(
                label = "Today (${habit.unit}) · target ${Fmt.number(habit.target)}",
                text = text,
                onTextChange = { text = it },
                prompt = "0",
                keyboard = KeyboardType.Decimal,
            )
            ChromeButton(
                onClick = {
                    val value = parseNumber(text) ?: return@ChromeButton
                    saving = true
                    scope.launch {
                        save(value)
                        saving = false
                        dismiss()
                    }
                },
                enabled = parseNumber(text) != null && !saving,
            ) {
                if (saving) ProgressView(tint = Color.Black) else Text("Save")
            }
        }
    }
}

/** Quick food log: name, kcal and macros. Shown in a [Sheet]. */
@Composable
fun FoodLogSheet(save: suspend (FoodInput) -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var kcal by remember { mutableStateOf("") }
    var protein by remember { mutableStateOf("") }
    var carbs by remember { mutableStateOf("") }
    var fat by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val valid = name.trim().isNotEmpty() && parseNumber(kcal) != null

    suspend fun submit() {
        saving = true
        try {
            save(
                FoodInput(
                    date = Day.today, name = name.trim(),
                    kcal = parseNumber(kcal) ?: 0.0, protein = parseNumber(protein) ?: 0.0,
                    carbs = parseNumber(carbs) ?: 0.0, fat = parseNumber(fat) ?: 0.0,
                ),
            )
            dismiss()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = "Log food", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            JKField(label = "Food", text = name, onTextChange = { name = it }, prompt = "Chicken, rice and greens")
            JKField(label = "Calories (kcal)", text = kcal, onTextChange = { kcal = it }, prompt = "0", keyboard = KeyboardType.Number)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                JKField("Protein (g)", protein, { protein = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
                JKField("Carbs (g)", carbs, { carbs = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
                JKField("Fat (g)", fat, { fat = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
            }
            error?.let { ErrorBanner(it) }
            ChromeButton(onClick = { scope.launch { submit() } }, enabled = valid && !saving) {
                if (saving) ProgressView(tint = Color.Black) else Text("Log food")
            }
        }
    }
}
