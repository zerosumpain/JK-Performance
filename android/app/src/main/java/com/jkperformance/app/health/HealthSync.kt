package com.jkperformance.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.jkperformance.app.design.Day
import com.jkperformance.app.net.APIClient
import com.jkperformance.app.net.HealthActivitiesInput
import com.jkperformance.app.net.HealthActivity
import com.jkperformance.app.net.HealthDevices
import com.jkperformance.app.net.HealthSample
import com.jkperformance.app.net.HealthSamplesInput
import com.jkperformance.app.net.SharingInput
import com.jkperformance.app.net.StoredResponse
import com.jkperformance.app.net.isCancellation
import com.jkperformance.app.net.readable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.Period
import kotlin.math.roundToLong
import kotlin.reflect.KClass

/**
 * Asks Health Connect for read access and returns what was granted. Health
 * Connect's permission screen needs an Activity, so a screen makes one with
 * [rememberHealthPermissionRequest] and hands it to [HealthSync.connect] /
 * [HealthSync.preview] (HealthKit's `requestAuthorization` needed none).
 */
typealias HealthPermissionRequest = suspend (Set<String>) -> Set<String>

/**
 * Reads the last 30 days from Health Connect and POSTs daily totals to
 * /api/health/samples, and workouts (runs, rides, gym sessions) to
 * /api/health/activities. WHOOP, Oura, Garmin and the watch apps reach the app
 * through Health Connect, so this is the only device integration. (The iPhone
 * app reads the same figures from Apple Health; the server can't tell apart.)
 *
 * Connecting stores the data for the client; whether their coach may see it
 * is a separate yes/no kept on the server (`PUT /api/health/sharing`).
 *
 * Sample ids are "<kind>-<YYYY-MM-DD>", so re-sending a day replaces it
 * server-side (the endpoint is idempotent on id). Runs on foreground at most
 * once per 15 minutes, and only after the person opts in.
 *
 * Properties are Compose state so screens follow along. Call [init] from
 * Application.onCreate before anything else touches it.
 */
object HealthSync {
    private const val OPT_IN_KEY = "jk.health.optIn"
    private const val LAST_SYNC_KEY = "jk.health.lastSync"
    private val throttle: Duration = Duration.ofMinutes(15)
    private const val DAYS = 30

    /** Google's Health Connect app: a Play Store install on Android 13 and below, built in from 14. */
    internal const val PROVIDER = "com.google.android.apps.healthdata"

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private val scope = MainScope()

    var optedIn: Boolean by mutableStateOf(false)
        private set
    var lastSync: Instant? by mutableStateOf(null)
        private set
    var syncing: Boolean by mutableStateOf(false)
        private set
    var lastError: String? by mutableStateOf(null)
        private set
    var lastStored: Int? by mutableStateOf(null)
        private set
    var lastActivities: Int? by mutableStateOf(null)
        private set

    /** Health Connect is on this phone and ready. Re-read with [refreshAvailability] (it can be installed meanwhile). */
    var available: Boolean by mutableStateOf(false)
        private set

    /** Health Connect could be installed or updated from the Play Store ([openPlayStore]). */
    var installable: Boolean by mutableStateOf(false)
        private set

    fun init(context: Context) {
        this.context = context.applicationContext
        prefs = this.context.getSharedPreferences("jk.health", Context.MODE_PRIVATE)
        optedIn = prefs.getBoolean(OPT_IN_KEY, false)
        lastSync = prefs.getLong(LAST_SYNC_KEY, 0L).takeIf { it > 0 }?.let(Instant::ofEpochMilli)
        refreshAvailability()
    }

    /** Re-checks Health Connect (call on resume: the person may have just installed it). */
    fun refreshAvailability() {
        val status = HealthConnectClient.getSdkStatus(context, PROVIDER)
        available = status == HealthConnectClient.SDK_AVAILABLE
        installable = status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
    }

    /** Google's documented route to install or update Health Connect: the Play Store, onboarding after. */
    fun openPlayStore(from: Context) {
        val market = Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding")
        val web = Uri.parse("https://play.google.com/store/apps/details?id=$PROVIDER")
        try {
            from.startActivity(Intent(Intent.ACTION_VIEW, market).setPackage("com.android.vending"))
        } catch (_: ActivityNotFoundException) {
            from.startActivity(Intent(Intent.ACTION_VIEW, web))
        }
    }

