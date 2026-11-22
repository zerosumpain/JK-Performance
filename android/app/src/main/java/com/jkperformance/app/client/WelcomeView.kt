package com.jkperformance.app

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.SignIn
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * First launch. Sign-up is open: signing in creates a client account;
 * coaches are designated server-side. "I have a code" is the App Review demo
 * login (POST /api/auth/code).
 *
 * Android has no native Sign in with Apple, so the iPhone's single Apple
 * button becomes the buttons the server says it supports ([SignIn.config]):
 * Google through Credential Manager, and Apple on the web in a Custom Tab.
 * The Apple result comes back through MainActivity into [SignIn], so its
 * progress and failure are read from [SignIn.busy] and [SignIn.error].
 */
@Composable
fun WelcomeView() {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    /** What this screen has in flight itself: "google" or "code" (Apple's half lives in SignIn). */
    var pending by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showCode by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var config by remember { mutableStateOf<SignIn.Config?>(null) }
    var configError by remember { mutableStateOf<String?>(null) }
    var configAttempt by remember { mutableIntStateOf(0) }
    val reduceMotion = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    val shown = remember { Animatable(0f) }

    val busy = pending != null || SignIn.busy
    val message = error ?: SignIn.error

    LaunchedEffect(configAttempt) {
        configError = null
        try {
            config = SignIn.config()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            configError = e.readable
        }
    }
    LaunchedEffect(Unit) {
        // The controls follow the brand animation in, as on the iPhone.
        if (!reduceMotion) delay((BrandIntro.duration * 1000).toLong())
        shown.animateTo(1f, tween(450, easing = CubicBezierEasing(0f, 0f, 0.58f, 1f)))
    }

    fun startAttempt(kind: String) {
        pending = kind
        error = null
        SignIn.error = null
    }

    fun signInWithGoogle(clientId: String) {
        startAttempt("google")
        scope.launch {
            try {
                // false = the person backed out of Google's sheet: show nothing.
                SignIn.google(context, clientId)
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                pending = null
            }
        }
    }

    fun signInWithCode() {
        val value = code.trim()
        code = ""
        if (value.isEmpty()) return
        startAttempt("code")
        scope.launch {
            try {
                AppSession.signInWithCode(value)
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = if ((e as? APIError)?.status == 404) "That code isn't valid." else e.readable
            } finally {
                pending = null
            }
        }
    }

    Box(Modifier.fillMaxSize().background(JKColors.bg)) {
        BrandIntro()
        Column(Modifier.fillMaxSize().systemBarsPadding()) {
            Spacer(Modifier.weight(1f))
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 24.dp)
                    .graphicsLayer {
                        alpha = shown.value
                        translationY = (1f - shown.value) * 16.dp.toPx()
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (message != null) {
                    Text(message, style = JKType.caption, color = JKColors.textSecondary, textAlign = TextAlign.Center)
                }
                val c = config
                when {
                    c != null -> {
                        val googleId = c.googleClientId
                        if (c.google && googleId != null) {
                            SignInButton(
                                text = "Continue with Google",
                                filled = false,
                                enabled = !busy,
                                // The code sign-in shows its spinner on the top button, as the iPhone's does on its only one.
                                spinning = pending == "google" || pending == "code",
                                onClick = { signInWithGoogle(googleId) },
                            ) { Text("G", style = JKType.headline, color = JKColors.text) }
                        }
                        if (c.apple) {
                            SignInButton(
                                text = "Continue with Apple",
                                filled = true,
                                enabled = !busy,
                                spinning = SignIn.busy || (pending == "code" && !(c.google && googleId != null)),
                                onClick = {
                                    error = null
                                    SignIn.startApple(context)
                                },
                            ) {
                                Icon(AppleMark, contentDescription = null, tint = JKColors.primaryLabel, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                    configError != null -> TextButton("Try again", onClick = { configAttempt += 1 })
                    else -> Box(Modifier.fillMaxWidth().height(48.dp), contentAlignment = Alignment.Center) {
                        ProgressView(tint = JKColors.textSecondary)
                    }
                }
                if (configError != null && message == null) {
                    Text(configError!!, style = JKType.caption, color = JKColors.textSecondary, textAlign = TextAlign.Center)
                }

                Text(
                    "I have a code",
                    style = JKType.caption.semibold(),
                    color = JKColors.textSecondary,
                    modifier = Modifier.padding(top = 4.dp).clickable(enabled = !busy) { showCode = true },
                )

                Text(
                    "New here? Signing in creates your client account. By continuing you agree to the Terms and Privacy Policy.",
                    style = JKType.caption,
                    color = JKColors.textTertiary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    "Privacy Policy",
                    style = JKType.caption,
                    color = JKColors.textSecondary,
                    modifier = Modifier.clickable { uriHandler.openUri(APIClient.privacyURL) },
                )
            }
        }
    }

    if (showCode) {
        CodeAlert(
            code = code,
            onCodeChange = { code = it },
            onCancel = {
                code = ""
                showCode = false
            },
            onSignIn = {
                showCode = false
                signInWithCode()
            },
        )
    }
}

/**
 * The sign-in buttons, shaped like the iPhone's Sign in with Apple button:
 * 48 tall, 12 corner. Apple's is the white one, as the iPhone shows it;
 * Google's is outlined so the two read as a pair.
 */
@Composable
private fun SignInButton(
    text: String,
    filled: Boolean,
    enabled: Boolean,
    spinning: Boolean,
    onClick: () -> Unit,
    mark: @Composable () -> Unit,
) {
    val shape = JKShape.card
    val ink = if (filled) JKColors.primaryLabel else JKColors.text
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(shape)
            .then(if (filled) Modifier.background(JKColors.primaryFill, shape) else Modifier.border(1.dp, JKColors.text, shape))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.alpha(if (enabled || spinning) 1f else 0.6f),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            mark()
            Text(text, style = JKType.body.medium(), color = ink)
        }
        if (spinning) ProgressView(tint = ink)
    }
}

/** The iPhone's "Sign in with a code" alert: one field, Cancel and Sign in. */
@Composable
private fun CodeAlert(code: String, onCodeChange: (String) -> Unit, onCancel: () -> Unit, onSignIn: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        containerColor = JKColors.raised,
        shape = JKShape.card,
        title = { Text("Sign in with a code", style = JKType.headline, color = JKColors.text) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("For demo and review accounts.", style = JKType.caption, color = JKColors.textSecondary)
                val style = JKType.callout.copy(color = JKColors.text)
                BasicTextField(
                    value = code,
                    onValueChange = onCodeChange,
                    singleLine = true,
                    textStyle = style,
                    cursorBrush = SolidColor(JKColors.text),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { field ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .background(JKColors.surface, JKShape.chip)
                                .border(0.5.dp, JKColors.hairline, JKShape.chip)
                                .padding(horizontal = 8.dp, vertical = 7.dp),
                        ) {
                            if (code.isEmpty()) Text("Code", style = style, color = JKColors.textTertiary)
                            field()
                        }
                    },
                )
            }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", style = JKType.body, color = JKColors.text) } },
        confirmButton = { TextButton(onClick = onSignIn) { Text("Sign in", style = JKType.body.semibold(), color = JKColors.text) } },
    )
}

/**
 * Apple's logo, drawn from a path: Android's fonts have no glyph for it.
 * Path: Simple Icons "apple" (CC0), on a 24-unit grid.
 */
private val AppleMark: ImageVector by lazy {
    ImageVector.Builder("apple", 24.dp, 24.dp, 24f, 24f)
        .addPath(
            addPathNodes(
                "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 " +
                    "1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 " +
                    "3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-" +
                    "3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 " +
                    "1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 " +
                    "2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
            ),
            fill = SolidColor(JKColors.primaryLabel),
        )
        .build()
}
