package com.jkperformance.app.design.components

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import com.jkperformance.app.design.JKColors
import com.jkperformance.app.design.JKSize
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Monogram
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.seg
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Decoded avatars by media id, kept for the process (a handful of small images). */
private val avatarCache = LruCache<String, ImageBitmap>(16)

/**
 * A remote avatar (GET /api/media/:id, with the session token, so not a plain
 * image loader), decoded small and cached. Null while loading, when absent, or
 * if the fetch fails, so callers show their fallback.
 */
@Composable
fun rememberAvatarImage(mediaId: String?, diameter: Dp): ImageBitmap? {
    val px = with(LocalDensity.current) { diameter.roundToPx() }
    var image by remember(mediaId) { mutableStateOf(mediaId?.let { avatarCache.get(it) }) }
    LaunchedEffect(mediaId) {
        if (mediaId == null || image != null) return@LaunchedEffect
        try {
            val data = APIClient.data("/api/media/${seg(mediaId)}")
            val decoded = withContext(Dispatchers.Default) { decodeAvatar(data, px * 2) }
            if (decoded != null) {
                avatarCache.put(mediaId, decoded)
                image = decoded
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Keep the fallback: an avatar is never worth an error on screen.
        }
    }
    return image
}

private fun decodeAvatar(data: ByteArray, target: Int): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
    return BitmapFactory.decodeByteArray(data, 0, data.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}

/**
 * A fixed circle: the photo when there is one, otherwise initials on raised,
 * sized to 40% of the diameter (they scale with the avatar, not the font).
 */
@Composable
fun Avatar(
    initials: String,
    size: Dp = JKSize.avatar,
    modifier: Modifier = Modifier,
    mediaId: String? = null,
    contentDescription: String? = null,
) {
    val image = rememberAvatarImage(mediaId, size)
    val fontSize = with(LocalDensity.current) { (size * 0.4f).toSp() }
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(JKColors.raised, CircleShape)
            .then(if (contentDescription != null) Modifier.clearAndSetSemantics { this.contentDescription = contentDescription } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            Image(image, null, Modifier.size(size), contentScale = ContentScale.Crop)
        } else {
            Text(initials, style = JKType.callout.copy(fontSize = fontSize, lineHeight = fontSize), color = JKColors.text, maxLines = 1)
        }
    }
}

/**
 * JK: his portrait inside a 1.5dp champagne ring. Until the portrait loads (or
 * if there is none) the drawn monogram stands in, never someone's initials.
 */
@Composable
fun CoachAvatar(
    mediaId: String?,
    size: Dp = JKSize.avatar,
    modifier: Modifier = Modifier,
    contentDescription: String? = "JK, your coach",
) {
    val image = rememberAvatarImage(mediaId, size)
    Box(
        modifier
            .size(size)
            .border(JKSize.ring, JKColors.accent, CircleShape)
            .padding(JKSize.ring * 2)
            .clip(CircleShape)
            .background(JKColors.raised, CircleShape)
            .then(if (contentDescription != null) Modifier.clearAndSetSemantics { this.contentDescription = contentDescription } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null) {
            Image(image, null, Modifier.size(size), contentScale = ContentScale.Crop)
        } else {
            Monogram(size = size * 0.6f, tint = JKColors.accent, contentDescription = null)
        }
    }
}

/**
 * The JK tab's glyph: his portrait in a small champagne ring when there is
 * one, otherwise the monogram in the tab's own colour (bone when selected,
 * stone when not). The tab's label names it, so the glyph itself is silent.
 */
@Composable
fun JKTabIcon(mediaId: String?, selected: Boolean, modifier: Modifier = Modifier) {
    val image = rememberAvatarImage(mediaId, JKSize.iconTab)
    if (image != null) {
        Box(
            modifier
                .size(JKSize.iconTab)
                .border(JKSize.ring, if (selected) JKColors.accent else JKColors.hairline, CircleShape)
                .padding(JKSize.ring * 2)
                .clip(CircleShape),
        ) {
            Image(image, null, Modifier.size(JKSize.iconTab), contentScale = ContentScale.Crop)
        }
    } else {
        Monogram(modifier, size = JKSize.iconTab, tint = androidx.compose.material3.LocalContentColor.current, contentDescription = null)
    }
}
