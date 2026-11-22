package com.jkperformance.app.design.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.isAccessibilityFontScale
import com.jkperformance.app.net.Score

/**
 * Three tabular numbers from the week, each with what it is made from on
 * tap. Shared by the letter and the coach's letter composer.
 */
@Composable
fun ScoreTrio(scores: List<Score>, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf<String?>(null) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        val cell: @Composable (Score, Modifier) -> Unit = { score, m ->
            Column(
                m.heightIn(min = JKSize.touchTarget)
                    .clickable { open = if (open == score.key) null else score.key }
                    .semantics { contentDescription = "${score.label}: ${score.value}. ${score.source ?: ""}" },
                verticalArrangement = Arrangement.spacedBy(JKSpace.xs),
            ) {
                Text(score.value, style = JKType.numberTile, color = JKColors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(score.label, style = JKType.caption, color = JKColors.textSecondary)
            }
        }
        if (isAccessibilityFontScale()) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) { scores.take(3).forEach { cell(it, Modifier.fillMaxWidth()) } }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.l)) { scores.take(3).forEach { cell(it, Modifier.weight(1f)) } }
        }
        val source = scores.firstOrNull { it.key == open }?.source
        AnimatedVisibility(source != null, enter = fadeIn(), exit = fadeOut()) {
            Text(source ?: "", style = JKType.caption, color = JKColors.textSecondary)
        }
    }
}

/** A [WeekDay] from a "YYYY-MM-DD" day state, Monday first ("M", "T"…, spoken "Tuesday, done"). */
fun weekDayOf(day: String, done: Boolean, rest: Boolean, future: Boolean, isToday: Boolean): WeekDay {
    val date = Day.date(day)
    val letter = date?.let { Fmt.weekday(it).take(1) } ?: ""
    val name = date?.let { Fmt.weekdayName(it) } ?: day
    val state = when {
        rest -> DotState.Rest
        done -> DotState.Done
        isToday -> DotState.Today
        future -> DotState.Future
        else -> DotState.NotDone
    }
    val word = when (state) {
        DotState.Rest -> "rest day"
        DotState.Done -> "done"
        DotState.Today -> "today"
        DotState.Future -> "to come"
        DotState.NotDone -> "not done"
    }
    return WeekDay(letter, state, "$name, $word")
}
