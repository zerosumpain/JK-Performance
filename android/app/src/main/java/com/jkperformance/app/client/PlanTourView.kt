package com.jkperformance.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.jkperformance.app.design.AnnualPriceLine
import com.jkperformance.app.design.CheckCircle
import com.jkperformance.app.design.CheckPoint
import com.jkperformance.app.design.Chip
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.ErrorCard
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.FeatureRow
import com.jkperformance.app.design.FeatureTile
import com.jkperformance.app.design.FittingText
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.GhostButton
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.LoadingCard
import com.jkperformance.app.design.LocalDismiss
import com.jkperformance.app.design.LocalNav
import com.jkperformance.app.design.PopularBadge
import com.jkperformance.app.design.Price
import com.jkperformance.app.design.PriceLabel
import com.jkperformance.app.design.ThinBar
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.medium
import com.jkperformance.app.design.rememberReduceMotion
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.design.tracking
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.Feature
import com.jkperformance.app.net.Plan
import com.jkperformance.app.net.PlansResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.launch

/** One page of the walkthrough; `section` is its index in the strip at the top. */
private sealed class TourPage(val section: Int) {
    class Overview : TourPage(0)
    class PlanIntro(val plan: Plan, section: Int) : TourPage(section)
    class Carried(val plan: Plan, val previous: Plan, val features: List<String>, section: Int) : TourPage(section)
    class NewFeature(val plan: Plan, val feature: Feature, section: Int) : TourPage(section)
    class Compare(section: Int) : TourPage(section)
}

/** Overview, then each paid plan (its page, what it carries over, one step per new feature), then Compare. */
private fun tourPages(reply: PlansResponse): List<TourPage> {
    val paid = reply.plans.filter { !it.isFree }
    val free = reply.plans.firstOrNull { it.isFree }
    val pages = mutableListOf<TourPage>(TourPage.Overview())
    paid.forEachIndexed { i, plan ->
        val section = i + 1
        pages += TourPage.PlanIntro(plan, section)
        val previous = if (i == 0) free else paid[i - 1]
        val before = previous?.featureIds.orEmpty()
        val carried = plan.featureIds.filter { it in before }
        if (previous != null && carried.isNotEmpty()) pages += TourPage.Carried(plan, previous, carried, section)
        plan.featureIds.filter { it !in before }.forEach { id ->
            val feature = reply.features.firstOrNull { it.id == id } ?: Feature(id, id.replaceFirstChar { it.uppercase() }, "")
            pages += TourPage.NewFeature(plan, feature, section)
        }
    }
    pages += TourPage.Compare(paid.size + 1)
    return pages
}

/**
 * The plan walkthrough an unsubscribed client sees (and anyone from
 * Membership, and a coach previewing their own plans): built from GET
 * /api/plans, paged sideways with a tappable section strip, Close, and
 * Back / Next. Shown in a [com.jkperformance.app.design.Sheet], so
 * "Choose {plan}" pushes Membership inside it.
 *
 * `onChoose` replaces that push (Membership opening the tour picks the plan
 * itself); `preview` (the coach) hides the choose buttons.
 */
@Composable
fun PlanTourView(onChoose: ((String) -> Unit)? = null, preview: Boolean = false) {
    var reply by remember { mutableStateOf<PlansResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val dismiss = LocalDismiss.current

    suspend fun load() {
        try {
            reply = APIClient.get<PlansResponse>("/api/plans")
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }
    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize().background(JK.bg)) {
        val r = reply
        if (r == null) {
            CloseBar(dismiss)
            Column(Modifier.padding(16.dp)) {
                if (error != null) ErrorCard(error ?: "", retry = { load() }) else LoadingCard()
            }
        } else {
            TourPager(r, onChoose, preview, dismiss)
        }
    }
}

@Composable
private fun CloseBar(dismiss: () -> Unit, title: String = "") {
    Box(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp)) {
        Box(
            Modifier
                .align(Alignment.CenterStart)
                .size(40.dp)
                .clip(CircleShape)
                .clickable(onClick = dismiss)
                .semantics { contentDescription = "Close" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Close, contentDescription = null, tint = JK.text, modifier = Modifier.size(22.dp))
        }
        if (title.isNotEmpty()) {
            Text(title, style = JKType.headline, color = JK.text, modifier = Modifier.align(Alignment.Center))
        }
    }
}

