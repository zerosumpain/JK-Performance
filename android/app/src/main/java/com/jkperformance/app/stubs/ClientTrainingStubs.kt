package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: client-training (TrainingViews, CalendarViews, CalendarExport, Reminders)
@Composable fun WorkoutPlanView() = Text("WorkoutPlanView")
@Composable fun WorkoutDetailLoader(workoutId: String) = Text("WorkoutDetailLoader")
@Composable fun ExercisePickerSheet(onPick: (Exercise) -> Unit) = Text("ExercisePickerSheet")
@Composable fun MyCalendarView(initialDay: LocalDate = LocalDate.now(), embedded: Boolean = false) = Text("MyCalendarView")
@Composable fun BookSessionView(client: PersonRef? = null, initialDay: LocalDate = LocalDate.now()) = Text("BookSessionView")
@Composable fun CalendarSubscribeCard() = Text("CalendarSubscribeCard")
@Composable fun OfflineBanner() = Text("OfflineBanner")
/** Client/Reminders.swift (Swift `Reminders.shared`). */
object Reminders {
    val enabled: Boolean get() = false
    suspend fun enable(checkIn: Boolean = true): Boolean = false
    suspend fun offerIfUndecided(checkIn: Boolean) {}
    fun disable() {}
    fun clearPending() {}
    suspend fun schedule(bookings: List<Booking>, workouts: List<WorkoutSummary>) {}
}
