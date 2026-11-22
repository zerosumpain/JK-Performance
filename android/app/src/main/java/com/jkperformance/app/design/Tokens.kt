package com.jkperformance.app.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

/*
 * Atelier tokens (docs/design/atelier-spec.md, Tokens). The only place colours,
 * radii, spacing, sizes and motion are written as literals; screens read these.
 * Dark is the signature and ships; light ("paper") is defined and measured
 * (scripts/contrast-check.mjs) so it can follow as a pure token swap.
 */

/** Every semantic colour, as one pair member. [JKColors] is the one the app uses. */
@Immutable
data class JKPalette(
    // Surfaces: elevation comes from surface steps only.
    val bg: Color,
    val surface: Color,
    val raised: Color,
    /** Letters and guides. */
    val paper: Color,
    /** Decorative only: dividers and the Next card border. Never an input boundary or a state. */
    val hairline: Color,
    /** Text fields, steppers and outline buttons (3:1). */
    val inputBorder: Color,
    /** The background of a ring or rule; never carries state on its own. */
    val track: Color,
    /** The not-done week dot outline and idle states that carry meaning (3:1). */
    val trackStrong: Color,
    val scrim: Color,
    // Text.
    val text: Color,
    val textSecondary: Color,
    /** Never on [raised]. */
    val textTertiary: Color,
    // The one accent: achievement and JK only. Never buttons, tabs, toggles, body text, status or warnings.
    val accent: Color,
    val accentPressed: Color,
    /** The goal target band only. */
    val accentWash: Color,
    /** Toggles and selection tint: bone (ink in light), because toggles are not achievement. */
    val accentControl: Color,
    // Actions.
    val primaryFill: Color,
    val primaryLabel: Color,
    val primaryPressed: Color,
    // Status: coach app, desk and Progress charts only, always with a word and a glyph.
    val onTrack: Color,
    val attention: Color,
    val data: Color,
    val error: Color,
    val urgent: Color,
    // Booking kinds: muted dots in the month grid and coach agenda only.
    val inPerson: Color,
    val video: Color,
    val group: Color,
) {
    /** The muted dot for a booking kind (`inperson`, `video`, `group`). */
    fun slot(kind: String): Color = when (kind) {
        "video" -> video
        "group" -> group
        else -> inPerson
    }

    companion object {
        val Dark = JKPalette(
            bg = Color(0xFF0E0D0C),
            surface = Color(0xFF171614),
            raised = Color(0xFF211F1C),
            paper = Color(0xFF1A1815),
            hairline = Color(0xFF2E2B27),
            inputBorder = Color(0xFF6B655C),
            track = Color(0x1AF2EEE7),
            trackStrong = Color(0x66F2EEE7),
            scrim = Color(0x990E0D0C),
            text = Color(0xFFF2EEE7),
            textSecondary = Color(0xFFA39D94),
            textTertiary = Color(0xFF8A847B),
            accent = Color(0xFFC8A970),
            accentPressed = Color(0xFFB08F52),
            accentWash = Color(0x29C8A970),
            accentControl = Color(0xFFF2EEE7),
            primaryFill = Color(0xFFF2EEE7),
            primaryLabel = Color(0xFF0E0D0C),
            primaryPressed = Color(0xFFDCD6CC),
            onTrack = Color(0xFF9FB39A),
            attention = Color(0xFFD98E5B),
            data = Color(0xFF8FA3B3),
            error = Color(0xFFC9735F),
            urgent = Color(0xFFE8816F),
            inPerson = Color(0xFF8FA3B3),
            video = Color(0xFFA898C4),
            group = Color(0xFF9FB39A),
        )

        val Light = JKPalette(
            bg = Color(0xFFF5F0E8),
            surface = Color(0xFFFBF8F3),
            raised = Color(0xFFEDE6DA),
            paper = Color(0xFFFBF6EC),
            hairline = Color(0xFFDDD5C8),
            inputBorder = Color(0xFF8F887E),
            track = Color(0x141C1A17),
            trackStrong = Color(0xFF86817A),
            scrim = Color(0x990E0D0C),
            text = Color(0xFF1C1A17),
            textSecondary = Color(0xFF5E5950),
            textTertiary = Color(0xFF66615A),
            accent = Color(0xFF7A5C2C),
            accentPressed = Color(0xFF664C22),
            accentWash = Color(0x1A7A5C2C),
            accentControl = Color(0xFF1C1A17),
            primaryFill = Color(0xFF1C1A17),
            primaryLabel = Color(0xFFFBF8F3),
            primaryPressed = Color(0xFF3A3631),
            onTrack = Color(0xFF4F6B4A),
            attention = Color(0xFF9A5530),
            data = Color(0xFF4A6072),
            error = Color(0xFF9A4632),
            urgent = Color(0xFFA8432F),
            inPerson = Color(0xFF4A6072),
            video = Color(0xFF6A5A8E),
            group = Color(0xFF4F6B4A),
        )
    }
}

