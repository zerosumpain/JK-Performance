package com.jkperformance.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.jkperformance.app.design.JKTheme
import androidx.lifecycle.lifecycleScope
import com.jkperformance.app.net.Push
import com.jkperformance.app.net.SignIn
import com.jkperformance.app.net.TabRouter
import kotlinx.coroutines.launch

/**
 * The one window. Dark-only with white accents, like the iPhone app's
 * `.preferredColorScheme(.dark)` and `.tint(.white)`.
 *
 * `singleTask`, so links back into the app arrive here: the Sign in with
 * Apple return (`jkperformance://auth?…`) and a tapped notification (the
 * `kind` extra, which moves the tab bar like the iPhone's push delegate).
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        Push.attach(this)
        // A recreated activity (rotation) carries the intent it was first opened with: handled already.
        if (savedInstanceState == null) handle(intent)
        setContent {
            JKTheme { RootView() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        val link = intent.data
        if (SignIn.isAppleReturn(link) && link != null) {
            lifecycleScope.launch { SignIn.finishApple(this@MainActivity, link) }
        }
        intent.getStringExtra(Push.KIND_EXTRA)?.let { TabRouter.open(it, intent.getStringExtra(Push.ID_EXTRA)) }
    }
}
