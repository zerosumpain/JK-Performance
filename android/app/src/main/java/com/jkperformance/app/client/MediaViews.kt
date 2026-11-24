package com.jkperformance.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.Media
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.seg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// Media for letters, form checks, meal photos and check-in photos (docs/API.md,
// "Media"): POST /api/media takes the raw bytes; GET /api/media/:id needs the
// bearer token, so playback downloads to a cached file first and plays that
// (MediaPlayer, VideoView). Mirrors ios/JKPerformance/Client/MediaViews.swift.

object MediaUpload {
    /** Longest form check JK will watch (and the server accepts). */
    const val MAX_SECONDS = 90.0

    /** A picked image as a JPEG (at most 2048 px, under 8 MB). */
    suspend fun image(context: Context, uri: Uri, purpose: String, clientId: String? = null): Media {
        val jpeg = withContext(Dispatchers.IO) { jpegForUpload(context, uri) }
            ?: throw APIError.transport("Couldn't read that photo.")
        return APIClient.upload("/api/media", jpeg, "image/jpeg", mapOf("purpose" to purpose, "clientId" to clientId))
    }

    /** A picked video, sent as it is (the server takes video/mp4), at most 90 seconds. */
    suspend fun video(context: Context, uri: Uri, purpose: String): Media {
        val (bytes, seconds) = withContext(Dispatchers.IO) {
            val r = MediaMetadataRetriever()
            val seconds = try {
                r.setDataSource(context, uri)
                (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000.0
            } catch (_: RuntimeException) {
                0.0
            } finally {
                r.release()
            }
            val data = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            data to seconds
        }
        if (bytes == null) throw APIError.transport("Couldn't read that clip.")
        if (seconds > MAX_SECONDS + 1) throw APIError.transport("Keep it under 90 seconds.")
        return APIClient.upload("/api/media", bytes, "video/mp4", buildMap {
            put("purpose", purpose)
            if (seconds > 0) put("durationSec", seconds.roundToInt().toString())
        })
    }

    /**
     * JPEG at most 2048 px on the long side, under the 8 MB upload limit.
     * ImageDecoder applies the photo's EXIF rotation, as UIImage does.
     */
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
    } catch (_: IOException) {
        null
    }
}

/** Voice and video notes, downloaded once with the token into the cache directory. */
object MediaFiles {
    private val local = mutableMapOf<String, File>()

    /**
     * [path] is the server's own URL for the file when it is not the plain
     * media route (a voice note's `voice.url`, a guide block's `url`); only an
     * `/api/` path on our server is fetched. Audio is cached as `.m4a`.
     */
    suspend fun file(context: Context, mediaId: String, kind: String?, path: String? = null): File {
        local[mediaId]?.takeIf { it.exists() }?.let { return it }
        val route = path?.takeIf { it.startsWith("/api/") && !it.contains("..") } ?: "/api/media/${seg(mediaId)}"
        val data = APIClient.data(route)
        val ext = if (kind == "video") "mp4" else "m4a"
        val name = mediaId.replace(Regex("[^A-Za-z0-9_-]"), "_")
        val file = File(context.cacheDir, "media-$name.$ext")
        withContext(Dispatchers.IO) {
            val tmp = File(context.cacheDir, "media-$name.part")
            tmp.writeBytes(data)
            tmp.renameTo(file)
        }
        local[mediaId] = file
        return file
    }
}

/** 75 → "1:15". */
internal fun clockText(seconds: Double): String {
    val s = seconds.roundToInt()
    return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
}

/**
 * JK's voice or video note in a letter: his portrait as the poster, a play
 * button and the length. Video opens full screen.
 */
