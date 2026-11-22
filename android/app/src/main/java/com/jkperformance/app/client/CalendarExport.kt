package com.jkperformance.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.CalendarFeed
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/** A session to put in the phone's calendar. */
data class CalendarEventDraft(
    val title: String,
    val start: Instant,
    val end: Instant,
    val location: String? = null,
    val notes: String? = null,
    val id: UUID = UUID.randomUUID(),
)

/**
 * The calendar app's own "New event" screen, filled in — Android's
 * equivalent of Apple's EKEventEditViewController. It runs in the calendar
 * app, so no calendar permission is needed: the person picks the calendar
 * and saves (or backs out).
 *
 * The insert intent has no field for an alert, so the iPhone's "1 hour
 * before" alarm is left to the calendar's own default reminder.
 *
 * Returns false when no calendar app on the phone takes the intent.
 */
fun Context.addToCalendar(draft: CalendarEventDraft): Boolean {
    val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, draft.title)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, draft.start.toEpochMilli())
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, draft.end.toEpochMilli())
        .apply {
            draft.location?.let { putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
            draft.notes?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
        }
    return try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

/**
 * Opens a calendar feed for subscribing. A `webcal://` link goes to whichever
 * app claims it (as iOS hands it to Apple Calendar); most Android phones have
 * none, so then Google Calendar's "add by URL" page takes the same feed.
 */
private fun Context.subscribe(webcal: String) {
    try {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(webcal)))
    } catch (_: ActivityNotFoundException) {
        val google = Uri.parse("https://calendar.google.com/calendar/render").buildUpon()
            .appendQueryParameter("cid", webcal)
            .build()
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, google)) }
    }
}

/**
 * Subscribe the phone's calendar to a private feed of every session, which
 * stays up to date by itself. The feed link is shown once by the server, so
 * this phone remembers it; making a new one stops the old.
 */
@Composable
fun CalendarSubscribeCard() {
    val me = AppSession.me
    if (me?.demo == true) return
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("jk.calendar", Context.MODE_PRIVATE) }
    val key = "jk.calendar.webcal.${me?.id ?: ""}"
    val isCoach = me?.isCoach == true
    var active by remember { mutableStateOf<Boolean?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        saved = prefs.getString(key, null)
        try {
            active = APIClient.get<CalendarFeed>("/api/calendar/feed").active
        } catch (e: Exception) {
            if (e.isCancellation) throw e
        }
    }

    fun subscribe() = scope.launch {
        busy = true
        try {
            val feed = APIClient.send<CalendarFeed>("POST", "/api/calendar/feed")
            active = feed.active
            saved = feed.webcal
            prefs.edit { putString(key, feed.webcal) }
            error = null
            feed.webcal?.let { context.subscribe(it) }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            busy = false
        }
    }

    fun stop() = scope.launch {
        busy = true
        try {
            val feed = APIClient.send<CalendarFeed>("DELETE", "/api/calendar/feed")
            active = feed.active
            saved = null
            prefs.edit { remove(key) }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            busy = false
        }
    }

    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RowGlyph(IconKey.book)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    if (active == true) "In your calendar" else "Add all to your calendar",
                    style = JKType.callout.semibold(),
                    color = JKColors.text,
                )
                Text(
                    if (isCoach) "Every booking and class, kept up to date"
                    else "Your sessions, classes and timed workouts, kept up to date",
                    style = JKType.caption,
                    color = JKColors.textTertiary,
                )
            }
        }
        error?.let { ErrorBanner(it) }
        if (active == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val link = saved
                if (link != null) {
                    SecondaryButton("Open again", onClick = { context.subscribe(link) }, modifier = Modifier.weight(1f), enabled = !busy)
                } else {
                    SecondaryButton("New link", onClick = { subscribe() }, modifier = Modifier.weight(1f), enabled = !busy)
                }
                SecondaryButton("Stop", onClick = { stop() }, modifier = Modifier.weight(1f), enabled = !busy)
            }
        } else {
            PrimaryButton(onClick = { subscribe() }, enabled = !busy && active != null) {
                if (busy) ProgressView() else Text("Subscribe in Calendar")
            }
        }
    }
}
