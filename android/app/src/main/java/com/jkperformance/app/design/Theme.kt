package com.jkperformance.app.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.DirectionsWalk
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.DirectionsRun
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.automirrored.outlined.TrendingDown
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AlarmOn
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Bed
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DesktopWindows
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FastForward
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Man
import androidx.compose.material.icons.outlined.Medication
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material.icons.outlined.NightsStay
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PedalBike
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Pool
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Rowing
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.SelfImprovement
import androidx.compose.material.icons.outlined.SportsGymnastics
import androidx.compose.material.icons.outlined.SportsMma
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier.Node
import kotlinx.coroutines.launch
import java.time.LocalDate

/*
 * The JK Performance design system, ported from ios/JKPerformance/Design/Theme.swift
 * (and the shared views in Format.swift and the screens) so Compose screens port
 * from SwiftUI line for line. SwiftUI points are dp; font points are sp.
 *
 * Type — SwiftUI text styles live on [JKType] at their iOS point sizes and line
 * heights, with chainable modifiers that read like SwiftUI's:
 *
 *   .font(.caption2.weight(.semibold))      → style = JKType.caption2.semibold()
 *   .font(.subheadline.weight(.medium))     → style = JKType.subheadline.medium()
 *   .font(.system(size: 9, weight: .bold))  → style = JKType.system(9, FontWeight.Bold)
 *   .font(.caption.monospacedDigit())       → style = JKType.caption.monospacedDigit()
 *   .font(.headline.monospaced())           → style = JKType.headline.monospaced()
 *   .tracking(1.4)                          → style = JKType.caption2.tracking(1.4f)
 *
 *   Text("Sets", style = JKType.caption2, color = JK.tertiary)
 *
 * Colours: `.foregroundStyle(JK.secondary)` → `color = JK.secondary`.
 * Buttons: `.buttonStyle(ChromeButtonStyle())` → [ChromeButton]; Ghost → [GhostButton];
 * SmallPillStyle → [SmallPillButton].
 * SF Symbols: `Image(systemName: "dumbbell").font(.title3)` → `SystemImage("dumbbell", JKType.title3)`;
 * a bare vector is [sfIcon]. `Label(text, systemImage:)` → [Label].
 * `ProgressView()` → [ProgressView] (the iOS spoked spinner).
 * The app root wraps everything in [JKTheme].
 */

// region Colours and shape

/** SwiftUI's `Color(white:)`. */
private fun white(level: Float, alpha: Float = 1f) = Color(level, level, level, alpha)

/**
 * The JK Performance look: black ground, near-black cards with a hairline
 * edge, white type, and one "chrome" gradient for the primary action.
 * Reference: docs/coach/screens-v1.webp.
 */
object JK {
    val bg = Color.Black
    val card = white(0.07f)
    val cardRaised = white(0.12f)
    val stroke = white(1f, 0.09f)
    val text = Color.White
    val secondary = white(1f, 0.6f)
    val tertiary = white(1f, 0.38f)
    val track = white(1f, 0.12f)

    /** Top-leading to bottom-trailing across whatever it fills, like SwiftUI's LinearGradient. */
    val chrome: Brush = Brush.linearGradient(
        colors = listOf(white(0.96f), white(0.66f), white(0.92f)),
        start = Offset.Zero,
        end = Offset.Infinite,
    )

    val corner: Dp = 14.dp

    // The few colours that carry meaning: urgent, waiting, and the kinds of slot on the schedule.
    val urgent = Color(1.0f, 0.42f, 0.38f)
    val waiting = Color(1.0f, 0.76f, 0.36f)
    val inPerson = Color(0.40f, 0.68f, 1.0f)
    val video = Color(0.74f, 0.56f, 1.0f)
    val group = Color(0.36f, 0.82f, 0.62f)

    /** The colour of a booking kind (`inperson`, `video`, `group`). */
    fun slot(kind: String): Color = when (kind) {
        "video" -> video
        "group" -> group
        else -> inPerson
    }
}

/**
 * SwiftUI's `RoundedRectangle(cornerRadius:, style: .continuous)`. Compose's
 * corners are circular rather than the iOS squircle; at these radii the
 * difference is a fraction of a point.
 */
