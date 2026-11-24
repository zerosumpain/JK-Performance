import Foundation

// Voice notes (desk-v2.md F19; contract docs/api/wp6-ai-voice.md, "Apps
// contract"). A voice note is a message with `kind == "voice"`: the bubble is
// chosen by kind, never by `mediaId` (voice messages carry no top-level media).
// The shape is decided by the server from the signed-in role: a client never
// receives the analysis fields, a coach gets them on GET/POST /api/messages.

/// The transcription state. An unknown value decodes as `failed`.
enum VoiceStatus: String, Codable, Hashable {
    case pending, done, failed, off, deleted

    init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? ""
        self = VoiceStatus(rawValue: raw) ?? .failed
    }
}

/// An action item from a client's note (coach view only).
struct VoiceAction: Codable, Hashable {
    var text: String
    /// coach | client
    var owner: String?
}

/// A risk flag from a client's note (coach view only), always shown in words.
struct VoiceFlag: Codable, Hashable {
    /// pain | injury | illness | mentalHealth | safeguarding | cancelIntent | billing
    var kind: String
    var quote: String?
    /// low | medium | high
    var severity: String?

    /// "Pain", "Low mood", "Wants to cancel".
    var label: String {
        switch kind {
        case "pain": return "Pain"
        case "injury": return "Injury"
        case "illness": return "Illness"
        case "mentalHealth": return "Low mood"
        case "safeguarding": return "Safeguarding"
        case "cancelIntent": return "Wants to cancel"
        case "billing": return "Billing"
        default: return kind.prefix(1).uppercased() + kind.dropFirst()
        }
    }

    /// Pain, injury, illness, low mood and safeguarding push the coach (F19).
    var isUrgent: Bool { ["pain", "injury", "illness", "mentalHealth", "safeguarding"].contains(kind) }
}

/// The `voice` block. Every field but `status` is optional.
struct VoiceInfo: Codable, Hashable {
    var mediaId: String?
    var url: String?
    var durationSec: Double?
    var status: VoiceStatus
    /// aiOff | quota | noConsent, only when status is off.
    var reason: String?
    var transcript: String?
    /// stub | openrouter
    var provider: String?
    var model: String?
    // Coach view, client notes that are done (a coach's own note: summary only).
    var summary: String?
    /// upbeat | steady | flat | low | stressed | unknown
    var mood: String?
    var sentiment: Double?
    var topics: [String]?
    var actions: [VoiceAction]?
    var flags: [VoiceFlag]?
    var listenedAt: Date?

    init(mediaId: String? = nil, url: String? = nil, durationSec: Double? = nil, status: VoiceStatus,
         reason: String? = nil, transcript: String? = nil, provider: String? = nil, model: String? = nil) {
        self.mediaId = mediaId
        self.url = url
        self.durationSec = durationSec
        self.status = status
        self.reason = reason
        self.transcript = transcript
        self.provider = provider
        self.model = model
    }

    enum CodingKeys: String, CodingKey {
        case mediaId, url, durationSec, status, reason, transcript, provider, model
        case summary, mood, sentiment, topics, actions, flags, listenedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = (try? c.decode(VoiceStatus.self, forKey: .status)) ?? .failed
        mediaId = try? c.decodeIfPresent(String.self, forKey: .mediaId)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
        durationSec = try? c.decodeIfPresent(Double.self, forKey: .durationSec)
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        transcript = try? c.decodeIfPresent(String.self, forKey: .transcript)
        provider = try? c.decodeIfPresent(String.self, forKey: .provider)
        model = try? c.decodeIfPresent(String.self, forKey: .model)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        mood = try? c.decodeIfPresent(String.self, forKey: .mood)
        sentiment = try? c.decodeIfPresent(Double.self, forKey: .sentiment)
        topics = try? c.decodeIfPresent([String].self, forKey: .topics)
        actions = try? c.decodeIfPresent([VoiceAction].self, forKey: .actions)
        flags = try? c.decodeIfPresent([VoiceFlag].self, forKey: .flags)
        listenedAt = try? c.decodeIfPresent(Date.self, forKey: .listenedAt)
    }

    /// A player is shown for every state but deleted.
    var playable: Bool { status != .deleted && (mediaId != nil || url != nil) }

