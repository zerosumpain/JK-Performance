package com.jkperformance.app.design.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jkperformance.app.R
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKMotion
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.emphasized
import com.jkperformance.app.design.isAccessibilityFontScale
import com.jkperformance.app.design.rememberReduceMotion
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * Plan. Act. Review. components (docs/design/plan-act-review.md, Shapes and
 * components): monochrome silver on near-black, drawn rather than iconned.
 * Screens compose these; literals stay here and in Tokens.kt / Type.kt.
 */

// MARK: - Text

/** A screen title in Newsreader with its italic word: `ParTitle("Today's *work.*")`. */
@Composable
fun ParTitle(text: String, modifier: Modifier = Modifier, style: TextStyle = JKType.parTitle, align: TextAlign? = null) {
    Text(
        emphasized(text, style),
        style = style,
        color = JKColors.text,
        textAlign = align,
        modifier = modifier.semantics { heading() },
    )
}

/**
 * The tracked uppercase label ("PLAN · THIS SEASON"), with an optional italic
 * annotation at the right ("early days, building"). Wraps rather than
 * truncates; at accessibility font scales the tracking goes.
 */
@Composable
fun ParLabel(text: String, modifier: Modifier = Modifier, annotation: String? = null, color: Color = JKColors.textTertiary) {
    val large = isAccessibilityFontScale()
    val style = if (large) JKType.parLabel.copy(letterSpacing = 0.sp) else JKType.parLabel
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Text(text.uppercase(), style = style, color = color, modifier = Modifier.weight(1f, fill = annotation != null).semantics { heading() })
        if (annotation != null) {
            Text(annotation, style = JKType.annotation, color = JKColors.textTertiary, textAlign = TextAlign.End)
        }
    }
}

// MARK: - Cards

/** Surface, 1dp hairline, radius 16, padding 16, no shadow. Tappable when [onClick] is set. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ParCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
    onLongClick: (() -> Unit)? = null,
    padding: Dp = JKSpace.l,
    spacing: Dp = JKSpace.s,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .clip(JKShape.parCard)
            .background(JKColors.surface, JKShape.parCard)
            .border(JKSize.hairline, JKColors.hairline, JKShape.parCard)
            .then(
                if (onClick != null) {
                    Modifier.combinedClickable(onClickLabel = onClickLabel, role = Role.Button, onLongClick = onLongClick, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

/** A tab whose feature the plan does not include: one quiet card in board style, never a 403. */
@Composable
fun LockedCard(title: String, line: String, onSee: () -> Unit, modifier: Modifier = Modifier) {
    ParCard(modifier.fillMaxWidth(), padding = JKSpace.xl, spacing = JKSpace.l) {
        ParTitle(title, style = JKType.parCardTitle)
        Text(line, style = JKType.parBody, color = JKColors.textSecondary)
        SecondaryButton("See what coaching includes", onClick = onSee)
    }
}

// MARK: - Marks

/** The plan glyph: a diamond outline (filled when [filled]). */
@Composable
fun PlanDiamond(size: Dp = JKSpace.m, color: Color = JKColors.text, filled: Boolean = false, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size).semantics { invisibleToUser() }) { drawDiamond(center, this.size.minDimension / 2f, color, filled) }
}

/** The review glyph: a circle with a dot at its centre. */
@Composable
fun ReviewMark(size: Dp = JKSpace.m + 2.dp, color: Color = JKColors.text, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size).semantics { invisibleToUser() }) { drawReviewMark(center, this.size.minDimension / 2f, color) }
}

private fun DrawScope.drawDiamond(c: Offset, r: Float, color: Color, filled: Boolean, ground: Color? = null) {
    val path = Path().apply {
        moveTo(c.x, c.y - r); lineTo(c.x + r, c.y); lineTo(c.x, c.y + r); lineTo(c.x - r, c.y); close()
    }
    if (ground != null) drawPath(path, ground)
    if (filled) drawPath(path, color) else drawPath(path, color, style = Stroke(JKSize.ring.toPx()))
}

private fun DrawScope.drawReviewMark(c: Offset, r: Float, color: Color, ground: Color? = null) {
    val stroke = JKSize.ring.toPx()
    if (ground != null) drawCircle(ground, r, c)
    drawCircle(color, r - stroke / 2f, c, style = Stroke(stroke))
    drawCircle(color, r * 0.28f, c)
}

