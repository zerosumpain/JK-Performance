package com.jkperformance.app

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.CheckIn
import com.jkperformance.app.net.CheckInInput
import com.jkperformance.app.net.CheckInsResponse
import com.jkperformance.app.net.CheckinDraft
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.launch

private val painOptions = listOf("Knee", "Back", "Shoulder", "Hip", "Other")
private val energyWords = listOf("Drained", "Low", "Steady", "Good", "Full of it")
private val stressWords = listOf("Calm", "Settled", "Some", "High", "Very high")
private val sleepWords = listOf("Poor", "Restless", "Fair", "Good", "Deep")

/**
 * The weekly check-in (atelier-spec.md, Client screens 5), a minute in three
 * paged cards: how the week felt, the body (with the week's figures filled in
 * and read-only), and one win, one struggle and any photos. Plans with
 * 'checkin' only. Shown in a [Sheet].
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun CheckInSheet() {
    val dismiss = LocalDismiss.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pager = rememberPagerState(pageCount = { 3 })
    var energy by remember { mutableStateOf(3) }
    var stress by remember { mutableStateOf(3) }
    var sleep by remember { mutableStateOf(3) }
    val pain = remember { mutableStateListOf<String>() }
    var win by remember { mutableStateOf("") }
    var struggle by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val photoIds = remember { mutableStateListOf<String>() }
    val thumbs = remember { mutableStateListOf<Uri>() }
    var uploading by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf<CheckinDraft?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { APIClient.get<CheckInsResponse>("/api/checkins") }.getOrNull()?.let { reply ->
            val c = reply.dueWeek?.let { due -> reply.checkins.firstOrNull { it.week == due } } ?: return@let
            energy = c.energy
            sleep = c.sleep
            stress = c.stress ?: 3
            pain.clear(); pain.addAll(c.pain)
            note = c.note ?: ""
            win = c.win ?: ""
            struggle = c.struggle ?: ""
            photoIds.clear(); photoIds.addAll(c.photoIds ?: emptyList())
        }
        draft = runCatching { APIClient.get<CheckinDraft>("/api/checkins/draft") }.getOrNull()
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(6)) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            for (uri in uris.take(6 - photoIds.size)) {
                try {
                    val media = ClientUpload.image(context, uri, purpose = "checkin")
                    photoIds += media.id
                    thumbs += uri
                } catch (e: Exception) {
                    if (e.isCancellation) throw e
                    error = e.readable
                }
            }
            uploading = false
        }
    }

    suspend fun submit() {
        saving = true
        val input = CheckInInput(
            energy = energy, sleep = sleep, pain = painOptions.filter { it in pain }, note = note.trim(),
            stress = stress, win = win.trim(), struggle = struggle.trim(),
            photoIds = photoIds.toList().ifEmpty { null },
        )
        try {
            APIClient.send<CheckIn, CheckInInput>("POST", "/api/checkins", input)
            error = null
            sent = true
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            saving = false
        }
    }

    @Composable
    fun Card(content: @Composable () -> Unit) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter).padding(bottom = JKSpace.huge),
            verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
        ) { content() }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = if (sent) "" else "Check-in", leading = { BarButton(if (sent) "Done" else "Not now") { dismiss() } })
        if (sent) {
            Column(
                Modifier.fillMaxSize().padding(JKSpace.gutter),
                verticalArrangement = Arrangement.spacedBy(JKSpace.l),
            ) {
                Spacer(Modifier.weight(1f))
                BrandRule()
                Text("Sent to JK. Your letter arrives Monday morning.", style = quoteStyle(), color = JKColors.text)
                Spacer(Modifier.weight(1f))
                PrimaryButton("Done", onClick = { dismiss() })
            }
        } else {
            HorizontalPager(pager, modifier = Modifier.weight(1f)) { page ->
                when (page) {
                    0 -> Card {
                        Text("How did the week feel?", style = JKType.title, color = JKColors.text)
                        WordScale("Energy", energyWords, energy) { energy = it }
                        WordScale("Stress", stressWords, stress) { stress = it }
                        SecondaryButton("Next", onClick = { scope.launch { pager.animateScrollToPage(1) } })
                    }
                    1 -> Card {
                        Text("Body", style = JKType.title, color = JKColors.text)
                        WordScale("Sleep quality", sleepWords, sleep) { sleep = it }
                        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                            Text("Any pain or niggles?", style = JKType.headline, color = JKColors.text)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                Chip("None", selected = pain.isEmpty()) { pain.clear() }
                                painOptions.forEach { p ->
                                    Chip(p, selected = p in pain) { if (p in pain) pain.remove(p) else pain.add(p) }
                                }
                            }
                            if (pain.isNotEmpty()) {
                                JKField(label = "Tell JK more", text = note, onTextChange = { note = it }, prompt = "Left knee tight after split squats")
                            }
                        }
                        draft?.let { Facts(it) }
                        SecondaryButton("Next", onClick = { scope.launch { pager.animateScrollToPage(2) } })
                    }
                    else -> Card {
                        Text("Your week", style = JKType.title, color = JKColors.text)
                        JKField(label = "One win", text = win, onTextChange = { win = it }, prompt = "Squat 102.5 for 5")
                        JKField(label = "One struggle", text = struggle, onTextChange = { struggle = it }, prompt = "Late nights midweek")
                        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                            Text("Photos (optional, private to you and JK)", style = JKType.caption, color = JKColors.textSecondary)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(JKSpace.s), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                thumbs.forEach { uri ->
                                    AsyncImage(
                                        model = uri, contentDescription = "Photo", contentScale = ContentScale.Crop,
                                        modifier = Modifier.size(64.dp).clip(JKShape.chip),
                                    )
                                }
                                if (photoIds.size < 6) {
                                    Box(
                                        Modifier
                                            .size(64.dp)
                                            .clip(JKShape.chip)
                                            .border(JKSize.hairline, JKColors.inputBorder, JKShape.chip)
                                            .clickable(enabled = !uploading) {
                                                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                            }
                                            .semantics { contentDescription = "Add photos" },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        if (uploading) ProgressView(tint = JKColors.textSecondary)
                                        else Glyph(IconKey.mealPhoto, tint = JKColors.textSecondary)
                                    }
                                }
                            }
                            if (photoIds.size > thumbs.size) {
                                Text(
                                    "${photoIds.size - thumbs.size} photo${if (photoIds.size - thumbs.size == 1) "" else "s"} already added",
                                    style = JKType.caption, color = JKColors.textSecondary,
                                )
                            }
                        }
                        error?.let { ErrorBanner(it) }
                        PrimaryButton(onClick = { scope.launch { submit() } }, enabled = !saving && !uploading) {
                            if (saving) ProgressView() else Text("Send to JK")
                        }
                    }
                }
            }
            // Page dots.
            Row(
                Modifier.fillMaxWidth().padding(bottom = JKSpace.l),
                horizontalArrangement = Arrangement.spacedBy(JKSpace.s, Alignment.CenterHorizontally),
            ) {
                repeat(3) { i ->
                    Box(
                        Modifier.size(JKSize.dot).background(if (pager.currentPage == i) JKColors.text else JKColors.trackStrong, CircleShape),
                    )
                }
            }
        }
    }
}

/** The week as the app already knows it: read-only. */
@Composable
private fun Facts(d: CheckinDraft) {
    Column(Modifier.fillMaxWidth().jkSurface(padding = JKSpace.l), verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Text("Filled in for you", style = JKType.caption, color = JKColors.textSecondary)
        d.avgSteps?.let { Fact("Steps", "${Fmt.number(it, digits = 0)} a day") }
        d.avgSleepMinutes?.let { Fact("Sleep", "${Fmt.minutes(it)} a night") }
        d.habits?.let { Fact("Habits", "${it.done} of ${it.days} days") }
        val done = d.sessionsDone
        val planned = d.sessionsPlanned
        if (done != null && planned != null) Fact("Sessions", "$done of $planned")
        (d.feel ?: emptyList()).forEach { f -> f.word?.let { Fact(f.title ?: "Session", it) } }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
        Text(label, style = JKType.callout, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
        Text(value, style = JKType.callout.monospacedDigit(), color = JKColors.text)
    }
}

/** A 1 to 5 choice with a word on every option. */
@Composable
fun WordScale(title: String, words: List<String>, value: Int, onChange: (Int) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = JKType.headline, color = JKColors.text, modifier = Modifier.weight(1f))
            Text(words[(value - 1).coerceIn(0, words.size - 1)], style = JKType.callout, color = JKColors.textSecondary)
        }
        WordChoices(words, selected = value - 1, onSelect = { onChange(it + 1) }, title = title)
    }
}
