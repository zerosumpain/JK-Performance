package com.jkperformance.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MonitorWeight
import androidx.compose.material.icons.outlined.Watch
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.jkperformance.app.design.ChromeButton
import com.jkperformance.app.design.Day
import com.jkperformance.app.design.ErrorBanner
import com.jkperformance.app.design.Eyebrow
import com.jkperformance.app.design.Fmt
import com.jkperformance.app.design.GhostButton
import com.jkperformance.app.design.IconTile
import com.jkperformance.app.design.JK
import com.jkperformance.app.design.JKRefreshable
import com.jkperformance.app.design.JKType
import com.jkperformance.app.design.Label
import com.jkperformance.app.design.Loadable
import com.jkperformance.app.design.PopularBadge
import com.jkperformance.app.design.ProgressView
import com.jkperformance.app.design.Sheet
import com.jkperformance.app.design.ScreenHeader
import com.jkperformance.app.design.Segmented
import com.jkperformance.app.design.SystemImage
import com.jkperformance.app.design.TopBar
import com.jkperformance.app.design.jkCard
import com.jkperformance.app.design.jkScreen
import com.jkperformance.app.design.navLink
import com.jkperformance.app.design.rounded
import com.jkperformance.app.design.semibold
import com.jkperformance.app.design.sfIcon
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.ActivitiesResponse
import com.jkperformance.app.net.AppSession
import com.jkperformance.app.net.HealthActivity
import com.jkperformance.app.net.HealthDevices
import com.jkperformance.app.net.Me
import com.jkperformance.app.net.Plan
import com.jkperformance.app.net.PlansResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

/** iOS's destructive red (systemRed, dark). */
private val Destructive = Color(0xFFFF453A)

/** The alert/action-sheet ground, as Theme's ErrorAlert. */
private val DialogGround = Color(0.17f, 0.17f, 0.17f)

/** iOS's switch green (systemGreen, dark): `.tint(.green)`. */
private val SwitchGreen = Color(0xFF30D158)

// MARK: - Account (client tab root)