    /// The server sent the coach's analysis (never on a client's phone).
    var hasAnalysis: Bool {
        summary != nil || mood != nil || !(topics ?? []).isEmpty || !(actions ?? []).isEmpty || !(flags ?? []).isEmpty
    }
}

/// PUT /api/voice/consent: `on` transcribes, `off` sends without.
struct VoiceConsentInput: Codable { var voice: String }
struct VoiceConsent: Codable, Hashable {
    /// ask | on | off
    var voice: String
    var at: Date?
}

/// POST /api/voice/:messageId/retry.
struct VoiceRetryReply: Codable { var voice: VoiceInfo }
/// POST /api/voice/:messageId/tasks.
struct VoiceTasksInput: Codable { var indexes: [Int]? }
struct VoiceTasksReply: Codable { var created: Int }

// MARK: - Words

/// The copy per state (contract, "Copy per state"). One table for both apps.
enum VoiceCopy {
    /// The line under the player. `forClient`: the signed-in person is a client.
    static func state(_ v: VoiceInfo, forClient: Bool) -> String {
        switch v.status {
        case .pending: return "Transcribing…"
        case .done:
            if v.transcript == nil { return "Transcript removed" }
            return v.provider == "stub" ? "Sample transcript (AI is off)" : "Automatic transcript, may contain mistakes"
        case .failed: return "Couldn't transcribe this one"
        case .deleted: return "Voice note deleted"
        case .off:
            switch v.reason {
            case "quota": return "Transcript not available today"
            case "noConsent": return forClient ? "You chose no transcription" : "Not transcribed"
            default: return "Transcripts are off"
            }
        }
    }

    /// A client's own untranscribed note offers "Change" (Account › Privacy).
    static func offersConsentChange(_ v: VoiceInfo, forClient: Bool) -> Bool {
        forClient && v.status == .off && v.reason == "noConsent"
    }

    /// "Voice note · 0:42".
    static func preview(seconds: Double?) -> String {
        guard let seconds else { return "Voice note" }
        return "Voice note · \(clock(seconds))"
    }

    /// 42 → "0:42", 75 → "1:15".
    static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }

    /// The mood in a word, or nil for unknown.
    static func mood(_ mood: String?) -> String? {
        switch mood {
        case "upbeat": return "Upbeat"
        case "steady": return "Steady"
        case "flat": return "Flat"
        case "low": return "Low"
        case "stressed": return "Stressed"
        default: return nil
        }
    }

    /// The one-time consent sheet (D16). The provider is named when the server says it.
    static func consent(provider: String?) -> String {
        let service = provider.map { "OpenRouter, using \($0)" } ?? "OpenRouter"
        return "Voice notes are transcribed and summarised for JK by an AI service (\(service)). The summary is seen only by JK."
    }

    /// The upload and send errors the contract lists, in the words to show.
    static func sendError(status: Int?, message: String) -> String {
        if status == 403 && (message == "not_enabled" || message.isEmpty || message == "You don't have access to that.") {
            return "Voice notes are off"
        }
        return message
    }
}

// MARK: - Refresh rule

/// While a voice note on screen is pending, refetch with `since` every 10 s
/// for up to 2 minutes (contract, "Refresh rule").
enum VoiceRefresh {
    static let fastInterval: TimeInterval = 10
    static let normalInterval: TimeInterval = 15
    static let window: TimeInterval = 120

    /// The next poll's wait. `pendingSince`: when a pending note was first seen.
    static func interval(anyPending: Bool, pendingSince: Date?, now: Date = Date()) -> TimeInterval {
        guard anyPending, let pendingSince, now.timeIntervalSince(pendingSince) < window else { return normalInterval }
        return fastInterval
    }

    /// `current` with every `updated` row replaced by id; rows not yet known are appended.
    static func merge<T: Identifiable>(_ current: [T], updated: [T]) -> [T] {
        guard !updated.isEmpty else { return current }
        var out = current
        var index = [T.ID: Int]()
        for (i, row) in out.enumerated() { index[row.id] = i }
        for row in updated {
            if let i = index[row.id] { out[i] = row } else {
                index[row.id] = out.count
                out.append(row)
            }
        }
        return out
    }
}
