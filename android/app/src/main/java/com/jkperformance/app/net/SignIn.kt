package com.jkperformance.app.net

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.serialization.Serializable
import java.security.SecureRandom
import android.util.Base64 as AndroidBase64

/**
 * How a person signs in on Android, in place of the iPhone's native Sign in
 * with Apple. The Welcome screen asks [config] which buttons to show, then:
 *
 * - Google: [google] runs Credential Manager and swaps the ID token for a
 *   session (`POST /api/auth/google`).
 * - Apple: [startApple] opens Apple's page in a Custom Tab through the
 *   server; the server sends the browser back to `jkperformance://auth`,
 *   which MainActivity passes to [finishApple]. The tab can be closed at any
 *   time without coming back, so this half is not a suspend call: the
 *   Welcome screen watches [busy] and [error] instead.
 * - The demo code: `AppSession.signInWithCode`, as on the iPhone.
 *
 * Success lands in AppSession (phase → signedIn), which swaps the screen.
 */
object SignIn {
    /** `GET /api/android/config`: which sign-in buttons this server supports. */
    @Serializable
    data class Config(
        val google: Boolean = false,
        val googleClientId: String? = null,
        val apple: Boolean = false,
    )

    suspend fun config(): Config = APIClient.get("/api/android/config")

    /** True while a returned Apple sign-in is being swapped for a session. */
    var busy: Boolean by mutableStateOf(false)
        private set

    /** Why the last Apple sign-in failed, for the Welcome screen; cleared when another starts. */
    var error: String? by mutableStateOf(null)

    // MARK: Google

    /**
     * Shows Google's account sheet and signs in with the chosen account.
     * Returns false if the person backs out (show nothing, like a cancelled
     * Apple sheet on the iPhone); throws with a readable message otherwise.
     * `context` must be an Activity: the sheet is shown over it.
     */
    suspend fun google(context: Context, clientId: String): Boolean {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
            .build()
        val credential = try {
            CredentialManager.create(context).getCredential(context, request).credential
        } catch (e: GetCredentialCancellationException) {
            return false
        } catch (e: NoCredentialException) {
            throw APIError.config("No Google account is set up on this phone. Add one in Settings, then try again.")
        } catch (e: GetCredentialException) {
            throw APIError.config("Google couldn't sign you in. Try again.")
        }
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw APIError.config("Google couldn't sign you in. Try again.")
        }
        AppSession.signInWithGoogle(GoogleIdTokenCredential.createFrom(credential.data).idToken)
        return true
    }

    // MARK: Apple on the web

    private const val PREFS = "jk.signin"
    private const val STATE_KEY = "appleState"

    /**
     * Opens Sign in with Apple in a Custom Tab. The random `state` is kept in
     * prefs, not memory, because Android may stop the app while the browser
     * is in front; [finishApple] only accepts a reply carrying it.
     */
    fun startApple(context: Context) {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val state = AndroidBase64.encodeToString(bytes, AndroidBase64.URL_SAFE or AndroidBase64.NO_PADDING or AndroidBase64.NO_WRAP)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(STATE_KEY, state).apply()
        error = null
        val url = Uri.parse("${APIClient.baseURL}/api/auth/apple/web").buildUpon()
            .appendQueryParameter("state", state).build()
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, url)
    }

    /** True for the `jkperformance://auth?…` link the server sends the browser back to. */
    fun isAppleReturn(uri: Uri?): Boolean = uri?.scheme == "jkperformance" && uri.host == "auth"

    /** The server sent the browser back: check `state`, then swap `code` for a session. */
    suspend fun finishApple(context: Context, uri: Uri) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val expected = prefs.getString(STATE_KEY, null)
        // A stale or forged link (no sign-in of ours in flight) is ignored.
        if (expected == null || uri.getQueryParameter("state") != expected) return
        prefs.edit().remove(STATE_KEY).apply()
        uri.getQueryParameter("error")?.let {
            error = it
            return
        }
        val code = uri.getQueryParameter("code") ?: run {
            error = "Apple could not sign you in"
            return
        }
        busy = true
        try {
            AppSession.signInWithAppleCode(code)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            busy = false
        }
    }
}
