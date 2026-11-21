@file:OptIn(ExperimentalMaterial3Api::class)

package com.jkperformance.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import com.jkperformance.app.design.Avatar
import com.jkperformance.app.design.BarButton
import com.jkperformance.app.design.CheckCircle
import com.jkperformance.app.design.Chip
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.DeltaBadge
import com.jkperformance.app.design.Dot
import com.jkperformance.app.design.EmptyCard
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.Fmt
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
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.Segmented
import com.jkperformance.app.design.Sheet
import com.jkperformance.app.design.SmallPillButton
import com.jkperformance.app.design.StatTile
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.bold
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.medium
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.design.symbol
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.AssignInput
import com.jkperformance.app.net.AssignResponse
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.Business
import com.jkperformance.app.net.ClientSummary
import com.jkperformance.app.net.ClientsResponse
import com.jkperformance.app.net.CoachToday
import com.jkperformance.app.net.FeedbackDue
import com.jkperformance.app.net.Guide
import com.jkperformance.app.net.GuidesResponse
import com.jkperformance.app.net.InstantSerializer
import com.jkperformance.app.net.OK
import com.jkperformance.app.net.Program
import com.jkperformance.app.net.ProgramInput
import com.jkperformance.app.net.ProgramWorkout
import com.jkperformance.app.net.ProgramsResponse
import com.jkperformance.app.net.WorkoutItemInput
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

// MARK: - Shared screen scaffolding

/**
 * A scrolling screen on the black ground with the Swift `.padding(16)` and the
 * VStack's spacing, and pull to refresh when `onRefresh` is given.
 */
@Composable
private fun ScrollScreen(
    spacing: Dp,
    modifier: Modifier = Modifier,
    onRefresh: (suspend () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val body = @Composable {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(spacing),
            content = content,
        )
    }
    if (onRefresh != null) JKRefreshable(onRefresh, modifier.jkScreen()) { body() } else Box(modifier.jkScreen()) { body() }
}

/** A pushed screen: the inline bar (back chevron, optional title and actions) over a [ScrollScreen]. */
@Composable
private fun PushedScreen(
    spacing: Dp,
    title: String = "",
    onRefresh: (suspend () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.jkScreen()) {
        TopBar(title)
        ScrollScreen(spacing, Modifier.weight(1f), onRefresh, content)
    }
}

/** A sheet's root: inline title, a Cancel or Done item, and the scrolling form. */
@Composable
private fun SheetScreen(
    title: String,
    spacing: Dp,
    leading: (@Composable () -> Unit)? = null,
    trailing: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.jkScreen()) {
        TopBar(title, leading = leading ?: {}, trailing = { trailing() })
        ScrollScreen(spacing, Modifier.weight(1f), content = content)
    }
}

/** Loads into `onValue`; a failure becomes the screen's error unless the load was merely cancelled. */
private suspend inline fun <T> loadInto(onError: (String?) -> Unit, onValue: (T) -> Unit, fetch: () -> T) {
    try {
        onValue(fetch())
        onError(null)
    } catch (e: Throwable) {
        if (!e.isCancellation) onError(e.readable)
    }
}

/** iOS's destructive red (systemRed, dark). */
private val Destructive = Color(0xFFFF453A)

/** The dark alert surface, as [com.jkperformance.app.design.ErrorAlert] uses. */
private val AlertSurface = Color(0.17f, 0.17f, 0.17f)

/**
 * `.confirmationDialog(title, titleVisibility: .visible)` with one destructive
 * action and Cancel, as a dark alert.
 */
@Composable
private fun ConfirmDialog(
    title: String,
    action: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    message: String? = null,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, style = JKType.body.semibold(), color = Destructive) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body, color = JK.text) } },
        title = { Text(title, style = JKType.headline, color = JK.text) },
        text = message?.let { { Text(it, style = JKType.footnote, color = JK.secondary) } },
        containerColor = AlertSurface,
        shape = rounded(14.dp),
    )
}

/** The magnifying glass and a borderless field in a card (Clients and Guides search). */
@Composable
private fun SearchField(query: String, onQueryChange: (String) -> Unit, prompt: String, autocorrect: Boolean = true) {
    val style = JKType.body.copy(color = JK.text)
    Row(
        Modifier.jkCard(padding = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SystemImage("magnifyingglass", JKType.body, JK.tertiary)
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(JK.text),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = autocorrect),
            modifier = Modifier.weight(1f),
            decorationBox = { field ->
                Box {
                    if (query.isEmpty()) Text(prompt, style = style, color = JK.tertiary)
                    field()
                }
            },
        )
    }
}

/** SwiftUI's `Stepper(label, value:, in:)`: the label, then iOS's − | + control. */
@Composable
private fun Stepper(
    label: String,
    value: Int,
    range: IntRange,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    style: TextStyle = JKType.caption,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = style, color = JK.text, modifier = Modifier.weight(1f))
        Row(
            Modifier.width(94.dp).height(32.dp).background(JK.cardRaised, rounded(8.dp)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepperHalf(Icons.Rounded.Remove, "Decrement", enabled = value > range.first) { onValueChange(value - 1) }
            Box(Modifier.width(1.dp).height(18.dp).background(JK.stroke))
            StepperHalf(Icons.Rounded.Add, "Increment", enabled = value < range.last) { onValueChange(value + 1) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.StepperHalf(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier.weight(1f).height(32.dp).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = if (enabled) JK.text else JK.tertiary, modifier = Modifier.size(20.dp))
    }
}

/** An iOS switch: white thumb, green when on (`.tint(.green)`), grey fill when off. */
@Composable
private fun IOSSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        // A thumb content keeps the thumb full size in both states, as on iOS.
        thumbContent = {},
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.White,
            checkedTrackColor = Color(0xFF30D158),
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = Color.White,
            uncheckedTrackColor = Color(0x52787880),
            uncheckedBorderColor = Color.Transparent,
        ),
    )
}

