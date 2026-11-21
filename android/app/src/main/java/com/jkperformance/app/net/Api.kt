@file:Suppress("ClassName")

package com.jkperformance.app.net

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.jkperformance.app.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.MissingFieldException
import kotlinx.serialization.Serializable
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * A failure worth showing to a person: the server's own `{"error": …}`
 * sentence when there is one. `message` is the sentence to put on screen.
 */
sealed class APIError(message: String) : Exception(message) {
    class server(val code: Int, message: String) : APIError(message)
    class unauthorized : APIError("Your session has ended. Sign in again.")
    class transport(message: String) : APIError(message)
    class decoding(message: String) : APIError(message)
    class config(message: String) : APIError(message)

    /** The HTTP status, where there is one (Swift's `status`). */
    val status: Int?
        get() = when (this) {
            is server -> code
            is unauthorized -> 401
            else -> null
        }
}

/** The sentence to put on screen. */
val Throwable.readable: String
    get() = when (this) {
        is APIError -> message ?: "Something went wrong."
        is UnknownHostException, is NoRouteToHostException -> "You're offline. Check your connection and try again."
        is SocketTimeoutException -> "The server took too long to answer. Try again."
        is IOException -> "Couldn't reach JK Performance."
        else -> localizedMessage ?: "Something went wrong."
    }

/** True when the work was cancelled (a screen left, a newer load started): show nothing. */
val Throwable.isCancellation: Boolean
    get() = this is CancellationException || (this is IOException && message == "Canceled")

/**
 * The bearer token lives in EncryptedSharedPreferences (the Keychain's
 * counterpart: AES keys held by the Android Keystore), never in plain prefs.
 * `account` mirrors the Keychain account: "token", or the coach's kept-aside
 * session while they preview the demo client.
 */
object Keychain {
    private const val FILE = "com.jkperformance.app.session"
    private const val TOKEN_ACCOUNT = "token"
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = try {
            open(context)
        } catch (e: Exception) {
            // A Keystore key lost with a restore or OS update leaves the file
            // unreadable for good; starting fresh only means signing in again.
            context.deleteSharedPreferences(FILE)
            open(context)
        }
    }

    private fun open(context: Context): SharedPreferences = EncryptedSharedPreferences.create(
        context, FILE,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun read(account: String = TOKEN_ACCOUNT): String? = prefs.getString(account, null)

    fun save(token: String?, account: String = TOKEN_ACCOUNT) {
        prefs.edit().apply { if (token == null) remove(account) else putString(account, token) }.commit()
    }
}

/**
 * Coroutine client for docs/API.md, one for the app's life. Base URL from
 * `BuildConfig.API_BASE` (Swift: Info.plist `JKAPIBaseURL`). Call
 * [init] from Application.onCreate before anything else touches it.
 *
 * Typed calls read like the Swift ones: the reply type comes from the
 * declared type (`val me: Me = APIClient.get("/api/me")`), or explicitly
 * (`APIClient.get<Me>("/api/me")`). Pass a JSON body by name when it is a
 * map (`send("POST", path, body = mapOf("code" to code))`), so it isn't
 * taken for `query`.
 */
object APIClient {
    val baseURL: String = BuildConfig.API_BASE.trimEnd('/')
    private val base: HttpUrl = baseURL.toHttpUrl()

    @Volatile
    var token: String? = null
        private set

    /** Called once when an authenticated request comes back 401. Runs on the main thread. */
    var onUnauthorized: (() -> Unit)? = null

    /** No cache and no cookie jar (OkHttp's defaults): the bearer token is the only credential. */
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    fun init(context: Context) {
        Keychain.init(context)
        token = Keychain.read()
    }

    val privacyURL: String get() = "$baseURL/privacy"

    fun setToken(value: String?) {
        token = value
        Keychain.save(value)
    }

    // MARK: Requests

    /** GET and decode. */
    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T =
        decode(serializer<T>(), raw("GET", path, query), path)

    /** A request with a JSON body. */
    suspend inline fun <reified T, reified Body> send(
        method: String, path: String, body: Body, query: Map<String, String?> = emptyMap(),
    ): T {
        val encoded = ApiJson.encodeToString(serializer<Body>(), body).toByteArray()
        return decode(serializer<T>(), raw(method, path, query, encoded, JSON_TYPE), path)
    }

    /** A request with no body (DELETE, publish, join…). */
    suspend inline fun <reified T> send(method: String, path: String, query: Map<String, String?> = emptyMap()): T =
        decode(serializer<T>(), raw(method, path, query), path)

    /** Raw bytes in (`image/jpeg` upload) and JSON out. */
    suspend inline fun <reified T> upload(
        path: String, data: ByteArray, contentType: String, query: Map<String, String?> = emptyMap(),
    ): T = decode(serializer<T>(), raw("POST", path, query, data, contentType, timeoutSeconds = 120), path)

