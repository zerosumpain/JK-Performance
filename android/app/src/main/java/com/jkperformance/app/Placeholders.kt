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
