package com.jkperformance.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.FoodEntry
import com.jkperformance.app.net.FoodInput
import com.jkperformance.app.net.Habit
import com.jkperformance.app.net.HabitDayInput
import com.jkperformance.app.net.HabitHistory
import com.jkperformance.app.net.HabitHistoryEntry
import com.jkperformance.app.net.HabitsResponse
import com.jkperformance.app.net.Macros
import com.jkperformance.app.net.Nutrition
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch

/**
 * Today's habits in detail (atelier-spec.md, Client screens 2): one row per
 * habit with today's value, a stepper for count habits, the last seven days
 * and one consistency figure. On plans with 'nutrition' the Fuel habit holds
 * the nutrition view. Shown in a [Sheet].
 */
@Composable
fun HabitSheet(focus: String? = null) {
    val session = AppSession
    val gate = session.gate
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()
    val toast = rememberToastState()
    var data by remember { mutableStateOf<HabitsResponse?>(null) }
    var history by remember { mutableStateOf<HabitHistory?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var logging by remember { mutableStateOf(false) }
    var scrolled by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            data = APIClient.get("/api/habits", mapOf("date" to Day.today))
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
        if (gate.habits) runCatching { APIClient.get<HabitHistory>("/api/habits/history") }.getOrNull()?.let { history = it }
    }

    suspend fun set(habit: Habit, input: HabitDayInput) {
        try {
            APIClient.send<Habit, HabitDayInput>("PUT", "/api/habits/${seg(habit.id)}/days/${Day.today}", input)
            runCatching { APIClient.get<HabitsResponse>("/api/habits", mapOf("date" to Day.today)) }.getOrNull()?.let { data = it }
            runCatching { APIClient.get<HabitHistory>("/api/habits/history") }.getOrNull()?.let { history = it }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    fun replaceNutrition(fresh: Nutrition) {
        data = data?.copy(nutrition = fresh)
    }

    suspend fun deleteEntry(entry: FoodEntry) {
        try {
            replaceNutrition(APIClient.send("DELETE", "/api/nutrition/entries/${seg(entry.id)}"))
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    /** The Fuel habit: the first protein glyph, on plans with 'nutrition'. */
    fun isFuel(h: Habit, d: HabitsResponse): Boolean =
        gate.nutrition && h.key == IconKey.protein && d.habits.firstOrNull { it.key == IconKey.protein }?.id == h.id

    fun hasTargets(d: HabitsResponse): Boolean = gate.hasMacroTargets ?: (d.nutrition.targets != null)

    LaunchedEffect(Unit) { load() }

    Box(Modifier.jkScreen()) {
        Column(Modifier.fillMaxSize()) {
            TopBar(title = "Habits", leading = {}) { BarButton("Done", bold = true) { dismiss() } }
            Column(
                Modifier.fillMaxSize().verticalScroll(scroll).padding(JKSpace.gutter),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
            ) {
                Loadable(value = data, error = error, retry = { load() }) { d ->
                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                        if (d.dayDone == true) Text("Day done", style = JKType.headline, color = JKColors.accent)
                        d.dayMinimum?.let { minimum ->
                            Text(
                                "A day counts once you hit JK's minimum: $minimum of ${d.habits.size}.",
                                style = JKType.caption, color = JKColors.textSecondary,
                            )
                        }
                        d.consistency?.let { Text(it.label, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary) }
                    }
                    d.habits.forEach { h ->
                        Column(
                            Modifier.onGloballyPositioned { coords ->
                                if (h.id == focus && !scrolled) {
                                    scrolled = true
                                    scope.launch { scroll.animateScrollTo(coords.positionInParent().y.toInt()) }
                                }
                            },
                            verticalArrangement = Arrangement.spacedBy(JKSpace.l),
                        ) {
                            HabitDetailRow(
                                habit = h,
                                history = history?.habits?.firstOrNull { it.id == h.id },
                                onSet = { input -> scope.launch { set(h, input) } },
                                onHealth = { toast.show("Updates from Health Connect") },
                            )
                            if (isFuel(h, d)) {
                                FuelPanel(d.nutrition, hasTargets(d), onLog = { logging = true }) { e -> scope.launch { deleteEntry(e) } }
                            }
                            GroupDivider()
                        }
                    }
                    if (d.habits.isEmpty()) EmptyState("JK will set your habits with you.")
                    if (gate.nutrition && d.habits.none { isFuel(it, d) }) {
                        FuelPanel(d.nutrition, hasTargets(d), onLog = { logging = true }) { e -> scope.launch { deleteEntry(e) } }
                    }
                    val rest = d.rest
                    if (rest != null) {
                        Text(
                            "JK gave you today off" + (rest.reason?.let { ". $it" } ?: "."),
                            style = JKType.callout, color = JKColors.textSecondary,
                        )
                    } else if (gate.messaging) {
                        TextButton("Ask JK for a rest day", onClick = {
                            TabRouter.composerDraft = "Could I take a rest day on "
                            TabRouter.client = TabRouter.Client.jk
                            dismiss()
                        })
                    }
                }
            }
        }
        ToastHost(toast)
    }

    if (logging) {
        Sheet(onDismiss = { logging = false }) {
            FoodLogSheet { input ->
                replaceNutrition(APIClient.send<Nutrition, FoodInput>("POST", "/api/nutrition/entries", input))
            }
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

/**
 * One habit: glyph, name, today's value (a stepper for count habits, a tick
 * for the rest), seven dots and its consistency figure.
 */
@Composable
private fun HabitDetailRow(
    habit: Habit,
    history: HabitHistoryEntry?,
    onSet: (HabitDayInput) -> Unit,
    onHealth: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        val label: @Composable (Modifier) -> Unit = { m ->
            Row(m, horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
                Glyph(habit.key, size = JKSize.iconHabit, tint = if (habit.done) JKColors.accent else JKColors.textSecondary, filled = habit.done)
                Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Text(habit.name, style = JKType.headline, color = JKColors.text)
                    Text(
                        HabitText.value(habit) + if (habit.fromHealth) " · from Health Connect" else "",
                        style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary,
                    )
                }
            }
        }
        if (isAccessibilityFontScale()) {
            label(Modifier)
            HabitControl(habit, onSet, onHealth)
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                label(Modifier.weight(1f))
                HabitControl(habit, onSet, onHealth)
            }
        }
        if (history != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                WeekDots(days = lastSeven(history), modifier = Modifier.widthIn(max = 180.dp).weight(1f, fill = false), showLetters = false)
                Box(Modifier.weight(1f))
                consistency(history)?.let {
                    Text(it, style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                }
            }
        }
    }
}

@Composable
private fun HabitControl(habit: Habit, onSet: (HabitDayInput) -> Unit, onHealth: () -> Unit) {
    when {
        habit.fromHealth -> SmallPill("From Health", onClick = onHealth)
        habit.isCount -> Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            SmallPill(
                icon = IconKey.remove,
                onClick = { onSet(HabitDayInput(value = maxOf(0.0, (habit.value ?: 0.0) - habit.increment), done = null)) },
                enabled = (habit.value ?: 0.0) > 0,
                contentDescription = "Less ${habit.name}",
            )
            SmallPill(
                icon = IconKey.add,
                onClick = { onSet(HabitDayInput(value = (habit.value ?: 0.0) + habit.increment, done = null)) },
                contentDescription = "More ${habit.name}",
            )
        }
        else -> SmallPill(
            if (habit.done) "Done" else "Tick",
            onClick = { onSet(HabitDayInput(value = null, done = !habit.done)) },
            contentDescription = if (habit.done) "Untick ${habit.name}" else "Tick ${habit.name}",
        )
    }
}

private fun lastSeven(h: HabitHistoryEntry): List<WeekDay> =
    h.days.takeLast(7).map { d -> weekDayOf(d.date, done = d.done == true, rest = d.rest == true, future = false, isToday = d.date == Day.today) }

/** "22 of the last 28 days" over the days that were not rest days. */
private fun consistency(h: HabitHistoryEntry): String? {
    val counted = h.days.filter { it.rest != true }
    if (counted.isEmpty()) return null
    return "${counted.count { it.done == true }} of the last ${counted.size} days"
}

/**
 * The nutrition view under the Fuel habit: the kcal ring (only once JK has set
 * targets), three macro bars, today's food and "Log food". Over target is a
 * plain sentence, never red.
 */
@Composable
fun FuelPanel(nutrition: Nutrition, hasTargets: Boolean, onLog: () -> Unit, onDelete: (FoodEntry) -> Unit = {}) {
    Column(Modifier.fillMaxWidth().jkSurface(), verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
        val t = nutrition.targets
        if (hasTargets && t != null) {
            val ring: @Composable () -> Unit = { KcalRing(nutrition, t) }
            val bars: @Composable (Modifier) -> Unit = { m ->
                Column(m, verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                    MacroBar("Protein", nutrition.totals.protein, t.protein)
                    MacroBar("Carbs", nutrition.totals.carbs, t.carbs)
                    MacroBar("Fat", nutrition.totals.fat, t.fat)
                }
            }
            if (isAccessibilityFontScale()) {
                ring()
                bars(Modifier.fillMaxWidth())
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.xl), verticalAlignment = Alignment.CenterVertically) {
                    ring()
                    bars(Modifier.weight(1f))
                }
            }
            if (nutrition.totals.kcal > t.kcal) {
                Text(
                    "Over by ${Fmt.number(nutrition.totals.kcal - t.kcal, digits = 0)} kcal",
                    style = JKType.caption, color = JKColors.textSecondary,
                )
            }
        } else {
            Text("JK will set your targets", style = quoteStyle(inSheet = true), color = JKColors.text)
            Text(
                "${Fmt.number(nutrition.totals.kcal, digits = 0)} kcal · ${Fmt.number(nutrition.totals.protein, digits = 0)} g protein today",
                style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary,
            )
        }
        if (nutrition.entries.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                nutrition.entries.forEach { entry ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.name, style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                        Text("${Fmt.number(entry.kcal, digits = 0)} kcal", style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
                        Box(
                            Modifier
                                .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                                .clickable { onDelete(entry) }
                                .semantics { contentDescription = "Remove ${entry.name}" },
                            contentAlignment = Alignment.Center,
                        ) { Glyph(IconKey.close, size = JKSize.iconSmall, tint = JKColors.textSecondary) }
                    }
                }
            }
        }
        SecondaryButton("Log food", onClick = onLog)
    }
}

