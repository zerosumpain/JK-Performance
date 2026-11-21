package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: client-home (WelcomeView, ClientHomeView, FormViews, FeedbackViews, MessagesView)
@Composable fun WelcomeView() = Text("WelcomeView")
@Composable fun ClientHomeView() = Text("ClientHomeView")
@Composable fun WeeklyFeedbackListView() = Text("WeeklyFeedbackListView")
@Composable fun ReportDetailView(reportId: String) = Text("ReportDetailView")
@Composable fun ReportStatsGrid(stats: ReportStats) = Text("ReportStatsGrid")
@Composable fun PlanList(plan: ReportPlan, linkWorkouts: Boolean = false) = Text("PlanList")
@Composable fun ClientFormsCard(refresh: Int) = Text("ClientFormsCard")
@Composable fun MessagesThreadView(clientId: String?, otherName: String, subtitle: String) = Text("MessagesThreadView")
@Composable fun CoachThreadsView() = Text("CoachThreadsView")
