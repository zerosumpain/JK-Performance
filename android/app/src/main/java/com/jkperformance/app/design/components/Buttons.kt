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
 * Actions. One PrimaryButton per screen: ivory fill, never gold, never a
 * gradient. Heights are minimums, so labels can wrap at large font scales.
 * Disabled buttons fade and ignore taps.
 */

@Composable
private fun rememberPress(): Pair<MutableInteractionSource, Boolean> {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    return source to pressed
}

@Composable
fun PrimaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, pressed) = rememberPress()
    CompositionLocalProvider(LocalContentColor provides JKColors.primaryLabel, LocalTextStyle provides JKType.headline) {
        Row(
            modifier
                .fillMaxWidth()
                .heightIn(min = JKSize.buttonMinHeight)
                .alpha(if (enabled) 1f else 0.5f)
                .background(if (pressed) JKColors.primaryPressed else JKColors.primaryFill, JKShape.button)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = JKSpace.l, vertical = JKSpace.buttonVertical),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    PrimaryButton(onClick, modifier, enabled) { Text(text, textAlign = TextAlign.Center) }
}

/** Transparent with a 1dp inputBorder outline and a text-colour label. */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val (source, pressed) = rememberPress()
    CompositionLocalProvider(LocalContentColor provides JKColors.text, LocalTextStyle provides JKType.headline) {
        Row(
            modifier
                .fillMaxWidth()
                .heightIn(min = JKSize.buttonMinHeight)
                .alpha(if (!enabled) 0.5f else if (pressed) 0.7f else 1f)
                .border(JKSize.hairline, JKColors.inputBorder, JKShape.button)
                .clickable(interactionSource = source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = JKSpace.l, vertical = JKSpace.buttonVertical),
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    SecondaryButton(onClick, modifier, enabled) { Text(text, textAlign = TextAlign.Center) }
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
