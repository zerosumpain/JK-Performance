package com.jkperformance.app.design

import android.provider.Settings
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import com.jkperformance.app.design.components.*

/*
 * The shared building blocks of the first-run questions, the plan walkthrough
 * and the coach's plan editor (Design/Onboarding.swift on the iPhone): one
 * step scaffold, a choice card, a feature tile keyed by feature id, a price
 * label, and the words and icons for the catalogue's ids.
 */

/** The phone's "Remove animations" setting: no paging slides, no sheen. */
@Composable
fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

// region Catalogue words and icons

/** One answer the app offers for a first-run question. */
class Choice(val id: String, val title: String, val detail: String, val icon: IconKey)

object Answers {
    val goals = listOf(
        Choice("strength", "Get stronger", "Lift more, move heavier", IconKey.workout),
        Choice("muscle", "Build muscle", "Add size and shape", IconKey.cardio),
        Choice("fatloss", "Lose fat", "Lean out and keep it off", IconKey.flame),
        Choice("fitness", "Get fitter", "More engine, less puffing", IconKey.heart),
        Choice("performance", "Perform in my sport", "Train for the season", IconKey.trophy),
        Choice("mobility", "Move better", "Ease stiffness and aches", IconKey.mobility),
        Choice("health", "Feel healthier", "Energy, sleep and mood", IconKey.mindfulness),
    )
    val experience = listOf(
        Choice("new", "New to training", "Under a year, or coming back after a break", IconKey.steps),
        Choice("some", "Some experience", "I train, but without a plan", IconKey.run),
        Choice("experienced", "Experienced", "Years of structured training", IconKey.record),
    )
    val times = listOf(
        Choice("morning", "Morning", "Before work", IconKey.sunlight),
        Choice("midday", "Midday", "Around lunch", IconKey.today),
        Choice("evening", "Evening", "After work", IconKey.sleep),
        Choice("varies", "It varies", "Different every week", IconKey.shuffle),
    )

    fun goal(id: String): Choice? = goals.firstOrNull { it.id == id }
    fun experience(id: String?): Choice? = experience.firstOrNull { it.id == id }
    fun time(id: String?): Choice? = times.firstOrNull { it.id == id }
}

/** The icon for a catalogue feature id; an id the app doesn't know yet gets a plain check. */
fun featureIcon(id: String): IconKey = when (id) {
    "programme" -> IconKey.workout
    "messaging" -> IconKey.messages
    "habits" -> IconKey.checklist
    "progress" -> IconKey.progress
    "checkin" -> IconKey.checkIn
    "sessions" -> IconKey.week
    "nutrition" -> IconKey.protein
    "priority" -> IconKey.energy
    "guides" -> IconKey.guide
    else -> IconKey.custom
}

// endregion

// region Prices

object Price {
    /** "£59", "£0" reads as "Free". */
    fun label(pence: Int): String = if (pence == 0) "Free" else Fmt.pounds(pence)

    /** The saving of paying yearly over 12 monthly payments, as a whole percentage; null when there is none. */
    fun savePercent(monthlyPence: Int, annualPence: Int): Int? {
        val twelve = monthlyPence * 12
        if (monthlyPence <= 0 || annualPence <= 0 || annualPence >= twelve) return null
        return (((twelve - annualPence) * 100.0) / twelve).roundToInt().takeIf { it > 0 }
    }
}

/** "£59 / month": the price big, the period small. "Free" alone for nothing. */
@Composable
fun PriceLabel(
    pence: Int,
    period: String = "month",
    modifier: Modifier = Modifier,
    big: Boolean = false,
    color: Color = JKColors.text,
) {
    val words = if (pence == 0) "Free" else "${Fmt.pounds(pence)} a $period"
    Row(
        modifier.clearAndSetSemantics { contentDescription = words },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(Price.label(pence), style = if (big) JKType.display else JKType.headline, color = color)
        if (pence > 0) {
            Text("/ $period", style = JKType.caption, color = JKColors.textTertiary, modifier = Modifier.padding(bottom = if (big) 5.dp else 2.dp))
        }
    }
}

/** The annual price with "Save N%" beside it when paying yearly is cheaper. */
@Composable
fun AnnualPriceLine(monthlyPence: Int, annualPence: Int, modifier: Modifier = Modifier) {
    if (annualPence <= 0) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("or ${Fmt.pounds(annualPence)} / year", style = JKType.caption, color = JKColors.textSecondary)
        Price.savePercent(monthlyPence, annualPence)?.let { SaveBadge(it) }
    }
}