/** The small "JK." mark at the top left of the tab roots: 28dp rounded square, hairline border. */
@Composable
fun JKMarkSmall(modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(JKSize.markSmall)
            .background(JKColors.surface, JKShape.mark)
            .border(JKSize.hairline, JKColors.hairline, JKShape.mark)
            .clearAndSetSemantics { contentDescription = "JK Performance" },
        contentAlignment = Alignment.Center,
    ) {
        Text("JK.", style = JKType.markSmall, color = JKColors.text, maxLines = 1)
    }
}

/** The silver JK. badge (docs/design/brand/jk-mark-silver-1024.png), 120dp on Welcome. */
@Composable
fun JKMarkLarge(modifier: Modifier = Modifier, size: Dp = JKSize.markLarge) {
    Image(
        painterResource(R.drawable.jk_mark_silver),
        contentDescription = "JK Performance",
        contentScale = ContentScale.Fit,
        modifier = modifier.size(size).clip(JKShape.parCard),
    )
}

/** JK at the top right: portrait or initials in a hairline circle, with a silver dot when something is unread. */
@Composable
fun JKAvatar(mediaId: String?, size: Dp = JKSize.topAvatar, unread: Boolean = false, initials: String = "JK", modifier: Modifier = Modifier) {
    val image = rememberAvatarImage(mediaId, size)
    Box(modifier.size(size)) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(JKColors.raised, CircleShape)
                .border(JKSize.hairline, JKColors.hairline, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (image != null) {
                Image(image, null, Modifier.size(size), contentScale = ContentScale.Crop)
            } else {
                val scale = (size.value / JKSize.topAvatar.value).coerceAtLeast(1f)
                Text(initials, style = JKType.markSmall.copy(fontSize = JKType.markSmall.fontSize * scale), color = JKColors.text, maxLines = 1)
            }
        }
        if (unread) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(JKSize.dot + 2.dp)
                    .background(JKColors.bg, CircleShape)
                    .padding(1.dp)
                    .background(JKColors.silver, CircleShape),
            )
        }
    }
}

/** The tab roots' top bar: the JK. mark at the left, JK's avatar (opens the JK sheet) at the right. */
@Composable
fun ParTopBar(avatarMediaId: String?, unread: Boolean, onAvatar: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = JKSpace.gutter, vertical = JKSpace.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        JKMarkSmall()
        Spacer(Modifier.weight(1f))
        Box(
            Modifier
                .size(JKSize.touchTarget)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClickLabel = "Open JK") { onAvatar() }
                .semantics { contentDescription = if (unread) "JK, something new" else "JK" },
            contentAlignment = Alignment.CenterEnd,
        ) {
            JKAvatar(avatarMediaId, unread = unread)
        }
    }
}

/** A pushed screen's bar: a back chevron and an optional quiet word at the right ("Saved"). */
@Composable
fun ParBackBar(onBack: () -> Unit, trailing: String? = null, close: Boolean = false, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().padding(horizontal = JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(JKSize.touchTarget)
                .clip(CircleShape)
                .clickable(role = Role.Button, onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Glyph(if (close) IconKey.close else IconKey.back, size = JKSize.iconInline, tint = JKColors.text, contentDescription = if (close) "Close" else "Back")
        }
        Spacer(Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = JKType.meta, color = JKColors.textTertiary, modifier = Modifier.padding(end = JKSpace.m))
    }
}

// MARK: - Tab bar

/**
 * PLAN · ACT · REVIEW: three words, no icons, no background, no border. The
 * selected word is text colour with a 4dp silver dot beneath. Tapping the
 * selected tab again calls [onReselect] (back to its root).
 */