@Composable
fun MediaNote(mediaId: String, kind: String?, durationSec: Double? = null, coachAvatarMediaId: String? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var video by remember { mutableStateOf<File?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val isVideo = kind == "video"

    DisposableEffect(Unit) {
        onDispose { player?.release() }
    }

    suspend fun toggle() {
        val p = player
        if (p != null && !isVideo) {
            if (playing) p.pause() else p.start()
            playing = !playing
            return
        }
        loading = true
        try {
            val file = MediaFiles.file(context, mediaId, kind)
            if (isVideo) {
                video = file
            } else {
                val mp = MediaPlayer()
                mp.setDataSource(file.absolutePath)
                mp.setOnCompletionListener {
                    playing = false
                    it.seekTo(0)
                }
                withContext(Dispatchers.IO) { mp.prepare() }
                mp.start()
                player = mp
                playing = true
            }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = "Couldn't play it. Try again."
        } finally {
            loading = false
        }
    }

    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoachAvatar(coachAvatarMediaId, size = JKSize.avatar, contentDescription = null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(if (isVideo) "A video from JK" else "A voice note from JK", style = JKType.callout, color = JKColors.text)
            durationSec?.let { Text(clockText(it), style = JKType.caption, color = JKColors.textSecondary) }
            error?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
        }
        Box(
            Modifier
                .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                .clip(JKShape.pill)
                .clickable(enabled = !loading, role = Role.Button) { scope.launch { toggle() } }
                .semantics { contentDescription = if (playing) "Pause" else "Play" },
            contentAlignment = Alignment.Center,
        ) {
            if (loading) ProgressView(tint = JKColors.text)
            else Glyph(if (playing) IconKey.pause else IconKey.play, size = JKSize.iconTab, tint = JKColors.text)
        }
    }

    video?.let { file -> VideoSheet(file) { video = null } }
}

/** A downloaded clip, full screen, with the platform's play controls. */
@Composable
fun VideoSheet(file: File, onClose: () -> Unit) {
    Sheet(onDismiss = onClose) {
        Box(Modifier.fillMaxSize().background(JKColors.bg)) {
            AndroidView(
                factory = { ctx ->
                    VideoView(ctx).apply {
                        val controls = MediaController(ctx)
                        controls.setAnchorView(this)
                        setMediaController(controls)
                        setVideoPath(file.absolutePath)
                        setOnPreparedListener { start() }
                    }
                },
                onRelease = { it.stopPlayback() },
                modifier = Modifier.align(Alignment.Center).fillMaxWidth(),
            )
            TextButton("Close", onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(JKSpace.l))
        }
    }
}

/** Decoded thread photos by media id. */
private val messagePhotos = android.util.LruCache<String, ImageBitmap>(16)

/** A photo or video someone sent in the thread (form check, meal photo). */
@Composable
fun MessageMedia(mediaId: String, isVideo: Boolean, label: String = "Play the clip") {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var image by remember(mediaId) { mutableStateOf(messagePhotos.get(mediaId)) }
    var video by remember { mutableStateOf<File?>(null) }
    var loading by remember { mutableStateOf(false) }

    if (isVideo) {
        Row(
            Modifier
                .heightIn(min = JKSize.touchTarget)
                .clickable(enabled = !loading, role = Role.Button) {
                    scope.launch {
                        loading = true
                        try {
                            video = MediaFiles.file(context, mediaId, "video")
                        } catch (e: Exception) {
                            if (e.isCancellation) throw e
                        } finally {
                            loading = false
                        }
                    }
                },
            horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (loading) ProgressView(tint = JKColors.text) else Glyph(IconKey.play, size = JKSize.iconHabit, tint = JKColors.text)
            Text(label, style = JKType.callout, color = JKColors.text)
        }
    } else {
        LaunchedEffect(mediaId) {
            if (image != null) return@LaunchedEffect
            try {
                val data = APIClient.data("/api/media/${seg(mediaId)}")
                val decoded = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(data, 0, data.size)?.asImageBitmap() }
                if (decoded != null) {
                    messagePhotos.put(mediaId, decoded)
                    image = decoded
                }
            } catch (e: Exception) {
                if (e.isCancellation) throw e
            }
        }
        val loaded = image
        if (loaded != null) {
            Image(
                loaded,
                contentDescription = "Photo",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp).clip(JKShape.chip),
            )
        } else {
            ProgressView(tint = JKColors.textSecondary)
        }
    }
    video?.let { file -> VideoSheet(file) { video = null } }
}
