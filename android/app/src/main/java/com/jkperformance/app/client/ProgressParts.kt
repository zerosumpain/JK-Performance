package com.jkperformance.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.util.LruCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Challenge
import com.jkperformance.app.net.ChallengesResponse
import com.jkperformance.app.net.CheckIn
import com.jkperformance.app.net.CheckInInput
import com.jkperformance.app.net.CheckInsResponse
import com.jkperformance.app.net.MeasurementInput
import com.jkperformance.app.net.OK
import com.jkperformance.app.net.Photo
import com.jkperformance.app.net.PhotosResponse
import com.jkperformance.app.net.ProgressData
import com.jkperformance.app.net.StatBlock
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.max
import kotlin.math.roundToInt
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*


/** Decoded photos by id, as the iPhone's NSCache: about 24 thumbnails' worth. */
private val photoCache = LruCache<String, ImageBitmap>(24)

/** Decodes at no more than ~`target` px on the short side: the tiles are 90 points tall. */
private fun decodeSampled(data: ByteArray, target: Int): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= target) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(data, 0, data.size, options)?.asImageBitmap()
}

/** A progress photo fetched through APIClient (a plain image loader sends no token). */
@Composable
fun AuthedPhoto(photo: Photo, modifier: Modifier = Modifier) {
    var image by remember(photo.id) { mutableStateOf(photoCache.get(photo.id)) }
    var failed by remember(photo.id) { mutableStateOf(false) }

    LaunchedEffect(photo.id) {
        if (image != null) return@LaunchedEffect
        try {
            val data = APIClient.data("/api/photos/${seg(photo.id)}")
            val decoded = withContext(Dispatchers.Default) { decodeSampled(data, 400) }
            if (decoded != null) {
                photoCache.put(photo.id, decoded)
                image = decoded
            } else {
                failed = true
            }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            failed = true
        }
    }

    Box(modifier.clip(JKShape.control).background(JKColors.raised)) {
        val loaded = image
        if (loaded != null) {
            Image(loaded, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Glyph(if (failed) IconKey.warning else IconKey.stand, if (failed) JKType.body else JKType.numberHero, JKColors.textTertiary, Modifier.align(if (failed) Alignment.Center else Alignment.BottomCenter))
        }
        Text(
            Fmt.dayMonth(photo.date),
            style = JKType.caption,
            color = JKColors.textSecondary,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(6.dp)
                .background(JKColors.scrim, CircleShape)
                .padding(horizontal = 5.dp, vertical = 2.dp),
        )
    }
}

private val measurementKinds = listOf("weight", "bodyFat", "waist", "restingHr")

@Composable
fun MeasurementSheet(save: suspend (MeasurementInput) -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("weight") }
    var value by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(LocalDate.now(Day.zone)) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val unitName = when (kind) {
        "bodyFat" -> "%"
        "waist" -> "cm"
        "restingHr" -> "bpm"
        else -> "kg"
    }

    suspend fun submit() {
        val number = parseNumber(value) ?: return
        saving = true
        try {
            save(MeasurementInput(date = Day.string(date), kind = kind, value = number))
            dismiss()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar("Add measurement", leading = { BarButton("Cancel") { dismiss() } })
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Segmented(measurementKinds, kind, { kind = it }) { Measure.label(it) }
            JKField(
                label = "${Measure.label(kind)} ($unitName)",
                text = value,
                onTextChange = { value = it },
                prompt = "0",
                keyboard = KeyboardType.Decimal,
            )
            PastDateRow("Date", date) { date = it }
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { submit() } }, enabled = parseNumber(value) != null && !saving) {
                if (saving) ProgressView() else Text("Save")
            }
        }
    }
}

