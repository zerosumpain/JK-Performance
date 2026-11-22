package com.jkperformance.app.design

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jkperformance.app.R

/*
 * Atelier iconography (docs/design/atelier-spec.md, Iconography): every glyph
 * comes from [IconKey], backed by Material Symbols Rounded (wght 300, GRAD -25,
 * opsz 24) exported as vector drawables in FILL 0 and FILL 1 by
 * scripts/export-symbols.mjs. Filled variants mean done or selected, nothing
 * else. Glyphs are never boxed. No Icons.Outlined/Filled/AutoMirrored.
 */

/** One glyph, by meaning. [glyph] is the Material Symbol name; the drawables are its two fills. */
enum class IconKey(val glyph: String, @DrawableRes val outline: Int, @DrawableRes val filled: Int) {
    /** Tab: client Today. */
    today("sunny", R.drawable.ms_sunny_fill0, R.drawable.ms_sunny_fill1),
    /** Tab: client Progress. */
    progress("trending_up", R.drawable.ms_trending_up_fill0, R.drawable.ms_trending_up_fill1),
    /** Tab: JK (the monogram or portrait draws first; this is the last fallback). */
    jk("chat_bubble", R.drawable.ms_chat_bubble_fill0, R.drawable.ms_chat_bubble_fill1),
    /** Tab: coach Today. */
    coachToday("inbox", R.drawable.ms_inbox_fill0, R.drawable.ms_inbox_fill1),
    /** Tab: coach Clients. */
    clients("group", R.drawable.ms_group_fill0, R.drawable.ms_group_fill1),
    /** Tab: coach Messages. */
    messages("chat_bubble", R.drawable.ms_chat_bubble_fill0, R.drawable.ms_chat_bubble_fill1),
    /** Goals. */
    goal("flag", R.drawable.ms_flag_fill0, R.drawable.ms_flag_fill1),
    /** Milestone letter cards. */
    milestone("sports_score", R.drawable.ms_sports_score_fill0, R.drawable.ms_sports_score_fill1),
    /** Personal records. */
    record("military_tech", R.drawable.ms_military_tech_fill0, R.drawable.ms_military_tech_fill1),
    /** Progress photos. */
    photos("photo_library", R.drawable.ms_photo_library_fill0, R.drawable.ms_photo_library_fill1),
    /** Measurements. */
    measurement("straighten", R.drawable.ms_straighten_fill0, R.drawable.ms_straighten_fill1),
    /** Your week, calendars. */
    week("calendar_month", R.drawable.ms_calendar_month_fill0, R.drawable.ms_calendar_month_fill1),
    /** Calendar feed. */
    calendarFeed("event_repeat", R.drawable.ms_event_repeat_fill0, R.drawable.ms_event_repeat_fill1),
    /** Habit. */
    water("water_drop", R.drawable.ms_water_drop_fill0, R.drawable.ms_water_drop_fill1),
    /** Habit. */
    sleep("bedtime", R.drawable.ms_bedtime_fill0, R.drawable.ms_bedtime_fill1),
    /** Habit. */
    steps("directions_walk", R.drawable.ms_directions_walk_fill0, R.drawable.ms_directions_walk_fill1),
    /** Habit (Fuel). */
    protein("restaurant", R.drawable.ms_restaurant_fill0, R.drawable.ms_restaurant_fill1),
    /** Habit. */
    supplement("pill", R.drawable.ms_pill_fill0, R.drawable.ms_pill_fill1),
    /** Habit (energy, creatine). */
    energy("bolt", R.drawable.ms_bolt_fill0, R.drawable.ms_bolt_fill1),
    /** Habit. */
    mobility("self_improvement", R.drawable.ms_self_improvement_fill0, R.drawable.ms_self_improvement_fill1),
    /** Habit. */
    mindfulness("spa", R.drawable.ms_spa_fill0, R.drawable.ms_spa_fill1),
    /** Habit. */
    reading("menu_book", R.drawable.ms_menu_book_fill0, R.drawable.ms_menu_book_fill1),
    /** Habit. */
    sunlight("wb_twilight", R.drawable.ms_wb_twilight_fill0, R.drawable.ms_wb_twilight_fill1),
    /** Habit: anything else. */
    custom("check_circle", R.drawable.ms_check_circle_fill0, R.drawable.ms_check_circle_fill1),
    /** Badge: filled from Health (never red). */
    fromHealth("favorite", R.drawable.ms_favorite_fill0, R.drawable.ms_favorite_fill1),
    /** JK-granted rest day. */
    rest("bedtime_off", R.drawable.ms_bedtime_off_fill0, R.drawable.ms_bedtime_off_fill1),
    /** Session: workout. */
    workout("fitness_center", R.drawable.ms_fitness_center_fill0, R.drawable.ms_fitness_center_fill1),
    /** Session: one to one. */
    oneToOne("person", R.drawable.ms_person_fill0, R.drawable.ms_person_fill1),
    /** Session: video. */
    video("videocam", R.drawable.ms_videocam_fill0, R.drawable.ms_videocam_fill1),
    /** Session: group. */
    groupSession("groups", R.drawable.ms_groups_fill0, R.drawable.ms_groups_fill1),
    /** Book a session. */
    book("event_available", R.drawable.ms_event_available_fill0, R.drawable.ms_event_available_fill1),
    /** JK's letter. */
    letter("drafts", R.drawable.ms_drafts_fill0, R.drawable.ms_drafts_fill1),
    /** Weekly check-in. */
    checkIn("monitor_heart", R.drawable.ms_monitor_heart_fill0, R.drawable.ms_monitor_heart_fill1),
    /** Form. */
    form("description", R.drawable.ms_description_fill0, R.drawable.ms_description_fill1),
    /** Voice note. */
    voiceNote("graphic_eq", R.drawable.ms_graphic_eq_fill0, R.drawable.ms_graphic_eq_fill1),
    /** Play media. */
    play("play_circle", R.drawable.ms_play_circle_fill0, R.drawable.ms_play_circle_fill1),
    /** Form-check video. */
    formCheck("video_call", R.drawable.ms_video_call_fill0, R.drawable.ms_video_call_fill1),
    /** Meal photo, camera. */
    mealPhoto("photo_camera", R.drawable.ms_photo_camera_fill0, R.drawable.ms_photo_camera_fill1),
    /** Guide. */
    guide("auto_stories", R.drawable.ms_auto_stories_fill0, R.drawable.ms_auto_stories_fill1),
    /** Reply. */
    reply("reply", R.drawable.ms_reply_fill0, R.drawable.ms_reply_fill1),
    /** Coach reason: pain. */
    pain("healing", R.drawable.ms_healing_fill0, R.drawable.ms_healing_fill1),
    /** Coach reason: unread. */
    unread("chat_bubble", R.drawable.ms_chat_bubble_fill0, R.drawable.ms_chat_bubble_fill1),
    /** Coach reason: priority. */
    priority("arrow_circle_up", R.drawable.ms_arrow_circle_up_fill0, R.drawable.ms_arrow_circle_up_fill1),
    /** Coach reason: quiet. */
    quiet("bedtime_off", R.drawable.ms_bedtime_off_fill0, R.drawable.ms_bedtime_off_fill1),
    /** Coach reason: no training. */
    noTraining("fitness_center", R.drawable.ms_fitness_center_fill0, R.drawable.ms_fitness_center_fill1),
    /** Done. */
    done("check", R.drawable.ms_check_fill0, R.drawable.ms_check_fill1),
    /** Disclosure. */
    chevron("chevron_right", R.drawable.ms_chevron_right_fill0, R.drawable.ms_chevron_right_fill1),
    /** Add. */
    add("add", R.drawable.ms_add_fill0, R.drawable.ms_add_fill1),
    /** Trend. */
    trendUp("north_east", R.drawable.ms_north_east_fill0, R.drawable.ms_north_east_fill1),
    /** Trend. */
    trendFlat("east", R.drawable.ms_east_fill0, R.drawable.ms_east_fill1),
    /** Trend (slate or textSecondary, never red). */
    trendDown("south_east", R.drawable.ms_south_east_fill0, R.drawable.ms_south_east_fill1),
    /** Privacy only. */
    lock("lock", R.drawable.ms_lock_fill0, R.drawable.ms_lock_fill1),
    /** Settings. */
    settings("settings", R.drawable.ms_settings_fill0, R.drawable.ms_settings_fill1),

