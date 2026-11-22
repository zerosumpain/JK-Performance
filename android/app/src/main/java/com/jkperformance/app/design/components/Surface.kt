package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace

/**
 * The containers, in the spec's three levels of hierarchy. No shadows, no
 * gradients: elevation is a surface step.
 */
enum class SurfaceVariant {
    /** No container: directly on the ground. */
    Hero,
    /** An inset surface holding rows split by hairlines ([GroupDivider]). */
    Group,
    /** Surface, radius 12, no border. */
    Card,
    /** The Next card: surface with a 1dp hairline, the only bordered card on Today. */
    Next,
    /** Letters and guides. */
    Paper,
}

/** Full width, the variant's ground, content inset by `padding`. */
fun Modifier.jkSurface(variant: SurfaceVariant = SurfaceVariant.Card, padding: Dp = JKSpace.cardPadding): Modifier {
    val base = this.fillMaxWidth()
    val ground = when (variant) {
        SurfaceVariant.Hero -> base
        SurfaceVariant.Group, SurfaceVariant.Card -> base.background(JKColors.surface, JKShape.card)
        SurfaceVariant.Next -> base.background(JKColors.surface, JKShape.card).border(JKSize.hairline, JKColors.hairline, JKShape.card)
        SurfaceVariant.Paper -> base.background(JKColors.paper, JKShape.card)
    }
    return ground.padding(padding)
}

/** A [jkSurface] holding a column. */
@Composable
fun Surface(
    modifier: Modifier = Modifier,
    variant: SurfaceVariant = SurfaceVariant.Card,
    padding: Dp = JKSpace.cardPadding,
    spacing: Dp = JKSpace.row,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.jkSurface(variant, padding), verticalArrangement = Arrangement.spacedBy(spacing), content = content)
}

/** The hairline between rows of a [SurfaceVariant.Group]. Decorative only. */
@Composable
fun GroupDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(JKSize.hairline).background(JKColors.hairline))
}