/** The app's colours. Dark only in this batch (owner decision); light is [JKPalette.Light]. */
val JKColors: JKPalette = JKPalette.Dark

/** Material's scheme recoloured to the palette, so any stock component that slips in still matches. */
fun jkColorScheme(p: JKPalette, dark: Boolean): ColorScheme = if (dark) {
    darkColorScheme(
        primary = p.accentControl, onPrimary = p.bg,
        primaryContainer = p.raised, onPrimaryContainer = p.text,
        secondary = p.textSecondary, onSecondary = p.bg,
        secondaryContainer = p.raised, onSecondaryContainer = p.text,
        tertiary = p.textTertiary, onTertiary = p.bg,
        background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text,
        surfaceVariant = p.raised, onSurfaceVariant = p.textSecondary,
        surfaceTint = Color.Transparent,
        surfaceContainerLowest = p.bg, surfaceContainerLow = p.surface, surfaceContainer = p.surface,
        surfaceContainerHigh = p.raised, surfaceContainerHighest = p.raised,
        error = p.error, onError = p.bg,
        outline = p.inputBorder, outlineVariant = p.hairline, scrim = p.scrim,
    )
} else {
    lightColorScheme(
        primary = p.accentControl, onPrimary = p.bg,
        primaryContainer = p.raised, onPrimaryContainer = p.text,
        secondary = p.textSecondary, onSecondary = p.bg,
        secondaryContainer = p.raised, onSecondaryContainer = p.text,
        tertiary = p.textTertiary, onTertiary = p.bg,
        background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text,
        surfaceVariant = p.raised, onSurfaceVariant = p.textSecondary,
        surfaceTint = Color.Transparent,
        surfaceContainerLowest = p.bg, surfaceContainerLow = p.surface, surfaceContainer = p.surface,
        surfaceContainerHigh = p.raised, surfaceContainerHighest = p.raised,
        error = p.error, onError = p.bg,
        outline = p.inputBorder, outlineVariant = p.hairline, scrim = p.scrim,
    )
}

val JKDarkColorScheme: ColorScheme = jkColorScheme(JKPalette.Dark, dark = true)
val JKLightColorScheme: ColorScheme = jkColorScheme(JKPalette.Light, dark = false)

/** The 4dp spacing scale and its named uses. */
object JKSpace {
    val xs = 4.dp
    val s = 8.dp
    val m = 12.dp
    val l = 16.dp
    val xl = 20.dp
    val xxl = 24.dp
    val xxxl = 32.dp
    val huge = 48.dp

    /** Screen gutter (16 under 375dp wide). */
    val gutter = xl
    val gutterNarrow = l
    val cardPadding = xl
    val section = xxxl
    val row = m
    /** Vertical padding inside Primary and Secondary buttons. */
    val buttonVertical = 14.dp
}

/** Corner radii. Rings, dots and avatars are circles. */
object JKRadius {
    val chip = 8.dp
    val control = 10.dp
    val button = 12.dp
    val card = 12.dp
    val sheet = 20.dp
}

object JKShape {
    val chip: Shape = RoundedCornerShape(JKRadius.chip)
    val control: Shape = RoundedCornerShape(JKRadius.control)
    val button: Shape = RoundedCornerShape(JKRadius.button)
    val card: Shape = RoundedCornerShape(JKRadius.card)
    val sheet: Shape = RoundedCornerShape(topStart = JKRadius.sheet, topEnd = JKRadius.sheet)
    val sheetAll: Shape = RoundedCornerShape(JKRadius.sheet)
    val pill: Shape = CircleShape
}

/** Minimum heights and fixed glyph and avatar sizes. Heights on text-bearing things are minimums. */
object JKSize {
    val touchTarget = 48.dp
    val buttonMinHeight = 52.dp
    val habitMark = 56.dp
    val habitMarkMax = 72.dp
    val avatar = 36.dp
    val avatarSmall = 32.dp
    val avatarLarge = 72.dp
    val iconTab = 24.dp
    val iconInline = 20.dp
    val iconSmall = 16.dp
    val iconHabit = 24.dp
    val iconBadge = 10.dp
    val dot = 6.dp
    val hairline = 1.dp
    val outline = 1.5.dp
    val rule = 2.dp
    val ring = 1.5.dp
}

/** Durations (ms) and the one curve. No overshoot, no sheen, no confetti. */
object JKMotion {
    val standardEasing: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    const val STANDARD = 240
    const val HABIT_TICK = 360
    const val DAY_DONE = 600
    const val NUMBER_ROLL = 400
    const val LETTER_OPEN = 280
    const val FILL_FADE = 240
    const val TOAST = 4000
}
