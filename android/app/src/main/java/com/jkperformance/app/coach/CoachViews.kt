@file:OptIn(ExperimentalMaterial3Api::class)

package com.jkperformance.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
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
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.AssignInput
import com.jkperformance.app.net.AssignResponse
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.Business
import com.jkperformance.app.net.ClientSummary
import com.jkperformance.app.net.ClientsResponse
import com.jkperformance.app.net.NeedsYou
import com.jkperformance.app.net.CoachSettings
import com.jkperformance.app.net.CoachSettingsPatch
import com.jkperformance.app.net.RhythmSetting
import com.jkperformance.app.net.ReplyExpectation
import com.jkperformance.app.net.Media
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
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// MARK: - Shared screen scaffolding

/**
 * A scrolling screen on the black ground with the Swift `.padding(16)` and the
 * VStack's spacing, and pull to refresh when `onRefresh` is given.
 */
@Composable
internal fun ScrollScreen(
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
internal fun PushedScreen(
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
            TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, style = JKType.body.semibold(), color = JKColors.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body, color = JKColors.text) } },
        title = { Text(title, style = JKType.headline, color = JKColors.text) },
        text = message?.let { { Text(it, style = JKType.caption, color = JKColors.textSecondary) } },
        containerColor = JKColors.raised,
        shape = JKShape.card,
    )
}

