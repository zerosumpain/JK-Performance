// Each stub is deleted when its real screen lands.
//
// The app shell, AppSession and Push reference screens and helpers that other
// slices of the Android port write. Each stub here has the exact name and
// parameters of the Swift original, so the real one replaces it in its own
// file (same package) by deleting the stub. `Fmt`, `BrandIntro` and their
// kin are expected from the design slice; if they land in
// com.jkperformance.app.design, delete the stub and import them from there
// (Models.kt imports `com.jkperformance.app.Fmt`).

package com.jkperformance.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// MARK: - Client

@Composable
fun WelcomeView() = Text("WelcomeView")

@Composable
fun ClientHomeView() = Text("ClientHomeView")

@Composable
fun WorkoutPlanView() = Text("WorkoutPlanView")

@Composable
fun MyCalendarView() = Text("MyCalendarView")

@Composable
fun MessagesThreadView(clientId: String?, otherName: String, subtitle: String?) = Text("MessagesThreadView")

@Composable
fun AccountView() = Text("AccountView")

/** Client/Reminders.swift: local reminders and the one Notifications switch. */
object Reminders {
    val enabled: Boolean get() = false
    fun clearPending() {}
}

// MARK: - Coach

@Composable
fun CoachTodayView() = Text("CoachTodayView")

@Composable
fun ClientsView() = Text("ClientsView")

@Composable
fun ScheduleView() = Text("ScheduleView")

@Composable
fun CoachThreadsView() = Text("CoachThreadsView")

@Composable
fun GuidesView() = Text("GuidesView")

// MARK: - Health

/** Health/HealthSync.swift: the foreground sync hook. */
object HealthSync {
    fun syncIfDue(force: Boolean = false) {}
}

// MARK: - Design

/** Design/BrandIntro.swift: the opening animation over the app. */
@Composable
fun BrandIntro() = Text("BrandIntro")

/** `BrandIntro.duration`, in seconds. */
const val BrandIntroDuration: Double = 1.9

/** Design/Format.swift: only the formatters the models use, behaving as Swift's. */
object Fmt {
    fun initials(name: String): String {
        val letters = name.split(" ").filter { it.isNotEmpty() }.take(2).map { it.first() }
        return if (letters.isEmpty()) "?" else letters.joinToString("").uppercase()
    }

    fun planName(id: String?): String =
        if (id == null || id == "none") "No plan" else id.take(1).uppercase() + id.drop(1)

    /** "32 min", or "1h 05m" from an hour. */
    fun duration(minutes: Double): String {
        val m = minutes.roundToInt()
        return if (m < 60) "$m min" else "${m / 60}h ${"%02d".format(m % 60)}m"
    }

    fun number(value: Double, digits: Int = 1): String =
        java.text.NumberFormat.getNumberInstance(Locale.UK)
            .apply { maximumFractionDigits = digits; minimumFractionDigits = 0 }
            .format(value)

    /** "2026-12-01" → "1 Dec", or the input if it doesn't parse. */
    fun dayMonth(s: String?): String {
        if (s == null) return ""
        return runCatching { LocalDate.parse(s).format(DateTimeFormatter.ofPattern("d MMM", Locale.UK)) }.getOrDefault(s)
    }
}
