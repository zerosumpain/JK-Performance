import Foundation

// Plan. Act. Review. payloads (docs/design/plan-act-review.md, "API contract
// (client)"). Every field is optional so a missing or older field never
// breaks a screen: the views fall back to quiet defaults.

/// A string the server may send as a plain string or as an object with
/// `text` (JK's line has been both).
struct LooseText: Decodable, Hashable {
    let text: String

    private struct Wrapped: Decodable { var text: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            text = s
        } else if let w = try? c.decode(Wrapped.self), let t = w.text {
            text = t
        } else {
            text = ""
        }
    }
}

// MARK: - GET /api/week

struct WeekPayload: Decodable {
    var date: String?
    var dateLabel: String?
    var dayName: String?
    var greeting: String?
    var firstName: String?
    var days: [WeekDayMark]?
    var today: WeekToday?
    var plan: WeekSession?
    var review: WeekSession?
    var footer: String?
    var unread: Int?
}

struct WeekDayMark: Decodable, Hashable {
    var date: String?
    var letter: String?
    var today: Bool?
    /// today | plan | review | nil
    var mark: String?
    var done: Bool?
}

struct WeekToday: Decodable {
    var title: String?
    var progress: Double?
    var workout: WeekWorkout?
    var habits: [WeekHabit]?
    var restDay: Bool?
    var coachLine: LooseText?
}

struct WeekWorkout: Decodable, Hashable {
    var id: String
    var title: String?
    var minutes: Int?
    var completed: Bool?
    var blocks: [WeekBlock]?
}

struct WeekBlock: Decodable, Hashable {
    var itemId: String?
    var label: String?
    var done: Bool?
}

struct WeekHabit: Decodable, Hashable, Identifiable {
    var id: String
    var name: String
    var iconKey: String?
    /// "check" (yes/no) or "count".
    var kind: String?
    var doneToday: Bool?
    var progress: Double?
    var target: Double?
    var value: Double?
    var unit: String?
    /// Monday..Sunday: true done, false not done, nil to come.
    var week: [Bool?]?

    var isCheck: Bool { (kind ?? "check") != "count" }
    var done: Bool { doneToday == true }
}

struct WeekSession: Decodable, Hashable {
    var bookingId: String?
    var title: String?
    var when: String?
    var start: String?
    /// 0 = Monday.
    var dayIndex: Int?
}

// MARK: - GET /api/direction

struct DirectionPayload: Decodable {
    var locked: Bool?
    var feature: String?
    var aim: String?
    var plannedOn: String?
    var plannedLabel: String?
    var season: Season?
    var priorities: [Priority]?
    var planning: PlanningSession?
    var prep: Prep?

    struct Season: Decodable {
        var start: String?
        var end: String?
        var today: String?
        var next: String?
        var labels: Labels?
        var progress: Double?
        var phaseWord: String?

        struct Labels: Decodable {
            var start: String?
            var next: String?
            var end: String?
        }
    }

    struct Priority: Decodable, Identifiable, Hashable {
        var id: String
        var title: String
        /// notyet | settling | building | strong
        var status: String?
        var statusWord: String?
        var progress: Double?

        var fraction: Double {
            if let progress { return progress }
            switch status {
            case "settling": return 0.33
            case "building": return 0.66
            case "strong": return 1
            default: return 0
            }
        }

        var word: String {
            if let statusWord { return statusWord }
            switch status {
            case "settling": return "Settling in"
            case "building": return "Building"
            case "strong": return "Strong"
            default: return "Not yet"
            }
        }
    }

    struct PlanningSession: Decodable {
        var bookingId: String?
        var when: String?
        var whenShort: String?
        var start: String?
    }
}

struct Prep: Decodable {
    var id: String?
    /// 0...100.
    var feeling: Int?
    var feelingWord: String?
    var easier: String?
    var inTheWay: String?
    var sharedAt: String?
}

/// PUT /api/direction/prep. Nil fields are left out.
struct PrepInput: Encodable {
    var feeling: Int?
    var easier: String?
    var inTheWay: String?
    var share: Bool?
}