// MARK: - Today (coach tab root)

@Composable
fun CoachTodayView() {
    var today by remember { mutableStateOf<CoachToday?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAccount by remember { mutableStateOf(false) }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { today = it }) {
            APIClient.get<CoachToday>("/api/coach/today", mapOf("date" to Day.today))
        }
    }
    LaunchedEffect(Unit) { load() }

    ScrollScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach · ${Fmt.shortDay(Instant.now())}", title = "Today") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(30.dp)
                        .clickable { showAccount = true }
                        .semantics { contentDescription = "Account" },
                    contentAlignment = Alignment.Center,
                ) {
                    SystemImage("person.crop.circle", JKType.title3, JK.text)
                }
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(rounded(7.dp))
                        .border(1.dp, JK.secondary, rounded(7.dp))
                        .navLink { BusinessView() }
                        .semantics { contentDescription = "Business" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("JK", style = JKType.caption.bold(), color = JK.text)
                }
            }
        }
        Loadable(value = today, error = error, retry = load) { t -> TodayCards(today = t) }
    }

    if (showAccount) Sheet(onDismiss = { showAccount = false }) { CoachAccountView() }
}

/** Clients whose feedback for the week isn't published yet. */
@Composable
fun FeedbackDueView(due: FeedbackDue) {
    PushedScreen(spacing = 10.dp) {
        ScreenHeader(eyebrow = "Week of ${Fmt.dayMonth(due.week)}", title = "Feedback to write")
        due.clients.forEach { c ->
            Row(
                Modifier
                    .clip(rounded(JK.corner))
                    .navLink { ClientDetailView(clientId = c.id, name = c.name, initialTab = ClientDetailTab.feedback) }
                    .jkCard(padding = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(initials = c.displayInitials, size = 32.dp)
                Text(c.name, style = JKType.subheadline.semibold(), color = JK.text, modifier = Modifier.weight(1f))
                SystemImage("chevron.right", JKType.caption, JK.tertiary)
            }
        }
    }
}

/** A session on the Today list: times, the slot-colour bar, who, and Next / done / chevron. */
@Composable
fun SessionRow(session: Booking, isNext: Boolean) {
    val done = session.end < Instant.now()
    val who = session.client?.name ?: session.title ?: "Group"
    val ink = if (done) JK.tertiary else JK.text
    val shape = rounded(12.dp)

    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(38.dp)) {
            Text(Fmt.time(session.start), style = JKType.caption2.semibold(), color = ink)
            Text(Fmt.time(session.end), style = JKType.system(9), color = JK.tertiary)
        }
        Row(
            Modifier
                .weight(1f)
                .clip(shape)
                .navLink {
                    val c = session.client
                    if (c != null) ClientDetailView(clientId = c.id, name = c.name) else ClassDetailView(booking = session)
                }
                .background(JK.card, shape)
                .border(1.dp, if (isNext) JK.secondary else JK.stroke, shape)
                .padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(width = 3.dp, height = 28.dp)
                    .background(JK.slot(session.kind).copy(alpha = if (done) 0.4f else 1f), CircleShape),
            )
            Avatar(initials = session.client?.displayInitials ?: "G", size = 28.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                val count = session.attendeeCount ?: session.attendees?.size ?: 0
                Text(if (session.isGroup) "$who · $count clients" else who, style = JKType.subheadline.semibold(), color = ink)
                Text(
                    listOfNotNull(session.title, session.kindLabel).joinToString(" · "),
                    style = JKType.caption2,
                    color = JK.tertiary,
                )
            }
            when {
                isNext -> Text(
                    "Next",
                    style = JKType.system(9, FontWeight.SemiBold),
                    color = Color.Black,
                    modifier = Modifier.background(JK.text, CircleShape).padding(horizontal = 7.dp, vertical = 3.dp),
                )
                done -> SystemImage("checkmark", JKType.caption, ink)
                else -> SystemImage("chevron.right", JKType.caption, JK.tertiary)
            }
        }
    }
}

/** A group class: who's coming, and cancel. */
@Composable
fun ClassDetailView(booking: Booking) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }

    PushedScreen(spacing = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(booking.title ?: booking.kindLabel, style = JKType.title2.semibold(), color = JK.text)
            Text(
                "${Fmt.longDay(booking.start)} · ${Fmt.time(booking.start)}–${Fmt.time(booking.end)}",
                style = JKType.caption,
                color = JK.secondary,
            )
            booking.location?.let { Text(it, style = JKType.caption, color = JK.tertiary) }
        }
        Eyebrow(
            text = "Attendees",
            trailing = booking.capacity?.let { "${booking.attendeeCount ?: booking.attendees?.size ?: 0} of $it" },
        )
        val people = booking.attendees ?: listOfNotNull(booking.client)
        if (people.isEmpty()) {
            EmptyCard(systemName = "person.2", title = "Nobody yet")
        } else {
            Column(Modifier.jkCard(padding = 2.dp)) {
                people.forEach { p ->
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(initials = p.displayInitials, size = 28.dp)
                        Text(p.name, style = JKType.subheadline, color = JK.text)
                    }
                }
            }
        }
        error?.let { ErrorBanner(it) }
        if (booking.cancellable != false && booking.start > Instant.now()) {
            // GhostButtonStyle paints every label white, the destructive role included.
            GhostButton(if (booking.isGroup) "Cancel class" else "Cancel booking", onClick = { confirm = true })
        }
    }

    if (confirm) {
        ConfirmDialog(
            title = "Cancel this?",
            action = "Cancel it",
            onDismiss = { confirm = false },
            onConfirm = {
                scope.launch {
                    try {
                        APIClient.send<OK>("DELETE", "/api/bookings/${seg(booking.id)}")
                        dismiss()
                    } catch (e: Throwable) {
                        error = e.readable
                    }
                }
            },
        )
    }
}

