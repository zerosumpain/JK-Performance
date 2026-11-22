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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.ReportPlan
import com.jkperformance.app.net.ReportStats
import com.jkperformance.app.net.ReportsResponse
import com.jkperformance.app.net.WorkoutSummary
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

// Old destinations the Atelier redesign replaces (CheckInSheet, the JK tab's
// Past letters, LetterView). Kept only while ClientHomeView.kt still links
// them; delete this file together with ClientHomeView.kt.

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


@Composable
fun WeeklyFeedbackListView() {
    var reports by remember { mutableStateOf<List<Report>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val reply: ReportsResponse = APIClient.get("/api/reports")
            reports = reply.reports
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.weight(1f)) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ScreenHeader(eyebrow = "From ${AppSession.me?.coach?.name ?: "your coach"}", title = "Feedback")
                Loadable(value = reports, error = error, retry = { load() }) { list ->
                    if (list.isEmpty()) {
                        EmptyCard(title = "Nothing yet", detail = "Your coach's review of each week appears here, with the plan for the next one.")
                    }
                    list.forEach { r ->
                        Row(
                            Modifier.clip(JKShape.card).navLink { ReportDetailView(reportId = r.id ?: "") }.jkSurface(padding = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(r.weekLabel, style = JKType.callout.semibold(), color = JKColors.text)
                                Text(firstLine(r), style = quoteStyle(inSheet = true), color = JKColors.textSecondary, maxLines = 2)
                            }
                            if (r.isUnread) Dot(JKColors.text, size = 8.dp, modifier = Modifier.semantics { contentDescription = "New" })
                            Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
                        }
                    }
                }
            }
        }
    }
}

private fun firstLine(r: Report): String = listOf(r.summary, r.wins, r.focus).firstOrNull { it.isNotEmpty() } ?: ""

/** One week's feedback: the coach's words, the week's figures, next week's plan. */
@Composable
fun ReportDetailView(reportId: String) {
    var report by remember { mutableStateOf<Report?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            report = APIClient.get("/api/reports/${seg(reportId)}")
            error = null
        } catch (e: Exception) {
            if (!e.isCancellation) error = e.readable
        }
    }

    LaunchedEffect(reportId) { load() }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Loadable(value = report, error = error, retry = { load() }) { r ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Label(text = "${Fmt.dayMonth(r.week)} – ${Fmt.dayMonth(r.weekEnd)}")
                    Text("Your week", style = JKType.display, color = JKColors.text)
                    r.coachName?.let { by ->
                        Text(
                            "From $by" + (r.publishedAt?.let { " · ${Fmt.dayMonth(it)}" } ?: ""),
                            style = JKType.caption,
                            color = JKColors.textTertiary,
                        )
                    }
                }
                ReportSection(title = "How it went", text = r.summary)
                ReportSection(title = "Wins", text = r.wins)
                ReportSection(title = "Focus for next week", text = r.focus)
                r.stats?.let { ReportStatsGrid(stats = it) }
                r.plan?.let { PlanList(plan = it, linkWorkouts = true) }
            }
        }
    }
}

@Composable
private fun ReportSection(title: String, text: String) {
    if (text.isEmpty()) return
    Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(text = title)
        Text(text, style = JKType.body, color = JKColors.text)
    }
}

/** The week in numbers. Health figures appear only when shared. */
