import SwiftUI

// The shared building blocks of first-run onboarding, the plan walkthrough and
// the coach's plan editor: one step scaffold, one choice card, one feature
// tile, one price label. Everything else in those screens is built from these
// and the theme (Theme.swift).

// MARK: - Catalogues

/// What the app draws for each answer and feature id the server knows.
enum OnboardingCatalog {
    struct Option: Identifiable, Hashable {
        let id: String
        let title: String
        var detail: String? = nil
        let systemName: String
    }

    static let goals: [Option] = [
        Option(id: "strength", title: "Get stronger", systemName: "dumbbell"),
        Option(id: "muscle", title: "Build muscle",
               systemName: symbol("figure.strengthtraining.traditional", fallback: "dumbbell")),
        Option(id: "fatloss", title: "Lose fat", systemName: "flame"),
        Option(id: "fitness", title: "Get fitter", systemName: "heart"),
        Option(id: "performance", title: "Perform in my sport", systemName: symbol("trophy", fallback: "bolt")),
        Option(id: "mobility", title: "Move better", systemName: symbol("figure.flexibility", fallback: "figure.walk")),
        Option(id: "health", title: "Feel healthier", systemName: "leaf"),
    ]

    static let experience: [Option] = [
        Option(id: "new", title: "New to training", detail: "Under a year, or coming back after a break",
               systemName: "figure.walk"),
        Option(id: "some", title: "Some experience", detail: "I train, but without a plan",
               systemName: "figure.run"),
        Option(id: "experienced", title: "Experienced", detail: "Years of structured training",
               systemName: symbol("figure.strengthtraining.traditional", fallback: "dumbbell")),
    ]

    static let times: [Option] = [
        Option(id: "morning", title: "Morning", systemName: "sunrise"),
        Option(id: "midday", title: "Midday", systemName: "sun.max"),
        Option(id: "evening", title: "Evening", systemName: "moon.stars"),
        Option(id: "varies", title: "It varies", systemName: "arrow.triangle.2.circlepath"),
    ]

    static func goal(_ id: String) -> Option? { goals.first { $0.id == id } }
    static func experienceOption(_ id: String) -> Option? { experience.first { $0.id == id } }
    static func time(_ id: String) -> Option? { times.first { $0.id == id } }

    /// The feature ids this version of the app has an icon and a preview for.
    static let knownFeatures: Set<String> = [
        "programme", "messaging", "habits", "progress", "checkin", "sessions", "nutrition", "priority", "guides",
    ]

    /// The icon for a feature id; a generic one for an id the app doesn't know yet.
    static func featureSymbol(_ id: String) -> String {
        switch id {
        case "programme": return "dumbbell"
        case "messaging": return "bubble.left.and.bubble.right"
        case "habits": return "checklist"
        case "progress": return "chart.line.uptrend.xyaxis"
        case "checkin": return symbol("list.clipboard", fallback: "checkmark.circle")
        case "sessions": return symbol("person.crop.circle.badge.clock", fallback: "calendar")
        case "nutrition": return symbol("fork.knife", fallback: "leaf")
        case "priority": return "bolt.fill"
        case "guides": return "book"
        default: return "sparkles"
        }
    }
}

// MARK: - Prices

enum PlanPrice {
    /// The saving of paying yearly, as a whole percentage; nil unless the
    /// annual price is under 12 × monthly.
    static func savePercent(monthly: Int, annual: Int) -> Int? {
        guard monthly > 0, annual > 0 else { return nil }
        let full = monthly * 12
        guard annual < full else { return nil }
        let pct = Int((Double(full - annual) / Double(full) * 100).rounded())
        return pct > 0 ? pct : nil
    }
}

/// "£59 / month", "£602 / year", or "Free".
struct PriceLabel: View {
    enum Period { case month, year }