/** The magnifying glass and a borderless field in a card (Clients and Guides search). */
@Composable
private fun SearchField(query: String, onQueryChange: (String) -> Unit, prompt: String, autocorrect: Boolean = true) {
    val style = JKType.body.copy(color = JKColors.text)
    Row(
        Modifier.jkSurface(padding = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.search, JKType.body, JKColors.textTertiary)
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(JKColors.text),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = autocorrect),
            modifier = Modifier.weight(1f),
            decorationBox = { field ->
                Box {
                    if (query.isEmpty()) Text(prompt, style = style, color = JKColors.textTertiary)
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
        Text(label, style = style, color = JKColors.text, modifier = Modifier.weight(1f))
        Row(
            Modifier.width(94.dp).height(32.dp).background(JKColors.raised, JKShape.chip),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepperHalf(IconKey.remove, "Decrement", enabled = value > range.first) { onValueChange(value - 1) }
            Box(Modifier.width(1.dp).height(18.dp).background(JKColors.hairline))
            StepperHalf(IconKey.add, "Increment", enabled = value < range.last) { onValueChange(value + 1) }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.StepperHalf(
    icon: IconKey,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier.weight(1f).height(32.dp).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Glyph(icon, tint = if (enabled) JKColors.text else JKColors.textTertiary, contentDescription = description)
    }
}

/** The Atelier toggle ([JKSwitch]): bone when on, outlined when off. */
@Composable
private fun IOSSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    JKSwitch(
        checked = checked,
        onCheckedChange = onCheckedChange,
    )
}

// The three controls above, for the coach's other screen files (other files keep same-named private copies).
@Composable
internal fun CoachConfirmDialog(title: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit, message: String? = null) =
    ConfirmDialog(title, action, onConfirm, onDismiss, message)

@Composable
internal fun CoachStepper(label: String, value: Int, range: IntRange, onValueChange: (Int) -> Unit, modifier: Modifier = Modifier) =
    Stepper(label, value, range, onValueChange, modifier, style = JKType.callout)

@Composable
internal fun CoachSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) = IOSSwitch(checked, onCheckedChange)

// MARK: - Today (coach tab root)

/**
 * The coach's Today (atelier-spec.md, Coach screens 1): date and greeting,
 * the avatar into Account, then the ranked Needs-you list.
 */
@Composable
fun CoachTodayView() {
    val session = AppSession
    var data by remember { mutableStateOf<NeedsYou?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAccount by remember { mutableStateOf(false) }
    var lettersOnly by remember { mutableStateOf(false) }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { data = it }) { APIClient.get<NeedsYou>("/api/coach/needs-you") }
    }
    LaunchedEffect(Unit) { load() }

    JKRefreshable(onRefresh = load, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
            verticalArrangement = Arrangement.spacedBy(JKSpace.xl),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Text(Fmt.fullDay(Instant.now()), style = JKType.caption, color = JKColors.textSecondary)
                    Text(
                        "${Fmt.greeting()}, ${Fmt.firstWord(session.me?.name ?: "Coach")}",
                        style = JKType.display,
                        color = JKColors.text,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Box(
                    Modifier
                        .size(JKSize.touchTarget)
                        .clip(CircleShape)
                        .clickable { showAccount = true }
                        .semantics { contentDescription = "Account" },
                    contentAlignment = Alignment.Center,
                ) {
                    Avatar(initials = Fmt.initials(session.me?.name ?: "Coach"), mediaId = session.me?.coachSettings?.avatarMediaId)
                }
            }
            Loadable(value = data, error = error, retry = load) { d ->
                NeedsYouList(d, lettersOnly) { lettersOnly = it }
            }
        }
    }

    if (showAccount) Sheet(onDismiss = { showAccount = false }) { CoachAccountView() }
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
            Text(booking.title ?: booking.kindLabel, style = JKType.display, color = JKColors.text)
            Text(
                "${Fmt.longDay(booking.start)} · ${Fmt.time(booking.start)}–${Fmt.time(booking.end)}",
                style = JKType.caption,
                color = JKColors.textSecondary,
            )
            booking.location?.let { Text(it, style = JKType.caption, color = JKColors.textTertiary) }
        }
        Label(
            text = "Attendees",
            trailing = booking.capacity?.let { "${booking.attendeeCount ?: booking.attendees?.size ?: 0} of $it" },
        )
        val people = booking.attendees ?: listOfNotNull(booking.client)
        if (people.isEmpty()) {
            EmptyCard(title = "Nobody yet")
        } else {
            Column(Modifier.jkSurface(padding = 2.dp)) {
                people.forEach { p ->
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(initials = p.displayInitials, size = 28.dp)
                        Text(p.name, style = JKType.callout, color = JKColors.text)
                    }
                }
            }
        }
        error?.let { ErrorBanner(it) }
        if (booking.cancellable != false && booking.start > Instant.now()) {
            // GhostButtonStyle paints every label white, the destructive role included.
            SecondaryButton(if (booking.isGroup) "Cancel class" else "Cancel booking", onClick = { confirm = true })
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
                Label(text = "Members by plan")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    plans.forEach { p -> StatTile(label = p.name, value = "${p.members}", modifier = Modifier.weight(1f)) }
                }
            }
            PlansPricesLink()
            Label(text = "Needs attention", trailing = "Auto-flagged")
            if (b.attention.isEmpty()) {
                EmptyCard(title = "Everyone's on track")
            } else {
                Column(Modifier.jkSurface(padding = 2.dp)) {
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
                                Text(item.client.name, style = JKType.callout.semibold(), color = JKColors.text)
                                Text(item.reason, style = JKType.caption, color = JKColors.textTertiary)
                            }
                            Glyph(IconKey.fromSymbol(attentionIcon(item.kind)), JKType.caption, JKColors.textSecondary)
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
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Label(text = "Monthly recurring revenue") }
            b.mrrDeltaPct?.let { DeltaBadge(text = "${Fmt.delta(it, digits = 0)}%") }
        }
        Text(Fmt.pounds(b.mrrPence), style = JKType.display, color = JKColors.text)
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
        drawPath(line, JKColors.data, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

// MARK: - Clients (coach tab root)

/** Search, then Needs you, Check in with and On track; each row carries the 7-dot habit week. */
@Composable
fun ClientsView() {
    var clients by remember { mutableStateOf<List<ClientSummary>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }

    val load: suspend () -> Unit = {
        loadInto({ error = it }, { clients = it }) { APIClient.get<ClientsResponse>("/api/coach/clients").clients }
    }
    LaunchedEffect(Unit) { load() }

    JKRefreshable(onRefresh = load, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("Clients", style = JKType.display, color = JKColors.text, modifier = Modifier.weight(1f).semantics { heading() })
                if (AppSession.studioTools) {
                    val nav = LocalNav.current
                    SmallPill("Programs", onClick = { nav.push { ProgramsView() } })
                }
            }
            SearchField(query, { query = it }, prompt = "Search clients", autocorrect = false)
            Loadable(value = clients, error = error, retry = load) { list ->
                val shown = list.filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }
                when {
                    shown.isEmpty() -> EmptyCard(title = if (list.isEmpty()) "No clients yet" else "No matches", detail = if (list.isEmpty()) "Clients appear here when they sign up." else null)
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
}

@Composable
private fun ClientGroup(title: String?, list: List<ClientSummary>) {
    if (list.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        if (title != null) CoachSectionTitle(title, trailing = "${list.size}")
        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
            list.forEachIndexed { i, c ->
                ClientRow(client = c, modifier = Modifier.navLink { ClientDetailView(clientId = c.id, name = c.name) })
                if (i < list.lastIndex) GroupDivider(Modifier.padding(start = JKSpace.l + JKSize.avatar + JKSpace.m))
            }
        }
    }
}

@Composable
private fun ClientRow(client: ClientSummary, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = JKSpace.l, vertical = JKSpace.m),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(initials = client.displayInitials)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                Text(client.name, style = JKType.callout, color = JKColors.text)
                if ((client.unread ?: 0) > 0) {
                    Glyph(IconKey.unread, size = JKSize.iconSmall, tint = JKColors.textSecondary, filled = true, contentDescription = "Unread message")
                }
            }
            Text(
                ClientText.reason(client),
                style = JKType.caption,
                color = JKColors.textSecondary,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
            client.habitWeek?.takeIf { it.isNotEmpty() }?.let { ClientWeekDots(it) }
        }
        Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
    }
}

