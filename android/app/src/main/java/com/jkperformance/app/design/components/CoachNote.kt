package com.jkperformance.app.design.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.quoteStyle

/**
 * JK's latest word on Today: his avatar (portrait or monogram) with a caption
 * and unread dot, his line in the serif italic (two lines at most) and Reply.
 * The caller hides it under the stale rule; there is one form only.
 */
@Composable
fun CoachNote(
    quote: String,
    caption: String,
    modifier: Modifier = Modifier,
    avatarMediaId: String? = null,
    unread: Boolean = false,
    onOpen: (() -> Unit)? = null,
    onReply: (() -> Unit)? = null,
) {
    Column(
        modifier
            .fillMaxWidth()
            .then(if (onOpen != null) Modifier.clickable(role = Role.Button, onClick = onOpen) else Modifier),
        verticalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            CoachAvatar(avatarMediaId, size = JKSize.avatarSmall)
            Text(caption, style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
            if (unread) Dot(JKColors.accent, modifier = Modifier.semantics { contentDescription = "Unread" })
        }
        Text("“$quote”", style = quoteStyle(), color = JKColors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (onReply != null) TextButton("Reply", onClick = onReply)
    }
}
