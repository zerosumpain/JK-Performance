@file:Suppress("EnumEntryName")

package com.jkperformance.app.net

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.jkperformance.app.MainActivity
import com.jkperformance.app.R
import com.jkperformance.app.Reminders
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable

/** A screen pushed inside a client tab or the JK sheet. One type so a tapped notification can open the right one. */
sealed class ClientRoute {
    /** Your week, scrolled to this "YYYY-MM-DD" day (null: today). */
    data class yourWeek(val day: String? = null) : ClientRoute()
    /** A workout: detail, logger and the session-complete page. */
    data class session(val workoutId: String) : ClientRoute()
    data class letter(val reportId: String) : ClientRoute()
    data object guides : ClientRoute()
    data class guide(val guideId: String) : ClientRoute()
    data object challenges : ClientRoute()
    /** JK sheet › More: Progress. */
    data object progress : ClientRoute()
    /** JK sheet › More: past letters. */
    data object letters : ClientRoute()
    /** JK sheet › More: Nutrition (the Fuel view). */
    data object nutrition : ClientRoute()
    /** JK sheet › More: Account, optionally straight on to Membership. */
    data class account(val membership: Boolean = false) : ClientRoute()
}

/**
 * Which tab is showing, whether the JK sheet is open, and what is pushed. A
 * tapped notification moves it (a message opens the JK sheet, a letter opens
 * Review), so the tab bar, the sheet and the stacks bind to this.
 *
 * Android's stacks hold composable lambdas (design/Nav.kt), so a route asked
 * for from outside a stack is a [RouteRequest]: the stack's root drains it
 * into its own NavStack (App.kt, RouteDrain) and clears it.
 */
object TabRouter {
    /** The three client tabs (plan-act-review.md, Navigation): default Act. */
    enum class Client { plan, act, review }
    enum class Coach { today, clients, messages }

    /** Routes to push on a stack, after popping it to its root when [reset]. */
    data class RouteRequest(val routes: List<ClientRoute>, val reset: Boolean, val serial: Long)

    data class ReplyQuote(val reportId: String, val headline: String)

    var client: Client by mutableStateOf(Client.act)
    var coach: Coach by mutableStateOf(Coach.today)
    /** Routes for the Act tab's stack. */
    var actRequest: RouteRequest? by mutableStateOf(null)
    /** Routes for the JK sheet's stack (More's screens, a letter). */
    var jkRequest: RouteRequest? by mutableStateOf(null)
    /** The JK sheet: JK's thread and the More list, over whichever tab is showing. */
    var showJK: Boolean by mutableStateOf(false)
    /** A letter Review was asked to show: Accountability session when it is the latest, else the letter. */
    var reviewLetter: String? by mutableStateOf(null)
    /** Opens the composer quoting a letter ("Reply to JK"). */
    var replyQuote: ReplyQuote? by mutableStateOf(null)
    /** Text to start the JK composer with ("Ask JK for a rest day"). */
    var composerDraft: String? by mutableStateOf(null)
    /** Unread from JK (GET /api/week `unread`): the silver dot on his avatar. */
    var unread: Int by mutableStateOf(0)

    private var serial = 0L

    /** Show Act with these routes pushed (replacing what was pushed when [reset]). */
    fun pushAct(vararg routes: ClientRoute, reset: Boolean = false) {
        showJK = false
        client = Client.act
        actRequest = RouteRequest(routes.toList(), reset, ++serial)
    }

    /** Open the JK sheet with these routes pushed on its stack (from its root when [reset]). */
    fun openJK(vararg routes: ClientRoute, reset: Boolean = true) {
        showJK = true
        unread = 0
        jkRequest = RouteRequest(routes.toList(), reset, ++serial)
    }

    /** Account › Membership, from wherever the client is ("See what coaching includes"). */
    fun openMembership() = openJK(ClientRoute.account(membership = true))

    fun select(tab: Client) {
        showJK = false
        client = tab
    }

    /**
     * Deep links (plan-act-review.md, Navigation): today, home and the old
     * plan tab → Act; messages and jk → the JK sheet; account → JK sheet ›
     * Account; checkin and review → Review; letter → Review (the
     * Accountability session if it is the latest letter).
     */
    fun openLink(name: String, id: String? = null) {
        when (name) {
            "today", "home", "plan", "act" -> select(Client.act)
            "direction" -> select(Client.plan)
            "calendar", "booking" -> openJK(ClientRoute.yourWeek(null))
            "messages", "message", "jk", "form" -> openJK()
            "account" -> openJK(ClientRoute.account())
            "checkin", "review" -> select(Client.review)
            "letter", "report" -> {
                select(Client.review)
                reviewLetter = id
            }
        }
    }

    fun open(kind: String?, id: String? = null) {
        when (kind) {
            null -> Unit
            "message" -> {
                openJK()
                coach = Coach.messages
            }
            "booking" -> {
                openJK(ClientRoute.yourWeek(null))
                coach = Coach.today
            }
            "checkin", "form" -> {
                openLink(kind, id)
                coach = Coach.today
            }
            else -> openLink(kind, id)
        }
    }

    /** Your week, scrolled to a day, in the JK sheet. */
    fun openWeek(day: String?) = openJK(ClientRoute.yourWeek(day), reset = false)
}