// MARK: - Business

private enum class BusinessPeriod(val label: String) { week("Week"), month("Month") }

@Composable
fun BusinessView() {
    var period by remember { mutableStateOf(BusinessPeriod.month) }
    var data by remember { mutableStateOf<Business?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { data = it }) {
            APIClient.get<Business>("/api/coach/business", mapOf("period" to period.label.lowercase()))
        }
    }
    LaunchedEffect(period) { load() }

    PushedScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach · ${Fmt.month(Instant.now())}", title = "Business") {
            Segmented(
                options = BusinessPeriod.entries,
                selection = period,
                onSelectionChange = { period = it },
                modifier = Modifier.width(120.dp),
            ) { it.label }
        }
        Loadable(value = data, error = error, retry = load) { b ->
            MrrCard(b)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatTile(label = "Active", value = "${b.active}", modifier = Modifier.weight(1f))
                StatTile(label = "New", value = "${b.new}", modifier = Modifier.weight(1f))
                StatTile(label = "Churned", value = "${b.churned}", modifier = Modifier.weight(1f))
                StatTile(label = "Adherence", value = b.adherence?.let { "$it%" } ?: "–", modifier = Modifier.weight(1f))
            }
            val plans = b.plans
            if (!plans.isNullOrEmpty()) {
                Eyebrow(text = "Members by plan")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    plans.forEach { p -> StatTile(label = p.name, value = "${p.members}", modifier = Modifier.weight(1f)) }
                }
            }
            Eyebrow(text = "Needs attention", trailing = "Auto-flagged")
            if (b.attention.isEmpty()) {
                EmptyCard(systemName = "checkmark.seal", title = "Everyone's on track")
            } else {
                Column(Modifier.jkCard(padding = 2.dp)) {
                    b.attention.forEach { item ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .navLink { ClientDetailView(clientId = item.client.id, name = item.client.name) }
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(initials = item.client.displayInitials)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(item.client.name, style = JKType.subheadline.semibold(), color = JK.text)
                                Text(item.reason, style = JKType.caption2, color = JK.tertiary)
                            }
                            SystemImage(attentionIcon(item.kind), JKType.caption, JK.secondary)
                        }
                    }
                }
            }
        }
    }
}

private fun attentionIcon(kind: String): String = when (kind) {
    "payment" -> "creditcard"
    "checkin" -> "doc.text"
    else -> "exclamationmark.triangle"
}

@Composable
private fun MrrCard(b: Business) {
    val points = b.series.mapNotNull { s -> Day.date(s.date)?.let { it to s.pence / 100.0 } }
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Eyebrow(text = "Monthly recurring revenue") }
            b.mrrDeltaPct?.let { DeltaBadge(text = "${Fmt.delta(it, digits = 0)}%") }
        }
        Text(Fmt.pounds(b.mrrPence), style = JKType.largeTitle.semibold(), color = JK.text)
        if (points.size >= 2) {
            val values = points.map { it.second }
            val span = maxOf(values.max() - values.min(), 1.0)
            MrrChart(points, low = values.min() - span * 0.1, high = values.max() + span * 0.1)
        }
    }
}

/**
 * The Swift Charts MRR sparkline: an area from the bottom of the y domain up
 * to each value, white at 30% fading to clear, under a white line. Dates are
 * placed on a time scale; both axes are hidden.
 */
