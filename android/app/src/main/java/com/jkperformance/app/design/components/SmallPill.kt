package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.isAccessibilityFontScale

/**
 * A small hairline pill for row actions (Start, Join, Details, Cancel, Tick,
 * Add to calendar): callout text or a glyph, 48dp minimum target. iOS's
 * SmallPillStyle.
 */
@Composable
fun SmallPill(
    text: String? = null,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: IconKey? = null,
    enabled: Boolean = true,
    contentDescription: String? = null,
) {
    Box(
        modifier
            .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
            .clip(JKShape.pill)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .then(if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier)
            .alpha(if (enabled) 1f else 0.5f),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .border(JKSize.hairline, JKColors.inputBorder, JKShape.pill)
                .padding(horizontal = JKSpace.m, vertical = JKSpace.s),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(JKSpace.xs),
        ) {
            if (icon != null) Glyph(icon, size = JKSize.iconSmall, tint = JKColors.text)
            if (text != null) Text(text, style = JKType.callout, color = JKColors.text, maxLines = 1)
        }
    }
}

/**
 * One quiet row of word choices, each at least 48dp high: the chosen one in
 * the primary fill, the rest on surface. Vertical at font scale 1.5 and above.
 * Used by the check-in scales and the session-complete feel row.
 */
@Composable
fun WordChoices(words: List<String>, selected: Int?, onSelect: (Int) -> Unit, modifier: Modifier = Modifier, title: String? = null) {
    val cell: @Composable (Int, Modifier) -> Unit = { i, m ->
        val on = selected == i
        Box(
            m
                .heightIn(min = JKSize.touchTarget)
                .clip(JKShape.chip)
                .background(if (on) JKColors.primaryFill else JKColors.surface, JKShape.chip)
                .clickable(role = Role.RadioButton) { onSelect(i) }
                .semantics {
                    this.selected = on
                    contentDescription = if (title != null) "$title: ${words[i]}" else words[i]
                }
                .padding(horizontal = JKSpace.xs, vertical = JKSpace.s),
            contentAlignment = Alignment.Center,
        ) {
            Text(words[i], style = JKType.caption, color = if (on) JKColors.primaryLabel else JKColors.text, textAlign = TextAlign.Center, maxLines = 2)
        }
    }
    if (isAccessibilityFontScale()) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) { words.indices.forEach { cell(it, Modifier.fillMaxWidth()) } }
    } else {
        Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) { words.indices.forEach { cell(it, Modifier.weight(1f)) } }
    }
}