@Composable
fun ParTabBar(labels: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().background(JKColors.bg).navigationBarsPadding().padding(top = JKSpace.xs, bottom = JKSpace.s),
        horizontalArrangement = Arrangement.Center,
    ) {
        labels.forEachIndexed { i, label ->
            val on = i == selected
            Column(
                Modifier
                    .heightIn(min = JKSize.touchTarget)
                    .clickable(role = Role.Tab) { onSelect(i) }
                    .padding(horizontal = JKSpace.xxl)
                    .semantics { stateDescription = if (on) "Selected" else "" },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterVertically),
            ) {
                Text(label.uppercase(), style = JKType.parLabel, color = if (on) JKColors.text else JKColors.textTertiary, maxLines = 1)
                Box(Modifier.size(JKSize.tabDot).background(if (on) JKColors.silver else Color.Transparent, CircleShape))
            }
        }
    }
}

// MARK: - Rings and dots

/** What a [ParRing] shows beyond its arc. */
enum class RingState { Progress, Done, Mostly, Missed }

/**
 * The quiet ring: a 1.5dp track with a silver arc from 12 o'clock, round caps.
 * Done is a full ring with a check inside; Mostly a 70% arc; Missed a dashed
 * trackStrong ring. [idleStrong] draws an empty track in trackStrong (a ring
 * that carries meaning while still empty). Fills animate 400ms.
 */
@Composable
fun ParRing(
    progress: Float,
    size: Dp,
    modifier: Modifier = Modifier,
    state: RingState = RingState.Progress,
    idleStrong: Boolean = false,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val reduce = rememberReduceMotion()
    val target = when (state) {
        RingState.Done -> 1f
        RingState.Mostly -> 0.7f
        RingState.Missed -> 0f
        RingState.Progress -> progress.coerceIn(0f, 1f)
    }
    val shown by animateFloatAsState(target, tween(if (reduce) 0 else JKMotion.RING_FILL), label = "ring")
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val stroke = JKSize.ring.toPx()
            val inset = stroke / 2f
            val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
            val topLeft = Offset(inset, inset)
            if (state == RingState.Missed) {
                val r = this.size.minDimension / 2f - inset
                val dash = (2 * PI * r / 24).toFloat()
                drawCircle(
                    JKColors.trackStrong, r, center,
                    style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash * 0.45f, dash * 0.55f))),
                )
            } else {
                drawArc(if (idleStrong && shown == 0f) JKColors.trackStrong else JKColors.track, 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
                if (shown > 0f) drawArc(JKColors.silver, -90f, 360f * shown, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
        }
        if (state == RingState.Done) {
            Glyph(IconKey.done, size = size * 0.42f, tint = JKColors.silver)
        } else {
            content()
        }
    }
}

/** Seven 5dp dots, Monday to Sunday: silver done, trackStrong outline not done, faint future; today slightly larger. */
@Composable
fun HabitWeekDots(week: List<Boolean?>, todayIndex: Int?, modifier: Modifier = Modifier) {
    Row(
        modifier.clearAndSetSemantics {
            contentDescription = "This week: ${week.count { it == true }} of ${week.count { it != null }} days"
        },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        week.take(7).forEachIndexed { i, done ->
            val size = if (i == todayIndex) JKSize.weekDot + 2.dp else JKSize.weekDot
            val dot = Modifier.size(size)
            when {
                done == true -> Box(dot.background(JKColors.silver, CircleShape))
                done == false || i == todayIndex -> Box(dot.border(JKSize.hairline, JKColors.trackStrong, CircleShape))
                else -> Box(dot.border(JKSize.hairline, JKColors.track, CircleShape))
            }
        }
    }
}

/** One set in the session: filled with a check once logged, the next outlined in text colour, later ones trackStrong. */
enum class SetCircleState { Logged, Next, Later }

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SetCircle(state: SetCircleState, spoken: String, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    val size = JKSize.setCircle
    Box(
        modifier
            .size(JKSize.touchTarget)
            .clip(CircleShape)
            .combinedClickable(role = Role.Button, onClickLabel = "Edit", onLongClick = onLongClick, onClick = onClick)
            .semantics { contentDescription = spoken },
        contentAlignment = Alignment.Center,
    ) {
        when (state) {
            SetCircleState.Logged -> Box(Modifier.size(size).background(JKColors.silver, CircleShape), contentAlignment = Alignment.Center) {
                Glyph(IconKey.done, size = JKSize.iconInline, tint = JKColors.onChrome)
            }
            SetCircleState.Next -> Box(Modifier.size(size).border(JKSize.ring, JKColors.text, CircleShape))
            SetCircleState.Later -> Box(Modifier.size(size).border(JKSize.ring, JKColors.trackStrong, CircleShape))
        }
    }
}