@Composable
private fun MrrChart(points: List<Pair<LocalDate, Double>>, low: Double, high: Double) {
    Canvas(Modifier.fillMaxWidth().height(90.dp)) {
        val firstDay = points.minOf { it.first.toEpochDay() }
        val lastDay = points.maxOf { it.first.toEpochDay() }
        val daySpan = maxOf(lastDay - firstDay, 1L).toFloat()
        fun x(d: LocalDate) = (d.toEpochDay() - firstDay) / daySpan * size.width
        fun y(v: Double) = size.height - ((v - low) / (high - low)).toFloat() * size.height
        val offsets = points.map { Offset(x(it.first), y(it.second)) }

        val line = Path().apply {
            moveTo(offsets.first().x, offsets.first().y)
            offsets.drop(1).forEach { lineTo(it.x, it.y) }
        }
        val area = Path().apply {
            addPath(line)
            lineTo(offsets.last().x, size.height)
            lineTo(offsets.first().x, size.height)
            close()
        }
        drawPath(area, Brush.verticalGradient(listOf(JK.text.copy(alpha = 0.3f), Color.Transparent), 0f, size.height))
        drawPath(line, JK.text, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

// MARK: - Clients (coach tab root)

@Composable
fun ClientsView() {
    var clients by remember { mutableStateOf<List<ClientSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { clients = it }) { APIClient.get<ClientsResponse>("/api/coach/clients").clients }
    }
    LaunchedEffect(Unit) { load() }

    ScrollScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach", title = "Clients") {
            Label(
                "Programs",
                systemImage = "square.stack",
                style = JKType.caption.semibold(),
                color = JK.text,
                modifier = Modifier
                    .clip(CircleShape)
                    .navLink { ProgramsView() }
                    .border(1.dp, JK.stroke, CircleShape)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
        SearchField(query, { query = it }, prompt = "Search clients", autocorrect = false)
        Loadable(value = clients, error = error, retry = load) { list ->
            val shown = list.filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }
            when {
                shown.isEmpty() -> EmptyCard(
                    systemName = "person.2",
                    title = if (list.isEmpty()) "No clients yet" else "No matches",
                    detail = if (list.isEmpty()) "Clients appear here when they sign up." else null,
                )
                query.isEmpty() -> {
                    // The server sends them most-in-need first; group them so the line between is clear.
                    val later = { c: ClientSummary -> c.demand?.kind == "quiet" || c.demand?.kind == "inactive" }
                    ClientGroup("Needs you", shown.filter { ClientText.needsYou(it) })
                    ClientGroup("Check in with", shown.filter(later))
                    ClientGroup("On track", shown.filter { !ClientText.needsYou(it) && !later(it) })
                }
                else -> ClientGroup(null, shown)
            }
        }
    }
}

@Composable
private fun ClientGroup(title: String?, list: List<ClientSummary>) {
    if (list.isEmpty()) return
    if (title != null) Eyebrow(text = title, trailing = "${list.size}")
    Column(Modifier.jkCard(padding = 2.dp)) {
        list.forEach { c ->
            ClientRow(
                client = c,
                modifier = Modifier.navLink {
                    ClientDetailView(clientId = c.id, name = c.name, initialTab = ClientText.tab(c))
                },
            )
        }
    }
}

@Composable
private fun ClientRow(client: ClientSummary, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Avatar(initials = client.displayInitials, size = 34.dp)
            ClientText.tint(client)?.let { tint ->
                // A 9pt dot ringed by a 2pt stroke in the card colour, straddling its edge as SwiftUI's stroke does.
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 1.dp, y = (-1).dp)
                        .size(11.dp)
                        .background(JK.card, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Dot(color = tint, size = 7.dp) }
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(client.name, style = JKType.subheadline.semibold(), color = JK.text)
            Text(
                ClientText.reason(client),
                style = JKType.caption2,
                color = if (client.demand?.kind == "urgent") JK.urgent else JK.tertiary,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
        }
        if ((client.unread ?: 0) > 0) SystemImage("bubble.left.fill", JKType.caption2, JK.secondary)
        SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

/** Human text for a client summary's plan, adherence and flags. */
object ClientText {
    private val waitingKinds = listOf("urgent", "message", "form", "checkin")

    /** Something of theirs is waiting on the coach. */
    fun needsYou(c: ClientSummary): Boolean = (c.demand?.kind ?: "") in waitingKinds

    fun tint(c: ClientSummary): Color? = when (c.demand?.kind) {
        "urgent" -> JK.urgent
        "message", "form", "checkin" -> JK.waiting
        else -> null
    }

    /** Why they're where they are: "Sent you a message · 2 hr. ago", else the usual plan line. */
    fun reason(c: ClientSummary): String {
        val d = c.demand
        val reason = d?.reason ?: return line(c)
        val at = d.at
        if (at != null && d.kind in waitingKinds) return "$reason · ${Fmt.relative(at)}"
        return reason
    }

    /** The tab that answers what they need (Swift `tab(for:)`). */
    fun tab(c: ClientSummary): ClientDetailTab = when (c.demand?.kind) {
        "urgent", "form", "checkin" -> ClientDetailTab.feedback
        else -> ClientDetailTab.plan
    }

    fun flag(f: String): String {
        if (f == "no-workout-yet") return "no workout yet"
        if (f == "checkin-overdue") return "check-in overdue"
        if (f.startsWith("no-workout-")) {
            f.removePrefix("no-workout-").dropLast(1).toIntOrNull()?.let { return "no workout in $it days" }
        }
        return f.replace("-", " ")
    }

    fun line(c: ClientSummary): String {
        val parts = mutableListOf(Fmt.planName(c.plan))
        val first = c.flags?.firstOrNull()
        when {
            first != null -> parts += flag(first)
            c.adherence != null -> parts += "adherence ${c.adherence}%"
            c.checkinDue == true -> parts += "check-in due"
        }
        return parts.joinToString(" · ")
    }
}

// MARK: - Programs

/** Swift `ProgramsView.Tab`. */
enum class ProgramsTab(val label: String) { programs("Programs"), autoflows("Autoflows"), forms("Forms") }

@Composable
fun ProgramsView(initialTab: ProgramsTab = ProgramsTab.programs) {
    var tab by remember { mutableStateOf(initialTab) }
    var programs by remember { mutableStateOf<List<Program>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<ProgramDraft?>(null) }
    var assigning by remember { mutableStateOf<Program?>(null) }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { programs = it }) { APIClient.get<ProgramsResponse>("/api/programs").programs }
    }
    LaunchedEffect(Unit) { load() }

    PushedScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Templates & automation", title = tab.label) {
            if (tab == ProgramsTab.programs) {
                Label(
                    "New",
                    systemImage = "plus",
                    style = JKType.caption.semibold(),
                    color = Color.Black,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable { editing = ProgramDraft() }
                        .background(JK.chrome, CircleShape)
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
        }
        Segmented(options = ProgramsTab.entries, selection = tab, onSelectionChange = { tab = it }) { it.label }
        when (tab) {
            ProgramsTab.programs -> Loadable(value = programs, error = error, retry = load) { list ->
                if (list.isEmpty()) {
                    EmptyCard(
                        systemName = "square.stack",
                        title = "No programs yet",
                        detail = "Build a template once, then assign it to any client with a start date.",
                    )
                }
                list.forEach { p ->
                    ProgramRow(p, onEdit = { editing = ProgramDraft(p) }, onAssign = { assigning = p })
                }
            }
            ProgramsTab.autoflows -> AutoflowsTab()
            ProgramsTab.forms -> FormsTab()
        }
    }

    editing?.let { draft ->
        Sheet(onDismiss = { editing = null }) { ProgramEditorSheet(draft = draft, onSaved = load) }
    }
    assigning?.let { program ->
        Sheet(onDismiss = { assigning = null }) { AssignProgramSheet(program = program, onDone = load) }
    }
}

