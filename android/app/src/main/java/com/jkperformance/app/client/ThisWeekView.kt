package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.WeekDayMark
import com.jkperformance.app.net.WeekPayload
import com.jkperformance.app.net.WeekSession
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable

/**
 * A tab root in the Plan. Act. Review. style: the JK. mark and JK's avatar on
 * top, then one scrolling column on the gutter, pull to refresh.
 * [footer] stays pinned under the scroll (the primary button).
 */
@Composable
fun ParRootScreen(
    onRefresh: suspend () -> Unit,
    rings: Boolean = false,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(Modifier.jkScreen()) {
        if (rings) FaintRings(centerY = 0.22f)
        Column(Modifier.fillMaxSize()) {
            ParTopBar(
                avatarMediaId = AppSession.me?.coach?.avatarMediaId,
                unread = TabRouter.unread > 0,
                onAvatar = { TabRouter.openJK() },
            )
            JKRefreshable(onRefresh = onRefresh, modifier = Modifier.weight(1f).fillMaxWidth()) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = JKSpace.gutter)
                        .padding(top = JKSpace.l, bottom = JKSpace.xxl),
                    verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
                    content = content,
                )
            }
            if (footer != null) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = JKSpace.gutter).padding(top = JKSpace.m, bottom = JKSpace.m),
                    verticalArrangement = Arrangement.spacedBy(JKSpace.m),
                    content = footer,
                )
            }
        }
    }
}

/** Spoken day for the week line: "Thursday, planning session". */
private fun spokenDay(d: WeekDayMark): String {
    val name = Day.date(d.date)?.let { Fmt.weekdayName(it) } ?: d.letter
    val parts = listOfNotNull(
        name,
        if (d.today) "today" else null,
        when (d.mark) {
            "plan" -> "planning session"
            "review" -> "accountability session"
            else -> null
        },
        if (d.done) "done" else null,
    )
    return parts.joinToString(", ")
}

fun weekLineDays(days: List<WeekDayMark>): List<WeekLineDay> =
    days.map { WeekLineDay(it.letter, it.mark, it.done, it.today, spokenDay(it)) }

/**
 * This week (plan-act-review.md, Screens 2), the Act root: the date, "Good
 * morning, *Sam.*", the week as a line, today's card, the next planning and
 * accountability sessions, and "Begin today →". Everything from GET /api/week.
 */
@Composable
fun ThisWeekView() {
    val nav = LocalNav.current
    var week by remember { mutableStateOf<WeekPayload?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // Bumped by each load, so the campaign cards re-read with the rest of Today.
    var campaignsKey by remember { mutableStateOf(0) }

    suspend fun load() {
        campaignsKey++
        try {
            val fresh: WeekPayload = APIClient.get("/api/week")
            week = fresh
            TabRouter.unread = fresh.unread
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(Unit) {
        load()
        AppSession.refreshMe()
        Reminders.refresh(AppSession.gate, AppSession.me?.preferences)
    }
    // Back from Today's work: re-read.
    var wasCovered by remember { mutableStateOf(false) }
    LaunchedEffect(nav.depth) {
        if (nav.depth > 0) wasCovered = true
        else if (wasCovered) {
            wasCovered = false
            load()
        }
    }

    val w = week
    ParRootScreen(
        onRefresh = { load() },
        footer = if (w != null) ({
            PrimaryButton("Begin today", arrow = true, onClick = { nav.push { TodaysWorkView(initial = week) } })
        }) else null,
    ) {
        Loadable(value = w, error = error, retry = { load() }) { p ->
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                ParLabel(p.dateLabel.ifEmpty { Fmt.fullDay(java.time.LocalDate.now(Day.zone)) })
                val name = p.firstName ?: AppSession.me?.firstName ?: ""
                ParTitle(if (name.isEmpty()) "${p.greeting}." else "${p.greeting},\n*$name.*")
            }
            if (p.days.size == 7) WeekLine(weekLineDays(p.days))
            p.today?.let { t ->
                ParCard(
                    Modifier.fillMaxWidth(),
                    onClick = { nav.push { TodaysWorkView(initial = week) } },
                    onClickLabel = "Open today's work",
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.l), verticalAlignment = Alignment.CenterVertically) {
                        ParRing(t.progress.toFloat(), JKSize.ringHabit, idleStrong = true) {
                            Text("act", style = JKType.annotation, color = JKColors.textSecondary)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                            ParLabel("Today")
                            Text(t.title, style = JKType.parCardTitle, color = JKColors.text)
                        }
                    }
                }
            }
            // Campaigns (desk-v2 F13): an invitation to answer, or the campaign's day.
            CampaignSection(refreshKey = campaignsKey)
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                SessionHalfCard("Plan", p.plan, plan = true, Modifier.weight(1f).fillMaxHeight())
                SessionHalfCard("Review", p.review, plan = false, Modifier.weight(1f).fillMaxHeight())
            }
        }
    }
}

/** PLAN or REVIEW: its glyph, the label, the session's serif title and when. Not booked: opens the JK sheet. */
@Composable
private fun SessionHalfCard(label: String, session: WeekSession?, plan: Boolean, modifier: Modifier) {
    ParCard(
        modifier,
        onClick = {
            if (session == null) TabRouter.openJK()
            else TabRouter.select(if (plan) TabRouter.Client.plan else TabRouter.Client.review)
        },
        onClickLabel = if (session == null) "Message JK" else "Open $label",
        spacing = JKSpace.xs,
    ) {
        if (plan) PlanDiamond(JKSpace.m) else ReviewMark()
        Spacer(Modifier.height(JKSpace.s))
        ParLabel(label)
        Text(session?.title ?: "Not booked yet", style = JKType.parSmall, color = if (session == null) JKColors.textSecondary else JKColors.text)
        session?.`when`?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.meta, color = JKColors.textTertiary) }
    }
}

/** A hairline either side of a quiet line ("Planning with JK on Thursday"). */
@Composable
fun FooterLine(text: String) {
    Row(
        Modifier.fillMaxWidth().semantics { contentDescription = text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        Box(Modifier.weight(1f).height(JKSize.hairline).background(JKColors.hairline))
        Text(text, style = JKType.annotation, color = JKColors.textTertiary)
        Box(Modifier.weight(1f).height(JKSize.hairline).background(JKColors.hairline))
    }
}
