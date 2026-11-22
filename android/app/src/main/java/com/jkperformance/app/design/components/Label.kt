package com.jkperformance.app.design.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.isAccessibilityFontScale

/**
 * The label: small spaced capitals in textSecondary, at most one per screen
 * (none on Today). At accessibility font scales it switches to sentence case
 * and drops the tracking. Replaces Eyebrow.
 */
@Composable
fun Label(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    val large = isAccessibilityFontScale()
    val style = if (large) JKType.label.copy(letterSpacing = 0.sp) else JKType.label
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(if (large) text else text.uppercase(), style = style, color = JKColors.textSecondary, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.weight(1f))
        if (trailing != null) Text(trailing, style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** A glyph then text in one style and colour (SwiftUI's `Label(_, systemImage:)`). */
@Composable
fun IconLabel(
    title: String,
    icon: IconKey,
    style: TextStyle = JKType.body,
    color: Color = LocalContentColor.current,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
        Glyph(icon, style, color, filled = filled)
        Text(title, style = style, color = color)
    }
}