@Composable
private fun ProgramRow(p: Program, onEdit: () -> Unit, onAssign: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.clip(rounded(JK.corner)).clickable(onClick = onEdit).jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(52.dp).background(JK.cardRaised, rounded(10.dp)), contentAlignment = Alignment.Center) {
            SystemImage("chart.xyaxis.line", JKType.body, JK.tertiary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(p.name, style = JKType.subheadline.semibold(), color = JK.text)
            Text(
                "${p.daysPerWeek} days / week · ${p.weeks} weeks · ${p.workouts.size} workouts",
                style = JKType.caption2,
                color = JK.tertiary,
            )
            Text(
                p.clientCount?.let { if (it == 1) "1 client" else "$it clients" } ?: "Template",
                style = JKType.system(10, FontWeight.Medium),
                color = JK.secondary,
                modifier = Modifier.background(JK.cardRaised, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
            )
        }
        Box {
            Box(Modifier.size(30.dp).clickable { menu = true }, contentAlignment = Alignment.Center) {
                SystemImage("ellipsis", JKType.body, JK.secondary)
            }
            DropdownMenu(
                expanded = menu,
                onDismissRequest = { menu = false },
                containerColor = AlertSurface,
                shape = rounded(12.dp),
            ) {
                MenuItem("Edit", "pencil") { menu = false; onEdit() }
                MenuItem("Assign to client", "person.badge.plus") { menu = false; onAssign() }
            }
        }
    }
}

/** One row of a SwiftUI `Menu`: the title, its symbol trailing as iOS lays it out. */
@Composable
private fun MenuItem(title: String, systemImage: String, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(title, style = JKType.body, color = JK.text) },
        trailingIcon = { SystemImage(systemImage, JKType.body, JK.text) },
        onClick = onClick,
    )
}

/** A program being made or edited, as the editor sheet holds it. */
data class ProgramDraft(
    val programId: String? = null,
    val name: String = "",
    val detail: String = "",
    val daysPerWeek: Int = 3,
    val weeks: Int = 4,
    val workouts: List<ProgramWorkout> = emptyList(),
    val id: UUID = UUID.randomUUID(),
) {
    constructor(p: Program) : this(
        programId = p.id, name = p.name, detail = p.detail, daysPerWeek = p.daysPerWeek, weeks = p.weeks, workouts = p.workouts,
    )

    val input: ProgramInput
        get() = ProgramInput(
            name = name, detail = detail, daysPerWeek = daysPerWeek, weeks = weeks,
            workouts = workouts.sortedBy { it.dayOffset },
        )
}

@Composable
fun ProgramEditorSheet(draft: ProgramDraft, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var d by remember(draft.id) { mutableStateOf(draft) }
    var picking by remember { mutableStateOf<UUID?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun updateWorkout(localId: UUID, change: (ProgramWorkout) -> ProgramWorkout) {
        d = d.copy(workouts = d.workouts.map { if (it.localId == localId) change(it) else it })
    }

    suspend fun save() {
        saving = true
        try {
            val id = d.programId
            if (id != null) APIClient.send<Program, ProgramInput>("PUT", "/api/programs/${seg(id)}", d.input)
            else APIClient.send<Program, ProgramInput>("POST", "/api/programs", d.input)
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    suspend fun delete() {
        val id = d.programId ?: return
        try {
            APIClient.send<OK>("DELETE", "/api/programs/${seg(id)}")
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    SheetScreen(
        title = if (d.programId == null) "New program" else "Edit program",
        spacing = 12.dp,
        leading = { BarButton("Cancel") { dismiss() } },
    ) {
        JKField(label = "Name", text = d.name, onTextChange = { d = d.copy(name = it) }, prompt = "12-Week Strength Block")
        JKField(label = "Description", text = d.detail, onTextChange = { d = d.copy(detail = it) }, prompt = "4 days / week, barbell focus")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Stepper("${d.daysPerWeek} days / week", d.daysPerWeek, 1..7, { d = d.copy(daysPerWeek = it) }, Modifier.weight(1f))
            Stepper("${d.weeks} wk", d.weeks, 1..52, { d = d.copy(weeks = it) }, Modifier.weight(1f))
        }

        Eyebrow(text = "Workouts", trailing = "Day offset from the start date")
        d.workouts.forEach { w ->
            Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    JKField(
                        label = "Title",
                        text = w.title,
                        onTextChange = { t -> updateWorkout(w.localId) { it.copy(title = t) } },
                        prompt = "Lower Body Strength",
                        modifier = Modifier.weight(1f),
                    )
                    Stepper(
                        "Day ${w.dayOffset + 1}",
                        w.dayOffset,
                        0..(d.weeks * 7 - 1),
                        { v -> updateWorkout(w.localId) { it.copy(dayOffset = v) } },
                        Modifier.width(150.dp),
                    )
                }
                ItemsEditor(items = w.items, onItemsChange = { items -> updateWorkout(w.localId) { it.copy(items = items) } })
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SmallPillButton(onClick = { picking = w.localId }) {
                        Label("Add exercise", systemImage = "plus", style = JKType.caption2.semibold(), color = JK.secondary)
                    }
                    Spacer(Modifier.weight(1f))
                    SmallPillButton(onClick = { d = d.copy(workouts = d.workouts.filter { it.localId != w.localId }) }) {
                        Label("Remove workout", systemImage = "trash", style = JKType.caption2.semibold(), color = JK.secondary)
                    }
                }
            }
        }
        GhostButton(onClick = {
            val next = (d.workouts.maxOfOrNull { it.dayOffset } ?: -1) + 1
            d = d.copy(
                workouts = d.workouts + ProgramWorkout(
                    dayOffset = minOf(next, d.weeks * 7 - 1),
                    title = "Workout ${d.workouts.size + 1}",
                    items = emptyList(),
                ),
            )
        }) {
            Label("Add workout", systemImage = "plus", style = JKType.subheadline.semibold())
        }

        error?.let { ErrorBanner(it) }
        ChromeButton(onClick = { scope.launch { save() } }, enabled = !saving && d.name.isNotBlank()) {
            if (saving) ProgressView(tint = Color.Black) else Text(if (d.programId == null) "Create program" else "Save program")
        }
        if (d.programId != null) {
            GhostButton("Delete program", onClick = { confirmDelete = true })
        }
    }

    picking?.let { target ->
        Sheet(onDismiss = { picking = null }) {
            ExercisePickerSheet { exercise ->
                updateWorkout(target) {
                    it.copy(items = it.items + WorkoutItemInput(exerciseId = exercise.id, exerciseName = exercise.name))
                }
            }
        }
    }
    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this program?",
            action = "Delete",
            message = "Workouts already assigned to clients stay.",
            onDismiss = { confirmDelete = false },
            onConfirm = { scope.launch { delete() } },
        )
    }
}