/** Human text for a client summary's plan, adherence and flags. */
object ClientText {
    private val waitingKinds = listOf("urgent", "message", "form", "checkin")

    /** Something of theirs is waiting on the coach. */
    fun needsYou(c: ClientSummary): Boolean = (c.demand?.kind ?: "") in waitingKinds

    fun tint(c: ClientSummary): Color? = when (c.demand?.kind) {
        "urgent" -> JKColors.urgent
        "message", "form", "checkin" -> JKColors.attention
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
                IconLabel("New", icon = IconKey.add, style = JKType.caption.semibold(), color = JKColors.primaryLabel, modifier = Modifier
                        .clip(CircleShape)
                        .clickable { editing = ProgramDraft() }
                        .background(SolidColor(JKColors.accentControl), CircleShape)
                        .padding(horizontal = 12.dp, vertical = 7.dp))
            }
        }
        Segmented(options = ProgramsTab.entries, selection = tab, onSelectionChange = { tab = it }) { it.label }
        when (tab) {
            ProgramsTab.programs -> Loadable(value = programs, error = error, retry = load) { list ->
                if (list.isEmpty()) {
                    EmptyCard(title = "No programs yet", detail = "Build a template once, then assign it to any client with a start date.")
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
        Modifier.clip(JKShape.card).clickable(onClick = onEdit).jkSurface(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(52.dp).background(JKColors.raised, JKShape.control), contentAlignment = Alignment.Center) {
            Glyph(IconKey.progress, JKType.body, JKColors.textTertiary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(p.name, style = JKType.callout.semibold(), color = JKColors.text)
            Text(
                "${p.daysPerWeek} days / week · ${p.weeks} weeks · ${p.workouts.size} workouts",
                style = JKType.caption,
                color = JKColors.textTertiary,
            )
            Text(
                p.clientCount?.let { if (it == 1) "1 client" else "$it clients" } ?: "Template",
                style = JKType.caption,
                color = JKColors.textSecondary,
                modifier = Modifier.background(JKColors.raised, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
            )
        }
        Box {
            Box(Modifier.size(30.dp).clickable { menu = true }, contentAlignment = Alignment.Center) {
                Glyph(IconKey.more, JKType.body, JKColors.textSecondary)
            }
            DropdownMenu(
                expanded = menu,
                onDismissRequest = { menu = false },
                containerColor = JKColors.raised,
                shape = JKShape.card,
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
        text = { Text(title, style = JKType.body, color = JKColors.text) },
        trailingIcon = { Glyph(IconKey.fromSymbol(systemImage), JKType.body, JKColors.text) },
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

        Label(text = "Workouts", trailing = "Day offset from the start date")
        d.workouts.forEach { w ->
            Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                    TextButton(onClick = { picking = w.localId }) {
                        IconLabel("Add exercise", icon = IconKey.add, style = JKType.caption.semibold(), color = JKColors.textSecondary)
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { d = d.copy(workouts = d.workouts.filter { it.localId != w.localId }) }) {
                        IconLabel("Remove workout", icon = IconKey.delete, style = JKType.caption.semibold(), color = JKColors.textSecondary)
                    }
                }
            }
        }
        SecondaryButton(onClick = {
            val next = (d.workouts.maxOfOrNull { it.dayOffset } ?: -1) + 1
            d = d.copy(
                workouts = d.workouts + ProgramWorkout(
                    dayOffset = minOf(next, d.weeks * 7 - 1),
                    title = "Workout ${d.workouts.size + 1}",
                    items = emptyList(),
                ),
            )
        }) {
            IconLabel("Add workout", icon = IconKey.add, style = JKType.callout.semibold())
        }

        error?.let { ErrorBanner(it) }
        PrimaryButton(onClick = { scope.launch { save() } }, enabled = !saving && d.name.isNotBlank()) {
            if (saving) ProgressView() else Text(if (d.programId == null) "Create program" else "Save program")
        }
        if (d.programId != null) {
            SecondaryButton("Delete program", onClick = { confirmDelete = true })
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
        Text("No exercises yet.", style = JKType.caption, color = JKColors.textTertiary)
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
                Modifier.fillMaxWidth().background(JKColors.raised.copy(alpha = 0.5f), JKShape.control).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        item.exerciseName.ifEmpty { item.exerciseId },
                        style = JKType.callout.semibold(),
                        color = JKColors.text,
                    )
                    if (item.id == null) {
                        Text(
                            "New",
                            style = JKType.caption.semibold(),
                            color = JKColors.primaryLabel,
                            modifier = Modifier.background(JKColors.text, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
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
        Glyph(IconKey.fromSymbol(systemName), JKType.caption, if (enabled) JKColors.textSecondary else JKColors.textTertiary.copy(alpha = 0.5f))
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
        Text(program.name, style = JKType.headline, color = JKColors.text)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Start date", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
            // iOS's compact date picker: the date in a grey capsule that opens the calendar.
            Text(
                Fmt.dayMonthYear(start),
                style = JKType.callout,
                color = JKColors.text,
                modifier = Modifier
                    .clip(JKShape.chip)
                    .clickable { pickingDate = true }
                    .background(JKColors.raised, JKShape.chip)
                    .padding(horizontal = 11.dp, vertical = 6.dp),
            )
        }
        Label(text = "Client")
        val list = clients
        if (list != null) {
            Column(Modifier.jkSurface(padding = 2.dp)) {
                list.forEach { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable { clientId = c.id }.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(initials = c.displayInitials, size = 28.dp)
                        Text(c.name, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                        CheckCircle(on = clientId == c.id)
                    }
                }
            }
        } else {
            LoadingCard()
        }
        created?.let {
            IconLabel("Created $it draft workouts. Publish them from the client's Plan tab.", icon = IconKey.custom, style = JKType.caption, color = JKColors.textSecondary)
        }
        error?.let { ErrorBanner(it) }
        PrimaryButton(
            onClick = { scope.launch { assign() } },
            enabled = !saving && (created != null || clientId != null),
        ) {
            if (saving) ProgressView() else Text(if (created == null) "Assign" else "Done")
        }
    }

    if (pickingDate) StartDateDialog(start, onPick = { start = it }, onDismiss = { pickingDate = false })
}

/** The calendar behind the compact date picker, dark. Material's picker works in UTC midnights. */
@Composable
private fun StartDateDialog(initial: LocalDate, onPick: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    val colors = DatePickerDefaults.colors(containerColor = JKColors.raised)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            }) { Text("Done", style = JKType.body.semibold(), color = JKColors.text) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body, color = JKColors.text) } },
        colors = colors,
    ) {
        DatePicker(state = state, colors = colors, title = null, headline = null, showModeToggle = false)
    }
}