fun rounded(radius: Dp) = RoundedCornerShape(radius)

private val cardShape = rounded(JK.corner)

// endregion

// region Type

/**
 * SwiftUI's text styles at iOS's default (Large) Dynamic Type sizes, set in the
 * system sans (Roboto standing in for SF). Line heights are iOS's too, so rows
 * keep the iPhone's vertical rhythm. Sizes are sp, so they follow the phone's
 * font-size setting as Dynamic Type does.
 */
object JKType {
    private fun ios(size: Int, leading: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = FontFamily.Default,
        fontSize = size.sp,
        lineHeight = leading.sp,
        fontWeight = weight,
        letterSpacing = 0.sp,
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    )

    val largeTitle = ios(34, 41)
    val title = ios(28, 34)
    val title2 = ios(22, 28)
    val title3 = ios(20, 25)
    val headline = ios(17, 22, FontWeight.SemiBold)
    val subheadline = ios(15, 20)
    val body = ios(17, 22)
    val callout = ios(16, 21)
    val footnote = ios(13, 18)
    val caption = ios(12, 16)
    val caption2 = ios(11, 13)

    /** `.font(.system(size:weight:))`: a fixed size with the font's natural line height. */
    fun system(size: Number, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontFamily = FontFamily.Default,
        fontSize = size.toFloat().sp,
        fontWeight = weight,
        letterSpacing = 0.sp,
    )
}

fun TextStyle.weight(weight: FontWeight): TextStyle = copy(fontWeight = weight)
fun TextStyle.medium(): TextStyle = weight(FontWeight.Medium)
fun TextStyle.semibold(): TextStyle = weight(FontWeight.SemiBold)
fun TextStyle.bold(): TextStyle = weight(FontWeight.Bold)

/** Tabular figures, so counting numbers (timers, weights) don't jiggle. */
fun TextStyle.monospacedDigit(): TextStyle = copy(fontFeatureSettings = "tnum")

/** `.monospaced()`: the whole run in the monospaced face. */
fun TextStyle.monospaced(): TextStyle = copy(fontFamily = FontFamily.Monospace)

/** `.tracking(points)`: extra space between letters. */
fun TextStyle.tracking(points: Float): TextStyle = copy(letterSpacing = points.sp)

// endregion

// region Theme root

/**
 * iOS highlights a tapped row by dimming it; there is no ripple. This draws the
 * dim over whatever is pressed, and [JKTheme] makes it the default indication
 * so every `clickable` (including [navLink]) behaves the iPhone way.
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
        if (pressed) drawRect(Color.Black.copy(alpha = 0.35f))
    }
}

/**
 * The app root's theme: Material's dark scheme recoloured to JK (white tint,
 * black ground, JK cards) so any stock Material component that slips in still
 * matches, white content by default, [JKType.body] as the default text, and
 * iOS press-dimming instead of ripples.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JKTheme(content: @Composable () -> Unit) {
    val colors = darkColorScheme(
        primary = JK.text,
        onPrimary = Color.Black,
        primaryContainer = JK.cardRaised,
        onPrimaryContainer = JK.text,
        secondary = JK.secondary,
        onSecondary = Color.Black,
        tertiary = JK.tertiary,
        background = JK.bg,
        onBackground = JK.text,
        surface = JK.card,
        onSurface = JK.text,
        surfaceVariant = JK.cardRaised,
        onSurfaceVariant = JK.secondary,
        surfaceContainer = JK.card,
        surfaceContainerHigh = JK.cardRaised,
        surfaceContainerHighest = JK.cardRaised,
        surfaceContainerLow = JK.card,
        surfaceContainerLowest = JK.bg,
        outline = JK.stroke,
        outlineVariant = JK.stroke,
        error = JK.urgent,
        onError = Color.Black,
    )
    val type = Typography(
        displayLarge = JKType.largeTitle,
        displayMedium = JKType.largeTitle,
        displaySmall = JKType.title,
        headlineLarge = JKType.largeTitle,
        headlineMedium = JKType.title,
        headlineSmall = JKType.title2,
        titleLarge = JKType.title3,
        titleMedium = JKType.headline,
        titleSmall = JKType.subheadline.semibold(),
        bodyLarge = JKType.body,
        bodyMedium = JKType.subheadline,
        bodySmall = JKType.footnote,
        labelLarge = JKType.subheadline.semibold(),
        labelMedium = JKType.caption,
        labelSmall = JKType.caption2,
    )
    MaterialTheme(colorScheme = colors, typography = type) {
        CompositionLocalProvider(
            LocalContentColor provides JK.text,
            LocalTextStyle provides JKType.body,
            LocalIndication provides PressDim,
            LocalRippleConfiguration provides null,
            content = content,
        )
    }
}

// endregion

// region Surfaces

/** A small coloured dot, for keys and status. */
@Composable
fun Dot(color: Color, size: Dp = 8.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(color, CircleShape))
}

