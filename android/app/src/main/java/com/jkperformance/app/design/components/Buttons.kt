package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.semibold

/*
 * Actions (docs/design/plan-act-review.md, Shapes and components). One
 * PrimaryButton per screen: a chrome capsule (a slanted silver gradient with a
 * 1dp top highlight) and a dark label. SecondaryButton: a transparent capsule
 * with a 1dp outline. Heights are minimums, so labels can wrap at large font
 * scales. Disabled buttons fade and ignore taps.
 */

@Composable
private fun rememberPress(): Pair<MutableInteractionSource, Boolean> {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    return source to pressed
}

/** The chrome fill behind a primary button, drawn to its size. */
private fun Modifier.chrome(pressed: Boolean): Modifier = this.drawWithCache {
    val shape = CircleShape.createOutline(size, layoutDirection, this)
    val fill = Brush.linearGradient(
        listOf(JKColors.chromeTop, JKColors.chromeMid, JKColors.chromeBottom),
        start = Offset(0f, 0f),
        end = Offset(size.width * 0.35f, size.height * 2.2f),
    )
    val highlight = Brush.verticalGradient(
        0f to JKColors.chromeHighlight,
        0.35f to JKColors.chromeHighlight.copy(alpha = 0f),
    )
    val stroke = 1.dp.toPx()
    onDrawBehind {
        drawOutline(shape, fill)
        drawOutline(shape, highlight, style = Stroke(stroke))
        if (pressed) drawOutline(shape, JKColors.scrim.copy(alpha = 0.18f))
    }
}

@Composable
fun PrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, pressed) = rememberPress()
    CompositionLocalProvider(LocalContentColor provides JKColors.onChrome, LocalTextStyle provides JKType.button) {
        Row(
            modifier
                .fillMaxWidth()
                .heightIn(min = JKSize.primaryHeight)
                .alpha(if (enabled) 1f else 0.45f)
                .chrome(pressed)
                .clip(CircleShape)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = JKSpace.xl, vertical = JKSpace.buttonVertical),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

/** A primary button with a text label and, optionally, the trailing arrow ("Begin today →"). */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, arrow: Boolean = false) {
    PrimaryButton(onClick, modifier, enabled) {
        Text(text, textAlign = TextAlign.Center)
        if (arrow) Glyph(IconKey.arrow, size = JKSize.iconSmall, tint = JKColors.onChrome)
    }
}

/** Transparent capsule with a 1dp outline and a text-colour label; [small] is the 32dp "Prepare →". */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    small: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, pressed) = rememberPress()
    CompositionLocalProvider(LocalContentColor provides JKColors.text, LocalTextStyle provides if (small) JKType.buttonSmall else JKType.button) {
        Row(
            (if (small) modifier.heightIn(min = JKSize.smallButtonHeight) else modifier.fillMaxWidth().heightIn(min = JKSize.primaryHeight))
                .alpha(if (!enabled) 0.45f else if (pressed) 0.7f else 1f)
                .border(JKSize.hairline, JKColors.buttonBorder, CircleShape)
                .clip(CircleShape)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(
                    horizontal = if (small) JKSpace.m else JKSpace.xl,
                    vertical = if (small) JKSpace.xs else JKSpace.buttonVertical,
                ),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    small: Boolean = false,
    arrow: Boolean = false,
) {
    SecondaryButton(onClick, modifier, enabled, small) {
        Text(text, textAlign = TextAlign.Center)
        if (arrow) Glyph(IconKey.arrow, size = if (small) JKSize.iconBadge + 2.dp else JKSize.iconSmall, tint = JKColors.text)
    }
}

/** A quiet text action ("Try again", "Edit", "Undo"): callout in text colour, 48dp minimum target. */
@Composable
fun TextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, pressed) = rememberPress()
    CompositionLocalProvider(LocalContentColor provides JKColors.text, LocalTextStyle provides JKType.callout) {
        Row(
            modifier
                .heightIn(min = JKSize.touchTarget)
                .alpha(if (!enabled) 0.5f else if (pressed) 0.6f else 1f)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = JKSpace.xs),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.xs),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun TextButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    TextButton(onClick, modifier, enabled) { Text(text) }
}

/** The confirming variant of [TextButton] ("Save", "Done"). */
@Composable
fun TextButtonStrong(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    TextButton(onClick, modifier, enabled) { Text(text, style = JKType.callout.semibold()) }
}
