import Foundation

// Campaigns and guides, the client side (desk-v2.md F13, F14; contract
// docs/api/wp4-campaigns.md, "For the apps"). Days stay "YYYY-MM-DD" strings,
// money is integer pence. Decoded leniently: a field the server adds later
// never breaks the Today tab.

// MARK: - Guide blocks (F14)

/// One block of a coach-written guide. Text is plain: the only formatting is
/// `**bold**` and `_italic_`, drawn by `InlineMarkup`; nothing is ever HTML.
struct GuideBlock: Codable, Hashable {
    /// h | p | list | callout | image | video | audio | link | exercise | divider
    var t: String
    var text: String?
    /// bullet | number | check (lists)
    var style: String?
    var items: [String]?
    /// tip | warn | info (callouts)
    var tone: String?
    var mediaId: String?
    var caption: String?
    /// Media: the guide-scoped path the client may fetch. Links: an https URL.
    var url: String?
    var label: String?
    var exerciseId: String?

    init(t: String, text: String? = nil, style: String? = nil, items: [String]? = nil, tone: String? = nil,
         mediaId: String? = nil, caption: String? = nil, url: String? = nil, label: String? = nil, exerciseId: String? = nil) {
        self.t = t
        self.text = text
        self.style = style
        self.items = items
        self.tone = tone
        self.mediaId = mediaId
        self.caption = caption
        self.url = url
        self.label = label
        self.exerciseId = exerciseId
    }

    enum CodingKeys: String, CodingKey { case t, text, style, items, tone, mediaId, caption, url, label, exerciseId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t = (try? c.decode(String.self, forKey: .t)) ?? ""
        text = try? c.decodeIfPresent(String.self, forKey: .text)
        style = try? c.decodeIfPresent(String.self, forKey: .style)
        items = try? c.decodeIfPresent([String].self, forKey: .items)
        tone = try? c.decodeIfPresent(String.self, forKey: .tone)
        mediaId = try? c.decodeIfPresent(String.self, forKey: .mediaId)
        caption = try? c.decodeIfPresent(String.self, forKey: .caption)
        url = try? c.decodeIfPresent(String.self, forKey: .url)
        label = try? c.decodeIfPresent(String.self, forKey: .label)
        exerciseId = try? c.decodeIfPresent(String.self, forKey: .exerciseId)
    }

    /// The kinds this app draws; anything else is skipped.
    static let known: Set<String> = ["h", "p", "list", "callout", "image", "video", "audio", "link", "exercise", "divider"]

    /// A link block only opens https.
    var httpsURL: URL? { LinkScan.https(url) }
}

/// GET /api/guides/coach/:id → `{guide}`.
struct CoachGuide: Codable, Hashable, Identifiable {
    let id: String
    var title: String
    var summary: String?
    var tags: [String]?
    var readMinutes: Int?
    var blocks: [GuideBlock]
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey { case id, title, summary, tags, readMinutes, blocks, updatedAt }

    init(id: String, title: String, summary: String? = nil, blocks: [GuideBlock]) {
        self.id = id
        self.title = title
        self.summary = summary
        self.blocks = blocks
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? "Guide"
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        tags = try? c.decodeIfPresent([String].self, forKey: .tags)
        readMinutes = try? c.decodeIfPresent(Int.self, forKey: .readMinutes)
        blocks = (try? c.decodeIfPresent([GuideBlock].self, forKey: .blocks)) ?? []
        updatedAt = try? c.decodeIfPresent(Date.self, forKey: .updatedAt)
    }
}

struct CoachGuideResponse: Codable { let guide: CoachGuide }

// MARK: - Campaigns

/// An activity's guide: a linked guide (`id`, `title`) or inline `blocks`.
struct ActivityGuide: Codable, Hashable {
    var id: String?
    var title: String?
    var blocks: [GuideBlock]?

    var isEmpty: Bool { id == nil && (blocks ?? []).isEmpty }
}

/// `activityOut`: one dated thing to do.
struct CampaignActivity: Codable, Hashable, Identifiable {
    let id: String
    var day: Int
    /// "YYYY-MM-DD"
    var date: String?
    var title: String
    /// task | workout | habit | checkin | read | purchase | session | measure | custom
    var kind: String
    var detail: String?
    var points: Int?
    var required: Bool?
    var spendPence: Int?
    var guide: ActivityGuide?
    var done: Bool
    var doneAt: Date?
    var spentPence: Int?

