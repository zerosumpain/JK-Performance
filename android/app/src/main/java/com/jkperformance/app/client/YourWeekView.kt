package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.BookingsResponse
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.HabitWeekResponse
import com.jkperformance.app.net.OK
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

/**
 * Your week (atelier-spec.md, Client screens 3): the programmed workouts,
 * 1:1s, classes, video calls and JK's rest days in one day-by-day list, this
 * week first and earlier weeks below, scrolled to the requested day. Every
 * action is a visible button. A month grid sits behind the toggle; booking
 * and the calendar feed live at the foot (plans with 'sessions').
 */
@Composable
fun YourWeekView(day: String? = null) {
    val session = AppSession
    val gate = session.gate
    val nav = LocalNav.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()

    var workouts by remember { mutableStateOf<List<WorkoutSummary>?>(null) }
    var bookings by remember { mutableStateOf<List<Booking>?>(null) }
    val rests = remember { mutableStateMapOf<String, String?>() }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var month by remember { mutableStateOf(false) }
    var monthDay by remember { mutableStateOf(LocalDate.now(Day.zone)) }
    var details by remember { mutableStateOf<Booking?>(null) }
    var cancelling by remember { mutableStateOf<Booking?>(null) }
    var scrolledTo by remember { mutableStateOf(false) }

    val today = LocalDate.now(Day.zone)
    // This week and next first, then the three weeks before.
    val thisMonday = Day.weekStart(today)
    val upcomingDays = (0 until 14).map { Day.add(it, thisMonday) }
    val earlierDays = (1..21).map { Day.add(-it, thisMonday) }
    val target = day ?: Day.today

    suspend fun fetch(from: String, to: String) {
        var failure: String? = null
        coroutineScope {
            val query = mapOf("from" to from, "to" to to)
            val w = async { runCatching { APIClient.get<WorkoutsResponse>("/api/workouts", query).workouts } }
            val b = async { runCatching { APIClient.get<BookingsResponse>("/api/bookings", query).bookings } }
            w.await().onSuccess { workouts = it }.onFailure {
                if (it.isCancellation) throw it
                failure = it.readable
            }
            b.await().onSuccess { bookings = it }.onFailure {
                if (it.isCancellation) throw it
                failure = failure ?: it.readable
            }
        }
        if (gate.habits) {
            runCatching { APIClient.get<HabitWeekResponse>("/api/habits/week", mapOf("from" to from, "to" to to)) }.getOrNull()?.days
                ?.filter { it.rest == true }
                ?.forEach { rests[it.date] = it.restReason }
        }
        error = failure
        if (workouts == null && failure == null) workouts = emptyList()
    }

    suspend fun load() = fetch(Day.string(earlierDays.last()), Day.string(upcomingDays.last()))

    suspend fun loadMonth() {
        val start = Day.monthStart(monthDay)
        fetch(Day.string(start), Day.string(Day.add(start.lengthOfMonth() - 1, start)))
    }

    fun items(on: LocalDate): List<WeekItem> {
        val key = Day.string(on)
        val w = (workouts ?: emptyList()).filter { it.date == key }.map { WeekItem.Workout(it) }
        val b = (bookings ?: emptyList()).filter { Day.string(it.start) == key && (it.isMine || gate.sessions) }.map { WeekItem.Session(it) }
        return (w + b).sortedBy { it.sortKey }
    }

    fun joinOrLeave(item: WeekItem, join: Boolean) {
        val booking = (item as? WeekItem.Session)?.booking ?: return
        scope.launch {
            try {
                val fresh = APIClient.send<Booking>("POST", "/api/classes/${seg(booking.id)}/${if (join) "join" else "leave"}")
                bookings = bookings?.map { if (it.id == fresh.id) fresh else it }
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                actionError = e.readable
            }
        }
    }

    fun cancel(booking: Booking) {
        scope.launch {
            try {
                val reply = APIClient.send<OK>("DELETE", "/api/bookings/${seg(booking.id)}")
                bookings = bookings?.filterNot { it.id == booking.id }
                session.refreshMe()
                if (reply.refunded != true && booking.usesCredit == true) {
                    actionError = "Cancelled. It was within 24 hours, so the credit wasn't refunded."
                }
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                actionError = e.readable
            }
        }
    }

    LaunchedEffect(month, if (month) Day.string(Day.monthStart(monthDay)) else "") {
        if (month) loadMonth() else load()
    }

    @Composable
    fun DaySection(d: LocalDate) {
        val key = Day.string(d)
        val list = items(d)
        val isToday = d == today
        Column(
            Modifier.onGloballyPositioned { coords ->
                if (!month && !scrolledTo && key == target && workouts != null) {
                    scrolledTo = true
                    scope.launch { scroll.scrollTo(coords.positionInParent().y.toInt()) }
                }
            },
            verticalArrangement = Arrangement.spacedBy(JKSpace.s),
        ) {
            Row(Modifier.semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                Text(Fmt.longDay(d), style = JKType.headline, color = if (isToday) JKColors.text else JKColors.textSecondary)
                if (isToday) Text("Today", style = JKType.caption, color = JKColors.textSecondary)
            }
            if (rests.containsKey(key)) {
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                    Glyph(IconKey.rest, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                    Text("Rest day from JK" + (rests[key]?.let { " · $it" } ?: ""), style = JKType.callout, color = JKColors.textSecondary)
                }
            } else if (list.isEmpty()) {
                Text("Nothing planned", style = JKType.caption, color = JKColors.textSecondary)
            }
            list.forEach { item ->
                WeekItemRow(
                    item = item,
                    onOpen = { (item as? WeekItem.Workout)?.let { nav.push(ClientRoute.session(it.workout.id)) } },
                    onJoin = { (item as? WeekItem.Session)?.booking?.meetingUrl?.let { runCatching { uriHandler.openUri(it) } } },
                    onDetails = { details = (item as? WeekItem.Session)?.booking },
                    onCancel = { cancelling = (item as? WeekItem.Session)?.booking },
                    onClass = { join -> joinOrLeave(item, join) },
                    onCalendar = {
                        item.draft?.let { if (!context.addToCalendar(it)) actionError = "No calendar app on this phone can add events." }
                    },
                )
            }
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = "Your week") {
            Box(
                Modifier
                    .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                    .clickable(role = Role.Button) { month = !month }
                    .semantics { contentDescription = if (month) "Show the list" else "Show the month" },
                contentAlignment = Alignment.Center,
            ) {
                Glyph(if (month) IconKey.checklist else IconKey.week, tint = JKColors.text)
            }
        }
        JKRefreshable(onRefresh = { if (month) loadMonth() else load() }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(scroll).padding(JKSpace.gutter),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
            ) {
                if (month) {
                    MonthGrid(selected = monthDay, marked = markedDays(bookings, workouts), onSelect = { monthDay = it })
                    DaySection(monthDay)
                } else {
                    Loadable(value = workouts, error = error, retry = { load() }) { _ ->
                        upcomingDays.forEach { DaySection(it) }
                        if (earlierDays.any { items(it).isNotEmpty() }) {
                            Label("Earlier")
                            earlierDays.forEach { d ->
                                if (items(d).isNotEmpty() || rests.containsKey(Day.string(d))) DaySection(d)
                            }
                        }
                    }
                }
                if (gate.sessions) {
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = JKSize.touchTarget)
                                .navLink { BookSessionView(initialDay = if (monthDay < today) today else monthDay) },
                            horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Glyph(IconKey.book, tint = JKColors.textSecondary)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                                Text("Book a session", style = JKType.headline, color = JKColors.text)
                                Text(creditsLine(session.me?.membership), style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                            }
                            Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                        }
                        GroupDivider()
                        CalendarSubscribeCard()
                    }
                }
            }
        }
    }

    details?.let { b ->
        Sheet(onDismiss = { details = null }) { BookingDetailsSheet(b) }
    }
    cancelling?.let { b ->
        AlertDialog(
            onDismissRequest = { cancelling = null },
            title = { Text("Cancel this booking?", style = JKType.headline, color = JKColors.text) },
            text = {
                Text(
                    if (b.refundable == false) "It is within 24 hours, so the credit is not refunded."
                    else "Cancelling 24 hours or more ahead refunds the credit.",
                    style = JKType.callout, color = JKColors.textSecondary,
                )
            },
            confirmButton = {
                TextButton("Cancel booking", onClick = {
                    cancelling = null
                    cancel(b)
                })
            },
            dismissButton = { TextButton("Keep it", onClick = { cancelling = null }) },
            containerColor = JKColors.raised,
            shape = JKShape.card,
        )
    }
    ErrorAlert(actionError) { actionError = null }
}