@Composable
fun AccountView() {
    val session = AppSession
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var editingName by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var exportFile by remember { mutableStateOf<File?>(null) }
    var exporting by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // Mirrors Reminders.enabled, re-read after every change made here.
    var remindersOn by remember { mutableStateOf(Reminders.enabled) }

    val healthDetail = when {
        !HealthSync.optedIn -> "Not connected"
        session.me?.healthSharing == true -> "Connected · shared with ${session.me?.coach?.name ?: "your coach"}"
        else -> "Connected · only you"
    }
    val membershipDetail = session.me?.membership?.takeIf { it.isActive }?.let { m ->
        m.renewsOn?.let { "${m.displayName} · renews ${Fmt.dayMonth(it)}" } ?: m.displayName
    } ?: "No plan"

    suspend fun saveName() {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        try {
            val fresh: Me = APIClient.send("PATCH", "/api/me", body = mapOf("name" to trimmed))
            session.update(fresh)
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun export() {
        exporting = true
        try {
            val data = APIClient.data("/api/me/export")
            exportFile = withContext(Dispatchers.IO) {
                val dir = File(context.cacheDir, "export").apply { mkdirs() }
                File(dir, "jk-performance-export-${Day.today}.json").apply { writeBytes(data) }
            }
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            exporting = false
        }
    }

    suspend fun deleteAccount() {
        deleting = true
        try {
            session.deleteAccount()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            deleting = false
        }
    }

    JKRefreshable(onRefresh = { session.refreshMe() }, modifier = Modifier.jkScreen()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            ScreenHeader(eyebrow = "Account", title = session.me?.name ?: "Account") {
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(rounded(7.dp))
                        .clickable {
                            name = session.me?.name ?: ""
                            editingName = true
                        }
                        .border(1.dp, JK.stroke, rounded(7.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(sfIcon("pencil"), contentDescription = "Edit name", tint = JK.text, modifier = Modifier.size(20.dp))
                }
            }
            session.me?.email?.let { Text(it, style = JKType.caption, color = JK.tertiary) }
            if (session.canReturnToCoach) {
                ChromeButton(onClick = { scope.launch { session.returnToCoach() } }) {
                    Label("Back to coach", systemImage = "arrow.uturn.backward", style = LocalTextStyle.current, color = Color.Black)
                }
                Text("You're looking round as the demo client. Nothing here is a real client's data.",
                    style = JKType.caption2, color = JK.tertiary)
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AccountLink(title = "Membership", detail = membershipDetail, systemName = "creditcard") { MembershipView() }
                AccountLink(title = "Health Connect", detail = healthDetail, systemName = "heart") { HealthDevicesView() }
                Row(
                    Modifier.jkCard(padding = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconTile(systemName = "bell")
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Notifications", style = JKType.subheadline.semibold(), color = JK.text)
                        Text("Replies and feedback · an hour before sessions · Friday check-in",
                            style = JKType.caption2, color = JK.tertiary)
                    }
                    IOSSwitch(remindersOn) { on ->
                        remindersOn = on
                        scope.launch {
                            if (on) {
                                if (!Reminders.enable()) {
                                    error = "Notifications are off for JK Performance. Turn them on in Settings › Notifications."
                                }
                            } else {
                                Reminders.disable()
                            }
                            remindersOn = Reminders.enabled
                        }
                    }
                }
            }

            Eyebrow(text = "Your data")
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val file = exportFile
                if (file != null) {
                    RowLabel(
                        title = "Share your export", detail = file.name, systemName = "square.and.arrow.up",
                        trailing = "square.and.arrow.up",
                        modifier = Modifier.clickable { shareFile(context, file) },
                    )
                } else {
                    RowLabel(
                        title = "Export your data",
                        detail = if (exporting) "Preparing…" else "Everything stored about you, as JSON",
                        systemName = "arrow.down.doc",
                        trailing = if (exporting) null else "chevron.right",
                        modifier = Modifier.clickable(enabled = !exporting) { scope.launch { export() } },
                    )
                }
                RowLabel(
                    title = "Privacy policy", detail = "What we store and why", systemName = "hand.raised",
                    trailing = "arrow.up.right",
                    modifier = Modifier.clickable { uriHandler.openUri(APIClient.privacyURL) },
                )
                RowLabel(
                    title = "Delete account", detail = "Erases your account, workouts and photos",
                    systemName = "trash", trailing = if (deleting) null else "chevron.right",
                    modifier = Modifier.clickable(enabled = !deleting) { confirmDelete = true },
                )
            }

            error?.let { ErrorBanner(it) }
            GhostButton("Sign out", onClick = { scope.launch { session.signOut() } }, modifier = Modifier.padding(top = 20.dp))
        }
    }

    if (editingName) {
        NameAlert(
            name = name,
            onNameChange = { name = it },
            onCancel = { editingName = false },
            onSave = {
                editingName = false
                scope.launch { saveName() }
            },
        )
    }
    if (confirmDelete) {
        ConfirmationDialog(
            title = "Delete your account?",
            message = "This permanently erases your account and everything stored about you, photos included. It can't be undone.",
            destructive = "Delete account and all data",
            onConfirm = {
                confirmDelete = false
                scope.launch { deleteAccount() }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

/** The iPhone's ShareLink: the system share sheet with the export file. */
private fun shareFile(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.export", file)
    val send = Intent(Intent.ACTION_SEND)
        .setType("application/json")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(send, null))
    } catch (_: ActivityNotFoundException) {
        // Nothing on the phone can receive a file; the row stays for another try.
    }
}

/** `.alert("Your name")` with a text field, Cancel and Save. */
@Composable
private fun NameAlert(name: String, onNameChange: (String) -> Unit, onCancel: () -> Unit, onSave: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Your name", style = JKType.headline, color = JK.text) },
        text = {
            val style = JKType.body.copy(color = JK.text)
            BasicTextField(
                value = name,
                onValueChange = onNameChange,
                singleLine = true,
                textStyle = style,
                cursorBrush = SolidColor(JK.text),
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { field ->
                    Box(Modifier.fillMaxWidth().background(JK.cardRaised, rounded(8.dp)).padding(horizontal = 10.dp, vertical = 8.dp)) {
                        if (name.isEmpty()) Text("Name", style = style, color = JK.tertiary)
                        field()
                    }
                },
            )
        },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel", style = JKType.body, color = JK.text) } },
        confirmButton = { TextButton(onClick = onSave) { Text("Save", style = JKType.body.semibold(), color = JK.text) } },
        containerColor = DialogGround,
        shape = rounded(14.dp),
    )
}

/**
 * `.confirmationDialog(titleVisibility: .visible)` with a message, one
 * destructive action and Cancel — as a dark alert rather than an action sheet.
 */
@Composable
private fun ConfirmationDialog(title: String, message: String, destructive: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = JKType.headline, color = JK.text) },
        text = { Text(message, style = JKType.footnote, color = JK.secondary) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(destructive, style = JKType.body, color = Destructive) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", style = JKType.body.semibold(), color = JK.text) } },
        containerColor = DialogGround,
        shape = rounded(14.dp),
    )
}

