package com.jkperformance.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import java.time.Instant

/** The More list as its own screen in the JK sheet. */
@Composable
fun JKMoreView() {
    Column(Modifier.jkScreen()) {
        ParBackBar(onBack = LocalDismiss.current)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            JKMoreList()
        }
    }
}

/**
 * "More" (plan-act-review.md, Navigation): every client screen that is not a
 * tab, in a quiet list. Each row shows only when the plan includes it, so
 * nothing a plan promises is out of reach and nothing it lacks is a dead end.
 */
@Composable
fun JKMoreList() {
    val gate = AppSession.gate
    val nav = LocalNav.current
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        ParLabel("More")
        Column {
            if (gate.progress) MoreRow("Progress", "Goals, lifts, habits over time, photos") { nav.push(ClientRoute.progress) }
            if (gate.programme || gate.sessions) {
                MoreRow("Your week", "Programme, bookings and the calendar feed") { nav.push(ClientRoute.yourWeek(null)) }
            }
            if (gate.guides) MoreRow("Guides", "JK's guides") { nav.push(ClientRoute.guides) }
            if (gate.habits || gate.nutrition) {
                MoreRow(if (gate.nutrition) "Habits and nutrition" else "Habits", "Today's habits in detail") { nav.push(ClientRoute.nutrition) }
            }
            if (gate.checkin) MoreRow("Past letters", "JK's weekly letters") { nav.push(ClientRoute.letters) }
            MoreRow("Account", "Membership, health, notifications, your data") { nav.push(ClientRoute.account()) }
        }
    }
}

@Composable
private fun MoreRow(title: String, detail: String, onClick: () -> Unit) {
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = JKSize.touchTarget + JKSpace.m)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(vertical = JKSpace.s),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                Text(title, style = JKType.parCardTitle, color = JKColors.text)
                Text(detail, style = JKType.meta, color = JKColors.textTertiary)
            }
            Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textTertiary)
        }
        GroupDivider()
    }
}

/** Past letters: every published letter, newest first. */
@Composable
fun PastLettersView() {
    val nav = LocalNav.current
    var letters by remember { mutableStateOf<List<Report>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ReportsResponse = APIClient.get("/api/reports")
            letters = reply.reports.filter { it.isPublished }.sortedByDescending { it.deliveredAt ?: it.publishedAt ?: Instant.EPOCH }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }
    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        ParBackBar(onBack = LocalDismiss.current)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter).padding(bottom = JKSpace.xxl),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            ParTitle("Past *letters.*")
            Loadable(value = letters, error = error, retry = { load() }) { list ->
                if (list.isEmpty()) EmptyState("JK's letters will gather here.")
                list.forEach { r ->
                    LetterCard(r.displayHeadline, LetterText.caption(r), unread = r.isUnread, milestone = r.isMilestone) {
                        r.id?.let { nav.push(ClientRoute.letter(it)) }
                    }
                }
            }
        }
    }
}
