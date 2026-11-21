@file:Suppress("EnumEntryName")

package com.jkperformance.app

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.jkperformance.app.design.Avatar
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.DayStrip
import com.jkperformance.app.design.EmptyCard
import com.jkperformance.app.design.ErrorAlert
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.ErrorCard
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKRefreshable
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Label
import com.jkperformance.app.design.LoadingCard
import com.jkperformance.app.design.LocalDismiss
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.Segmented
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.bold
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.design.sfIcon
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.ApiJson
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.BookingInput
import com.jkperformance.app.net.BookingsResponse
import com.jkperformance.app.net.OK
import com.jkperformance.app.net.PersonRef
import com.jkperformance.app.net.Slot
import com.jkperformance.app.net.SlotsResponse
import com.jkperformance.app.net.WorkoutSummary
import com.jkperformance.app.net.WorkoutsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.serializer
import java.time.Instant
import java.time.LocalDate

// MARK: - My calendar (Calendar tab root)

/** iOS's destructive red (dark mode), for "Cancel booking" and "Leave class" in the long-press menu. */
private val DestructiveRed = Color(0xFFFF453A)

/**
 * `rememberSaveable` for API values, kept as their JSON. The NavHost disposes a
 * covered screen, so this is what keeps the month's events (and the month)
 * in place behind "Request a session", as SwiftUI keeps @State.
 */
private inline fun <reified T> jsonSaver(): Saver<MutableState<T>, String> = Saver(
    save = { ApiJson.encodeToString(serializer<T>(), it.value) },
    restore = { mutableStateOf(ApiJson.decodeFromString(serializer<T>(), it)) },
)

