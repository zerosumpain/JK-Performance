package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.Business
import com.jkperformance.app.net.Feature
import com.jkperformance.app.net.Plan
import com.jkperformance.app.net.PlanInput
import com.jkperformance.app.net.PlansResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/** The row on Business (and the coach's Account) that opens Plans & prices. */
@Composable
fun PlansPricesLink() {
    Row(
        Modifier.clip(JKShape.card).navLink { PlansEditorView() }.jkSurface(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowGlyph(IconKey.card)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Plans & prices", style = JKType.callout.semibold(), color = JKColors.text)
            Text("Names, prices, sessions and what each plan includes", style = JKType.caption, color = JKColors.textTertiary)
        }
        Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
    }
}

/**
 * The coach's plans: one card per plan (Free included) with prices,
 * credits, features and members. Tap one to edit it; preview the client's
 * walkthrough; or put everything back to the defaults.
 */
@Composable
fun PlansEditorView() {
    val scope = rememberCoroutineScope()
    var reply by remember { mutableStateOf<PlansResponse?>(null) }
    var members by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmReset by remember { mutableStateOf(false) }
    var resetting by remember { mutableStateOf(false) }
    var showPreview by remember { mutableStateOf(false) }

    val load: suspend () -> Unit = {
        try {
            reply = APIClient.get<PlansResponse>("/api/plans")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
        // Members only label the cards: a failure leaves them off.
        runCatching { APIClient.get<Business>("/api/coach/business", mapOf("period" to "month")) }
            .getOrNull()?.plans?.let { list -> members = list.associate { it.id to it.members } }
    }
    LaunchedEffect(Unit) { load() }

    fun reset() {
        scope.launch {
            resetting = true
            try {
                reply = APIClient.send<PlansResponse>("POST", "/api/coach/plans/reset")
                error = null
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                resetting = false
            }
        }
    }

    PushedScreen(spacing = 12.dp, onRefresh = load) {
        ScreenHeader(eyebrow = "Coach", title = "Plans & prices")
        Text("What your clients see and pay. Tap a plan to change it.", style = JKType.caption, color = JKColors.textSecondary)
        Loadable(value = reply, error = error, retry = load) { r ->
            r.plans.forEach { p ->
                PlanSettingsCard(p, members[p.id]) { PlanEditorView(p, r.features) { fresh -> reply = fresh } }
            }
            SecondaryButton(onClick = { showPreview = true }, modifier = Modifier.padding(top = 6.dp)) {
                Text("Preview as a client")
            }
            Text(
                if (resetting) "Resetting…" else "Reset to defaults",
                style = JKType.callout,
                color = if (resetting) JKColors.textTertiary else JKColors.urgent,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(JKShape.control)
                    .clickable(enabled = !resetting) { confirmReset = true }
                    .padding(vertical = 12.dp),
            )
        }
    }

    if (confirmReset) {
        CoachConfirmDialog(
            title = "Reset every plan?",
            action = "Reset to defaults",
            message = "Names, prices, sessions and features all go back to the defaults. Clients see the change straight away.",
            onConfirm = { reset() },
            onDismiss = { confirmReset = false },
        )
    }
    if (showPreview) {
        Sheet(onDismiss = { showPreview = false }) { PlanTourView(preview = true) }
    }
}

@Composable
private fun PlanSettingsCard(p: Plan, members: Int?, destination: @Composable () -> Unit) {
    Column(
        Modifier.clip(JKShape.card).navLink(destination = destination).jkSurface(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(p.name, style = JKType.headline, color = JKColors.text)
            if (p.isFeatured) PopularBadge()
            Box(Modifier.weight(1f))
            Glyph(IconKey.chevron, JKType.caption, JKColors.textTertiary)
        }
        Text(p.detail, style = JKType.caption, color = JKColors.textTertiary)
        if (!p.isFree) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PriceLabel(p.monthlyPence)
                AnnualPriceLine(p.monthlyPence, p.annualPence)
            }
        }
        val facts = buildList {
            if (p.isFree) add("Always free")
            if (p.credits > 0) add(if (p.credits == 1) "1 session a month" else "${p.credits} sessions a month")
            add(if (p.featureIds.size == 1) "1 feature" else "${p.featureIds.size} features")
            if (members != null) add(if (members == 1) "1 member" else "$members members")
        }
        Text(facts.joinToString(" · "), style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** "59" or "59.50" for a price field. */
private fun poundsText(pence: Int): String = if (pence % 100 == 0) "${pence / 100}" else "%d.%02d".format(pence / 100, pence % 100)

/** Pounds typed in a field → pence; null when it isn't a price. */
private fun penceOf(text: String): Int? {
    val value = parseNumber(text.removePrefix("£")) ?: return null
    if (value < 0) return null
    return (value * 100).roundToInt()
}

/**
 * One plan: its words, prices, session credits, Most popular, and which
 * features it includes. Save PUTs the full set; the server's message is
 * shown if it says no (a plan with 1:1 sessions needs credits, say).
 */
@Composable
fun PlanEditorView(plan: Plan, catalogue: List<Feature>, onSaved: (PlansResponse) -> Unit) {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val free = plan.isFree
    var name by remember { mutableStateOf(plan.name) }
    var detail by remember { mutableStateOf(plan.detail) }
    var pitch by remember { mutableStateOf(plan.pitch.orEmpty()) }
    var monthly by remember { mutableStateOf(poundsText(plan.monthlyPence)) }
    var annual by remember { mutableStateOf(poundsText(plan.annualPence)) }
    var credits by remember { mutableIntStateOf(plan.credits) }
    var featured by remember { mutableStateOf(plan.isFeatured) }
    var features by remember { mutableStateOf(plan.featureIds.toSet()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val monthlyPence = if (free) 0 else penceOf(monthly)
    val annualPence = if (free) 0 else penceOf(annual)
    val problem = when {
        name.isBlank() -> "Give the plan a name."
        monthlyPence == null -> "The monthly price isn't a number."
        annualPence == null -> "The annual price isn't a number."
        features.isEmpty() -> "A plan needs at least one feature."
        else -> null
    }

    fun save() {
        if (problem != null || saving) return
        val body = PlanInput(
            name = name.trim(),
            detail = detail.trim(),
            pitch = pitch.trim(),
            monthlyPence = monthlyPence ?: 0,
            annualPence = annualPence ?: 0,
            credits = if (free) 0 else credits,
            featured = !free && featured,
            features = catalogue.map { it.id }.filter { it in features },
        )
        scope.launch {
            saving = true
            try {
                val fresh: PlansResponse = APIClient.send("PUT", "/api/coach/plans/${seg(plan.id)}", body)
                onSaved(fresh)
                nav.pop()
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                error = e.readable
            } finally {
                saving = false
            }
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(plan.name) {
            if (saving) Box(Modifier.padding(horizontal = 12.dp)) { ProgressView(tint = JKColors.text) }
            else BarButton("Save", bold = true, enabled = problem == null) { save() }
        }
        ScrollScreen(spacing = 12.dp, modifier = Modifier.weight(1f)) {
            Label("How clients see it")
            Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                JKField("Name · ${name.length}/30", name, { name = it.take(30) }, prompt = "Foundation")
                JKField("Tagline · ${detail.length}/90", detail, { detail = it.take(90) }, prompt = "One line under the name")
                PitchField(pitch) { pitch = it.take(400) }
            }

            if (free) {
                Text("The free plan is always free.", style = JKType.caption, color = JKColors.textSecondary)
            } else {
                Label("Price")
                Column(Modifier.jkSurface(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        JKField("Monthly (£)", monthly, { monthly = it }, Modifier.weight(1f), prompt = "59", keyboard = KeyboardType.Decimal)
                        JKField("Annual (£)", annual, { annual = it }, Modifier.weight(1f), prompt = "602", keyboard = KeyboardType.Decimal)
                    }
                    monthlyPence?.takeIf { it > 0 }?.let { m ->
                        val twelve = m * 12
                        val save = annualPence?.let { Price.savePercent(m, it) }
                        Text(
                            "12 × monthly is ${Fmt.pounds(twelve)}" + (save?.let { " · saves $it%" } ?: ""),
                            style = JKType.caption, color = JKColors.textTertiary,
                        )
                    }
                    CoachStepper(
                        label = if (credits == 1) "1 session credit a month" else "$credits session credits a month",
                        value = credits, range = 0..31, onValueChange = { credits = it },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Most popular", style = JKType.callout, color = JKColors.text)
                            Text("One plan at a time wears the badge", style = JKType.caption, color = JKColors.textTertiary)
                        }
                        CoachSwitch(featured) { featured = it }
                    }
                }
                Text(
                    "Clients see the new price straight away. Nobody is charged while payments are off; " +
                        "once App Store billing is on, change the price in App Store Connect too.",
                    style = JKType.caption, color = JKColors.textTertiary,
                )
            }

            Label("What's included", trailing = "${features.size} of ${catalogue.size}")
            Column(Modifier.jkSurface(padding = 4.dp)) {
                catalogue.forEach { f ->
                    val on = f.id in features
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FeatureTile(f.id, size = 34.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(f.title, style = JKType.callout.semibold(), color = JKColors.text)
                            Text(f.detail, style = JKType.caption, color = JKColors.textTertiary, maxLines = 2)
                        }
                        CoachSwitch(on) { wanted -> features = if (wanted) features + f.id else features - f.id }
                    }
                }
            }
            problem?.let { Text(it, style = JKType.caption, color = JKColors.textSecondary) }
        }
    }
    // The server's reason (sessions need credits, say), wherever the coach has scrolled to.
    ErrorAlert(error) { error = null }
}

/** The pitch: a few lines, with a counter in the label. */
@Composable
private fun PitchField(text: String, onChange: (String) -> Unit) {
    val style = JKType.callout.copy(color = JKColors.text)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Pitch · ${text.length}/400", style = JKType.caption, color = JKColors.textTertiary)
        BasicTextField(
            value = text,
            onValueChange = onChange,
            textStyle = style,
            cursorBrush = SolidColor(JKColors.text),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Pitch" },
            decorationBox = { field ->
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 96.dp).background(JKColors.raised, JKShape.chip).padding(horizontal = 10.dp, vertical = 8.dp),
                ) {
                    if (text.isEmpty()) Text("Who it's for and what they get", style = style, color = JKColors.textTertiary)
                    field()
                }
            },
        )
    }
}