/** SwiftUI's `Toggle` with `.tint(.green)`: white thumb, green track when on, grey when off. */
@Composable
private fun IOSSwitch(checked: Boolean, enabled: Boolean = true, onCheckedChange: (Boolean) -> Unit) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.White,
            checkedTrackColor = SwitchGreen,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = Color.White,
            uncheckedTrackColor = JK.track,
            uncheckedBorderColor = Color.Transparent,
            disabledCheckedThumbColor = Color.White,
            disabledCheckedTrackColor = SwitchGreen.copy(alpha = 0.5f),
            disabledUncheckedThumbColor = Color.White.copy(alpha = 0.6f),
            disabledUncheckedTrackColor = JK.track,
            disabledUncheckedBorderColor = Color.Transparent,
        ),
    )
}

/** An account row: icon tile, title over detail, and a trailing symbol (a spinner while it works). */
@Composable
private fun RowLabel(title: String, detail: String, systemName: String, trailing: String?, modifier: Modifier = Modifier) {
    Row(
        modifier.jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(systemName = systemName)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            Text(detail, style = JKType.caption2, color = JK.tertiary)
        }
        if (trailing != null) SystemImage(trailing, JKType.caption, JK.tertiary) else ProgressView(tint = JK.secondary, size = 16.dp)
    }
}

/** A NavigationLink row on the Account screen: icon tile, title over detail, chevron. */
@Composable
fun AccountLink(title: String, detail: String, systemName: String, destination: @Composable () -> Unit) {
    Row(
        Modifier.navLink(destination = destination).jkCard(padding = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(systemName = systemName)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = JKType.subheadline.semibold(), color = JK.text)
            Text(detail, style = JKType.caption2, color = JK.tertiary)
        }
        SystemImage("chevron.right", JKType.caption, JK.tertiary)
    }
}

// MARK: - Health & devices

/** The two symbols this screen names that Theme's SF Symbol table lacks. */
private fun glyph(name: String): ImageVector = when (name) {
    "applewatch" -> Icons.Outlined.Watch
    "scalemass" -> Icons.Outlined.MonitorWeight
    else -> sfIcon(name)
}

