package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.AttentionItem
import com.jkperformance.app.net.Booking
import com.jkperformance.app.net.CoachToday
import com.jkperformance.app.net.FeedbackDue
import com.jkperformance.app.net.PersonAt
import com.jkperformance.app.net.PersonRef
import com.jkperformance.app.net.TabRouter
import java.time.Instant
import java.time.LocalDate
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * The coach's Today screen as a grid of cards: each says what's waiting,
 * how many, and when it's from or due, and opens the list behind it.
 * Urgent clients sit above the grid; today's sessions below it.
 *
 * Emits its sections straight into the caller's column (as the Swift view's
 * body does into the parent VStack), so the screen's spacing applies between them.
 */
@Composable
fun TodayCards(today: CoachToday) {
    val now = Instant.now()
    val sessions = today.sessions.sortedBy { it.start }
    val upcomingSessions = sessions.filter { it.end > now }

    val urgent = today.urgent
    if (!urgent.isNullOrEmpty()) UrgentCard(urgent)

    // SwiftUI's two-column LazyVGrid; a lazy grid can't sit inside the screen's
    // scroll, so the cards go in rows of two, each row as tall as its taller card.
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        GridRow {
            NextSessionCard(sessions, upcomingSessions, cell())
            MessagesCard(today, cell())
        }
        GridRow {
            val checkins = today.checkinsToReview ?: 0
            SummaryCard(
                systemName = "square.and.pencil",
                title = "Check-ins",
                count = checkins,
                detail = oldest(today.checkinClients)?.let { "Oldest ${Fmt.relative(it)}" } ?: "All replied",
                tint = if (checkins > 0) JKColors.attention else null,
                modifier = cell().cardLink(enabled = checkins > 0) {
                    PeopleListView(
                        title = "Check-ins to reply to",
                        people = (today.checkinClients ?: emptyList()).map { p ->
                            PeopleListRow(person = p.ref, detail = p.at?.let { "Sent ${Fmt.relative(it)}" } ?: "", tab = ClientDetailTab.feedback)
                        },
                    )
                },
            )
            val forms = today.formsToReview ?: 0
            SummaryCard(
                systemName = "doc.text",
                title = "Forms to read",
                count = forms,
                detail = names(today.formClients?.map { it.name }) ?: "Nothing new",
                tint = if (forms > 0) JKColors.attention else null,
                modifier = cell().cardLink { ProgramsView(initialTab = ProgramsTab.forms) },
            )
        }
        GridRow {
            FeedbackCard(today.feedbackDue, cell())
            val quiet = today.quiet ?: emptyList()
            SummaryCard(
                systemName = "moon.zzz",
                title = "Gone quiet",
                count = quiet.size,
                detail = quiet.firstOrNull()?.let { "${it.name.split(" ").first()} · ${it.days} days" } ?: "Everyone's in touch",
                tint = null,
                modifier = cell().cardLink(enabled = quiet.isNotEmpty()) {
                    PeopleListView(
                        title = "Not spoken to lately",
                        people = quiet.map { PeopleListRow(person = it.ref, detail = "No contact in ${it.days} days", tab = ClientDetailTab.plan) },
                    )
                },
            )
        }
        GridRow {
            SummaryCard(
                systemName = "bolt",
                title = "Autoflows",
                count = today.upcoming?.size ?: 0,
                detail = autoflowDetail(today),
                tint = null,
                countLabel = "this week",
                modifier = cell().cardLink { ProgramsView(initialTab = ProgramsTab.autoflows) },
            )
            SummaryCard(
                systemName = "calendar",
                title = "This week",
                count = today.sessionsLeftThisWeek ?: 0,
                detail = "sessions still to come",
                tint = null,
                modifier = cell().cardButton { TabRouter.coach = TabRouter.Coach.today },
            )
        }
    }

    val inactive = (today.attention ?: emptyList()).filter { it.kind == "inactive" }
    if (inactive.isNotEmpty()) {
        Label(text = "No training lately")
        Column(Modifier.jkSurface(padding = 2.dp)) {
            inactive.forEach { item ->
                PersonRow(item.client, item.reason, Modifier.navLink { ClientDetailView(clientId = item.client.id, name = item.client.name) })
            }
        }
    }

    Label(text = "Sessions today", trailing = if (sessions.isEmpty()) null else "${upcomingSessions.size} to go")
    if (sessions.isEmpty()) {
        Text("Nothing booked today.", style = JKType.caption, color = JKColors.textTertiary)
    }
    sessions.forEach { s ->
        SessionRow(session = s, isNext = s.id == upcomingSessions.firstOrNull()?.id)
    }
}

