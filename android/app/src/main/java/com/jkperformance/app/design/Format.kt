package com.jkperformance.app.design

import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.temporal.TemporalAdjusters
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Calendar days as the API speaks them: "YYYY-MM-DD" in the phone's local day.
 *
 * Swift's `Date` splits two ways here: an instant on the clock is a
 * [java.time.Instant], and a calendar day (what Swift gets from `Day.start`) is
 * a [LocalDate]. Functions that took a `Date` take either, so ported call sites
 * keep their shape. Weeks start on Monday (ISO), as the Swift calendar was set up.
 */
object Day {
    /** The phone's time zone, read each time so a zone change while running is honoured. */
    val zone: ZoneId get() = ZoneId.systemDefault()

    private val iso: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun string(date: LocalDate): String = date.format(iso)
    fun string(instant: Instant): String = string(start(instant))

    /** "2026-12-01" (or a longer timestamp that starts with one) → the day; null if it doesn't parse. */
    fun date(string: String): LocalDate? =
        try { LocalDate.parse(string.take(10), iso) } catch (_: DateTimeParseException) { null }

    val today: String get() = string(LocalDate.now(zone))

    /** The local day an instant falls on (Swift's start-of-day `Date`). */
    fun start(instant: Instant): LocalDate = instant.atZone(zone).toLocalDate()
    fun start(date: LocalDate): LocalDate = date

    fun add(days: Int, to: LocalDate): LocalDate = to.plusDays(days.toLong())
    /** Calendar days, not 24-hour blocks: the wall-clock time is kept across a clock change. */
    fun add(days: Int, to: Instant): Instant = to.atZone(zone).plusDays(days.toLong()).toInstant()

    /** Monday of the week holding `date`. */
    fun weekStart(date: LocalDate): LocalDate = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    fun weekStart(instant: Instant): LocalDate = weekStart(start(instant))

    fun week(of: LocalDate): List<LocalDate> {
        val monday = weekStart(of)
        return (0 until 7).map { add(it, monday) }
    }
    fun week(of: Instant): List<LocalDate> = week(start(of))

    fun monthStart(date: LocalDate): LocalDate = date.withDayOfMonth(1)
    fun monthStart(instant: Instant): LocalDate = monthStart(start(instant))

    fun same(a: LocalDate, b: LocalDate): Boolean = a == b
    fun same(a: Instant, b: Instant): Boolean = start(a) == start(b)
    fun same(a: Instant, b: LocalDate): Boolean = start(a) == b
    fun same(a: LocalDate, b: Instant): Boolean = a == start(b)

    /** 1 = Monday … 7 = Sunday (the API's weekday numbering). */
    fun isoWeekday(date: LocalDate): Int = date.dayOfWeek.value
    fun isoWeekday(instant: Instant): Int = isoWeekday(start(instant))

    /** `date` at "HH:mm", in the phone's zone. */
    fun at(date: LocalDate, time: String): Instant? {
        val parts = time.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size < 2) return null
        return try {
            date.atTime(LocalTime.of(parts[0], parts[1])).atZone(zone).toInstant()
        } catch (_: java.time.DateTimeException) {
            null
        }
    }
    fun at(instant: Instant, time: String): Instant? = at(start(instant), time)
}

/**
 * Display formatting, en-GB, in the phone's time zone — the same strings the
 * iPhone shows ("Monday 1 Dec", "14:05", "£12.50").
 */
object Fmt {
    private val gb: Locale = Locale.UK

    private fun pattern(p: String) = DateTimeFormatter.ofPattern(p, gb)
    private val longDayF = pattern("EEEE d MMM")
    private val shortDayF = pattern("EEE d MMM")
    private val dayMonthF = pattern("d MMM")
    private val dayMonthYearF = pattern("d MMM yyyy")
    private val monthYearF = pattern("MMM yyyy")
    private val monthNameF = pattern("MMMM")
    private val weekdayShortF = pattern("EEE")
    private val hourMinuteF = pattern("HH:mm")

    private fun local(i: Instant) = i.atZone(Day.zone)

    fun longDay(d: LocalDate): String = longDayF.format(d)
    fun longDay(d: Instant): String = longDayF.format(local(d))
    fun shortDay(d: LocalDate): String = shortDayF.format(d)
    fun shortDay(d: Instant): String = shortDayF.format(local(d))
    fun dayMonth(d: LocalDate): String = dayMonthF.format(d)
    fun dayMonth(d: Instant): String = dayMonthF.format(local(d))
    fun dayMonthYear(d: LocalDate): String = dayMonthYearF.format(d)
    fun dayMonthYear(d: Instant): String = dayMonthYearF.format(local(d))
    fun monthYear(d: LocalDate): String = monthYearF.format(d)
    fun monthYear(d: Instant): String = monthYearF.format(local(d))
    fun month(d: LocalDate): String = monthNameF.format(d)
    fun month(d: Instant): String = monthNameF.format(local(d))
    fun weekday(d: LocalDate): String = weekdayShortF.format(d)
    fun weekday(d: Instant): String = weekdayShortF.format(local(d))
    fun time(d: Instant): String = hourMinuteF.format(local(d))