/** [IconTile] for a [glyph] name. */
@Composable
private fun GlyphTile(systemName: String, size: Dp) {
    val shape = rounded(10.dp)
    Box(
        Modifier.size(size).background(JK.cardRaised, shape).border(1.dp, JK.stroke, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(glyph(systemName), contentDescription = null, tint = JK.text, modifier = Modifier.size(size * 0.5f))
    }
}

/**
 * Third-party wearables reach JK Performance only through Health Connect,
 * so these rows explain rather than pretend to connect.
 */
private data class Wearable(val name: String, val detail: String, val systemName: String)

private val wearables = listOf(
    Wearable("Pixel or Galaxy Watch", "Fitbit or Samsung Health › Health Connect › on", "applewatch"),
    Wearable("WHOOP", "WHOOP app › Health Connect › on", "bolt.heart"),
    Wearable("Oura", "Oura app › Settings › Health Connect", "circle.circle"),
    Wearable("Garmin", "Garmin Connect › Connected apps › Health Connect", "figure.run"),
)

/**
 * Connect Health Connect, and say yes or no to the coach seeing it. Two
 * separate choices: connecting fills habits and progress for the client;
 * sharing lets the coach see daily figures and workouts too.
 */
@Composable
fun HealthDevicesView() {
    val session = AppSession
    val health = HealthSync
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val requestPermissions = rememberHealthPermissionRequest()
    var devices by remember { mutableStateOf<HealthDevices?>(null) }
    var activities by remember { mutableStateOf<List<HealthActivity>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmErase by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<HealthSync.Preview?>(null) }
    val isDemo = session.me?.demo == true
    val coachName = session.me?.coach?.name ?: "your coach"
    val sharing = devices?.sharing ?: session.me?.healthSharing ?: false

    suspend fun load() {
        devices = runCatching { APIClient.get<HealthDevices>("/api/health/devices") }.getOrNull()
        if (health.optedIn) {
            runCatching { APIClient.get<ActivitiesResponse>("/api/health/activities") }.getOrNull()?.let { activities = it.activities }
        }
    }

    suspend fun connect(share: Boolean) {
        busy = true
        try {
            if (health.connect(shareWithCoach = share, request = requestPermissions)) {
                error = null
                session.refreshMe()
                load()
            }
        } finally {
            busy = false
        }
    }

    suspend fun tryOnThisPhone() {
        busy = true
        try {
            health.preview(requestPermissions)?.let { preview = it }
        } finally {
            busy = false
        }
    }

    suspend fun share(on: Boolean) {
        busy = true
        try {
            devices = health.setSharing(on)
            error = null
            session.refreshMe()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            busy = false
        }
    }

    suspend fun erase() {
        busy = true
        try {
            health.disconnectAndErase()
            activities = emptyList()
            error = null
            session.refreshMe()
            load()
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        } finally {
            busy = false
        }
    }

    LaunchedEffect(Unit) { load() }
    // Health Connect may have been installed from the Play Store meanwhile.
    LifecycleResumeEffect(Unit) {
        health.refreshAvailability()
        onPauseOrDispose {}
    }

    Column(Modifier.jkScreen()) {
        TopBar()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Health Connect", style = JKType.title.semibold(), color = JK.text)
                Text(
                    if (health.optedIn) "Connected. Your habits and progress fill themselves in."
                    else "Connect once and your steps, sleep and workouts fill themselves in.",
                    style = JKType.caption,
                    color = JK.secondary,
                )
            }
            when {
                isDemo -> DemoTryIt(
                    preview = preview,
                    busy = busy,
                    onTry = { scope.launch { tryOnThisPhone() } },
                    onInstall = { health.openPlayStore(context) },
                )
                health.optedIn -> Connected(
                    coachName = coachName,
                    sharing = sharing,
                    sharingSince = devices?.sharingSince,
                    activityCount = devices?.activityCount,
                    activities = activities,
                    busy = busy,
                    onShare = { on -> scope.launch { share(on) } },
                    onSync = {
                        scope.launch {
                            health.sync()
                            load()
                        }
                    },
                    onDisconnect = { confirmErase = true },
                )
                else -> ConnectCard(
                    coachName = coachName,
                    busy = busy,
                    onConnect = { share -> scope.launch { connect(share) } },
                    onInstall = { health.openPlayStore(context) },
                )
            }
            (error ?: health.lastError)?.let { ErrorBanner(it) }

            Eyebrow(text = "Wearables · through Health Connect")
            Column(Modifier.jkCard(padding = 2.dp)) {
                wearables.forEach { device ->
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        GlyphTile(device.systemName, 30.dp)
                        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                            Text(device.name, style = JKType.caption.semibold(), color = JK.text)
                            Text(device.detail, style = JKType.caption2, color = JK.tertiary)
                        }
                    }
                }
            }
        }
    }

    if (confirmErase) {
        ConfirmationDialog(
            title = "Disconnect Health Connect?",
            message = "Stops syncing and deletes every day and workout sent so far, for you and $coachName. " +
                "Your Health Connect data itself isn't touched.",
            destructive = "Disconnect and delete synced data",
            onConfirm = {
                confirmErase = false
                scope.launch { erase() }
            },
            onDismiss = { confirmErase = false },
        )
    }
}

/** When Health Connect is missing or out of date: Google's Play Store route to it. */
@Composable
private fun InstallHealthConnect(onInstall: () -> Unit) {
    if (!HealthSync.available && HealthSync.installable) {
        GhostButton("Get Health Connect", onClick = onInstall)
    }
}

// MARK: Not connected yet

