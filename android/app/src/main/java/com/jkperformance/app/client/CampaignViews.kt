package com.jkperformance.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.APIError
import com.jkperformance.app.net.AcceptResult
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.CampaignActivity
import com.jkperformance.app.net.CampaignDetail
import com.jkperformance.app.net.CampaignKit
import com.jkperformance.app.net.CampaignPhase
import com.jkperformance.app.net.CampaignText
import com.jkperformance.app.net.CampaignTick
import com.jkperformance.app.net.CampaignTickResult
import com.jkperformance.app.net.GuideRef
import com.jkperformance.app.net.Invitation
import com.jkperformance.app.net.Links
import com.jkperformance.app.net.MyCampaigns
import com.jkperformance.app.net.MyEnrolment
import com.jkperformance.app.net.OkResult
import com.jkperformance.app.net.StartOnInput
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import com.jkperformance.app.net.seg
import kotlinx.coroutines.launch

// Campaigns, the client side (docs/design/desk-v2.md F13 "Client experience";
// docs/api/wp4-campaigns.md). Today shows an invitation card (dates, fee, kit
// with expected spend, Accept / Not this time) and, once accepted, a campaign
// card (day N of M, today's activities with ticks, Read guide). The detail has
// the phases, every activity, and the kit list with bought ticks and spend.

/** Campaign calls, shared by the cards and the detail. */
private object Campaigns {
    suspend fun mine(): MyCampaigns = APIClient.get("/api/campaigns/mine")

    suspend fun detail(id: String): CampaignDetail = APIClient.get("/api/campaigns/mine/${seg(id)}")

    suspend fun accept(id: String): MyEnrolment =
        APIClient.send<AcceptResult, StartOnInput>("POST", "/api/campaigns/mine/${seg(id)}/accept", StartOnInput()).enrolment

    suspend fun decline(id: String) {
        APIClient.send<OkResult>("POST", "/api/campaigns/mine/${seg(id)}/decline")
    }

    suspend fun tick(enrolmentId: String, itemId: String, done: Boolean, spentPence: Int? = null): CampaignTickResult =
        APIClient.send("POST", "/api/campaigns/mine/${seg(enrolmentId)}/items/${seg(itemId)}", CampaignTick(done, spentPence))
}

/**
 * The campaign cards on Today (the Act root): open invitations first, then
 * active or paused enrolments. Nothing at all when there are none, and
 * nothing on a server without campaigns (a 404 is quiet).
 */
