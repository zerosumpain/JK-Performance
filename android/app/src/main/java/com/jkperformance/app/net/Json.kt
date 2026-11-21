package com.jkperformance.app.net

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * The one JSON configuration for the API (APIClient.encoder/decoder in Swift).
 *
 * - `ignoreUnknownKeys`: the server may add fields before the app knows them.
 * - `explicitNulls = false`: a null optional is left out of a request, like
 *   Swift's `encodeIfPresent`, and a missing optional decodes as null.
 * - `encodeDefaults = true`: non-null values are always sent even when they
 *   equal the Kotlin default (Swift always encodes them, e.g. `load: ""`).
 * - `coerceInputValues`: a null or unknown value for a field with a default
 *   falls back to the default instead of failing the whole screen.
 */
val ApiJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}

/**
 * ISO 8601 instants, read and written as APIClient.swift does: the server
 * sends `2026-11-21T09:00:00.000Z`; whole seconds and explicit offsets are
 * accepted too. Written back with milliseconds in UTC, exactly like Swift's
 * `ISO.fractional`. Calendar days ("YYYY-MM-DD") are not instants and stay
 * `String` in the models.
 */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    private val out: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun format(value: Instant): String = out.format(value)

    fun parse(text: String): Instant = try {
        OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant()
    } catch (e: DateTimeParseException) {
        throw IllegalArgumentException("Not an ISO 8601 instant: $text", e)
    }

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(format(value))
    override fun deserialize(decoder: Decoder): Instant = parse(decoder.decodeString())
}
