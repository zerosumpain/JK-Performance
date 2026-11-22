package com.jkperformance.app


import android.app.Application
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Outbox
import com.jkperformance.app.net.Push
import com.jkperformance.app.net.TabRouter
import com.jkperformance.app.net.ClientRoute
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.jkperformance.app.design.*
import com.jkperformance.app.design.components.*

/**
 * The app process (JKPerformanceApp in Swift). Brings the singletons up in
 * dependency order, then on every return to the foreground sends anything
 * logged offline and lets a client's health sync run if due.
 */
class JKApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        APIClient.init(this)
        Outbox.init(this)
        Push.init(this)
        HealthSync.init(this)
        Reminders.init(this)
        val scope = MainScope()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                scope.launch { Outbox.flush() }
                val me = AppSession.me ?: return
                if (AppSession.phase == AppSession.Phase.signedIn && !me.isCoach && !me.demo) HealthSync.syncIfDue()
            }
        })
    }
}


/**
 * One app, two audiences: a client trains, a coach runs the business. The
 * server decides which (`me.role`); sign-up is open and coaches are made
 * server-side.
 */
@Composable
fun RootView() {
    val session = AppSession
    val context = LocalContext.current
    val reduceMotion = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    // The opening animation over the app; the Welcome screen plays its own.
    var intro by rememberSaveable { mutableStateOf(APIClient.token != null) }
    // Once per launch, not again when the activity is recreated (rotation).
    var restored by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(JKColors.bg)) {
        when (session.phase) {
            AppSession.Phase.signedOut -> WelcomeView()
            AppSession.Phase.restoring -> RestoringView()
            AppSession.Phase.signedIn -> when {
                session.isCoach -> CoachTabs()
                // A new client answers the first-run questions before the tabs.
                session.me?.needsOnboarding == true && !session.onboardingDeferred -> OnboardingFlow()
                else -> ClientTabs()
            }
        }
        AnimatedVisibility(
            visible = intro && session.phase != AppSession.Phase.signedOut,
            enter = EnterTransition.None,
            exit = fadeOut(tween(400)),
        ) { BrandIntro() }
    }

    LaunchedEffect(Unit) {
        if (!restored) {
            restored = true
            session.restore()
        }
    }
    LaunchedEffect(session.phase) {
        // Each launch and sign-in: refresh this phone's push token on the server.
        if (session.phase == AppSession.Phase.signedIn) Push.registerIfAllowed()
    }
    LaunchedEffect(Unit) {
        if (!intro) return@LaunchedEffect
        delay(if (reduceMotion) 400 else ((BrandIntro.duration + 0.3) * 1000).toLong())
        intro = false
    }
}

@Composable
private fun RestoringView() {
    val session = AppSession
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().background(JKColors.bg).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Monogram(size = JKSize.avatarLarge, tint = JKColors.accent)
        val error = session.restoreError
        if (error != null) {
            Text(error, style = JKType.caption, color = JKColors.textSecondary, textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(JKSpace.m)) {
                PrimaryButton("Try again", onClick = { scope.launch { session.restore() } }, modifier = Modifier.weight(1f))
                SecondaryButton("Sign out", onClick = { session.clear() }, modifier = Modifier.weight(1f))
            }
        } else {
            ProgressView(tint = JKColors.textSecondary)
        }
    }
}

/** One tab: its bar label and icon, and the root screen of its own navigation stack. */
private class Tab<T>(
    val tag: T,
    val label: String,
    val icon: @Composable (selected: Boolean) -> Unit,
    val root: @Composable () -> Unit,
) {
    /** A tab whose glyph is an [IconKey]: outline when idle, filled when selected. */
    constructor(tag: T, label: String, key: IconKey, root: @Composable () -> Unit) :
        this(tag, label, { selected -> Glyph(key, size = JKSize.iconTab, filled = selected) }, root)
}

/**
 * The iPhone's TabView: a black tab bar, each tab with its own NavHost so
 * switching tabs keeps each tab's place, and selection bound to TabRouter
 * so a tapped notification can move it. Tapping the selected tab again
 * returns it to its root, as on iOS.
 */