@Composable
fun CampaignSection(refreshKey: Int = 0) {
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var mine by remember { mutableStateOf<MyCampaigns?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        mine = try {
            Campaigns.mine()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            mine
        }
    }
    // The host bumps refreshKey on each load (and on coming back from the detail).
    LaunchedEffect(refreshKey) { load() }

    val m = mine ?: return
    val live = m.enrolments.filter { it.status == "active" || it.status == "paused" }
    if (m.invitations.isEmpty() && live.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.l)) {
        m.invitations.forEach { inv ->
            InvitationCard(
                inv,
                onAccept = {
                    scope.launch {
                        try {
                            Campaigns.accept(inv.enrolmentId)
                            load()
                        } catch (e: Exception) {
                            if (e.isCancellation) throw e
                            actionError = e.readable
                            load()
                        }
                    }
                },
                onDecline = {
                    scope.launch {
                        try {
                            Campaigns.decline(inv.enrolmentId)
                            load()
                        } catch (e: Exception) {
                            if (e.isCancellation) throw e
                            actionError = e.readable
                        }
                    }
                },
            )
        }
        live.forEach { e ->
            CampaignCard(
                e,
                onOpen = { nav.push { CampaignDetailView(e.id) } },
                onTick = { a, done ->
                    scope.launch {
                        try {
                            Campaigns.tick(e.id, a.id, done)
                            load()
                        } catch (err: Exception) {
                            if (err.isCancellation) throw err
                            actionError = err.readable
                        }
                    }
                },
                onGuide = { a -> openGuide(nav, a.title, a.guide) },
            )
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

private fun openGuide(nav: NavStack, title: String, guide: GuideRef?) {
    val g = guide ?: return
    val id = g.id
    val blocks = g.blocks
    when {
        id != null -> nav.push { CoachGuideView(id, fallbackTitle = g.title) }
        !blocks.isNullOrEmpty() -> nav.push { InlineGuideView(title, blocks) }
    }
}

/** "1 Nov – 23 Jan", or "Starts when you accept" for a rolling campaign. */
private fun dateRange(inv: Invitation): String {
    val c = inv.campaign
    return if (c.startMode == "rolling" || c.startsOn == null) "Starts the day you accept"
    else listOfNotNull(Fmt.dayMonth(c.startsOn), c.endsOn?.let { Fmt.dayMonth(it) }).joinToString(" – ")
}

// MARK: - Invitation

/**
 * Before committing: name, dates, length, fee (after any discount), places,
 * the required kit line by line with prices, the optional total, the expected
 * spend, JK's welcome line, then Accept / Not this time.
 */
@Composable
fun InvitationCard(inv: Invitation, onAccept: () -> Unit, onDecline: () -> Unit) {
    var busy by remember(inv.enrolmentId, inv.status) { mutableStateOf(false) }
    var confirmDecline by remember { mutableStateOf(false) }
    // With no required kit, the optional list is all there is: show it.
    var showOptional by remember { mutableStateOf(inv.kit.required.isEmpty()) }
    val c = inv.campaign

    ParCard(Modifier.fillMaxWidth(), padding = JKSpace.xl, spacing = JKSpace.l) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(JKSize.setCircle).background(JKColors.raised, CircleShape), contentAlignment = Alignment.Center) {
                Glyph(IconKey.campaign, size = JKSize.iconInline, tint = JKColors.text)
            }
            ParLabel(
                if (inv.waitlisted) "On the waitlist" else "An invitation from JK",
                modifier = Modifier.weight(1f),
                annotation = inv.respondBy?.takeIf { !inv.waitlisted }?.let { "reply by ${Fmt.dayMonth(it)}" },
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(c.name, style = JKType.parQuote, color = JKColors.text, modifier = Modifier.semantics { heading() })
            c.tagline?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.parBody, color = JKColors.textSecondary) }
        }

        // The facts, in three columns.
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
            Fact("When", dateRange(inv), CampaignText.length(c.lengthDays), Modifier.weight(1.3f))
            VRule()
            Fact(
                "Fee",
                if (inv.feeDuePence == 0) "No fee" else Fmt.pounds(inv.feeDuePence),
                if (inv.discountPence > 0) "${Fmt.pounds(inv.discountPence)} off" else null,
                Modifier.weight(1f),
            )
            VRule()
            Fact("Places", inv.placesLeft?.let { if (it <= 0) "Full" else "$it left" } ?: "Open", if (inv.placesLeft != null && inv.placesLeft!! <= 0) "waitlist" else null, Modifier.weight(1f))
        }

        // The kit.
        if (inv.kit.required.isNotEmpty() || inv.kit.optional.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                ParLabel(if (inv.kit.required.isEmpty()) "Kit, if you want it" else "Kit you'll need", annotation = if (inv.kit.requiredPence > 0) Fmt.pounds(inv.kit.requiredPence) else null)
                inv.kit.required.forEach { KitLineRow(it.name, it.estPence) }
                if (inv.kit.optional.isNotEmpty()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = JKSpace.xxxl)
                            .clickable(role = Role.Button) { showOptional = !showOptional }
                            .semantics { stateDescription = if (showOptional) "Shown" else "Hidden" },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
                    ) {
                        Text(
                            "Optional extras · ${Fmt.pounds(inv.kit.optionalPence)}",
                            style = JKType.caption, color = JKColors.textSecondary, modifier = Modifier.weight(1f),
                        )
                        Glyph(if (showOptional) IconKey.collapse else IconKey.expand, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                    }
                    AnimatedVisibility(showOptional) {
                        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                            inv.kit.optional.forEach { KitLineRow(it.name, it.estPence, quiet = true) }
                        }
                    }
                }
            }
        }
        Text(spendLine(inv), style = JKType.caption, color = JKColors.textSecondary)

        inv.welcomeText?.takeIf { it.isNotEmpty() }?.let {
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m), verticalAlignment = Alignment.Top) {
                JKAvatar(AppSession.me?.coach?.avatarMediaId, size = JKSize.avatarSmall)
                Text(it, style = JKType.parCue, color = JKColors.text, modifier = Modifier.weight(1f))
            }
        }

        if (inv.waitlisted) {
            Text("The campaign is full. JK will offer you the next place that frees up.", style = JKType.callout, color = JKColors.textSecondary)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                PrimaryButton(onClick = {
                    busy = true
                    onAccept()
                }, enabled = !busy) {
                    if (busy) ProgressView(tint = JKColors.onChrome) else Text("Accept")
                }
                SecondaryButton("Not this time", onClick = { confirmDecline = true }, enabled = !busy)
            }
            Text(
                if (inv.feeDuePence > 0) "Nothing is charged until you accept. JK sends the invoice after." else "Nothing is charged.",
                style = JKType.meta, color = JKColors.textTertiary,
            )
        }
    }

    if (confirmDecline) {
        AlertDialog(
            onDismissRequest = { confirmDecline = false },
            title = { Text("Not this time?", style = JKType.headline, color = JKColors.text) },
            text = { Text("JK will see you've passed on ${c.name}. You can still ask him about it in messages.", style = JKType.callout, color = JKColors.textSecondary) },
            confirmButton = {
                TextButtonStrong("Decline", onClick = {
                    confirmDecline = false
                    busy = true
                    onDecline()
                })
            },
            dismissButton = { TextButton("Keep it", onClick = { confirmDecline = false }) },
            containerColor = JKColors.raised,
            shape = JKShape.sheetAll,
        )
    }
}

