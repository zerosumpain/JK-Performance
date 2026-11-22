package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Monogram

/**
 * A letter from JK in the timeline: paper, the accent letter rule, the week,
 * the serif headline and a line of it. Milestone letters carry the flag glyph.
 */
@Composable
fun LetterCard(
    headline: String,
    week: String,
    modifier: Modifier = Modifier,
    excerpt: String? = null,
    unread: Boolean = false,
    milestone: Boolean = false,
    onOpen: () -> Unit = {},
) {
    Column(
        modifier
            .jkSurface(SurfaceVariant.Paper)
            .clickable(role = Role.Button, onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            if (milestone) Glyph(IconKey.milestone, size = JKSize.iconSmall, tint = JKColors.accent) else Monogram(size = JKSize.iconSmall, contentDescription = null)
            Text(week, style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
            if (unread) Dot(JKColors.accent, modifier = Modifier.semantics { contentDescription = "Unread" })
        }
        Box(Modifier.width(JKSpace.xxl).height(JKSize.rule).background(JKColors.accent))
        Text(headline, style = JKType.title, color = JKColors.text)
        if (excerpt != null) Text(excerpt, style = JKType.body, color = JKColors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
