package com.jkperformance.app.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp
import com.jkperformance.app.R

/*
 * Atelier type (docs/design/atelier-spec.md, Type): two families. The serif,
 * Newsreader (OFL, res/raw/newsreader_ofl.txt), is JK's voice only: his words,
 * the goal sentence, letter and guide headlines and empty-state lines, never
 * below 17sp. Everything else is the system sans (Roboto). Sizes are sp so the
 * phone's font scale (including Android 14's non-linear scaling) applies.
 * Literal sizes live only in this file.
 */

/**
 * Newsreader at one optical size. The fonts are variable (opsz 6–72, wght
 * 200–800); each token pins its own opsz so a 30sp headline gets the display
 * cut and a 17sp quote the text cut, as the spec asks.
 */
@OptIn(ExperimentalTextApi::class)
private fun newsreader(opsz: Float, italic: Boolean = false, weight: Int = 400): FontFamily = FontFamily(
    Font(
        if (italic) R.font.newsreader_italic else R.font.newsreader_roman,
        weight = FontWeight(weight),
        style = if (italic) FontStyle.Italic else FontStyle.Normal,
        variationSettings = FontVariation.Settings(
            FontVariation.weight(weight),
            FontVariation.Setting("opsz", opsz),
        ),
    ),
)

private val trimNone = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

private fun sans(size: Float, leading: Float, weight: FontWeight, tracking: Float = 0f) = TextStyle(
    fontFamily = FontFamily.Default,
    fontSize = size.sp,
    lineHeight = leading.sp,
    fontWeight = weight,
    letterSpacing = tracking.sp,
    lineHeightStyle = trimNone,
)

private fun serif(size: Float, leading: Float, italic: Boolean = false) = TextStyle(
    fontFamily = newsreader(size, italic),
    fontSize = size.sp,
    lineHeight = leading.sp,
    fontWeight = FontWeight.Normal,
    fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
    letterSpacing = 0.sp,
    lineHeightStyle = trimNone,
)

/** The 11 type tokens (plus the sheet size of the quote). Client screens never go under 13sp; [label] is the one 11sp exception. */
object JKType {
    /** Greeting and screen titles. */
    val display = sans(34f, 40f, FontWeight.Light, tracking = -0.4f)
    /** Letter headlines (serif). */
    val letterHeadline = serif(30f, 36f)
    /** The goal sentence and letter section heads (serif). */
    val title = serif(22f, 28f)
    /** JK's line (serif italic). */
    val quote = serif(19f, 28f, italic = true)
    /** JK's line inside a sheet. */
    val quoteSheet = serif(17f, 24f, italic = true)
    val headline = sans(17f, 24f, FontWeight.SemiBold)
    val body = sans(17f, 24f, FontWeight.Normal)
    /** Buttons and row labels. */
    val callout = sans(15f, 20f, FontWeight.Medium)
    val caption = sans(13f, 18f, FontWeight.Medium, tracking = 0.2f)
    /** The one-per-screen label: uppercase (by the Label component), tracked, textSecondary. */
    val label = sans(11f, 14f, FontWeight.SemiBold, tracking = 1.2f)
    val numberHero = sans(48f, 52f, FontWeight.Light).monospacedDigit()
    val numberTile = sans(28f, 32f, FontWeight.Normal).monospacedDigit()

    /** The monogram's text stand-in where a vector cannot go (notification text, a11y previews). */
    val monogram = serif(22f, 28f)
}

/**
 * JK's quote at the current font scale: at 1.75 and above the serif italic
 * gets hard to read, so it switches to the sans italic (spec, accessibility fallback).
 */
@Composable
fun quoteStyle(inSheet: Boolean = false): TextStyle {
    val base = if (inSheet) JKType.quoteSheet else JKType.quote
    return if (LocalDensity.current.fontScale >= 1.75f) {
        base.copy(fontFamily = FontFamily.Default, fontStyle = FontStyle.Italic)
    } else {
        base
    }
}

/** True when the phone's font scale calls for vertical layouts (AdaptiveStack). */
@Composable
fun isAccessibilityFontScale(): Boolean = LocalDensity.current.fontScale >= 1.5f

fun TextStyle.weight(weight: FontWeight): TextStyle = copy(fontWeight = weight)
fun TextStyle.regular(): TextStyle = weight(FontWeight.Normal)
fun TextStyle.medium(): TextStyle = weight(FontWeight.Medium)
fun TextStyle.semibold(): TextStyle = weight(FontWeight.SemiBold)
fun TextStyle.bold(): TextStyle = weight(FontWeight.Bold)

/** Tabular figures, so counting numbers (timers, weights) don't jiggle. */
fun TextStyle.monospacedDigit(): TextStyle = copy(fontFeatureSettings = "tnum")

/** `.monospaced()`: the whole run in the monospaced face. */
fun TextStyle.monospaced(): TextStyle = copy(fontFamily = FontFamily.Monospace)

/** Extra space between letters, in sp. */
fun TextStyle.tracking(points: Float): TextStyle = copy(letterSpacing = points.sp)
