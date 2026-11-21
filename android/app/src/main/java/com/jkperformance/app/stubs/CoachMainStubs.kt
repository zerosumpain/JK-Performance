package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: coach-main (CoachViews, TodayCards)
@Composable fun CoachTodayView() = Text("CoachTodayView")
@Composable fun ClientsView() = Text("ClientsView")
@Composable fun GuidesView() = Text("GuidesView")
@Composable fun FeedbackDueView(due: FeedbackDue) = Text("FeedbackDueView")
@Composable fun SessionRow(session: Booking, isNext: Boolean) = Text("SessionRow")
@Composable fun ClassDetailView(booking: Booking) = Text("ClassDetailView")
/** Swift `ProgramsView.Tab`. */
enum class ProgramsTab(val label: String) { programs("Programs"), autoflows("Autoflows"), forms("Forms") }
@Composable fun ProgramsView(initialTab: ProgramsTab = ProgramsTab.programs) = Text("ProgramsView")
/** Swift `@Binding var items`: the current list and a setter. */
@Composable fun ItemsEditor(items: List<WorkoutItemInput>, onItemsChange: (List<WorkoutItemInput>) -> Unit) = Text("ItemsEditor")
@Composable fun TodayCards(today: CoachToday) = Text("TodayCards")
