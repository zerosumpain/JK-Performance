package com.jkperformance.app.design

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import kotlin.math.pow

/** Timing for [BrandIntro]. */
object BrandIntro {
    /** When the wordmark and tagline have landed (seconds); controls can follow. */
    const val duration: Double = 1.9
}

/** Any time after the last cue: the finished frame. */
private const val FINISHED = 10.0

private val RINGS = listOf(246f, 241f, 236f, 231f, 182f)
private const val ARC_TEXT = "JK    PERFORMANCE    ·    20 KG"
private val GRIP_ANGLES = listOf(-55f, 68f, 172f)
private const val TAGLINE = "Coaching, programming and accountability."

/**
 * The opening animation: a weight plate draws itself in, the JK tile traces
 * its edge and fills, a chrome sheen crosses it, then PERFORMANCE settles
 * and the tagline appears. About two seconds. Plays when the app opens
 * (over the signed-in tabs) and behind the Welcome screen. With animations
 * turned off (Android's Reduce Motion) it shows the finished frame at once.
 *
 * Drawn on one Canvas from a clock, as the Swift version draws from a
 * TimelineView: the clock is read only while drawing, so frames redraw
 * without recomposing. It takes no touches, so controls laid over it work.
 *
 * @param centerY the plate's centre, as a fraction of the height.
 */
@Composable
fun BrandIntro(modifier: Modifier = Modifier, centerY: Float = 0.36f) {
    val context = LocalContext.current
    val reduceMotion = remember {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    val clock = remember { mutableFloatStateOf(if (reduceMotion) FINISHED.toFloat() else 0f) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) return@LaunchedEffect
        val start = withFrameNanos { it }
        while (true) {
            val t = withFrameNanos { (it - start) / 1e9 }
            if (t > BrandIntro.duration + 0.4) {
                clock.floatValue = FINISHED.toFloat()
                break
            }
            clock.floatValue = t.toFloat()
        }
    }

    // The plate's lettering is a fixed size, like `.system(size:)`; the tagline follows the font setting like `.footnote`.
    val density = LocalDensity.current
    fun fixed(points: Float): TextUnit = with(density) { points.dp.toSp() }
    val measurer = rememberTextMeasurer()
    val arcGlyphs = remember(measurer) {
        val style = TextStyle(fontSize = fixed(8f), fontWeight = FontWeight.SemiBold)
        ARC_TEXT.map { measurer.measure(it.toString(), style) }
    }
    val monogram = remember(measurer) { measurer.measure("JK", TextStyle(fontSize = fixed(36f), fontWeight = FontWeight.SemiBold)) }
    val tagline = remember(measurer) { measurer.measure(TAGLINE, JKType.footnote) }
    val wordmarkSize = fixed(15f)

    Canvas(
        modifier
            .fillMaxSize()
            .clearAndSetSemantics { contentDescription = "JK Performance. $TAGLINE" },
    ) {
        scene(
            t = clock.floatValue.toDouble(),
            centerY = centerY,
            measurer = measurer,
            arcGlyphs = arcGlyphs,
            monogram = monogram,
            tagline = tagline,
            wordmarkStyle = TextStyle(fontSize = wordmarkSize, fontWeight = FontWeight.SemiBold),
        )
    }
}

// The frame at time t. Lengths are the Swift points, scaled by `density`.

private fun DrawScope.scene(
    t: Double,
    centerY: Float,
    measurer: TextMeasurer,
    arcGlyphs: List<TextLayoutResult>,
    monogram: TextLayoutResult,
    tagline: TextLayoutResult,
    wordmarkStyle: TextStyle,
) {
    val k = density
    val c = Offset(size.width / 2, size.height * centerY)

    drawRect(Color.Black)
    drawRect(
        Brush.radialGradient(
            listOf(Color(0.12f, 0.12f, 0.12f), Color.Black),
            center = Offset(size.width * 0.5f, size.height * (centerY - 0.06f)),
            radius = size.height * 0.65f,
        ),
        alpha = ease(t, 0.0, 0.9),
    )

    // Plate rims, drawn round from staggered starting points.
    RINGS.forEachIndexed { i, r ->
        val f = ease(t, 0.04 + i * 0.06, 0.62 + i * 0.06)
        if (f > 0f) {
            drawArc(
                Color.White.copy(alpha = if (i < 4) 0.2f else 0.11f),
                startAngle = -100f + i * 40f,
                sweepAngle = 360f * f,
                useCenter = false,
                topLeft = Offset(c.x - r * k, c.y - r * k),
                size = Size(2 * r * k, 2 * r * k),
                style = Stroke(0.7f * k),
            )
        }
    }

    // Grip cut-outs.
    val grips = ease(t, 0.5, 0.95)
    GRIP_ANGLES.forEach { angle ->
        val p = plateSegment(c, angle, span = 26f, inner = 120f * k, outer = 146f * k)
        drawPath(p, Color.White.copy(alpha = 0.025f), alpha = grips)
        drawPath(p, Color.White.copy(alpha = 0.2f), alpha = grips, style = Stroke(0.8f * k))
    }

    // "JK · PERFORMANCE · 20 KG" round the top of the plate.
    val lettering = ease(t, 0.6, 1.05)
    if (lettering > 0f) {
        arcGlyphs.forEachIndexed { i, glyph ->
            rotate(-52f + i * 3.4f, pivot = c) {
                drawText(
                    glyph,
                    color = Color.White.copy(alpha = 0.42f),
                    topLeft = Offset(c.x - glyph.size.width / 2f, c.y - 166f * k - glyph.size.height / 2f),
                    alpha = lettering,
                )
            }
        }
    }

    // Hub circle behind the tile.
    val hub = ease(t, 0.3, 0.75)
    if (hub > 0f) {
        drawArc(
            Color.White.copy(alpha = 0.16f),
            startAngle = 90f,
            sweepAngle = 360f * hub,
            useCenter = false,
            topLeft = Offset(c.x - 56f * k, c.y + 8f * k - 56f * k),
            size = Size(112f * k, 112f * k),
            style = Stroke(0.8f * k),
        )
    }

    tile(t, c, monogram)

    val wordmark = ease(t, 1.05, 1.45)
    if (wordmark > 0f) {
        val tracking = 6f + 12f * (1f - ease(t, 1.1, 1.6))
        val layout = measurer.measure("PERFORMANCE", wordmarkStyle.copy(letterSpacing = (tracking * k).toSp()))
        drawCentred(layout, JK.text, Offset(c.x, c.y + 92f * k), wordmark)
    }

    val tag = ease(t, 1.4, 1.8)
    if (tag > 0f) drawCentred(tagline, JK.secondary, Offset(c.x, c.y + 118f * k), tag)
}