/**
 * Rows of exercise prescriptions: sets, reps, load, RPE, note; reorder and
 * delete. Shared by the program editor and the client plan editor. Swift's
 * `@Binding var items` is the list plus `onItemsChange`; the rows go straight
 * into the caller's column, as they do into the Swift VStack.
 */
@Composable
fun ItemsEditor(items: List<WorkoutItemInput>, onItemsChange: (List<WorkoutItemInput>) -> Unit) {
    if (items.isEmpty()) {
        Text("No exercises yet.", style = JKType.caption2, color = JK.tertiary)
    }
    fun update(index: Int, change: (WorkoutItemInput) -> WorkoutItemInput) {
        onItemsChange(items.toMutableList().also { it[index] = change(it[index]) })
    }
    fun move(index: Int, offset: Int) {
        val target = index + offset
        if (target !in items.indices) return
        onItemsChange(items.toMutableList().also { it[index] = items[target]; it[target] = items[index] })
    }

    items.forEachIndexed { index, item ->
        androidx.compose.runtime.key(item.localId) {
            Column(
                Modifier.fillMaxWidth().background(JK.cardRaised.copy(alpha = 0.5f), rounded(10.dp)).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.exerciseName.ifEmpty { item.exerciseId },
                        style = JKType.subheadline.semibold(),
                        color = JK.text,
                    )
                    if (item.id == null) {
                        Text(
                            "New",
                            style = JKType.system(9, FontWeight.SemiBold),
                            color = Color.Black,
                            modifier = Modifier.background(JK.text, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    ItemAction("arrow.up", "Move up", enabled = index > 0) { move(index, -1) }
                    ItemAction("arrow.down", "Move down", enabled = index < items.size - 1) { move(index, 1) }
                    ItemAction("trash", "Delete", enabled = true) {
                        onItemsChange(items.filterIndexed { i, _ -> i != index })
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SetsField(item.sets, { n -> update(index) { it.copy(sets = n) } }, Modifier.width(52.dp))
                    JKField(
                        label = "Reps", text = item.reps, onTextChange = { t -> update(index) { it.copy(reps = t) } },
                        prompt = "10", modifier = Modifier.weight(1f),
                    )
                    JKField(
                        label = "Load", text = item.load, onTextChange = { t -> update(index) { it.copy(load = t) } },
                        prompt = "60 kg", modifier = Modifier.weight(1f),
                    )
                    JKField(
                        label = "RPE", text = item.rpe ?: "",
                        onTextChange = { t -> update(index) { it.copy(rpe = t.ifEmpty { null }) } },
                        prompt = "7–8", modifier = Modifier.width(56.dp),
                    )
                }
                JKField(
                    label = "Note", text = item.note ?: "",
                    onTextChange = { t -> update(index) { it.copy(note = t.ifEmpty { null }) } },
                    prompt = "Cue for the client",
                )
            }
        }
    }
}

/**
 * The Sets field: a whole number. Text that isn't one (an emptied field while
 * retyping) keeps the last good count, as the Swift binding does, but is left
 * on screen so the coach can type over it.
 */
@Composable
private fun SetsField(sets: Int, onSetsChange: (Int) -> Unit, modifier: Modifier) {
    var text by remember(sets) { mutableStateOf("$sets") }
    JKField(
        label = "Sets",
        text = text,
        onTextChange = { t -> text = t; t.toIntOrNull()?.let(onSetsChange) },
        keyboard = KeyboardType.Number,
        modifier = modifier,
    )
}

/** A plain caption-size symbol button in an item's header; dims when it can't act. */
@Composable
private fun ItemAction(systemName: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clickable(enabled = enabled, onClick = onClick)
            .padding(4.dp)
            .semantics { contentDescription = description },
    ) {
        SystemImage(systemName, JKType.caption, if (enabled) JK.secondary else JK.tertiary.copy(alpha = 0.5f))
    }
}

@Composable
fun AssignProgramSheet(program: Program, onDone: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var clients by remember { mutableStateOf<List<ClientSummary>?>(null) }
    var clientId by remember { mutableStateOf<String?>(null) }
    var start by remember { mutableStateOf(Day.add(1, to = LocalDate.now(Day.zone))) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var created by remember { mutableStateOf<Int?>(null) }
    var pickingDate by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            clients = APIClient.get<ClientsResponse>("/api/coach/clients").clients
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun assign() {
        if (created != null) {
            onDone()
            dismiss()
            return
        }
        val id = clientId ?: return
        saving = true
        try {
            val reply = APIClient.send<AssignResponse, AssignInput>(
                "POST", "/api/programs/${seg(program.id)}/assign", AssignInput(clientId = id, startDate = Day.string(start)),
            )
            created = reply.created
            error = null
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    SheetScreen(title = "Assign program", spacing = 12.dp, leading = { BarButton("Cancel") { dismiss() } }) {
        Text(program.name, style = JKType.title3.semibold(), color = JK.text)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Start date", style = JKType.subheadline, color = JK.text, modifier = Modifier.weight(1f))
            // iOS's compact date picker: the date in a grey capsule that opens the calendar.
            Text(
                Fmt.dayMonthYear(start),
                style = JKType.subheadline,
                color = JK.text,
                modifier = Modifier
                    .clip(rounded(8.dp))
                    .clickable { pickingDate = true }
                    .background(JK.cardRaised, rounded(8.dp))
                    .padding(horizontal = 11.dp, vertical = 6.dp),
            )
        }
        Eyebrow(text = "Client")
        val list = clients
        if (list != null) {
            Column(Modifier.jkCard(padding = 2.dp)) {
                list.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable { clientId = c.id }.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(initials = c.displayInitials, size = 28.dp)
                        Text(c.name, style = JKType.subheadline, color = JK.text, modifier = Modifier.weight(1f))
                        CheckCircle(on = clientId == c.id)
                    }
                }
            }
        } else {
            LoadingCard()
        }
        created?.let {
            Label(
                "Created $it draft workouts. Publish them from the client's Plan tab.",
                systemImage = "checkmark.circle",
                style = JKType.caption,
                color = JK.secondary,
            )
        }
        error?.let { ErrorBanner(it) }
        ChromeButton(
            onClick = { scope.launch { assign() } },
            enabled = !saving && (created != null || clientId != null),
        ) {
            if (saving) ProgressView(tint = Color.Black) else Text(if (created == null) "Assign" else "Done")
        }
    }

    if (pickingDate) StartDateDialog(start, onPick = { start = it }, onDismiss = { pickingDate = false })
}

/** The calendar behind the compact date picker, dark. Material's picker works in UTC midnights. */
@Composable
private fun StartDateDialog(initial: LocalDate, onPick: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    val colors = DatePickerDefaults.colors(containerColor = AlertSurface)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            }) { Text("Done", style = JKType.body.semibold(), color = JK.text) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body, color = JK.text) } },
        colors = colors,
    ) {
        DatePicker(state = state, colors = colors, title = null, headline = null, showModeToggle = false)
    }
}