private fun markedDays(bookings: List<Booking>?, workouts: List<WorkoutSummary>?): Set<String> =
    ((bookings ?: emptyList()).filter { it.isMine }.map { Day.string(it.start) } + (workouts ?: emptyList()).map { it.date }).toSet()

private fun creditsLine(m: com.jkperformance.app.net.Membership?): String {
    val left = m?.creditsLeft ?: return "1:1s and video calls with JK"
    return if (left == 1) "1 credit left" else "$left credits left"
}

/** One thing in the week: a programmed workout or a booking. */
sealed class WeekItem {
    data class Workout(val workout: WorkoutSummary) : WeekItem()
    data class Session(val booking: Booking) : WeekItem()

    val sortKey: String
        get() = when (this) {
            is Workout -> workout.startsAt ?: "99"
            is Session -> Fmt.time(booking.start)
        }

    val icon: IconKey
        get() = when (this) {
            is Workout -> IconKey.workout
            is Session -> when {
                booking.kind == "video" -> IconKey.video
                booking.isGroup -> IconKey.groupSession
                else -> IconKey.oneToOne
            }
        }

    val title: String
        get() = when (this) {
            is Workout -> workout.title
            is Session -> booking.title ?: booking.kindLabel
        }

    val detail: String
        get() = when (this) {
            is Workout -> {
                val state = if (workout.completedAt != null) "Done" else "${workout.itemCount} exercises"
                listOfNotNull(workout.startsAt, workout.location?.takeIf { it.isNotEmpty() }, state).joinToString(" · ")
            }
            is Session -> {
                val b = booking
                val parts = mutableListOf("${Fmt.time(b.start)}–${Fmt.time(b.end)}")
                b.location?.takeIf { it.isNotEmpty() }?.let { parts += it }
                if (b.isGroup) b.capacity?.let { parts += "${b.attendeeCount ?: 0} of $it going" }
                parts.joinToString(" · ")
            }
        }