@Composable
private fun ConnectCard(coachName: String, busy: Boolean, onConnect: (Boolean) -> Unit, onInstall: () -> Unit) {
    val available = HealthSync.available
    Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ReadRow("figure.walk", "Steps, distance and active energy")
            ReadRow("bed.double", "Sleep")
            ReadRow("heart", "Resting and workout heart rate")
            ReadRow("scalemass", "Body weight")
            ReadRow("figure.run", "Workouts: runs, rides, gym sessions and classes")
        }
        Text("Read only: the app never writes to Health Connect.", style = JKType.caption2, color = JK.tertiary)
        ChromeButton(onClick = { onConnect(true) }, enabled = !busy && available) {
            if (busy) ProgressView(tint = Color.Black) else Text("Connect and share with $coachName")
        }
        GhostButton("Connect, but keep it to myself", onClick = { onConnect(false) }, enabled = !busy && available)
        InstallHealthConnect(onInstall)
        Text(
            "Sharing lets $coachName see your daily figures and workouts to tailor your plan. You can change either choice here at any time.",
            style = JKType.caption2,
            color = JK.tertiary,
        )
    }
}

@Composable
private fun ReadRow(symbol: String, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) {
            Icon(glyph(symbol), contentDescription = null, tint = JK.secondary, modifier = Modifier.size(20.dp))
        }
        Text(text, style = JKType.subheadline, color = JK.text)
    }
}

// MARK: Demo account: the real flow, kept on this phone

@Composable
private fun DemoTryIt(preview: HealthSync.Preview?, busy: Boolean, onTry: () -> Unit, onInstall: () -> Unit) {
    val available = HealthSync.available
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "This is the shared demo account, so nothing from this phone's Health Connect is sent. You can still try the real permission screen and see what the app would read.",
                style = JKType.caption,
                color = JK.secondary,
            )
            ChromeButton(onClick = onTry, enabled = !busy && available) {
                if (busy) ProgressView(tint = Color.Black) else Text(if (preview == null) "Try it on this phone" else "Read again")
            }
            if (!available) {
                Text("Health Connect isn't available on this device.", style = JKType.caption2, color = JK.tertiary)
            }
            InstallHealthConnect(onInstall)
        }

        if (preview != null) {
            Eyebrow(text = "Read from this phone · last 30 days · not sent")
            if (preview.isEmpty) {
                Text(
                    "Nothing could be read. If you said no to some types, change it in Health Connect › App permissions › JK Performance.",
                    style = JKType.caption,
                    color = JK.tertiary,
                )
            } else {
                Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PreviewRow("figure.walk", "Steps", preview.averageSteps?.let { "${Fmt.number(it, digits = 0)} a day · ${preview.stepDays} days" })
                    PreviewRow("bed.double", "Sleep", preview.averageSleepMinutes?.let { "${Fmt.duration(it.toDouble())} a night · ${preview.sleepNights} nights" })
                    PreviewRow("scalemass", "Weight", preview.latestWeight?.let { String.format(Locale.UK, "%.1f kg", it) })
                    PreviewRow("figure.run", "Workouts", if (preview.workouts.isEmpty()) null else "${preview.workouts.size}")
                }
                if (preview.workouts.isNotEmpty()) ActivityList(preview.workouts.take(6))
            }
        }
    }
}

@Composable
private fun PreviewRow(symbol: String, title: String, value: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(20.dp), contentAlignment = Alignment.Center) {
            Icon(glyph(symbol), contentDescription = null, tint = JK.secondary, modifier = Modifier.size(20.dp))
        }
        Text(title, style = JKType.subheadline, color = JK.text, modifier = Modifier.weight(1f))
        Text(value ?: "None", style = JKType.subheadline, color = if (value == null) JK.tertiary else JK.text)
    }
}

/** Up to six workouts in a card, hairlines between. */
@Composable
private fun ActivityList(items: List<HealthActivity>) {
    Column(Modifier.jkCard(padding = 4.dp)) {
        items.forEachIndexed { i, a ->
            ActivityRow(activity = a)
            if (i != items.lastIndex) HorizontalDivider(thickness = 0.5.dp, color = JK.stroke)
        }
    }
}

// MARK: Connected