@Composable
private fun ColumnScope.TourPager(reply: PlansResponse, onChoose: ((String) -> Unit)?, preview: Boolean, dismiss: () -> Unit) {
    val pages = remember(reply) { tourPages(reply) }
    val paid = remember(reply) { reply.plans.filter { !it.isFree } }
    val sections = listOf("Overview") + paid.map { it.name } + "Compare"
    val pager = rememberPagerState { pages.size }
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()
    val nav = LocalNav.current

    fun goTo(index: Int) {
        val target = index.coerceIn(0, pages.lastIndex)
        scope.launch { if (reduceMotion) pager.scrollToPage(target) else pager.animateScrollToPage(target) }
    }
    fun choose(id: String) {
        if (onChoose != null) onChoose(id) else nav.push { MembershipView(preselect = id) }
    }

    val current = pages[pager.currentPage]
    CloseBar(dismiss, title = if (preview) "Preview as a client" else "")
    // The section strip: tap to jump to the first page of a section.
    val strip = rememberScrollState()
    Row(
        Modifier.fillMaxWidth().horizontalScroll(strip).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        sections.forEachIndexed { i, name ->
            val on = current.section == i
            Chip(name, selected = on, modifier = Modifier.semantics { selected = on }) {
                goTo(pages.indexOfFirst { it.section == i })
            }
        }
    }
    // Keep the current section in view as the pages move.
    LaunchedEffect(current.section) {
        val fraction = current.section.toFloat() / (sections.size - 1).coerceAtLeast(1)
        strip.animateScrollTo((strip.maxValue * fraction).toInt())
    }
    // Thin progress through the whole tour.
    ThinBar(
        fraction = (pager.currentPage + 1).toDouble() / pages.size,
        height = 2.dp,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )

    HorizontalPager(
        state = pager,
        modifier = Modifier.fillMaxWidth().weight(1f),
        beyondViewportPageCount = 1,
    ) { index ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when (val page = pages[index]) {
                is TourPage.Overview -> OverviewPage(reply) { planId ->
                    goTo(pages.indexOfFirst { it is TourPage.PlanIntro && it.plan.id == planId })
                }
                is TourPage.PlanIntro -> PlanIntroPage(page.plan)
                is TourPage.Carried -> CarriedPage(page, reply.features)
                is TourPage.NewFeature -> FeaturePage(page.plan, page.feature)
                is TourPage.Compare -> ComparePage(reply, if (preview) null else ::choose)
            }
        }
    }

    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val first = pager.currentPage == 0
        val last = pager.currentPage == pages.lastIndex
        GhostButton("Back", onClick = { goTo(pager.currentPage - 1) }, modifier = Modifier.weight(1f).alpha(if (first) 0.4f else 1f), enabled = !first)
        ChromeButton(if (last) "Done" else "Next", onClick = { if (last) dismiss() else goTo(pager.currentPage + 1) }, modifier = Modifier.weight(1f))
    }
}

// MARK: - Pages

@Composable
private fun PageTitle(eyebrow: String?, title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (eyebrow != null) Eyebrow(eyebrow)
        Text(title, style = JKType.title.semibold(), color = JK.text, modifier = Modifier.semantics { heading() })
        if (subtitle != null) Text(subtitle, style = JKType.subheadline, color = JK.secondary)
    }
}

