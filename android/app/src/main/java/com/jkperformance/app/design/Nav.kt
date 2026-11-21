package com.jkperformance.app.design

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import java.util.concurrent.atomic.AtomicLong

/**
 * SwiftUI's NavigationStack + NavigationLink, for Compose: each tab owns a
 * stack of screens, and any screen can push the next one as a composable
 * lambda — the same shape as `NavigationLink { ClientDetailView(...) } label: {...}`,
 * so the iPhone views port one to one.
 *
 *   val nav = LocalNav.current
 *   Row(Modifier.navLink { ClientDetailView(clientId = c.id, name = c.name) }) { ... }
 *   nav.pop()  // SwiftUI's dismiss()
 */
class NavStack internal constructor() {
    internal class Entry(val key: Long, val content: @Composable () -> Unit)

    internal val entries = mutableStateListOf<Entry>()
    val depth: Int get() = entries.size

    fun push(content: @Composable () -> Unit) { entries.add(Entry(nextKey.incrementAndGet(), content)) }
    fun pop() { if (entries.isNotEmpty()) entries.removeAt(entries.lastIndex) }
    fun popToRoot() { entries.clear() }

    private companion object { val nextKey = AtomicLong() }
}

val LocalNav = staticCompositionLocalOf<NavStack> { error("No NavStack: wrap the tab in NavHost { }") }

/** One tab's navigation: shows `root`, or the top pushed screen; system back pops. */
@Composable
fun NavHost(stack: NavStack = remember { NavStack() }, root: @Composable () -> Unit) {
    val holder = rememberSaveableStateHolder()
    BackHandler(enabled = stack.depth > 0) { stack.pop() }
    CompositionLocalProvider(LocalNav provides stack) {
        val top = stack.entries.lastOrNull()
        AnimatedContent(
            targetState = top,
            transitionSpec = {
                val forward = (targetState?.key ?: 0) > (initialState?.key ?: 0)
                if (forward) (slideInHorizontally(tween(260)) { it / 3 } + fadeIn(tween(200))) togetherWith fadeOut(tween(150))
                else fadeIn(tween(200)) togetherWith (slideOutHorizontally(tween(240)) { it / 3 } + fadeOut(tween(200)))
            },
            label = "nav",
        ) { entry ->
            holder.SaveableStateProvider(entry?.key ?: 0L) {
                if (entry == null) root() else entry.content()
            }
        }
    }
}

/** Remember a stack for a tab (so switching tabs keeps each tab's place). */
@Composable
fun rememberNavStack(): NavStack = remember { NavStack() }

/** NavigationLink: tapping pushes `destination`. Disabled links do nothing, like `.disabled(true)`. */
@Composable
fun Modifier.navLink(enabled: Boolean = true, destination: @Composable () -> Unit): Modifier {
    val nav = LocalNav.current
    return this.clickable(enabled = enabled) { nav.push(destination) }
}