// MARK: - Hints & guides (coach tab root)

@Composable
fun GuidesView() {
    val session = AppSession
    val scope = rememberCoroutineScope()
    var switchError by remember { mutableStateOf<String?>(null) }
    var showDesk by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("All") }
    var guides by remember { mutableStateOf<GuidesResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf<Guide?>(null) }

    val tags = listOf("All") + ((guides?.tips ?: emptyList()).flatMap { it.tags } + (guides?.featured?.tags ?: emptyList())).distinct()

    fun matches(g: Guide): Boolean =
        (filter == "All" || filter in g.tags) &&
            (query.isEmpty() || g.title.contains(query, ignoreCase = true) || g.body.contains(query, ignoreCase = true))

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { guides = it }) { APIClient.get<GuidesResponse>("/api/guides") }
    }
    LaunchedEffect(Unit) { load() }

    ScrollScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach library", title = "Hints & guides")
        SearchField(query, { query = it }, prompt = "Search guides and cues")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            tags.forEach { f -> Chip(label = f, selected = filter == f) { filter = f } }
        }
        Loadable(value = guides, error = error, retry = load) { g ->
            g.featured?.takeIf(::matches)?.let { featured ->
                FeaturedCard(featured, Modifier.clickable { open = featured })
            }
            Eyebrow(text = "Quick tips")
            val tips = g.tips.filter(::matches)
            if (tips.isEmpty()) {
                Text("Nothing matches.", style = JKType.caption, color = JK.tertiary)
            }
            tips.forEach { tip ->
                Row(
                    Modifier.clip(rounded(JK.corner)).clickable { open = tip }.jkCard(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    IconTile(systemName = symbol(tip.icon ?: "lightbulb", fallback = "lightbulb"), size = 32.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(tip.title, style = JKType.subheadline.semibold(), color = JK.text)
                        Text(tip.body, style = JKType.caption2, color = JK.tertiary, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
            }
        }
        ChromeButton(onClick = { showDesk = true }, modifier = Modifier.padding(top = 20.dp)) {
            Label("Coach desk on the web", systemImage = "desktopcomputer", style = JKType.subheadline.semibold(), color = Color.Black)
        }
        Text("Write weekly feedback and plans from a computer.", style = JKType.caption2, color = JK.tertiary)
        GhostButton(onClick = {
            scope.launch {
                try { session.switchToDemoClient() } catch (e: Throwable) { switchError = e.readable }
            }
        }) {
            Label("View the app as a client (demo: Sam Carter)", systemImage = "arrow.left.arrow.right", style = JKType.subheadline.semibold())
        }
        switchError?.let { ErrorBanner(it) }
        GhostButton("Sign out", onClick = { scope.launch { session.signOut() } })
    }

    if (showDesk) Sheet(onDismiss = { showDesk = false }) { WebDeskSheet() }
    open?.let { g -> GuideSheet(g, onDismiss = { open = null }) }
}

/** A guide read in full: SwiftUI's medium/large detent sheet, as a bottom sheet. */
@Composable
private fun GuideSheet(g: Guide, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = JK.bg, contentColor = JK.text) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Eyebrow(text = (listOfNotNull(g.minutes?.let { "$it min" }) + g.tags).joinToString(" · "))
            Text(g.title, style = JKType.title2.semibold(), color = JK.text)
            Text(g.body, style = JKType.body, color = JK.secondary)
        }
    }
}