// MARK: - Lines

/** One day on the [WeekLine]. `mark` is today, plan, review or null. */
class WeekLineDay(val letter: String, val mark: String?, val done: Boolean, val today: Boolean, val spoken: String)

/**
 * The week as a line: labels TODAY / PLAN / REVIEW above the days they mark, a
 * trackStrong rule with seven nodes (today a filled dot in a ring, plan a
 * diamond, review a dotted circle, other days small dots, silver when done),
 * and the day letters beneath.
 */
@Composable
fun WeekLine(days: List<WeekLineDay>, modifier: Modifier = Modifier) {
    val labelFor = { d: WeekLineDay ->
        when {
            d.today -> "TODAY"
            d.mark == "plan" -> "PLAN"
            d.mark == "review" -> "REVIEW"
            else -> null
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Row(Modifier.fillMaxWidth()) {
            days.forEachIndexed { i, d ->
                val align = when (i) {
                    0 -> Alignment.Start
                    days.lastIndex -> Alignment.End
                    else -> Alignment.CenterHorizontally
                }
                Box(Modifier.weight(1f).clearAndSetSemantics {}) {
                    labelFor(d)?.let {
                        Text(
                            it, style = JKType.parLabel.copy(fontSize = 10.sp), color = JKColors.textSecondary, maxLines = 1, softWrap = false,
                            modifier = Modifier.fillMaxWidth().wrapContentWidth(align, unbounded = true),
                        )
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(JKSpace.xl)) {
            Canvas(Modifier.matchParentSize()) {
                val step = this.size.width / days.size
                val y = this.size.height / 2f
                drawLine(JKColors.trackStrong, Offset(step / 2f, y), Offset(this.size.width - step / 2f, y), strokeWidth = JKSize.hairline.toPx())
                days.forEachIndexed { i, d ->
                    val c = Offset(step * i + step / 2f, y)
                    val base = 2.5.dp.toPx()
                    when {
                        d.today -> {
                            drawCircle(JKColors.bg, 7.dp.toPx(), c)
                            drawCircle(JKColors.silver, 7.dp.toPx(), c, style = Stroke(JKSize.hairline.toPx()))
                            drawCircle(if (d.done) JKColors.silver else JKColors.text, 4.dp.toPx(), c)
                        }
                        d.mark == "plan" -> drawDiamond(c, 6.5.dp.toPx(), JKColors.text, filled = false, ground = JKColors.bg)
                        d.mark == "review" -> drawReviewMark(c, 6.dp.toPx(), JKColors.text, ground = JKColors.bg)
                        else -> drawCircle(if (d.done) JKColors.silver else JKColors.trackStrong, base, c)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            days.forEach { d ->
                Text(
                    d.letter, style = JKType.parLabel.copy(fontSize = 10.sp), color = if (d.today) JKColors.text else JKColors.textTertiary,
                    textAlign = TextAlign.Center, maxLines = 1,
                    modifier = Modifier.weight(1f).semantics { contentDescription = d.spoken },
                )
            }
        }
    }
}

/**
 * The season as a line: a filled start diamond, a silver rule up to today's
 * dot, the next planning diamond and the end diamond, with dates beneath
 * (the next planning date in text colour). Fractions are 0..1 along the season.
 */
@Composable
fun SeasonLine(
    today: Float,
    next: Float?,
    startLabel: String,
    nextLabel: String?,
    endLabel: String,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()
    val meta = JKType.meta
    val strong = meta.copy(color = JKColors.text, fontWeight = JKType.parHeadline.fontWeight)
    val muted = meta.copy(color = JKColors.textTertiary)
    Canvas(
        modifier.fillMaxWidth().height(JKSpace.huge).semantics {
            contentDescription = "The season, from $startLabel to $endLabel" + (nextLabel?.let { ", next planning $it" } ?: "") +
                ", ${(today * 100).roundToInt()} percent through"
        },
    ) {
        val pad = 8.dp.toPx()
        val w = size.width - pad * 2
        val y = 10.dp.toPx()
        val x = { f: Float -> pad + w * f.coerceIn(0f, 1f) }
        val stroke = JKSize.hairline.toPx()
        drawLine(JKColors.trackStrong, Offset(x(0f), y), Offset(x(1f), y), strokeWidth = stroke)
        drawLine(JKColors.silver, Offset(x(0f), y), Offset(x(today), y), strokeWidth = stroke * 1.5f)
        // Ticks along the rule, as the board's faint marks.
        for (i in 1 until 12) {
            val tx = x(i / 12f)
            drawLine(JKColors.trackStrong, Offset(tx, y - 2.dp.toPx()), Offset(tx, y + 2.dp.toPx()), strokeWidth = stroke)
        }
        val r = 6.dp.toPx()
        drawDiamond(Offset(x(0f), y), r, JKColors.silver, filled = true, ground = JKColors.bg)
        drawDiamond(Offset(x(1f), y), r, JKColors.text, filled = false, ground = JKColors.bg)
        if (next != null) drawDiamond(Offset(x(next), y), r, JKColors.text, filled = false, ground = JKColors.bg)
        drawCircle(JKColors.text, 3.dp.toPx(), Offset(x(today), y))
        val ly = y + 12.dp.toPx()
        fun label(text: String, at: Float, style: TextStyle, anchor: Float) {
            val layout = measurer.measure(text, style)
            val lx = (at - layout.size.width * anchor).coerceIn(0f, size.width - layout.size.width)
            drawText(layout, topLeft = Offset(lx, ly))
        }
        label(startLabel, x(0f), muted, 0.5f)
        if (next != null && nextLabel != null) label(nextLabel, x(next), strong, 0.5f)
        label(endLabel, x(1f), muted, 0.5f)
    }
}

/** One block of today's session in the [BlockStrip]. */
class StripBlock(val label: String, val done: Boolean)

/** A strip of 2dp rules, one per block, silver when done, with the block labels beneath in meta. */
@Composable
fun BlockStrip(blocks: List<StripBlock>, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics {
            contentDescription = "${blocks.count { it.done }} of ${blocks.size} blocks done: " + blocks.joinToString { it.label }
        },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.xs),
    ) {
        blocks.forEach { b ->
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                Box(Modifier.fillMaxWidth().height(JKSize.rule).clip(CircleShape).background(if (b.done) JKColors.silver else JKColors.trackStrong))
                Text(b.label, style = JKType.meta, color = if (b.done) JKColors.textSecondary else JKColors.textTertiary, maxLines = 1)
            }
        }
    }
}

/** One progress segment per exercise across the top of the session. */
@Composable
fun SegmentStrip(done: List<Boolean>, current: Int, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        done.forEachIndexed { i, d ->
            val color = when {
                d -> JKColors.silver
                i == current -> JKColors.textSecondary
                else -> JKColors.trackStrong
            }
            Box(Modifier.weight(1f).height(JKSize.rule).clip(CircleShape).background(color))
        }
    }
}

/**
 * The tempo as a drawn line ("3-1-1" = down, pause, drive, with an optional
 * fourth pause at the top): segment widths follow the seconds, with italic
 * labels "slow down", "pause", "drive". Null for a pattern it can't read.
 */
@Composable
fun TempoLine(tempo: String, modifier: Modifier = Modifier) {
    val parts = tempo.split('-').mapNotNull { it.trim().toIntOrNull() }
    if (parts.size < 3) return
    val measurer = rememberTextMeasurer()
    val style = JKType.annotation.copy(color = JKColors.textTertiary)
    val (down, pause, drive) = parts
    val top = parts.getOrNull(3) ?: 0
    Canvas(
        modifier.fillMaxWidth().height(88.dp).semantics {
            contentDescription = "Tempo $tempo: $down seconds down, $pause pause, $drive to drive up" +
                if (top > 0) ", $top at the top" else ""
        },
    ) {
        val lead = 0.08f
        val tail = 0.14f
        val weights = listOf(down.coerceAtLeast(1) * 1.4f, pause.coerceAtLeast(1).toFloat(), drive.coerceAtLeast(1) * 0.8f)
        val total = weights.sum() + (if (top > 0) top.toFloat() else 0f)
        val usable = size.width * (1f - lead - tail)
        val yTop = 14.dp.toPx()
        val yBottom = size.height - 30.dp.toPx()
        var x = size.width * lead
        val p0 = Offset(x, yTop)
        x += usable * weights[0] / total
        val p1 = Offset(x, yBottom)
        x += usable * weights[1] / total
        val p2 = Offset(x, yBottom)
        x += usable * weights[2] / total
        val p3 = Offset(x, yTop)
        val p4 = Offset(size.width * (1f - tail / 2f), yTop)
        val stroke = JKSize.ring.toPx()
        val path = Path().apply { moveTo(p0.x, p0.y); lineTo(p1.x, p1.y); lineTo(p2.x, p2.y); lineTo(p3.x, p3.y) }
        drawPath(path, JKColors.textSecondary, style = Stroke(stroke, cap = StrokeCap.Round))
        drawLine(JKColors.trackStrong, p3, p4, strokeWidth = JKSize.hairline.toPx())
        listOf(p1, p2).forEach { drawCircle(JKColors.bg, 3.dp.toPx(), it); drawCircle(JKColors.textSecondary, 3.dp.toPx(), it, style = Stroke(JKSize.hairline.toPx())) }
        fun label(text: String, at: Offset) {
            val layout = measurer.measure(text, style)
            drawText(layout, topLeft = Offset((at.x - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width), at.y))
        }
        label("slow down", Offset((p0.x + p1.x) / 2f - 8.dp.toPx(), (p0.y + p1.y) / 2f + 6.dp.toPx()))
        label("pause", Offset((p1.x + p2.x) / 2f, yBottom + 6.dp.toPx()))
        label("drive", Offset((p2.x + p3.x) / 2f + 18.dp.toPx(), (p2.y + p3.y) / 2f - 10.dp.toPx()))
    }
}

/** One week in [ShapeBars]. */
class ShapeWeek(val feeling: Int, val word: String)

/**
 * The shape of the month: one vertical capsule per week (up to four), its
 * height by feeling 1–5, the latest bright, the word beneath in italic meta.
 */
@Composable
fun ShapeBars(weeks: List<ShapeWeek>, modifier: Modifier = Modifier) {
    ParCard(
        modifier.fillMaxWidth().clearAndSetSemantics {
            contentDescription = "The last ${weeks.size} weeks: " + weeks.joinToString { it.word }
        },
        padding = JKSpace.l,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            weeks.takeLast(4).forEachIndexed { i, w ->
                val latest = i == weeks.takeLast(4).lastIndex
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    Box(Modifier.width(12.dp).height(68.dp).clip(CircleShape).background(JKColors.raised), contentAlignment = Alignment.BottomCenter) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .fillMaxSize(fraction = (w.feeling.coerceIn(1, 5) / 5f))
                                .clip(CircleShape)
                                .background(if (latest) JKColors.silver else JKColors.trackStrong),
                        )
                    }
                    Text(w.word, style = JKType.annotation.copy(fontSize = 11.sp), color = if (latest) JKColors.text else JKColors.textTertiary, maxLines = 1)
                }
            }
        }
    }
}

