package com.jkperformance.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AnswerInput
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.ReadReply
import com.jkperformance.app.net.Report
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * A letter from JK (atelier-spec.md, Client screens 8), weekly or milestone,
 * in one full-screen reading view on paper: his portrait and the date, the
 * serif headline, the week's dots and three numbers, one thing to keep and
 * one to adjust, his voice or video note, one question to answer inline,
 * his monogram, and "Reply to JK". Opening it sends the read receipt.
 */
@Composable
fun LetterView(reportId: String) {
    val session = AppSession
    var report by remember { mutableStateOf<Report?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        try {
            val fresh: Report = APIClient.get("/api/reports/${seg(reportId)}")
            report = fresh
            error = null
            if (fresh.readAt == null && session.me?.isCoach == false) {
                runCatching { APIClient.send<ReadReply>("POST", "/api/reports/${seg(reportId)}/read") }
            }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    LaunchedEffect(reportId) { load() }

    Column(Modifier.fillMaxSize().background(JKColors.paper)) {
        TopBar()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter)) {
            Loadable(report, error, retry = { load() }) { r ->
                Letter(r, onAnswered = { report = it })
            }
        }
    }
}

@Composable
private fun Letter(r: Report, onAnswered: (Report) -> Unit) {
    val session = AppSession
    val nav = LocalNav.current
    val reduceMotion = rememberReduceMotion()
    val shown = remember { Animatable(if (reduceMotion) 1f else 0f) }
    val rise = with(LocalDensity.current) { JKSpace.s.toPx() }
    LaunchedEffect(Unit) { shown.animateTo(1f, tween(JKMotion.LETTER_OPEN, easing = JKMotion.standardEasing)) }

    Column(
        Modifier.graphicsLayer {
            alpha = shown.value
            translationY = (1f - shown.value) * rise
        },
        verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            CoachAvatar(session.me?.coach?.avatarMediaId, size = JKSize.avatar)
            Text(LetterText.caption(r), style = JKType.caption, color = JKColors.textSecondary)
        }
        Text(r.displayHeadline, style = JKType.letterHeadline, color = JKColors.text, modifier = Modifier.semantics { heading() })
        LetterRule()
        val dots = r.weekDots
        if (dots != null && dots.size == 7) {
            WeekDots(dots.map { weekDayOf(it.date, done = it.done == true, rest = it.rest == true, future = it.future == true, isToday = false) })
        }
        r.scoreTrio?.takeIf { it.isNotEmpty() }?.let { ScoreTrio(it) }
        // An old report (before letters) keeps its summary as the body.
        if (r.headline.isNullOrEmpty() && r.summary.isNotEmpty() && r.summary != r.displayHeadline) {
            Text(r.summary, style = quoteStyle(inSheet = true), color = JKColors.text)
        }
        LetterBlock("Keep", r.keepText)
        LetterBlock("Adjust", r.adjustText)
        r.mediaId?.let { MediaNote(it, r.mediaKind, r.durationSec, session.me?.coach?.avatarMediaId) }
        LetterQuestion(r, onAnswered)
        LetterRule()
        Monogram(size = JKSpace.huge, tint = JKColors.accent, contentDescription = "JK")
        if (session.gate.messaging) {
            PrimaryButton("Reply to JK", onClick = {
                val id = r.id ?: return@PrimaryButton
                TabRouter.replyQuote = TabRouter.ReplyQuote(id, r.displayHeadline)
                // Back to the thread: the JK sheet at its root (opened over the tab when the letter came from Review).
                if (!TabRouter.showJK) nav.pop()
                TabRouter.openJK(reset = true)
            })
        }
    }
}

/** The letter's 1dp champagne rule. Decorative. */
@Composable
private fun LetterRule() {
    Box(Modifier.fillMaxWidth().height(JKSize.hairline).background(JKColors.accent).clearAndSetSemantics {})
}

@Composable
private fun LetterBlock(title: String, text: String) {
    if (text.isEmpty()) return
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        Text(title, style = JKType.caption, color = JKColors.textSecondary)
        Text(text, style = quoteStyle(), color = JKColors.text)
    }
}

@Composable
private fun LetterQuestion(r: Report, onAnswered: (Report) -> Unit) {
    val q = r.question?.takeIf { it.isNotEmpty() } ?: return
    val scope = rememberCoroutineScope()
    var answer by remember { mutableStateOf("") }
    var answering by remember { mutableStateOf(false) }
    var answerError by remember { mutableStateOf<String?>(null) }

    suspend fun send() {
        val text = answer.trim()
        val id = r.id ?: return
        if (text.isEmpty()) return
        answering = true
        try {
            val fresh: Report = APIClient.send("POST", "/api/reports/${seg(id)}/answer", AnswerInput(text))
            onAnswered(fresh)
            answer = ""
            answerError = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            answerError = e.readable
        } finally {
            answering = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Text(q, style = JKType.title, color = JKColors.text)
        val given = r.answer
        if (!given.isNullOrEmpty()) {
            Text(given, style = JKType.body, color = JKColors.text)
            Text("Sent to JK" + (r.answeredAt?.let { " · ${Fmt.dayMonth(it)}" } ?: ""), style = JKType.caption, color = JKColors.textSecondary)
        } else if (AppSession.gate.checkin) {
            ComposerField(
                value = answer,
                onValueChange = { answer = it },
                placeholder = "Your answer",
                minLines = 2,
                maxLines = 6,
                description = "Your answer to JK's question",
            )
            answerError?.let { ErrorBanner(it) }
            SecondaryButton(onClick = { scope.launch { send() } }, enabled = !answering && answer.isNotBlank()) {
                if (answering) ProgressView(tint = JKColors.text) else Text("Send answer")
            }
        }
    }
}
