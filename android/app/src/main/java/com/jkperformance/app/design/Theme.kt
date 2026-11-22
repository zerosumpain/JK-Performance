package com.jkperformance.app.design

import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.Modifier.Node
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import kotlinx.coroutines.launch

/*
 * The theme root. The system itself lives in Tokens.kt (colour, spacing, radii,
 * sizes, motion), Type.kt (the type scale), Icons.kt (IconKey) and
 * components/ (Ring, Surface, buttons, Avatar, Label, StatusPill, Toast,
 * EmptyState, HabitMark, WeekDots, GoalLine, CoachNote, NextCard, MetricTile,
 * LetterCard and the shared controls and states).
 */

/**
 * A tapped row dims rather than ripples, as on the iPhone. This draws the dim
 * over whatever is pressed; [JKTheme] makes it the default indication.
 */
private object PressDim : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode = PressDimNode(interactionSource)
    override fun equals(other: Any?) = other === this
    override fun hashCode() = javaClass.hashCode()
}

private class PressDimNode(private val source: InteractionSource) : Node(), DrawModifierNode {
    private var pressed = false

    override fun onAttach() {
        coroutineScope.launch {
            val presses = mutableSetOf<PressInteraction.Press>()
            source.interactions.collect { interaction ->
                when (interaction) {
                    is PressInteraction.Press -> presses += interaction
                    is PressInteraction.Release -> presses -= interaction.press
                    is PressInteraction.Cancel -> presses -= interaction.press
                }
                if (pressed != presses.isNotEmpty()) {
                    pressed = presses.isNotEmpty()
                    invalidateDraw()
                }
            }
        }
    }

    override fun ContentDrawScope.draw() {
        drawContent()
        if (pressed) drawRect(JKColors.scrim.copy(alpha = 0.5f))
    }
}

/**
 * The app root: Material recoloured to the Atelier palette (dark only for now),
 * bone content and [JKType.body] by default, and press-dimming instead of ripples.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JKTheme(content: @Composable () -> Unit) {
    val type = Typography(
        displayLarge = JKType.display,
        displayMedium = JKType.display,
        displaySmall = JKType.display,
        headlineLarge = JKType.display,
        headlineMedium = JKType.headline,
        headlineSmall = JKType.headline,
        titleLarge = JKType.headline,
        titleMedium = JKType.headline,
        titleSmall = JKType.callout,
        bodyLarge = JKType.body,
        bodyMedium = JKType.callout,
        bodySmall = JKType.caption,
        labelLarge = JKType.callout,
        labelMedium = JKType.caption,
        labelSmall = JKType.caption,
    )
    MaterialTheme(colorScheme = JKDarkColorScheme, typography = type) {
        CompositionLocalProvider(
            LocalContentColor provides JKColors.text,
            LocalTextStyle provides JKType.body,
            LocalIndication provides PressDim,
            LocalRippleConfiguration provides null,
            content = content,
        )
    }
}

/** A screen on the ground. The window behind is the same colour (themes.xml), so it runs under the system bars. */
fun Modifier.jkScreen(): Modifier = this.fillMaxSize().background(JKColors.bg)
