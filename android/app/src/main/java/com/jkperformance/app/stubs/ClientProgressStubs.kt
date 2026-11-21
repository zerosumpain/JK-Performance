package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: client-progress (ProgressViews, AccountViews, HealthSync on Health Connect)
@Composable fun AccountView() = Text("AccountView")
@Composable fun HealthDevicesView() = Text("HealthDevicesView")
@Composable fun ActivityRow(activity: HealthActivity) = Text("ActivityRow")
@Composable fun ProgressScreen() = Text("ProgressScreen")
@Composable fun WeeklyCheckInView() = Text("WeeklyCheckInView")
/** Health/HealthSync.swift (Swift `HealthSync.shared`), on Health Connect. */
object HealthSync {
    val optedIn: Boolean get() = false
    val available: Boolean get() = false
    fun syncIfDue(force: Boolean = false) {}
}