private fun spendLine(inv: Invitation): String {
    if (inv.expectedSpendPence <= 0) {
        val none = if (inv.kit.optional.isEmpty()) "No kit to buy." else "Nothing you have to buy."
        return if (inv.feeDuePence > 0) "$none The fee is ${Fmt.pounds(inv.feeDuePence)}." else none
    }
    val kit = "Expected spend ${Fmt.pounds(inv.expectedSpendPence)} on kit"
    return if (inv.feeDuePence > 0) "$kit, plus the ${Fmt.pounds(inv.feeDuePence)} fee." else "$kit."
}

@Composable
private fun Fact(label: String, value: String, detail: String?, modifier: Modifier) {
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        Text(label.uppercase(), style = JKType.parLabel, color = JKColors.textTertiary)
        Text(value, style = JKType.parHeadline, color = JKColors.text)
        detail?.let { Text(it, style = JKType.meta, color = JKColors.textSecondary) }
    }
}

@Composable
private fun VRule() {
    Box(Modifier.width(JKSize.hairline).fillMaxHeight().background(JKColors.hairline))
}

@Composable
private fun KitLineRow(name: String, pence: Int, quiet: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(IconKey.kit, size = JKSize.iconSmall, tint = JKColors.textSecondary)
        Text(name, style = JKType.parBody, color = if (quiet) JKColors.textSecondary else JKColors.text, modifier = Modifier.weight(1f))
        Text(Fmt.pounds(pence), style = JKType.parBody.monospacedDigit(), color = if (quiet) JKColors.textSecondary else JKColors.text)
    }
}

// MARK: - The campaign card

/**
 * Once in: the name, day N of M, progress, rank when JK shows it, today's
 * activities with tick boxes and "Read guide", and the way into the detail.
 */