/** A card: full width, near-black, hairline edge, content leading-aligned inside `padding`. */
fun Modifier.jkCard(padding: Dp = 14.dp): Modifier = this
    .fillMaxWidth()
    .background(JK.card, cardShape)
    .border(1.dp, JK.stroke, cardShape)
    .padding(padding)

/**
 * A screen on the black ground. Fills the space it is given, as a SwiftUI
 * screen's ScrollView does; the window behind is black too (themes.xml), so
 * the ground also runs under the system bars.
 */
fun Modifier.jkScreen(): Modifier = this.fillMaxSize().background(JK.bg)

// endregion

// region Type helpers

/** Small spaced capitals above a title or section ("LIBRARY", "PERSONAL RECORDS"). */
@Composable
fun Eyebrow(text: String, trailing: String? = null, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text.uppercase(), style = JKType.caption2.semibold().tracking(1.4f), color = JK.tertiary)
        Spacer(Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = JKType.caption2, color = JK.tertiary)
    }
}

/** The large left-aligned title every top-level screen opens with. */
@Composable
fun ScreenHeader(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    accessory: @Composable () -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Eyebrow(text = eyebrow)
            Text(title, style = JKType.largeTitle.semibold(), color = JK.text)
        }
        accessory()
    }
}

/**
 * `Image(systemName:)` sized by a text style, as SwiftUI sizes a symbol by its
 * font. Material glyphs sit inside a padded 24-unit box, so the icon box is a
 * little larger than the type to land at the same visible size.
 */
@Composable
fun SystemImage(
    systemName: String,
    style: TextStyle = JKType.body,
    color: Color = LocalContentColor.current,
    modifier: Modifier = Modifier,
) {
    val box = with(LocalDensity.current) { (style.fontSize * SYMBOL_SCALE).toDp() }
    Icon(sfIcon(systemName), contentDescription = null, tint = color, modifier = modifier.size(box))
}

private const val SYMBOL_SCALE = 1.2f

/** SwiftUI's `Label(title, systemImage:)`: a symbol then text, in one style and colour. */
@Composable
fun Label(
    title: String,
    systemImage: String,
    style: TextStyle = JKType.body,
    color: Color = LocalContentColor.current,
    modifier: Modifier = Modifier,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        SystemImage(systemImage, style, color)
        Text(title, style = style, color = color)
    }
}

/**
 * One line of text that shrinks to fit its width, down to
 * `minimumScaleFactor` of its size — SwiftUI's `.lineLimit(1).minimumScaleFactor(x)`.
 */
@Composable
fun FittingText(
    text: String,
    style: TextStyle,
    color: Color,
    minimumScaleFactor: Float,
    modifier: Modifier = Modifier,
    textAlign: TextAlign? = null,
) {
    var scale by remember(text, style) { mutableFloatStateOf(1f) }
    var settled by remember(text, style) { mutableStateOf(false) }
    val scaled = style.copy(
        fontSize = style.fontSize * scale,
        lineHeight = if (style.lineHeight.isSpecified) style.lineHeight * scale else style.lineHeight,
    )
    Text(
        text,
        modifier = modifier.drawWithContent { if (settled) drawContent() },
        style = scaled,
        color = color,
        textAlign = textAlign,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Clip,
        onTextLayout = { result ->
            if (result.didOverflowWidth && scale > minimumScaleFactor) {
                scale = maxOf(minimumScaleFactor, scale * 0.92f)
            } else {
                settled = true
            }
        },
    )
}

