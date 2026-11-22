package com.jkperformance.app.design.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.IconKey
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.rememberReduceMotion
import kotlinx.coroutines.launch

/** The activity indicator: eight spokes stepping round once a second (still with animations off). */
@Composable
fun ProgressView(modifier: Modifier = Modifier, tint: Color = LocalContentColor.current, size: Dp = JKSize.iconInline) {
    val reduceMotion = rememberReduceMotion()
    val turn by rememberInfiniteTransition(label = "spinner").animateFloat(
        initialValue = 0f,
        targetValue = SPOKES.toFloat(),
        animationSpec = infiniteRepeatable(tween(1000, easing = LinearEasing)),
        label = "spinner",
    )
    Canvas(modifier.size(size)) {
        val head = if (reduceMotion) 0 else turn.toInt() % SPOKES
        val r = this.size.minDimension / 2
        val width = r * 0.18f
        for (i in 0 until SPOKES) {
            val age = (head - i + SPOKES) % SPOKES
            rotate(i * 360f / SPOKES) {
                drawLine(
                    tint.copy(alpha = tint.alpha * (1f - age * 0.11f)),
                    start = Offset(center.x, center.y - r * 0.45f),
                    end = Offset(center.x, center.y - r + width / 2),
                    strokeWidth = width,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}

private const val SPOKES = 8

@Composable
fun LoadingCard(text: String = "Loading…", modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(vertical = JKSpace.xxxl),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ProgressView(tint = JKColors.textSecondary)
        Text(text, style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** An empty list or section: [EmptyState] on a card (the icon is no longer drawn: empty states carry the brand rule). */
@Composable
fun EmptyCard(title: String, modifier: Modifier = Modifier, detail: String? = null) {
    Column(modifier.jkSurface(padding = JKSpace.l)) {
        EmptyState(title, detail = detail)
    }
}

@Composable
fun ErrorCard(message: String, modifier: Modifier = Modifier, retry: (suspend () -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    Column(modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        IconLabel("Couldn't load", icon = IconKey.error, style = JKType.headline, color = JKColors.text)
        Text(message, style = JKType.callout, color = JKColors.textSecondary)
        if (retry != null) TextButtonStrong("Try again", onClick = { scope.launch { retry() } })
    }
}

/** A one-line error under a header when a refresh or action fails but earlier data is still on screen. */
@Composable
fun ErrorBanner(message: String, modifier: Modifier = Modifier) {
    IconLabel(
        message,
        icon = IconKey.error,
        style = JKType.caption,
        color = JKColors.text,
        modifier = modifier
            .fillMaxWidth()
            .background(JKColors.raised, JKShape.control)
            .padding(JKSpace.m),
    )
}

/** Wraps a load so a screen shows a spinner, the content, or an error. */
@Composable
fun <T> Loadable(
    value: T?,
    error: String?,
    retry: suspend () -> Unit,
    loadingText: String = "Loading…",
    content: @Composable (T) -> Unit,
) {
    when {
        value != null -> {
            if (error != null) ErrorBanner(error)
            content(value)
        }
        error != null -> ErrorCard(error, retry = retry)
        else -> LoadingCard(loadingText)
    }
}

/**
 * Pull to refresh. The load runs in this composable's own scope and the spinner
 * stays until it returns, so a recomposition caused by the load can't cut it short.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JKRefreshable(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try { onRefresh() } finally { refreshing = false }
            }
        },
        modifier = modifier,
        content = content,
    )
}

/** "Something went wrong" with the message, while it is non-null. */
@Composable
fun ErrorAlert(message: String?, onDismiss: () -> Unit) {
    if (message == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButtonStrong("OK", onClick = onDismiss) },
        title = { Text("Something went wrong", style = JKType.headline, color = JKColors.text) },
        text = { Text(message, style = JKType.callout, color = JKColors.textSecondary) },
        containerColor = JKColors.raised,
        shape = JKShape.sheetAll,
    )
}