@Composable
private fun Connected(
    coachName: String,
    sharing: Boolean,
    sharingSince: java.time.Instant?,
    activityCount: Int?,
    activities: List<HealthActivity>,
    busy: Boolean,
    onShare: (Boolean) -> Unit,
    onSync: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val health = HealthSync
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Share with $coachName", style = JKType.subheadline.semibold(), color = JK.text)
                    Text(
                        if (sharing) "Sees your daily figures and workouts" + (sharingSince?.let { " · since ${Fmt.dayMonth(it)}" } ?: "")
                        else "Only you see your Health Connect data",
                        style = JKType.caption2,
                        color = JK.tertiary,
                    )
                }
                IOSSwitch(sharing, enabled = !busy, onCheckedChange = onShare)
            }
            HorizontalDivider(thickness = 0.5.dp, color = JK.stroke)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Last synced", style = JKType.caption2, color = JK.tertiary)
                    Text(health.lastSync?.let { Fmt.relative(it) } ?: "Not yet", style = JKType.subheadline, color = JK.text)
                }
                GhostButton(onClick = onSync, modifier = Modifier.width(110.dp), enabled = !health.syncing) {
                    if (health.syncing) ProgressView(tint = JK.secondary, size = 16.dp) else Text("Sync now")
                }
            }
        }

        Eyebrow(text = "Recent workouts", trailing = if (activities.isEmpty()) null else "${activityCount ?: activities.size} synced")
        if (activities.isEmpty()) {
            Text("No workouts in the last four weeks. Anything your Watch, WHOOP or Garmin records shows up here.",
                style = JKType.caption, color = JK.tertiary)
        } else {
            ActivityList(activities.take(6))
        }

        GhostButton("Disconnect Health Connect", onClick = onDisconnect, enabled = !busy)
        Text("To stop Android sharing entirely: Health Connect › App permissions › JK Performance.",
            style = JKType.caption2, color = JK.tertiary)
    }
}

/** One Health Connect workout: icon, type, when, and the figures. */
@Composable
fun ActivityRow(activity: HealthActivity) {
    Row(
        Modifier.fillMaxWidth().padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(systemName = activitySymbol(activity.type), size = 32.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(activity.type, style = JKType.subheadline.semibold(), color = JK.text)
            Text("${Fmt.weekday(activity.start)} ${Fmt.dayMonth(activity.start)} · ${Fmt.time(activity.start)}",
                style = JKType.caption2, color = JK.tertiary)
        }
        Text(activity.detail, style = JKType.caption2, color = JK.secondary, textAlign = TextAlign.End)
    }
}

/** The SF Symbol for a workout type (Swift `ActivityRow.symbol`). */
fun activitySymbol(type: String): String = when (type) {
    "Running" -> "figure.run"
    "Walking", "Hiking" -> "figure.walk"
    "Cycling" -> "figure.outdoor.cycle"
    "Swimming" -> "figure.pool.swim"
    "Rowing" -> "figure.rower"
    "Yoga", "Pilates", "Flexibility", "Cooldown" -> "figure.mind.and.body"
    "Strength training", "Functional strength", "Core training", "Cross training" -> "dumbbell"
    "HIIT", "Mixed cardio" -> "bolt.heart"
    "Boxing", "Kickboxing", "Martial arts" -> "figure.boxing"
    else -> "figure.mixed.cardio"
}

// MARK: - Membership

private enum class Billing(val label: String) { monthly("Monthly"), annual("Annual") }

/**
 * Plan picker from /api/plans. Testing only: choosing a plan POSTs
 * /api/me/membership and takes no payment (real billing will need Play Billing).
 */