private fun DrawScope.tile(t: Double, c: Offset, monogram: TextLayoutResult) {
    val k = density
    val half = 52f * k
    val corner = 18f * k
    val box = Rect(c, half)
    val shape = Path().apply { addRoundRect(RoundRect(box, CornerRadius(corner))) }

    // Ground with its faint white glow (SwiftUI's `.shadow(color: .white…, radius: 24)`).
    val fill = ease(t, 0.55, 1.0)
    val glow = ease(t, 0.9, 1.4)
    drawIntoCanvas { canvas ->
        val paint = Paint().asFrameworkPaint().apply {
            isAntiAlias = true
            color = Color(0.06f, 0.06f, 0.06f, fill).toArgb()
            if (glow > 0f) setShadowLayer(24f * k, 0f, 0f, Color.White.copy(alpha = 0.08f * glow).toArgb())
        }
        canvas.nativeCanvas.drawRoundRect(box.left, box.top, box.right, box.bottom, corner, corner, paint)
    }

    val letters = ease(t, 0.7, 1.05)
    if (letters > 0f) {
        scale(0.94f + 0.06f * letters, pivot = c) { drawCentred(monogram, JK.text, c, letters) }
    }

    // The chrome sheen: a bright slanted band swept across, kept inside the tile.
    val sheen = linear(t, 1.05, 1.5)
    if (sheen > 0f && sheen < 1f) {
        val x = c.x + (-150f + 300f * sheen) * k
        clipPath(shape) {
            rotate(28f, pivot = Offset(x, c.y)) {
                drawRect(
                    Brush.horizontalGradient(
                        listOf(Color.Transparent, Color.White.copy(alpha = 0.85f), Color(0.75f, 0.75f, 0.75f, 0.6f), Color.Transparent),
                        startX = x - 35f * k,
                        endX = x + 35f * k,
                    ),
                    topLeft = Offset(x - 35f * k, c.y - 110f * k),
                    size = Size(70f * k, 220f * k),
                    blendMode = BlendMode.Plus,
                )
            }
        }
    }

    // The edge traces itself in, clockwise from the top-left.
    val edge = ease(t, 0.3, 0.85)
    if (edge > 0f) {
        val measure = PathMeasure().apply { setPath(roundedOutline(box, corner), false) }
        val traced = Path()
        measure.getSegment(0f, measure.length * edge, traced, true)
        drawPath(traced, Color.White.copy(alpha = 0.85f), style = Stroke(1.2f * k))
    }
}

/** A rounded rectangle's outline as one clockwise run starting just after the top-left corner. */
private fun roundedOutline(r: Rect, radius: Float): Path = Path().apply {
    val d = radius * 2
    moveTo(r.left + radius, r.top)
    lineTo(r.right - radius, r.top)
    arcTo(Rect(r.right - d, r.top, r.right, r.top + d), -90f, 90f, false)
    lineTo(r.right, r.bottom - radius)
    arcTo(Rect(r.right - d, r.bottom - d, r.right, r.bottom), 0f, 90f, false)
    lineTo(r.left + radius, r.bottom)
    arcTo(Rect(r.left, r.bottom - d, r.left + d, r.bottom), 90f, 90f, false)
    lineTo(r.left, r.top + radius)
    arcTo(Rect(r.left, r.top, r.left + d, r.top + d), 180f, 90f, false)
}

/** A ring-shaped wedge (an annular sector) about `c`, `span` degrees wide around `center`. */
private fun plateSegment(c: Offset, center: Float, span: Float, inner: Float, outer: Float): Path = Path().apply {
    val a0 = center - span / 2
    arcTo(Rect(c, outer), a0, span, forceMoveTo = true)
    arcTo(Rect(c, inner), a0 + span, -span, forceMoveTo = false)
    close()
}

private fun DrawScope.drawCentred(layout: TextLayoutResult, color: Color, at: Offset, alpha: Float) {
    drawText(
        layout,
        color = color,
        topLeft = Offset(at.x - layout.size.width / 2f, at.y - layout.size.height / 2f),
        alpha = alpha,
    )
}

// Timing

/** 0 before `a`, 1 after `b`, ease-out cubic between. */
private fun ease(t: Double, a: Double, b: Double): Float = (1 - (1 - linear(t, a, b)).toDouble().pow(3)).toFloat()

private fun linear(t: Double, a: Double, b: Double): Float = ((t - a) / (b - a)).coerceIn(0.0, 1.0).toFloat()
