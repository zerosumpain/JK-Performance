package com.jkperformance.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.Media
import com.jkperformance.app.net.Message
import com.jkperformance.app.net.MessageInput
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Uploads from the client core (check-in photos, form-check videos) to
 * POST /api/media (docs/API.md, "Media"). iOS's MediaUpload.
 */
object ClientUpload {
    /** Longest form check JK will watch (and the server accepts). */
    const val MAX_SECONDS = 90.0
    private const val MAX_VIDEO_BYTES = 60L * 1024 * 1024

    /** A photo as JPEG, at most 2048 px on the long side and under the 10 MB image limit. */
    suspend fun image(context: Context, uri: Uri, purpose: String, clientId: String? = null): Media {
        val jpeg = withContext(Dispatchers.Default) { jpegForUpload(context, uri) }
            ?: throw APIError.transport("Couldn't read that photo.")
        return APIClient.upload("/api/media", jpeg, "image/jpeg", mapOf("purpose" to purpose, "clientId" to clientId))
    }

    /** A video as picked: MP4, at most 90 seconds and 60 MB. */
    suspend fun video(context: Context, uri: Uri, purpose: String): Media {
        val (bytes, seconds) = withContext(Dispatchers.IO) {
            val retriever = MediaMetadataRetriever()
            val ms = try {
                retriever.setDataSource(context, uri)
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            } catch (_: Exception) {
                0L
            } finally {
                runCatching { retriever.release() }
            }
            val seconds = ms / 1000.0
            if (seconds > MAX_SECONDS + 1) throw APIError.transport("Keep it under 90 seconds.")
            val size = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
            if (size > MAX_VIDEO_BYTES) throw APIError.transport("That clip is too large. Film a shorter one, under 90 seconds.")
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw APIError.transport("Couldn't read that video.")
            bytes to seconds
        }
        return APIClient.upload(
            "/api/media", bytes, "video/mp4",
            mapOf("purpose" to purpose, "durationSec" to if (seconds > 0) seconds.roundToInt().toString() else null),
        )
    }

    /** JPEG at most 2048 px on the long side, under 8 MB. ImageDecoder applies the photo's EXIF rotation. */
    fun jpegForUpload(context: Context, uri: Uri): ByteArray? = try {
        val source = ImageDecoder.createSource(context.contentResolver, uri)
        val bitmap = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val longest = max(info.size.width, info.size.height)
            if (longest > 2048) {
                val scale = 2048f / longest
                decoder.setTargetSize((info.size.width * scale).roundToInt(), (info.size.height * scale).roundToInt())
            }
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        fun jpeg(quality: Int) = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
        var quality = 80
        var data = jpeg(quality)
        while (data.size > 8_000_000 && quality > 30) {
            quality -= 15
            data = jpeg(quality)
        }
        data
    } catch (_: Exception) {
        null
    }
}

/**
 * "Send form check": pick a clip of the set and send it to JK, tied to the
 * exercise. Shown only when JK has form checks on. The system picker needs no
 * permission; film with the camera app first and pick the clip from there.
 */
@Composable
fun FormCheckButton(exerciseId: String, exerciseName: String, workoutId: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sent by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            sending = true
            try {
                val media = ClientUpload.video(context, uri, purpose = "formCheck")
                APIClient.send<Message, MessageInput>(
                    "POST", "/api/messages",
                    MessageInput(
                        text = "Form check: $exerciseName", workoutId = workoutId,
                        exerciseId = exerciseId, mediaId = media.id, kind = "formCheck",
                    ),
                )
                sent = true
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                sending = false
            }
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(
            onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) },
            enabled = !sending,
        ) {
            if (sending) ProgressView(tint = JKColors.text)
            else IconLabel("Send form check", icon = IconKey.formCheck, style = JKType.callout, color = JKColors.text)
        }
        if (sent) Text("Sent to JK", style = JKType.caption, color = JKColors.textSecondary)
    }
    ErrorAlert(error) { error = null }
}