    let pence: Int
    var period: Period = .month
    var font: Font = .title3.weight(.semibold)

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(pence == 0 ? "Free" : Fmt.pounds(pence))
                .font(font)
                .foregroundStyle(JK.text)
            if pence > 0 {
                Text(period == .month ? "/ month" : "/ year")
                    .font(.jkCaption)
                    .foregroundStyle(JK.textTertiary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Save 15%" next to an annual price.
struct SaveBadge: View {
    let percent: Int

    var body: some View {
        Text("Save \(percent)%")
            .font(.jkCaption.weight(.semibold))
            .foregroundStyle(JK.text)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .overlay(Capsule().stroke(JK.textSecondary, lineWidth: 1))
    }
}

/// The badge on the one featured plan.
struct PopularBadge: View {
    var body: some View {
        Text("Most popular")
            .font(.jkMicro.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(JK.primaryFill, in: Capsule())
            .foregroundStyle(JK.onPrimary)
    }
}

// MARK: - Step scaffold

/// The segmented progress at the top of each step: thin capsules, the ones
/// reached so far white.
struct ProgressTrack: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(count, 1), id: \.self) { i in
                Capsule()
                    .fill(i <= current ? JK.text : JK.track)
                    .frame(height: 3)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(current + 1) of \(count)")
    }
}

/// One onboarding step: Back, progress and Skip on top; a title and
/// subtitle; the step's content scrolling; the actions pinned at the bottom
/// (the chrome Continue first).
struct StepScaffold<Content: View, Actions: View>: View {
    let step: Int
    let count: Int
    let title: String
    let subtitle: String?
    let mark: Bool
    let back: (() -> Void)?
    let skip: (() -> Void)?
    let content: () -> Content
    let actions: () -> Actions

    init(step: Int, count: Int, title: String, subtitle: String?, mark: Bool = false,
         back: (() -> Void)?, skip: (() -> Void)?,
         @ViewBuilder content: @escaping () -> Content,
         @ViewBuilder actions: @escaping () -> Actions) {
        self.step = step
        self.count = count
        self.title = title
        self.subtitle = subtitle
        self.mark = mark
        self.back = back
        self.skip = skip
        self.content = content
        self.actions = actions
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    titleBlock
                    content()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            VStack(spacing: 8) {
                actions()
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .background(JK.bg)
            .overlay(alignment: .top) {
                Rectangle().fill(JK.hairline).frame(height: 1)
            }
        }
        .background(JK.bg.ignoresSafeArea())
    }

    private var topBar: some View {
        HStack(spacing: 14) {
            Button {
                if let back { back() }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.jkBody.weight(.semibold))
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(JK.text)
            .opacity(back == nil ? 0 : 1)
            .disabled(back == nil)
            .accessibilityLabel("Back")
            .accessibilityHidden(back == nil)

            ProgressTrack(count: count, current: step)

            Button {
                if let skip { skip() }
            } label: {
                Text("Skip")
                    .font(.jkCallout)
                    .frame(minWidth: 32, minHeight: 32)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(JK.textSecondary)
            .opacity(skip == nil ? 0 : 1)
            .disabled(skip == nil)
            .accessibilityHidden(skip == nil)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            if mark {
                JKMark(size: 64).padding(.bottom, 12)
            }
            Text(title)
                .font(.jkDisplay)
                .foregroundStyle(JK.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle)
                    .font(.jkCallout)
                    .foregroundStyle(JK.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Choice card

/// A selectable card (single or multi select): icon tile, title, one-line
/// detail, and a white 1.5pt edge with a check when selected. `stacked` lays
/// it out for a two-column grid.
struct ChoiceCard: View {
    let systemName: String
    let title: String
    var detail: String? = nil
    let selected: Bool
    var stacked = false
    let action: () -> Void

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: JK.corner, style: .continuous) }

    var body: some View {
        Button(action: action) {
            label
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(selected ? JK.raised : JK.surface, in: shape)
                .overlay(shape.stroke(selected ? JK.text : JK.hairline, lineWidth: selected ? 1.5 : 1))
                .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(detail.map { "\(title). \($0)" } ?? title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder
    private var label: some View {
        if stacked {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    Glyph(systemName: systemName, size: 36)
                    Spacer(minLength: 4)
                    CheckCircle(on: selected)
                }
                Text(title)
                    .font(.jkCallout.weight(.semibold))
                    .foregroundStyle(JK.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
            }
        } else {
            HStack(spacing: 12) {
                Glyph(systemName: systemName, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    if let detail {
                        Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                CheckCircle(on: selected)
            }
        }
    }
}

// MARK: - Features and plans

/// A feature's glyph, unboxed, keyed by feature id.
struct FeatureTile: View {
    let featureId: String
    var size: CGFloat = 38

    var body: some View {
        Glyph(systemName: OnboardingCatalog.featureSymbol(featureId), size: size)
    }
}

/// A compact feature row: tile, title and (optionally) its one-line detail.
struct FeatureRow: View {
    let feature: Feature
    var showDetail = true

    var body: some View {
        HStack(alignment: showDetail ? .top : .center, spacing: 12) {
            FeatureTile(featureId: feature.id, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(feature.title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                if showDetail {
                    Text(feature.detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A plan as a compact row: name, Most popular, tagline, price a month.
struct PlanRow: View {
    let plan: Plan

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(plan.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    if plan.isFeatured { PopularBadge() }
                }
                Text(plan.detail)
                    .font(.jkCaption)
                    .foregroundStyle(JK.textTertiary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            PriceLabel(pence: plan.monthlyPence, font: .headline)
        }
        .jkCard(padding: 12)
        .accessibilityElement(children: .combine)
    }
}

/// A numbered line ("1  Tell us about you").
struct NumberedRow: View {
    let number: Int
    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.jkCallout.weight(.semibold))
                .foregroundStyle(JK.text)
                .frame(width: 30, height: 30)
                .overlay(Circle().stroke(JK.textSecondary, lineWidth: 1))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                if let detail {
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 5)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
