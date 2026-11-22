package com.jkperformance.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import com.jkperformance.app.net.ApiJson
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.Push
import com.jkperformance.app.net.WorkoutSummary
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * Reminders scheduled on the phone itself: the weekly check-in on Friday
 * evening, and an hour before each session or timed workout in the next
 * fortnight. Rescheduled whenever Home loads. `enabled` is also the switch
 * for push notifications from the server (see [Push]).
 *
 * iOS keeps pending local notifications itself, across reboots. Android's
 * AlarmManager forgets alarms on reboot, so every scheduled reminder is kept
 * in SharedPreferences too: [ReminderReceiver] re-arms them after a restart,
 * and the weekly check-in re-arms itself each time it fires.
 *
 * Main thread only; call [init] from Application.onCreate (after Push.init).
 */
object Reminders {
    private const val TAG = "Reminders"
    private const val PREFS = "jk.reminders"
    private const val KEY = "jk.reminders.on"
    private const val SCHEDULED_KEY = "jk.reminders.scheduled"
    private const val SESSION_PREFIX = "jk.session."
    private const val CHECK_IN_ID = "jk.checkin"

    /** Channel for the phone's own reminders, apart from the coach's pushes. */
    const val CHANNEL_ID = "reminders"

    /** A reminder waiting to fire. `weekly` ones (the check-in) move on a week after firing. */
    @Serializable
    private data class Scheduled(
        val id: String,
        val title: String,
        val body: String,
        val atMillis: Long,
        val weekly: Boolean = false,
    )

    private lateinit var context: Context
    private val scope = MainScope()

    var enabled: Boolean by mutableStateOf(false)
        private set

    fun init(context: Context) {
        this.context = context.applicationContext
        enabled = prefs().getBoolean(KEY, false)
        val channel = NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Weekly check-in, and an hour before each session" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /**
     * Asks Android once; returns whether reminders are now on.
     * Also turns on push from the server (messages, feedback, bookings).
     */
    suspend fun enable(checkIn: Boolean = true): Boolean {
        val granted = Push.requestAuthorization()
        set(granted)
        if (granted) {
            if (checkIn) scheduleCheckIn()
            Push.registerIfAllowed()
        }
        return granted
    }

    /** Ask in context (after a first message) if they've never been asked. */
    suspend fun offerIfUndecided(checkIn: Boolean) {
        if (enabled || !Push.isUndecided) return
        enable(checkIn)
    }

    fun disable() {
        set(false)
        clearPending()
        scope.launch { Push.turnOff() }
    }

    fun clearPending() {
        stored().forEach { cancelAlarm(it.id) }
        store(emptyList())
    }

    private fun set(value: Boolean) {
        enabled = value
        prefs().edit { putBoolean(KEY, value) }
    }

    private fun scheduleCheckIn() {
        add(
            Scheduled(
                id = CHECK_IN_ID,
                title = "Weekly check-in",
                body = "Two minutes: how did your week go? Your coach reads it before planning the next one.",
                atMillis = nextCheckIn(after = ZonedDateTime.now(Day.zone)),
                weekly = true,
            ),
        )
    }

    /** The next Friday 18:00 on the phone's clock, strictly after `after`. */
    private fun nextCheckIn(after: ZonedDateTime): Long {
        var at = after.with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).toLocalDate().atTime(18, 0).atZone(Day.zone)
        if (!at.isAfter(after)) at = at.plusWeeks(1)
        return at.toInstant().toEpochMilli()
    }

