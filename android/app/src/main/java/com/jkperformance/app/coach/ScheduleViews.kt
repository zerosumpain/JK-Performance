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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.*
import com.jkperformance.app.net.*
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// MARK: - Schedule (week grid)

/** The week-grid filter chips; `keeps` says whether a booking shows under it. */
private enum class ScheduleFilter(val label: String) {
    all("All"), inperson("1:1"), video("Video"), group("Group");

    fun keeps(b: Booking): Boolean = when (this) {
        all -> true
        inperson -> b.kind == "inperson"
        video -> b.kind == "video"
        group -> b.kind == "group"
    }
}

private val scheduleHours = (6..20).toList()
private val scheduleRowHeight = 34.dp

/**
 * The coach's week: a grid from 06:00 to 20:00 with each booking a block
 * coloured by its kind, filter chips with counts, and buttons to book a
 * client, create a class or edit weekly availability.
 */
@Composable
fun ScheduleView() {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    // Saveable, so coming back from a booking's detail keeps the week and filter.
    var anchor by rememberSaveable { mutableStateOf(LocalDate.now(Day.zone)) }
    var filter by rememberSaveable { mutableStateOf(ScheduleFilter.all) }
    var bookings by remember { mutableStateOf<List<Booking>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var booking by remember { mutableStateOf(false) }
    var editingAvailability by remember { mutableStateOf(false) }
    val days = Day.week(anchor)

    suspend fun load() {
        try {
            bookings = APIClient.get<BookingsResponse>(
                "/api/bookings", mapOf("from" to Day.string(days[0]), "to" to Day.string(days[6])),
            ).bookings
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    // `.navigationDestination(item: $openBooking)`: a 1:1 opens the client, a class its roster.
    fun open(b: Booking) {
        val c = b.client
        if (c != null && !b.isGroup) nav.push { ClientDetailView(clientId = c.id, name = c.name) }
        else nav.push { ClassDetailView(booking = b) }
    }

    JKRefreshable(onRefresh = { load() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ScreenHeader(eyebrow = "Week of ${Fmt.dayMonth(days[0])}", title = "Schedule") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(JKShape.chip)
                            .clickable { editingAvailability = true }
                            .border(1.dp, JKColors.hairline, JKShape.chip),
                        contentAlignment = Alignment.Center,
                    ) { Glyph(IconKey.alarm, JKType.body, JKColors.text) }
                    Row(
                        Modifier
                            .clip(CircleShape)
                            .clickable { booking = true }
                            .background(SolidColor(JKColors.accentControl), CircleShape)
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconLabel("Book", icon = IconKey.add, style = JKType.caption.semibold(), color = JKColors.primaryLabel)
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.clickable { anchor = Day.add(-7, anchor) }.padding(6.dp)) { Glyph(IconKey.back, JKType.body, JKColors.textSecondary) }
                Spacer(Modifier.weight(1f))
                Text(
                    "This week", style = JKType.caption, color = JKColors.textSecondary,
                    modifier = Modifier.clickable { anchor = LocalDate.now(Day.zone) }.padding(6.dp),
                )
                Spacer(Modifier.weight(1f))
                Box(Modifier.clickable { anchor = Day.add(7, anchor) }.padding(6.dp)) { Glyph(IconKey.chevron, JKType.body, JKColors.textSecondary) }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ScheduleFilter.entries.forEach { f ->
                    val count = bookings.orEmpty().count(f::keeps)
                    Chip(label = "${f.label} · $count", selected = filter == f) { filter = f }
                }
            }
            val currentError = error
            val list = bookings
            when {
                currentError != null && list == null -> ErrorCard(currentError, retry = { load() })
                list == null -> LoadingCard()
                else -> {
                    if (currentError != null) ErrorBanner(currentError)
                    WeekGrid(days, list.filter(filter::keeps), onOpen = ::open)
                    ScheduleLegend()
                    Text(
                        "Tap a block for details. The clock button edits your weekly availability.",
                        style = JKType.caption, color = JKColors.textTertiary,
                    )
                }
            }
        }
    }

    LaunchedEffect(Day.string(days[0])) { load() }
    if (booking) {
        val today = LocalDate.now(Day.zone)
        Sheet(onDismiss = { booking = false; scope.launch { load() } }) {
            CoachBookSheet(day = if (anchor == today) today else days[0])
        }
    }
    if (editingAvailability) {
        Sheet(onDismiss = { editingAvailability = false }) { AvailabilitySheet() }
    }
}

@Composable
private fun WeekGrid(days: List<LocalDate>, shown: List<Booking>, onOpen: (Booking) -> Unit) {
    val today = LocalDate.now(Day.zone)
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.width(18.dp)) {
            Text(" ", style = JKType.caption, modifier = Modifier.heightIn(min = 24.dp))
            scheduleHours.forEach { h ->
                Text("$h", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.height(scheduleRowHeight))
            }
        }
        days.forEach { day ->
            val isToday = day == today
            Column(Modifier.weight(1f)) {
                Box(
                    Modifier
                        .padding(bottom = 4.dp)
                        .fillMaxWidth()
                        .heightIn(min = 20.dp)
                        .then(if (isToday) Modifier.background(SolidColor(JKColors.accentControl), JKShape.chip) else Modifier),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "${Fmt.weekday(day).take(2)} ${day.dayOfMonth}",
                        style = if (isToday) JKType.caption.semibold() else JKType.caption,
                        color = if (isToday) JKColors.primaryLabel else JKColors.textTertiary,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                }
                Box(Modifier.fillMaxWidth().height(scheduleRowHeight * scheduleHours.size).clipToBounds()) {
                    Column {
                        scheduleHours.forEach { _ ->
                            Box(Modifier.fillMaxWidth().height(scheduleRowHeight)) {
                                Box(Modifier.fillMaxWidth().height(1.dp).background(JKColors.hairline))
                            }
                        }
                    }
                    shown.filter { Day.same(it.start, day) }.forEach { b ->
                        key(b.id) { GridBlock(b, onClick = { onOpen(b) }) }
                    }
                }
            }
        }
    }
}

