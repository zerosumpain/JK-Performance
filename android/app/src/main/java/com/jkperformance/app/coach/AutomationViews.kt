package com.jkperformance.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.UnfoldMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.*
import com.jkperformance.app.net.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

// region Autoflows (Programs › Autoflows)

/**
 * The coach's autoflows: each a list of "on day N, do X" steps that run by
 * themselves, for every new client (`join`) or for clients enrolled by hand.
 */
@Composable
fun AutoflowsTab() {
    var flows by remember { mutableStateOf<List<Autoflow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<AutoflowDraft?>(null) }
    var enrolling by remember { mutableStateOf<Autoflow?>(null) }

    suspend fun load() {
        try {
            val reply: AutoflowsResponse = APIClient.get("/api/autoflows")
            flows = reply.autoflows
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        GhostButton(onClick = { editing = AutoflowDraft() }) {
            Label("New autoflow", systemImage = "plus", style = LocalTextStyle.current)
        }
        Loadable(value = flows, error = error, retry = { load() }) { list ->
            if (list.isEmpty()) {
                EmptyCard(
                    systemName = "bolt",
                    title = "No autoflows yet",
                    detail = "Write your routine once: a welcome message on day 0, the intake form, a check-in on day 7. It then runs for every client.",
                )
            }
            list.forEach { flow ->
                key(flow.id) {
                    AutoflowCard(
                        flow = flow,
                        onEdit = { editing = AutoflowDraft(flow) },
                        onEnrol = { enrolling = flow },
                        onChanged = { load() },
                    )
                }
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    editing?.let { draft ->
        Sheet(onDismiss = { editing = null }) {
            key(draft.id) { AutoflowEditorSheet(draft = draft, onSaved = { load() }) }
        }
    }
    enrolling?.let { flow ->
        Sheet(onDismiss = { enrolling = null }) {
            ClientPickerSheet(
                title = "Start ${flow.name}",
                action = "Start",
                note = "Steps already due (day 0) happen straight away.",
            ) { client ->
                APIClient.send<AutoflowRun, EnrolInput>("POST", "/api/autoflows/${seg(flow.id)}/enrol", EnrolInput(clientId = client.id))
                load()
            }
        }
    }
}

@Composable
private fun AutoflowCard(flow: Autoflow, onEdit: () -> Unit, onEnrol: () -> Unit, onChanged: suspend () -> Unit) {
    var showRuns by remember { mutableStateOf(false) }
    val running = (flow.runs ?: emptyList()).filter { it.stoppedAt == null && it.next != null }

    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            IconTile(systemName = if (flow.trigger == "join") "person.badge.plus" else "bolt", size = 34.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(flow.name, style = JKType.subheadline.semibold(), color = JK.text)
                Text(
                    if (flow.trigger == "join") "Starts when a client joins" else "Starts when you enrol someone",
                    style = JKType.caption2,
                    color = JK.tertiary,
                )
            }
            if (!flow.active) {
                Text(
                    "Paused",
                    style = JKType.system(10, FontWeight.SemiBold),
                    color = JK.secondary,
                    modifier = Modifier.border(1.dp, JK.stroke, CircleShape).padding(horizontal = 7.dp, vertical = 3.dp),
                )
            }
            MenuBox(
                items = listOf(
                    MenuItem("Edit", "pencil", onEdit),
                    MenuItem("Start for a client", "person.badge.plus", onEnrol),
                ),
            ) {
                Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
                    SystemImage("ellipsis", JKType.body, JK.secondary)
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            flow.steps.forEach { step ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Day ${step.day}",
                        style = JKType.system(10, FontWeight.SemiBold),
                        color = JK.secondary,
                        modifier = Modifier.width(46.dp),
                    )
                    Box(Modifier.width(14.dp), contentAlignment = Alignment.Center) {
                        SystemImage(step.icon, JKType.caption2, JK.tertiary)
                    }
                    Text(
                        step.label ?: step.action.replaceFirstChar { it.uppercase() },
                        style = JKType.caption,
                        color = JK.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        val runs = flow.runs
        if (!runs.isNullOrEmpty()) {
            Row(
                Modifier.fillMaxWidth().clickable { showRuns = !showRuns },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val style = JKType.caption.semibold()
                Text(
                    if (running.isEmpty()) "${runs.size} finished" else "${running.size} in progress",
                    style = style,
                    color = JK.secondary,
                    modifier = Modifier.weight(1f),
                )
                SystemImage(if (showRuns) "chevron.up" else "chevron.down", style, JK.secondary)
            }
            AnimatedVisibility(showRuns) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    runs.forEach { run -> key(run.id) { AutoflowRunRow(run = run, onChanged = onChanged) } }
                }
            }
        }
    }
}

/** One client's way through a flow: how far, and what happens next. */
@Composable
fun AutoflowRunRow(run: AutoflowRun, showFlowName: Boolean = false, onChanged: suspend () -> Unit) {
    var confirmStop by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val next = run.next
    val detail = when {
        run.stoppedAt != null -> "Stopped"
        next == null -> "Finished"
        else -> {
            val today = Day.start(Instant.now())
            val whenText = Day.date(next.date)?.let { if (Day.same(it, today)) "today" else Fmt.dayMonth(it) } ?: next.date
            "Next $whenText: ${next.label}"
        }
    }

    suspend fun stop() {
        try {
            APIClient.send<OK>("DELETE", "/api/autoflows/${seg(run.autoflowId)}/runs/${seg(run.id)}")
            onChanged()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(JK.cardRaised.copy(alpha = 0.5f), rounded(10.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(initials = run.client?.displayInitials ?: "?", size = 26.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(
                    if (showFlowName) run.autoflowName ?: "Autoflow" else run.client?.name ?: "Client",
                    style = JKType.caption.semibold(),
                    color = JK.text,
                )
                Text(detail, style = JKType.caption2, color = JK.tertiary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text("${run.stepsDone}/${run.steps}", style = JKType.caption2.monospacedDigit(), color = JK.secondary)
            if (run.stoppedAt == null && run.next != null) {
                SystemImage("stop.circle", JKType.body, JK.secondary, Modifier.clickable { confirmStop = true })
            }
        }
        ThinBar(fraction = if (run.steps == 0) 0.0 else run.stepsDone.toDouble() / run.steps, height = 2.dp)
        error?.let { ErrorBanner(it) }
    }

    if (confirmStop) {
        ConfirmDialog(
            title = "Stop this autoflow for ${run.client?.name ?: "them"}?",
            message = "What already happened stays; nothing more is sent.",
            action = "Stop",
            onConfirm = { scope.launch { stop() } },
            onDismiss = { confirmStop = false },
        )
    }
}

/** An autoflow being written: a new one (`flowId` null) or a copy of one to save back. */
data class AutoflowDraft(
    val id: UUID = UUID.randomUUID(),
    val flowId: String? = null,
    val name: String = "",
    val trigger: String = "join",
    val active: Boolean = true,
    val steps: List<AutoflowStep> = listOf(
        AutoflowStep(id = UUID.randomUUID().toString(), day = 0, action = "message", text = "Welcome aboard, {first}!"),
    ),
) {
    constructor(f: Autoflow) : this(flowId = f.id, name = f.name, trigger = f.trigger, active = f.active, steps = f.steps)

    val input: AutoflowInput
        get() = AutoflowInput(name = name, trigger = trigger, active = active, steps = steps.sortedBy { it.day })
}

@Composable
fun AutoflowEditorSheet(draft: AutoflowDraft, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var edit by remember { mutableStateOf(draft) }
    var forms by remember { mutableStateOf<List<CoachForm>>(emptyList()) }
    var programs by remember { mutableStateOf<List<Program>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    suspend fun loadChoices() {
        try {
            val f: FormsResponse = APIClient.get("/api/forms")
            val p: ProgramsResponse = APIClient.get("/api/programs")
            forms = f.forms
            programs = p.programs
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun save() {
        saving = true
        try {
            val id = edit.flowId
            if (id != null) {
                APIClient.send<Autoflow, AutoflowInput>("PUT", "/api/autoflows/${seg(id)}", edit.input)
            } else {
                APIClient.send<Autoflow, AutoflowInput>("POST", "/api/autoflows", edit.input)
            }
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    suspend fun delete() {
        val id = edit.flowId ?: return
        try {
            APIClient.send<OK>("DELETE", "/api/autoflows/${seg(id)}")
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    /** Adds a step the day after the last one, pre-filled with the first form or program to hand. */
    fun add(action: String) {
        val day = (edit.steps.maxOfOrNull { it.day } ?: -1) + 1
        val step = AutoflowStep(
            id = UUID.randomUUID().toString(),
            day = maxOf(0, day),
            action = action,
            text = if (action == "message") "" else null,
            formId = if (action == "form") forms.firstOrNull()?.id else null,
            programId = if (action == "program") programs.firstOrNull()?.id else null,
        )
        edit = edit.copy(steps = edit.steps + step)
    }

    Column(Modifier.jkScreen()) {
        TopBar(
            title = if (edit.flowId == null) "New autoflow" else "Edit autoflow",
            leading = { BarButton("Cancel") { dismiss() } },
        )
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            JKField(label = "Name", text = edit.name, onTextChange = { edit = edit.copy(name = it) }, prompt = "New client onboarding")
            Segmented(
                options = listOf("join", "manual"),
                selection = edit.trigger,
                onSelectionChange = { edit = edit.copy(trigger = it) },
            ) { if (it == "join") "When a client joins" else "When I start it" }
            JKToggle("Running", isOn = edit.active, onChange = { edit = edit.copy(active = it) }, style = JKType.subheadline)

            Eyebrow(text = "Steps", trailing = "Day 0 = the day it starts")
            edit.steps.forEach { step ->
                key(step.id) {
                    StepEditor(
                        step = step,
                        onStepChange = { changed -> edit = edit.copy(steps = edit.steps.map { if (it.id == step.id) changed else it }) },
                        forms = forms,
                        programs = programs,
                        onRemove = { edit = edit.copy(steps = edit.steps.filter { it.id != step.id }) },
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AddStepButton("Message", "bubble.left") { add("message") }
                AddStepButton("Form", "doc.text") { add("form") }
                AddStepButton("Program", "dumbbell") { add("program") }
            }
            Text(
                "Messages can say {first} for the client's first name. A program goes live on their calendar from the following Monday.",
                style = JKType.caption2,
                color = JK.tertiary,
            )

            error?.let { ErrorBanner(it) }
            ChromeButton(
                onClick = { scope.launch { save() } },
                enabled = !saving && edit.name.isNotBlank() && edit.steps.isNotEmpty(),
            ) {
                if (saving) ProgressView(tint = Color.Black) else Text(if (edit.flowId == null) "Create autoflow" else "Save autoflow")
            }
            if (edit.flowId != null) {
                GhostButton("Delete autoflow", onClick = { confirmDelete = true })
            }
        }
    }
    LaunchedEffect(Unit) { loadChoices() }

    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this autoflow?",
            message = "Clients part-way through stop where they are. Nothing already sent is taken back.",
            action = "Delete",
            onConfirm = { scope.launch { delete() } },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun AddStepButton(title: String, icon: String, onClick: () -> Unit) {
    SmallPillButton(onClick = onClick) {
        Label(title, systemImage = icon, style = LocalTextStyle.current)
    }
}

@Composable
private fun StepEditor(
    step: AutoflowStep,
    onStepChange: (AutoflowStep) -> Unit,
    forms: List<CoachForm>,
    programs: List<Program>,
    onRemove: () -> Unit,
) {
    Column(Modifier.jkCard(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            SystemImage(step.icon, JKType.body, JK.secondary)
            Stepper(
                label = "Day ${step.day}",
                value = step.day,
                range = 0..365,
                onValueChange = { onStepChange(step.copy(day = it)) },
                modifier = Modifier.weight(1f),
            )
            SystemImage("trash", JKType.body, JK.secondary, Modifier.clickable(onClick = onRemove))
        }
        when (step.action) {
            "message" -> MultilineField(
                text = step.text ?: "",
                onTextChange = { onStepChange(step.copy(text = it)) },
                placeholder = "Message",
                lines = 2..6,
                radius = 8,
            )
            "form" -> if (forms.isEmpty()) {
                Text("Make a form first (Forms tab).", style = JKType.caption, color = JK.tertiary)
            } else {
                MenuPicker(
                    options = forms.map { it.id to it.name },
                    selection = step.formId ?: "",
                    onSelect = { onStepChange(step.copy(formId = it)) },
                )
            }
            else -> if (programs.isEmpty()) {
                Text("Make a program first (Programs tab).", style = JKType.caption, color = JK.tertiary)
            } else {
                MenuPicker(
                    options = programs.map { it.id to it.name },
                    selection = step.programId ?: "",
                    onSelect = { onStepChange(step.copy(programId = it)) },
                )
            }
        }
    }
}

// endregion

// region Forms (Programs › Forms)

@Composable
fun FormsTab() {
    var data by remember { mutableStateOf<FormsResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf<FormDraft?>(null) }
    var sending by remember { mutableStateOf<CoachForm?>(null) }
    var inbox by remember { mutableStateOf<List<FormRequest>>(emptyList()) }

    suspend fun load() {
        try {
            data = APIClient.get<FormsResponse>("/api/forms")
            val reply: FormRequestsResponse = APIClient.get("/api/form-requests")
            inbox = reply.requests
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val shape = rounded(12.dp)
        MenuBox(
            items = listOf(MenuItem("Blank form", "doc") { editing = FormDraft() }) +
                (data?.templates ?: emptyList()).map { t -> MenuItem(t.name, "doc.on.doc") { editing = FormDraft(template = t) } },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(JK.card, shape)
                    .border(1.dp, JK.stroke, shape)
                    .padding(vertical = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Label("New form", systemImage = "plus", style = JKType.subheadline.semibold(), color = JK.text)
            }
        }
        if (inbox.isNotEmpty()) {
            Eyebrow(text = "Answers to read", trailing = "${inbox.size}")
            Column(Modifier.jkCard(padding = 2.dp)) {
                inbox.forEach { r ->
                    key(r.id) {
                        FormRequestRow(request = r, showClient = true, modifier = Modifier.navLink { FormResponseView(request = r) })
                    }
                }
            }
        }
        Loadable(value = data, error = error, retry = { load() }) { reply ->
            Eyebrow(text = "Your forms")
            if (reply.forms.isEmpty()) {
                EmptyCard(
                    systemName = "doc.text",
                    title = "No forms yet",
                    detail = "Start from Intake or PAR-Q above, or build your own.",
                )
            }
            reply.forms.forEach { f ->
                key(f.id) {
                    Row(
                        Modifier.clickable { editing = FormDraft(f) }.jkCard(padding = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconTile(systemName = "doc.text", size = 34.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(f.name, style = JKType.subheadline.semibold(), color = JK.text)
                            Text(formLine(f), style = JKType.caption2, color = JK.tertiary)
                        }
                        MenuBox(
                            items = listOf(
                                MenuItem("Send to a client", "paperplane") { sending = f },
                                MenuItem("Edit", "pencil") { editing = FormDraft(f) },
                            ),
                        ) {
                            Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
                                SystemImage("ellipsis", JKType.body, JK.secondary)
                            }
                        }
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { load() }

    editing?.let { draft ->
        Sheet(onDismiss = { editing = null }) {
            key(draft.id) { FormEditorSheet(draft = draft, onSaved = { load() }) }
        }
    }
    sending?.let { form ->
        Sheet(onDismiss = { sending = null }) {
            ClientPickerSheet(
                title = "Send ${form.name}",
                action = "Send",
                note = "They get a notification and find it on their Home screen.",
            ) { client ->
                APIClient.send<FormRequest, ClientIdInput>("POST", "/api/forms/${seg(form.id)}/send", ClientIdInput(clientId = client.id))
                load()
            }
        }
    }
}

private fun formLine(f: CoachForm): String {
    val parts = mutableListOf("${f.questions.size} questions")
    f.sent?.takeIf { it > 0 }?.let { parts += "sent $it×" }
    f.waiting?.takeIf { it > 0 }?.let { parts += "$it not answered" }
    return parts.joinToString(" · ")
}

@Composable
fun FormRequestRow(request: FormRequest, showClient: Boolean = false, modifier: Modifier = Modifier) {
    val status = request.submittedAt?.let { at ->
        val flagged = if (request.isFlagged) {
            "Said yes to ${if (request.flagged?.size == 1) "a health question" else "health questions"} · "
        } else {
            ""
        }
        "${flagged}Answered ${Fmt.relative(at)}${if (request.reviewedAt == null) "" else " · read"}"
    } ?: "Sent ${Fmt.relative(request.sentAt)} · not answered yet"

    Row(
        modifier.fillMaxWidth().padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showClient) {
            Avatar(initials = request.client?.displayInitials ?: "?", size = 30.dp)
        } else {
            IconTile(systemName = "doc.text", size = 30.dp)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (showClient) "${request.client?.name ?: "Client"} · ${request.name}" else request.name,
                style = JKType.subheadline.semibold(),
                color = JK.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                status,
                style = JKType.caption2,
                color = if (request.isFlagged && request.reviewedAt == null) JK.urgent else JK.tertiary,
            )
        }
        if (request.submittedAt != null && request.reviewedAt == null) {
            Dot(if (request.isFlagged) JK.urgent else JK.waiting)
        }
        SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

/** A client's answers, for the coach. Opening it marks it read. */
@Composable
fun FormResponseView(request: FormRequest) {
    var current by remember { mutableStateOf(request) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmWithdraw by remember { mutableStateOf(false) }
    val dismiss = LocalDismiss.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()

    suspend fun markRead() {
        if (current.submittedAt == null || current.reviewedAt != null) return
        try {
            current = APIClient.send<FormRequest>("POST", "/api/form-requests/${seg(current.id)}/review")
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun withdraw() {
        try {
            APIClient.send<OK>("DELETE", "/api/form-requests/${seg(current.id)}")
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(current.name, style = JKType.title2.semibold(), color = JK.text)
                Text(
                    "${current.client?.name ?: "Client"} · sent ${Fmt.dayMonth(current.sentAt)}${if (current.fromAutoflow == true) " by an autoflow" else ""}",
                    style = JKType.caption,
                    color = JK.tertiary,
                )
            }
            error?.let { ErrorBanner(it) }
            if (current.isFlagged) {
                Column(
                    Modifier.jkCard().border(1.dp, JK.urgent.copy(alpha = 0.6f), rounded(JK.corner)),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Label("Answered yes to", systemImage = "exclamationmark.triangle.fill", style = JKType.caption.semibold(), color = JK.urgent)
                    (current.flagged ?: emptyList()).forEach { Text("• $it", style = JKType.caption, color = JK.text) }
                    Text("Talk to them before the next hard session.", style = JKType.caption2, color = JK.tertiary)
                }
            }
            if (current.submittedAt == null) {
                EmptyCard(systemName = "hourglass", title = "Not answered yet", detail = "Sent ${Fmt.relative(current.sentAt)}.")
                GhostButton("Withdraw form", onClick = { confirmWithdraw = true })
            } else {
                current.questions.forEach { q ->
                    val answer = current.answers?.get(q.id)
                    Column(Modifier.jkCard(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(q.label, style = JKType.caption, color = JK.tertiary)
                        Text(
                            answer?.display ?: "–",
                            style = JKType.subheadline.medium(),
                            color = if (q.flag == true && answer == FormAnswer.yes(true)) JK.urgent else JK.text,
                        )
                    }
                }
                current.client?.let { client ->
                    val first = client.name.split(' ').firstOrNull { it.isNotEmpty() } ?: client.name
                    GhostButton(onClick = {
                        nav.push { MessagesThreadView(clientId = client.id, otherName = client.name, subtitle = "Client") }
                    }) {
                        Label("Message $first", systemImage = "bubble.left", style = LocalTextStyle.current)
                    }
                }
            }
        }
    }
    LaunchedEffect(Unit) { markRead() }

    if (confirmWithdraw) {
        ConfirmDialog(
            title = "Withdraw this form?",
            action = "Withdraw",
            onConfirm = { scope.launch { withdraw() } },
            onDismiss = { confirmWithdraw = false },
        )
    }
}

/** A form being written: blank, from a template, or a copy of a saved form (`formId`) to save back. */
data class FormDraft(
    val id: UUID = UUID.randomUUID(),
    val formId: String? = null,
    val name: String = "",
    val intro: String = "",
    val questions: List<FormQuestion> = listOf(FormQuestion(id = "q1", kind = "long", label = "")),
) {
    constructor(template: FormTemplate) : this(name = template.name, intro = template.intro ?: "", questions = template.questions)

    constructor(f: CoachForm) : this(formId = f.id, name = f.name, intro = f.intro ?: "", questions = f.questions)

    val input: FormInput get() = FormInput(name = name, intro = intro, questions = questions)

    /** An id no other question in this form has. */
    fun nextId(): String {
        var n = questions.size + 1
        while (questions.any { it.id == "q$n" }) n += 1
        return "q$n"
    }
}

@Composable
fun FormEditorSheet(draft: FormDraft, onSaved: suspend () -> Unit) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var edit by remember { mutableStateOf(draft) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun move(index: Int, by: Int) {
        val target = index + by
        if (target !in edit.questions.indices) return
        val list = edit.questions.toMutableList()
        list[index] = list[target].also { list[target] = list[index] }
        edit = edit.copy(questions = list)
    }

    suspend fun save() {
        saving = true
        try {
            val id = edit.formId
            if (id != null) {
                APIClient.send<CoachForm, FormInput>("PUT", "/api/forms/${seg(id)}", edit.input)
            } else {
                APIClient.send<CoachForm, FormInput>("POST", "/api/forms", edit.input)
            }
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    suspend fun delete() {
        val id = edit.formId ?: return
        try {
            APIClient.send<OK>("DELETE", "/api/forms/${seg(id)}")
            onSaved()
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(
            title = if (edit.formId == null) "New form" else "Edit form",
            leading = { BarButton("Cancel") { dismiss() } },
        )
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            JKField(label = "Name", text = edit.name, onTextChange = { edit = edit.copy(name = it) }, prompt = "Intake")
            JKField(
                label = "Intro (shown at the top)",
                text = edit.intro,
                onTextChange = { edit = edit.copy(intro = it) },
                prompt = "A few questions before we start",
            )
            Eyebrow(text = "Questions", trailing = "${edit.questions.size}")
            edit.questions.forEachIndexed { index, question ->
                key(question.id) {
                    QuestionEditor(
                        question = question,
                        onQuestionChange = { changed ->
                            edit = edit.copy(questions = edit.questions.toMutableList().also { it[index] = changed })
                        },
                        number = index + 1,
                        onMove = { move(index, it) },
                        onRemove = { edit = edit.copy(questions = edit.questions.toMutableList().also { it.removeAt(index) }) },
                    )
                }
            }
            MenuBox(
                items = FormQuestion.kinds.map { (kind, title) ->
                    MenuItem(title) {
                        val added = FormQuestion(
                            id = edit.nextId(),
                            kind = kind,
                            label = "",
                            options = if (kind == "choice") listOf("Option 1", "Option 2") else null,
                        )
                        edit = edit.copy(questions = edit.questions + added)
                    }
                },
            ) {
                Label(
                    "Add question",
                    systemImage = "plus",
                    style = JKType.caption.semibold(),
                    color = JK.text,
                    modifier = Modifier.border(1.dp, JK.stroke, CircleShape).padding(horizontal = 12.dp, vertical = 7.dp),
                )
            }
            error?.let { ErrorBanner(it) }
            ChromeButton(
                onClick = { scope.launch { save() } },
                enabled = !saving && edit.name.isNotBlank() && edit.questions.isNotEmpty(),
            ) {
                if (saving) ProgressView(tint = Color.Black) else Text(if (edit.formId == null) "Create form" else "Save form")
            }
            if (edit.formId != null) {
                Text("Forms already sent keep the questions they were sent with.", style = JKType.caption2, color = JK.tertiary)
                GhostButton("Delete form", onClick = { confirmDelete = true })
            }
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = "Delete this form?",
            message = "Answers clients already gave stay on their record.",
            action = "Delete",
            onConfirm = { scope.launch { delete() } },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun QuestionEditor(
    question: FormQuestion,
    onQuestionChange: (FormQuestion) -> Unit,
    number: Int,
    onMove: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    Column(Modifier.jkCard(padding = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "$number. ${FormQuestion.kindName(question.kind)}",
                style = JKType.caption.semibold(),
                color = JK.secondary,
                modifier = Modifier.weight(1f),
            )
            SystemImage("arrow.up", JKType.caption, JK.secondary, Modifier.clickable { onMove(-1) })
            SystemImage("arrow.down", JKType.caption, JK.secondary, Modifier.clickable { onMove(1) })
            SystemImage("trash", JKType.caption, JK.secondary, Modifier.clickable(onClick = onRemove))
        }
        JKField(
            label = "Question",
            text = question.label,
            onTextChange = { onQuestionChange(question.copy(label = it)) },
            prompt = "What do you want to achieve?",
        )
        if (question.kind == "choice") {
            ChoicesField(
                options = question.options ?: emptyList(),
                onOptionsChange = { onQuestionChange(question.copy(options = it)) },
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            JKToggle(
                "Required",
                isOn = question.isRequired,
                onChange = { onQuestionChange(question.copy(required = if (it) null else false)) },
                style = JKType.caption,
                modifier = Modifier.weight(1f),
            )
            if (question.kind == "yesno") {
                JKToggle(
                    "Flag a yes",
                    isOn = question.flag == true,
                    onChange = { onQuestionChange(question.copy(flag = if (it) true else null)) },
                    style = JKType.caption,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * The choices of a "choice" question as one comma-separated line. The Swift
 * binding re-joins the parsed list on every read, which works there because
 * the field keeps its own text while focused; here the typed text is kept
 * locally so a trailing ", " survives until the next choice is typed.
 */
@Composable
private fun ChoicesField(options: List<String>, onOptionsChange: (List<String>) -> Unit) {
    var text by remember { mutableStateOf(options.joinToString(", ")) }
    JKField(
        label = "Choices, separated by commas",
        text = text,
        onTextChange = { typed ->
            text = typed
            onOptionsChange(typed.split(",").map { it.trim() }.filter { it.isNotEmpty() })
        },
        prompt = "Yes, No, Not sure",
    )
}

// endregion

// region On a client's page (Feedback tab)

/** Forms sent to this client and the autoflows they're in, with buttons to send or start one. */
@Composable
fun ClientAutomationSection(client: PersonRef) {
    var requests by remember { mutableStateOf<List<FormRequest>?>(null) }
    var runs by remember { mutableStateOf<List<AutoflowRun>>(emptyList()) }
    var forms by remember { mutableStateOf<List<CoachForm>>(emptyList()) }
    var flows by remember { mutableStateOf<List<Autoflow>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            val r: FormRequestsResponse = APIClient.get("/api/form-requests", query = mapOf("clientId" to client.id))
            val a: AutoflowRunsResponse = APIClient.get("/api/coach/clients/${seg(client.id)}/autoflows")
            val f: FormsResponse = APIClient.get("/api/forms")
            val flowsReply: AutoflowsResponse = APIClient.get("/api/autoflows")
            requests = r.requests
            runs = a.runs
            forms = f.forms
            flows = flowsReply.autoflows
            error = null
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }

    suspend fun send(form: CoachForm) {
        try {
            APIClient.send<FormRequest, ClientIdInput>("POST", "/api/forms/${seg(form.id)}/send", ClientIdInput(clientId = client.id))
            load()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    suspend fun enrol(flow: Autoflow) {
        try {
            APIClient.send<AutoflowRun, EnrolInput>("POST", "/api/autoflows/${seg(flow.id)}/enrol", EnrolInput(clientId = client.id))
            load()
        } catch (e: Throwable) {
            error = e.readable
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(text = "Forms", modifier = Modifier.weight(1f))
            MenuBox(
                items = forms.map { f -> MenuItem(f.name) { scope.launch { send(f) } } },
                enabled = forms.isNotEmpty(),
            ) {
                Label(
                    "Send",
                    systemImage = "paperplane",
                    style = JKType.caption.semibold(),
                    color = if (forms.isEmpty()) JK.tertiary else JK.text,
                )
            }
        }
        error?.let { ErrorBanner(it) }
        val sent = requests
        when {
            sent == null -> LoadingCard()
            sent.isEmpty() -> Text("No forms sent yet.", style = JKType.caption, color = JK.tertiary)
            else -> Column(Modifier.jkCard(padding = 2.dp)) {
                sent.forEach { r ->
                    key(r.id) { FormRequestRow(request = r, modifier = Modifier.navLink { FormResponseView(request = r) }) }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Eyebrow(text = "Autoflows", modifier = Modifier.weight(1f))
            // Only flows they aren't already running can be started again.
            val startable = flows.filter { f -> runs.none { it.autoflowId == f.id && it.stoppedAt == null } }
            MenuBox(
                items = startable.map { f -> MenuItem(f.name) { scope.launch { enrol(f) } } },
                enabled = flows.isNotEmpty(),
            ) {
                Label(
                    "Start",
                    systemImage = "bolt",
                    style = JKType.caption.semibold(),
                    color = if (flows.isEmpty()) JK.tertiary else JK.text,
                )
            }
        }
        if (runs.isEmpty()) {
            Text("Not in any autoflow.", style = JKType.caption, color = JK.tertiary)
        }
        runs.forEach { run ->
            key(run.id) { AutoflowRunRow(run = run, showFlowName = true, onChanged = { load() }) }
        }
    }
    LaunchedEffect(client.id) { load() }
}

// endregion

// region Shared: pick a client

@Composable
fun ClientPickerSheet(
    title: String,
    action: String,
    note: String? = null,
    perform: suspend (PersonRef) -> Unit,
) {
    val dismiss = LocalDismiss.current
    val scope = rememberCoroutineScope()
    var clients by remember { mutableStateOf<List<ClientSummary>?>(null) }
    var chosen by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    suspend fun go() {
        val c = clients?.firstOrNull { it.id == chosen } ?: return
        saving = true
        try {
            perform(PersonRef(id = c.id, name = c.name, initials = c.initials))
            dismiss()
        } catch (e: Throwable) {
            error = e.readable
        } finally {
            saving = false
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar(title = title, leading = { BarButton("Cancel") { dismiss() } })
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            note?.let { Text(it, style = JKType.caption, color = JK.tertiary) }
            val list = clients
            if (list != null) {
                Column(Modifier.jkCard(padding = 2.dp)) {
                    list.sortedBy { it.name }.forEach { c ->
                        key(c.id) {
                            Row(
                                Modifier.fillMaxWidth().clickable { chosen = c.id }.padding(10.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(initials = c.displayInitials, size = 28.dp)
                                Text(c.name, style = JKType.subheadline, color = JK.text, modifier = Modifier.weight(1f))
                                CheckCircle(on = chosen == c.id)
                            }
                        }
                    }
                }
            } else {
                LoadingCard()
            }
            error?.let { ErrorBanner(it) }
            ChromeButton(onClick = { scope.launch { go() } }, enabled = !saving && chosen != null) {
                if (saving) ProgressView(tint = Color.Black) else Text(action)
            }
        }
    }
    LaunchedEffect(Unit) {
        try {
            val reply: ClientsResponse = APIClient.get("/api/coach/clients")
            clients = reply.clients
        } catch (e: Throwable) {
            if (!e.isCancellation) error = e.readable
        }
    }
}

// endregion

// region iOS controls (file-private)

/** One entry of an iOS `Menu`: a title and an optional SF Symbol shown trailing, as iOS does. */
private class MenuItem(val title: String, val systemImage: String? = null, val action: () -> Unit)

/** The dark grey of an iOS menu or action sheet. */
private val MenuGround = Color(0.17f, 0.17f, 0.17f)

/** SwiftUI's `Menu { … } label: { … }`: tapping the label opens a dark pop-up list. */
@Composable
private fun MenuBox(
    items: List<MenuItem>,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    label: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        Box(Modifier.clickable(enabled = enabled) { expanded = true }) { label() }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = MenuGround,
            shape = rounded(12.dp),
        ) {
            items.forEach { item ->
                DropdownMenuItem(
                    text = { Text(item.title, style = JKType.body, color = JK.text) },
                    trailingIcon = item.systemImage?.let { name -> @Composable { SystemImage(name, JKType.body, JK.text) } },
                    onClick = {
                        expanded = false
                        item.action()
                    },
                )
            }
        }
    }
}

/**
 * A menu-style `Picker` outside a Form: the chosen option's name with the
 * up-down chevrons, tinted white (`.tint(JK.text)`), opening the options.
 */
@Composable
private fun MenuPicker(options: List<Pair<String, String>>, selection: String, onSelect: (String) -> Unit) {
    MenuBox(items = options.map { (id, name) -> MenuItem(name, if (id == selection) "checkmark" else null) { onSelect(id) } }) {
        Row(
            Modifier.padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(options.firstOrNull { it.first == selection }?.second ?: "", style = JKType.body, color = JK.text)
            Icon(Icons.Rounded.UnfoldMore, contentDescription = null, tint = JK.text, modifier = Modifier.size(16.dp))
        }
    }
}

/** SwiftUI's `Toggle(label, isOn:)` with `.tint(JK.secondary)`: the label leading, the switch trailing. */
@Composable
private fun JKToggle(
    label: String,
    isOn: Boolean,
    onChange: (Boolean) -> Unit,
    style: TextStyle,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = style, color = JK.text, modifier = Modifier.weight(1f))
        Switch(
            checked = isOn,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = JK.secondary,
                checkedBorderColor = Color.Transparent,
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = JK.track,
                uncheckedBorderColor = Color.Transparent,
            ),
        )
    }
}

/** SwiftUI's `Stepper(label, value:, in:)`: the label, then a − | + pair on a raised capsule. */
@Composable
private fun Stepper(label: String, value: Int, range: IntRange, onValueChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = JKType.subheadline.semibold(), color = JK.text, modifier = Modifier.weight(1f))
        Row(
            Modifier.background(JK.cardRaised, rounded(8.dp)).height(32.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StepperHalf(Icons.Rounded.Remove, enabled = value > range.first) { onValueChange(value - 1) }
            Box(Modifier.width(1.dp).height(18.dp).background(JK.stroke))
            StepperHalf(Icons.Rounded.Add, enabled = value < range.last) { onValueChange(value + 1) }
        }
    }
}

@Composable
private fun StepperHalf(icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.width(47.dp).height(32.dp).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) JK.text else JK.tertiary, modifier = Modifier.size(18.dp))
    }
}

/** `TextField(axis: .vertical).lineLimit(lines)` on a raised rounded ground: grows with the text. */
@Composable
private fun MultilineField(text: String, onTextChange: (String) -> Unit, placeholder: String, lines: IntRange, radius: Int) {
    val style = JKType.subheadline.copy(color = JK.text)
    BasicTextField(
        value = text,
        onValueChange = onTextChange,
        textStyle = style,
        minLines = lines.first,
        maxLines = lines.last,
        cursorBrush = SolidColor(JK.text),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { field ->
            Box(Modifier.fillMaxWidth().background(JK.cardRaised, rounded(radius.dp)).padding(10.dp)) {
                if (text.isEmpty()) Text(placeholder, style = style, color = JK.tertiary)
                field()
            }
        },
    )
}

/**
 * SwiftUI's `.confirmationDialog` with one destructive button, as a dark
 * alert: the question, an optional explanation, the red action and Cancel.
 */
@Composable
private fun ConfirmDialog(title: String, action: String, onConfirm: () -> Unit, onDismiss: () -> Unit, message: String? = null) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) { Text(action, style = JKType.body.semibold(), color = SystemRed) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body, color = JK.text) }
        },
        title = { Text(title, style = JKType.headline, color = JK.text) },
        text = message?.let { m -> @Composable { Text(m, style = JKType.footnote, color = JK.secondary) } },
        containerColor = MenuGround,
        shape = rounded(14.dp),
    )
}

/** iOS's dark-mode `systemRed`, the colour of a destructive role. */
private val SystemRed = Color(1.0f, 0.27f, 0.23f)

// endregion