@Composable
private fun <T> Tabs(tabs: List<Tab<T>>, selected: T, select: (T) -> Unit) {
    val stacks: Map<T, NavStack> = tabs.associate { it.tag to rememberNavStack() }
    val holder = rememberSaveableStateHolder()
    Scaffold(
        containerColor = JKColors.bg,
        bottomBar = {
            Column {
                HorizontalDivider(thickness = JKSize.hairline, color = JKColors.hairline)
                NavigationBar(containerColor = JKColors.bg, tonalElevation = 0.dp) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = tab.tag == selected,
                            onClick = {
                                if (tab.tag == selected) stacks.getValue(tab.tag).popToRoot() else select(tab.tag)
                            },
                            icon = { tab.icon(tab.tag == selected) },
                            label = { Text(tab.label, style = JKType.caption, maxLines = 1) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = JKColors.text,
                                selectedTextColor = JKColors.text,
                                unselectedIconColor = JKColors.textSecondary,
                                unselectedTextColor = JKColors.textSecondary,
                                indicatorColor = Color.Transparent,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        val tab = tabs.first { it.tag == selected }
        Box(Modifier.fillMaxSize().padding(padding)) {
            holder.SaveableStateProvider(tab.tag.toString()) {
                NavHost(stacks.getValue(tab.tag)) { tab.root() }
            }
        }
    }
}

/**
 * The client's three tabs (atelier-spec.md, IA): Today, Progress (plans with
 * 'progress') and JK. Account is the avatar sheet on Today.
 */
@Composable
fun ClientTabs() {
    val session = AppSession
    val gate = session.gate
    LaunchedEffect(gate.progress) {
        if (!gate.progress && TabRouter.client == TabRouter.Client.progress) TabRouter.client = TabRouter.Client.today
    }
    Tabs(
        tabs = buildList {
            add(Tab(TabRouter.Client.today, "Today", IconKey.today) {
                RouteDrain(TabRouter.todayRequest) { TabRouter.todayRequest = null }
                TodayView()
            })
            if (gate.progress) add(Tab(TabRouter.Client.progress, "Progress", IconKey.progress) { ProgressTab() })
            add(Tab(TabRouter.Client.jk, "JK", { selected -> JKTabIcon(session.me?.coach?.avatarMediaId, selected) }) {
                RouteDrain(TabRouter.jkRequest) { TabRouter.jkRequest = null }
                JKView()
            })
        },
        selected = TabRouter.client,
        select = { TabRouter.client = it },
    )
}

/** The screen for a client route, pushed on whichever tab asked for it. */
@Composable
fun ClientRouteView(route: ClientRoute) {
    when (route) {
        is ClientRoute.yourWeek -> YourWeekView(day = route.day)
        is ClientRoute.session -> WorkoutDetailLoader(workoutId = route.workoutId)
        is ClientRoute.letter -> LetterView(reportId = route.reportId)
        ClientRoute.guides -> GuidesList()
        is ClientRoute.guide -> GuideView(guideId = route.guideId)
        ClientRoute.challenges -> ChallengesView()
    }
}

/** Push a client route on the current tab's stack. */
fun NavStack.push(route: ClientRoute) = push { ClientRouteView(route) }

/** Drains a TabRouter request (a tapped push, a link from another tab) into this tab's stack. */
@Composable
private fun RouteDrain(request: TabRouter.RouteRequest?, consumed: () -> Unit) {
    val nav = LocalNav.current
    LaunchedEffect(request?.serial) {
        val r = request ?: return@LaunchedEffect
        if (r.reset) nav.popToRoot()
        r.routes.forEach { nav.push(it) }
        consumed()
    }
}

/**
 * The coach's three tabs: Today (needs you), Clients and Messages. Schedule
 * became the day agenda behind Today's strip; Guides moved to Account.
 */
@Composable
fun CoachTabs() {
    Tabs(
        tabs = listOf(
            Tab(TabRouter.Coach.today, "Today", IconKey.coachToday) { CoachTodayView() },
            Tab(TabRouter.Coach.clients, "Clients", IconKey.clients) { ClientsView() },
            Tab(TabRouter.Coach.messages, "Messages", IconKey.messages) { CoachThreadsView() },
        ),
        selected = TabRouter.coach,
        select = { TabRouter.coach = it },
    )
}