/**
 * Month grid with dots from bookings and workouts, then the chosen day's list.
 * Every tab root already sits in its own NavHost, so `embedded` (a calendar
 * inside another screen's stack) renders the same; it stays for the iPhone's
 * call sites.
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun MyCalendarView(initialDay: LocalDate = LocalDate.now(), embedded: Boolean = false) {
    var selected by rememberSaveable { mutableStateOf(Day.start(initialDay)) }
    var bookings by rememberSaveable(saver = jsonSaver<List<Booking>?>()) { mutableStateOf(null) }
    var workouts by rememberSaveable(saver = jsonSaver<List<WorkoutSummary>?>()) { mutableStateOf(null) }
    var loadedMonth by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val month = Day.monthStart(selected)
    val monthDays = (0 until month.lengthOfMonth()).map { Day.add(it, month) }
    val leadingBlanks = Day.isoWeekday(month) - 1
    val today = LocalDate.now(Day.zone)
    val markedDays = ((bookings ?: emptyList()).filter { it.isMine }.map { Day.string(it.start) } +
        (workouts ?: emptyList()).map { it.date }).toSet()

    suspend fun load(force: Boolean) {
        val key = Day.string(month)
        if (!force && key == loadedMonth) return
        val query = mapOf("from" to key, "to" to Day.string(monthDays.lastOrNull() ?: month))
        var failure: String? = null
        coroutineScope {
            val b = async { runCatching { APIClient.get<BookingsResponse>("/api/bookings", query).bookings } }
            val w = async { runCatching { APIClient.get<WorkoutsResponse>("/api/workouts", query).workouts } }
            b.await().onSuccess { bookings = it }.onFailure {
                if (it.isCancellation) throw it
                failure = it.readable
            }
            w.await().onSuccess { workouts = it }.onFailure {
                if (it.isCancellation) throw it
                failure = failure ?: it.readable
            }
        }
        error = failure
        if (failure == null) loadedMonth = key
    }

    fun joinOrLeave(booking: Booking, join: Boolean) = scope.launch {
        try {
            val fresh = APIClient.send<Booking>("POST", "/api/classes/${seg(booking.id)}/${if (join) "join" else "leave"}")
            bookings = bookings?.map { if (it.id == fresh.id) fresh else it }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    fun cancel(booking: Booking) = scope.launch {
        try {
            val reply = APIClient.send<OK>("DELETE", "/api/bookings/${seg(booking.id)}")
            bookings = bookings?.filterNot { it.id == booking.id }
            if (reply.refunded != true && booking.usesCredit == true) {
                actionError = "Cancelled. It was within 24 hours, so the credit wasn't refunded."
            }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    fun addEvent(draft: CalendarEventDraft) {
        if (!context.addToCalendar(draft)) actionError = "No calendar app on this phone can add events."
    }

    LaunchedEffect(Day.string(month)) { load(force = false) }

    JKRefreshable(onRefresh = { load(force = true) }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ScreenHeader(eyebrow = "My calendar", title = Fmt.month(month)) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    SystemImage("chevron.left", JKType.body, JK.secondary, Modifier.clickable { selected = month.plusMonths(-1) })
                    SystemImage("chevron.right", JKType.body, JK.secondary, Modifier.clickable { selected = month.plusMonths(1) })
                }
            }

            MonthGrid(
                blanks = leadingBlanks,
                days = monthDays,
                selected = selected,
                today = today,
                marked = markedDays,
                onSelect = { selected = it },
            )

            val events = dayEvents(selected, bookings, workouts)
            Eyebrow(text = Fmt.longDay(selected), trailing = if (events.size == 1) "1 event" else "${events.size} events")
            val loadError = error
            when {
                loadError != null && bookings == null && workouts == null -> ErrorCard(loadError, retry = { load(force = true) })
                bookings == null && workouts == null -> LoadingCard()
                else -> {
                    if (loadError != null) ErrorBanner(loadError)
                    if (events.isEmpty()) Text("Nothing on this day.", style = JKType.caption, color = JK.tertiary)
                    events.forEach { event ->
                        DayEventRow(
                            event = event,
                            onAddToCalendar = ::addEvent,
                            onJoinOrLeave = { b, join -> joinOrLeave(b, join) },
                            onCancel = { cancel(it) },
                        )
                    }
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .dashedBorder(JK.stroke, 12.dp, dash = 4.dp)
                    .navLink { BookSessionView(initialDay = if (selected < today) today else selected) }
                    .padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Label("Request a session", systemImage = "plus", style = JKType.subheadline, color = JK.secondary)
            }
            HelpText()
            CalendarSubscribeCard()
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

/** Weekday letters, then the month's days in Monday-first rows; the chosen day wears the chrome, busy days a dot. */
@Composable
private fun MonthGrid(
    blanks: Int,
    days: List<LocalDate>,
    selected: LocalDate,
    today: LocalDate,
    marked: Set<String>,
    onSelect: (LocalDate) -> Unit,
) {
    val weekdays = listOf("M", "T", "W", "T", "F", "S", "S")
    val cells: List<LocalDate?> = List(blanks) { null } + days
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            weekdays.forEach { d ->
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    Text(d, style = JKType.caption2, color = JK.tertiary)
                }
            }
        }
        cells.chunked(7).forEach { week ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                (0 until 7).forEach { i ->
                    val day = week.getOrNull(i)
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        if (day == null) {
                            if (i < week.size) Spacer(Modifier.height(30.dp))
                        } else {
                            val on = Day.same(day, selected)
                            val past = day < today
                            Column(
                                Modifier.clickable { onSelect(day) },
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Box(
                                    Modifier
                                        .size(30.dp)
                                        .background(if (on) JK.chrome else SolidColor(Color.Transparent), CircleShape),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "${day.dayOfMonth}",
                                        style = if (on) JKType.subheadline.bold() else JKType.subheadline,
                                        color = when {
                                            on -> Color.Black
                                            past -> JK.tertiary
                                            else -> JK.text
                                        },
                                    )
                                }
                                Box(
                                    Modifier
                                        .size(4.dp)
                                        .background(if (marked.contains(Day.string(day))) JK.secondary else Color.Transparent, CircleShape),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One booking or workout on the chosen day, as the list shows it. */
private data class MyCalendarDayEvent(
    val id: String,
    val sort: String,
    val time: String,
    val title: String,
    val detail: String,
    val tag: String,
    val booking: Booking? = null,
    val draft: CalendarEventDraft? = null,
)

private fun dayEvents(selected: LocalDate, bookings: List<Booking>?, workouts: List<WorkoutSummary>?): List<MyCalendarDayEvent> {
    val key = Day.string(selected)
    val now = Instant.now()
    val fromBookings = (bookings ?: emptyList()).filter { Day.string(it.start) == key }.map { b ->
        MyCalendarDayEvent(
            id = "b" + b.id,
            sort = Fmt.time(b.start),
            time = Fmt.time(b.start),
            title = b.title ?: b.kindLabel,
            detail = listOfNotNull(b.kindLabel, b.location, spaces(b)).joinToString(" · "),
            tag = if (b.isGroup) (if (b.joined == true) "Joined" else "Class") else "Session",
            booking = b,
            draft = if (b.end > now && (!b.isGroup || b.joined == true)) {
                CalendarEventDraft(
                    title = b.title ?: b.kindLabel, start = b.start, end = b.end, location = b.location,
                    notes = "JK Performance · ${b.kindLabel}",
                )
            } else {
                null
            },
        )
    }
    val fromWorkouts = (workouts ?: emptyList()).filter { it.date == key }.map { w ->
        val start = w.startsAt?.let { Day.at(selected, it) }
        MyCalendarDayEvent(
            id = "w" + w.id,
            sort = w.startsAt ?: "99",
            time = w.startsAt ?: "–",
            title = w.title,
            detail = if (w.completedAt != null) "Completed" else "${w.itemCount} exercises",
            tag = "Plan",
            draft = start?.takeIf { it > now }?.let {
                CalendarEventDraft(
                    title = w.title, start = it, end = it.plusSeconds(3600), location = w.location,
                    notes = "Training session in JK Performance",
                )
            },
        )
    }
    return (fromBookings + fromWorkouts).sortedBy { it.sort }
}

private fun spaces(b: Booking): String? {
    val cap = b.capacity
    if (!b.isGroup || cap == null) return null
    return "${b.attendeeCount ?: b.attendees?.size ?: 0}/$cap going"
}

/**
 * A day's event: time, then a card with the title, an add-to-calendar button,
 * the tag and the detail. Pressing and holding the card opens the iPhone's
 * context menu (add to calendar, join/leave a class, cancel a booking).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DayEventRow(
    event: MyCalendarDayEvent,
    onAddToCalendar: (CalendarEventDraft) -> Unit,
    onJoinOrLeave: (Booking, Boolean) -> Unit,
    onCancel: (Booking) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val booking = event.booking
    val draft = event.draft
    val hasMenu = draft != null || (booking != null && (booking.isGroup || booking.cancellable == true))
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Text(event.time, style = JKType.caption2, color = JK.tertiary, modifier = Modifier.width(36.dp))
        Box(Modifier.weight(1f)) {
            Column(
                Modifier
                    .combinedClickable(enabled = hasMenu, onClick = {}, onLongClick = { menu = true })
                    .jkCard(padding = 12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(event.title, style = JKType.subheadline.semibold(), color = JK.text, modifier = Modifier.weight(1f))
                    if (draft != null) {
                        SystemImage(
                            "calendar.badge.plus",
                            JKType.caption,
                            JK.secondary,
                            Modifier
                                .semantics { contentDescription = "Add ${event.title} to Calendar" }
                                .clickable { onAddToCalendar(draft) },
                        )
                    }
                    Text(
                        event.tag,
                        style = JKType.system(9, FontWeight.SemiBold),
                        color = JK.secondary,
                        modifier = Modifier.background(JK.cardRaised, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
                Text(event.detail, style = JKType.caption2, color = JK.tertiary)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (draft != null) {
                    MenuItem("Add to Calendar", "calendar.badge.plus") { menu = false; onAddToCalendar(draft) }
                }
                if (booking != null) {
                    if (booking.isGroup) {
                        if (booking.joined == true) {
                            MenuItem("Leave class", "xmark", destructive = true) { menu = false; onJoinOrLeave(booking, false) }
                        } else {
                            MenuItem("Join class", "plus") { menu = false; onJoinOrLeave(booking, true) }
                        }
                    } else if (booking.cancellable == true) {
                        MenuItem("Cancel booking", "xmark", destructive = true) { menu = false; onCancel(booking) }
                    }
                }
            }
        }
    }
}

/** A context-menu row: title, then the symbol at the trailing edge, as iOS lays them out. */
@Composable
private fun MenuItem(title: String, systemImage: String, destructive: Boolean = false, onClick: () -> Unit) {
    val color = if (destructive) DestructiveRed else JK.text
    DropdownMenuItem(
        text = { Text(title, style = JKType.body, color = color) },
        trailingIcon = { Icon(sfIcon(systemImage), contentDescription = null, tint = color, modifier = Modifier.size(20.dp)) },
        onClick = onClick,
    )
}

/** The hint under the list, with the add-to-calendar symbol inline as on the iPhone. */
@Composable
private fun HelpText() {
    val text = buildAnnotatedString {
        append("Tap ")
        appendInlineContent("icon", "[calendar]")
        append(
            " to put a session in your calendar. Press and hold a session to cancel it, or a class to join or leave. " +
                "Cancelling 24 h or more ahead refunds the credit.",
        )
    }
    val inline = mapOf(
        "icon" to InlineTextContent(Placeholder(1.2.em, 1.em, PlaceholderVerticalAlign.TextCenter)) {
            Icon(sfIcon("calendar.badge.plus"), contentDescription = null, tint = JK.tertiary, modifier = Modifier.fillMaxSize())
        },
    )
    Text(text, inlineContent = inline, style = JKType.caption2, color = JK.tertiary)
}

/** `RoundedRectangle(cornerRadius:).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [d]))`. */
private fun Modifier.dashedBorder(color: Color, radius: Dp, dash: Dp): Modifier = drawBehind {
    val width = 1.dp.toPx()
    val inset = width / 2
    drawRoundRect(
        color = color,
        topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
        size = androidx.compose.ui.geometry.Size(size.width - width, size.height - width),
        cornerRadius = CornerRadius(radius.toPx() - inset),
        style = Stroke(width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), dash.toPx()))),
    )
}

// MARK: - Book a session

private enum class BookSessionKind {
    inperson, video;

    val label: String get() = if (this == inperson) "1:1 · in person" else "Video call"
}

/**
 * Open slots from /api/slots, booked with POST /api/bookings. A coach passes
 * `client` to book on that client's behalf.
 */
@Composable
fun BookSessionView(client: PersonRef? = null, initialDay: LocalDate = LocalDate.now()) {
    val dismiss = LocalDismiss.current
    var day by rememberSaveable { mutableStateOf(Day.start(initialDay)) }
    var kind by rememberSaveable { mutableStateOf(BookSessionKind.inperson) }
    var slots by remember { mutableStateOf<List<Slot>?>(null) }
    var chosen by remember { mutableStateOf<Slot?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var booking by remember { mutableStateOf(false) }
    var bookError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val membership = AppSession.me?.membership

    suspend fun loadSlots() {
        chosen = null
        slots = null
        try {
            val d = Day.string(day)
            val reply: SlotsResponse = APIClient.get("/api/slots", mapOf("from" to d, "to" to d, "kind" to kind.name))
            slots = reply.slots.sortedBy { it.start }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    fun book() {
        val slot = chosen ?: return
        scope.launch {
            booking = true
            try {
                APIClient.send<Booking, BookingInput>("POST", "/api/bookings", BookingInput(slot.start, kind.name, client?.id))
                AppSession.refreshMe()
                dismiss()
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                bookError = e.readable
            } finally {
                booking = false
            }
        }
    }

    LaunchedEffect("${Day.string(day)}|${kind.name}") { loadSlots() }

    Column(Modifier.jkScreen()) {
        TopBar(title = if (client == null) "Book a session" else "Book a client")
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (client != null) {
                Row(Modifier.jkCard(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(client.displayInitials, size = 34.dp)
                    Text("Booking for ${client.name}", style = JKType.subheadline.semibold(), color = JK.text)
                }
            } else {
                Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Eyebrow(text = "Session credits")
                    Text(
                        buildAnnotatedString {
                            withStyle(JKType.largeTitle.semibold().toSpanStyle()) { append("${membership?.creditsLeft ?: 0}") }
                            withStyle(JKType.caption.toSpanStyle().merge(SpanStyle(color = JK.secondary))) {
                                append(" of ${membership?.creditsTotal ?: 0} left")
                            }
                        },
                        color = JK.text,
                    )
                    Text(creditLine(membership), style = JKType.caption2, color = JK.tertiary)
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                SystemImage(
                    "chevron.left", JKType.body, JK.secondary,
                    Modifier.clickable {
                        val today = LocalDate.now(Day.zone)
                        val back = Day.add(-7, day)
                        day = if (back < today) today else back
                    },
                )
                Text(
                    "Week of ${Fmt.dayMonth(Day.weekStart(day))}",
                    style = JKType.caption,
                    color = JK.secondary,
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                SystemImage("chevron.right", JKType.body, JK.secondary, Modifier.clickable { day = Day.add(7, day) })
            }
            DayStrip(days = Day.week(day), selected = day, onSelect = { day = it })
            Segmented(options = BookSessionKind.entries, selection = kind, onSelectionChange = { kind = it }) { it.label }

            val loadError = error
            val loaded = slots
            when {
                loadError != null -> ErrorCard(loadError, retry = { loadSlots() })
                loaded != null -> {
                    val now = Instant.now()
                    val upcoming = loaded.filter { it.start > now }
                    if (upcoming.isEmpty()) {
                        EmptyCard(systemName = "clock", title = "No times this day", detail = "Try another day or session type.")
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            upcoming.chunked(3).forEach { row ->
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    row.forEach { slot ->
                                        SlotButton(slot, on = chosen?.start == slot.start, Modifier.weight(1f)) { chosen = slot }
                                    }
                                    repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                    }
                }
                else -> LoadingCard(text = "Finding times…")
            }

            Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row {
                    val pick = chosen
                    Text(
                        if (pick != null) "${Fmt.shortDay(pick.start)} · ${Fmt.time(pick.start)}–${Fmt.time(pick.end)}" else "Pick a time",
                        style = JKType.caption,
                        color = JK.text,
                        modifier = Modifier.weight(1f),
                    )
                    Text(pick?.location ?: kind.label, style = JKType.caption, color = JK.text)
                }
                HorizontalDivider(thickness = 0.5.dp, color = JK.stroke)
                Row {
                    Text("Uses 1 credit", style = JKType.caption, color = JK.tertiary, modifier = Modifier.weight(1f))
                    Text(kind.label, style = JKType.caption, color = JK.tertiary)
                }
            }

            bookError?.let { ErrorBanner(it) }
            ChromeButton(onClick = ::book, enabled = chosen != null && !booking) {
                if (booking) ProgressView(tint = Color.Black) else Text("Confirm booking")
            }
            Text(
                "Free cancellation up to 24h before",
                style = JKType.caption2,
                color = JK.tertiary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** A time in the slot grid: chrome when chosen, struck through on a dashed edge when taken. */
@Composable
private fun SlotButton(slot: Slot, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = rounded(10.dp)
    val ground: Brush = if (on) JK.chrome else SolidColor(JK.card)
    Box(
        modifier
            .background(ground, shape)
            .then(if (slot.open) Modifier.border(1.dp, JK.stroke, shape) else Modifier.dashedBorder(JK.stroke, 10.dp, dash = 3.dp))
            .clickable(enabled = slot.open, onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            Fmt.time(slot.start),
            style = JKType.subheadline.semibold().copy(textDecoration = if (slot.open) null else TextDecoration.LineThrough),
            color = when {
                on -> Color.Black
                slot.open -> JK.text
                else -> JK.tertiary
            },
        )
    }
}

private fun creditLine(m: com.jkperformance.app.net.Membership?): String {
    if (m == null || !m.isActive) return "No membership · choose a plan under Account"
    val reset = m.creditsResetOn?.let { " · resets ${Fmt.dayMonth(it)}" } ?: ""
    return "${m.displayName} plan$reset"
}
