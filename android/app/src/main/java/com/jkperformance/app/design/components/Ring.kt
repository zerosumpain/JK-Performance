package com.jkperformance.app.design.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.JKColors

/**
 * The shared progress arc (GoalHero, the coach GoalCard arc, the Fuel kcal ring,
 * the rest timer). `sweep` is the full arc: 360 for a ring, 300 for the open
 * GoalHero dial, whose default start leaves the gap at the bottom. The stroke
 * straddles the frame edge; `content` sits in the middle.
 */
@Composable
fun Ring(
    fraction: Double,
    lineWidth: Dp,
    modifier: Modifier = Modifier,
    color: Color = JKColors.text,
    track: Color = JKColors.track,
    sweep: Float = 360f,
    startAngle: Float = if (sweep >= 360f) -90f else 90f + (360f - sweep) / 2f,
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val stroke = lineWidth.toPx()
            val cap = if (sweep >= 360f) StrokeCap.Butt else StrokeCap.Round
            drawArc(track, startAngle, sweep, useCenter = false, style = Stroke(stroke, cap = cap))
            val filled = sweep * fraction.coerceIn(0.0, 1.0).toFloat()
            if (filled > 0f) drawArc(color, startAngle, filled, useCenter = false, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        content()
    }
}