    private val client: HealthConnectClient get() = HealthConnectClient.getOrCreate(context)

    /** Every type read, and so every permission asked for (declared in the manifest too). */
    private val readTypes: List<KClass<out Record>> = listOf(
        StepsRecord::class,
        ActiveCaloriesBurnedRecord::class,
        RestingHeartRateRecord::class,
        WeightRecord::class,
        DistanceRecord::class,
        SleepSessionRecord::class,
        HeartRateRecord::class,
        ExerciseSessionRecord::class,
    )

    val permissions: Set<String> = readTypes.map { HealthPermission.getReadPermission(it) }.toSet()

    private const val UNAVAILABLE = "Health Connect isn't available on this device."
    private const val NOTHING_ALLOWED =
        "Health Connect access wasn't allowed. Allow it in Health Connect › App permissions › JK Performance."

    /**
     * Shows Health Connect's permission screen for anything not yet granted
     * and returns the full granted set. Unlike HealthKit, Android says what was
     * refused, so an empty set stops the connect rather than syncing nothing.
     */
    private suspend fun authorize(request: HealthPermissionRequest): Set<String> {
        val granted = client.permissionController.getGrantedPermissions()
        if (granted.containsAll(permissions)) return granted
        request(permissions)
        return client.permissionController.getGrantedPermissions()
    }

    /**
     * Connect: ask Health Connect for read access, record the coach-sharing
     * choice on the server, remember the opt-in, sync. Returns false if it didn't happen.
     */
    suspend fun connect(shareWithCoach: Boolean, request: HealthPermissionRequest): Boolean {
        refreshAvailability()
        if (!available) {
            lastError = UNAVAILABLE
            return false
        }
        return try {
            if (authorize(request).intersect(permissions).isEmpty()) {
                lastError = NOTHING_ALLOWED
                return false
            }
            setSharing(shareWithCoach)
            setOptIn(true)
            lastError = null
            sync()
            true
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            lastError = e.readable
            false
        }
    }

    /** What a read of this phone found, kept on the phone (the demo account). */
    data class Preview(
        val stepDays: Int,
        val averageSteps: Int?,
        val sleepNights: Int,
        val averageSleepMinutes: Int?,
        val latestWeight: Double?,
        val workouts: List<HealthActivity>,
    ) {
        val isEmpty: Boolean get() = stepDays == 0 && sleepNights == 0 && latestWeight == null && workouts.isEmpty()
    }

    /**
     * The demo account is shared (Play review signs in to it too), so nothing
     * from a real phone may reach it. This runs the real permission screen
     * and the real read of the last 30 days, and shows the result on the
     * phone only: no upload, no opt-in, no background sync.
     */
    suspend fun preview(request: HealthPermissionRequest): Preview? {
        refreshAvailability()
        if (!available) {
            lastError = UNAVAILABLE
            return null
        }
        return try {
            val granted = authorize(request)
            val samples = collect(granted)
            val acts = workouts(granted)
            val steps = samples.filter { it.kind == "steps" && it.value > 0 }
            val sleep = samples.filter { it.kind == "sleep" && it.value > 0 }
            val weight = samples.filter { it.kind == "weight" }.maxByOrNull { it.start }
            lastError = null
            Preview(
                stepDays = steps.size,
                averageSteps = if (steps.isEmpty()) null else (steps.sumOf { it.value } / steps.size).toInt(),
                sleepNights = sleep.size,
                averageSleepMinutes = if (sleep.isEmpty()) null else (sleep.sumOf { it.value } / sleep.size).toInt(),
                latestWeight = weight?.value,
                workouts = acts.sortedByDescending { it.start },
            )
        } catch (e: Exception) {
            if (e.isCancellation) throw e
            lastError = e.readable
            null
        }
    }

    /** The coach-sharing yes/no. Takes effect on the server at once. */
    suspend fun setSharing(share: Boolean): HealthDevices =
        APIClient.send("PUT", "/api/health/sharing", SharingInput(share = share))