// MARK: - Hints & guides (pushed from Account)

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

    PushedScreen(spacing = 14.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach library", title = "Hints & guides")
        SearchField(query, { query = it }, prompt = "Search guides and cues")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            tags.forEach { f -> Chip(label = f, selected = filter == f) { filter = f } }
        }
        Loadable(value = guides, error = error, retry = load) { g ->
            g.featured?.takeIf(::matches)?.let { featured ->
                FeaturedCard(featured, Modifier.clickable { open = featured })
            }
            Label(text = "Quick tips")
            val tips = g.tips.filter(::matches)
            if (tips.isEmpty()) {
                Text("Nothing matches.", style = JKType.caption, color = JKColors.textTertiary)
            }
            tips.forEach { tip ->
                Row(
                    Modifier.clip(JKShape.card).clickable { open = tip }.jkSurface(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    RowGlyph(IconKey.fromSymbolOrNull(tip.icon) ?: IconKey.idea, slot = 32.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(tip.title, style = JKType.callout.semibold(), color = JKColors.text)
                        Text(tip.body, style = JKType.caption, color = JKColors.textTertiary, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
            }
        }
        PrimaryButton(onClick = { showDesk = true }, modifier = Modifier.padding(top = 20.dp)) {
            IconLabel("Coach desk on the web", icon = IconKey.desktop, style = JKType.callout.semibold(), color = JKColors.primaryLabel)
        }
        Text("Write weekly feedback and plans from a computer.", style = JKType.caption, color = JKColors.textTertiary)
        SecondaryButton(onClick = {
            scope.launch {
                try { session.switchToDemoClient() } catch (e: Throwable) { switchError = e.readable }
            }
        }) {
            IconLabel("View the app as a client (demo: Sam Carter)", icon = IconKey.swap, style = JKType.callout.semibold())
        }
        switchError?.let { ErrorBanner(it) }
        SecondaryButton("Sign out", onClick = { scope.launch { session.signOut() } })
    }

    if (showDesk) Sheet(onDismiss = { showDesk = false }) { WebDeskSheet() }
    open?.let { g -> GuideSheet(g, onDismiss = { open = null }) }
}

/** A guide read in full: SwiftUI's medium/large detent sheet, as a bottom sheet. */
@Composable
private fun GuideSheet(g: Guide, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = JKColors.bg, contentColor = JKColors.text) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Label(text = (listOfNotNull(g.minutes?.let { "$it min" }) + g.tags).joinToString(" · "))
            Text(g.title, style = JKType.display, color = JKColors.text)
            Text(g.body, style = JKType.body, color = JKColors.textSecondary)
        }
    }
}