    // Transitional (phase 1): glyphs the existing screens still use. Phases 2 and 5 retire most of them.
    /** Back. */
    back("chevron_left", R.drawable.ms_chevron_left_fill0, R.drawable.ms_chevron_left_fill1),
    /** Disclosure open. */
    expand("expand_more", R.drawable.ms_expand_more_fill0, R.drawable.ms_expand_more_fill1),
    /** Disclosure close. */
    collapse("expand_less", R.drawable.ms_expand_less_fill0, R.drawable.ms_expand_less_fill1),
    /** Close. */
    close("close", R.drawable.ms_close_fill0, R.drawable.ms_close_fill1),
    /** Delete. */
    delete("delete", R.drawable.ms_delete_fill0, R.drawable.ms_delete_fill1),
    /** Edit. */
    edit("edit", R.drawable.ms_edit_fill0, R.drawable.ms_edit_fill1),
    /** Edit a date. */
    editCalendar("edit_calendar", R.drawable.ms_edit_calendar_fill0, R.drawable.ms_edit_calendar_fill1),
    /** Search. */
    search("search", R.drawable.ms_search_fill0, R.drawable.ms_search_fill1),
    /** More. */
    more("more_horiz", R.drawable.ms_more_horiz_fill0, R.drawable.ms_more_horiz_fill1),
    /** Send. */
    send("send", R.drawable.ms_send_fill0, R.drawable.ms_send_fill1),
    /** Share. */
    share("ios_share", R.drawable.ms_ios_share_fill0, R.drawable.ms_ios_share_fill1),
    /** Copy. */
    copy("content_copy", R.drawable.ms_content_copy_fill0, R.drawable.ms_content_copy_fill1),
    /** Download, export. */
    download("download", R.drawable.ms_download_fill0, R.drawable.ms_download_fill1),
    /** Undo. */
    undo("undo", R.drawable.ms_undo_fill0, R.drawable.ms_undo_fill1),
    /** Time. */
    clock("schedule", R.drawable.ms_schedule_fill0, R.drawable.ms_schedule_fill1),
    /** Billing. */
    card("credit_card", R.drawable.ms_credit_card_fill0, R.drawable.ms_credit_card_fill1),
    /** Habits list, plan features. */
    checklist("checklist", R.drawable.ms_checklist_fill0, R.drawable.ms_checklist_fill1),
    /** Warning (coach only). */
    warning("warning", R.drawable.ms_warning_fill0, R.drawable.ms_warning_fill1),
    /** System error. */
    error("error", R.drawable.ms_error_fill0, R.drawable.ms_error_fill1),
    /** Offline. */
    offline("cloud_off", R.drawable.ms_cloud_off_fill0, R.drawable.ms_cloud_off_fill1),
    /** Queued upload. */
    upload("cloud_upload", R.drawable.ms_cloud_upload_fill0, R.drawable.ms_cloud_upload_fill1),
    /** Notifications. */
    notifications("notifications", R.drawable.ms_notifications_fill0, R.drawable.ms_notifications_fill1),
    /** The web desk. */
    desktop("desktop_windows", R.drawable.ms_desktop_windows_fill0, R.drawable.ms_desktop_windows_fill1),
    /** Templates, programmes. */
    stack("layers", R.drawable.ms_layers_fill0, R.drawable.ms_layers_fill1),
    /** Swap. */
    swap("swap_horiz", R.drawable.ms_swap_horiz_fill0, R.drawable.ms_swap_horiz_fill1),
    /** Stop. */
    stop("stop_circle", R.drawable.ms_stop_circle_fill0, R.drawable.ms_stop_circle_fill1),
    /** Pause. */
    pause("pause", R.drawable.ms_pause_fill0, R.drawable.ms_pause_fill1),
    /** Start. */
    playArrow("play_arrow", R.drawable.ms_play_arrow_fill0, R.drawable.ms_play_arrow_fill1),
    /** Skip. */
    skip("fast_forward", R.drawable.ms_fast_forward_fill0, R.drawable.ms_fast_forward_fill1),
    /** Activity. */
    run("directions_run", R.drawable.ms_directions_run_fill0, R.drawable.ms_directions_run_fill1),
    /** Activity. */
    cycle("pedal_bike", R.drawable.ms_pedal_bike_fill0, R.drawable.ms_pedal_bike_fill1),
    /** Activity. */
    swim("pool", R.drawable.ms_pool_fill0, R.drawable.ms_pool_fill1),
    /** Activity. */
    rowing("rowing", R.drawable.ms_rowing_fill0, R.drawable.ms_rowing_fill1),
    /** Activity. */
    boxing("sports_mma", R.drawable.ms_sports_mma_fill0, R.drawable.ms_sports_mma_fill1),
    /** Activity. */
    cardio("sports_gymnastics", R.drawable.ms_sports_gymnastics_fill0, R.drawable.ms_sports_gymnastics_fill1),
    /** Activity. */
    stand("man", R.drawable.ms_man_fill0, R.drawable.ms_man_fill1),
    /** Calories, fat loss. */
    flame("local_fire_department", R.drawable.ms_local_fire_department_fill0, R.drawable.ms_local_fire_department_fill1),
    /** Tip. */
    idea("lightbulb", R.drawable.ms_lightbulb_fill0, R.drawable.ms_lightbulb_fill1),
    /** Health off. */
    heartOff("heart_broken", R.drawable.ms_heart_broken_fill0, R.drawable.ms_heart_broken_fill1),
    /** Waiting. */
    waiting("hourglass_empty", R.drawable.ms_hourglass_empty_fill0, R.drawable.ms_hourglass_empty_fill1),
    /** Raised hand. */
    handRaised("pan_tool", R.drawable.ms_pan_tool_fill0, R.drawable.ms_pan_tool_fill1),
    /** Challenges. */
    trophy("emoji_events", R.drawable.ms_emoji_events_fill0, R.drawable.ms_emoji_events_fill1),
    /** Verified. */
    verified("verified", R.drawable.ms_verified_fill0, R.drawable.ms_verified_fill1),
    /** Reminder. */
    alarm("alarm_on", R.drawable.ms_alarm_on_fill0, R.drawable.ms_alarm_on_fill1),
    /** Invite. */
    personAdd("person_add", R.drawable.ms_person_add_fill0, R.drawable.ms_person_add_fill1),
    /** Account. */
    account("account_circle", R.drawable.ms_account_circle_fill0, R.drawable.ms_account_circle_fill1),
    /** Rest. */
    bed("bed", R.drawable.ms_bed_fill0, R.drawable.ms_bed_fill1),
    /** Checked. */
    checkbox("check_box", R.drawable.ms_check_box_fill0, R.drawable.ms_check_box_fill1),
    /** Unchecked. */
    checkboxBlank("check_box_outline_blank", R.drawable.ms_check_box_outline_blank_fill0, R.drawable.ms_check_box_outline_blank_fill1),
    /** Target. */
    target("radio_button_checked", R.drawable.ms_radio_button_checked_fill0, R.drawable.ms_radio_button_checked_fill1),
    /** Up. */
    arrowUp("arrow_upward", R.drawable.ms_arrow_upward_fill0, R.drawable.ms_arrow_upward_fill1),
    /** Down. */
    arrowDown("arrow_downward", R.drawable.ms_arrow_downward_fill0, R.drawable.ms_arrow_downward_fill1),
    /** Stepper minus. */
    remove("remove", R.drawable.ms_remove_fill0, R.drawable.ms_remove_fill1),
    /** Picker. */
    unfold("unfold_more", R.drawable.ms_unfold_more_fill0, R.drawable.ms_unfold_more_fill1),
    /** Wearable. */
    watch("watch", R.drawable.ms_watch_fill0, R.drawable.ms_watch_fill1),
    /** Scale. */
    scale("monitor_weight", R.drawable.ms_monitor_weight_fill0, R.drawable.ms_monitor_weight_fill1),
    /** Conversations. */
    forum("forum", R.drawable.ms_forum_fill0, R.drawable.ms_forum_fill1),
    /** Varies. */
    shuffle("shuffle", R.drawable.ms_shuffle_fill0, R.drawable.ms_shuffle_fill1),
    /** Heart, fitness. */
    heart("favorite", R.drawable.ms_favorite_fill0, R.drawable.ms_favorite_fill1);

