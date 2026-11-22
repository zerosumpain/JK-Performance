package com.jkperformance.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.ClientGuide
import com.jkperformance.app.net.ClientGuidesResponse
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * Guides (atelier-spec.md, Client screens 9): every plan includes them, Free
 * too. A list of JK's guides with a one-line summary and reading time; each
 * opens on paper. GET /api/client/guides never refuses a client.
 */
@Composable
fun GuidesList() {
    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
        ) {
            Text("Guides", style = JKType.display, color = JKColors.text, modifier = Modifier.semantics { heading() })
            GuidesListContent()
        }
    }
}

/** The list itself, shared with the Free JK tab. */
@Composable
fun GuidesListContent() {
    val nav = LocalNav.current
    var guides by remember { mutableStateOf<List<ClientGuide>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ClientGuidesResponse = APIClient.get("/api/client/guides")
            guides = reply.guides
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    Loadable(guides, error, retry = { load() }) { list ->
        if (list.isEmpty()) {
            EmptyState("JK's guides will appear here.")
        } else {
            Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
                list.forEachIndexed { i, g ->
                    GuideRow(g, Modifier.clickable { nav.push(ClientRoute.guide(g.id)) })
                    if (i < list.lastIndex) GroupDivider()
                }
            }
        }
    }
}

@Composable
private fun GuideRow(g: ClientGuide, modifier: Modifier) {
    Row(
        modifier.fillMaxWidth().padding(JKSpace.l).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.Top,
    ) {
        Glyph(IconKey.guide, tint = JKColors.textSecondary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(g.title, style = JKType.headline, color = JKColors.text)
            g.summary?.let { Text(it, style = JKType.callout, color = JKColors.textSecondary) }
            g.minutes?.let { Text("$it min read", style = JKType.caption, color = JKColors.textSecondary) }
        }
    }
}

/** One guide on paper: the serif headline and a sans body. */
@Composable
fun GuideView(guideId: String) {
    var guide by remember { mutableStateOf<ClientGuide?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            guide = APIClient.get("/api/client/guides/${seg(guideId)}")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(guideId) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter)) {
            Loadable(guide, error, retry = { load() }) { g ->
                Column(Modifier.jkSurface(SurfaceVariant.Paper, padding = JKSpace.xxl), verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
                    BrandRule()
                    Text(g.title, style = JKType.letterHeadline, color = JKColors.text, modifier = Modifier.semantics { heading() })
                    g.minutes?.let { Text("$it min read", style = JKType.caption, color = JKColors.textSecondary) }
                    paragraphs(g).forEach { p -> Text(p, style = JKType.body, color = JKColors.text) }
                    Monogram(Modifier.padding(top = JKSpace.l), size = JKSpace.huge, tint = JKColors.accent)
                }
            }
        }
    }
}

private fun paragraphs(g: ClientGuide): List<String> =
    (g.body ?: g.summary ?: "").split("\n\n").filter { it.isNotBlank() }
