package com.jkperformance.app

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.CoachGuide
import com.jkperformance.app.net.CoachGuideResponse
import com.jkperformance.app.net.Exercise
import com.jkperformance.app.net.ExercisesResponse
import com.jkperformance.app.net.GuideBlock
import com.jkperformance.app.net.GuideText
import com.jkperformance.app.net.Links
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

// The native guide renderer (docs/design/desk-v2.md F14; docs/api/wp4-campaigns.md,
// "Guide blocks"): coach-written guides as blocks, drawn on paper. Text is
// plain with two inline markers; nothing is ever rendered as HTML. Media come
// through the guide's own route (the server checks the block is in the guide).

/**
 * One of JK's guides, fetched from `GET /api/guides/coach/:guideId` (a
 * published guide of the client's own coach; anything else is a 404).
 */
@Composable
fun CoachGuideView(guideId: String, fallbackTitle: String? = null) {
    var guide by remember { mutableStateOf<CoachGuide?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            guide = APIClient.get<CoachGuideResponse>("/api/guides/coach/${seg(guideId)}").guide
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = if ((e as? com.jkperformance.app.net.APIError)?.status == 404) "This guide isn't available any more." else e.readable
        }
    }
    LaunchedEffect(guideId) { load() }

    GuidePage {
        Loadable(guide, error, retry = { load() }) { g ->
            GuidePaper(g.title.ifEmpty { fallbackTitle ?: "Guide" }, g.readMinutes?.let { "$it min read" }, g.blocks)
        }
    }
}

/** Inline blocks an activity carries instead of a linked guide. */
@Composable
fun InlineGuideView(title: String, blocks: List<GuideBlock>) {
    GuidePage { GuidePaper(title, null, blocks) }
}

@Composable
private fun GuidePage(content: @Composable () -> Unit) {
    VoicePlayerScope {
        Column(Modifier.jkScreen()) {
            TopBar()
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
                verticalArrangement = Arrangement.spacedBy(JKSpace.l),
            ) { content() }
        }
    }
}

/** The guide on paper: the rule, the serif headline, the reading time, the blocks and JK's monogram. */
@Composable
fun GuidePaper(title: String, meta: String?, blocks: List<GuideBlock>) {
    Column(Modifier.jkSurface(SurfaceVariant.Paper, padding = JKSpace.xxl), verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
        BrandRule()
        Text(title, style = JKType.letterHeadline, color = JKColors.text, modifier = Modifier.semantics { heading() })
        meta?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
        GuideBlocks(blocks)
        Monogram(Modifier.padding(top = JKSpace.l), size = JKSpace.huge, tint = JKColors.accent)
    }
}

/** Draws the blocks in order; an unknown block type is skipped (a newer server may add one). */
@Composable
fun GuideBlocks(blocks: List<GuideBlock>) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
        blocks.forEach { b -> GuideBlockView(b) }
    }
}

@Composable
private fun GuideBlockView(b: GuideBlock) {
    when (b.t) {
        "h" -> b.text?.let {
            Text(GuideText.plain(it), style = JKType.title, color = JKColors.text, modifier = Modifier.padding(top = JKSpace.s).semantics { heading() })
        }
        "p" -> b.text?.let { GuideRichText(it, style = JKType.body) }
        "list" -> GuideList(b.style ?: "bullet", b.items.orEmpty())
        "callout" -> b.text?.let { GuideCallout(b.tone ?: "info", it) }
        "image" -> GuideImage(b)
        "video" -> GuideVideo(b)
        "audio" -> GuideAudio(b)
        "link" -> GuideLink(b)
        "exercise" -> b.exerciseId?.let { GuideExercise(it) }
        "divider" -> Box(Modifier.fillMaxWidth().padding(vertical = JKSpace.s).height(JKSize.hairline).background(JKColors.hairline))
        else -> Unit
    }
}