@Composable
private fun KcalRing(nutrition: Nutrition, t: Macros) {
    val kcal = Fmt.number(nutrition.totals.kcal, digits = 0)
    val target = Fmt.number(t.kcal, digits = 0)
    Ring(
        fraction = if (t.kcal > 0) minOf(1.0, nutrition.totals.kcal / t.kcal) else 0.0,
        lineWidth = 6.dp,
        modifier = Modifier.size(96.dp).clearAndSetSemantics { contentDescription = "Calories: $kcal of $target kcal" },
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(kcal, style = JKType.headline.monospacedDigit(), color = JKColors.text)
            Text("of $target", style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary)
        }
    }
}

/** One macro: name, value of target, and a measure bar (text colour, not champagne). */
@Composable
private fun MacroBar(name: String, value: Double, target: Double) {
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        Row {
            Text(name, style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.weight(1f))
            Text(
                "${Fmt.number(value, digits = 0)} of ${Fmt.number(target, digits = 0)} g",
                style = JKType.caption.monospacedDigit(), color = JKColors.textSecondary,
            )
        }
        Box(Modifier.fillMaxWidth().height(JKSize.rule).background(JKColors.track)) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(if (target > 0) (value / target).coerceIn(0.0, 1.0).toFloat() else 0f)
                    .background(JKColors.text),
            )
        }
    }
}