/**
 * SwiftUI's compact `DatePicker(in: ...Date())`: the label, and the date in a
 * grey capsule that opens a calendar of today and earlier.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PastDateRow(label: String, date: LocalDate, onChange: (LocalDate) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
        Text(
            Fmt.dayMonthYear(date),
            style = JKType.callout,
            color = JKColors.text,
            modifier = Modifier
                .clip(JKShape.chip)
                .clickable { open = true }
                .background(JKColors.raised)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
    if (open) {
        val todayMillis = LocalDate.now(Day.zone).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= todayMillis
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                    open = false
                }) { Text("Done", style = JKType.body.semibold(), color = JKColors.text) }
            },
            dismissButton = {
                TextButton(onClick = { open = false }) { Text("Cancel", style = JKType.body, color = JKColors.text) }
            },
        ) { DatePicker(state) }
    }
}

// MARK: - Challenges

@Composable
fun ChallengesView() {
    val scope = rememberCoroutineScope()
    var challenges by remember { mutableStateOf<List<Challenge>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var joining by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ChallengesResponse = APIClient.get("/api/challenges")
            challenges = reply.challenges
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun join(c: Challenge) {
        joining = c.id
        try {
            val fresh: Challenge = APIClient.send("POST", "/api/challenges/${seg(c.id)}/join")
            challenges = challenges?.map { if (it.id == fresh.id) fresh else it }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        } finally {
            joining = null
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ScreenHeader(eyebrow = "Community", title = "Challenges")
                Loadable(challenges, error, retry = { load() }) { list ->
                    if (list.isEmpty()) {
                        EmptyCard(title = "No challenges running", detail = "JK will post the next one here.")
                    }
                    list.forEach { c ->
                        ChallengeCard(c, joining = joining, onJoin = { scope.launch { join(c) } })
                        if (c.isJoined && c.leaderboard.isNotEmpty()) {
                            Label(text = "Leaderboard", trailing = c.title)
                            Column(Modifier.jkSurface(padding = 2.dp)) {
                                c.leaderboard.forEach { row ->
                                    Row(
                                        Modifier.fillMaxWidth().padding(12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text("${row.rank}", style = JKType.callout.semibold(),
                                            color = if (row.isMe == true) JKColors.textTertiary else JKColors.text,
                                            modifier = Modifier.width(18.dp))
                                        Avatar(initials = row.initials ?: Fmt.initials(row.name), size = 26.dp)
                                        Text(if (row.isMe == true) "You" else row.name, style = JKType.callout,
                                            color = JKColors.text, modifier = Modifier.weight(1f))
                                        Text("${Fmt.number(row.value)} km", style = JKType.callout.semibold(), color = JKColors.text)
                                    }
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                BadgeTile(IconKey.record, "${c.badges ?: 0} badges", Modifier.weight(1f))
                                BadgeTile(IconKey.done, "${c.streak ?: 0} days done in a row", Modifier.weight(1f))
                            }
                        }
                    }
                    Text(
                        "Distance comes from Health Connect (walking, running and rowing). Turn it on under Account › Health & devices.",
                        style = JKType.caption,
                        color = JKColors.textTertiary,
                    )
                }
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun ChallengeCard(c: Challenge, joining: String?, onJoin: () -> Unit) {
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        c.daysLeft?.let { days ->
            Text(
                if (days == 1) "1 day left" else "$days days left",
                style = JKType.caption,
                color = JKColors.textSecondary,
                modifier = Modifier.background(JKColors.raised, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        Spacer(Modifier.height(30.dp))
        Text(c.title, style = JKType.headline, color = JKColors.text)
        Text(
            listOfNotNull(c.detail, c.members?.let { "$it members taking part." }).joinToString(" "),
            style = JKType.caption,
            color = JKColors.textSecondary,
        )
        if (c.isJoined) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                ThinBar(fraction = if (c.target > 0) c.myValue / c.target else 0.0, height = 4.dp, modifier = Modifier.weight(1f))
                Text("${Fmt.number(c.myValue)} / ${Fmt.number(c.target)} km", style = JKType.caption.semibold(), color = JKColors.text)
            }
        } else {
            PrimaryButton(onClick = onJoin, enabled = joining == null) {
                if (joining == c.id) ProgressView() else Text("Join challenge")
            }
        }
    }
}

@Composable
private fun BadgeTile(icon: IconKey, text: String, modifier: Modifier = Modifier) {
    Row(
        modifier.jkSurface(padding = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowGlyph(icon, slot = 32.dp)
        Text(text, style = JKType.caption.semibold(), color = JKColors.text)
    }
}

