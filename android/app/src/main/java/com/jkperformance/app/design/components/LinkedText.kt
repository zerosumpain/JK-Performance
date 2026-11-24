package com.jkperformance.app.design.components

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.net.GuideText
import com.jkperformance.app.net.Links

/**
 * Message text with its `https` links tappable (desk-v2 F13: the plan-page
 * links in invitations and nudges). Links open in the browser through the
 * platform's URL handler; http and anything else stay plain text.
 */
@Composable
fun LinkedText(text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    val ranges = remember(text) { Links.find(text) }
    if (ranges.isEmpty()) {
        Text(text, style = style, color = color, modifier = modifier)
        return
    }
    val linkStyle = TextLinkStyles(SpanStyle(color = color, textDecoration = TextDecoration.Underline))
    val annotated = remember(text, color) {
        buildAnnotatedString {
            var at = 0
            ranges.forEach { r ->
                append(text.substring(at, r.first))
                val url = text.substring(r)
                withLink(LinkAnnotation.Url(url, linkStyle)) { append(url) }
                at = r.last + 1
            }
            append(text.substring(at))
        }
    }
    Text(annotated, style = style, color = color, modifier = modifier)
}

/**
 * Guide text with its two inline markers (`**bold**`, `_italic_`) drawn as
 * styled runs. Never HTML: anything else, tags included, is shown as written.
 */
@Composable
fun GuideRichText(text: String, style: TextStyle, color: Color = JKColors.text, modifier: Modifier = Modifier) {
    val annotated = remember(text) {
        buildAnnotatedString {
            GuideText.runs(text).forEach { run ->
                val span = SpanStyle(
                    fontWeight = if (run.bold) FontWeight.SemiBold else null,
                    fontStyle = if (run.italic) FontStyle.Italic else null,
                )
                if (run.bold || run.italic) withStyle(span) { append(run.text) } else append(run.text)
            }
        }
    }
    Text(annotated, style = style, color = color, modifier = modifier)
}
