package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.isSpecified
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.monospacedDigit
import com.jkperformance.app.design.semibold
import java.time.LocalDate

/*
 * Shared controls the existing screens use, restyled onto the tokens. Selection
 * is bone (accentControl), never champagne: choosing is not achievement.
 */

/** One line that shrinks to fit its width, down to `minimumScaleFactor` of its size. */
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

/** A filter chip ("All", "Legs", "Knee"). */
@Composable
fun Chip(label: String, selected: Boolean, modifier: Modifier = Modifier, action: () -> Unit) {
    Text(
        label,
        style = JKType.caption,
        color = if (selected) JKColors.primaryLabel else JKColors.text,
        maxLines = 1,
        modifier = modifier
            .heightIn(min = JKSpace.xxxl)
            .clip(JKShape.chip)
            .clickable(role = Role.Tab, onClick = action)
            .semantics { this.selected = selected }
            .background(if (selected) JKColors.accentControl else Color.Transparent, JKShape.chip)
            .border(JKSize.hairline, if (selected) JKColors.accentControl else JKColors.inputBorder, JKShape.chip)
            .padding(horizontal = JKSpace.m, vertical = JKSpace.s),
    )
}

/** The segmented control ("3M 6M All", "Week Month"). */
@Composable
fun <T> Segmented(
    options: List<T>,
    selection: T,
    onSelectionChange: (T) -> Unit,
    modifier: Modifier = Modifier,
    label: (T) -> String,
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(JKColors.surface, JKShape.control)
            .padding(JKSpace.xs / 2),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.xs / 2),
    ) {
        options.forEach { option ->
            val on = option == selection
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = JKSize.touchTarget - JKSpace.s)
                    .background(if (on) JKColors.raised else Color.Transparent, JKShape.chip)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                        onSelectionChange(option)
                    }
                    .semantics { selected = on }
                    .padding(vertical = JKSpace.s),
                contentAlignment = Alignment.Center,
            ) {
                FittingText(
                    label(option),
                    style = if (on) JKType.caption.semibold() else JKType.caption,
                    color = if (on) JKColors.text else JKColors.textSecondary,
                    minimumScaleFactor = 0.75f,
                )
            }
        }
    }
}

/** A thin rule-style bar: a track with a filled share. */
@Composable
fun ThinBar(fraction: Double, height: Dp = JKSize.rule, modifier: Modifier = Modifier, color: Color = JKColors.text) {
    Box(modifier.fillMaxWidth().height(height).background(JKColors.track, CircleShape)) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0.0, 1.0).toFloat())
                .background(color, CircleShape),
        )
    }
}

/**
 * The leading mark on a list row: an unboxed glyph in a fixed slot, so rows
 * keep their alignment now that icon tiles are gone.
 */
@Composable
fun RowGlyph(icon: IconKey, modifier: Modifier = Modifier, slot: Dp = JKSize.avatar, tint: Color = JKColors.textSecondary, filled: Boolean = false) {
    Box(modifier.width(slot), contentAlignment = Alignment.Center) {
        Glyph(icon, tint = tint, filled = filled)
    }
}

/**
 * A round tick: filled check glyph when on, a 1.5dp trackStrong ring when off.
 * Selection is bone by default; pass [JKColors.accent] only for a done habit.
 */
@Composable
fun CheckCircle(on: Boolean, modifier: Modifier = Modifier, tint: Color = JKColors.accentControl) {
    Box(modifier.size(JKSize.iconHabit), contentAlignment = Alignment.Center) {
        if (on) {
            Glyph(IconKey.custom, size = JKSize.iconHabit, tint = tint, filled = true)
        } else {
            Box(Modifier.size(JKSize.iconInline).border(JKSize.outline, JKColors.trackStrong, CircleShape))
        }
    }
}

/** A run of day buttons; the selected day is bone, `marked` days ("YYYY-MM-DD") get a dot. */
@Composable
fun DayStrip(
    days: List<LocalDate>,
    selected: LocalDate,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    marked: Set<String> = emptySet(),
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JKSpace.xs + JKSpace.xs / 2)) {
        days.forEach { d ->
            val on = Day.same(d, selected)
            val ink = if (on) JKColors.primaryLabel else JKColors.text
            Column(
                Modifier
                    .weight(1f)
                    .clip(JKShape.control)
                    .clickable(role = Role.Tab) { onSelect(Day.start(d)) }
                    .semantics { this.selected = on }
                    .background(if (on) SolidColor(JKColors.accentControl) else SolidColor(JKColors.surface), JKShape.control)
                    .padding(vertical = JKSpace.s),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JKSpace.xs / 2),
            ) {
                Text(Fmt.weekday(d), style = JKType.caption, color = if (on) ink else JKColors.textSecondary)
                Text("${d.dayOfMonth}", style = JKType.headline.monospacedDigit(), color = ink)
                val dot = when {
                    !marked.contains(Day.string(d)) -> Color.Transparent
                    on -> JKColors.primaryLabel
                    else -> JKColors.textSecondary
                }
                Dot(dot, size = JKSpace.xs)
            }
        }
    }
}