@Composable
private fun FeaturedCard(g: Guide, modifier: Modifier = Modifier) {
    val shape = rounded(JK.corner)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .then(modifier)
            .background(JK.card)
            .border(1.dp, JK.stroke, shape),
    ) {
        Box(Modifier.fillMaxWidth().height(110.dp).background(JK.cardRaised)) {
            SystemImage("book.pages", JKType.largeTitle, JK.tertiary, Modifier.align(Alignment.Center))
            g.tags.firstOrNull()?.let { first ->
                Text(
                    first,
                    style = JKType.system(9, FontWeight.SemiBold),
                    color = JK.secondary,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .background(JK.card, CircleShape)
                        .padding(horizontal = 7.dp, vertical = 3.dp),
                )
            }
        }
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Eyebrow(text = "Featured guide" + (g.minutes?.let { " · $it min" } ?: ""))
            Text(g.title, style = JKType.headline, color = JK.text, textAlign = TextAlign.Start)
            Text(g.body, style = JKType.caption, color = JK.tertiary, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

// MARK: - Coach account

/**
 * The coach's own account: who is signed in, privacy, and signing out (to
 * switch to another account, such as the demo client with "I have a code").
 */
@Composable
fun CoachAccountView() {
    val session = AppSession
    val dismiss = LocalDismiss.current
    val uri = LocalUriHandler.current
    var confirmSignOut by remember { mutableStateOf(false) }

    SheetScreen(title = "Account", spacing = 14.dp, trailing = { BarButton("Done") { dismiss() } }) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(initials = initialsOf(session.me?.name ?: "Coach"), size = 48.dp)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(session.me?.name ?: "Coach", style = JKType.title2.semibold(), color = JK.text)
                Text(session.me?.email ?: "Coach account", style = JKType.caption, color = JK.tertiary)
            }
        }
        Text("Signed in as the coach. Clients who sign up are assigned to you.", style = JKType.footnote, color = JK.secondary)
        Row(
            Modifier.clip(rounded(JK.corner)).clickable { uri.openUri(APIClient.privacyURL) }.jkCard(padding = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(systemName = "hand.raised")
            Text("Privacy policy", style = JKType.subheadline.semibold(), color = JK.text, modifier = Modifier.weight(1f))
            SystemImage("arrow.up.right", JKType.caption, JK.tertiary)
        }
        CoachNotificationsRow()
        CalendarSubscribeCard()
        WebSessionsRow()
        ChromeButton("Sign out", onClick = { confirmSignOut = true }, modifier = Modifier.padding(top = 12.dp))
        Text("To see the client side, use Guides › View the app as a client.", style = JKType.caption2, color = JK.tertiary)
    }

    if (confirmSignOut) {
        ConfirmDialog(
            title = "Sign out?",
            action = "Sign out",
            onDismiss = { confirmSignOut = false },
            onConfirm = {
                dismiss()
                // The sheet (and its scope) goes with the dismiss; the sign-out must outlive it, as a Swift Task does.
                ProcessLifecycleOwner.get().lifecycleScope.launch { session.signOut() }
            },
        )
    }
}

private fun initialsOf(name: String): String =
    name.split(" ").filter { it.isNotEmpty() }.take(2).map { it.first() }.joinToString("").uppercase()

@Serializable
private data class WebSessions(
    val count: Int,
    @Serializable(with = InstantSerializer::class) val latestSignIn: Instant? = null,
)

@Serializable
private data class Ended(val ended: Int)

/** Browsers signed in to the coach desk, and a button to sign them all out. */
@Composable
private fun WebSessionsRow() {
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<WebSessions?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        sessions = runCatching { APIClient.get<WebSessions>("/api/auth/web-sessions") }.getOrNull()
    }

    val detail = sessions.let { s ->
        when {
            s == null -> " "
            s.count == 0 -> "Not signed in on any browser"
            else -> (if (s.count == 1) "1 browser" else "${s.count} browsers") +
                (s.latestSignIn?.let { " · last sign-in ${Fmt.relative(it)}" } ?: "")
        }
    }

    Row(
        Modifier.jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(systemName = "desktopcomputer")
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Coach desk on the web", style = JKType.subheadline.semibold(), color = JK.text)
            Text(detail, style = JKType.caption2, color = JK.tertiary)
        }
        if ((sessions?.count ?: 0) > 0) {
            Text(
                "Sign out all",
                style = JKType.caption.semibold(),
                color = if (busy) JK.tertiary else JK.text,
                modifier = Modifier.clickable(enabled = !busy) {
                    scope.launch {
                        busy = true
                        try {
                            APIClient.send<Ended>("DELETE", "/api/auth/web-sessions")
                            sessions = WebSessions(count = 0)
                        } catch (_: Throwable) {
                            // As on iOS: the row keeps its count, and the coach can try again.
                        } finally {
                            busy = false
                        }
                    }
                },
            )
        }
    }
}

/** Push for the coach: client messages, check-ins, bookings made or cancelled. */
@Composable
private fun CoachNotificationsRow() {
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    // Mirrors Reminders.enabled so the switch moves as soon as the change lands.
    var on by remember { mutableStateOf(Reminders.enabled) }

    Column(Modifier.jkCard(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconTile(systemName = "bell")
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Notifications", style = JKType.subheadline.semibold(), color = JK.text)
                Text("Client messages, check-ins and bookings", style = JKType.caption2, color = JK.tertiary)
            }
            IOSSwitch(checked = on, onCheckedChange = { wanted ->
                scope.launch {
                    if (wanted) {
                        error = if (Reminders.enable(checkIn = false)) null
                        else "Notifications are off for JK Performance. Turn them on in Settings › Notifications."
                    } else {
                        Reminders.disable()
                    }
                    on = Reminders.enabled
                }
            })
        }
        error?.let { Text(it, style = JKType.caption2, color = JK.secondary) }
    }
}