    /** Raw bytes out (photos, export). Sends the bearer token, unlike a plain image loader. */
    suspend fun data(path: String, query: Map<String, String?> = emptyMap()): ByteArray =
        raw("GET", path, query, timeoutSeconds = 60)

    /** Re-send a write the Outbox kept while offline. The reply isn't needed: the screen re-reads the workout. */
    suspend fun replay(method: String, path: String, body: String?) {
        raw(method, path, body = body?.toByteArray(), contentType = body?.let { JSON_TYPE }, fromOutbox = true)
    }

    @PublishedApi internal const val JSON_TYPE = "application/json"

    @PublishedApi
    internal fun <T> decode(serializer: KSerializer<T>, data: ByteArray, path: String): T = try {
        ApiJson.decodeFromString(serializer, data.decodeToString())
    } catch (e: IllegalArgumentException) {
        throw APIError.decoding("Unexpected reply from $path: ${describe(e)}")
    }

    @PublishedApi
    internal suspend fun raw(
        method: String, path: String, query: Map<String, String?> = emptyMap(), body: ByteArray? = null,
        contentType: String? = null, timeoutSeconds: Long = 30, fromOutbox: Boolean = false,
    ): ByteArray {
        val url = try {
            base.newBuilder().encodedPath(path).apply {
                query.entries.filter { it.value != null }.sortedBy { it.key }
                    .forEach { addQueryParameter(it.key, it.value) }
            }.build()
        } catch (e: IllegalArgumentException) {
            throw APIError.config("Bad request path $path.")
        }
        val sentToken = token
        val request = Request.Builder().url(url)
            .method(method, body?.toRequestBody(contentType?.toMediaType()) ?: emptyBodyFor(method))
            .header("Accept", JSON_TYPE)
            .apply { if (sentToken != null) header("Authorization", "Bearer $sentToken") }
            .build()
        val client = if (timeoutSeconds == 30L) http else http.newBuilder()
            .readTimeout(timeoutSeconds, TimeUnit.SECONDS).writeTimeout(timeoutSeconds, TimeUnit.SECONDS).build()

        val (status, data) = client.newCall(request).await()
        if (status in 200..299) {
            // A reply means the network is back: send anything kept offline.
            if (!fromOutbox) Outbox.kick()
            return data
        }

        val message = runCatching { ApiJson.decodeFromString(ErrorBody.serializer(), data.decodeToString()).error }.getOrNull()
        if (status == 401 && sentToken != null && !path.startsWith("/api/auth/")) {
            // Only the token we sent: a newer sign-in may have replaced it meanwhile.
            withContext(Dispatchers.Main.immediate) {
                if (token == sentToken) {
                    setToken(null)
                    onUnauthorized?.invoke()
                }
            }
            throw APIError.unauthorized()
        }
        throw APIError.server(status, humanize(message, status))
    }

    /** OkHttp insists on a body for POST/PUT/PATCH; Swift sends an empty one. */
    private fun emptyBodyFor(method: String) =
        if (method in setOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody(null) else null

    /** Runs the call on OkHttp's threads; cancelling the coroutine cancels the request. */
    private suspend fun Call.await(): Pair<Int, ByteArray> = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val bytes = response.use { it.body?.bytes() ?: ByteArray(0) }
                    cont.resume(response.code to bytes)
                } catch (e: IOException) {
                    cont.resumeWithException(e)
                }
            }
        })
    }

    @Serializable
    private data class ErrorBody(val error: String)

    private fun humanize(message: String?, status: Int): String = when {
        message == "membership_required" -> "This needs an active membership. Choose a plan under Account."
        !message.isNullOrEmpty() -> message
        status == 403 -> "You don't have access to that."
        status == 404 -> "Not found."
        status >= 500 -> "The server had a problem ($status). Try again shortly."
        else -> "Request failed ($status)."
    }

    /** "missing a.b" / "bad value at a.b", like Swift's DecodingError description. */
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    private fun describe(error: IllegalArgumentException): String {
        val at = Regex("""at path: \$\.?(\S*)""").find(error.message ?: "")?.groupValues?.get(1)
        return when {
            error is MissingFieldException ->
                "missing " + error.missingFields.joinToString { listOfNotNull(at?.takeIf(String::isNotEmpty), it).joinToString(".") }
            at != null -> "bad value at $at"
            else -> "could not read it"
        }
    }
}

/** Percent-encodes one path segment (an opaque id). */
fun seg(value: String): String {
    val allowed = "-._~!$&'()*+,;=:@"
    val out = StringBuilder()
    for (byte in value.toByteArray()) {
        val c = byte.toInt().toChar()
        if (byte >= 0 && (c.isLetterOrDigit() || c in allowed)) out.append(c)
        else out.append('%').append("%02X".format(byte.toInt() and 0xff))
    }
    return out.toString()
}
