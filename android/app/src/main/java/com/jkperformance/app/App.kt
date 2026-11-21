package com.jkperformance.app

import com.jkperformance.app.design.BrandIntro

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Schedule
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
import com.jkperformance.app.design.NavHost
import com.jkperformance.app.design.NavStack
import com.jkperformance.app.design.rememberNavStack
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.Outbox
import com.jkperformance.app.net.Push
import com.jkperformance.app.net.TabRouter
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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

// The iPhone palette (Design/Theme.swift `JK`) for the shell's own pieces.
private val Bg = Color.Black
private val Card = Color(0xFF121212)
private val Stroke = Color.White.copy(alpha = 0.09f)
private val TextColor = Color.White
private val Secondary = Color.White.copy(alpha = 0.6f)
private val TabUnselected = Color(0xFF8E8E93)

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

    Box(Modifier.fillMaxSize().background(Bg)) {
        when (session.phase) {
            AppSession.Phase.signedOut -> WelcomeView()
            AppSession.Phase.restoring -> RestoringView()
            AppSession.Phase.signedIn -> if (session.isCoach) CoachTabs() else ClientTabs()
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
        Modifier.fillMaxSize().background(Bg).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(76.dp).border(1.dp, Secondary, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("JK", color = TextColor, fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
        }
        val error = session.restoreError
        if (error != null) {
            Text(error, color = Secondary, fontSize = 12.sp, textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val shape = RoundedCornerShape(12.dp)
                val padding = PaddingValues(vertical = 14.dp)
                Button(
                    onClick = { scope.launch { session.restore() } },
                    modifier = Modifier.weight(1f),
                    shape = shape,
                    contentPadding = padding,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD6D6D6), contentColor = Color.Black),
                ) { Text("Try again", fontWeight = FontWeight.SemiBold) }
                OutlinedButton(
                    onClick = { session.clear() },
                    modifier = Modifier.weight(1f),
                    shape = shape,
                    contentPadding = padding,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Stroke),
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = Card, contentColor = TextColor),
                ) { Text("Sign out", fontWeight = FontWeight.SemiBold) }
            }
        } else {
            CircularProgressIndicator(color = Secondary, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        }
    }
}

/** One tab: its bar label and icon, and the root screen of its own navigation stack. */
private class Tab<T>(val tag: T, val label: String, val icon: ImageVector, val root: @Composable () -> Unit)

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
        containerColor = Bg,
        bottomBar = {
            Column {
                HorizontalDivider(thickness = 0.5.dp, color = Stroke)
                NavigationBar(containerColor = Bg, tonalElevation = 0.dp) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = tab.tag == selected,
                            onClick = {
                                if (tab.tag == selected) stacks.getValue(tab.tag).popToRoot() else select(tab.tag)
                            },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label, fontSize = 10.sp) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = TextColor,
                                selectedTextColor = TextColor,
                                unselectedIconColor = TabUnselected,
                                unselectedTextColor = TabUnselected,
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

@Composable
fun ClientTabs() {
    val session = AppSession
    Tabs(
        tabs = listOf(
            Tab(TabRouter.Client.home, "Home", Icons.Outlined.Home) { ClientHomeView() },
            Tab(TabRouter.Client.plan, "Plan", Icons.Outlined.FitnessCenter) { WorkoutPlanView() },
            Tab(TabRouter.Client.calendar, "Calendar", Icons.Outlined.CalendarToday) { MyCalendarView() },
            Tab(TabRouter.Client.messages, "Messages", Icons.Outlined.ChatBubbleOutline) {
                MessagesThreadView(
                    clientId = null,
                    otherName = session.me?.coach?.name ?: "Your coach",
                    subtitle = "Usually replies within an hour",
                )
            },
            Tab(TabRouter.Client.account, "Account", Icons.Outlined.Person) { AccountView() },
        ),
        selected = TabRouter.client,
        select = { TabRouter.client = it },
    )
}

@Composable
fun CoachTabs() {
    Tabs(
        tabs = listOf(
            Tab(TabRouter.Coach.today, "Today", Icons.Outlined.Schedule) { CoachTodayView() },
            Tab(TabRouter.Coach.clients, "Clients", Icons.Outlined.Group) { ClientsView() },
            Tab(TabRouter.Coach.schedule, "Schedule", Icons.Outlined.CalendarToday) { ScheduleView() },
            Tab(TabRouter.Coach.messages, "Messages", Icons.Outlined.ChatBubbleOutline) { CoachThreadsView() },
            Tab(TabRouter.Coach.guides, "Guides", Icons.AutoMirrored.Outlined.MenuBook) { GuidesView() },
        ),
        selected = TabRouter.coach,
        select = { TabRouter.coach = it },
    )
}