// MARK: Cards

@Composable
private fun UrgentCard(items: List<AttentionItem>) {
    Column(
        Modifier
            .border(1.dp, JKColors.urgent.copy(alpha = 0.55f), JKShape.card)
            .jkSurface(padding = 2.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        IconLabel(if (items.size == 1) "Needs you first" else "${items.size} need you first", icon = IconKey.warning, style = JKType.caption.semibold(), color = JKColors.urgent, modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp))
        items.forEach { item ->
            PersonRow(
                item.client,
                item.reason,
                Modifier.navLink { ClientDetailView(clientId = item.client.id, name = item.client.name, initialTab = ClientDetailTab.feedback) },
            )
        }
    }
}

@Composable
private fun NextSessionCard(sessions: List<Booking>, upcoming: List<Booking>, modifier: Modifier) {
    val next = upcoming.firstOrNull()
    if (next != null) {
        SummaryCard(
            systemName = "clock",
            title = "Next session",
            value = Fmt.time(next.start),
            detail = "${next.client?.name ?: next.title ?: next.kindLabel} · ${Fmt.countdown(to = next.start) ?: "now"}",
            tint = JKColors.slot(next.kind),
            modifier = modifier.cardLink {
                val c = next.client
                if (c != null && !next.isGroup) ClientDetailView(clientId = c.id, name = c.name) else ClassDetailView(booking = next)
            },
        )
    } else {
        SummaryCard(
            systemName = "clock",
            title = "Sessions today",
            value = if (sessions.isEmpty()) "None" else "Done",
            detail = if (sessions.isEmpty()) "Nothing booked" else "All ${sessions.size} finished",
            tint = null,
            modifier = modifier.cardButton { TabRouter.coach = TabRouter.Coach.today },
        )
    }
}

@Composable
private fun MessagesCard(today: CoachToday, modifier: Modifier) {
    val newest = today.unreadClients?.firstOrNull()?.at
    SummaryCard(
        systemName = "bubble.left",
        title = "Messages",
        count = today.unread,
        detail = newest?.let { "Newest ${Fmt.relative(it)} · ${names(today.unreadClients?.map { c -> c.name }) ?: ""}" } ?: "No unread",
        tint = if (today.unread > 0) JKColors.attention else null,
        countLabel = "unread",
        modifier = modifier.cardButton { TabRouter.coach = TabRouter.Coach.messages },
    )
}

@Composable
private fun FeedbackCard(due: FeedbackDue?, modifier: Modifier) {
    val count = due?.clients?.size ?: 0
    SummaryCard(
        systemName = "text.bubble",
        title = "Feedback to write",
        count = count,
        detail = if (count == 0) "All published" else dueText(due),
        tint = when {
            count > 0 && isOverdue(due) -> JKColors.urgent
            count > 0 -> JKColors.attention
            else -> null
        },
        modifier = modifier.cardLink(enabled = count > 0) { if (due != null) FeedbackDueView(due = due) },
    )
}

private fun autoflowDetail(today: CoachToday): String {
    val first = today.upcoming?.firstOrNull() ?: return "Nothing due"
    val whenText = Day.date(first.date)?.let { if (Day.same(it, Instant.now())) "today" else Fmt.weekday(it) } ?: first.date
    return "${first.client.name.split(" ").first()} · ${first.action} $whenText"
}

// MARK: Helpers