    val start: Instant?
        get() = when (this) {
            is Workout -> workout.startsAt?.let { t -> Day.date(workout.date)?.let { Day.at(it, t) } }
            is Session -> booking.start
        }

    /** Something still ahead that can go in the phone's calendar. */
    val draft: CalendarEventDraft?
        get() {
            val s = start ?: return null
            if (!s.isAfter(Instant.now())) return null
            return when (this) {
                is Workout -> CalendarEventDraft(workout.title, s, s.plusSeconds(3600), workout.location, "Training session in JK Performance")
                is Session -> if (!booking.isMine) null
                else CalendarEventDraft(booking.title ?: booking.kindLabel, booking.start, booking.end, booking.location, "JK Performance · ${booking.kindLabel}")
            }
        }
}

/**
 * A row in Your week: glyph, title, time and place, and visible buttons
 * (Start, Join or Details, Cancel, Add to calendar). No long-press menus.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WeekItemRow(
    item: WeekItem,
    onOpen: () -> Unit,
    onJoin: () -> Unit,
    onDetails: () -> Unit,
    onCancel: () -> Unit,
    onClass: (Boolean) -> Unit,
    onCalendar: () -> Unit,
) {
    val now = Instant.now()
    Column(Modifier.fillMaxWidth().jkSurface(padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.Top) {
            Glyph(item.icon, tint = JKColors.textSecondary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                Text(item.title, style = JKType.headline, color = JKColors.text)
                Text(item.detail, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            when (item) {
                is WeekItem.Workout -> {
                    val w = item.workout
                    SmallPill(if (w.completedAt == null && w.date <= Day.today) "Start" else "View", onClick = onOpen)
                }
                is WeekItem.Session -> {
                    val b = item.booking
                    if (b.isGroup) {
                        if (b.joined == true) {
                            if (b.start.isAfter(now)) SmallPill("Leave class", onClick = { onClass(false) })
                        } else if (b.start.isAfter(now)) {
                            SmallPill("Join class", onClick = { onClass(true) })
                        }
                    } else {
                        if (b.meetingUrl != null && b.end.isAfter(now)) SmallPill("Join", onClick = onJoin)
                        else SmallPill("Details", onClick = onDetails)
                        if (b.cancellable == true && b.start.isAfter(now)) SmallPill("Cancel", onClick = onCancel)
                    }
                }
            }
            if (item.draft != null) SmallPill("Add to calendar", onClick = onCalendar)
        }
    }
}

/** When, where and how for one booking. Shown in a [Sheet]. */
@Composable
fun BookingDetailsSheet(booking: Booking) {
    val dismiss = LocalDismiss.current
    Column(Modifier.jkScreen()) {
        TopBar(leading = {}) { BarButton("Done", bold = true) { dismiss() } }
        Column(Modifier.fillMaxWidth().padding(JKSpace.gutter), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
            Text(booking.title ?: booking.kindLabel, style = JKType.headline, color = JKColors.text)
            Text(
                "${Fmt.longDay(booking.start)} · ${Fmt.time(booking.start)}–${Fmt.time(booking.end)}",
                style = JKType.callout.monospacedDigit(), color = JKColors.textSecondary,
            )
            booking.location?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.callout, color = JKColors.textSecondary) }
            if (booking.kind == "video" && booking.meetingUrl == null) {
                Text("JK will send the link before the call.", style = JKType.caption, color = JKColors.textSecondary)
            }
        }
    }
}

