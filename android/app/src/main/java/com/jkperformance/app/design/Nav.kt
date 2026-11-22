package com.jkperformance.app.design

import android.os.Build
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import java.util.concurrent.atomic.AtomicLong
import com.jkperformance.app.design.components.*

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

/**
 * One tab's navigation: `root` with the pushed screens on top; system back pops.
 *
 * Like a SwiftUI NavigationStack, screens underneath stay alive: every layer
 * stays composed (so plain `remember` state — a half-written draft, a loaded
 * list, a scroll position — is still there on the way back), but only the top
 * one is placed, drawn and touchable. The top layer slides in when pushed.
 */
@Composable
fun NavHost(stack: NavStack = remember { NavStack() }, root: @Composable () -> Unit) {
    BackHandler(enabled = stack.depth > 0) { stack.pop() }
    CompositionLocalProvider(LocalNav provides stack) {
        val entries = stack.entries.toList()
        Layout(
            content = {
                Box { root() }
                entries.forEach { entry ->
                    key(entry.key) {
                        val shown = remember { Animatable(0f) }
                        LaunchedEffect(Unit) { shown.animateTo(1f, tween(260)) }
                        Box(Modifier.graphicsLayer {
                            translationX = (1f - shown.value) * size.width / 3f
                            alpha = 0.4f + 0.6f * shown.value
                        }) {
                            CompositionLocalProvider(LocalDismiss provides { stack.pop() }) { entry.content() }
                        }
                    }
                }
            },
        ) { measurables, constraints ->
            // Only the top layer is measured and placed; the rest wait, composed.
            val top = measurables.last().measure(constraints)
            layout(top.width, top.height) { top.place(0, 0) }
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

// MARK: - Dismiss, top bars and sheets

/**
 * SwiftUI's `@Environment(\.dismiss)`: inside a pushed screen it pops; at the
 * root of a sheet it closes the sheet; at a tab root it does nothing.
 */
val LocalDismiss = staticCompositionLocalOf<() -> Unit> { {} }

/**
 * The inline navigation bar (`.navigationTitle` + `.navigationBarTitleDisplayMode(.inline)`
 * + `.toolbar`): a back chevron when there's somewhere to go back to, the title
 * centred, and optional leading/trailing items (Cancel, Done, a "+" button).
 * Pass `leading` to replace the back chevron (a sheet's "Cancel").
 */
@Composable
fun TopBar(
    title: String = "",
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val nav = LocalNav.current
    Box(modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 8.dp)) {
        Row(Modifier.align(Alignment.CenterStart), verticalAlignment = Alignment.CenterVertically) {
            when {
                leading != null -> leading()
                nav.depth > 0 -> Row(
                    Modifier.clickable { nav.pop() }.padding(horizontal = 4.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Glyph(IconKey.back, size = JKSize.iconTab, tint = JKColors.text, contentDescription = "Back")
                    Text("Back", style = JKType.body, color = JKColors.text)
                }
            }
        }
        if (title.isNotEmpty()) {
            Text(title, style = JKType.headline, color = JKColors.text, maxLines = 1, modifier = Modifier.align(Alignment.Center).padding(horizontal = 80.dp))
        }
        Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, content = trailing)
    }
}

/** A text button for a top bar ("Cancel", "Done", "Save"); bold for the confirming one. */
@Composable
fun BarButton(text: String, bold: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        text,
        style = if (bold) JKType.body.semibold() else JKType.body,
        color = if (enabled) JKColors.text else JKColors.textTertiary,
        modifier = Modifier.clickable(enabled = enabled, onClick = onClick).padding(horizontal = 8.dp, vertical = 10.dp),
    )
}

/**
 * SwiftUI's `.sheet`: a full-screen card over everything, with its own
 * navigation stack (sheets in the iPhone app wrap a NavigationStack). Show it
 * conditionally — `if (showEditor) Sheet(onDismiss = { showEditor = false }) { Editor() }` —
 * and inside, `LocalDismiss.current()` closes it (Cancel/Done), as does system back.
 */
@Composable
fun Sheet(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // The dialog window is sized to the whole display but Android 15 fits its frame
        // between the system bars, so the bottom of every sheet fell off screen. Let the
        // window run under the bars (as the activity does) and pad for them here instead.
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            window?.let { w ->
                w.attributes = w.attributes.apply {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        fitInsetsTypes = 0
                        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    } else {
                        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    }
                }
                w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            }
        }
        Box(Modifier.fillMaxSize().background(JKColors.bg).systemBarsPadding().imePadding()) {
            val stack = rememberNavStack()
            CompositionLocalProvider(LocalDismiss provides onDismiss) {
                NavHost(stack) { content() }
            }
        }
    }
}
