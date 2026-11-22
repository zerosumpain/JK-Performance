package com.jkperformance.app.design.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.isAccessibilityFontScale

/** A row that becomes a column at font scale 1.5 and above. `content` gets whether it is vertical. */
@Composable
fun AdaptiveStack(
    modifier: Modifier = Modifier,
    spacing: Dp = JKSpace.m,
    content: @Composable (vertical: Boolean) -> Unit,
) {
    if (isAccessibilityFontScale()) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(spacing)) { content(true) }
    } else {
        Row(modifier, horizontalArrangement = Arrangement.spacedBy(spacing), verticalAlignment = Alignment.CenterVertically) { content(false) }
    }
}