@Composable
fun CampaignCard(
    e: MyEnrolment,
    onOpen: () -> Unit,
    onTick: (CampaignActivity, Boolean) -> Unit,
    onGuide: (CampaignActivity) -> Unit,
) {
    val name = e.campaign?.name ?: "Campaign"
    ParCard(Modifier.fillMaxWidth(), onClick = onOpen, onClickLabel = "Open $name", padding = JKSpace.xl, spacing = JKSpace.l) {
        Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.l), verticalAlignment = Alignment.CenterVertically) {
            ParRing(e.pct / 100f, JKSize.ringCommitment, idleStrong = true) {
                Text("${e.pct}%", style = JKType.meta.monospacedDigit(), color = JKColors.text)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                ParLabel(if (e.status == "paused") "Campaign · paused" else "Campaign", annotation = CampaignText.dayOf(e))
                Text(name, style = JKType.parCardTitle, color = JKColors.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val bits = listOfNotNull(
                    "${e.points} points",
                    e.rank?.let { CampaignText.rank(it) },
                )
                Text(bits.joinToString(" · "), style = JKType.meta, color = JKColors.textSecondary)
            }
        }
        DayProgress(e)
        if (e.today.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                ParLabel("Today")
                e.today.forEach { a ->
                    ActivityRow(a, enabled = e.active, onTick = { onTick(a, it) }, onGuide = { onGuide(a) })
                }
            }
        } else {
            val next = e.next.firstOrNull()
            Text(
                next?.let { "Nothing due today. Next: ${it.title}, ${it.date?.let { d -> Fmt.longDay(d) } ?: "soon"}." } ?: "Nothing due today.",
                style = JKType.parBody, color = JKColors.textSecondary,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(JKSpace.s)) {
            Text("The whole plan", style = JKType.callout, color = JKColors.text)
            Glyph(IconKey.arrow, size = JKSize.iconSmall, tint = JKColors.text)
        }
    }
}

/** A thin line for how far through the campaign today is. */
@Composable
private fun DayProgress(e: MyEnrolment) {
    val length = e.lengthDays ?: e.campaign?.lengthDays ?: return
    val day = e.day ?: return
    ThinBar((day.toDouble() / length).coerceIn(0.0, 1.0), color = JKColors.silver)
}

/** One activity: tick, title, kind and points, and the guide when there is one. */
@Composable
private fun ActivityRow(a: CampaignActivity, enabled: Boolean, onTick: (Boolean) -> Unit, onGuide: () -> Unit, showDate: Boolean = false) {
    // Dated rows (the lists) carry a glyph-only guide button, so long lists stay calm.
    var done by remember(a.id, a.done) { mutableStateOf(a.done) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).padding(vertical = JKSpace.xs),
        horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(JKSize.touchTarget)
                .clip(CircleShape)
                .clickable(enabled = enabled, role = Role.Checkbox) {
                    done = !done
                    onTick(done)
                }
                .semantics {
                    contentDescription = a.title
                    stateDescription = if (done) "Done" else "Not done"
                },
            contentAlignment = Alignment.Center,
        ) { CheckCircle(done, tint = JKColors.silver) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            Text(a.title, style = JKType.parBody, color = if (done) JKColors.textSecondary else JKColors.text)
            val meta = listOfNotNull(
                if (showDate) a.date?.let { Fmt.dayMonth(it) } else null,
                CampaignText.kind(a.kind),
                "${a.points} pts",
                if (!a.required) "optional" else null,
                a.spendPence.takeIf { it > 0 }?.let { "about ${Fmt.pounds(it)}" },
            )
            Text(meta.joinToString(" · "), style = JKType.meta, color = JKColors.textTertiary)
            a.detail.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.meta, color = JKColors.textSecondary) }
        }
        if (a.guide != null) {
            if (showDate) SmallPill(onClick = onGuide, icon = IconKey.guide, contentDescription = "Read the guide for ${a.title}")
            else SmallPill("Read guide", onClick = onGuide, icon = IconKey.guide)
        }
    }
}

// MARK: - Detail

/**
 * The whole campaign: where you are, the phases as a strip with the current
 * one open, today and what's next, every activity by phase, the kit with
 * bought ticks and "I spent £__", and the web plan link.
 */