@Composable
private fun FeaturedCard(g: Guide, modifier: Modifier = Modifier) {
    val shape = JKShape.card
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .then(modifier)
            .background(JKColors.surface)
            .border(1.dp, JKColors.hairline, shape),
    ) {
        Box(Modifier.fillMaxWidth().height(110.dp).background(JKColors.raised)) {
            Glyph(IconKey.guide, JKType.display, JKColors.textTertiary, Modifier.align(Alignment.Center))
            g.tags.firstOrNull()?.let { first ->
                Text(
                    first,
                    style = JKType.caption.semibold(),
                    color = JKColors.textSecondary,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .background(JKColors.surface, CircleShape)
                        .padding(horizontal = 7.dp, vertical = 3.dp),
                )
            }
        }
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Label(text = "Featured guide" + (g.minutes?.let { " · $it min" } ?: ""))
            Text(g.title, style = JKType.headline, color = JKColors.text, textAlign = TextAlign.Start)
            Text(g.body, style = JKType.caption, color = JKColors.textTertiary, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

// MARK: - Coach account

/**
 * The coach's account (atelier-spec.md, Coach screens 6): the web desk,
 * preview as a client, notifications, studio tools, letter rhythm, the two
 * reply lines, portrait and signature, a one-line pulse. The desk-only
 * editors (Programs, Forms, Autoflows, Plans & prices, Business,
 * availability) appear here only with "Show studio tools" on; nothing is
 * deleted in this release.
 */
@Composable
fun CoachAccountView() {
    val session = AppSession
    val dismiss = LocalDismiss.current
    val uri = LocalUriHandler.current
    val nav = LocalNav.current
    var confirmSignOut by remember { mutableStateOf(false) }
    var showDesk by remember { mutableStateOf(false) }
    var switchError by remember { mutableStateOf<String?>(null) }

    Column(Modifier.jkScreen()) {
        TopBar("Account", leading = {}, trailing = { BarButton("Done", bold = true) { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
            verticalArrangement = Arrangement.spacedBy(JKSpace.xl),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                CoachAvatar(mediaId = session.me?.coachSettings?.avatarMediaId, size = JKSize.avatar + JKSpace.m, contentDescription = null)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(session.me?.name ?: "Coach", style = JKType.headline, color = JKColors.text)
                    Text(session.me?.email ?: "Coach account", style = JKType.caption, color = JKColors.textSecondary)
                }
            }
            PulseLine()
            AccountGroup {
                CoachRowLabel("Open the web desk", Modifier.clickable { showDesk = true }, icon = IconKey.desktop, detail = "Programmes, forms and prices live there")
                GroupDivider()
                CoachRowLabel(
                    "Preview as client",
                    Modifier.clickable {
                        dismiss()
                        // The sheet (and its scope) goes with the dismiss; the switch must outlive it.
                        ProcessLifecycleOwner.get().lifecycleScope.launch {
                            try { session.switchToDemoClient() } catch (e: Throwable) { switchError = e.readable }
                        }
                    },
                    icon = IconKey.clients,
                    detail = "Look round as the demo client, Sam Carter",
                )
                GroupDivider()
                CoachRowLabel("Hints & guides", Modifier.clickable { nav.push { GuidesView() } }, icon = IconKey.guide)
            }
            switchError?.let { ErrorBanner(it) }
            CoachNotificationsRow()
            StudioToolsRow()
            if (session.studioTools) {
                AccountGroup {
                    CoachRowLabel("Programs, autoflows and forms", Modifier.clickable { nav.push { ProgramsView() } }, icon = IconKey.workout)
                    GroupDivider()
                    CoachRowLabel("Plans & prices", Modifier.clickable { nav.push { PlansEditorView() } }, icon = IconKey.settings)
                    GroupDivider()
                    CoachRowLabel("Business", Modifier.clickable { nav.push { BusinessView() } }, icon = IconKey.progress)
                    GroupDivider()
                    CoachRowLabel("Availability", Modifier.clickable { nav.push { AvailabilityScreen() } }, icon = IconKey.week)
                }
            }
            RhythmSection(session.me?.coachSettings)
            ReplyLinesSection(session.me?.coachSettings)
            PortraitRow(purpose = "avatar", title = "Change portrait", detail = "Shown on the JK tab, Today and letters")
            PortraitRow(purpose = "signature", title = "Change signature", detail = "Signs your letters; the monogram stands in until then")
            CalendarSubscribeCard()
            WebSessionsRow()
            AccountGroup {
                CoachRowLabel("Privacy policy", Modifier.clickable { uri.openUri(APIClient.privacyURL) }, icon = IconKey.lock, chevron = false)
            }
            SecondaryButton("Sign out", onClick = { confirmSignOut = true })
        }
    }

    if (showDesk) Sheet(onDismiss = { showDesk = false }) { WebDeskSheet() }
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

@Composable
private fun AccountGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs), content = content)
}