/**
 * Push notifications from the server through Firebase Cloud Messaging: a
 * coach's reply, published feedback, a check-in, a booking made or
 * cancelled. They share the Notifications switch with the phone's own
 * reminders (`Reminders.enabled`): one switch, one ask.
 *
 * The phone's FCM token goes to the server after every launch (Firebase can
 * change it) and is taken off the server when notifications are switched off
 * or the person signs out.
 *
 * Firebase is optional: a build without google-services.json has no
 * FirebaseApp, and every Firebase call here is skipped, so push is simply off.
 */
object Push {
    /** The channel the server names (`android.notification.channel_id`). */
    const val CHANNEL_ID = "coach"

    /** The intent extra a tapped notification carries; FCM copies data keys into extras too. */
    const val KIND_EXTRA = "kind"
    /** The item a push is about (a letter's id), when the server sends one. */
    const val ID_EXTRA = "id"

    private const val TAG = "Push"
    private const val PREFS = "jk.push"
    private const val TOKEN_KEY = "jk.push.token"
    private const val ASKED_KEY = "jk.push.asked"

    private lateinit var context: Context
    private val scope = MainScope()
    private var launcher: ActivityResultLauncher<String>? = null
    private var pendingAsk: CompletableDeferred<Boolean>? = null

    var token: String?
        get() = prefs().getString(TOKEN_KEY, null)
        private set(value) = prefs().edit().putString(TOKEN_KEY, value).apply()

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** From Application.onCreate: the channel must exist before FCM shows a notification on it in the background. */
    fun init(context: Context) {
        this.context = context.applicationContext
        val channel = NotificationChannel(CHANNEL_ID, "From your coach", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "Messages, feedback, check-ins and bookings" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private val firebaseAvailable: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

    /**
     * Lets [requestAuthorization] show the system prompt: Android asks through
     * an Activity, so MainActivity registers here in onCreate.
     */
    fun attach(activity: ComponentActivity) {
        val registered = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingAsk?.complete(granted)
            pendingAsk = null
        }
        launcher = registered
        activity.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onDestroy(owner: LifecycleOwner) {
                if (launcher === registered) launcher = null
            }
        })
    }

    /** Whether the phone lets this app show notifications (iOS: authorised). */
    val isAuthorized: Boolean get() = NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * True until the person has been asked (iOS: `.notDetermined`). Before
     * Android 13 there is no prompt: notifications are on unless switched
     * off in Settings, so there's nothing to decide.
     */
    val isUndecided: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !isAuthorized &&
            !prefs().getBoolean(ASKED_KEY, false)

    /**
     * Asks Android once for permission to notify (iOS's
     * `requestAuthorization`); returns whether notifications are now allowed.
     * Once refused, Android stops showing the prompt and this returns false.
     */
    suspend fun requestAuthorization(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPostPermission()) return isAuthorized
        val ask = launcher ?: return false
        val answer = CompletableDeferred<Boolean>()
        pendingAsk?.complete(false)
        pendingAsk = answer
        prefs().edit().putBoolean(ASKED_KEY, true).apply()
        ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        return answer.await() && isAuthorized
    }

    private fun hasPostPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Ask Firebase for this phone's token, if the person has notifications on, and send it to the server. */
    suspend fun registerIfAllowed() {
        if (!Reminders.enabled || !isAuthorized || !firebaseAvailable) return
        val fresh = try {
            FirebaseMessaging.getInstance().token.await()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            Log.w(TAG, "Push registration failed: ${e.message}")
            return
        }
        didRegister(fresh)
    }

    fun didRegister(value: String) {
        token = value
        scope.launch { upload() }
    }

    @Serializable
    private data class TokenBody(val token: String, val platform: String)

    private suspend fun upload() {
        val token = token ?: return
        if (APIClient.token == null || !Reminders.enabled) return
        runCatching { APIClient.send<OK, TokenBody>("PUT", "/api/push/token", TokenBody(token, "android")) }
    }

    /** Notifications switched off: the server stops sending to this phone. */
    suspend fun turnOff() {
        val token = token ?: return
        if (APIClient.token == null) return
        runCatching { APIClient.send<OK>("DELETE", "/api/push/token", query = mapOf("token" to token)) }
    }

    /**
     * Shows a push that arrived while the app was open (iOS shows those as a
     * banner too; Messages refreshes itself). In the background, Firebase
     * shows the server's notification itself on the same channel.
     */
    fun show(context: Context, title: String?, body: String?, kind: String?, id: String? = null) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(KIND_EXTRA, kind)
            .putExtra(ID_EXTRA, id)
        val tap = PendingIntent.getActivity(
            context, kind.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        try {
            // Tagged by kind, as the server tags background ones: a newer message replaces the last.
            NotificationManagerCompat.from(context).notify(kind, 0, notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "Notification permission withdrawn: ${e.message}")
        }
    }
}

/** Receives FCM tokens and pushes. Registered in the manifest; only runs when Firebase is configured. */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Push.didRegister(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Push.show(
            this,
            title = message.notification?.title ?: message.data["title"],
            body = message.notification?.body ?: message.data["body"],
            kind = message.data[Push.KIND_EXTRA],
            id = message.data[Push.ID_EXTRA],
        )
    }
}
