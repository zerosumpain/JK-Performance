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
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

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
            Text(request.name, style = JKType.display, color = JKColors.text)
            request.intro?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.callout, color = JKColors.textSecondary) }
            request.questions.forEachIndexed { index, q ->
                Column(Modifier.jkSurface(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${index + 1}. ${q.label}${if (q.isRequired) "" else " (optional)"}",
                        style = JKType.callout.semibold(),
                        color = JKColors.text,
                    )
                    QuestionInput(q, answers[q.id]) { value ->
                        if (value == null) answers.remove(q.id) else answers[q.id] = value
                    }
                }
            }
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { submit() } }, enabled = !saving && missing.isEmpty()) {
                if (saving) ProgressView() else Text("Send to JK")
            }
            if (missing.isNotEmpty()) {
                Text(
                    if (missing.size == 1) "1 question left" else "${missing.size} questions left",
                    style = JKType.caption,
                    color = JKColors.textTertiary,
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
                val shape = JKShape.chip
                Box(
                    Modifier
                        .weight(1f)
                        .clip(shape)
                        .clickable { onAnswer(FormAnswer.number(n)) }
                        .background(if (on) SolidColor(JKColors.accentControl) else SolidColor(JKColors.raised), shape)
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("$n", style = JKType.callout.semibold(), color = if (on) JKColors.primaryLabel else JKColors.text)
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
                    Text(option, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                    CheckCircle(on = answer == FormAnswer.text(option))
                }
            }
        }
        else -> {
            val text = (answer as? FormAnswer.text)?.value ?: ""
            val style = JKType.callout.copy(color = JKColors.text)
            val long = q.kind == "long"
            BasicTextField(
                value = text,
                onValueChange = { onAnswer(if (it.isEmpty()) null else FormAnswer.text(it)) },
                textStyle = style,
                minLines = if (long) 3 else 1,
                maxLines = if (long) 8 else 2,
                cursorBrush = SolidColor(JKColors.text),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { field ->
                    Box(Modifier.fillMaxWidth().background(JKColors.raised, JKShape.chip).padding(10.dp)) {
                        if (text.isEmpty()) Text("Your answer", style = style, color = JKColors.textTertiary)
                        field()
                    }
                },
            )
        }
    }
}