/** The month at a glance: a dot under each day with something on it. */
@Composable
fun MonthGrid(selected: LocalDate, marked: Set<String>, onSelect: (LocalDate) -> Unit) {
    val month = Day.monthStart(selected)
    val days = (0 until month.lengthOfMonth()).map { Day.add(it, month) }
    val cells: List<LocalDate?> = List(Day.isoWeekday(month) - 1) { null } + days
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                    .clickable { onSelect(month.minusMonths(1)) }
                    .semantics { contentDescription = "Previous month" },
                contentAlignment = Alignment.Center,
            ) { Glyph(IconKey.back, tint = JKColors.textSecondary) }
            Text(Fmt.month(month), style = JKType.headline, color = JKColors.text, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Box(
                Modifier.sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                    .clickable { onSelect(month.plusMonths(1)) }
                    .semantics { contentDescription = "Next month" },
                contentAlignment = Alignment.Center,
            ) { Glyph(IconKey.chevron, tint = JKColors.textSecondary) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            listOf("M", "T", "W", "T", "F", "S", "S").forEach { d ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Text(d, style = JKType.caption, color = JKColors.textSecondary) }
            }
        }
        cells.chunked(7).forEach { week ->
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                (0 until 7).forEach { i ->
                    val d = week.getOrNull(i)
                    Box(Modifier.weight(1f).heightIn(min = JKSize.touchTarget), contentAlignment = Alignment.Center) {
                        if (d != null) {
                            val on = d == selected
                            val busy = marked.contains(Day.string(d))
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = JKSize.touchTarget)
                                    .clickable { onSelect(d) }
                                    .semantics(mergeDescendants = true) {
                                        contentDescription = Fmt.longDay(d)
                                        if (busy) stateDescription = "Something planned"
                                    },
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(JKSpace.xs, Alignment.CenterVertically),
                            ) {
                                Box(
                                    Modifier.sizeIn(minWidth = JKSpace.xxxl, minHeight = JKSpace.xxxl)
                                        .background(if (on) JKColors.primaryFill else JKColors.bg, CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text("${d.dayOfMonth}", style = JKType.callout.monospacedDigit(), color = if (on) JKColors.primaryLabel else JKColors.text)
                                }
                                Box(Modifier.size(JKSpace.xs).background(if (busy) JKColors.textSecondary else JKColors.bg, CircleShape))
                            }
                        }
                    }
                }
            }
        }
    }
}
