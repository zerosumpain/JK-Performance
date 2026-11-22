package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType

/** One day in [WeekDots]. */
enum class DotState { Done, NotDone, Today, Rest, Future }

class WeekDay(val letter: String, val state: DotState, val spoken: String)

/**
 * Seven columns, each a weekday letter over a 6dp dot: done is an accent fill,
 * not done a 1.5dp trackStrong outline, today a 1.5dp text-colour ring, rest no
 * dot. Shape as well as colour carries the state. Shared by Today, the letter
 * and the coach grid.
 */
@Composable
fun WeekDots(days: List<WeekDay>, modifier: Modifier = Modifier, showLetters: Boolean = true, onTap: ((Int) -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        days.forEachIndexed { i, day ->
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = JKSize.touchTarget)
                    .then(if (onTap != null) Modifier.clickable { onTap(i) } else Modifier)
                    .clearAndSetSemantics { contentDescription = day.spoken },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterVertically),
            ) {
                if (showLetters) {
                    Text(day.letter, style = JKType.caption, color = if (day.state == DotState.Today) JKColors.text else JKColors.textSecondary)
                }
                WeekDot(day.state)
            }
        }
    }
}

@Composable
private fun WeekDot(state: DotState) {
    val dot = Modifier.size(JKSize.dot + JKSize.outline * 2)
    when (state) {
        DotState.Done -> Box(dot.background(JKColors.accent, CircleShape))
        DotState.NotDone -> Box(dot.border(JKSize.outline, JKColors.trackStrong, CircleShape))
        DotState.Today -> Box(dot.border(JKSize.outline, JKColors.text, CircleShape))
        DotState.Future -> Box(dot.border(JKSize.outline, JKColors.track, CircleShape))
        DotState.Rest -> Box(dot)
    }
}