    companion object {
        private val byName = entries.associateBy { it.name }

        /**
         * The key for a name the server or an older screen sends: an IconKey
         * name ("water"), or one of the SF Symbol names habits and activities
         * were stored under before IconKey ("drop"). Anything unknown is the
         * custom habit check, chosen here on purpose rather than by a silent
         * fallback inside the icon loader.
         */
        fun fromSymbol(name: String?): IconKey = name?.let { byName[it] ?: SF_SYMBOLS[it] } ?: custom

        /** As [fromSymbol], or null for a name with no glyph (so a caller can choose its own). */
        fun fromSymbolOrNull(name: String?): IconKey? = name?.let { byName[it] ?: SF_SYMBOLS[it] }
    }
}

/** SF Symbol names (iOS, and habits stored before IconKey) to keys. */
private val SF_SYMBOLS: Map<String, IconKey> = mapOf(
    "arrow.down" to IconKey.arrowDown,
    "arrow.down.doc" to IconKey.download,
    "arrow.left.arrow.right" to IconKey.swap,
    "arrow.up" to IconKey.arrowUp,
    "arrow.up.right" to IconKey.trendUp,
    "arrow.right" to IconKey.trendFlat,
    "arrow.down.right" to IconKey.trendDown,
    "arrow.uturn.backward" to IconKey.undo,
    "arrowshape.turn.up.left" to IconKey.reply,
    "bed.double" to IconKey.bed,
    "bell" to IconKey.notifications,
    "bolt" to IconKey.energy,
    "bolt.heart" to IconKey.checkIn,
    "heart.text.square" to IconKey.checkIn,
    "book" to IconKey.reading,
    "book.closed" to IconKey.guide,
    "book.pages" to IconKey.guide,
    "bubble.left" to IconKey.messages,
    "bubble.left.fill" to IconKey.messages,
    "bubble.left.and.bubble.right" to IconKey.forum,
    "calendar" to IconKey.week,
    "calendar.badge.plus" to IconKey.book,
    "calendar.badge.clock" to IconKey.calendarFeed,
    "camera" to IconKey.mealPhoto,
    "chart.line.downtrend.xyaxis" to IconKey.trendDown,
    "chart.line.uptrend.xyaxis" to IconKey.progress,
    "chart.xyaxis.line" to IconKey.progress,
    "checklist" to IconKey.checklist,
    "checkmark" to IconKey.done,
    "checkmark.circle" to IconKey.custom,
    "checkmark.seal" to IconKey.verified,
    "checkmark.square.fill" to IconKey.checkbox,
    "square" to IconKey.checkboxBlank,
    "chevron.down" to IconKey.expand,
    "chevron.left" to IconKey.back,
    "chevron.right" to IconKey.chevron,
    "chevron.up" to IconKey.collapse,
    "circle.circle" to IconKey.target,
    "clock" to IconKey.clock,
    "clock.badge.checkmark" to IconKey.alarm,
    "creditcard" to IconKey.card,
    "desktopcomputer" to IconKey.desktop,
    "doc" to IconKey.form,
    "doc.on.doc" to IconKey.copy,
    "doc.text" to IconKey.form,
    "drop" to IconKey.water,
    "dumbbell" to IconKey.workout,
    "figure.strengthtraining.traditional" to IconKey.workout,
    "ellipsis" to IconKey.more,
    "envelope.open" to IconKey.letter,
    "exclamationmark.circle" to IconKey.error,
    "exclamationmark.triangle" to IconKey.warning,
    "exclamationmark.triangle.fill" to IconKey.warning,
    "figure.boxing" to IconKey.boxing,
    "figure.mind.and.body" to IconKey.mobility,
    "figure.flexibility" to IconKey.mobility,
    "figure.mixed.cardio" to IconKey.cardio,
    "figure.outdoor.cycle" to IconKey.cycle,
    "figure.pool.swim" to IconKey.swim,
    "figure.rower" to IconKey.rowing,
    "figure.run" to IconKey.run,
    "figure.stand" to IconKey.stand,
    "figure.walk" to IconKey.steps,
    "shoeprints.fill" to IconKey.steps,
    "flag" to IconKey.goal,
    "flag.checkered" to IconKey.milestone,
    "flame" to IconKey.flame,
    "forward" to IconKey.skip,
    "fork.knife" to IconKey.protein,
    "gearshape" to IconKey.settings,
    "hand.raised" to IconKey.handRaised,
    "heart" to IconKey.heart,
    "heart.fill" to IconKey.fromHealth,
    "heart.slash" to IconKey.heartOff,
    "hourglass" to IconKey.waiting,
    "house" to IconKey.today,
    "icloud.and.arrow.up" to IconKey.upload,
    "icloud.slash" to IconKey.offline,
    "leaf" to IconKey.mindfulness,
    "lightbulb" to IconKey.idea,
    "lock" to IconKey.lock,
    "magnifyingglass" to IconKey.search,
    "medal" to IconKey.record,
    "moon" to IconKey.sleep,
    "moon.zzz" to IconKey.rest,
    "paperplane" to IconKey.send,
    "paperplane.fill" to IconKey.send,
    "pause" to IconKey.pause,
    "pencil" to IconKey.edit,
    "person" to IconKey.oneToOne,
    "person.fill" to IconKey.oneToOne,
    "person.2" to IconKey.clients,
    "person.3" to IconKey.groupSession,
    "person.badge.plus" to IconKey.personAdd,
    "person.crop.circle" to IconKey.account,
    "photo.on.rectangle" to IconKey.photos,
    "pills" to IconKey.supplement,
    "play" to IconKey.playArrow,
    "play.fill" to IconKey.playArrow,
    "play.circle" to IconKey.play,
    "play.circle.fill" to IconKey.play,
    "plus" to IconKey.add,
    "ruler" to IconKey.measurement,
    "square.and.arrow.up" to IconKey.share,
    "square.and.pencil" to IconKey.edit,
    "square.stack" to IconKey.stack,
    "stop.circle" to IconKey.stop,
    "sun.max" to IconKey.today,
    "sunrise" to IconKey.sunlight,
    "text.bubble" to IconKey.messages,
    "text.bubble.fill" to IconKey.messages,
    "trash" to IconKey.delete,
    "trophy" to IconKey.trophy,
    "tray.full" to IconKey.coachToday,
    "video" to IconKey.video,
    "video.badge.plus" to IconKey.formCheck,
    "waveform" to IconKey.voiceNote,
    "xmark" to IconKey.close,
    "applewatch" to IconKey.watch,
    "scalemass" to IconKey.scale,
)