/** One booking on the grid: a tinted block with a solid leading edge, placed by its start and sized by its length. */
@Composable
private fun GridBlock(b: Booking, onClick: () -> Unit) {
    val start = hourOf(b.start)
    val length = maxOf(0.5, Duration.between(b.start, b.end).seconds / 3600.0)
    val tint = JKColors.slot(b.kind)
    val shape = JKShape.chip
    Box(
        Modifier
            .offset(y = scheduleRowHeight * (start - scheduleHours[0]).toFloat())
            .fillMaxWidth()
            .height(scheduleRowHeight * length.toFloat() - 2.dp)
            .clip(shape)
            .clickable(onClick = onClick)
            .background(tint.copy(alpha = 0.24f), shape)
            .border(1.dp, tint.copy(alpha = 0.55f), shape),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .width(2.dp)
                .background(tint, RoundedCornerShape(topStart = JKSpace.xs, bottomStart = JKSpace.xs)),
        )
        Text(
            gridLabel(b),
            style = JKType.caption.semibold(),
            color = JKColors.text,
            modifier = Modifier.fillMaxWidth().padding(3.dp),
        )
    }
}

/** The colour key for the kinds of session on the grid. */
@Composable
private fun ScheduleLegend() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        listOf("inperson" to "1:1 in person", "video" to "Video call", "group" to "Group class").forEach { (kind, text) ->
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).background(JKColors.slot(kind), JKShape.chip))
                Text(text, style = JKType.caption, color = JKColors.textSecondary)
            }
        }
    }
}

private fun hourOf(instant: Instant): Double {
    val t = instant.atZone(Day.zone)
    return t.hour + t.minute / 60.0
}

/** What fits in a narrow block: "Grp", the client's initials (with a phone for video), or the title. */
private fun gridLabel(b: Booking): String {
    if (b.isGroup) return "Grp"
    if (b.kind == "video") return (b.client?.displayInitials ?: "") + " ☎︎"
    return b.client?.displayInitials ?: (b.title ?: "1:1")
}

// MARK: - Book: class or client session

private enum class BookMode(val label: String) { client("Book a client"), group("Create a class") }

