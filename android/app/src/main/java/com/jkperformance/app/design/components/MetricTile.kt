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
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType

/** Which way a metric is going: a glyph, never a colour. */
enum class Trend(val icon: IconKey, val spoken: String) {
    Up(IconKey.trendUp, "up"),
    Flat(IconKey.trendFlat, "steady"),
    Down(IconKey.trendDown, "down"),
}

/**
 * A Progress tile: label, the number (numberTile, tabular, shrinking to fit),
 * a status word in textSecondary with a trend glyph, and what the figure is
 * made from ("22 of the last 28 days").
 */
@Composable
fun MetricTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    status: String? = null,
    trend: Trend? = null,
    source: String? = null,
) {
    Column(modifier.jkSurface(SurfaceVariant.Card, padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        Text(label, style = JKType.caption, color = JKColors.textSecondary)
        FittingText(value, style = JKType.numberTile, color = JKColors.text, minimumScaleFactor = 0.6f)
        if (status != null || trend != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                if (trend != null) Glyph(trend.icon, size = JKSize.iconSmall, tint = JKColors.textSecondary, contentDescription = trend.spoken)
                if (status != null) Text(status, style = JKType.caption, color = JKColors.textSecondary)
            }
        }
        if (source != null) Text(source, style = JKType.caption, color = JKColors.textTertiary)
    }
}