// MARK: - Dial

/**
 * A 200° arc gauge: hairline track, tick marks, one silver knob, the current
 * word in Newsreader italic in the middle and the two end words below each
 * end. Drag or tap to set; TalkBack can adjust it. [value] is 0..1; with
 * [stops] it snaps to that many positions.
 */
@Composable
fun Dial(
    value: Float?,
    word: String,
    startWord: String,
    endWord: String,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    stops: Int? = null,
    label: String = "",
) {
    val current by rememberUpdatedState(value)
    val change by rememberUpdatedState(onChange)
    val startAngle = 170f
    val sweep = 200f
    fun snap(v: Float): Float {
        val c = v.coerceIn(0f, 1f)
        val n = stops ?: return c
        return ((c * (n - 1)).roundToInt() / (n - 1).toFloat())
    }
    fun valueAt(p: Offset, w: Float, h: Float): Float? {
        val cx = w / 2f
        val cy = h
        var deg = Math.toDegrees(atan2((p.y - cy).toDouble(), (p.x - cx).toDouble())).toFloat()
        if (deg < 0) deg += 360f
        var rel = deg - startAngle
        if (rel < 0) rel += 360f
        if (rel > sweep) rel = if (rel - sweep < (360f - sweep) / 2f) sweep else 0f
        return snap(rel / sweep)
    }
    Column(
        modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = label
                stateDescription = word
                progressBarRangeInfo = ProgressBarRangeInfo(current ?: 0.5f, 0f..1f, steps = stops?.let { it - 2 } ?: 0)
                setProgress { target ->
                    change(snap(target))
                    true
                }
            },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(width = JKSize.dial, height = JKSize.dial * 0.62f)
                .pointerInput(stops) {
                    detectTapGestures { p -> valueAt(p, size.width.toFloat(), size.height.toFloat())?.let(change) }
                }
                .pointerInput(stops) {
                    detectDragGestures { change2, _ ->
                        valueAt(change2.position, size.width.toFloat(), size.height.toFloat())?.let(change)
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.matchParentSize()) {
                val w = size.width
                val cx = w / 2f
                val cy = size.height
                val r = w / 2f - 10.dp.toPx()
                val stroke = JKSize.hairline.toPx()
                drawArc(
                    JKColors.textTertiary, startAngle, sweep, false,
                    Offset(cx - r, cy - r), Size(r * 2, r * 2), style = Stroke(stroke),
                )
                val ticks = stops ?: 5
                for (i in 0 until ticks) {
                    val a = Math.toRadians((startAngle + sweep * i / (ticks - 1)).toDouble())
                    val inner = r - 6.dp.toPx()
                    drawLine(
                        JKColors.trackStrong,
                        Offset(cx + (inner * cos(a)).toFloat(), cy + (inner * sin(a)).toFloat()),
                        Offset(cx + ((r - 2.dp.toPx()) * cos(a)).toFloat(), cy + ((r - 2.dp.toPx()) * sin(a)).toFloat()),
                        strokeWidth = stroke,
                    )
                }
                val v = current
                if (v != null) {
                    val a = Math.toRadians((startAngle + sweep * v).toDouble())
                    val k = Offset(cx + (r * cos(a)).toFloat(), cy + (r * sin(a)).toFloat())
                    drawCircle(JKColors.bg, 8.dp.toPx(), k)
                    drawCircle(JKColors.silver, 6.dp.toPx(), k)
                }
            }
            Text(
                word, style = JKType.parDialWord, color = if (value == null) JKColors.textTertiary else JKColors.text,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = JKSpace.s),
            )
        }
        Row(Modifier.width(JKSize.dial + JKSpace.xxl).padding(top = JKSpace.xl)) {
            Text(startWord, style = JKType.meta, color = JKColors.textTertiary)
            Spacer(Modifier.weight(1f))
            Text(endWord, style = JKType.meta, color = JKColors.textTertiary)
        }
    }
}