/**
 * A glyph at a fixed size: 24 in the tab bar and habit marks, 20 inline, 16 small,
 * 10 for badges ([JKSize]). `filled` cross-fades to the FILL 1 variant over 240ms
 * (instantly with animations off). Pass a [contentDescription] whenever the glyph
 * carries meaning on its own.
 */
@Composable
fun Glyph(
    icon: IconKey,
    modifier: Modifier = Modifier,
    size: Dp = JKSize.iconInline,
    tint: Color = LocalContentColor.current,
    filled: Boolean = false,
    contentDescription: String? = null,
) {
    val reduceMotion = rememberReduceMotion()
    val fill by animateFloatAsState(
        if (filled) 1f else 0f,
        animationSpec = tween(if (reduceMotion) 0 else JKMotion.FILL_FADE, easing = JKMotion.standardEasing),
        label = "fill",
    )
    val described = if (contentDescription != null) modifier.semantics { this.contentDescription = contentDescription } else modifier
    Box(described.size(size), contentAlignment = Alignment.Center) {
        if (fill < 1f) Icon(painterResource(icon.outline), null, Modifier.size(size).alpha(1f - fill), tint = tint)
        if (fill > 0f) Icon(painterResource(icon.filled), null, Modifier.size(size).alpha(fill), tint = tint)
    }
}

/**
 * A glyph sized to sit beside text in `style` (about 1.2 times its size, so it
 * follows the font scale), for icon-and-text runs such as [IconLabel].
 */
@Composable
fun Glyph(
    icon: IconKey,
    style: TextStyle,
    color: Color = LocalContentColor.current,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    contentDescription: String? = null,
) {
    val size = with(LocalDensity.current) { (style.fontSize * 1.2f).toDp() }.coerceIn(12.dp, 40.dp)
    Glyph(icon, modifier, size, color, filled, contentDescription)
}

/** The JK monogram (docs/design/brand/jk-monogram.svg), tinted. Accent for the signature, text colour elsewhere. */
@Composable
fun Monogram(modifier: Modifier = Modifier, size: Dp = JKSize.iconTab, tint: Color = JKColors.accent, contentDescription: String? = "JK") {
    Icon(painterResource(R.drawable.jk_monogram), contentDescription, modifier.size(size), tint = tint)
}
