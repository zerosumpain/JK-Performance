package com.jkperformance.app

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AlsoDue
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.ClientRoute
import com.jkperformance.app.net.CoachLine
import com.jkperformance.app.net.DayState
import com.jkperformance.app.net.FormRequest
import com.jkperformance.app.net.FormRequestsResponse
import com.jkperformance.app.net.Habit
import com.jkperformance.app.net.HabitDayInput
import com.jkperformance.app.net.NextUp
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.TodayPayload
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.launch

/**
 * Today (atelier-spec.md, Client screens 1): one page a day, five blocks in a
 * fixed order, each rendered only when the plan includes it and something is
 * there: the header, the goal, today's habits, the one thing next, and JK's
 * line. Everything comes from GET /api/today.
 */
@Composable
fun TodayView() {
    val session = AppSession
    val gate = session.gate
    val router = TabRouter
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val toast = rememberToastState()
    val accessible = isAccessibilityFontScale()

    var today by remember { mutableStateOf<TodayPayload?>(null) }
    var habits by remember { mutableStateOf<List<Habit>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var showHabits by remember { mutableStateOf(false) }
    var habitFocus by remember { mutableStateOf<String?>(null) }
    var checkIn by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<FormRequest?>(null) }

    suspend fun load(quiet: Boolean = false) {
        try {
            val fresh: TodayPayload = APIClient.get("/api/today")
            today = fresh
            habits = fresh.habits ?: emptyList()
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            if (!quiet) error = e.readable
        }
        if (!quiet) {
            session.refreshMe()
            Reminders.refresh(session.gate, session.me?.preferences)
        }
    }

    suspend fun set(h: Habit, input: HabitDayInput) {
        // Optimistic: show the tick at once, then take the server's word.
        habits = habits.map { local ->
            if (local.id != h.id) return@map local
            var v = local.value
            input.value?.let { v = it }
            val done = input.done ?: if (local.isCount) (v ?: 0.0) >= local.target else local.done
            local.copy(value = v, done = done)
        }
        try {
            val fresh: Habit = APIClient.send("PUT", "/api/habits/${seg(h.id)}/days/${today?.date ?: Day.today}", input)
            habits = habits.map { if (it.id == fresh.id) fresh else it }
            load(quiet = true)
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            habits = habits.map { if (it.id == h.id) h else it }
            actionError = e.readable
        }
    }

    fun tap(h: Habit) {
        if (h.fromHealth) {
            toast.show("Updates from Health Connect")
            return
        }
        if (h.done) {
            val restore = HabitDayInput(value = h.value, done = if (h.isCount) null else true)
            val input = if (h.isCount) HabitDayInput(value = 0.0, done = false) else HabitDayInput(value = null, done = false)
            toast.show("Untick ${h.name}?", action = "Undo") { scope.launch { set(h, restore) } }
            scope.launch { set(h, input) }
        } else {
            val input = if (h.isCount) HabitDayInput(value = (h.value ?: 0.0) + h.increment, done = null)
            else HabitDayInput(value = null, done = true)
            scope.launch { set(h, input) }
        }
    }

    suspend fun openForm(id: String?) {
        try {
            val reply: FormRequestsResponse = APIClient.get("/api/form-requests")
            form = reply.requests.firstOrNull { it.id == id } ?: reply.requests.firstOrNull { it.submittedAt == null }
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            actionError = e.readable
        }
    }

    fun act(next: NextUp) {
        val item = next.item
        when (next.action) {
            "startSession", "viewSession" -> {
                val id = item?.workoutId
                if (id != null) nav.push(ClientRoute.session(id)) else nav.push(ClientRoute.yourWeek(item?.date))
            }
            "join" -> {
                val link = item?.meetingUrl
                if (link != null && runCatching { uriHandler.openUri(link) }.isSuccess) Unit
                else nav.push(ClientRoute.yourWeek(item?.date))
            }
            "checkin" -> checkIn = true
            "form" -> scope.launch { openForm(item?.formRequestId) }
            "membership" -> {
                router.showMembership = true
                router.showAccount = true
            }
            else -> nav.push(ClientRoute.yourWeek(item?.date))
        }
    }

    fun openLine(line: CoachLine) {
        val id = line.letterId
        if (id != null) nav.push(ClientRoute.letter(id)) else router.client = TabRouter.Client.jk
    }

    fun reply(line: CoachLine) {
        line.letterId?.let { router.replyQuote = TabRouter.ReplyQuote(it, line.text) }
        router.client = TabRouter.Client.jk
    }

    LaunchedEffect(Unit) { load() }
    // Back on Today after a session or Your week: re-read.
    var wasCovered by remember { mutableStateOf(false) }
    LaunchedEffect(nav.depth) {
        if (nav.depth > 0) wasCovered = true
        else if (wasCovered) {
            wasCovered = false
            load(quiet = true)
        }
    }

    Box(Modifier.jkScreen()) {
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.fillMaxSize()) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = JKSpace.gutter, vertical = JKSpace.l),
                verticalArrangement = Arrangement.spacedBy(JKSpace.section),
            ) {
                TodayHeader(
                    firstName = today?.firstName ?: session.me?.firstName ?: "there",
                    initials = Fmt.initials(session.me?.name ?: "?"),
                    onAccount = { router.showAccount = true },
                )
                val t = today
                val loadError = error
                when {
                    t != null -> {
                        if (loadError != null) ErrorBanner(loadError)
                        // Goal (plans with 'progress').
                        if (gate.progress) {
                            val goal = t.goal
                            if (goal != null) {
                                GoalLine(
                                    state = if (goal.isReached) GoalLineState.Reached(goal.title)
                                    else GoalLineState.Set(goal.title, goal.fraction.toFloat(), goal.remainingLabel ?: ""),
                                    modifier = Modifier
                                        .clickable(role = Role.Button, onClickLabel = "Open Progress") { router.client = TabRouter.Client.progress },
                                )
                            } else if (t.goalPending == true) {
                                GoalLine(GoalLineState.NotSet)
                            }
                        }
                        // Habits (plans with 'habits').
                        if (gate.habits && habits.isNotEmpty()) {
                            val rest = t.rest != null
                            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
                                HabitsHeader(t, habits) {
                                    habitFocus = null
                                    showHabits = true
                                }
                                if (accessible) {
                                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                        habits.forEach { h -> HabitListRow(h) { tap(h) } }
                                    }
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                                        val shown = habits.take(5)
                                        Row(Modifier.fillMaxWidth().animateContentSize(), verticalAlignment = Alignment.Top) {
                                            shown.forEach { h ->
                                                HabitMark(
                                                    icon = h.key,
                                                    name = h.name,
                                                    state = markState(h, rest),
                                                    value = HabitText.value(h),
                                                    fromHealth = h.fromHealth,
                                                    modifier = Modifier.weight(1f),
                                                    onTap = { tap(h) },
                                                    onLongPress = {
                                                        habitFocus = h.id
                                                        showHabits = true
                                                    },
                                                )
                                            }
                                        }
                                        HabitRule(shown.map { h -> if (rest && !h.done) null else h.fraction.toFloat() })
                                    }
                                }
                                val week = t.week
                                if (week != null && week.size == 7) {
                                    WeekDots(
                                        days = week.map(::weekEntry),
                                        showLetters = !accessible,
                                        onTap = { i -> nav.push(ClientRoute.yourWeek(week[i].date)) },
                                    )
                                }
                            }
                        }
                        // Next.
                        t.next?.let { next ->
                            NextCard(
                                icon = NextText.icon(next.kind),
                                kind = NextText.caption(next.kind),
                                title = next.title,
                                detail = next.detail,
                                action = next.buttonLabel ?: "See your week",
                                onAction = { act(next) },
                                alsoDue = NextText.alsoDue(next.alsoDue),
                            )
                        }
                        // From JK.
                        val line = t.coachLine
                        if (line != null && !CoachLineRule.isStale(line)) {
                            CoachNote(
                                quote = line.text,
                                caption = line.caption ?: "JK",
                                avatarMediaId = session.me?.coach?.avatarMediaId,
                                unread = line.unread == true,
                                onOpen = { openLine(line) },
                                onReply = if (gate.messaging) ({ reply(line) }) else null,
                            )
                        }
                    }
                    loadError != null -> ErrorCard(loadError, retry = { load() })
                    else -> LoadingCard()
                }
            }
        }
        ToastHost(toast)
    }

    if (router.showAccount) {
        Sheet(onDismiss = {
            router.showAccount = false
            scope.launch { load(quiet = true) }
        }) { AccountSheet() }
    }
    if (showHabits) {
        Sheet(onDismiss = {
            showHabits = false
            scope.launch { load(quiet = true) }
        }) { HabitSheet(focus = habitFocus) }
    }
    if (checkIn) {
        Sheet(onDismiss = {
            checkIn = false
            scope.launch { load(quiet = true) }
        }) { CheckInSheet() }
    }
    form?.let { r ->
        Sheet(onDismiss = {
            form = null
            scope.launch { load(quiet = true) }
        }) { FormFillView(request = r) }
    }
    ErrorAlert(actionError) { actionError = null }
}

