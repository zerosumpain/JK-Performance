package com.jkperformance.app.design.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.isAccessibilityFontScale
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.monospacedDigit
import com.jkperformance.app.net.Goal
import com.jkperformance.app.net.HabitHistory
import com.jkperformance.app.net.HabitHistoryEntry
import com.jkperformance.app.net.HabitWeekDay
import com.jkperformance.app.net.RestDay

// Coach-only components (atelier-spec.md, "Components › COACH"): the habit
// week grid, the goal card, sparklines and the plain rows a client's page
// links from. Status colours appear here only, never on client screens.

/**
 * Seven dots without day letters (coach rows): done is an accent fill, not
 * done a trackStrong outline, today a text-colour ring, rest no dot.
 */
@Composable
fun DotRow(days: List<WeekDay>, modifier: Modifier = Modifier) {
    Row(
        modifier.clearAndSetSemantics { contentDescription = days.joinToString("; ") { it.spoken } },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        days.forEach { day ->
            val dot = Modifier.size(JKSize.dot + JKSize.outline * 2)
            when (day.state) {
                DotState.Done -> Box(dot.background(JKColors.accent, CircleShape))
                DotState.NotDone -> Box(dot.border(JKSize.outline, JKColors.trackStrong, CircleShape))
                DotState.Today -> Box(dot.border(JKSize.outline, JKColors.text, CircleShape))
                DotState.Future -> Box(dot.border(JKSize.outline, JKColors.track, CircleShape))
                DotState.Rest -> Box(dot)
            }
        }
    }
}

/**
 * One row per habit: glyph, name, the last seven days as dots, the week's
 * count and the change on last week (a glyph, never red). Rest days in the
 * week follow as one line each.
 */
@Composable
fun HabitWeekGrid(history: HabitHistory, restDays: List<RestDay> = emptyList(), modifier: Modifier = Modifier) {
    val days = run {
        val fromDays = history.days?.map { it.date }.orEmpty()
        val fromHabit = history.habits.firstOrNull()?.days?.map { it.date }.orEmpty()
        (fromDays.ifEmpty { fromHabit }).takeLast(7)
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        if (history.habits.isEmpty()) Text("No habits set yet.", style = JKType.caption, color = JKColors.textSecondary)
        history.habits.forEach { HabitWeekRow(it, days) }
        restDays.filter { it.date in days }.forEach { rest ->
            val day = Day.date(rest.date)?.let { Fmt.weekdayName(it) } ?: rest.date
            val line = rest.reason?.takeIf { it.isNotEmpty() }?.let { "Rest day $day · $it" } ?: "Rest day $day"
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                Glyph(IconKey.rest, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                Text(line, style = JKType.caption, color = JKColors.textSecondary)
            }
        }
    }
}

@Composable
private fun HabitWeekRow(habit: HabitHistoryEntry, days: List<String>) {
    val byDate = habit.days.associateBy { it.date }
    val entries = days.map { d ->
        val day = byDate[d]
        weekDayOf(d, done = day?.done == true, rest = day?.rest == true, future = false, isToday = d == Day.today)
    }
    val done = entries.count { it.state == DotState.Done }
    val counted = entries.count { it.state != DotState.Rest }
    val now = habit.rate7
    val before = habit.rate7Prev
    val change = if (now != null && before != null) now - before else null
    val trend = when {
        change == null -> null
        change > 0.05 -> IconKey.trendUp
        change < -0.05 -> IconKey.trendDown
        else -> IconKey.trendFlat
    }
    val trendWord = when (trend) {
        IconKey.trendUp -> "Up on last week"
        IconKey.trendDown -> "Down on last week"
        else -> "Level with last week"
    }
    val name = @Composable { m: Modifier ->
        Row(m, horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
            Glyph(habit.key, size = JKSize.iconInline, tint = JKColors.textSecondary)
            Text(habit.name, style = JKType.callout, color = JKColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    val count = @Composable {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.xs), verticalAlignment = Alignment.CenterVertically) {
            Text("$done of $counted", style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
            if (trend != null) Glyph(trend, size = JKSize.iconSmall, tint = JKColors.textSecondary, contentDescription = trendWord)
        }
    }
    val described = Modifier.semantics(mergeDescendants = true) {
        contentDescription = "${habit.name}, $done of $counted days this week" + if (trend != null) ". $trendWord" else ""
    }
    if (isAccessibilityFontScale()) {
        Column(described, verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            name(Modifier)
            DotRow(entries)
            count()
        }
    } else {
        Row(described.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
            name(Modifier.weight(1f))
            DotRow(entries)
            count()
        }
    }
}

/**
 * The client's goal on the coach's overview: the sentence, start, now and
 * target, weeks left and a 44dp arc. A draft says where it came from.
 */
@Composable
fun GoalCard(goal: Goal?, onEdit: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        if (goal != null && !goal.isDraft) {
            Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(JKSpace.l)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Text(goal.title, style = JKType.title, color = JKColors.text)
                    Text(goalFigures(goal), style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                    val progress = goalProgressLine(goal)
                    if (progress.isNotEmpty()) Text(progress, style = JKType.caption, color = JKColors.textSecondary)
                    goal.chapterName?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
                }
                Ring(goal.fraction, lineWidth = JKSpace.xs, modifier = Modifier.size(44.dp), color = JKColors.accent, sweep = 300f)
            }
            TextButton("Edit goal", onClick = onEdit)
        } else {
            val line = if (goal == null) "No goal yet. Set one with them."
            else "Suggested from onboarding: ${goal.suggestion ?: goal.title}. Set the goal."
            Text(line, style = JKType.quoteSheet, color = JKColors.text)
            SecondaryButton("Set the goal", onClick = onEdit)
        }
    }
}