    enum CodingKeys: String, CodingKey {
        case id, day, date, title, kind, detail, points, required, spendPence, guide, done, doneAt, spentPence
    }

    init(id: String, day: Int, date: String?, title: String, kind: String, done: Bool) {
        self.id = id
        self.day = day
        self.date = date
        self.title = title
        self.kind = kind
        self.done = done
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        day = (try? c.decode(Int.self, forKey: .day)) ?? 0
        date = try? c.decodeIfPresent(String.self, forKey: .date)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        kind = (try? c.decode(String.self, forKey: .kind)) ?? "custom"
        detail = try? c.decodeIfPresent(String.self, forKey: .detail)
        points = try? c.decodeIfPresent(Int.self, forKey: .points)
        required = Self.flag(c, .required)
        spendPence = try? c.decodeIfPresent(Int.self, forKey: .spendPence)
        guide = try? c.decodeIfPresent(ActivityGuide.self, forKey: .guide)
        done = Self.flag(c, .done) ?? false
        doneAt = try? c.decodeIfPresent(Date.self, forKey: .doneAt)
        spentPence = try? c.decodeIfPresent(Int.self, forKey: .spentPence)
    }

    /// A bool sent as true/false or 1/0.
    fileprivate static func flag(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> Bool? {
        if let b = try? c.decodeIfPresent(Bool.self, forKey: key) { return b }
        if let n = try? c.decodeIfPresent(Int.self, forKey: key) { return n != 0 }
        return nil
    }

    var isRequired: Bool { required ?? true }
    var guideRef: ActivityGuide? { guide.flatMap { $0.isEmpty ? nil : $0 } }
}

struct CampaignRef: Codable, Hashable {
    let id: String
    var name: String
    var tagline: String?
    var description: String?
    var coverUrl: String?
    /// fixed | rolling
    var startMode: String?
    var startsOn: String?
    var endsOn: String?
    var lengthDays: Int?
    var welcomeText: String?
}

struct CampaignRank: Codable, Hashable {
    var position: Int
    var of: Int
}

/// `MyEnrolment`: an active, paused or recently completed campaign.
struct MyEnrolment: Codable, Hashable, Identifiable {
    let id: String
    /// active | paused | completed (| waitlisted after an accept into a full campaign)
    var status: String
    var campaign: CampaignRef
    var day: Int?
    var lengthDays: Int?
    var startOn: String?
    var endsOn: String?
    var pct: Int?
    var points: Int?
    var today: [CampaignActivity]?
    var next: [CampaignActivity]?
    var rank: CampaignRank?
    var planUrl: String?

    var isActive: Bool { status == "active" }
}

struct KitLine: Codable, Hashable {
    var name: String
    var estPence: Int?
}

struct InvitationKit: Codable, Hashable {
    var required: [KitLine]
    var optional: [KitLine]
    var requiredPence: Int?
    var optionalPence: Int?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        required = (try? c.decodeIfPresent([KitLine].self, forKey: .required)) ?? []
        optional = (try? c.decodeIfPresent([KitLine].self, forKey: .optional)) ?? []
        requiredPence = try? c.decodeIfPresent(Int.self, forKey: .requiredPence)
        optionalPence = try? c.decodeIfPresent(Int.self, forKey: .optionalPence)
    }
}

/// `invitationOut`: what the client sees before committing.
struct CampaignInvitation: Codable, Hashable, Identifiable {
    let enrolmentId: String
    /// invited | waitlisted
    var status: String?
    var campaign: CampaignRef
    var feePence: Int?
    var discountPence: Int?
    var discountCode: String?
    var kit: InvitationKit?
    var expectedSpendPence: Int?
    /// nil: no capacity limit.
    var placesLeft: Int?
    var respondBy: String?
    var welcomeText: String?

    var id: String { enrolmentId }
    var isWaitlisted: Bool { status == "waitlisted" }
    /// The fee after any discount.
    var dueFeePence: Int { max(0, (feePence ?? 0) - (discountPence ?? 0)) }
}

/// GET /api/campaigns/mine.
struct CampaignsMine: Codable {
    var invitations: [CampaignInvitation]
    var enrolments: [MyEnrolment]

    init(invitations: [CampaignInvitation] = [], enrolments: [MyEnrolment] = []) {
        self.invitations = invitations
        self.enrolments = enrolments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        invitations = (try? c.decodeIfPresent([CampaignInvitation].self, forKey: .invitations)) ?? []
        enrolments = (try? c.decodeIfPresent([MyEnrolment].self, forKey: .enrolments)) ?? []
    }

