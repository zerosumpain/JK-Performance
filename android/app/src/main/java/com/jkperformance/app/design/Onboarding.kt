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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.DirectionsRun
import androidx.compose.material.icons.automirrored.outlined.DirectionsWalk
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.automirrored.rounded.ArrowBackIos
import androidx.compose.material.icons.outlined.AssignmentTurnedIn
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.EmojiEvents
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.MilitaryTech
import androidx.compose.material.icons.outlined.NightsStay
import androidx.compose.material.icons.outlined.PermContactCalendar
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.SelfImprovement
import androidx.compose.material.icons.outlined.Shuffle
import androidx.compose.material.icons.outlined.SportsGymnastics
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material.icons.outlined.WbTwilight
import androidx.compose.material.icons.rounded.Check
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
class Choice(val id: String, val title: String, val detail: String, val icon: ImageVector)

object Answers {
    val goals = listOf(
        Choice("strength", "Get stronger", "Lift more, move heavier", Icons.Outlined.FitnessCenter),
        Choice("muscle", "Build muscle", "Add size and shape", Icons.Outlined.SportsGymnastics),
        Choice("fatloss", "Lose fat", "Lean out and keep it off", Icons.Outlined.LocalFireDepartment),
        Choice("fitness", "Get fitter", "More engine, less puffing", Icons.Outlined.FavoriteBorder),
        Choice("performance", "Perform in my sport", "Train for the season", Icons.Outlined.EmojiEvents),
        Choice("mobility", "Move better", "Ease stiffness and aches", Icons.Outlined.SelfImprovement),
        Choice("health", "Feel healthier", "Energy, sleep and mood", Icons.Outlined.Eco),
    )
    val experience = listOf(
        Choice("new", "New to training", "Under a year, or coming back after a break", Icons.AutoMirrored.Outlined.DirectionsWalk),
        Choice("some", "Some experience", "I train, but without a plan", Icons.AutoMirrored.Outlined.DirectionsRun),
        Choice("experienced", "Experienced", "Years of structured training", Icons.Outlined.MilitaryTech),
    )
    val times = listOf(
        Choice("morning", "Morning", "Before work", Icons.Outlined.WbTwilight),
        Choice("midday", "Midday", "Around lunch", Icons.Outlined.WbSunny),
        Choice("evening", "Evening", "After work", Icons.Outlined.NightsStay),
        Choice("varies", "It varies", "Different every week", Icons.Outlined.Shuffle),
    )

    fun goal(id: String): Choice? = goals.firstOrNull { it.id == id }
    fun experience(id: String?): Choice? = experience.firstOrNull { it.id == id }
    fun time(id: String?): Choice? = times.firstOrNull { it.id == id }
}

/** The icon for a catalogue feature id; an id the app doesn't know yet gets a plain check. */
fun featureIcon(id: String): ImageVector = when (id) {
    "programme" -> Icons.Outlined.FitnessCenter
    "messaging" -> Icons.Outlined.Forum
    "habits" -> Icons.Outlined.Checklist
    "progress" -> Icons.AutoMirrored.Outlined.ShowChart
    "checkin" -> Icons.Outlined.AssignmentTurnedIn
    "sessions" -> Icons.Outlined.PermContactCalendar
    "nutrition" -> Icons.Outlined.Restaurant
    "priority" -> Icons.Outlined.Bolt
    "guides" -> Icons.AutoMirrored.Outlined.MenuBook
    else -> Icons.Outlined.CheckCircle
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
    color: Color = JK.text,
) {
    val words = if (pence == 0) "Free" else "${Fmt.pounds(pence)} a $period"
    Row(
        modifier.clearAndSetSemantics { contentDescription = words },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(Price.label(pence), style = if (big) JKType.title.semibold() else JKType.headline, color = color)
        if (pence > 0) {
            Text("/ $period", style = JKType.caption, color = JK.tertiary, modifier = Modifier.padding(bottom = if (big) 5.dp else 2.dp))
        }
    }
}

/** The annual price with "Save N%" beside it when paying yearly is cheaper. */
@Composable
fun AnnualPriceLine(monthlyPence: Int, annualPence: Int, modifier: Modifier = Modifier) {
    if (annualPence <= 0) return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("or ${Fmt.pounds(annualPence)} / year", style = JKType.caption, color = JK.secondary)
        Price.savePercent(monthlyPence, annualPence)?.let { SaveBadge(it) }
    }
}

