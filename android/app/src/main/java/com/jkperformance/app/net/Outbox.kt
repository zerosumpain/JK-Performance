package com.jkperformance.app.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.serializer
import java.io.File
import java.io.IOException
import java.time.Instant

/**
 * Writes that couldn't reach the server, kept on disk until they can.
 * Gyms are often basements: a set logged with no signal must never be lost.
 *
 * Only idempotent writes go in (a set's PUT/DELETE, completing a workout),
 * so a newer write to the same method and path replaces the older one and
 * re-sending is harmless. Sent in order on foreground, when the network
 * comes back, and after any request that succeeds. Kept per person: a
 * different account signing in on this phone drops them.
 *
 * State is Compose state and only changed on the main thread (Swift's
 * @MainActor); call [init] from Application.onCreate.
 */
object Outbox {
    @Serializable
    data class Write(
        val method: String,
        val path: String,
        /** The JSON body as sent, or null for a bodiless write. */
        val body: String? = null,
        @Serializable(with = InstantSerializer::class) val createdAt: Instant,
    )

    @Serializable
    private data class Stored(
        val userId: String? = null,
        val writes: List<Write> = emptyList(),
    )

    var writes: List<Write> by mutableStateOf(emptyList())
        private set

    /** Set when the server refused a queued write (a 4xx), so it was dropped. */
    var lastError: String? by mutableStateOf(null)

    var flushing: Boolean by mutableStateOf(false)
        private set

    private var userId: String? = null
    private lateinit var file: File
    private val scope = MainScope()

    fun init(context: Context) {
        file = File(context.filesDir, "outbox.json")
        runCatching { ApiJson.decodeFromString(Stored.serializer(), file.readText()) }.getOrNull()?.let {
            userId = it.userId
            writes = it.writes
        }
        // The network coming back is the moment to send.
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                scope.launch { flush() }
            }
        })
    }

    val pendingCount: Int get() = writes.size
    val pendingSets: Int get() = writes.count { it.path.contains("/sets/") }

    fun isPending(method: String, path: String): Boolean = writes.any { it.method == method && it.path == path }

    fun hasPending(workoutId: String): Boolean = writes.any { it.path.startsWith("/api/workouts/${seg(workoutId)}/") }

    /**
     * True for the failures worth queueing: no signal, a dropped or slow
     * connection, the server unreachable (every OkHttp I/O failure except a
     * cancel). Not for anything the server said: those are [APIError]s.
     */
    fun isOffline(error: Throwable): Boolean = error is IOException && !error.isCancellation

    inline fun <reified Body> enqueue(method: String, path: String, body: Body?) {
        enqueueEncoded(method, path, body?.let { ApiJson.encodeToString(serializer<Body>(), it) })
    }

    fun enqueue(method: String, path: String) = enqueueEncoded(method, path, null)

    @PublishedApi
    internal fun enqueueEncoded(method: String, path: String, body: String?) {
        // Move a replaced write to the end, so PUT, DELETE, PUT on one set ends logged.
        writes = writes.filterNot { it.method == method && it.path == path } +
            Write(method, path, body, Instant.now())
        save()
    }

    /** Called after any request succeeds: the network is evidently back. */
    fun kick() {
        scope.launch {
            if (writes.isNotEmpty() && !flushing) flush()
        }
    }

    /**
     * Send everything queued, oldest first. Stops at the first network or
     * server-side failure and keeps the rest; drops a write the server
     * refuses outright, since retrying it can never succeed.
     */
    suspend fun flush() = withContext(Dispatchers.Main.immediate) {
        if (flushing || writes.isEmpty() || APIClient.token == null) return@withContext
        flushing = true
        try {
            while (true) {
                val next = writes.firstOrNull() ?: break
                try {
                    APIClient.replay(next.method, next.path, next.body)
                    writes = writes.filterNot { it == next }
                    save()
                } catch (e: APIError.server) {
                    if (e.code >= 500 || e.code == 408 || e.code == 429) break
                    writes = writes.filterNot { it == next }
                    lastError = "A change made offline couldn't be saved: ${e.message}"
                    save()
                } catch (e: Exception) {
                    if (e.isCancellation) throw e
                    break // offline, rate-limited or signed out: try again later
                }
            }
        } finally {
            flushing = false
        }
    }

    /** A person is signed in. Writes left by someone else on this phone go. */
    fun adopt(userId: String) {
        if (this.userId != userId) {
            if (this.userId != null) writes = emptyList()
            this.userId = userId
            save()
        }
    }

    /** Written whole to a temp file and renamed over the old one, so a crash never leaves half a queue. */
    private fun save() {
        val text = ApiJson.encodeToString(Stored.serializer(), Stored(userId, writes))
        runCatching {
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(file)) file.writeText(text)
        }
    }
}