/** Quick food log: name, kcal and macros. Shown in a [Sheet]. */
@Composable
fun FoodLogSheet(save: suspend (FoodInput) -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var kcal by remember { mutableStateOf("") }
    var protein by remember { mutableStateOf("") }
    var carbs by remember { mutableStateOf("") }
    var fat by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val valid = name.trim().isNotEmpty() && parseNumber(kcal) != null

    suspend fun submit() {
        saving = true
        try {
            save(
                FoodInput(
                    date = Day.today, name = name.trim(),
                    kcal = parseNumber(kcal) ?: 0.0, protein = parseNumber(protein) ?: 0.0,
                    carbs = parseNumber(carbs) ?: 0.0, fat = parseNumber(fat) ?: 0.0,
                ),
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
        TopBar(title = "Log food", leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(JKSpace.gutter),
            verticalArrangement = Arrangement.spacedBy(JKSpace.m),
        ) {
            JKField(label = "Food", text = name, onTextChange = { name = it }, prompt = "Chicken, rice and greens")
            JKField(label = "Calories (kcal)", text = kcal, onTextChange = { kcal = it }, prompt = "0", keyboard = KeyboardType.Number)
            if (isAccessibilityFontScale()) {
                JKField("Protein (g)", protein, { protein = it }, prompt = "0", keyboard = KeyboardType.Decimal)
                JKField("Carbs (g)", carbs, { carbs = it }, prompt = "0", keyboard = KeyboardType.Decimal)
                JKField("Fat (g)", fat, { fat = it }, prompt = "0", keyboard = KeyboardType.Decimal)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                    JKField("Protein (g)", protein, { protein = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
                    JKField("Carbs (g)", carbs, { carbs = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
                    JKField("Fat (g)", fat, { fat = it }, Modifier.weight(1f), prompt = "0", keyboard = KeyboardType.Decimal)
                }
            }
            error?.let { ErrorBanner(it) }
            PrimaryButton(onClick = { scope.launch { submit() } }, enabled = valid && !saving) {
                if (saving) ProgressView() else Text("Log food")
            }
        }
    }
}