@Composable
private fun OverviewPage(reply: PlansResponse, open: (String) -> Unit) {
    val free = reply.plans.firstOrNull { it.isFree }
    PageTitle("Coaching", "What coaching includes", "Step through each plan, or tap one to jump to it.")
    if (free != null) {
        Eyebrow("You have now · ${free.name}")
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            free.featureIds.forEach { id ->
                val f = reply.features.firstOrNull { it.id == id }
                FeatureRow(id, f?.title ?: id, f?.detail)
            }
        }
    }
    Eyebrow("With a coach")
    reply.plans.filter { !it.isFree }.forEach { p -> PlanSummaryCard(p, onClick = { open(p.id) }) }
}

/** A plan in brief: name, Most popular, tagline, monthly price. `compact` drops the chevron and tightens it. */
@Composable
fun PlanSummaryCard(plan: Plan, modifier: Modifier = Modifier, compact: Boolean = false, onClick: (() -> Unit)? = null) {
    val shape = rounded(JK.corner)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .background(JK.card, shape)
            .border(1.dp, if (plan.isFeatured) JK.secondary else JK.stroke, shape)
            .padding(if (compact) 12.dp else 14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(plan.name, style = JKType.headline, color = JK.text)
                if (plan.isFeatured) PopularBadge()
            }
            Text(plan.detail, style = JKType.caption, color = JK.tertiary)
        }
        PriceLabel(plan.monthlyPence)
        if (onClick != null && !compact) com.jkperformance.app.design.SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

@Composable
private fun PlanIntroPage(plan: Plan) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("PLAN", style = JKType.caption2.semibold().tracking(1.4f), color = JK.tertiary)
            if (plan.isFeatured) PopularBadge()
        }
        Text(plan.name, style = JKType.largeTitle.semibold(), color = JK.text, modifier = Modifier.semantics { heading() })
        Text(plan.detail, style = JKType.subheadline, color = JK.secondary)
    }
    Column(Modifier.jkCard(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PriceLabel(plan.monthlyPence, big = true)
        AnnualPriceLine(plan.monthlyPence, plan.annualPence)
        if (plan.credits > 0) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                com.jkperformance.app.design.SystemImage("calendar", JKType.subheadline, JK.secondary)
                Text(
                    if (plan.credits == 1) "1 session a month" else "${plan.credits} sessions a month",
                    style = JKType.subheadline, color = JK.text,
                )
            }
        }
    }
    plan.pitch?.takeIf { it.isNotBlank() }?.let { Text(it, style = JKType.body, color = JK.text) }
    Text("Next: what's in it, one step at a time.", style = JKType.caption, color = JK.tertiary)
}

@Composable
private fun CarriedPage(page: TourPage.Carried, catalogue: List<Feature>) {
    PageTitle(page.plan.name, "Everything in ${page.previous.name}, plus…", "${page.plan.name} keeps all of this.")
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        page.features.forEach { id ->
            val f = catalogue.firstOrNull { it.id == id }
            FeatureRow(id, f?.title ?: id, null) {
                Icon(Icons.Rounded.Check, contentDescription = "Included", tint = JK.secondary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun FeaturePage(plan: Plan, feature: Feature) {
    FeatureTile(feature.id, size = 64.dp)
    PageTitle("New in ${plan.name}", feature.title, feature.detail.ifEmpty { null })
    if (feature.points.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { feature.points.forEach { CheckPoint(it) } }
    }
    FeaturePreview(feature.id, plan)
}

@Composable
private fun ComparePage(reply: PlansResponse, choose: ((String) -> Unit)?) {
    val paid = reply.plans.filter { !it.isFree }
    PageTitle("Compare", "The plans side by side", null)
    Column(Modifier.jkCard(padding = 0.dp)) {
        CompareRow(header = true, label = "", cells = paid.map { { CompareHeader(it) } })
        reply.features.forEach { f ->
            CompareRow(label = f.title, cells = paid.map { p -> { CompareMark(f.id in p.featureIds, "${f.title} in ${p.name}") } })
        }
        CompareRow(label = "Sessions a month", cells = paid.map { p -> { CompareText(if (p.credits > 0) "${p.credits}" else "–") } })
        CompareRow(label = "Per month", cells = paid.map { p -> { CompareText(Price.label(p.monthlyPence), strong = true) } }, last = true)
    }
    if (choose != null) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            paid.forEach { p ->
                GhostButton("Choose ${p.name}", onClick = { choose(p.id) })
            }
        }
        Text("Nothing is charged while payments are off.", style = JKType.caption2, color = JK.tertiary,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun CompareRow(label: String, cells: List<@Composable () -> Unit>, header: Boolean = false, last: Boolean = false) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (header) Modifier.background(JK.cardRaised, rounded(JK.corner)) else Modifier)
            .padding(horizontal = 12.dp, vertical = if (header) 10.dp else 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = JKType.caption, color = JK.secondary, modifier = Modifier.weight(1.5f))
        cells.forEach { cell -> Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { cell() } }
    }
    if (!last && !header) Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).height(1.dp).background(JK.stroke))
}

