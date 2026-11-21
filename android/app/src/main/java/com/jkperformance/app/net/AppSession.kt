@file:Suppress("EnumEntryName")

package com.jkperformance.app.net

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.jkperformance.app.HealthSync
import com.jkperformance.app.Reminders
import kotlinx.serialization.Serializable

/**
 * Who is signed in. RootView switches on [phase]; the role comes from the
 * server (`me.role`), never from the app.
 *
 * A singleton (Swift keeps one instance in the app's environment); its
 * properties are Compose state, so screens that read them recompose. Touch it
 * only after APIClient.init (Application.onCreate), since the first phase
 * depends on whether a token was saved. Call from the main thread.
 */
object AppSession {
    enum class Phase {
        /** A token exists and /api/me is in flight (or failed without a 401). */
        restoring,
        signedOut,
        signedIn,
    }

    var phase: Phase by mutableStateOf(if (APIClient.token == null) Phase.signedOut else Phase.restoring)
        private set
    var me: Me? by mutableStateOf(null)
        private set

    /** Set when restoring fails for a reason other than a 401 (offline). */
    var restoreError: String? by mutableStateOf(null)

    val api = APIClient

    init {
        api.onUnauthorized = { clear() }
    }

    val isCoach: Boolean get() = me?.isCoach == true

    /** On launch: confirm the saved token by reading /api/me. */
    suspend fun restore() {
        if (api.token == null) {
            phase = Phase.signedOut
            return
        }
        restoreError = null
        try {
            val fresh: Me = api.get("/api/me")
            me = fresh
            Outbox.adopt(fresh.id)
            phase = Phase.signedIn
        } catch (e: APIError.unauthorized) {
            clear()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            restoreError = e.readable
        }
    }

    suspend fun refreshMe() {
        if (phase != Phase.signedIn) return
        runCatching { api.get<Me>("/api/me") }.getOrNull()?.let { me = it }
    }

    fun update(fresh: Me) {
        me = fresh
    }

    /** The demo-account code from the Welcome screen. */
    suspend fun signInWithCode(code: String) {
        val session: Session = api.send("POST", "/api/auth/code", body = mapOf("code" to code))
        adopt(session)
    }

    @Serializable
    private data class GoogleBody(val idToken: String)

    /** Android's stand-in for the iPhone's native Sign in with Apple: a Google ID token from Credential Manager. */
    suspend fun signInWithGoogle(idToken: String) {
        val session: Session = api.send("POST", "/api/auth/google", GoogleBody(idToken))
        adopt(session)
    }

    /** Sign in with Apple on the web: swap the one-time code the server handed back through jkperformance://auth. */
    suspend fun signInWithAppleCode(code: String) {
        val session: Session = api.send("POST", "/api/auth/apple/finish", body = mapOf("code" to code))
        adopt(session)
    }

    private fun adopt(session: Session) {
        api.setToken(session.token)
        Outbox.adopt(session.me.id)
        me = session.me
        restoreError = null
        phase = Phase.signedIn
        // Never sync this phone's health data into a shared demo account.
        if (!session.me.isCoach && !session.me.demo) HealthSync.syncIfDue(force = true)
    }

    // MARK: Coach previewing the client side

    /** The coach's own session, kept while they look round as the demo client. */
    private const val COACH_SLOT = "coachToken"

    /** True while a coach is in the demo client with their own session kept aside. */
    val canReturnToCoach: Boolean get() = me?.demo == true && Keychain.read(COACH_SLOT) != null

    /** Coach → the demo client "Sam Carter", keeping the coach session to come back to. */
    suspend fun switchToDemoClient() {
        val coachToken = api.token ?: return
        if (!isCoach) return
        val session: Session = api.send("POST", "/api/auth/demo-client")
        Keychain.save(coachToken, COACH_SLOT)
        adopt(session)
    }

    /** Demo client → back to the coach session kept aside, without signing in again. */
    suspend fun returnToCoach() {
        val coachToken = Keychain.read(COACH_SLOT) ?: return
        runCatching { api.send<OK>("POST", "/api/auth/logout") }
        Keychain.save(null, COACH_SLOT)
        api.setToken(coachToken)
        me = null
        phase = Phase.restoring
        restore()
    }

    suspend fun signOut() {
        // Last chance to send sets logged offline. Anything still queued stays
        // on the phone for this person and goes when they sign back in.
        Outbox.flush()
        // The phone's push token leaves with the session.
        runCatching { api.send<OK, Map<String, String?>>("POST", "/api/auth/logout", mapOf("pushToken" to Push.token)) }
        clear()
    }

    /** DELETE /api/me erases the account; then the app is signed out. */
    suspend fun deleteAccount() {
        api.send<OK>("DELETE", "/api/me")
        clear()
    }

    fun clear() {
        Reminders.clearPending()
        api.setToken(null)
        Keychain.save(null, COACH_SLOT)
        me = null
        restoreError = null
        phase = Phase.signedOut
    }
}