@Composable
private fun CoachBookSheet(day: LocalDate) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(BookMode.client) }
    var clients by remember { mutableStateOf<List<ClientSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var title by remember { mutableStateOf("Conditioning · Group") }
    var start by remember { mutableStateOf(Instant.now()) }
    var minutes by remember { mutableStateOf(60) }
    var capacity by remember { mutableStateOf(8) }
    var location by remember { mutableStateOf("Studio 2") }
    var saving by remember { mutableStateOf(false) }

    suspend fun loadClients() {
        try {
            clients = APIClient.get<ClientsResponse>("/api/coach/clients").clients
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun createClass() {
        saving = true
        try {
            APIClient.send<Booking, ClassInput>(
                "POST", "/api/classes",
                ClassInput(title = title, start = start, end = start.plusSeconds(minutes * 60L), capacity = capacity, location = location),
            )
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    LaunchedEffect(Unit) {
        // Default to 17:00 on the chosen day, or an hour from now if that has passed.
        start = Day.at(day, "17:00") ?: day.atStartOfDay(Day.zone).toInstant()
        if (start < Instant.now()) start = Instant.now().plusSeconds(3600)
        loadClients()
    }

    Column(Modifier.jkScreen()) {
        TopBar("Book", leading = { BarButton("Done") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Segmented(BookMode.entries, mode, { mode = it }) { it.label }
            if (mode == BookMode.client) {
                val list = clients
                val currentError = error
                when {
                    list != null -> Column(Modifier.jkSurface(padding = 2.dp)) {
                        list.forEach { c ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .navLink { BookSessionView(client = PersonRef(id = c.id, name = c.name, initials = c.initials), initialDay = day) }
                                    .padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(initials = c.displayInitials, size = 28.dp)
                                Text(c.name, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                                Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
                            }
                        }
                    }
                    currentError != null -> ErrorCard(currentError, retry = { loadClients() })
                    else -> LoadingCard()
                }
            } else {
                JKField("Title", title, { title = it })
                DateTimeRow("Starts", start, onChange = { start = it })
                StepperRow("$minutes minutes", minutes, 15..180, step = 15) { minutes = it }
                StepperRow("Capacity $capacity", capacity, 1..50) { capacity = it }
                JKField("Location", location, { location = it })
                error?.let { ErrorBanner(it) }
                PrimaryButton(onClick = { scope.launch { createClass() } }, enabled = !saving && title.isNotBlank()) {
                    if (saving) ProgressView() else Text("Create class")
                }
                Text("Clients see every class you create and join for free.", style = JKType.caption, color = JKColors.textTertiary)
            }
        }
    }
}



/**
 * `DatePicker(label, selection:, in: Date()...)` in its compact style: the
 * label, then the date and the time as tappable pills. The date opens
 * Material's calendar (past days disabled), the time its clock; a time
 * that lands in the past is moved to now, as the range does on iOS.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateTimeRow(label: String, value: Instant, onChange: (Instant) -> Unit) {
    var pickingDate by remember { mutableStateOf(false) }
    var pickingTime by remember { mutableStateOf(false) }
    val local = value.atZone(Day.zone)
    fun commit(date: LocalDate, time: LocalTime) {
        val chosen = date.atTime(time).atZone(Day.zone).toInstant()
        onChange(maxOf(chosen, Instant.now()))
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            PickerPill(Fmt.dayMonthYear(value)) { pickingDate = true }
            PickerPill(Fmt.time(value)) { pickingTime = true }
        }
    }

    if (pickingDate) {
        val today = LocalDate.now(Day.zone)
        // Material's date picker works in UTC midnights.
        val state = rememberDatePickerState(
            initialSelectedDateMillis = local.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                    !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(today)
                override fun isSelectableYear(year: Int): Boolean = year >= today.year
            },
        )
        DatePickerDialog(
            onDismissRequest = { pickingDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let {
                        commit(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate(), local.toLocalTime())
                    }
                    pickingDate = false
                }) { Text("Done", style = JKType.body.semibold(), color = JKColors.text) }
            },
            dismissButton = { TextButton(onClick = { pickingDate = false }) { Text("Cancel", style = JKType.body, color = JKColors.text) } },
        ) { DatePicker(state) }
    }
    if (pickingTime) {
        val state = rememberTimePickerState(initialHour = local.hour, initialMinute = local.minute, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickingTime = false },
            confirmButton = {
                TextButton(onClick = {
                    commit(local.toLocalDate(), LocalTime.of(state.hour, state.minute))
                    pickingTime = false
                }) { Text("Done", style = JKType.body.semibold(), color = JKColors.text) }
            },
            dismissButton = { TextButton(onClick = { pickingTime = false }) { Text("Cancel", style = JKType.body, color = JKColors.text) } },
            text = { TimePicker(state) },
            containerColor = JKColors.raised,
            shape = JKShape.card,
        )
    }
}

@Composable
private fun PickerPill(text: String, onClick: () -> Unit) {
    Text(
        text,
        style = JKType.body,
        color = JKColors.text,
        modifier = Modifier
            .clip(JKShape.chip)
            .clickable(onClick = onClick)
            .background(JKColors.raised, JKShape.chip)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/** SwiftUI's `Stepper(label, value:, in:, step:)`: the label, then a grey − | + pair that stops at the range's ends. */
@Composable
private fun StepperRow(label: String, value: Int, range: IntRange, step: Int = 1, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
        Row(
            Modifier.height(32.dp).clip(JKShape.chip).background(JKColors.raised, JKShape.chip),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val canDown = value - step >= range.first
            val canUp = value + step <= range.last
            Box(
                Modifier.width(47.dp).fillMaxHeight().clickable(enabled = canDown) { onChange(value - step) },
                contentAlignment = Alignment.Center,
            ) { Glyph(IconKey.remove, tint = if (canDown) JKColors.text else JKColors.textTertiary, contentDescription = "Decrement") }
            Box(Modifier.width(1.dp).height(18.dp).background(JKColors.textTertiary))
            Box(
                Modifier.width(47.dp).fillMaxHeight().clickable(enabled = canUp) { onChange(value + step) },
                contentAlignment = Alignment.Center,
            ) { Glyph(IconKey.add, tint = if (canUp) JKColors.text else JKColors.textTertiary, contentDescription = "Increment") }
        }
    }
}

// MARK: - Availability

private val weekdayNames = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
private val availabilityKinds = listOf("inperson", "video")

/**
 * Weekly availability rules (weekday, start, end, kind). The server cuts
 * them into bookable slots.
 */
@Composable
private fun AvailabilitySheet() {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var rules by remember { mutableStateOf<List<AvailabilityRule>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    fun update(rule: AvailabilityRule, change: (AvailabilityRule) -> AvailabilityRule) {
        rules = rules?.map { if (it.localId == rule.localId) change(it) else it }
    }

    suspend fun load() {
        try {
            rules = APIClient.get<RulesPayload>("/api/availability").rules.sortedWith(compareBy({ it.weekday }, { it.start }))
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun save() {
        val current = rules ?: return
        saving = true
        try {
            APIClient.send<RulesPayload, RulesPayload>("PUT", "/api/availability", RulesPayload(current))
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar("Availability", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            error?.let { ErrorBanner(it) }
            val list = rules
            if (list == null) {
                LoadingCard()
            } else {
                if (list.isEmpty()) {
                    EmptyCard(title = "No availability", detail = "Clients can't book until you add hours.")
                }
                list.forEach { rule ->
                    key(rule.localId) {
                        RuleCard(
                            rule = rule,
                            onChange = { changed -> update(rule) { changed } },
                            onDelete = { rules = rules?.filterNot { it.localId == rule.localId } },
                        )
                    }
                }
                SecondaryButton(onClick = {
                    val last = rules?.lastOrNull()
                    rules = rules.orEmpty() + AvailabilityRule(
                        weekday = minOf((last?.weekday ?: 0) + 1, 7),
                        start = last?.start ?: "07:00",
                        end = last?.end ?: "19:00",
                        kind = last?.kind ?: "inperson",
                        slotMinutes = last?.slotMinutes ?: 60,
                        location = last?.location,
                    )
                }) { IconLabel("Add hours", icon = IconKey.add, style = JKType.callout.semibold()) }
                PrimaryButton(onClick = { scope.launch { save() } }, enabled = !saving) {
                    if (saving) ProgressView() else Text("Save availability")
                }
                Text("Times are Europe/London. Existing bookings stay put.", style = JKType.caption, color = JKColors.textTertiary)
            }
        }
    }
}

@Composable
private fun RuleCard(rule: AvailabilityRule, onChange: (AvailabilityRule) -> Unit, onDelete: () -> Unit) {
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            WeekdayMenu(rule.weekday) { onChange(rule.copy(weekday = it)) }
            Spacer(Modifier.weight(1f))
            Box(Modifier.clickable(onClick = onDelete).padding(6.dp)) { Glyph(IconKey.delete, JKType.body, JKColors.textTertiary) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            JKField("Start", rule.start, { onChange(rule.copy(start = it)) }, Modifier.weight(1f), prompt = "07:00", keyboard = KeyboardType.Ascii)
            JKField("End", rule.end, { onChange(rule.copy(end = it)) }, Modifier.weight(1f), prompt = "19:00", keyboard = KeyboardType.Ascii)
            JKField(
                "Slot min", "${rule.slotMinutes}",
                { text -> onChange(rule.copy(slotMinutes = text.toIntOrNull() ?: rule.slotMinutes)) },
                Modifier.width(64.dp), keyboard = KeyboardType.Number,
            )
        }
        Segmented(availabilityKinds, rule.kind, { onChange(rule.copy(kind = it)) }) { if (it == "inperson") "In person" else "Video" }
        JKField(
            "Location", rule.location ?: "",
            { onChange(rule.copy(location = it.ifEmpty { null })) },
            prompt = if (rule.kind == "video") "Video call" else "Studio 2",
        )
    }
}

/** `Picker("Day", …).pickerStyle(.menu)`: the chosen weekday with up/down chevrons, opening a menu of the seven. */
@Composable
private fun WeekdayMenu(weekday: Int, onSelect: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.clickable { open = true }.padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(weekdayNames[(weekday - 1).coerceIn(0, 6)], style = JKType.body, color = JKColors.text)
            Glyph(IconKey.unfold, size = JKSize.iconSmall, tint = JKColors.text)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = JKColors.raised) {
            (1..7).forEach { d ->
                DropdownMenuItem(
                    text = { Text(weekdayNames[d - 1], style = JKType.body, color = JKColors.text) },
                    trailingIcon = if (d == weekday) ({ Glyph(IconKey.done, JKType.body, JKColors.text) }) else null,
                    onClick = { onSelect(d); open = false },
                )
            }
        }
    }
}