/** "Save 15%": a quiet outlined capsule. */
@Composable
fun SaveBadge(percent: Int, modifier: Modifier = Modifier) {
    Text(
        "Save $percent%",
        style = JKType.caption2.semibold(),
        color = JK.text,
        modifier = modifier.border(1.dp, JK.secondary, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

/** "Most popular": the one white capsule on a plan card. */
@Composable
fun PopularBadge(modifier: Modifier = Modifier) {
    Text(
        "Most popular",
        style = JKType.system(10, FontWeight.SemiBold),
        color = Color.Black,
        maxLines = 1,
        modifier = modifier.background(JK.chrome, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

// endregion

// region Tiles and rows

/** A rounded square with a feature's white icon, keyed by feature id. */
@Composable
fun FeatureTile(id: String, size: Dp = 38.dp, modifier: Modifier = Modifier) {
    IconTileVector(featureIcon(id), size, modifier)
}

/** [IconTile] for a Material vector rather than an SF Symbol name. */
@Composable
fun IconTileVector(icon: ImageVector, size: Dp = 38.dp, modifier: Modifier = Modifier, tint: Color = JK.text) {
    val shape = rounded(if (size > 50.dp) 18.dp else 10.dp)
    Box(
        modifier.size(size).background(JK.cardRaised, shape).border(1.dp, JK.stroke, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
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
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            if (!detail.isNullOrEmpty()) Text(detail, style = JKType.caption2, color = JK.tertiary, maxLines = 2)
        }
        trailing()
    }
}

/** A tick and a line ("Log every set as you go"). */
@Composable
fun CheckPoint(text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 1.dp).size(18.dp).background(JK.text, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Check, contentDescription = null, tint = Color.Black, modifier = Modifier.size(13.dp))
        }
        Text(text, style = JKType.subheadline, color = JK.secondary, modifier = Modifier.weight(1f))
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
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    multi: Boolean = false,
    stacked: Boolean = false,
) {
    val shape = rounded(JK.corner)
    val pick = if (multi) {
        Modifier.toggleable(value = selected, role = Role.Checkbox, onValueChange = { onClick() })
    } else {
        Modifier.selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
    }
    val frame = modifier
        .clip(shape)
        .then(pick)
        .background(if (selected) JK.cardRaised else JK.card, shape)
        .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) JK.text else JK.stroke), shape)
    if (stacked) {
        Box(frame.heightIn(min = 104.dp).padding(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                IconTileVector(icon, size = 34.dp)
                Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            }
            SelectionMark(selected, Modifier.align(Alignment.TopEnd))
        }
    } else {
        Row(
            frame.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTileVector(icon)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = JKType.subheadline.semibold(), color = JK.text)
                if (detail != null) Text(detail, style = JKType.caption, color = JK.tertiary)
            }
            SelectionMark(selected)
        }
    }
}

/** The filled white check on a selected choice; an empty ring when not. */
@Composable
private fun SelectionMark(on: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.size(22.dp), contentAlignment = Alignment.Center) {
        if (on) {
            Box(Modifier.matchParentSize().background(JK.text, CircleShape))
            Icon(Icons.Rounded.Check, contentDescription = null, tint = Color.Black, modifier = Modifier.size(15.dp))
        } else {
            Box(Modifier.matchParentSize().border(1.5.dp, JK.track, CircleShape))
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
            Box(Modifier.weight(1f).height(4.dp).background(if (i <= step) JK.text else JK.track, CircleShape))
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
    Column(modifier.fillMaxSize().background(JK.bg)) {
        Row(
            Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(width = 72.dp, height = 44.dp), contentAlignment = Alignment.CenterStart) {
                if (onBack != null) {
                    Row(
                        Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onBack).padding(horizontal = 6.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBackIos, contentDescription = null, tint = JK.text, modifier = Modifier.size(16.dp))
                        Text("Back", style = JKType.subheadline, color = JK.text)
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
                        style = JKType.subheadline,
                        color = JK.secondary,
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
                Text(title, style = JKType.title.semibold(), color = JK.text, modifier = Modifier.semantics { heading() })
                if (subtitle != null) Text(subtitle, style = JKType.subheadline, color = JK.secondary)
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
            ChromeButton(onClick = onPrimary, enabled = primaryEnabled && !busy) {
                if (busy) ProgressView(tint = Color.Black) else Text(primary)
            }
            if (secondary != null && onSecondary != null) {
                Text(
                    secondary,
                    style = JKType.subheadline,
                    color = JK.secondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.clip(CircleShape).clickable(enabled = !busy, onClick = onSecondary).padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

// endregion
