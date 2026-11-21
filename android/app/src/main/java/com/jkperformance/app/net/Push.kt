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

/**
 * Which tab is showing. A tapped notification moves it (a message opens
 * Messages, a booking the calendar), so the tab bars bind to this.
 */
object TabRouter {
    enum class Client { home, plan, calendar, messages, account }
    enum class Coach { today, clients, schedule, messages, guides }

    var client: Client by mutableStateOf(Client.home)
    var coach: Coach by mutableStateOf(Coach.today)

    fun open(kind: String?) {
        when (kind) {
            "message" -> { client = Client.messages; coach = Coach.messages }
            "report" -> client = Client.home
            "booking" -> { client = Client.calendar; coach = Coach.schedule }
            "checkin" -> coach = Coach.today
            "form" -> { client = Client.home; coach = Coach.today }
        }
    }
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
    fun show(context: Context, title: String?, body: String?, kind: String?) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        val open = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(KIND_EXTRA, kind)
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
        )
    }
}