@Composable
fun CampaignDetailView(enrolmentId: String) {
    val nav = LocalNav.current
    val uri = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<CampaignDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var spending by remember { mutableStateOf<CampaignKit?>(null) }

    suspend fun load() {
        try {
            detail = Campaigns.detail(enrolmentId)
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = if ((e as? APIError)?.status == 404) "This campaign isn't available any more." else e.readable
        }
    }
    LaunchedEffect(enrolmentId) { load() }

    fun tick(itemId: String, done: Boolean, spent: Int? = null) {
        scope.launch {
            try {
                Campaigns.tick(enrolmentId, itemId, done, spent)
            } catch (e: Exception) {
                if (e.isCancellation) throw e
                actionError = e.readable
            }
            load()
        }
    }

    Column(Modifier.jkScreen()) {
        TopBar()
        JKRefreshable(onRefresh = { load() }, modifier = Modifier.weight(1f).fillMaxWidth()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = JKSpace.gutter).padding(bottom = JKSpace.xxxl),
                verticalArrangement = Arrangement.spacedBy(JKSpace.xxl),
            ) {
                Loadable(detail, error, retry = { load() }) { d ->
                    val inv = d.enrolment.invitation
                    if (inv != null) {
                        InvitationCard(
                            inv,
                            onAccept = { scope.launch { runCatching { Campaigns.accept(inv.enrolmentId) }.onFailure { actionError = it.readable }; load() } },
                            onDecline = { scope.launch { runCatching { Campaigns.decline(inv.enrolmentId) }.onFailure { actionError = it.readable }; nav.pop() } },
                        )
                    } else {
                        DetailContent(d, onTick = { a, done -> tick(a.id, done) }, onGuide = { title, g -> openGuide(nav, title, g) }, onKit = { k -> spending = k }, onKitTick = { k, done -> tick(k.id, done) }, onPlan = { url -> runCatching { uri.openUri(url) } })
                    }
                }
            }
        }
    }

    spending?.let { k ->
        SpendDialog(k, onDismiss = { spending = null }) { pence ->
            spending = null
            tick(k.id, true, pence)
        }
    }
    ErrorAlert(actionError) { actionError = null }
}