private fun markState(h: Habit, rest: Boolean): HabitMarkState = when {
    rest && !h.done -> HabitMarkState.Rest
    h.done -> HabitMarkState.Done
    h.fraction > 0 -> HabitMarkState.Partial
    else -> HabitMarkState.Idle
}

/** One day of Today's week dots. */
fun weekEntry(d: DayState): WeekDay =
    weekDayOf(d.date, done = d.done == true, rest = d.rest == true, future = d.future == true, isToday = d.today == true)

/**
 * The visible link to the Habit sheet: "Habits 3 of 5 ›", or "Day done · 4 of 5"
 * with "Day done" in champagne once JK's minimum is met, and one quiet line for
 * a rest day or the morning after a miss.
 */
@Composable
private fun HabitsHeader(t: TodayPayload, habits: List<Habit>, onOpen: () -> Unit) {
    val done = habits.count { it.done }
    val line = when {
        t.rest != null -> "JK gave you today off" + (t.rest?.reason?.let { ". $it" } ?: "")
        t.missedYesterday == true && t.dayDone != true -> "Yesterday slipped. Today keeps it going."
        else -> null
    }
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = JKSize.touchTarget)
            .clickable(role = Role.Button, onClickLabel = "Open today's habits", onClick = onOpen),
        verticalArrangement = Arrangement.spacedBy(JKSpace.xs, Alignment.CenterVertically),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            if (t.dayDone == true) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = JKColors.accent)) { append("Day done") }
                        append(" · $done of ${habits.size}")
                    },
                    style = JKType.headline.monospacedDigit(),
                    color = JKColors.text,
                )
            } else {
                Text("Habits", style = JKType.headline, color = JKColors.text, modifier = Modifier.semantics { heading() })
                Text("$done of ${habits.size}", style = JKType.callout.monospacedDigit(), color = JKColors.textSecondary)
            }
            Glyph(IconKey.chevron, size = JKSize.iconSmall, tint = JKColors.textSecondary)
        }
        if (line != null) Text(line, style = JKType.caption, color = JKColors.textSecondary)
    }
}