/** Two cards side by side, as tall as the taller one. */
@Composable
private fun GridRow(content: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

/** One grid cell: an equal share of the row, full row height. */
private fun RowScope.cell(): Modifier = Modifier.weight(1f).fillMaxHeight()

/** A card that opens `destination`, its press-dim clipped to the card's corners. */
@Composable
private fun Modifier.cardLink(enabled: Boolean = true, destination: @Composable () -> Unit): Modifier =
    clip(JKShape.card).navLink(enabled, destination)

/** A card that acts in place (switching tab), like `Button { } .buttonStyle(.plain)`. */
private fun Modifier.cardButton(action: () -> Unit): Modifier =
    clip(JKShape.card).clickable(onClick = action)

@Composable
private fun PersonRow(p: PersonRef, reason: String, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(initials = p.displayInitials, size = 30.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(p.name, style = JKType.callout.semibold(), color = JKColors.text)
            Text(reason, style = JKType.caption, color = JKColors.textTertiary, maxLines = 2)
        }
        Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
    }
}

private fun oldest(people: List<PersonAt>?): Instant? = people?.mapNotNull { it.at }?.minOrNull()

/** "Sam, Alex +3": the first two first names and how many more. */
private fun names(list: List<String>?): String? {
    if (list.isNullOrEmpty()) return null
    val first = list.take(2).map { it.split(" ").firstOrNull { part -> part.isNotEmpty() } ?: it }
    return first.joinToString(", ") + if (list.size > 2) " +${list.size - 2}" else ""
}

private fun dueText(due: FeedbackDue?): String {
    val by = due?.dueBy?.let(Day::date) ?: return ""
    if (isOverdue(due)) return "Week of ${Fmt.dayMonth(due.week)} · was due ${Fmt.weekday(by)}"
    return if (Day.same(by, Instant.now())) "Due today" else "Due ${Fmt.weekday(by)} ${Fmt.dayMonth(by)}"
}

private fun isOverdue(due: FeedbackDue?): Boolean {
    val by = due?.dueBy?.let(Day::date) ?: return false
    return LocalDate.now(Day.zone) > by
}

/** One card in the Today grid: an icon, a big number (or value), and when. */
@Composable
fun SummaryCard(
    systemName: String,
    title: String,
    detail: String,
    tint: Color?,
    modifier: Modifier = Modifier,
    count: Int? = null,
    value: String? = null,
    countLabel: String? = null,
) {
    val shape = JKShape.card
    Column(
        modifier
            .background(JKColors.surface, shape)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Glyph(IconKey.fromSymbol(systemName), JKType.caption, tint ?: JKColors.textTertiary)
            Spacer(Modifier.weight(1f))
            if (tint != null) Dot(color = tint, size = 7.dp)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            FittingText(
                value ?: "${count ?: 0}",
                style = JKType.numberTile,
                color = if ((count ?: 1) == 0 && value == null) JKColors.textTertiary else JKColors.text,
                minimumScaleFactor = 0.6f,
                modifier = Modifier.alignByBaseline().weight(1f, fill = false),
            )
            if (countLabel != null) {
                Text(countLabel, style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.alignByBaseline())
            }
        }
        Text(title, style = JKType.caption.semibold(), color = JKColors.text)
        Text(detail, style = JKType.caption, color = JKColors.textTertiary, maxLines = 2, minLines = 2)
    }
}

/** One person behind a Today card (Swift `PeopleListView.Row`). */
data class PeopleListRow(
    val person: PersonRef,
    val detail: String,
    val tab: ClientDetailTab,
) {
    val id: String get() = person.id
}

/** A short list of clients behind a Today card, each opening their page. */
@Composable
fun PeopleListView(title: String, people: List<PeopleListRow>) {
    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            ScreenHeader(eyebrow = "Today", title = title)
            if (people.isEmpty()) {
                EmptyCard(title = "Nothing waiting")
            }
            people.forEach { row ->
                Row(
                    Modifier
                        .clip(JKShape.card)
                        .navLink { ClientDetailView(clientId = row.person.id, name = row.person.name, initialTab = row.tab) }
                        .jkSurface(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(initials = row.person.displayInitials, size = 32.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(row.person.name, style = JKType.callout.semibold(), color = JKColors.text)
                        Text(row.detail, style = JKType.caption, color = JKColors.textTertiary)
                    }
                    Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
                }
            }
        }
    }
}
