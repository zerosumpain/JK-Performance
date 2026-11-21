package com.jkperformance.app

// Stand-ins so every slice compiles on its own while the screens are ported in
// parallel. The slice that owns these screens DELETES THIS WHOLE FILE when its
// real composables land (same names and parameters, same package).

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.jkperformance.app.net.*
import java.time.LocalDate

// Slice: coach-automation (AutomationViews, CoachFeedbackViews)
@Composable fun AutoflowsTab() = Text("AutoflowsTab")
@Composable fun FormsTab() = Text("FormsTab")
@Composable fun ClientAutomationSection(client: PersonRef) = Text("ClientAutomationSection")
@Composable fun CoachReportsSection(clientId: String, clientName: String) = Text("CoachReportsSection")
@Composable fun CoachHealthTab(clientId: String, clientName: String) = Text("CoachHealthTab")
@Composable fun WebDeskSheet() = Text("WebDeskSheet")