    /** Replace the session reminders with ones for these bookings and workouts. */
    @Suppress("RedundantSuspendModifier") // Kept suspend, as Swift's is async, so callers read the same.
    suspend fun schedule(bookings: List<Booking>, workouts: List<WorkoutSummary>) {
        if (!enabled) return
        val pending = stored()
        pending.filter { it.id.startsWith(SESSION_PREFIX) }.forEach { cancelAlarm(it.id) }
        store(pending.filterNot { it.id.startsWith(SESSION_PREFIX) })
        if (pending.none { it.id == CHECK_IN_ID }) scheduleCheckIn()

        data class Item(val id: String, val title: String, val detail: String, val start: Instant)

        val now = Instant.now()
        val horizon = Day.add(14, now)
        val items = mutableListOf<Item>()
        for (b in bookings) {
            if (b.isMine) items += Item(b.id, b.title ?: b.kindLabel, b.location ?: "", b.start)
        }
        for (w in workouts) {
            if (w.completedAt != null || !w.published) continue
            val time = w.startsAt ?: continue
            val day = Day.date(w.date) ?: continue
            val start = Day.at(day, time) ?: continue
            items += Item(w.id, w.title, w.location ?: "", start)
        }
        for (item in items.sortedBy { it.start }.take(40)) {
            val fire = item.start.minusSeconds(3600)
            if (fire <= now || item.start >= horizon) continue
            add(
                Scheduled(
                    id = SESSION_PREFIX + item.id,
                    title = "${item.title} at ${Fmt.time(item.start)}",
                    body = if (item.detail.isEmpty()) "Starts in an hour." else "Starts in an hour · ${item.detail}",
                    atMillis = fire.toEpochMilli(),
                ),
            )
        }
    }

    // MARK: Store and alarms

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val listSerializer = ListSerializer(Scheduled.serializer())

    private fun stored(): List<Scheduled> =
        prefs().getString(SCHEDULED_KEY, null)
            ?.let { runCatching { ApiJson.decodeFromString(listSerializer, it) }.getOrNull() }
            ?: emptyList()

    private fun store(list: List<Scheduled>) {
        prefs().edit { putString(SCHEDULED_KEY, ApiJson.encodeToString(listSerializer, list)) }
    }

    /** Adds (or replaces, by id) a reminder and arms its alarm. */
    private fun add(reminder: Scheduled) {
        store(stored().filterNot { it.id == reminder.id } + reminder)
        arm(reminder)
    }

    /**
     * One alarm per reminder, told apart by the intent's data URI. Exact when
     * the phone allows exact alarms; otherwise within a ten-minute window, which
     * needs no special permission and is close enough for "starts in an hour".
     */
    private fun arm(reminder: Scheduled) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val operation = operation(reminder.id, create = true) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
            alarms.setWindow(AlarmManager.RTC_WAKEUP, reminder.atMillis, WINDOW_MILLIS, operation)
        } else {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminder.atMillis, operation)
        }
    }

    private fun cancelAlarm(id: String) {
        val operation = operation(id, create = false) ?: return
        context.getSystemService(AlarmManager::class.java).cancel(operation)
        operation.cancel()
    }

    private fun operation(id: String, create: Boolean): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction(ReminderReceiver.ACTION_FIRE)
            .setData(Uri.fromParts("jk-reminder", id, null))
        val flags = PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    private const val WINDOW_MILLIS = 10 * 60 * 1000L

    /** An alarm went off: show the reminder if it is still wanted, then move the weekly one on. */
    internal fun fire(id: String) {
        val reminder = stored().firstOrNull { it.id == id } ?: return
        if (reminder.weekly) {
            add(reminder.copy(atMillis = nextCheckIn(after = ZonedDateTime.now(Day.zone))))
        } else {
            store(stored().filterNot { it.id == id })
        }
        if (enabled) show(reminder)
    }

    /** After a reboot (or an app update) the alarms are gone: arm the stored ones again, dropping any that passed. */
    internal fun rearm() {
        val now = System.currentTimeMillis()
        val keep = stored().mapNotNull { r ->
            when {
                r.atMillis > now -> r
                r.weekly -> r.copy(atMillis = nextCheckIn(after = ZonedDateTime.now(Day.zone)))
                else -> null
            }
        }
        store(keep)
        if (enabled) keep.forEach(::arm)
    }

    private fun show(reminder: Scheduled) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(
            context, reminder.id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(reminder.title)
            .setContentText(reminder.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(reminder.body))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        try {
            manager.notify(reminder.id, 0, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission withdrawn: ${e.message}")
        }
    }
}

/**
 * Wakes for [Reminders]: a reminder's alarm, or the phone restarting (which
 * clears every alarm). Registered in the manifest; the app process, and so
 * Reminders.init, is up before onReceive runs.
 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_FIRE -> intent.data?.schemeSpecificPart?.let(Reminders::fire)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.rearm()
        }
    }

    companion object {
        const val ACTION_FIRE = "com.jkperformance.app.REMINDER"
    }
}
