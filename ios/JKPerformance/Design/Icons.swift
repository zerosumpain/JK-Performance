import SwiftUI

/// Every glyph in the app (docs/design/atelier-spec.md, "Iconography"): SF
/// Symbols at Regular weight, unboxed, hierarchical, tinted textSecondary.
/// Filled variants mean done or selected only. Android mirrors this in
/// design/Icons.kt with Material Symbols Rounded; the raw values are the names
/// the server stores for habits.
enum IconKey: String, CaseIterable, Codable {
    // Tabs
    case today, progress, jk, coachToday, clients, messages
    // Goals and progress
    case goal, milestone, record, photos, measurement, week, calendarFeed
    // Habits (the closed catalogue the coach picks from)
    case water, sleep, steps, protein, supplement, energy, mobility, mindfulness, reading, sunlight, custom
    // Habit states and badges
    case fromHealth, rest
    // Sessions
    case workout, oneToOne, video, group, book
    // Coach and feedback
    case letter, checkIn, form, voiceNote, play, formCheck, mealPhoto, guide, reply
    // Coach reasons
    case pain, unread, priority, quiet, noTraining
    // Utility
    case done, chevron, add, trendUp, trendFlat, trendDown, lock, settings

    /// The outline (idle) SF Symbol.
    var symbol: String {
        switch self {
        case .today: return "sun.max"
        case .progress: return "chart.line.uptrend.xyaxis"
        case .jk, .messages, .unread: return "bubble.left"
        case .coachToday: return "tray.full"
        case .clients: return "person.2"
        case .goal: return "flag"
        case .milestone: return "flag.checkered"
        case .record: return "medal"
        case .photos: return "photo.on.rectangle"
        case .measurement: return "ruler"
        case .week: return "calendar"
        case .calendarFeed: return "calendar.badge.clock"
        case .water: return "drop"
        case .sleep: return "moon"
        case .steps: return "figure.walk"
        case .protein: return "fork.knife"
        case .supplement: return "pills"
        case .energy: return "bolt"
        case .mobility: return "figure.flexibility"
        case .mindfulness: return "leaf"
        case .reading: return "book"
        case .sunlight: return "sunrise"
        case .custom: return "checkmark.circle"
        case .fromHealth: return "heart.fill"
        case .rest, .quiet: return "moon.zzz"
        case .workout, .noTraining: return "figure.strengthtraining.traditional"
        case .oneToOne: return "person.fill"
        case .video: return "video"
        case .group: return "person.3"
        case .book: return "calendar.badge.plus"
        case .letter: return "envelope.open"
        case .checkIn: return "heart.text.square"
        case .form: return "doc.text"
        case .voiceNote: return "waveform"
        case .play: return "play.circle.fill"
        case .formCheck: return "video.badge.plus"
        case .mealPhoto: return "camera"
        case .guide: return "book.closed"
        case .reply: return "arrowshape.turn.up.left"
        case .pain: return "bandage"
        case .priority: return "arrow.up.circle"
        case .done: return "checkmark"
        case .chevron: return "chevron.right"
        case .add: return "plus"
        case .trendUp: return "arrow.up.right"
        case .trendFlat: return "arrow.right"
        case .trendDown: return "arrow.down.right"
        case .lock: return "lock"
        case .settings: return "gearshape"
        }
    }

    /// The filled variant, for done or selected states. Symbols without one keep their outline.
    var filledSymbol: String {
        switch self {
        case .chevron, .add, .done, .trendUp, .trendFlat, .trendDown, .steps, .mobility,
             .workout, .noTraining, .voiceNote, .progress, .fromHealth, .play, .oneToOne, .protein,
             .week, .calendarFeed, .book, .formCheck:
            return symbol
        case .photos: return "photo.fill.on.rectangle.fill"
        case .custom: return "checkmark.circle.fill"
        case .milestone: return "flag.checkered"
        default: return symbol + ".fill"
        }
    }

    /// What VoiceOver says for the glyph on its own.
    var accessibilityName: String {
        switch self {
        case .jk: return "JK, your coach"
        case .fromHealth: return "From Apple Health"
        case .rest: return "Rest day"
        case .protein: return "Fuel"
        case .oneToOne: return "One to one"
        default:
            // camelCase to words: "voiceNote" -> "Voice note".
            let words = rawValue.reduce(into: "") { out, ch in
                if ch.isUppercase { out += " " + ch.lowercased() } else { out.append(ch) }
            }
            return words.prefix(1).uppercased() + words.dropFirst()
        }
    }

    /// The key for a stored habit icon: an IconKey name, or a legacy SF Symbol
    /// name from before the catalogue. Unknown names fall back to `custom`.
    init(stored: String?) {
        guard let stored, !stored.isEmpty else { self = .custom; return }
        if let key = IconKey(rawValue: stored) { self = key; return }
        let base = stored.replacingOccurrences(of: ".fill", with: "")
        switch base {
        case "drop", "waterbottle", "cup.and.saucer": self = .water
        case "moon", "bed.double", "moon.stars": self = .sleep
        case "figure.walk", "shoeprints", "figure.run": self = .steps
        case "fork.knife", "carrot", "takeoutbag.and.cup.and.straw", "leaf.arrow.circlepath": self = .protein
        case "pills", "pill", "cross.vial": self = .supplement
        case "bolt", "bolt.heart": self = .energy
        case "figure.flexibility", "figure.yoga", "figure.cooldown": self = .mobility
        case "leaf", "brain.head.profile", "brain": self = .mindfulness
        case "book", "book.closed", "books.vertical": self = .reading
        case "sunrise", "sun.max", "sun.horizon": self = .sunlight
        case "dumbbell", "figure.strengthtraining.traditional": self = .workout
        default:
            self = IconKey.allCases.first { $0.symbol == base || $0.symbol == stored } ?? .custom
        }
    }
}

/// One glyph, unboxed. Hierarchical rendering, tinted textSecondary unless the
/// caller sets a foreground style; `filled` swaps to the done/selected variant.
struct Icon: View {
    let key: IconKey
    var filled = false
    var size: CGFloat = JK.Size.iconInline
    /// The label for a glyph that carries meaning; nil hides it from VoiceOver.
    var label: String? = nil

    var body: some View {
        Image(systemName: filled ? key.filledSymbol : key.symbol)
            .symbolRenderingMode(.hierarchical)
            .font(.system(size: size, weight: .regular))
            .accessibilityLabel(label ?? key.accessibilityName)
            .accessibilityHidden(label == nil)
    }
}

/// An unboxed glyph from a raw SF Symbol name, in a fixed square so rows keep
/// their alignment. Replaces the boxed IconTile.
struct Glyph: View {
    let systemName: String
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: systemName)
            .symbolRenderingMode(.hierarchical)
            .font(.system(size: size * 0.5, weight: .regular))
            .foregroundStyle(JK.textSecondary)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
