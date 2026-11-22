package com.jkperformance.app.design.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.quoteStyle

/** The brand device: a short 2dp champagne rule. */
@Composable
fun BrandRule(modifier: Modifier = Modifier) {
    Box(modifier.width(JKSpace.xxxl).height(JKSize.rule).background(JKColors.accent))
}

/**
 * Nothing here: the brand rule and one serif italic line ("Nothing due. Enjoy
 * the evening."), with an optional plain detail under it.
 */
@Composable
fun EmptyState(line: String, modifier: Modifier = Modifier, detail: String? = null) {
    Column(
        modifier.fillMaxWidth().padding(vertical = JKSpace.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(JKSpace.m),
    ) {
        BrandRule()
        Text(line, style = quoteStyle(), color = JKColors.text, textAlign = TextAlign.Center)
        if (detail != null) Text(detail, style = JKType.caption, color = JKColors.textSecondary, textAlign = TextAlign.Center)
    }
}