// endregion

// region Buttons

/** A tap target that fades while pressed, as SwiftUI button styles do with `isPressed`. */
@Composable
private fun Modifier.pressFade(enabled: Boolean, pressedAlpha: Float, onClick: () -> Unit): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    return this
        .alpha(if (pressed) pressedAlpha else 1f)
        .clickable(interactionSource = source, indication = null, enabled = enabled, onClick = onClick)
}

/**
 * The primary action: black label on the chrome gradient, full width.
 * Disabled buttons look the same and ignore taps, as the iPhone's custom
 * button style does; screens show a spinner or validation state instead.
 */
@Composable
fun ChromeButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val shape = rounded(12.dp)
    CompositionLocalProvider(LocalContentColor provides Color.Black, LocalTextStyle provides JKType.subheadline.semibold()) {
        Row(
            modifier
                .fillMaxWidth()
                .pressFade(enabled, 0.8f, onClick)
                .background(JK.chrome, shape)
                .padding(vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun ChromeButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    ChromeButton(onClick, modifier, enabled) { Text(text) }
}

/** The secondary action: white label on a card, hairline edge, full width. */
@Composable
fun GhostButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val shape = rounded(12.dp)
    CompositionLocalProvider(LocalContentColor provides JK.text, LocalTextStyle provides JKType.subheadline.semibold()) {
        Row(
            modifier
                .fillMaxWidth()
                .pressFade(enabled, 0.7f, onClick)
                .background(JK.card, shape)
                .border(1.dp, JK.stroke, shape)
                .padding(vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    GhostButton(onClick, modifier, enabled) { Text(text) }
}

/** A small quiet capsule action ("Try again", "Edit"): SwiftUI's `SmallPillStyle`. */
@Composable
fun SmallPillButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    CompositionLocalProvider(LocalContentColor provides JK.secondary, LocalTextStyle provides JKType.caption2.semibold()) {
        Row(
            modifier
                .pressFade(enabled, 0.6f, onClick)
                .background(JK.cardRaised, CircleShape)
                .border(1.dp, JK.stroke, CircleShape)
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@Composable
fun SmallPillButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    SmallPillButton(onClick, modifier, enabled) { Text(text) }
}

// endregion

// region Controls

/** A capsule filter chip ("All", "Legs", "Knee"). */
@Composable
fun Chip(label: String, selected: Boolean, modifier: Modifier = Modifier, action: () -> Unit) {
    val ground = if (selected) JK.chrome else SolidColor(JK.card)
    Text(
        label,
        style = JKType.caption.medium(),
        color = if (selected) Color.Black else JK.text,
        maxLines = 1,
        modifier = modifier
            .clip(CircleShape)
            .clickable(onClick = action)
            .background(ground, CircleShape)
            .border(1.dp, JK.stroke, CircleShape)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** The dark segmented control ("3M 6M All", "Week Month", "Programs Autoflows Forms"). */
@Composable
fun <T> Segmented(
    options: List<T>,
    selection: T,
    onSelectionChange: (T) -> Unit,
    modifier: Modifier = Modifier,
    label: (T) -> String,
) {
    val outer = rounded(10.dp)
    val inner = rounded(8.dp)
    Row(
        modifier
            .fillMaxWidth()
            .background(JK.card, outer)
            .border(1.dp, JK.stroke, outer)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEach { option ->
            val on = option == selection
            Box(
                Modifier
                    .weight(1f)
                    .background(if (on) JK.cardRaised else Color.Transparent, inner)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        onSelectionChange(option)
                    }
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                FittingText(
                    label(option),
                    style = JKType.caption.semibold(),
                    color = if (on) JK.text else JK.tertiary,
                    minimumScaleFactor = 0.75f,
                )
            }
        }
    }
}

/** A thin white-on-grey bar. */
@Composable
fun ThinBar(fraction: Double, height: Dp = 3.dp, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(height).background(JK.track, CircleShape)) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0.0, 1.0).toFloat())
                .background(JK.text, CircleShape),
        )
    }
}

/**
 * A ring that fills clockwise from 12 o'clock over a track — the iPhone's
 * `Circle().trim(...).stroke(...).rotationEffect(-90°)` pair (rest timer,
 * nutrition). The stroke straddles the frame's edge as SwiftUI's does;
 * `content` sits in the middle.
 */
@Composable
fun ProgressRing(
    fraction: Double,
    lineWidth: Dp,
    modifier: Modifier = Modifier,
    color: Color = JK.text,
    track: Color = JK.track,
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val stroke = lineWidth.toPx()
            drawCircle(track, style = Stroke(stroke))
            val sweep = 360f * fraction.coerceIn(0.0, 1.0).toFloat()
            if (sweep > 0f) {
                drawArc(color, -90f, sweep, useCenter = false, style = Stroke(stroke, cap = StrokeCap.Round))
            }
        }
        content()
    }
}

