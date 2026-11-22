package com.jkperformance.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.LettersDue
import com.jkperformance.app.net.NeedsAction
import com.jkperformance.app.net.NeedsItem
import com.jkperformance.app.net.NeedsReason
import com.jkperformance.app.net.NeedsYou
import com.jkperformance.app.net.PersonRef
import com.jkperformance.app.net.SessionsToday
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// MARK: - Coach Today: one ranked "Needs you" list

/**
 * The coach's Today (atelier-spec.md, Coach screens 1): a thin strip with
 * the next session, the letters-due line, then one ranked list with each
 * client once and one action, ending "All caught up". From
 * GET /api/coach/needs-you.
 */
@Composable
fun NeedsYouList(data: NeedsYou, lettersOnly: Boolean, onLettersOnlyChange: (Boolean) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xl)) {
        SessionsStrip(data.sessionsToday)
        val due = data.lettersDue
        if (due != null && due.count > 0) LettersDueHeader(due, lettersOnly) { onLettersOnlyChange(!lettersOnly) }
        if (lettersOnly && due != null) LettersDueList(due) else if (data.items.isNotEmpty()) {
            Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                data.items.forEachIndexed { i, item ->
                    NeedsYouRow(item)
                    if (i < data.items.lastIndex) GroupDivider(Modifier.padding(start = JKSpace.l + JKSize.avatar + JKSpace.m))
                }
            }
        }
        AllCaughtUp()
    }
}

@Composable
private fun LettersDueList(due: LettersDue) {
    Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
        due.clients.orEmpty().forEach { c ->
            val person = PersonRef(id = c.id, name = c.name, initials = c.initials)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = JKSpace.l, vertical = JKSpace.m),
                horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier.weight(1f).navLink { ClientDetailView(clientId = c.id, name = c.name) },
                    horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(initials = c.initials ?: Fmt.initials(c.name))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(c.name, style = JKType.callout, color = JKColors.text)
                        Text(
                            if (c.media == true) "Weekly letter with a voice note" else "Weekly letter",
                            style = JKType.caption, color = JKColors.textSecondary,
                        )
                    }
                }
                val nav = LocalNav.current
                SmallPill("Write letter") { nav.push { LetterComposer(client = person, week = due.week) } }
            }
        }
    }
}

/** "Next: Sam · 07:00 · Studio" and "3 of 5 sessions today"; opens the day agenda. */
@Composable
fun SessionsStrip(sessions: SessionsToday?) {
    val next = sessions?.next
    val nextLine = if (next == null) {
        if ((sessions?.total ?: 0) == 0) "No sessions today" else "No more sessions today"
    } else {
        val who = if (next.isGroup) next.title ?: "Class"
        else next.client?.let { Fmt.firstWord(it.name) } ?: next.title ?: next.kindLabel
        listOfNotNull("Next: $who", Fmt.time(next.start), next.location).joinToString(" · ")
    }
    val countLine = if (sessions == null || sessions.total == 0) "See the day agenda" else "${sessions.done} of ${sessions.total} sessions today"
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget)
            .navLink { DayAgendaView() }
            .padding(vertical = JKSpace.s)
            .semantics(mergeDescendants = true) { contentDescription = "$nextLine. $countLine. Opens the day agenda." },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.week, tint = JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(nextLine, style = JKType.callout, color = JKColors.text)
            Text(countLine, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
        }
        Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
    }
}

/** "Letters due: 6 · about 40 min". Tapping filters the list to them. */
@Composable
fun LettersDueHeader(due: LettersDue, filtering: Boolean, onToggle: () -> Unit) {
    val line = "Letters due: ${due.count}" + (due.estMinutes?.let { " · about $it min" } ?: "")
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget)
            .clickable(onClick = onToggle)
            .semantics(mergeDescendants = true) { selected = filtering },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.letter, tint = JKColors.textSecondary)
        Text(line, style = JKType.callout.monospacedDigit(), color = JKColors.text, modifier = Modifier.weight(1f))
        Text(if (filtering) "Show all" else "Show", style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** One client, once: avatar, reason glyphs, one-line reason and one action. */
@Composable
fun NeedsYouRow(item: NeedsItem) {
    val nav = LocalNav.current
    val glyphs = item.reasons.map { IconKey.fromSymbol(it.iconKey) }.distinct().take(3)
    // A milestone letter only when the milestone is the top reason.
    val milestone: NeedsReason? = item.reasons.firstOrNull()?.takeIf { it.kind == "milestone" }
    val reason = item.reasonLine ?: item.reasons.firstOrNull()?.text ?: ""
    Row(
        Modifier.fillMaxWidth().padding(horizontal = JKSpace.l, vertical = JKSpace.m),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .navLink { ClientDetailView(clientId = item.client.id, name = item.client.name) }
                .semantics(mergeDescendants = true) { contentDescription = "${item.client.name}. $reason" },
            horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
            verticalAlignment = Alignment.Top,
        ) {
            Avatar(initials = item.client.displayInitials)
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                    Text(item.client.name, style = JKType.callout, color = JKColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    glyphs.forEach { Glyph(it, size = JKSize.iconSmall, tint = JKColors.textSecondary) }
                }
                Text(reason, style = JKType.caption, color = JKColors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        item.primaryAction?.let { action ->
            SmallPill(action.label) { nav.push { NeedsDestination(item, action, milestone) } }
        }
    }
}

@Composable
private fun NeedsDestination(item: NeedsItem, action: NeedsAction, milestone: NeedsReason?) {
    when (action.kind) {
        "writeLetter" -> LetterComposer(client = item.client, milestone = milestone)
        "readAnswers" -> CoachSubpage("Forms") { ClientAutomationSection(client = item.client) }
        else -> MessagesThreadView(
            clientId = item.client.id,
            otherName = item.client.name,
            subtitle = item.client.planName ?: Fmt.planName(item.client.plan),
        )
    }
}

/** The end of the list: the brand rule and one serif line. */
@Composable
fun AllCaughtUp() {
    Column(
        Modifier.fillMaxWidth().padding(vertical = JKSpace.l).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        BrandRule()
        Text("All caught up.", style = JKType.quote, color = JKColors.text)
    }
}

/** "Sam Carter" → "Sam". */
fun Fmt.firstWord(name: String): String = name.split(" ").firstOrNull { it.isNotEmpty() } ?: name