/** "Save 15%": a quiet outlined capsule. */
@Composable
fun SaveBadge(percent: Int, modifier: Modifier = Modifier) {
    Text(
        "Save $percent%",
        style = JKType.caption.semibold(),
        color = JKColors.text,
        modifier = modifier.border(1.dp, JKColors.textSecondary, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

/** "Most popular": the one outlined capsule on a plan card (selection-neutral, never champagne). */
@Composable
fun PopularBadge(modifier: Modifier = Modifier) {
    Text(
        "Most popular",
        style = JKType.caption.semibold(),
        color = JKColors.text,
        maxLines = 1,
        modifier = modifier.border(JKSize.hairline, JKColors.inputBorder, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// endregion

// region Tiles and rows

/** A feature's unboxed glyph in a fixed slot, keyed by feature id. */
@Composable
fun FeatureTile(id: String, size: Dp = 38.dp, modifier: Modifier = Modifier) {
    RowGlyph(featureIcon(id), modifier, slot = size)
}

/** A feature as a compact row: tile, title, one line of detail. */
@Composable
fun FeatureRow(id: String, title: String, detail: String?, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FeatureTile(id, size = 34.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.callout.semibold(), color = JKColors.text)
            if (!detail.isNullOrEmpty()) Text(detail, style = JKType.caption, color = JKColors.textTertiary, maxLines = 2)
        }
        trailing()
    }
}

/** A tick and a line ("Log every set as you go"). */
@Composable
fun CheckPoint(text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Glyph(IconKey.done, size = JKSize.iconInline, tint = JKColors.text)
        Text(text, style = JKType.callout, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
    }
}

/**
 * A choice: icon tile, title, one-line detail. Selected, it wears a white
 * 1.5dp edge and a check. `multi` picks the check box role (several can be
 * on) over the radio role; either way the selected state is announced.
 * `stacked` puts the icon above the words, for a two-column grid.
 */
@Composable
fun ChoiceCard(
    title: String,
    icon: IconKey,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    multi: Boolean = false,
    stacked: Boolean = false,
) {
    val shape = JKShape.card
    val pick = if (multi) {
        Modifier.toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() })
    } else {
        Modifier.selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
    }
    val frame = modifier
        .clip(shape)
        .then(pick)
        .background(if (selected) JKColors.raised else JKColors.surface, shape)
        .border(BorderStroke(if (selected) JKSize.outline else JKSize.hairline, if (selected) JKColors.accentControl else JKColors.hairline), shape)
    if (stacked) {
        Box(frame.heightIn(min = 104.dp).padding(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Glyph(icon, size = JKSize.iconTab, tint = JKColors.textSecondary, filled = selected)
                Text(title, style = JKType.callout.semibold(), color = JKColors.text)
            }
            SelectionMark(selected, Modifier.align(Alignment.TopEnd))
        }
    } else {
        Row(
            frame.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowGlyph(icon, filled = selected, tint = if (selected) JKColors.text else JKColors.textSecondary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = JKType.callout.semibold(), color = JKColors.text)
                if (detail != null) Text(detail, style = JKType.caption, color = JKColors.textTertiary)
            }
            SelectionMark(selected)
        }
    }
}

/** The filled white check on a selected choice; an empty ring when not. */
@Composable
private fun SelectionMark(on: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.size(JKSize.iconTab), contentAlignment = Alignment.Center) {
        if (on) {
            Glyph(IconKey.custom, size = JKSize.iconTab, tint = JKColors.accentControl, filled = true)
        } else {
            Box(Modifier.size(JKSize.iconInline).border(JKSize.outline, JKColors.trackStrong, CircleShape))
        }
    }
}

// endregion

// region Step scaffold

/** Thin capsules, one per step; the ones done (and the current one) are white. */
@Composable
fun ProgressTrack(step: Int, count: Int, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Step ${step + 1} of $count" },
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        repeat(count) { i ->
            Box(Modifier.weight(1f).height(JKSize.rule).background(if (i <= step) JKColors.text else JKColors.track, CircleShape))
        }
    }
}

/**
 * One step of a full-screen flow: a top bar (Back, the progress track, Skip),
 * a title and subtitle, scrolling content, and a bottom bar with the chrome
 * primary action (and an optional quiet one under it).
 * `count = 0` hides the track; a null `onBack` or `onSkip` hides that button.
 */
@Composable
fun StepScaffold(
    title: String,
    primary: String,
    onPrimary: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    step: Int = 0,
    count: Int = 0,
    onBack: (() -> Unit)? = null,
    onSkip: (() -> Unit)? = null,
    skipLabel: String = "Skip",
    busy: Boolean = false,
    primaryEnabled: Boolean = true,
    secondary: String? = null,
    onSecondary: (() -> Unit)? = null,
    message: String? = null,
    header: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxSize().background(JKColors.bg)) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(width = 72.dp, height = 44.dp), contentAlignment = Alignment.CenterStart) {
                if (onBack != null) {
                    Row(
                        Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onBack).padding(horizontal = 6.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Glyph(IconKey.back, tint = JKColors.text)
                        Text("Back", style = JKType.callout, color = JKColors.text)
                    }
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                if (count > 0) ProgressTrack(step, count, Modifier.padding(horizontal = 6.dp))
            }
            Box(Modifier.size(width = 72.dp, height = 44.dp), contentAlignment = Alignment.CenterEnd) {
                if (onSkip != null) {
                    Text(
                        skipLabel,
                        style = JKType.callout,
                        color = JKColors.textSecondary,
                        modifier = Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onSkip).padding(horizontal = 8.dp, vertical = 10.dp),
                    )
                }
            }
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            header?.invoke()
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title, style = JKType.display, color = JKColors.text, modifier = Modifier.semantics { heading() })
                if (subtitle != null) Text(subtitle, style = JKType.callout, color = JKColors.textSecondary)
            }
            Spacer(Modifier.height(6.dp))
            content()
        }
        Column(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (message != null) ErrorBanner(message)
            PrimaryButton(onClick = onPrimary, enabled = primaryEnabled && !busy) {
                if (busy) ProgressView() else Text(primary)
            }
            if (secondary != null && onSecondary != null) {
                Text(
                    secondary,
                    style = JKType.callout,
                    color = JKColors.textSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onSecondary).padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

// endregion
