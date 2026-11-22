package com.jkperformance.app.design.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKMotion
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.rememberReduceMotion

/** The state of one habit today. */
enum class HabitMarkState { Idle, Partial, Done, Rest }

/**
 * One habit on Today: a 24dp unboxed glyph in a 56dp (minimum) target with a
 * caption. Done is the filled glyph in accent; partial shows only in the rule
 * ([HabitRule]); rest is dimmed with the word "Rest"; a habit filled from
 * Health wears a 10dp heart badge in textSecondary. Tap ticks (or adds a step),
 * long press opens the habit. `value` is the spoken state ("2 of 3 glasses").
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HabitMark(
    icon: IconKey,
    name: String,
    state: HabitMarkState,
    value: String,
    modifier: Modifier = Modifier,
    fromHealth: Boolean = false,
    onTap: () -> Unit = {},
    onLongPress: (() -> Unit)? = null,
) {
    val view = LocalView.current
    val done = state == HabitMarkState.Done
    Column(
        modifier
            .sizeIn(minWidth = JKSize.habitMark, minHeight = JKSize.habitMark)
            .combinedClickable(
                onClick = {
                    if (!done) view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                    onTap()
                },
                onLongClick = onLongPress,
            )
            .clearAndSetSemantics {
                contentDescription = name
                stateDescription = if (state == HabitMarkState.Rest) "Rest" else value
                role = Role.Button
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(JKSpace.xs, Alignment.CenterVertically),
    ) {
        Box {
            Glyph(
                icon,
                size = JKSize.iconHabit,
                tint = if (done) JKColors.accent else JKColors.textSecondary,
                filled = done,
                modifier = Modifier.alpha(if (state == HabitMarkState.Rest) 0.5f else 1f),
            )
            if (fromHealth) {
                Glyph(
                    IconKey.fromHealth,
                    size = JKSize.iconBadge,
                    tint = JKColors.textSecondary,
                    filled = true,
                    modifier = Modifier.align(Alignment.TopEnd).offset(x = JKSpace.xs, y = -JKSpace.xs / 2),
                )
            }
        }
        Text(
            if (state == HabitMarkState.Rest) "Rest" else name,
            style = JKType.caption,
            color = if (done) JKColors.text else JKColors.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The shared 2dp rule under a row of habit marks, one segment per habit.
 * `fills` are 0..1 per habit; null is a rest day (no segment). Fills animate
 * over 360ms ease-out, instantly with animations off.
 */
@Composable
fun HabitRule(fills: List<Float?>, modifier: Modifier = Modifier) {
    val reduceMotion = rememberReduceMotion()
    Row(modifier.fillMaxWidth().height(JKSize.rule), horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        fills.forEach { fill ->
            Box(Modifier.weight(1f).fillMaxHeight().background(if (fill == null) JKColors.bg else JKColors.track, JKShape.pill)) {
                val shown by animateFloatAsState(
                    (fill ?: 0f).coerceIn(0f, 1f),
                    tween(if (reduceMotion) 0 else JKMotion.HABIT_TICK, easing = JKMotion.standardEasing),
                    label = "rule",
                )
                if (shown > 0f) Box(Modifier.fillMaxHeight().fillMaxWidth(shown).background(JKColors.accent, JKShape.pill))
            }
        }
    }
}
