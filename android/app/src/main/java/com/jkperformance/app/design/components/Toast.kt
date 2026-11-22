package com.jkperformance.app.design.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKMotion
import com.jkperformance.app.design.JKShape
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKSpace
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.rememberReduceMotion
import kotlinx.coroutines.delay

/** What a [ToastHost] shows: one message, with an optional action ("Undo"). */
class ToastMessage(val text: String, val action: String? = null, val onAction: () -> Unit = {})

@Stable
class ToastState {
    var current by mutableStateOf<ToastMessage?>(null)
        private set

    fun show(message: ToastMessage) { current = message }
    fun show(text: String, action: String? = null, onAction: () -> Unit = {}) = show(ToastMessage(text, action, onAction))
    fun dismiss() { current = null }
}

@Composable
fun rememberToastState(): ToastState = remember { ToastState() }

/**
 * A quiet bar at the foot of the screen for the untick undo and "Updates from
 * Health" messages. It stays [JKMotion.TOAST] ms and is announced politely.
 */
@Composable
fun BoxScope.ToastHost(state: ToastState, modifier: Modifier = Modifier) {
    val reduceMotion = rememberReduceMotion()
    val message = state.current
    LaunchedEffect(message) {
        if (message != null) {
            delay(JKMotion.TOAST.toLong())
            if (state.current === message) state.dismiss()
        }
    }
    AnimatedVisibility(
        visible = message != null,
        modifier = modifier.align(Alignment.BottomCenter).padding(JKSpace.l),
        enter = fadeIn(tween(if (reduceMotion) 0 else JKMotion.STANDARD)),
        exit = fadeOut(tween(if (reduceMotion) 0 else JKMotion.STANDARD)),
    ) {
        val shown = message ?: return@AnimatedVisibility
        Toast(shown.text, shown.action, onAction = { shown.onAction(); state.dismiss() })
    }
}

/** The toast's look on its own. */
@Composable
fun Toast(text: String, action: String? = null, modifier: Modifier = Modifier, onAction: () -> Unit = {}) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget)
            .background(JKColors.raised, JKShape.card)
            .padding(horizontal = JKSpace.l)
            .semantics { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f).padding(vertical = JKSpace.m))
        if (action != null) TextButtonStrong(action, onClick = onAction)
    }
}

