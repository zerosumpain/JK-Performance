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


// MARK: - Progress

private enum class Span(val label: String, val query: String) {
    threeMonths("3M", "3m"), sixMonths("6M", "6m"), all("All", "all"),
}

/** Named ProgressScreen because the iPhone's SwiftUI already owns `ProgressView` (and so does Theme.kt). */
@Composable
fun ProgressScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var range by remember { mutableStateOf(Span.threeMonths) }
    var progress by remember { mutableStateOf<ProgressData?>(null) }
    var photos by remember { mutableStateOf<List<Photo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var measuring by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            progress = APIClient.get("/api/progress", mapOf("range" to range.query))
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun loadPhotos() {
        try {
            val reply: PhotosResponse = APIClient.get("/api/photos")
            photos = reply.photos.sortedBy { it.date }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            photos = photos ?: emptyList()
        }
    }

    suspend fun upload(uri: Uri) {
        uploading = true
        try {
            val jpeg = withContext(Dispatchers.IO) { jpegForUpload(context, uri) }
            if (jpeg == null) {
                actionError = "Couldn't read that photo."
                return
            }
            val photo: Photo = APIClient.upload("/api/photos", jpeg, "image/jpeg", mapOf("date" to Day.today))
            photos = (photos ?: emptyList()) + photo
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        } finally {
            uploading = false
        }
    }

    suspend fun delete(photo: Photo) {
        try {
            APIClient.send<OK>("DELETE", "/api/photos/${seg(photo.id)}")
            photos = photos?.filter { it.id != photo.id }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch { upload(uri) }
    }

    LaunchedEffect(range) { load() }
    LaunchedEffect(Unit) { loadPhotos() }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ScreenHeader(eyebrow = progress?.since?.let { "Since ${Fmt.dayMonth(it)}" } ?: "Progress", title = "Progress") {
                    Segmented(Span.entries, range, { range = it }, Modifier.width(130.dp)) { it.label }
                }

                Loadable(progress, error, retry = { load() }) { p ->
                    WeightCard(p)
                    if (p.stats.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            p.stats.forEach { s ->
                                StatTile(
                                    label = statLabel(s.kind),
                                    value = statValue(s),
                                    modifier = Modifier.weight(1f),
                                    delta = s.delta?.let { Fmt.delta(it) },
                                )
                            }
                        }
                    }
                    SecondaryButton(onClick = { measuring = true }) {
                        IconLabel("Add measurement", icon = IconKey.add, style = JKType.callout.semibold())
                    }

                    Label(text = "Personal records", trailing = "Best logged load")
                    if (p.records.isEmpty()) {
                        EmptyCard(title = "No records yet", detail = "Log sets in your workouts to see them here.")
                    } else {
                        Column(Modifier.jkSurface(padding = 2.dp)) {
                            p.records.forEach { pr ->
                                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Glyph(IconKey.trophy, JKType.body, JKColors.textSecondary)
                                    Text(pr.exercise, style = JKType.callout, color = JKColors.text,
                                        modifier = Modifier.padding(start = 8.dp))
                                    Spacer(Modifier.weight(1f))
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text("${Fmt.number(pr.kg)} kg", style = JKType.callout.semibold(), color = JKColors.text)
                                        pr.gain?.let { gain ->
                                            Text("${Fmt.delta(gain)} kg", style = JKType.caption, color = JKColors.textTertiary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Row(
                    Modifier.navLink { ChallengesView() }.jkSurface(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RowGlyph(IconKey.trophy)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Challenges", style = JKType.callout.semibold(), color = JKColors.text)
                        Text("Run, walk or row with the group", style = JKType.caption, color = JKColors.textTertiary)
                    }
                    Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label(text = "Progress photos", modifier = Modifier.weight(1f))
                    IconLabel("Private to you and Coach", icon = IconKey.lock, style = JKType.caption, color = JKColors.textTertiary)
                }
                PhotoRow(
                    photos = photos ?: emptyList(),
                    uploading = uploading,
                    onAdd = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    onDelete = { photo -> scope.launch { delete(photo) } },
                )
            }
        }
    }

    if (measuring) {
        Sheet(onDismiss = { measuring = false }) {
            MeasurementSheet { input ->
                APIClient.send<ProgressData, MeasurementInput>("POST", "/api/measurements", input)
                load()
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

/** The last three photos, each with a long-press Delete (the iPhone's context menu), then the add tile. */
@Composable
private fun PhotoRow(photos: List<Photo>, uploading: Boolean, onAdd: () -> Unit, onDelete: (Photo) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        photos.takeLast(3).forEach { photo ->
            var menu by remember(photo.id) { mutableStateOf(false) }
            Box(
                Modifier
                    .weight(1f)
                    .height(90.dp)
                    .pointerInput(photo.id) { detectTapGestures(onLongPress = { menu = true }) },
            ) {
                AuthedPhoto(photo, Modifier.fillMaxSize())
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Delete photo", style = JKType.body, color = JKColors.error) },
                        leadingIcon = { Glyph(IconKey.delete, tint = JKColors.error) },
                        onClick = {
                            menu = false
                            onDelete(photo)
                        },
                    )
                }
            }
        }
        Box(
            Modifier
                .weight(1f)
                .height(90.dp)
                .clip(JKShape.control)
                .clickable(enabled = !uploading, onClick = onAdd)
                .drawBehind {
                    val width = 1.dp.toPx()
                    drawRoundRect(
                        JKColors.hairline,
                        topLeft = Offset(width / 2, width / 2),
                        size = size.copy(width = size.width - width, height = size.height - width),
                        cornerRadius = CornerRadius(10.dp.toPx()),
                        style = Stroke(width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx()))),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            if (uploading) ProgressView(tint = JKColors.textSecondary) else Glyph(IconKey.mealPhoto, JKType.body, JKColors.textSecondary)
        }
    }
}

@Composable
private fun WeightCard(p: ProgressData) {
    val points = (p.weight?.series ?: emptyList()).mapNotNull { pt -> Day.date(pt.date)?.let { it to pt.value } }
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Label(text = "Body weight", modifier = Modifier.weight(1f))
            p.weight?.delta?.let { DeltaBadge(text = "${Fmt.delta(it)} kg") }
        }
        Text(
            buildAnnotatedString {
                append(p.weight?.latest?.let { Fmt.number(it) } ?: "–")
                withStyle(SpanStyle(fontSize = JKType.caption.fontSize, fontWeight = JKType.caption.fontWeight, color = JKColors.textTertiary)) {
                    append(" kg")
                }
            },
            style = JKType.display,
            color = JKColors.text,
        )
        if (points.size >= 2) {
            WeightChart(points, Modifier.fillMaxWidth().height(90.dp))
        } else {
            Text("Add two weigh-ins (or turn on Health Connect) to see the trend.", style = JKType.caption, color = JKColors.textTertiary)
        }
    }
}

/**
 * The weight trend (Atelier TrendChart): a slate line with no fill, x by date, y from 1 kg under the lowest to 1 kg over
 * the highest, no axes.
 */
@Composable
private fun WeightChart(points: List<Pair<LocalDate, Double>>, modifier: Modifier) {
    val values = points.map { it.second }
    val low = (values.minOrNull() ?: 0.0) - 1
    val high = (values.maxOrNull() ?: 0.0) + 1
    Canvas(modifier) {
        val firstDay = points.minOf { it.first.toEpochDay() }
        val span = max(1L, points.maxOf { it.first.toEpochDay() } - firstDay).toFloat()
        fun x(d: LocalDate) = (d.toEpochDay() - firstDay) / span * size.width
        fun y(v: Double) = (size.height * (1 - (v - low) / (high - low))).toFloat()
        val line = Path()
        points.forEachIndexed { i, (d, v) -> if (i == 0) line.moveTo(x(d), y(v)) else line.lineTo(x(d), y(v)) }
        drawPath(line, JKColors.data, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

private fun statLabel(kind: String): String = when (kind) {
    "bodyFat" -> "Body fat"
    "waist" -> "Waist"
    "restingHr" -> "Resting HR"
    "weight" -> "Weight"
    else -> kind
}

private fun statUnit(kind: String): String = when (kind) {
    "bodyFat" -> "%"
    "waist" -> " cm"
    "weight" -> " kg"
    else -> ""
}

private fun statValue(s: StatBlock): String {
    val latest = s.latest ?: return "–"
    return Fmt.number(latest) + statUnit(s.kind)
}

/**
 * JPEG at most 2048 px on the long side, under the 8 MB upload limit.
 * ImageDecoder applies the photo's EXIF rotation, as UIImage does.
 */
private fun jpegForUpload(context: Context, uri: Uri): ByteArray? = try {
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
private fun MeasurementSheet(save: suspend (MeasurementInput) -> Unit) {
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
            Segmented(measurementKinds, kind, { kind = it }) { statLabel(it) }
            JKField(
                label = "${statLabel(kind)} ($unitName)",
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
                        EmptyCard(title = "No challenges running", detail = "Your coach will post the next one here.")
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
                                BadgeTile("trophy", "${c.badges ?: 0} badges", Modifier.weight(1f))
                                BadgeTile("flame", "${c.streak ?: 0}-day streak", Modifier.weight(1f))
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
private fun BadgeTile(systemName: String, text: String, modifier: Modifier = Modifier) {
    Row(
        modifier.jkSurface(padding = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowGlyph(IconKey.fromSymbol(systemName), slot = 32.dp)
        Text(text, style = JKType.caption.semibold(), color = JKColors.text)
    }
}

// MARK: - Weekly check-in

private val painOptions = listOf("Knee", "Back", "Shoulder", "Hip", "Other")

@Composable
fun WeeklyCheckInView() {
    val session = AppSession
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var energy by remember { mutableStateOf(3) }
    var sleep by remember { mutableStateOf(3) }
    var pain by remember { mutableStateOf(setOf<String>()) }
    var note by remember { mutableStateOf("") }
    var history by remember { mutableStateOf<CheckInsResponse?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }

    val coachName = session.me?.coach?.name ?: "Your coach"

    /** This week's check-in, when one is already in (the button then says Update). */
    fun current(): CheckIn? {
        val h = history ?: return null
        val due = h.dueWeek ?: return null
        return h.checkins.firstOrNull { it.week == due }
    }

    suspend fun load() {
        try {
            val reply: CheckInsResponse = APIClient.get("/api/checkins")
            history = reply
            loadError = null
            current()?.let { c ->
                energy = c.energy
                sleep = c.sleep
                pain = c.pain.toSet()
                note = c.note ?: ""
            }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            loadError = e.readable
        }
    }

    suspend fun submit() {
        saving = true
        try {
            APIClient.send<CheckIn, CheckInInput>(
                "POST", "/api/checkins",
                CheckInInput(energy = energy, sleep = sleep, pain = painOptions.filter { it in pain }, note = note),
            )
            error = null
            sent = true
            delay(600)
            dismiss()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            saving = false
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar("Weekly check-in")
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("How did this week feel, ${session.me?.firstName ?: ""}?", style = JKType.display, color = JKColors.text)
                Text("$coachName reviews these every week.", style = JKType.caption, color = JKColors.textSecondary)
            }
            loadError?.let { ErrorBanner(it) }
            RatingCard(title = "Energy levels", hint = "1 = drained, 5 = excellent", value = energy) { energy = it }
            RatingCard(title = "Sleep quality", hint = null, value = sleep) { sleep = it }
            Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Any pain or niggles?", style = JKType.callout.semibold(), color = JKColors.text)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip(label = "None", selected = pain.isEmpty()) { pain = emptySet() }
                    painOptions.forEach { p ->
                        Chip(label = p, selected = p in pain) { pain = if (p in pain) pain - p else pain + p }
                    }
                }
                val noteStyle = JKType.caption.copy(color = JKColors.text)
                BasicTextField(
                    value = note,
                    onValueChange = { note = it },
                    textStyle = noteStyle,
                    minLines = 2,
                    maxLines = 5,
                    cursorBrush = SolidColor(JKColors.text),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { field ->
                        Box(Modifier.fillMaxWidth().background(JKColors.raised, JKShape.chip).padding(10.dp)) {
                            if (note.isEmpty()) Text("Tell $coachName more", style = noteStyle, color = JKColors.textTertiary)
                            field()
                        }
                    },
                )
            }
            Row(Modifier.navLink { ProgressScreen() }.jkSurface(), verticalAlignment = Alignment.CenterVertically) {
                IconLabel("Add weekly photos", icon = IconKey.mealPhoto, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                Text("Optional", style = JKType.caption, color = JKColors.textTertiary)
            }
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { submit() } }, enabled = !saving) {
                if (saving) ProgressView()
                else Text(if (sent) "Sent ✓" else if (current() == null) "Send check-in" else "Update check-in")
            }

            history?.checkins?.firstOrNull { it.reply?.isEmpty() == false }?.let { last ->
                Label(text = "Latest reply · week of ${Fmt.dayMonth(last.week)}")
                Text(last.reply ?: "", style = JKType.caption, color = JKColors.text, modifier = Modifier.jkSurface())
            }
        }
    }
}

@Composable
private fun RatingCard(title: String, hint: String?, value: Int, onChange: (Int) -> Unit) {
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = JKType.callout.semibold(), color = JKColors.text)
        if (hint != null) Text(hint, style = JKType.caption, color = JKColors.textTertiary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..5).forEach { n ->
                val on = value == n
                val shape = JKShape.chip
                Box(
                    Modifier
                        .weight(1f)
                        .clip(shape)
                        .clickable { onChange(n) }
                        .background(if (on) SolidColor(JKColors.accentControl) else SolidColor(JKColors.raised), shape)
                        .padding(vertical = 9.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("$n", style = JKType.callout.semibold(), color = if (on) JKColors.primaryLabel else JKColors.text)
                }
            }
        }
    }
}
