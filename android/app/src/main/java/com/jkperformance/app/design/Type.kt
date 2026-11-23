package com.jkperformance.app.design

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
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

    // Plan. Act. Review. (docs/design/plan-act-review.md, Type): Newsreader regular with one
    // italic word ([emphasized]), tracked labels, quiet meta and italic annotations.

    /** Screen titles: "Today's *work.*". */
    val parTitle = serif(30f, 36f)
    /** "Plan. *Act.* Review." on Welcome, and the exercise name in the session. */
    val parDisplay = serif(34f, 40f)
    /** Card titles: "Lower body strength, and three habits." */
    val parCardTitle = serif(18f, 24f)
    /** The season's aim. */
    val parQuote = serif(24f, 30f)
    /** JK's notes from the accountability session. */
    val parNotes = serif(19f, 27f)
    /** Priority and agreed-commitment titles, the planning date. */
    val parSmall = serif(15f, 20f)
    /** JK's cue in the session. */
    val parCue = serif(17f, 24f, italic = true)
    /** The word in the middle of a dial. */
    val parDialWord = serif(24f, 30f, italic = true)
    /** Tracked uppercase labels: "MONDAY 23 NOVEMBER", the tab words. */
    val parLabel = sans(11f, 14f, FontWeight.SemiBold, tracking = 1.6f)
    /** Body copy, 15/21. */
    val parBody = sans(15f, 21f, FontWeight.Normal)
    /** Card meta, 12/16. */
    val meta = sans(12f, 16f, FontWeight.Normal)
    /** Italic serif notes on a label row: "the work between sessions". */
    val annotation = serif(13f, 18f, italic = true)
    /** Primary and secondary button labels. */
    val button = sans(16f, 20f, FontWeight.SemiBold)
    val buttonSmall = sans(13f, 16f, FontWeight.SemiBold)
    /** Habit names under their rings. */
    val habitName = sans(13f, 17f, FontWeight.Normal)
    /** The small "JK." mark. */
    val markSmall = sans(10f, 12f, FontWeight.Bold)
    /** The session header's name. */
    val parHeadline = sans(15f, 20f, FontWeight.SemiBold)
}

/**
 * Newsreader with the words between asterisks in italic, as the board sets
 * titles: `emphasized("Good morning,\n*Sam.*", JKType.parTitle)`. The italic
 * uses the italic cut at the same optical size, so it is a true italic.
 */
fun emphasized(text: String, style: TextStyle): AnnotatedString {
    val size = style.fontSize.value
    val italic = SpanStyle(fontFamily = newsreader(size, italic = true), fontStyle = FontStyle.Italic)
    return buildAnnotatedString {
        var inItalic = false
        text.split('*').forEachIndexed { i, part ->
            if (i > 0) inItalic = !inItalic
            if (part.isEmpty()) return@forEachIndexed
            if (inItalic) withStyle(italic) { append(part) } else append(part)
        }
    }
}

/** "Goblet *squat*": the last word of a name in italic (spec, In the session). */
fun lastWordItalic(name: String): String {
    val trimmed = name.trim()
    val cut = trimmed.lastIndexOf(' ')
    return if (cut <= 0) "*$trimmed*" else trimmed.substring(0, cut + 1) + "*" + trimmed.substring(cut + 1) + "*"
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
