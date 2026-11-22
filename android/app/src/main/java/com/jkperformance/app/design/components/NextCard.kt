package com.jkperformance.app.design.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.jkperformance.app.design.Glyph
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType

/**
 * The one next thing (session, call, check-in, form, workout, booking, rest,
 * membership): the only bordered card on Today. One item, one PrimaryButton
 * and an optional "also due" caption. The form never changes, only the content.
 */
@Composable
fun NextCard(
    icon: IconKey,
    kind: String,
    title: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
    action: String? = null,
    onAction: () -> Unit = {},
    alsoDue: String? = null,
) {
    Column(modifier.jkSurface(SurfaceVariant.Next), verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            Glyph(icon, tint = JKColors.textSecondary)
            Text(kind, style = JKType.caption, color = JKColors.textSecondary)
        }
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(title, style = JKType.headline, color = JKColors.text)
            if (detail != null) Text(detail, style = JKType.callout, color = JKColors.textSecondary)
        }
        if (action != null) PrimaryButton(action, onClick = onAction)
        if (alsoDue != null) Text(alsoDue, style = JKType.caption, color = JKColors.textSecondary)
    }
}