    /**
     * Stops sending. Health Connect keeps the read permission until it's
     * changed in Health Connect › App permissions.
     */
    fun disable() {
        setOptIn(false)
    }

    /** Disconnect and erase everything synced so far (samples and workouts); sharing goes off with it. */
    suspend fun disconnectAndErase() {
        APIClient.send<HealthDevices>("DELETE", "/api/health/data")
        setOptIn(false)
        lastSync = null
        lastStored = null
        prefs.edit().remove(LAST_SYNC_KEY).apply()
    }

    private fun setOptIn(value: Boolean) {
        optedIn = value
        prefs.edit().putBoolean(OPT_IN_KEY, value).apply()
    }

    /** Foreground hook: sync when opted in and the last run is over 15 min old. */
    fun syncIfDue(force: Boolean = false) {
        refreshAvailability()
        if (!optedIn || !available || syncing || APIClient.token == null) return
        val last = lastSync
        if (!force && last != null && Duration.between(last, Instant.now()) < throttle) return
        scope.launch { sync() }
    }

    /**
     * Reads what Health Connect allows and uploads it in chunks of 200. Types
     * the person turned off are skipped rather than failing the run; a sync has
     * no screen to ask from, so a newly added type is asked for at the next
     * connect (the iPhone re-asks here because HealthKit can prompt anywhere).
     */
    suspend fun sync() {
        if (!optedIn || !available || syncing) return
        syncing = true
        try {
            val granted = client.permissionController.getGrantedPermissions()
            val samples = collect(granted)
            var stored = 0
            for (chunk in samples.chunked(200)) {
                val reply: StoredResponse = APIClient.send("POST", "/api/health/samples", HealthSamplesInput(samples = chunk))
                stored += reply.stored
            }
            val activities = workouts(granted)
            for (chunk in activities.chunked(200)) {
                APIClient.send<StoredResponse, HealthActivitiesInput>(
                    "POST", "/api/health/activities", HealthActivitiesInput(activities = chunk),
                )
            }
            lastStored = stored
            lastActivities = activities.size
            lastError = null
            val now = Instant.now()
            lastSync = now
            prefs.edit().putLong(LAST_SYNC_KEY, now.toEpochMilli()).apply()
        } catch (e: Exception) {
            if (!e.isCancellation) lastError = e.readable
        } finally {
            syncing = false
        }
    }

    // MARK: Reading

    private fun Set<String>.allows(type: KClass<out Record>) = contains(HealthPermission.getReadPermission(type))

    private fun twoPlaces(v: Double) = (v * 100).roundToLong() / 100.0

    private suspend fun collect(granted: Set<String>): List<HealthSample> {
        val end = LocalDateTime.now()
        val start = Day.add(-(DAYS - 1), end.toLocalDate()).atStartOfDay()
        val out = mutableListOf<HealthSample>()
        if (granted.allows(StepsRecord::class)) {
            out += daily(StepsRecord.COUNT_TOTAL, "steps", start, end) { it.toDouble() }
        }
        if (granted.allows(ActiveCaloriesBurnedRecord::class)) {
            out += daily(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, "activeKcal", start, end) { it.inKilocalories }
        }
        // Health Connect keeps one distance type for every activity; HealthKit's walking+running figure has no twin.
        if (granted.allows(DistanceRecord::class)) {
            out += daily(DistanceRecord.DISTANCE_TOTAL, "distance", start, end) { it.inKilometers }
        }
        if (granted.allows(RestingHeartRateRecord::class)) {
            out += daily(RestingHeartRateRecord.BPM_AVG, "restingHr", start, end) { it.toDouble() }
        }
        if (granted.allows(WeightRecord::class)) out += weights(start, end)
        if (granted.allows(SleepSessionRecord::class)) {
            val keepFrom = start.atZone(Day.zone).toInstant()
            out += sleep(Day.add(-1, keepFrom), Instant.now(), keepFrom)
        }
        return out
    }