/** A rounded square holding an SF Symbol, the leading mark on list rows. */
@Composable
fun IconTile(systemName: String, size: Dp = 38.dp, modifier: Modifier = Modifier) {
    val shape = rounded(10.dp)
    Box(
        modifier
            .size(size)
            .background(JK.cardRaised, shape)
            .border(1.dp, JK.stroke, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(sfIcon(systemName), contentDescription = null, tint = JK.text, modifier = Modifier.size(size * 0.42f * SYMBOL_SCALE))
    }
}

/** Initials in a circle (leaderboards, client lists). */
@Composable
fun Avatar(initials: String, size: Dp = 30.dp, modifier: Modifier = Modifier) {
    val fontSize = with(LocalDensity.current) { (size * 0.34f).toSp() }
    Box(
        modifier
            .size(size)
            .background(JK.cardRaised, CircleShape)
            .border(1.dp, JK.stroke, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = JKType.system(fontSize.value, FontWeight.SemiBold), color = JK.text, maxLines = 1)
    }
}

/** The round check at the end of a habit row. */
@Composable
fun CheckCircle(on: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.size(24.dp), contentAlignment = Alignment.Center) {
        if (on) {
            Box(Modifier.matchParentSize().background(JK.text, CircleShape))
            SystemImage("checkmark", JKType.caption.bold(), Color.Black)
        } else {
            Box(Modifier.matchParentSize().border(BorderStroke(1.5.dp, JK.tertiary), CircleShape))
        }
    }
}

/** A week (or any run) of day buttons; the selected day wears the chrome, `marked` days ("YYYY-MM-DD") get a dot. */
@Composable
fun DayStrip(
    days: List<LocalDate>,
    selected: LocalDate,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    marked: Set<String> = emptySet(),
) {
    val shape = rounded(10.dp)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        days.forEach { d ->
            val on = Day.same(d, selected)
            val ink = if (on) Color.Black else JK.text
            Column(
                Modifier
                    .weight(1f)
                    .clip(shape)
                    .clickable { onSelect(Day.start(d)) }
                    .background(if (on) JK.chrome else SolidColor(JK.card), shape)
                    .border(1.dp, JK.stroke, shape)
                    .padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(Fmt.weekday(d), style = JKType.system(10), color = ink)
                Text("${d.dayOfMonth}", style = JKType.subheadline.semibold(), color = ink)
                val dot = when {
                    !marked.contains(Day.string(d)) -> Color.Transparent
                    on -> Color.Black
                    else -> JK.secondary
                }
                Dot(dot, size = 4.dp)
            }
        }
    }
}