@Composable
private fun CompareHeader(p: Plan) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        FittingText(p.name, style = JKType.caption.semibold(), color = JK.text, minimumScaleFactor = 0.7f)
        // The featured plan is underlined; the others keep the same height so the names line up.
        Box(Modifier.size(width = 18.dp, height = 3.dp).then(if (p.isFeatured) Modifier.background(JK.chrome, CircleShape) else Modifier))
    }
}

@Composable
private fun CompareMark(on: Boolean, description: String) {
    Box(Modifier.semantics { contentDescription = if (on) "$description: included" else "$description: not included" }) {
        if (on) Icon(Icons.Rounded.Check, contentDescription = null, tint = JK.text, modifier = Modifier.size(18.dp))
        else Text("–", style = JKType.caption, color = JK.tertiary)
    }
}

@Composable
private fun CompareText(text: String, strong: Boolean = false) {
    FittingText(text, style = if (strong) JKType.caption.semibold() else JKType.caption, color = JK.text, minimumScaleFactor = 0.7f)
}

// MARK: - Feature previews (static sample content, drawn with the app's own pieces)

@Composable
private fun PreviewCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.padding(top = 4.dp)) {
        Eyebrow("Preview")
        Spacer(Modifier.height(6.dp))
        Column(
            Modifier.jkCard().semantics { contentDescription = "An example of how this looks in the app" },
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
private fun FeaturePreview(id: String, plan: Plan) {
    when (id) {
        "programme" -> PreviewCard {
            Eyebrow("Today", trailing = "Lower Body Strength")
            listOf(
                Triple("Back Squat", "4 × 6 · 80 kg", true),
                Triple("Romanian Deadlift", "3 × 8 · 70 kg", false),
                Triple("Walking Lunge", "3 × 10 / leg · 2×16 kg", false),
            ).forEach { (name, sets, done) ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(name, style = JKType.subheadline.semibold(), color = JK.text)
                        Text(sets, style = JKType.caption, color = JK.tertiary)
                    }
                    CheckCircle(done)
                }
            }
        }
        "messaging" -> PreviewCard {
            SampleBubble("Hamstrings were tight on the last set of RDLs. Worth dropping the weight?", mine = true)
            SampleBubble("Keep 70 kg but stop at 6 reps this week. Send me a video of set one.", mine = false)
        }
        "habits" -> PreviewCard {
            SampleHabit("Water", "2.1 of 3 L", 0.7)
            SampleHabit("Steps", "7,850 of 10,000", 0.785)
            SampleHabit("Sleep 7h+", "Done", 1.0)
        }
        "progress" -> PreviewCard {
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("Body weight", style = JKType.caption, color = JK.tertiary)
                    Text("78.4 kg", style = JKType.title2.semibold(), color = JK.text)
                }
                Text("−4.0 kg since March", style = JKType.caption, color = JK.secondary)
            }
            SampleLine(listOf(82.4, 82.0, 81.6, 81.7, 80.9, 80.2, 79.8, 79.1, 78.8, 78.4))
        }
        "checkin" -> PreviewCard {
            SampleScale("Energy", 4)
            SampleScale("Sleep", 3)
            SampleBubble("Good week. Keep Thursday light and we'll push the squat again on Monday.", mine = false)
        }
        "sessions" -> PreviewCard {
            SampleSlot("TUE", "25", "1:1 in person · 07:00", "Studio 2")
            SampleSlot("FRI", "28", "1:1 on video · 12:30", "Video call")
            val credits = plan.credits.coerceAtLeast(2)
            Text("2 of $credits credits left this month", style = JKType.caption, color = JK.secondary)
        }
        "nutrition" -> PreviewCard {
            SampleHabit("Calories", "1,720 of 2,500 kcal", 0.69)
            SampleHabit("Protein", "128 of 170 g", 0.75)
            SampleHabit("Carbs", "180 of 260 g", 0.69)
            SampleHabit("Fat", "52 of 80 g", 0.65)
        }
        "priority" -> PreviewCard {
            SampleBubble("Knee feels off after yesterday's run. Should I still squat today?", mine = true)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Bolt, contentDescription = null, tint = JK.text, modifier = Modifier.size(16.dp))
                Text("Replied in 12 min", style = JKType.caption.semibold(), color = JK.text)
            }
        }
        "guides" -> PreviewCard {
            Eyebrow("Guide · 2 min read")
            Text("Sleep is training too", style = JKType.headline, color = JK.text)
            Text("Why seven hours does more for your squat than another set, and three ways to get there.",
                style = JKType.caption, color = JK.secondary)
        }
        else -> Unit
    }
}