/** "Show studio tools": the desk editors on the phone. Off by default. */
@Composable
private fun StudioToolsRow() {
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Column(Modifier.jkSurface(padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Show studio tools", style = JKType.callout, color = JKColors.text)
                Text(
                    "Programs, forms, autoflows, plans and prices, business and availability on the phone. They stay on the web desk either way.",
                    style = JKType.caption, color = JKColors.textSecondary,
                )
            }
            JKSwitch(checked = AppSession.studioTools, enabled = !busy, onCheckedChange = { on ->
                scope.launch {
                    busy = true
                    try {
                        AppSession.updateCoachSettings(CoachSettingsPatch(studioTools = on))
                        error = null
                    } catch (e: Throwable) {
                        if (!e.isCancellation) error = e.readable
                    } finally {
                        busy = false
                    }
                }
            })
        }
        error?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
    }
}

/** Letter rhythm per plan, as set on the desk. */
@Composable
private fun RhythmSection(settings: CoachSettings?) {
    val plans = listOf("elite" to "Elite", "performance" to "Performance", "foundation" to "Foundation", "none" to "Free")
    fun line(r: RhythmSetting?): String {
        if (r == null || r.every == "none") return "No letters"
        val every = if (r.every == "fortnightly") "Fortnightly" else "Weekly"
        return if (r.media == true) "$every, with a voice or video note" else "$every, written"
    }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        CoachSectionTitle("Letter rhythm")
        Column(Modifier.jkSurface(padding = JKSpace.l)) {
            plans.forEach { (id, name) ->
                Row(Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget), verticalAlignment = Alignment.CenterVertically) {
                    Text(name, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                    Text(line(settings?.letterRhythm?.get(id)), style = JKType.caption, color = JKColors.textSecondary)
                }
            }
        }
        Text("Per client, a letter can go fortnightly from their page on the desk.", style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** The two reply lines clients see under JK's name. */
@Composable
private fun ReplyLinesSection(settings: CoachSettings?) {
    val scope = rememberCoroutineScope()
    var standard by remember { mutableStateOf(settings?.replyExpectation?.standard ?: "JK replies most evenings") }
    var priority by remember { mutableStateOf(settings?.replyExpectation?.priority ?: "Same-day replies") }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        CoachSectionTitle("Reply lines")
        Column(Modifier.jkSurface(padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
            JKField(label = "Standard", text = standard, onTextChange = { standard = it }, prompt = "JK replies most evenings")
            JKField(label = "Plans with priority replies", text = priority, onTextChange = { priority = it }, prompt = "Same-day replies")
            notice?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
            SecondaryButton("Save reply lines", enabled = !busy && standard.isNotBlank(), onClick = {
                scope.launch {
                    busy = true
                    try {
                        AppSession.updateCoachSettings(
                            CoachSettingsPatch(replyExpectation = ReplyExpectation(standard = standard.trim(), priority = priority.trim())),
                        )
                        notice = "Saved."
                    } catch (e: Throwable) {
                        if (!e.isCancellation) notice = e.readable
                    } finally {
                        busy = false
                    }
                }
            })
        }
    }
}

/**
 * Upload JK's portrait (`avatar`: the JK tab, From JK on Today, letters) or
 * signature (`signature`: the foot of letters). The server sets it in the
 * coach's settings.
 */
@Composable
private fun PortraitRow(purpose: String, title: String, detail: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            try {
                val jpeg = withContext(Dispatchers.Default) { portraitJpeg(context, uri) }
                if (jpeg == null) {
                    error = "Couldn't read that photo."
                } else {
                    APIClient.upload<Media>("/api/media", jpeg, "image/jpeg", mapOf("purpose" to purpose))
                    AppSession.refreshMe()
                    error = null
                }
            } catch (e: Throwable) {
                if (!e.isCancellation) error = e.readable
            } finally {
                busy = false
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        AccountGroup {
            CoachRowLabel(
                if (busy) "Uploading…" else title,
                Modifier.clickable(enabled = !busy) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                icon = IconKey.photos,
                detail = detail,
            )
        }
        error?.let { ErrorBanner(it) }
    }
}

/** A portrait at most 1024 px on the long side, as JPEG (EXIF rotation applied by ImageDecoder). */
private fun portraitJpeg(context: Context, uri: Uri): ByteArray? = try {
    val source = ImageDecoder.createSource(context.contentResolver, uri)
    val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        val longest = maxOf(info.size.width, info.size.height)
        if (longest > 1024) {
            val scale = 1024f / longest
            decoder.setTargetSize((info.size.width * scale).toInt(), (info.size.height * scale).toInt())
        }
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
    }
    ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
} catch (_: Exception) {
    null
}

/** "12 active · £1,840 a month", from the business figures. */
@Composable
private fun PulseLine() {
    var business by remember { mutableStateOf<Business?>(null) }
    LaunchedEffect(Unit) {
        business = runCatching { APIClient.get<Business>("/api/coach/business", mapOf("period" to "month")) }.getOrNull()
    }
    val b = business
    Text(
        if (b == null) " " else "${b.active} active · ${Fmt.pounds(b.mrrPence)} a month",
        style = JKType.callout.monospacedDigit(),
        color = JKColors.textSecondary,
    )
}

/** Weekly availability, pushed from Account when studio tools are on. */
@Composable
fun AvailabilityScreen() {
    var open by remember { mutableStateOf(false) }
    CoachSubpage("Availability") {
        Text("Weekly hours clients can book. The web desk has the same editor.", style = JKType.caption, color = JKColors.textSecondary)
        PrimaryButton("Edit availability", onClick = { open = true })
    }
    if (open) Sheet(onDismiss = { open = false }) { AvailabilityEditor() }
}

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
        Modifier.jkSurface(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowGlyph(IconKey.desktop)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Coach desk on the web", style = JKType.callout.semibold(), color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textTertiary)
        }
        if ((sessions?.count ?: 0) > 0) {
            Text(
                "Sign out all",
                style = JKType.caption.semibold(),
                color = if (busy) JKColors.textTertiary else JKColors.text,
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

    Column(Modifier.jkSurface(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RowGlyph(IconKey.notifications)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Notifications", style = JKType.callout.semibold(), color = JKColors.text)
                Text("Client messages, check-ins and bookings", style = JKType.caption, color = JKColors.textTertiary)
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
        error?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
    }
}