    /** "2026-12-01" → "1 Dec", or the input if it doesn't parse. */
    fun dayMonth(s: String?): String {
        val d = s?.let(Day::date) ?: return s ?: ""
        return dayMonth(d)
    }

    /** Whole pounds drop the pence: 1200 → "£12", 1250 → "£12.50". */
    fun pounds(pence: Int): String {
        val f = NumberFormat.getCurrencyInstance(gb)
        f.currency = Currency.getInstance("GBP")
        val digits = if (pence % 100 == 0) 0 else 2
        f.maximumFractionDigits = digits
        f.minimumFractionDigits = digits
        return f.format(pence / 100.0)
    }

    /**
     * 2.0 → "2", 2.15 → "2.2", 8420 → "8,420". Rounds the decimal as written
     * (half-even, like NSNumberFormatter) rather than its binary approximation,
     * so 2.15 rounds up as it does on the iPhone.
     */
    fun number(value: Number, digits: Int = 1): String {
        val d = value.toDouble()
        if (!d.isFinite()) return d.toString()
        val f = NumberFormat.getNumberInstance(gb)
        f.maximumFractionDigits = digits
        f.minimumFractionDigits = 0
        f.roundingMode = RoundingMode.HALF_EVEN
        return f.format(BigDecimal(value.toString()))
    }

    /** Signed delta: "−4.1", "+12" (a true minus sign, as on the iPhone). */
    fun delta(value: Number, digits: Int = 1): String {
        val d = value.toDouble()
        val n = number(abs(d), digits)
        return when {
            d < 0 -> "−$n"
            d > 0 -> "+$n"
            else -> n
        }
    }

    fun initials(name: String): String {
        val letters = name.split(" ").filter { it.isNotEmpty() }.take(2).map { it.first() }
        return if (letters.isEmpty()) "?" else letters.joinToString("").uppercase(gb)
    }

    /** 125 → "2h 05m". */
    fun minutes(total: Double): String {
        val m = total.roundToInt()
        return "${m / 60}h ${"%02d".format(m % 60)}m"
    }

    /** "32 min", or "1h 05m" from an hour. */
    fun duration(minutes: Double): String {
        val m = minutes.roundToInt()
        return if (m < 60) "$m min" else "${m / 60}h ${"%02d".format(m % 60)}m"
    }

    /**
     * "5 min ago", "in 2 days": ICU's short relative style with CLDR en-GB data,
     * the same source as iOS's RelativeDateTimeFormatter, counting in the
     * largest whole unit.
     */
    fun relative(date: Instant): String {
        val seconds = Duration.between(Instant.now(), date).seconds
        val direction = if (seconds < 0) RelativeDateTimeFormatter.Direction.LAST else RelativeDateTimeFormatter.Direction.NEXT
        val s = abs(seconds)
        val (quantity, unit) = when {
            s < 60 -> s to RelativeDateTimeFormatter.RelativeUnit.SECONDS
            s < 3_600 -> s / 60 to RelativeDateTimeFormatter.RelativeUnit.MINUTES
            s < 86_400 -> s / 3_600 to RelativeDateTimeFormatter.RelativeUnit.HOURS
            s < 7 * 86_400 -> s / 86_400 to RelativeDateTimeFormatter.RelativeUnit.DAYS
            s < 30 * 86_400 -> s / (7 * 86_400) to RelativeDateTimeFormatter.RelativeUnit.WEEKS
            s < 365 * 86_400 -> s / (30 * 86_400) to RelativeDateTimeFormatter.RelativeUnit.MONTHS
            else -> s / (365 * 86_400) to RelativeDateTimeFormatter.RelativeUnit.YEARS
        }
        return RelativeDateTimeFormatter
            .getInstance(ULocale.UK, null, RelativeDateTimeFormatter.Style.SHORT, android.icu.text.DisplayContext.CAPITALIZATION_NONE)
            .format(quantity.toDouble(), direction, unit)
    }

    /** "in 2h 16m" until a future instant; null once it has passed. */
    fun countdown(to: Instant): String? {
        val seconds = Duration.between(Instant.now(), to).seconds
        if (seconds <= 0) return null
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        return if (h > 0) "in ${h}h ${m}m" else "in ${m}m"
    }

    fun greeting(date: Instant = Instant.now()): String = when (date.atZone(Day.zone).hour) {
        in 5 until 12 -> "Morning"
        in 12 until 18 -> "Afternoon"
        else -> "Evening"
    }

    fun planName(id: String?): String {
        if (id == null || id == "none") return "No plan"
        return id.take(1).uppercase(gb) + id.drop(1)
    }
}

/** "12.5" or "12,5" → 12.5. */
fun parseNumber(text: String): Double? = text.trim().replace(",", ".").toDoubleOrNull()