/** A dated row: weekday over day number, a title and detail, and a chevron (Home, client detail, feedback plans). */
@Composable
fun UpcomingRow(
    weekday: String,
    day: String,
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    chevron: Boolean = true,
) {
    Row(modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(34.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(weekday.uppercase(), style = JKType.system(9, FontWeight.SemiBold), color = JK.tertiary)
            Text(day, style = JKType.headline, color = JK.text)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.medium(), color = JK.text)
            Text(detail, style = JKType.caption2, color = JK.tertiary)
        }
        if (chevron) SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

/** A small outlined capsule for a change ("+2.1 kg"). */
@Composable
fun DeltaBadge(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = JKType.caption2.semibold(),
        color = JK.secondary,
        modifier = modifier
            .border(1.dp, JK.stroke, CircleShape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** A small card with a label, a big value that shrinks to fit, and an optional delta line. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, delta: String? = null) {
    Column(modifier.jkCard(padding = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = JKType.system(10), color = JK.tertiary)
        FittingText(value, style = JKType.title3.semibold(), color = JK.text, minimumScaleFactor = 0.6f)
        if (delta != null) Text(delta, style = JKType.system(10), color = JK.tertiary)
    }
}

/** Placeholder for a screen not built yet. */
@Composable
fun ComingSoon(title: String, systemName: String, modifier: Modifier = Modifier) {
    Column(
        modifier.jkScreen(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        SystemImage(systemName, JKType.system(36), JK.tertiary)
        Text(title, style = JKType.title2.semibold(), color = JK.text)
        Text("Not designed yet", style = JKType.footnote, color = JK.tertiary)
    }
}

/** Field styling for forms inside cards and sheets: a tiny label over a raised, borderless input. */
@Composable
fun JKField(
    label: String,
    text: String,
    onTextChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    prompt: String = "",
    keyboard: KeyboardType = KeyboardType.Text,
) {
    val style = JKType.subheadline.copy(color = JK.text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = JKType.system(10), color = JK.tertiary)
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(JK.text),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { field ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(JK.cardRaised, rounded(8.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    if (text.isEmpty()) Text(prompt, style = style, color = JK.tertiary)
                    field()
                }
            },
        )
    }
}

// endregion

// region Loading, empty and error states

/**
 * `ProgressView()`: the iOS activity indicator — eight spokes, brightest at the
 * head, stepping round once a second.
 */
@Composable
fun ProgressView(modifier: Modifier = Modifier, tint: Color = LocalContentColor.current, size: Dp = 20.dp) {
    val turn by rememberInfiniteTransition(label = "spinner").animateFloat(
        initialValue = 0f,
        targetValue = SPOKES.toFloat(),
        animationSpec = infiniteRepeatable(tween(1000, easing = LinearEasing)),
        label = "spinner",
    )
    Canvas(modifier.size(size)) {
        val head = turn.toInt() % SPOKES
        val r = this.size.minDimension / 2
        val width = r * 0.18f
        for (i in 0 until SPOKES) {
            val age = (head - i + SPOKES) % SPOKES
            rotate(i * 360f / SPOKES) {
                drawLine(
                    tint.copy(alpha = tint.alpha * (1f - age * 0.11f)),
                    start = Offset(center.x, center.y - r * 0.45f),
                    end = Offset(center.x, center.y - r + width / 2),
                    strokeWidth = width,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}

private const val SPOKES = 8

@Composable
fun LoadingCard(text: String = "Loading…", modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(vertical = 28.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProgressView(tint = JK.secondary)
        Text(text, style = JKType.caption, color = JK.tertiary)
    }
}

@Composable
fun EmptyCard(systemName: String, title: String, modifier: Modifier = Modifier, detail: String? = null) {
    Column(
        modifier.jkCard().padding(vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SystemImage(systemName, JKType.title2, JK.tertiary)
        Text(title, style = JKType.subheadline.semibold(), color = JK.text)
        if (detail != null) Text(detail, style = JKType.caption2, color = JK.tertiary, textAlign = TextAlign.Center)
    }
}

@Composable
fun ErrorCard(message: String, modifier: Modifier = Modifier, retry: (suspend () -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    Column(modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Label("Couldn't load", systemImage = "exclamationmark.triangle", style = JKType.subheadline.semibold(), color = JK.text)
        Text(message, style = JKType.caption, color = JK.secondary)
        if (retry != null) SmallPillButton("Try again", onClick = { scope.launch { retry() } })
    }
}

/**
 * A one-line error under a header when a refresh or action fails but
 * earlier data is still on screen.
 */
@Composable
fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    Label(
        message,
        systemImage = "exclamationmark.circle",
        style = JKType.caption,
        color = JK.secondary,
        modifier = modifier
            .fillMaxWidth()
            .background(JK.cardRaised, rounded(10.dp))
            .padding(10.dp),
    )
}

/** Wraps a load so a screen shows a spinner, the content, or an error. */
@Composable
fun <T> Loadable(
    value: T?,
    error: String?,
    retry: suspend () -> Unit,
    loadingText: String = "Loading…",
    content: @Composable (T) -> Unit,
) {
    when {
        value != null -> {
            if (error != null) ErrorBanner(error)
            content(value)
        }
        error != null -> ErrorCard(error, retry = retry)
        else -> LoadingCard(loadingText)
    }
}

/**
 * Pull to refresh (`.jkRefreshable`). The load runs in this composable's own
 * scope and the spinner stays until it returns, so a recomposition caused by
 * the load itself can't cut it short — the trap the Swift wrapper existed for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JKRefreshable(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try { onRefresh() } finally { refreshing = false }
            }
        },
        modifier = modifier,
        content = content,
    )
}

/** `.errorAlert($message)`: "Something went wrong" with the message, while it is non-null. */
@Composable
fun ErrorAlert(message: String?, onDismiss: () -> Unit) {
    if (message == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK", style = JKType.body.semibold(), color = JK.text) } },
        title = { Text("Something went wrong", style = JKType.headline, color = JK.text) },
        text = { Text(message, style = JKType.footnote, color = JK.secondary) },
        containerColor = white(0.17f),
        shape = rounded(14.dp),
    )
}

// endregion

// region SF Symbols

/**
 * The Material stand-in for an SF Symbol, so ported screens keep the iPhone's
 * names: `sfIcon("dumbbell")`. Covers every symbol the iPhone app names,
 * including the habit and activity icons the server sends; anything else
 * falls back to the checkmark circle, as Swift's `symbol()` does.
 */
fun sfIcon(name: String): ImageVector = sfIconOrNull(name) ?: Icons.Outlined.CheckCircle

/** An SF Symbol name, or `fallback` when the server names one we have no icon for. */
fun symbol(name: String, fallback: String = "checkmark.circle"): String =
    if (sfIconOrNull(name) != null) name else fallback

private fun sfIconOrNull(name: String): ImageVector? = when (name) {
    "arrow.down" -> Icons.Outlined.ArrowDownward
    "arrow.down.doc" -> Icons.Outlined.FileDownload
    "arrow.left.arrow.right" -> Icons.Outlined.SwapHoriz
    "arrow.up" -> Icons.Outlined.ArrowUpward
    "arrow.up.right" -> Icons.Outlined.NorthEast
    "arrow.uturn.backward" -> Icons.AutoMirrored.Outlined.Undo
    "arrowshape.turn.up.left" -> Icons.AutoMirrored.Outlined.Reply
    "bed.double" -> Icons.Outlined.Bed
    "bell" -> Icons.Outlined.Notifications
    "bolt" -> Icons.Outlined.Bolt
    "bolt.heart" -> Icons.Outlined.MonitorHeart
    "book" -> Icons.Outlined.Book
    "book.pages" -> Icons.Outlined.AutoStories
    "bubble.left" -> Icons.Outlined.ChatBubbleOutline
    "bubble.left.fill" -> Icons.Filled.ChatBubble
    "bubble.left.and.bubble.right" -> Icons.Outlined.Forum
    "calendar" -> Icons.Outlined.CalendarToday
    "calendar.badge.plus" -> Icons.Outlined.EditCalendar
    "camera" -> Icons.Outlined.PhotoCamera
    "chart.line.downtrend.xyaxis" -> Icons.AutoMirrored.Outlined.TrendingDown
    "chart.xyaxis.line" -> Icons.AutoMirrored.Outlined.ShowChart
    "checklist" -> Icons.Outlined.Checklist
    "checkmark" -> Icons.Rounded.Check
    "checkmark.circle" -> Icons.Outlined.CheckCircle
    "checkmark.seal" -> Icons.Outlined.Verified
    "checkmark.square.fill" -> Icons.Filled.CheckBox
    "chevron.down" -> Icons.Rounded.KeyboardArrowDown
    "chevron.left" -> Icons.AutoMirrored.Rounded.KeyboardArrowLeft
    "chevron.right" -> Icons.AutoMirrored.Rounded.KeyboardArrowRight
    "chevron.up" -> Icons.Rounded.KeyboardArrowUp
    "circle.circle" -> Icons.Outlined.RadioButtonChecked
    "clock" -> Icons.Outlined.Schedule
    "clock.badge.checkmark" -> Icons.Outlined.AlarmOn
    "creditcard" -> Icons.Outlined.CreditCard
    "desktopcomputer" -> Icons.Outlined.DesktopWindows
    "doc" -> Icons.Outlined.InsertDriveFile
    "doc.on.doc" -> Icons.Outlined.ContentCopy
    "doc.text" -> Icons.Outlined.Description
    "drop" -> Icons.Outlined.WaterDrop
    "dumbbell", "figure.strengthtraining.traditional" -> Icons.Outlined.FitnessCenter
    "ellipsis" -> Icons.Rounded.MoreHoriz
    "exclamationmark.circle" -> Icons.Outlined.ErrorOutline
    "exclamationmark.triangle" -> Icons.Outlined.WarningAmber
    "exclamationmark.triangle.fill" -> Icons.Filled.Warning
    "figure.boxing" -> Icons.Outlined.SportsMma
    "figure.mind.and.body" -> Icons.Outlined.SelfImprovement
    "figure.mixed.cardio" -> Icons.Outlined.SportsGymnastics
    "figure.outdoor.cycle" -> Icons.Outlined.PedalBike
    "figure.pool.swim" -> Icons.Outlined.Pool
    "figure.rower" -> Icons.Outlined.Rowing
    "figure.run" -> Icons.AutoMirrored.Outlined.DirectionsRun
    "figure.stand" -> Icons.Outlined.Man
    "figure.walk" -> Icons.AutoMirrored.Outlined.DirectionsWalk
    "flame" -> Icons.Outlined.LocalFireDepartment
    "fork.knife" -> Icons.Outlined.Restaurant
    "forward" -> Icons.Outlined.FastForward
    "hand.raised" -> Icons.Outlined.PanTool
    "heart" -> Icons.Outlined.FavoriteBorder
    "heart.fill" -> Icons.Filled.Favorite
    "heart.slash" -> Icons.Outlined.HeartBroken
    "hourglass" -> Icons.Outlined.HourglassEmpty
    "house" -> Icons.Outlined.Home
    "icloud.and.arrow.up" -> Icons.Outlined.CloudUpload
    "icloud.slash" -> Icons.Outlined.CloudOff
    "leaf" -> Icons.Outlined.Eco
    "lightbulb" -> Icons.Outlined.Lightbulb
    "lock" -> Icons.Outlined.Lock
    "magnifyingglass" -> Icons.Rounded.Search
    "moon" -> Icons.Outlined.Bedtime
    "moon.zzz" -> Icons.Outlined.NightsStay
    "paperplane" -> Icons.AutoMirrored.Outlined.Send
    "paperplane.fill" -> Icons.AutoMirrored.Filled.Send
    "pause" -> Icons.Rounded.Pause
    "pencil" -> Icons.Outlined.Edit
    "person" -> Icons.Outlined.Person
    "person.2" -> Icons.Outlined.People
    "person.badge.plus" -> Icons.Outlined.PersonAdd
    "person.crop.circle" -> Icons.Outlined.AccountCircle
    "pills" -> Icons.Outlined.Medication
    "play" -> Icons.Rounded.PlayArrow
    "play.circle" -> Icons.Outlined.PlayCircle
    "play.fill" -> Icons.Filled.PlayArrow
    "plus" -> Icons.Rounded.Add
    "shoeprints.fill" -> Icons.AutoMirrored.Filled.DirectionsWalk
    "square" -> Icons.Outlined.CheckBoxOutlineBlank
    "square.and.arrow.up" -> Icons.Outlined.IosShare
    "square.and.pencil" -> Icons.Outlined.EditNote
    "square.stack" -> Icons.Outlined.Layers
    "stop.circle" -> Icons.Outlined.StopCircle
    "text.bubble" -> Icons.AutoMirrored.Outlined.Chat
    "text.bubble.fill" -> Icons.AutoMirrored.Filled.Chat
    "trash" -> Icons.Outlined.Delete
    "trophy" -> Icons.Outlined.EmojiEvents
    "xmark" -> Icons.Rounded.Close
    else -> null
}

// endregion