@Composable
private fun DetailContent(
    d: CampaignDetail,
    onTick: (CampaignActivity, Boolean) -> Unit,
    onGuide: (String, GuideRef?) -> Unit,
    onKit: (CampaignKit) -> Unit,
    onKitTick: (CampaignKit, Boolean) -> Unit,
    onPlan: (String) -> Unit,
) {
    val e = d.enrolment
    val c = d.campaign ?: e.campaign
    val active = e.active
    val today = e.day?.let { it - 1 }

    // Hero
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        ParLabel(listOfNotNull("Campaign", CampaignText.length(e.lengthDays ?: c?.lengthDays)).joinToString(" · "), annotation = CampaignText.dayOf(e))
        ParTitle(c?.name ?: "Campaign")
        c?.tagline?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.parBody, color = JKColors.textSecondary) }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
        Stat("Done", "${e.pct}%", Modifier.weight(1f))
        Stat("Points", "${e.points}", Modifier.weight(1f))
        Stat("Rank", e.rank?.let { "${it.position} of ${it.of}" } ?: "–", Modifier.weight(1f))
    }
    if (e.status == "paused") Text("Paused while your coaching is paused. Dates move on when it resumes.", style = JKType.callout, color = JKColors.textSecondary)
    if (e.status == "completed") Text("Completed. Well done.", style = JKType.parCue, color = JKColors.text)

    // Phases
    if (d.phases.isNotEmpty()) {
        PhaseStrip(d.phases, today, e.lengthDays ?: c?.lengthDays)
        val current = d.phases.firstOrNull { today != null && today in it.startDay..it.endDay } ?: d.phases.first()
        ParCard(Modifier.fillMaxWidth(), spacing = JKSpace.s) {
            ParLabel("Now · ${current.name}", annotation = "days ${current.startDay + 1}–${current.endDay + 1}")
            current.summary?.takeIf { it.isNotEmpty() }?.let { Text(it, style = JKType.parSmall, color = JKColors.text) }
            current.guide?.title?.let { title ->
                TextButton(onClick = { onGuide(title, current.guide) }) {
                    Glyph(IconKey.guide, JKType.callout)
                    Text("Read: $title")
                }
            }
        }
    }

    // Today and next
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
        ParLabel("Today", annotation = Fmt.fullDay(java.time.LocalDate.now(Day.zone)))
        if (e.today.isEmpty()) Text("Nothing due today.", style = JKType.parBody, color = JKColors.textSecondary)
        e.today.forEach { a -> ActivityRow(a, enabled = active, onTick = { onTick(a, it) }, onGuide = { onGuide(a.title, a.guide) }) }
    }
    if (e.next.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            ParLabel("Coming up")
            e.next.forEach { a -> ActivityRow(a, enabled = false, onTick = {}, onGuide = { onGuide(a.title, a.guide) }, showDate = true) }
        }
    }

    // Every activity, by phase (the current phase open).
    if (d.activities.isNotEmpty()) PhaseActivities(d, today, active, onTick, onGuide)

    // Kit
    if (d.kit.isNotEmpty()) KitSection(d.kit, enabled = active, onKit = onKit, onKitTick = onKitTick)

    e.planUrl?.takeIf { Links.isSafe(it) }?.let { url ->
        Column(verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            SecondaryButton(onClick = { onPlan(url) }) {
                Text("Open the web plan")
                Glyph(IconKey.openLink, size = JKSize.iconSmall, tint = JKColors.text)
            }
            Text("The same plan as a web page, for a laptop or to share with yourself.", style = JKType.meta, color = JKColors.textTertiary)
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    Column(
        modifier.background(JKColors.surface, JKShape.parCard).border(JKSize.hairline, JKColors.hairline, JKShape.parCard).padding(JKSpace.l).semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(JKSpace.xs),
    ) {
        Text(label.uppercase(), style = JKType.parLabel, color = JKColors.textTertiary)
        Text(value, style = JKType.parDisplay.monospacedDigit(), color = JKColors.text, maxLines = 1)
    }
}

/** The phases as one strip, each as wide as its days, the current one bright, a tick for today. */
@Composable
private fun PhaseStrip(phases: List<CampaignPhase>, today: Int?, length: Int?) {
    val total = (length ?: (phases.maxOf { it.endDay } + 1)).coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s), modifier = Modifier.semantics(mergeDescendants = true) {
        contentDescription = "Phases: " + phases.joinToString(", ") { it.name }
    }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
            phases.forEach { p ->
                val days = (p.endDay - p.startDay + 1).coerceAtLeast(1)
                val now = today != null && today in p.startDay..p.endDay
                val past = today != null && today > p.endDay
                Column(Modifier.weight(days.toFloat() / total), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(JKSpace.s)
                            .clip(JKShape.pill)
                            .background(if (past) JKColors.silver else JKColors.track, JKShape.pill),
                    ) {
                        if (now && today != null) {
                            val frac = (today - p.startDay + 1f) / days
                            Box(Modifier.fillMaxWidth(frac.coerceIn(0.08f, 1f)).height(JKSpace.s).background(JKColors.text, JKShape.pill))
                        }
                    }
                    Text(p.name, style = JKType.meta, color = if (now) JKColors.text else JKColors.textTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun PhaseActivities(
    d: CampaignDetail,
    today: Int?,
    active: Boolean,
    onTick: (CampaignActivity, Boolean) -> Unit,
    onGuide: (String, GuideRef?) -> Unit,
) {
    val byPhase = d.phases.map { p -> p to d.activities.filter { it.day in p.startDay..p.endDay } }
    val loose = d.activities.filter { a -> d.phases.none { a.day in it.startDay..it.endDay } }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        ParLabel("Every activity")
        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
            val groups = byPhase + if (loose.isNotEmpty()) listOf(null to loose) else emptyList()
            groups.forEachIndexed { i, (p, list) ->
                val current = p != null && today != null && today in p.startDay..p.endDay
                var open by remember(p?.id) { mutableStateOf(current) }
                val done = list.count { it.done }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = JKSize.touchTarget)
                        .clickable(role = Role.Button) { open = !open }
                        .padding(horizontal = JKSpace.m)
                        .semantics(mergeDescendants = true) { stateDescription = if (open) "Shown" else "Hidden" },
                    horizontalArrangement = Arrangement.spacedBy(JKSpace.m),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(p?.name ?: "Other", style = JKType.callout, color = JKColors.text, modifier = Modifier.weight(1f))
                    Text("$done of ${list.size}", style = JKType.meta.monospacedDigit(), color = JKColors.textSecondary)
                    Glyph(if (open) IconKey.collapse else IconKey.expand, size = JKSize.iconSmall, tint = JKColors.textSecondary)
                }
                AnimatedVisibility(open) {
                    Column(Modifier.padding(horizontal = JKSpace.s)) {
                        list.sortedBy { it.day }.forEach { a ->
                            val due = today == null || a.day <= today
                            ActivityRow(a, enabled = active && due, onTick = { onTick(a, it) }, onGuide = { onGuide(a.title, a.guide) }, showDate = true)
                        }
                    }
                }
                if (i < groups.lastIndex) GroupDivider()
            }
        }
    }
}