@Composable
private fun SampleBubble(text: String, mine: Boolean) {
    val shape = rounded(14.dp)
    Row(Modifier.fillMaxWidth()) {
        if (mine) Spacer(Modifier.weight(0.2f))
        Text(
            text,
            style = JKType.footnote,
            color = if (mine) Color.Black else JK.text,
            modifier = Modifier
                .weight(0.8f)
                .then(if (mine) Modifier.background(JK.chrome, shape) else Modifier.background(JK.cardRaised, shape).border(1.dp, JK.stroke, shape))
                .padding(10.dp),
        )
        if (!mine) Spacer(Modifier.weight(0.2f))
    }
}

@Composable
private fun SampleHabit(name: String, value: String, fraction: Double) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row {
            Text(name, style = JKType.subheadline.medium(), color = JK.text, modifier = Modifier.weight(1f))
            Text(value, style = JKType.caption, color = JK.tertiary)
        }
        ThinBar(fraction)
    }
}

@Composable
private fun SampleScale(label: String, value: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = JKType.subheadline.medium(), color = JK.text, modifier = Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            (1..5).forEach { n ->
                Box(
                    Modifier.size(26.dp).background(if (n == value) JK.text else JK.cardRaised, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("$n", style = JKType.caption.semibold(), color = if (n == value) Color.Black else JK.secondary) }
            }
        }
    }
}

@Composable
private fun SampleSlot(weekday: String, day: String, title: String, detail: String) {
    Row(
        Modifier.fillMaxWidth().background(JK.cardRaised, rounded(10.dp)).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(weekday, style = JKType.system(9), color = JK.tertiary)
            Text(day, style = JKType.headline, color = JK.text)
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = JKType.subheadline.medium(), color = JK.text)
            Text(detail, style = JKType.caption2, color = JK.tertiary)
        }
    }
}

@Composable
private fun SampleLine(values: List<Double>) {
    val low = values.min() - 0.5
    val high = values.max() + 0.5
    Canvas(Modifier.fillMaxWidth().height(80.dp)) {
        val step = size.width / (values.size - 1)
        fun y(v: Double) = size.height - ((v - low) / (high - low)).toFloat() * size.height
        val path = Path()
        values.forEachIndexed { i, v -> if (i == 0) path.moveTo(0f, y(v)) else path.lineTo(i * step, y(v)) }
        drawPath(path, JK.text, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        drawCircle(JK.text, 3.5.dp.toPx(), Offset(size.width, y(values.last())))
    }
}