@Composable
fun MembershipView(preselect: String? = null) {
    val session = AppSession
    val scope = rememberCoroutineScope()
    var billing by remember { mutableStateOf(Billing.monthly) }
    var plans by remember { mutableStateOf<List<Plan>?>(null) }
    var picked by remember { mutableStateOf(preselect) }
    var showTour by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }

    val current = session.me?.membership?.plan ?: "none"
    val target = picked ?: current
    val buttonTitle = if (target == current) "Current plan" else {
        val name = plans?.firstOrNull { it.id == target }?.name ?: Fmt.planName(target)
        "Switch to $name (test, no charge)"
    }

    suspend fun load() {
        try {
            val reply: PlansResponse = APIClient.get("/api/plans")
            plans = reply.plans
            error = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            error = e.readable
        }
    }

    suspend fun choose() {
        val chosen = picked ?: return
        if (chosen == current) return
        saving = true
        try {
            val fresh: Me = APIClient.send("POST", "/api/me/membership", body = mapOf("plan" to chosen))
            session.update(fresh)
            picked = null
            saveError = null
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            saveError = e.readable
        } finally {
            saving = false
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.jkScreen()) {
        TopBar("Membership")
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier.size(44.dp).border(1.dp, JK.secondary, rounded(10.dp)),
                    contentAlignment = Alignment.Center,
                ) { Text("JK", style = JKType.headline, color = JK.text) }
                Text("Choose your plan", style = JKType.title2.semibold(), color = JK.text)
                Text("Testing build: switching plans takes no payment.", style = JKType.caption, color = JK.tertiary)
            }

            Row(
                Modifier.clip(rounded(JK.corner)).clickable { showTour = true }.jkCard(padding = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconTile(systemName = "book.pages")
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Take the tour", style = JKType.subheadline.semibold(), color = JK.text)
                    Text("What each plan includes, step by step", style = JKType.caption2, color = JK.tertiary)
                }
                SystemImage("chevron.right", JKType.caption, JK.tertiary)
            }

            Segmented(Billing.entries, billing, { billing = it }) { it.label }

            Loadable(plans, error, retry = { load() }) { list ->
                list.forEach { p ->
                    PlanCard(p, billing = billing, current = current, selected = target == p.id) { picked = p.id }
                }
            }

            session.me?.membership?.takeIf { it.isActive }?.let { m ->
                Column(Modifier.jkCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    m.renewsOn?.let { renews ->
                        Row {
                            Text("Renews", style = JKType.caption, color = JK.secondary, modifier = Modifier.weight(1f))
                            Text(Fmt.dayMonth(renews), style = JKType.caption, color = JK.secondary)
                        }
                    }
                    val left = m.creditsLeft
                    val total = m.creditsTotal
                    if (left != null && total != null) {
                        Row {
                            Text("Session credits", style = JKType.caption, color = JK.secondary, modifier = Modifier.weight(1f))
                            Text("$left of $total", style = JKType.caption, color = JK.secondary)
                        }
                    }
                }
            }

            saveError?.let { ErrorBanner(it) }
            ChromeButton(onClick = { scope.launch { choose() } }, enabled = !saving && target != current) {
                if (saving) ProgressView(tint = Color.Black) else Text(buttonTitle)
            }
            Text(
                "No charge is made while payments are off. Billing through Google Play comes later.",
                style = JKType.caption2,
                color = JK.tertiary,
                textAlign = TextAlign.Center,
            )
        }
    }

    if (showTour) {
        // Choosing a plan at the end of the tour picks it here.
        Sheet(onDismiss = { showTour = false }) {
            PlanTourView(onChoose = { id ->
                picked = id
                showTour = false
            })
        }
    }
}

@Composable
private fun PlanCard(p: Plan, billing: Billing, current: String, selected: Boolean, onPick: () -> Unit) {
    val shape = rounded(JK.corner)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .clickable(onClick = onPick)
            .background(JK.card, shape)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) JK.text else JK.stroke), shape)
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(p.name, style = JKType.subheadline.semibold(), color = JK.text)
                if (p.isFeatured) PopularBadge()
                if (p.id == current) {
                    Text(
                        "Current",
                        style = JKType.system(9, FontWeight.SemiBold),
                        color = Color.Black,
                        modifier = Modifier.background(JK.text, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(p.detail, style = JKType.caption2, color = JK.tertiary)
            if (p.credits > 0) Text("${p.credits} session credits / month", style = JKType.caption2, color = JK.tertiary)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            val pence = if (billing == Billing.monthly) p.monthlyPence else p.annualPence
            Text(if (pence == 0) "Free" else Fmt.pounds(pence), style = JKType.title3.semibold(), color = JK.text)
            if (pence > 0) {
                Text(if (billing == Billing.monthly) "/ month" else "/ year", style = JKType.caption2, color = JK.tertiary)
            }
        }
    }
}