@Composable
private fun GuideList(style: String, items: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        items.forEachIndexed { i, item ->
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.Top) {
                Box(Modifier.widthIn(min = JKSpace.xl).padding(top = JKSpace.xs / 2), contentAlignment = Alignment.TopStart) {
                    when (style) {
                        "number" -> Text("${i + 1}.", style = JKType.body.monospacedDigit(), color = JKColors.textSecondary)
                        "check" -> Glyph(IconKey.checkboxBlank, size = JKSize.iconInline, tint = JKColors.textSecondary)
                        else -> Text("•", style = JKType.body, color = JKColors.textSecondary)
                    }
                }
                GuideRichText(item, style = JKType.body, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun GuideCallout(tone: String, text: String) {
    val (icon, word) = when (tone) {
        "tip" -> IconKey.idea to "Tip"
        "warn" -> IconKey.warning to "Take care"
        else -> IconKey.info to "Note"
    }
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clip(JKShape.card)
            .background(JKColors.raised, JKShape.card)
            .semantics(mergeDescendants = true) {},
    ) {
        Box(Modifier.width(JKSize.rule).fillMaxHeight().background(JKColors.silver))
        Column(Modifier.weight(1f).padding(JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalAlignment = Alignment.CenterVertically) {
                Glyph(icon, size = JKSize.iconSmall, tint = JKColors.text)
                Text(word.uppercase(), style = JKType.parLabel, color = JKColors.textSecondary)
            }
            GuideRichText(text, style = JKType.callout.regular())
        }
    }
}

/** Guide images, decoded once per URL. */
private val guideImages = android.util.LruCache<String, ImageBitmap>(12)

@Composable
private fun GuideImage(b: GuideBlock) {
    val path = b.url?.takeIf { it.startsWith("/api/") } ?: return
    var image by remember(path) { mutableStateOf(guideImages.get(path)) }
    var failed by remember(path) { mutableStateOf(false) }
    LaunchedEffect(path) {
        if (image != null) return@LaunchedEffect
        try {
            val data = APIClient.data(path)
            val decoded = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(data, 0, data.size)?.asImageBitmap() }
            if (decoded != null) {
                guideImages.put(path, decoded)
                image = decoded
            } else {
                failed = true
            }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            failed = true
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        val loaded = image
        when {
            loaded != null -> Image(
                loaded,
                contentDescription = b.caption?.ifEmpty { null } ?: "Picture from JK",
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth().clip(JKShape.card),
            )
            failed -> Text("The picture couldn't load.", style = JKType.caption, color = JKColors.textSecondary)
            else -> Box(Modifier.fillMaxWidth().heightIn(min = JKSize.dial / 2).background(JKColors.raised, JKShape.card), contentAlignment = Alignment.Center) {
                ProgressView(tint = JKColors.textSecondary)
            }
        }
        b.caption?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
    }
}

@Composable
private fun GuideVideo(b: GuideBlock) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = b.mediaId ?: return
    var file by remember { mutableStateOf<File?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    MediaRow(
        icon = IconKey.play,
        title = b.caption?.ifEmpty { null } ?: "A video from JK",
        detail = if (failed) "Couldn't load it. Try again." else "Plays full screen",
        loading = loading,
    ) {
        scope.launch {
            loading = true
            try {
                file = MediaFiles.file(context, id, "video", b.url)
                failed = false
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                failed = true
            } finally {
                loading = false
            }
        }
    }
    file?.let { VideoSheet(it) { file = null } }
}

@Composable
private fun GuideAudio(b: GuideBlock) {
    val player = LocalVoicePlayer.current
    val scope = rememberCoroutineScope()
    val id = b.mediaId ?: return
    val current = player?.currentId == id
    val playing = current && player?.playing == true
    MediaRow(
        icon = if (playing) IconKey.pause else IconKey.play,
        title = b.caption?.ifEmpty { null } ?: "Listen",
        detail = when {
            player?.failedId == id -> "Couldn't play it. Try again."
            current && player != null && player.length > 0 -> "${clockText(player.position)} / ${clockText(player.length)}"
            else -> "Audio from JK"
        },
        loading = player?.loadingId == id,
    ) { scope.launch { player?.toggle(id, b.url) } }
}

@Composable
private fun MediaRow(icon: IconKey, title: String, detail: String, loading: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(JKShape.card)
            .background(JKColors.raised, JKShape.card)
            .clickable(enabled = !loading, role = Role.Button, onClick = onClick)
            .padding(JKSpace.l)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) ProgressView(tint = JKColors.text, size = JKSize.iconTab) else Glyph(icon, size = JKSize.iconTab, tint = JKColors.text)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(title, style = JKType.callout, color = JKColors.text)
            Text(detail, style = JKType.caption, color = JKColors.textSecondary)
        }
    }
}

@Composable
private fun GuideLink(b: GuideBlock) {
    val uri = LocalUriHandler.current
    val url = b.url?.takeIf { Links.isSafe(it) } ?: return
    val host = runCatching { java.net.URI(url).host }.getOrNull()?.removePrefix("www.")
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget)
            .clip(JKShape.card)
            .clickable(role = Role.Button, onClickLabel = "Open in the browser") { runCatching { uri.openUri(url) } }
            .background(JKColors.raised, JKShape.card)
            .padding(horizontal = JKSpace.l, vertical = JKSpace.m)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.link, size = JKSize.iconInline, tint = JKColors.text)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(b.label?.ifEmpty { null } ?: host ?: url, style = JKType.callout, color = JKColors.text)
            host?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
        }
        Glyph(IconKey.openLink, size = JKSize.iconSmall, tint = JKColors.textSecondary, contentDescription = "Opens outside the app")
    }
}

/** The exercise library, fetched once for exercise blocks. */
private object ExerciseNames {
    private var byId: Map<String, Exercise>? = null

    suspend fun lookup(id: String): Exercise? {
        val known = byId ?: APIClient.get<ExercisesResponse>("/api/exercises").exercises.associateBy { it.id }.also { byId = it }
        return known[id]
    }
}

@Composable
private fun GuideExercise(id: String) {
    var exercise by remember(id) { mutableStateOf<Exercise?>(null) }
    LaunchedEffect(id) { exercise = runCatching { ExerciseNames.lookup(id) }.getOrNull() }
    val e = exercise
    Row(
        Modifier.fillMaxWidth().background(JKColors.raised, JKShape.card).padding(JKSpace.l).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.workout, size = JKSize.iconTab, tint = JKColors.text)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            ParLabel("Exercise")
            Text(e?.name ?: "From JK's library", style = JKType.callout, color = JKColors.text)
            e?.let { Text(listOf(it.equipment, it.pattern).filter { s -> s.isNotEmpty() }.joinToString(" · "), style = JKType.caption, color = JKColors.textSecondary) }
        }
    }
}
