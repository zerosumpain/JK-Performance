package com.jkperformance.app

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.Answers
import com.jkperformance.app.design.ChoiceCard
import com.jkperformance.app.design.Choice
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.FeatureRow
import com.jkperformance.app.design.GhostButton
import com.jkperformance.app.design.IconTileVector
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.LoadingCard
import com.jkperformance.app.design.ErrorCard
import com.jkperformance.app.design.Sheet
import com.jkperformance.app.design.StepScaffold
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.rememberReduceMotion
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Me
import com.jkperformance.app.net.OnboardingInput
import com.jkperformance.app.net.PlansResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.launch

/** The first-run steps, in order. Welcome sits outside the progress track. */
private enum class OnboardingStep { welcome, goals, experience, week, notes, notifications, plans }

private const val INJURIES_MAX = 500

/**
 * A new client's first run (`me.onboarded == false`), full screen in place of
 * the tabs: a welcome, five short questions, notifications and the coaching
 * plans. Every step can be skipped and Back keeps the answers. Finishing PUTs
 * /api/me/onboarding and puts the returned Me in the session, which swaps the
 * root to the tabs. Two failed saves offer "Continue anyway" (tabs for this
 * launch only), so nobody is ever stuck here.
 */
@Composable
fun OnboardingFlow() {
    val session = AppSession
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()

    var step by remember { mutableStateOf(OnboardingStep.welcome) }
    var forward by remember { mutableStateOf(true) }
    val goals = remember { mutableStateListOf<String>() }
    var experience by remember { mutableStateOf<String?>(null) }
    var days by remember { mutableStateOf<Int?>(null) }
    var time by remember { mutableStateOf<String?>(null) }
    var injuries by remember { mutableStateOf("") }

    var plans by remember { mutableStateOf<PlansResponse?>(null) }
    var plansError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }
    var failures by remember { mutableIntStateOf(0) }
    var showTour by remember { mutableStateOf(false) }

    suspend fun loadPlans() {
        try {
            plans = APIClient.get<PlansResponse>("/api/plans")
            plansError = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            plansError = e.readable
        }
    }
    LaunchedEffect(Unit) { loadPlans() }

    fun go(to: OnboardingStep) {
        forward = to.ordinal > step.ordinal
        saveError = null
        step = to
    }
    fun next() = go(OnboardingStep.entries[minOf(step.ordinal + 1, OnboardingStep.entries.lastIndex)])
    fun back() { if (step.ordinal > 0) go(OnboardingStep.entries[step.ordinal - 1]) }

    fun finish(withAnswers: Boolean) {
        if (saving) return
        val body = if (!withAnswers) OnboardingInput(done = true) else OnboardingInput(
            goals = Answers.goals.map { it.id }.filter { it in goals },
            experience = experience,
            daysPerWeek = days,
            preferredTime = time,
            injuries = injuries.trim().ifEmpty { null },
            done = true,
        )
        scope.launch {
            saving = true
            saveError = null
            try {
                val fresh: Me = APIClient.send("PUT", "/api/me/onboarding", body)
                session.update(fresh)
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                failures += 1
                saveError = e.readable
            } finally {
                saving = false
            }
        }
    }

    BackHandler(enabled = step != OnboardingStep.welcome && !saving) { back() }

    val firstName = session.me?.firstName ?: "there"
    val coachName = session.me?.coach?.name
    val total = OnboardingStep.entries.size - 1
    val position = step.ordinal - 1
    // A second failure offers a way past, for this launch only.
    val escape: Pair<String, () -> Unit>? =
        if (failures >= 2 && saveError != null) "Continue anyway" to { session.onboardingDeferred = true } else null

    AnimatedContent(
        targetState = step,
        transitionSpec = {
            if (reduceMotion) {
                ContentTransform(EnterTransition.None, ExitTransition.None)
            } else {
                val dir = if (forward) 1 else -1
                (slideInHorizontally(tween(280)) { it * dir / 3 } + fadeIn(tween(280)))
                    .togetherWith(slideOutHorizontally(tween(280)) { -it * dir / 3 } + fadeOut(tween(200)))
            }
        },
        label = "onboarding",
        modifier = Modifier.fillMaxSize().background(JK.bg).systemBarsPadding().imePadding(),
    ) { current ->
        when (current) {
            OnboardingStep.welcome -> StepScaffold(
                title = "Welcome, $firstName",
                subtitle = "A few quick questions so ${coachName ?: "your coach"} can build your plan. About a minute.",
                primary = "Let's start",
                onPrimary = { next() },
                busy = saving,
                secondary = escape?.first ?: "Skip for now",
                onSecondary = escape?.second ?: { finish(withAnswers = false) },
                message = saveError,
                header = {
                    Box(
                        Modifier.padding(top = 24.dp, bottom = 8.dp).size(64.dp).border(1.dp, JK.secondary, rounded(14.dp)),
                        contentAlignment = Alignment.Center,
                    ) { Text("JK", style = JKType.title2.semibold(), color = JK.text) }
                },
            ) {
                Column(Modifier.jkCard(padding = 4.dp)) {
                    listOf(
                        "Tell us about you" to "Your goals, experience and week",
                        "Your coach writes your programme" to "Built around your answers",
                        "Train, log and check in" to "Everything in one place",
                    ).forEachIndexed { i, (title, detail) ->
                        NumberedRow(i + 1, title, detail)
                    }
                }
            }

            OnboardingStep.goals -> StepScaffold(
                title = "What are you training for?",
                subtitle = "Pick as many as you like.",
                primary = "Continue",
                onPrimary = { next() },
                step = position, count = total,
                onBack = { back() },
                onSkip = { goals.clear(); next() },
            ) {
                ChoiceGrid(Answers.goals, isOn = { it in goals }, multi = true) { id ->
                    if (id in goals) goals.remove(id) else goals.add(id)
                }
            }

            OnboardingStep.experience -> StepScaffold(
                title = "How much training have you done?",
                subtitle = "So the first weeks start at the right level.",
                primary = "Continue",
                onPrimary = { next() },
                step = position, count = total,
                onBack = { back() },
                onSkip = { experience = null; next() },
            ) {
                Answers.experience.forEach { c ->
                    ChoiceCard(
                        title = c.title, detail = c.detail, icon = c.icon,
                        selected = experience == c.id,
                        onClick = { experience = if (experience == c.id) null else c.id },
                    )
                }
            }

            OnboardingStep.week -> StepScaffold(
                title = "Your week",
                subtitle = "So your programme fits the time you have.",
                primary = "Continue",
                onPrimary = { next() },
                step = position, count = total,
                onBack = { back() },
                onSkip = { days = null; time = null; next() },
            ) {
                DaysPicker(days) { days = it }
                Spacer(Modifier.size(4.dp))
                Eyebrow("When do you usually train?")
                ChoiceGrid(Answers.times, isOn = { it == time }, multi = false) { id -> time = if (time == id) null else id }
            }

            OnboardingStep.notes -> StepScaffold(
                title = "Anything to know?",
                subtitle = "Injuries, conditions, or anything else your coach should know.",
                primary = "Continue",
                onPrimary = { next() },
                step = position, count = total,
                onBack = { back() },
                onSkip = { injuries = ""; next() },
            ) {
                NotesField(injuries) { injuries = it.take(INJURIES_MAX) }
                Text(
                    "Optional. Only your coach sees this.",
                    style = JKType.caption, color = JK.tertiary,
                )
            }

            OnboardingStep.notifications -> {
                val alreadyOn = Reminders.enabled
                StepScaffold(
                    title = "Stay in the loop",
                    subtitle = "A nudge when it matters, and nothing else.",
                    primary = if (alreadyOn) "Continue" else "Turn on notifications",
                    onPrimary = {
                        if (alreadyOn) next() else scope.launch {
                            Reminders.enable()
                            next()
                        }
                    },
                    step = position, count = total,
                    onBack = { back() },
                    onSkip = { next() },
                    secondary = if (alreadyOn) null else "Not now",
                    onSecondary = { next() },
                ) {
                    Column(Modifier.jkCard(padding = 4.dp)) {
                        ReasonRow(Icons.Outlined.ChatBubbleOutline, "Coach replies", "When ${coachName ?: "your coach"} answers a message")
                        ReasonRow(Icons.Outlined.CalendarToday, "Session reminders", "An hour before each session")
                        ReasonRow(Icons.Outlined.Description, "Your weekly report", "When your feedback and next week's plan are ready")
                    }
                    if (alreadyOn) Text("Notifications are on.", style = JKType.caption, color = JK.tertiary)
                }
            }

            OnboardingStep.plans -> {
                val membership = session.me?.membership
                val onPlan = membership?.isActive == true
                StepScaffold(
                    title = if (onPlan) "You're on ${membership?.displayName}" else "Here's what coaching includes",
                    subtitle = if (onPlan) "Here's what your plan includes." else "Start free and look round. You can choose a plan any time.",
                    primary = if (onPlan) "Finish" else "Start with Free",
                    onPrimary = { finish(withAnswers = true) },
                    step = position, count = total,
                    onBack = { back() },
                    busy = saving,
                    message = saveError,
                    secondary = escape?.first,
                    onSecondary = escape?.second,
                ) {
                    val reply = plans
                    when {
                        reply == null && plansError != null -> ErrorCard(plansError ?: "", retry = { loadPlans() })
                        reply == null -> LoadingCard()
                        onPlan -> {
                            val mine = reply.plans.firstOrNull { it.id == membership?.plan }
                            Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                mine?.featureIds.orEmpty().forEach { id ->
                                    val f = reply.features.firstOrNull { it.id == id }
                                    FeatureRow(id, f?.title ?: id, f?.detail)
                                }
                            }
                        }
                        else -> {
                            reply.plans.filter { !it.isFree }.forEach { p -> PlanSummaryCard(p, compact = true) }
                            GhostButton("Take the tour", onClick = { showTour = true })
                        }
                    }
                }
            }
        }
    }

    if (showTour) {
        Sheet(onDismiss = { showTour = false }) { PlanTourView() }
    }
}

