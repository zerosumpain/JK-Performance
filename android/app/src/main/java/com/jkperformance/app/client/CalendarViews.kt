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
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

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
                Row(Modifier.jkSurface(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(client.displayInitials, size = 34.dp)
                    Text("Booking for ${client.name}", style = JKType.callout.semibold(), color = JKColors.text)
                }
            } else {
                Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Label(text = "Session credits")
                    Text(
                        buildAnnotatedString {
                            withStyle(JKType.display.toSpanStyle()) { append("${membership?.creditsLeft ?: 0}") }
                            withStyle(JKType.caption.toSpanStyle().merge(SpanStyle(color = JKColors.textSecondary))) {
                                append(" of ${membership?.creditsTotal ?: 0} left")
                            }
                        },
                        color = JKColors.text,
                    )
                    Text(creditLine(membership), style = JKType.caption, color = JKColors.textTertiary)
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Glyph(IconKey.back, JKType.body, JKColors.textSecondary, Modifier.clickable {
                        val today = LocalDate.now(Day.zone)
                        val back = Day.add(-7, day)
                        day = if (back < today) today else back
                    })
                Text(
                    "Week of ${Fmt.dayMonth(Day.weekStart(day))}",
                    style = JKType.caption,
                    color = JKColors.textSecondary,
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                Glyph(IconKey.chevron, JKType.body, JKColors.textSecondary, Modifier.clickable { day = Day.add(7, day) })
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
                        EmptyCard(title = "No times this day", detail = "Try another day or session type.")
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

            Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row {
                    val pick = chosen
                    Text(
                        if (pick != null) "${Fmt.shortDay(pick.start)} · ${Fmt.time(pick.start)}–${Fmt.time(pick.end)}" else "Pick a time",
                        style = JKType.caption,
                        color = JKColors.text,
                        modifier = Modifier.weight(1f),
                    )
                    Text(pick?.location ?: kind.label, style = JKType.caption, color = JKColors.text)
                }
                HorizontalDivider(thickness = 0.5.dp, color = JKColors.hairline)
                Row {
                    Text("Uses 1 credit", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.weight(1f))
                    Text(kind.label, style = JKType.caption, color = JKColors.textTertiary)
                }
            }

            bookError?.let { ErrorBanner(it) }
            PrimaryButton(onClick = ::book, enabled = chosen != null && !booking) {
                if (booking) ProgressView() else Text("Confirm booking")
            }
            Text(
                "Free cancellation up to 24h before",
                style = JKType.caption,
                color = JKColors.textTertiary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** A time in the slot grid: chrome when chosen, struck through on a dashed edge when taken. */
@Composable
private fun SlotButton(slot: Slot, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val shape = JKShape.control
    val ground: Brush = if (on) SolidColor(JKColors.accentControl) else SolidColor(JKColors.surface)
    Box(
        modifier
            .background(ground, shape)
            .then(if (slot.open) Modifier.border(1.dp, JKColors.hairline, shape) else Modifier.dashedBorder(JKColors.hairline, 10.dp, dash = 3.dp))
            .clickable(enabled = slot.open, onClick = onClick)
            .padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            Fmt.time(slot.start),
            style = JKType.callout.semibold().copy(textDecoration = if (slot.open) null else TextDecoration.LineThrough),
            color = when {
                on -> JKColors.primaryLabel
                slot.open -> JKColors.text
                else -> JKColors.textTertiary
            },
        )
    }
}

private fun creditLine(m: com.jkperformance.app.net.Membership?): String {
    if (m == null || !m.isActive) return "No membership · choose a plan under Account"
    val reset = m.creditsResetOn?.let { " · resets ${Fmt.dayMonth(it)}" } ?: ""
    return "${m.displayName} plan$reset"
}
