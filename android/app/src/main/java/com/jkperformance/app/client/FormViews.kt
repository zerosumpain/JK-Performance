package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.BarButton
import com.jkperformance.app.design.CheckCircle
import com.jkperformance.app.design.Chip
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.IconTile
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.LocalDismiss
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.Sheet
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.FormAnswer
import com.jkperformance.app.net.FormAnswersInput
import com.jkperformance.app.net.FormQuestion
import com.jkperformance.app.net.FormRequest
import com.jkperformance.app.net.FormRequestsResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch

/**
 * Forms the coach is waiting on, at the top of the client's Home screen.
 * Shows nothing when there are none. Re-reads whenever `refresh` changes
 * (each Home load) and when a form sheet closes.
 */
@Composable
fun ClientFormsCard(refresh: Int) {
    val scope = rememberCoroutineScope()
    var waiting by remember { mutableStateOf<List<FormRequest>>(emptyList()) }
    var open by remember { mutableStateOf<FormRequest?>(null) }

    suspend fun load() {
        try {
            val reply: FormRequestsResponse = APIClient.get("/api/form-requests")
            waiting = reply.requests.filter { it.submittedAt == null }
        } catch (e: Exception) {
            // The card is a nudge; Home shows its own errors.
            if (e.isCancellation) throw e
        }
    }

    LaunchedEffect(refresh) { load() }

    if (waiting.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Eyebrow(text = if (waiting.size == 1) "A form from your coach" else "${waiting.size} forms from your coach")
            waiting.forEach { r ->
                Row(
                    Modifier.clip(rounded(JK.corner)).clickable { open = r }.jkCard(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconTile("doc.text", size = 34.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(r.name, style = JKType.subheadline.semibold(), color = JK.text)
                        Text(
                            "${r.questions.size} questions · about ${maxOf(1, r.questions.size / 2)} min",
                            style = JKType.caption2,
                            color = JK.tertiary,
                        )
                    }
                    Text(
                        "Fill in",
                        style = JKType.caption.semibold(),
                        color = Color.Black,
                        modifier = Modifier.background(JK.chrome, CircleShape).padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }

    open?.let { r ->
        Sheet(onDismiss = {
            open = null
            scope.launch { load() }
        }) { FormFillView(request = r) }
    }
}

/** Answer a form, one question per card, and send it once. */
@Composable
fun FormFillView(request: FormRequest) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    val answers = remember { mutableStateMapOf<String, FormAnswer>() }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val missing = request.questions.filter { q ->
        if (!q.isRequired) return@filter false
        when (val a = answers[q.id]) {
            null -> true
            is FormAnswer.text -> a.value.trim().isEmpty()
            else -> false
        }
    }

    suspend fun submit() {
        saving = true
        try {
            val clean = answers.mapValues { (_, value) -> if (value is FormAnswer.text) FormAnswer.text(value.value.trim()) else value }
            APIClient.send<FormRequest, FormAnswersInput>(
                "POST", "/api/form-requests/${seg(request.id)}/answers", FormAnswersInput(answers = clean),
            )
            dismiss()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(leading = { BarButton("Later") { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(request.name, style = JKType.title2.semibold(), color = JK.text)
            request.intro?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.subheadline, color = JK.secondary) }
            request.questions.forEachIndexed { index, q ->
                Column(Modifier.jkCard(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${index + 1}. ${q.label}${if (q.isRequired) "" else " (optional)"}",
                        style = JKType.subheadline.semibold(),
                        color = JK.text,
                    )
                    QuestionInput(q, answers[q.id]) { value ->
                        if (value == null) answers.remove(q.id) else answers[q.id] = value
                    }
                }
            }
            error?.let { ErrorBanner(it) }
            ChromeButton(onClick = { scope.launch { submit() } }, enabled = !saving && missing.isEmpty()) {
                if (saving) ProgressView(tint = Color.Black) else Text("Send to coach")
            }
            if (missing.isNotEmpty()) {
                Text(
                    if (missing.size == 1) "1 question left" else "${missing.size} questions left",
                    style = JKType.caption2,
                    color = JK.tertiary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** One question's control: a 1–5 row, yes/no chips, a choice list, or a text box. */
@Composable
private fun QuestionInput(q: FormQuestion, answer: FormAnswer?, onAnswer: (FormAnswer?) -> Unit) {
    when (q.kind) {
        "scale" -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            (1..5).forEach { n ->
                val on = answer == FormAnswer.number(n)
                val shape = rounded(8.dp)
                Box(
                    Modifier
                        .weight(1f)
                        .clip(shape)
                        .clickable { onAnswer(FormAnswer.number(n)) }
                        .background(if (on) JK.chrome else SolidColor(JK.cardRaised), shape)
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("$n", style = JKType.subheadline.semibold(), color = if (on) Color.Black else JK.text)
                }
            }
        }
        "yesno" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(true, false).forEach { value ->
                Chip(label = if (value) "Yes" else "No", selected = answer == FormAnswer.yes(value)) { onAnswer(FormAnswer.yes(value)) }
            }
        }
        "choice" -> Column {
            q.options.orEmpty().forEach { option ->
                Row(
                    Modifier.fillMaxWidth().clickable { onAnswer(FormAnswer.text(option)) }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(option, style = JKType.subheadline, color = JK.text, modifier = Modifier.weight(1f))
                    CheckCircle(on = answer == FormAnswer.text(option))
                }
            }
        }
        else -> {
            val text = (answer as? FormAnswer.text)?.value ?: ""
            val style = JKType.subheadline.copy(color = JK.text)
            val long = q.kind == "long"
            BasicTextField(
                value = text,
                onValueChange = { onAnswer(if (it.isEmpty()) null else FormAnswer.text(it)) },
                textStyle = style,
                minLines = if (long) 3 else 1,
                maxLines = if (long) 8 else 2,
                cursorBrush = SolidColor(JK.text),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { field ->
                    Box(Modifier.fillMaxWidth().background(JK.cardRaised, rounded(8.dp)).padding(10.dp)) {
                        if (text.isEmpty()) Text("Your answer", style = style, color = JK.tertiary)
                        field()
                    }
                },
            )
        }
    }
}
