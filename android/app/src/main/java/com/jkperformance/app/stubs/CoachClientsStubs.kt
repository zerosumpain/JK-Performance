package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: coach-clients (ClientDetailViews, ScheduleViews)
/** Swift `ClientDetailView.Tab`. */
enum class ClientDetailTab(val label: String) { plan("Plan"), feedback("Feedback"), health("Health"), habits("Habits"), sessions("Sessions") }
@Composable fun ClientDetailView(clientId: String, name: String, initialTab: ClientDetailTab = ClientDetailTab.plan) = Text("ClientDetailView")
@Composable fun ScheduleView() = Text("ScheduleView")