enum PrepWords {
    /// 0-19 Hard going … 80-100 Flowing (the server's words, mirrored).
    static func word(_ feeling: Int) -> String {
        switch feeling {
        case ..<20: return "Hard going"
        case 20..<40: return "Up and down"
        case 40..<60: return "Okay"
        case 60..<80: return "Mostly good"
        default: return "Flowing"
        }
    }
}

// MARK: - GET /api/review

struct ReviewPayload: Decodable {
    var locked: Bool?
    var feature: String?
    var week: String?
    var label: String?
    var booking: Booking?
    var reflection: Reflection?
    var commitments: [Commitment]?
    var session: Session?

    struct Booking: Decodable {
        var bookingId: String?
        var when: String?
        var start: String?
    }

    struct Reflection: Decodable {
        /// 1...5.
        var feeling: Int?
        var feelingWord: String?
        var noticed: String?
        var sharedAt: String?
    }

    struct Commitment: Decodable, Identifiable, Hashable {
        var id: String
        var text: String
        /// kept | mostly | missed | nil
        var outcome: String?
    }

    struct Session: Decodable {
        var pending: Bool?
        var withLine: String?
        var notes: String?
        var letterId: String?
        var shape: MonthShape?
        var agreed: [Agreed]?
        var agreedWeek: String?
        var acceptedAt: String?

        enum CodingKeys: String, CodingKey {
            case pending, notes, letterId, shape, agreed, agreedWeek, acceptedAt
            case withLine = "with"
        }

        struct MonthShape: Decodable {
            var weeks: [ShapeWeek]?
            var trend: String?
        }

        struct ShapeWeek: Decodable, Hashable {
            var week: String?
            var feeling: Int?
            var word: String?
        }

        struct Agreed: Decodable, Identifiable, Hashable {
            var id: String
            var text: String
        }
    }
}

/// POST /api/review/reflection. Nil fields are left out; an outcome of nil
/// inside `outcomes` is sent as an explicit null (clears it).
struct ReflectionInput: Encodable {
    var feeling: Int?
    var noticed: String?
    var outcomes: [String: String?]?
    var share: Bool?

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    enum CodingKeys: String, CodingKey { case feeling, noticed, outcomes, share }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(feeling, forKey: .feeling)
        try c.encodeIfPresent(noticed, forKey: .noticed)
        try c.encodeIfPresent(share, forKey: .share)
        if let outcomes {
            var nested = c.nestedContainer(keyedBy: Key.self, forKey: .outcomes)
            for (id, value) in outcomes {
                if let value { try nested.encode(value, forKey: Key(stringValue: id)) } else { try nested.encodeNil(forKey: Key(stringValue: id)) }
            }
        }
    }
}

struct AcceptInput: Encodable {
    var week: String?
}

enum ReviewWords {
    static let feelings = ["Flat", "Stretched", "Steady", "Good", "Strong"]

    static func feeling(_ n: Int) -> String { feelings[min(max(n, 1), 5) - 1] }

    static func outcomeWord(_ outcome: String?) -> String? {
        switch outcome {
        case "kept": return "Kept"
        case "mostly": return "Mostly"
        case "missed": return "Missed"
        default: return nil
        }
    }

    /// none → kept → mostly → missed → none.
    static func next(_ outcome: String?) -> String? {
        switch outcome {
        case nil: return "kept"
        case "kept": return "mostly"
        case "mostly": return "missed"
        default: return nil
        }
    }
}

/// Numbers in words for "Three sets of eight".
enum NumberWords {
    private static let words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
                                "eighteen", "nineteen", "twenty"]

    static func word(_ n: Int) -> String { (0...20).contains(n) ? words[n] : "\(n)" }

    /// "Three sets of eight"; reps that aren't a whole number stay as written ("Three sets of 8-10").
    static func prescription(sets: Int, reps: String) -> String {
        let setWord = word(sets).capitalizedFirst
        let noun = sets == 1 ? "set" : "sets"
        let trimmed = reps.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return "\(setWord) \(noun)" }
        if let n = Int(trimmed) { return "\(setWord) \(noun) of \(word(n))" }
        return "\(setWord) \(noun) of \(trimmed)"
    }

    static func roman(_ n: Int) -> String {
        ["i", "ii", "iii", "iv", "v", "vi"][min(max(n, 0), 5)]
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