/** At font scale 1.5 and above: glyph, label, value, with the rule segment as a leading bar. */
@Composable
private fun HabitListRow(h: Habit, onTap: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .sizeIn(minHeight = JKSize.habitMarkMax)
            .clickable(onClick = onTap)
            .clearAndSetSemantics {
                contentDescription = h.name
                stateDescription = HabitText.value(h)
                role = Role.Button
            },
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(JKSize.rule).fillMaxHeight().background(if (h.done) JKColors.accent else JKColors.track))
        Glyph(h.key, size = JKSize.iconHabit, tint = if (h.done) JKColors.accent else JKColors.textSecondary, filled = h.done)
        Column(Modifier.weight(1f).padding(vertical = JKSpace.s), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(h.name, style = JKType.body, color = JKColors.text)
            Text(HabitText.value(h), style = JKType.caption, color = JKColors.textSecondary)
        }
    }
}

/** "Sunday 22 November", "Evening, Sam" in sans display Light, and the 36dp avatar that opens the Account sheet. */
@Composable
fun TodayHeader(firstName: String, initials: String, onAccount: () -> Unit) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(Fmt.fullDay(LocalDate.now(Day.zone)), style = JKType.caption, color = JKColors.textSecondary)
            Text(
                "${Fmt.greeting()}, $firstName",
                style = JKType.display,
                color = JKColors.text,
                modifier = Modifier.semantics { heading() },
            )
        }
        Box(
            Modifier
                .sizeIn(minWidth = JKSize.touchTarget, minHeight = JKSize.touchTarget)
                .clickable(role = Role.Button, onClick = onAccount)
                .semantics { contentDescription = "Account" },
            contentAlignment = Alignment.Center,
        ) {
            Avatar(initials = initials, size = JKSize.avatar)
        }
    }
}

/** Words for a habit's value. */
object HabitText {
    fun value(h: Habit): String {
        val v = h.value
        if (h.healthKind == "sleep" && v != null) return "${Fmt.minutes(v * 60)} of ${Fmt.number(h.target)} h"
        if (h.isCount) {
            val unit = if (h.unit.isEmpty()) "" else " ${h.unit}"
            return "${Fmt.number(v ?: 0.0)} of ${Fmt.number(h.target)}$unit"
        }
        return if (h.done) "Done" else "Not yet"
    }
}

/** The Next card's glyph and caption by kind. */
object NextText {
    fun icon(kind: String): IconKey = when (kind) {
        "session", "workout" -> IconKey.workout
        "videoCall" -> IconKey.video
        "checkin" -> IconKey.checkIn
        "form" -> IconKey.form
        "booking" -> IconKey.oneToOne
        "rest" -> IconKey.rest
        "membership" -> IconKey.jk
        else -> IconKey.week
    }

    fun caption(kind: String): String = when (kind) {
        "session" -> "Next"
        "videoCall" -> "Video call"
        "checkin" -> "Check-in"
        "form" -> "From JK"
        "workout" -> "Later today"
        "booking" -> "Booked"
        "rest" -> "Today"
        "membership" -> "Coaching"
        else -> "Next"
    }

    fun alsoDue(list: List<AlsoDue>?): String? {
        val labels = (list ?: emptyList()).mapNotNull { it.label ?: if (it.kind == "checkin") "Check-in" else null }
        return if (labels.isEmpty()) null else "Also due: " + labels.joinToString(", ")
    }
}

/**
 * Nothing JK said more than one rhythm ago is shown as if it were current:
 * the line hides after the plan's rhythm plus three days. The server already
 * drops older lines; this keeps a cached payload honest too.
 */
object CoachLineRule {
    fun isStale(line: CoachLine, now: Instant = Instant.now()): Boolean {
        val at = line.at ?: return false
        val days = (line.staleAfterDays ?: 10).toLong()
        return Duration.between(at, now) > Duration.ofDays(days)
    }
}