    /** One sample per local day: the metric's total (or average) in that day's bucket. */
    private suspend fun <T : Any> daily(
        metric: AggregateMetric<T>, kind: String, start: LocalDateTime, end: LocalDateTime, value: (T) -> Double,
    ): List<HealthSample> {
        val buckets = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(metric),
                timeRangeFilter = TimeRangeFilter.between(start, end),
                timeRangeSlicer = Period.ofDays(1),
            ),
        )
        return buckets.mapNotNull { bucket ->
            val raw = bucket.result[metric] ?: return@mapNotNull null
            val dayStart = bucket.startTime.toLocalDate()
            HealthSample(
                id = "$kind-${Day.string(dayStart)}",
                kind = kind,
                start = dayStart.atStartOfDay(Day.zone).toInstant(),
                end = dayStart.plusDays(1).atStartOfDay(Day.zone).toInstant(),
                value = twoPlaces(value(raw)),
            )
        }
    }

    /** Weight is the day's most recent weigh-in, not an average (HealthKit's `.mostRecent`). */
    private suspend fun weights(start: LocalDateTime, end: LocalDateTime): List<HealthSample> {
        val records = readAll(WeightRecord::class, TimeRangeFilter.between(start, end))
        return records.groupBy { Day.string(it.time) }.map { (day, list) ->
            val latest = list.maxBy { it.time }
            val dayStart = Day.start(latest.time)
            HealthSample(
                id = "weight-$day",
                kind = "weight",
                start = dayStart.atStartOfDay(Day.zone).toInstant(),
                end = dayStart.plusDays(1).atStartOfDay(Day.zone).toInstant(),
                value = twoPlaces(latest.weight.inKilograms),
            )
        }
    }

    private suspend fun <T : Record> readAll(type: KClass<T>, range: TimeRangeFilter): List<T> {
        val out = mutableListOf<T>()
        var token: String? = null
        do {
            val page = client.readRecords(
                ReadRecordsRequest(recordType = type, timeRangeFilter = range, pageSize = 1000, pageToken = token),
            )
            out += page.records
            token = page.pageToken
        } while (token != null)
        return out
    }

    /**
     * The last 30 days of workouts. Ids are Health Connect's own record ids,
     * so a re-sync replaces rather than duplicates. Energy and distance come
     * from the app that recorded the session (a workout's own figures, as
     * HealthKit's workout statistics are); heart rate from whatever measured it.
     */
    private suspend fun workouts(granted: Set<String>): List<HealthActivity> {
        if (!granted.allows(ExerciseSessionRecord::class)) return emptyList()
        val end = Instant.now()
        val start = Day.start(end).minusDays((DAYS - 1).toLong()).atStartOfDay(Day.zone).toInstant()
        val found = client.readRecords(
            ReadRecordsRequest(
                recordType = ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, end),
                ascendingOrder = false,
                pageSize = 300,
            ),
        ).records
        return found.mapNotNull { w ->
            val minutes = Duration.between(w.startTime, w.endTime).seconds / 60.0
            if (minutes < 1) return@mapNotNull null
            val range = TimeRangeFilter.between(w.startTime, w.endTime)
            val origin = w.metadata.dataOrigin
            val own = aggregate(
                buildSet {
                    if (granted.allows(ActiveCaloriesBurnedRecord::class)) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                    if (granted.allows(DistanceRecord::class)) add(DistanceRecord.DISTANCE_TOTAL)
                },
                range, setOf(origin),
            )
            val hr = if (granted.allows(HeartRateRecord::class)) aggregate(setOf(HeartRateRecord.BPM_AVG), range) else null
            HealthActivity(
                id = w.metadata.id,
                type = name(w.exerciseType),
                start = w.startTime,
                end = w.endTime,
                minutes = (minutes * 10).roundToLong() / 10.0,
                kcal = own?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)?.inKilocalories?.let(::twoPlaces),
                distanceKm = own?.get(DistanceRecord.DISTANCE_TOTAL)?.inKilometers?.takeIf { it > 0 }?.let(::twoPlaces),
                avgHr = hr?.get(HeartRateRecord.BPM_AVG)?.toDouble()?.let(::twoPlaces),
                source = appName(origin).take(60),
            )
        }
    }

    private suspend fun aggregate(
        metrics: Set<AggregateMetric<*>>, range: TimeRangeFilter, origins: Set<DataOrigin> = emptySet(),
    ): AggregationResult? =
        if (metrics.isEmpty()) null
        else client.aggregate(AggregateRequest(metrics = metrics, timeRangeFilter = range, dataOriginFilter = origins))

    /** The recording app's name, as HealthKit's `source.name` gives it. */
    private fun appName(origin: DataOrigin): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(origin.packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        origin.packageName
    }

    /** Health Connect's exercise types under the names the iPhone sends for HealthKit's. */
    fun name(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Running"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walking"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hiking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING, ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "Stairs"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Strength training"
        ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS -> "Functional strength"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_BOOT_CAMP -> "Cross training"
        ExerciseSessionRecord.EXERCISE_TYPE_EXERCISE_CLASS -> "Mixed cardio"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "Pilates"
        ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING -> "Flexibility"
        ExerciseSessionRecord.EXERCISE_TYPE_BOXING -> "Boxing"
        ExerciseSessionRecord.EXERCISE_TYPE_MARTIAL_ARTS -> "Martial arts"
        ExerciseSessionRecord.EXERCISE_TYPE_DANCING -> "Dance"
        ExerciseSessionRecord.EXERCISE_TYPE_SOCCER -> "Football"
        ExerciseSessionRecord.EXERCISE_TYPE_RUGBY -> "Rugby"
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "Tennis"
        ExerciseSessionRecord.EXERCISE_TYPE_GOLF -> "Golf"
        ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL -> "Basketball"
        ExerciseSessionRecord.EXERCISE_TYPE_ROCK_CLIMBING -> "Climbing"
        else -> "Workout"
    }

    /** Asleep stages; a session written without stages counts whole, as HealthKit's "asleep, unspecified". */
    private val asleepStages = setOf(
        SleepSessionRecord.STAGE_TYPE_SLEEPING,
        SleepSessionRecord.STAGE_TYPE_LIGHT,
        SleepSessionRecord.STAGE_TYPE_DEEP,
        SleepSessionRecord.STAGE_TYPE_REM,
    )

    /**
     * Minutes asleep per night, credited to the day the night ends. Sources
     * overlap (a watch and Oura both write), so intervals are merged first.
     */
    private suspend fun sleep(start: Instant, end: Instant, keepFrom: Instant): List<HealthSample> {
        val sessions = readAll(SleepSessionRecord::class, TimeRangeFilter.between(start, end))
        val asleep = sessions.flatMap { s ->
            if (s.stages.isEmpty()) listOf(s.startTime to s.endTime)
            else s.stages.filter { it.stage in asleepStages }.map { it.startTime to it.endTime }
        }
        val byDay = asleep.filter { it.second >= keepFrom }.groupBy { Day.string(it.second) }
        return byDay.mapNotNull { (day, intervals) ->
            val merged = mutableListOf<Pair<Instant, Instant>>()
            for (interval in intervals.sortedBy { it.first }) {
                val last = merged.lastOrNull()
                if (last != null && interval.first <= last.second) {
                    merged[merged.lastIndex] = last.first to maxOf(last.second, interval.second)
                } else {
                    merged += interval
                }
            }
            val minutes = merged.sumOf { Duration.between(it.first, it.second).seconds / 60.0 }
            if (minutes <= 0 || merged.isEmpty()) return@mapNotNull null
            HealthSample(id = "sleep-$day", kind = "sleep", start = merged.first().first, end = merged.last().second,
                value = Math.round(minutes).toDouble())
        }
    }
}

/**
 * A [HealthPermissionRequest] bound to this screen: launches Health Connect's
 * permission screen and suspends until it returns the granted set.
 */
@Composable
fun rememberHealthPermissionRequest(): HealthPermissionRequest {
    var pending by remember { mutableStateOf<CompletableDeferred<Set<String>>?>(null) }
    val launcher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract(HealthSync.PROVIDER)) { granted ->
        pending?.complete(granted)
        pending = null
    }
    val current by rememberUpdatedState(launcher)
    return remember {
        { permissions ->
            val answer = CompletableDeferred<Set<String>>()
            pending = answer
            try {
                current.launch(permissions)
                answer.await()
            } catch (_: ActivityNotFoundException) {
                emptySet()
            }
        }
    }
}