// MARK: - Fields

/** A multi-line field on an underline: serif text, a hairline rule beneath. */
@Composable
fun UnderlinedField(value: String, onValueChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, label: String? = null) {
    val style = JKType.parCardTitle.copy(color = JKColors.text)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = style,
        cursorBrush = SolidColor(JKColors.text),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = modifier.fillMaxWidth().semantics { if (label != null) contentDescription = label },
        decorationBox = { field ->
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                Box(Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget - JKSpace.m), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, style = style.copy(color = JKColors.textTertiary))
                    field()
                }
                Box(Modifier.fillMaxWidth().height(JKSize.hairline).background(JKColors.hairline))
            }
        },
    )
}

// MARK: - Background

/**
 * Very faint concentric circles behind a hero element (Welcome, Your direction,
 * In the session, Before the session). Decorative: hidden from TalkBack.
 * [centerY] is the fraction down the box where the circles are centred.
 */
@Composable
fun FaintRings(modifier: Modifier = Modifier, centerY: Float = 0.4f) {
    Canvas(modifier.fillMaxSize().clearAndSetSemantics {}) {
        val c = Offset(size.width / 2f, size.height * centerY)
        val step = 14.dp.toPx()
        val stroke = JKSize.hairline.toPx()
        val ring = JKColors.text.copy(alpha = 0.035f)
        var r = step * 3
        val max = size.maxDimension
        while (r < max) {
            drawCircle(ring, r, c, style = Stroke(stroke))
            r += step
        }
    }
}