private fun goalFigures(goal: Goal): String {
    val unit = goal.unit?.let { " $it" } ?: ""
    return listOfNotNull(
        goal.baseline?.let { "Start ${Fmt.number(it)}" },
        goal.current?.let { "Now ${Fmt.number(it)}" },
        goal.target?.let { "Target ${Fmt.number(it)}$unit" },
    ).joinToString(" · ")
}

private fun goalProgressLine(goal: Goal): String {
    val parts = mutableListOf<String>()
    if (goal.isReached) parts += "Reached" else goal.remainingLabel?.let { parts += it }
    goal.weekOf?.let { w ->
        val left = maxOf(0, w.weeks - w.week)
        parts += if (left == 1) "1 week left" else "$left weeks left"
    }
    goal.onTrack?.let { parts += if (it) "On track" else "Worth a look" }
    return parts.joinToString(" · ")
}

/** A 7-day line in slate, for the coach's health numbers. Decorative: the number beside it carries the value. */
@Composable
fun Sparkline(values: List<Double?>, modifier: Modifier = Modifier) {
    val points = values.mapIndexedNotNull { i, v -> v?.let { i to it } }
    if (points.size < 2) {
        Box(modifier.fillMaxWidth().height(JKSize.hairline).background(JKColors.track))
        return
    }
    val line = JKColors.data
    Canvas(modifier.fillMaxWidth().clearAndSetSemantics { }) {
        val ys = points.map { it.second }
        val low = ys.min()
        val high = ys.max()
        val pad = maxOf((high - low) * 0.15, 1.0)
        val lo = low - pad
        val span = (high + pad) - lo
        val n = (values.size - 1).coerceAtLeast(1)
        val path = Path()
        points.forEachIndexed { i, (x, y) ->
            val px = size.width * x / n
            val py = size.height * (1 - ((y - lo) / span)).toFloat()
            if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, line, style = Stroke(JKSize.outline.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** A pushed coach page: an inline title over a scrolling column. */
@Composable
fun CoachSubpage(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.jkScreen()) {
        TopBar(title)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
            content = content,
        )
    }
}

/** A row in an inset group: glyph, title, optional detail, chevron. */
@Composable
fun CoachRowLabel(
    title: String,
    modifier: Modifier = Modifier,
    icon: IconKey? = null,
    detail: String? = null,
    chevron: Boolean = true,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget + JKSpace.s)
            .padding(horizontal = JKSpace.l, vertical = JKSpace.s),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Box(Modifier.width(JKSize.iconInline + JKSpace.s), contentAlignment = Alignment.Center) {
            Glyph(icon, size = JKSize.iconInline, tint = JKColors.textSecondary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.callout, color = JKColors.text)
            if (!detail.isNullOrEmpty()) Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
        if (chevron) Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
    }
}

/** A section heading on coach pages: headline weight, sentence case. */
@Composable
fun CoachSectionTitle(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.Bottom) {
        Text(text, style = JKType.headline, color = JKColors.text, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** The 7-dot habit week from a ClientSummary (done, not done, rest gap). */
@Composable
fun ClientWeekDots(week: List<HabitWeekDay>, modifier: Modifier = Modifier) {
    DotRow(
        week.map { d -> weekDayOf(d.date, done = d.state == "done", rest = d.state == "rest", future = false, isToday = d.date == Day.today) },
        modifier,
    )
}