/** The kit: bought ticks, estimates, what you spent, and the shop link when JK gave one. */
@Composable
private fun KitSection(kit: List<CampaignKit>, enabled: Boolean, onKit: (CampaignKit) -> Unit, onKitTick: (CampaignKit, Boolean) -> Unit) {
    val uri = LocalUriHandler.current
    val required = kit.filter { it.required }.sumOf { it.estPence }
    val optional = kit.filterNot { it.required }.sumOf { it.estPence }
    val spent = kit.sumOf { it.spentPence ?: 0 }
    Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
        ParLabel("Kit", annotation = "spent ${Fmt.pounds(spent)}")
        Text(
            "Expected ${Fmt.pounds(required)} (required)" + if (optional > 0) " · ${Fmt.pounds(optional)} optional" else "",
            style = JKType.meta, color = JKColors.textSecondary,
        )
        Column(Modifier.jkSurface(SurfaceVariant.Group, padding = JKSpace.xs)) {
            kit.sortedBy { it.position }.forEachIndexed { i, k ->
                var bought by remember(k.id, k.bought) { mutableStateOf(k.bought) }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = JKSize.touchTarget).padding(end = JKSpace.s).padding(vertical = JKSpace.xs),
                    horizontalArrangement = Arrangement.spacedBy(JKSpace.s),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(JKSize.touchTarget)
                            .clip(CircleShape)
                            .clickable(enabled = enabled, role = Role.Checkbox) {
                                bought = !bought
                                onKitTick(k, bought)
                            }
                            .semantics {
                                contentDescription = k.name
                                stateDescription = if (bought) "Bought" else "Not bought"
                            },
                        contentAlignment = Alignment.Center,
                    ) { CheckCircle(bought, tint = JKColors.silver) }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(JKSpace.xs)) {
                        Text(k.name, style = JKType.parBody, color = JKColors.text)
                        val meta = listOfNotNull(
                            if (k.required) "Required" else "Optional",
                            "about ${Fmt.pounds(k.estPence)}",
                            k.note.takeIf { it.isNotEmpty() },
                        )
                        Text(meta.joinToString(" · "), style = JKType.meta, color = JKColors.textTertiary)
                        if (bought) {
                            Text(
                                k.spentPence?.let { "You spent ${Fmt.pounds(it)} · Edit" } ?: "I spent £__",
                                style = JKType.caption.semibold(),
                                color = JKColors.text,
                                modifier = Modifier
                                    .clip(JKShape.chip)
                                    .clickable(enabled = enabled, role = Role.Button) { onKit(k) }
                                    .padding(vertical = JKSpace.xs),
                            )
                        }
                    }
                    k.url?.takeIf { Links.isSafe(it) }?.let { url ->
                        SmallPill(onClick = { runCatching { uri.openUri(url) } }, icon = IconKey.openLink, contentDescription = "Open the shop link for ${k.name}")
                    }
                }
                if (i < kit.lastIndex) GroupDivider()
            }
        }
    }
}

/** "I spent £__": pounds and pence, stored as pence. */
@Composable
private fun SpendDialog(k: CampaignKit, onDismiss: () -> Unit, onSave: (Int) -> Unit) {
    var text by remember { mutableStateOf(k.spentPence?.let { "%.2f".format(it / 100.0).removeSuffix(".00") } ?: "") }
    val pence = parseNumber(text.removePrefix("£"))?.let { Math.round(it * 100).toInt() }?.takeIf { it in 0..10_000_000 }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("What did ${k.name} cost?", style = JKType.headline, color = JKColors.text) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(JKSpace.s)) {
                JKField("Amount (£)", text, { text = it }, prompt = Fmt.pounds(k.estPence).removePrefix("£"), keyboard = KeyboardType.Decimal)
                Text("Only JK sees it, on the campaign board.", style = JKType.caption, color = JKColors.textSecondary)
            }
        },
        confirmButton = { TextButtonStrong("Save", onClick = { pence?.let(onSave) }, enabled = pence != null) },
        dismissButton = { TextButton("Cancel", onClick = onDismiss) },
        containerColor = JKColors.raised,
        shape = JKShape.sheetAll,
    )
}