    /// What Today shows: open invitations, then running campaigns, then ones just finished.
    var current: [MyEnrolment] { enrolments.filter { $0.status == "active" || $0.status == "paused" || $0.status == "waitlisted" } }
    var finished: [MyEnrolment] { enrolments.filter { $0.status == "completed" } }
    var isEmpty: Bool { invitations.isEmpty && enrolments.isEmpty }
}

struct CampaignPhase: Codable, Hashable, Identifiable {
    let id: String
    var name: String
    var startDay: Int
    var endDay: Int
    var summary: String?
    var startsOn: String?
    var guide: ActivityGuide?
}

struct CampaignKitItem: Codable, Hashable, Identifiable {
    let id: String
    var name: String
    var estPence: Int?
    var required: Bool?
    var url: String?
    var note: String?
    var position: Int?
    var bought: Bool?
    var spentPence: Int?

    var httpsURL: URL? { LinkScan.https(url) }
}

/// GET /api/campaigns/mine/:id. For an open invitation `enrolment` carries
/// `invitation` and no progress.
struct EnrolmentDetail: Codable {
    struct Enrolment: Codable, Hashable {
        let id: String
        var status: String
        var day: Int?
        var lengthDays: Int?
        var startOn: String?
        var endsOn: String?
        var pct: Int?
        var points: Int?
        var rank: CampaignRank?
        var planUrl: String?
        var invitation: CampaignInvitation?
    }

    var enrolment: Enrolment
    var campaign: CampaignRef
    var phases: [CampaignPhase]
    var activities: [CampaignActivity]
    var kit: [CampaignKitItem]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enrolment = try c.decode(Enrolment.self, forKey: .enrolment)
        campaign = try c.decode(CampaignRef.self, forKey: .campaign)
        phases = (try? c.decodeIfPresent([CampaignPhase].self, forKey: .phases)) ?? []
        activities = (try? c.decodeIfPresent([CampaignActivity].self, forKey: .activities)) ?? []
        kit = (try? c.decodeIfPresent([CampaignKitItem].self, forKey: .kit)) ?? []
    }
}

/// POST /api/campaigns/mine/:id/items/:itemId.
struct CampaignTickInput: Codable {
    var done: Bool
    var spentPence: Int? = nil
}

struct CampaignTickReply: Codable {
    var pct: Int?
    var points: Int?
    var pace: Double?
}

/// POST …/accept: `startOn` only for rolling campaigns.
struct CampaignAcceptInput: Codable { var startOn: String? = nil }
struct CampaignAcceptReply: Codable { var enrolment: MyEnrolment? }

// MARK: - Campaign words

enum CampaignText {
    /// "Day 24 of 84".
    static func dayOf(_ day: Int?, _ length: Int?) -> String? {
        guard let day, let length, length > 0 else { return nil }
        return "Day \(min(max(day, 1), length)) of \(length)"
    }

    /// "3rd of 4".
    static func rank(_ r: CampaignRank) -> String { "\(ordinal(r.position)) of \(r.of)" }

    static func ordinal(_ n: Int) -> String {
        let tens = (n / 10) % 10
        let suffix: String
        if tens == 1 { suffix = "th" } else {
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }

    /// The SF Symbol for an activity kind (monochrome, always beside its title).
    static func symbol(_ kind: String) -> String {
        switch kind {
        case "workout": return "figure.run"
        case "habit": return "repeat"
        case "checkin": return "heart.text.square"
        case "read": return "book.closed"
        case "purchase": return "bag"
        case "session": return "person.2"
        case "measure": return "ruler"
        case "task": return "checklist"
        default: return "circle.dashed"
        }
    }

    /// "Workout", "Read", "Buy".
    static func kindWord(_ kind: String) -> String {
        switch kind {
        case "workout": return "Workout"
        case "habit": return "Habit"
        case "checkin": return "Check-in"
        case "read": return "Read"
        case "purchase": return "Buy"
        case "session": return "Session"
        case "measure": return "Measure"
        case "task": return "Task"
        default: return "To do"
        }
    }

    /// Pounds typed as "12", "12.5" or "£12.99" → pence; nil when it is not money.
    static func pence(fromPounds text: String) -> Int? {
        let cleaned = text.trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "£", with: "")
            .replacingOccurrences(of: ",", with: "")
        guard !cleaned.isEmpty, let value = Double(cleaned), value >= 0, value < 100_000 else { return nil }
        return Int((value * 100).rounded())
    }
}