/** "1  Tell us about you": a numbered circle and two lines. */
@Composable
private fun NumberedRow(number: Int, title: String, detail: String) {
    Row(
        Modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(30.dp).border(1.dp, JK.secondary, CircleShape), contentAlignment = Alignment.Center) {
            Text("$number", style = JKType.subheadline.semibold(), color = JK.text)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            Text(detail, style = JKType.caption, color = JK.tertiary)
        }
    }
}

@Composable
private fun ReasonRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, detail: String) {
    Row(
        Modifier.fillMaxWidth().padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTileVector(icon, size = 34.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            Text(detail, style = JKType.caption, color = JK.tertiary)
        }
    }
}

/** Choices two to a row, icon above the words. */
@Composable
private fun ChoiceGrid(choices: List<Choice>, isOn: (String) -> Boolean, multi: Boolean, onTap: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        choices.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { c ->
                    ChoiceCard(
                        title = c.title, icon = c.icon, selected = isOn(c.id), multi = multi, stacked = true,
                        onClick = { onTap(c.id) }, modifier = Modifier.weight(1f),
                    )
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** "How many days a week can you train?": the number big, and seven tappable day pills. */
@Composable
private fun DaysPicker(days: Int?, onChange: (Int?) -> Unit) {
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("How many days a week can you train?", style = JKType.subheadline.semibold(), color = JK.text)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(days?.toString() ?: "–", style = JKType.largeTitle.semibold(), color = if (days == null) JK.tertiary else JK.text)
            Text(
                when (days) { null -> "Tap a number"; 1 -> "day a week"; else -> "days a week" },
                style = JKType.subheadline, color = JK.secondary, modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            (1..7).forEach { n ->
                val on = days == n
                val shape = rounded(10.dp)
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp)
                        .clip(shape)
                        .selectable(selected = on, role = Role.RadioButton) { onChange(if (on) null else n) }
                        .background(if (on) JK.chrome else SolidColor(JK.cardRaised), shape)
                        .border(1.dp, JK.stroke, shape)
                        .semantics { contentDescription = if (n == 1) "1 day" else "$n days" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("$n", style = JKType.headline, color = if (on) Color.Black else JK.text)
                }
            }
        }
    }
}

/** A multi-line note with a character counter. */
@Composable
private fun NotesField(text: String, onChange: (String) -> Unit) {
    val style = JKType.body.copy(color = JK.text)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicTextField(
            value = text,
            onValueChange = onChange,
            textStyle = style,
            cursorBrush = SolidColor(JK.text),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Anything your coach should know" },
            decorationBox = { field ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 160.dp)
                        .background(JK.card, rounded(JK.corner))
                        .border(1.dp, JK.stroke, rounded(JK.corner))
                        .padding(14.dp),
                ) {
                    if (text.isEmpty()) Text("For example: a sore left knee, asthma, or a race in March", style = style, color = JK.tertiary)
                    field()
                }
            },
        )
        Text(
            "${text.length} / $INJURIES_MAX",
            style = JKType.caption2, color = JK.tertiary, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth(),
        )
    }
}