/** A dated row: weekday over day number, a title and detail, and a chevron. */
@Composable
fun UpcomingRow(
    weekday: String,
    day: String,
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    chevron: Boolean = true,
) {
    Row(
        modifier.fillMaxWidth().padding(vertical = JKSpace.m),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.l),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(JKSize.avatar + JKSpace.xs), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(weekday.uppercase(), style = JKType.caption, color = JKColors.textSecondary)
            Text(day, style = JKType.headline.monospacedDigit(), color = JKColors.text)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs / 2)) {
            Text(title, style = JKType.callout, color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
        if (chevron) Glyph(IconKey.chevron, tint = JKColors.textSecondary)
    }
}

/** A small outlined capsule for a change ("+2.1 kg"). */
@Composable
fun DeltaBadge(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = JKType.caption.monospacedDigit(),
        color = JKColors.textSecondary,
        modifier = modifier
            .border(JKSize.hairline, JKColors.hairline, CircleShape)
            .padding(horizontal = JKSpace.s, vertical = JKSpace.xs / 2),
    )
}

/** A small tile with a label, a value that shrinks to fit, and an optional delta line. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, delta: String? = null) {
    Column(modifier.jkSurface(padding = JKSpace.m), verticalArrangement = Arrangement.spacedBy(JKSpace.xs / 2)) {
        Text(label, style = JKType.caption, color = JKColors.textSecondary)
        FittingText(value, style = JKType.headline.monospacedDigit(), color = JKColors.text, minimumScaleFactor = 0.6f)
        if (delta != null) Text(delta, style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** A labelled text field: a caption over a field with a 1dp inputBorder. */
@Composable
fun JKField(
    label: String,
    text: String,
    onTextChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    prompt: String = "",
    keyboard: KeyboardType = KeyboardType.Text,
) {
    val style = JKType.body.copy(color = JKColors.text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        Text(label, style = JKType.caption, color = JKColors.textSecondary)
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            textStyle = style,
            singleLine = true,
            cursorBrush = SolidColor(JKColors.text),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { field ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = JKSize.touchTarget)
                        .border(JKSize.hairline, JKColors.inputBorder, JKShape.control)
                        .padding(horizontal = JKSpace.m, vertical = JKSpace.s),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (text.isEmpty()) Text(prompt, style = style, color = JKColors.textTertiary)
                    field()
                }
            },
        )
    }
}

/** The large left-aligned title a top-level screen opens with: the label, then the display title. */
@Composable
fun ScreenHeader(
    eyebrow: String,
    title: String,
    modifier: Modifier = Modifier,
    accessory: @Composable () -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Label(eyebrow)
            Text(title, style = JKType.display, color = JKColors.text)
        }
        accessory()
    }
}


/**
 * A toggle in accentControl: a bone track with a dark thumb when on, an
 * inputBorder outline when off. Toggles are not achievement, so never champagne.
 */
@Composable
fun JKSwitch(checked: Boolean, onCheckedChange: ((Boolean) -> Unit)?, modifier: Modifier = Modifier, enabled: Boolean = true) {
    androidx.compose.material3.Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        enabled = enabled,
        colors = androidx.compose.material3.SwitchDefaults.colors(
            checkedThumbColor = JKColors.bg,
            checkedTrackColor = JKColors.accentControl,
            checkedBorderColor = JKColors.accentControl,
            uncheckedThumbColor = JKColors.textSecondary,
            uncheckedTrackColor = JKColors.surface,
            uncheckedBorderColor = JKColors.inputBorder,
            disabledCheckedThumbColor = JKColors.bg,
            disabledCheckedTrackColor = JKColors.accentControl.copy(alpha = 0.5f),
            disabledCheckedBorderColor = Color.Transparent,
            disabledUncheckedThumbColor = JKColors.textTertiary,
            disabledUncheckedTrackColor = JKColors.surface,
            disabledUncheckedBorderColor = JKColors.hairline,
        ),
    )
}
