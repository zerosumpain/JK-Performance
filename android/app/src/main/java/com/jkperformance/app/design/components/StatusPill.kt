package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType

/** A small solid dot, for keys and status. */
@Composable
fun Dot(color: Color, size: Dp = JKSize.dot, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(color, CircleShape))
}

/**
 * A status word with its dot ("Worth a look", "On track"). Coach screens only,
 * at most two per screen; the word carries the meaning, the colour only repeats it.
 */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Row(
        modifier
            .border(JKSize.hairline, JKColors.hairline, CircleShape)
            .padding(horizontal = JKSpace.s + JKSpace.xs / 2, vertical = JKSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.xs + JKSpace.xs / 2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(color)
        Text(text, style = JKType.caption, color = JKColors.text, maxLines = 1)
    }
}
