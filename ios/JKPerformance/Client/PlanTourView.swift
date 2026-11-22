import Charts
import SwiftUI

/// The plan walkthrough: what coaching includes, plan by plan, built from
/// GET /api/plans. Pages: an overview, then for each paid plan a plan page,
/// "Everything in {previous}, plus…" and one page per feature it adds, then a
/// comparison table with a "Choose" button per plan. A strip of sections on
/// top jumps between them. Full screen; Close leaves it.
///
/// Opened from the end of onboarding, the client's Home (no plan yet), the
/// Membership screen, and the coach's plan editor ("Preview as a client").
struct PlanTourView: View {
    enum Mode {
        /// A client: Choose opens Membership with that plan picked.
        case client
        /// The coach looking at their own plans: Choose does nothing.
        case preview
    }

    let mode: Mode
    /// Membership screen: the chosen plan goes back to it instead of opening another.
    let onChoose: ((String) -> Void)?

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var data: PlansResponse?
    @State private var error: String?
    @State private var index = 0
    @State private var choosing: String?

    init(mode: Mode, initial: PlansResponse? = nil, onChoose: ((String) -> Void)? = nil) {
        self.mode = mode
        self.onChoose = onChoose
        _data = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let data {
                    tour(TourContent(data))
                } else {
                    VStack(spacing: 0) {
                        HStack {
                            Spacer()
                            closeButton
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        Spacer()
                        if let error {
                            ErrorCard(message: error) { await load() }.padding(16)
                        } else {
                            LoadingCard()
                        }
                        Spacer()
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(JK.bg.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(item: $choosing) { id in
                MembershipView(preselected: id)
            }
        }
        .task {
            if data == nil { await load() }
        }
    }

    private func load() async {
        do {
            data = try await APIClient.shared.get("/api/plans")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    // MARK: Frame

    private func tour(_ c: TourContent) -> some View {
        let at = min(max(index, 0), c.pages.count - 1)
        return VStack(spacing: 0) {
            header(c, at: at)
            pager(c, at: at)
            bottomBar(c, at: at)
        }
    }

    private var closeButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "xmark")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(JK.text)
                .frame(width: 32, height: 32)
                .background(JK.card, in: Circle())
                .overlay(Circle().stroke(JK.stroke, lineWidth: 1))
        }
        .accessibilityLabel("Close")
    }

    private func header(_ c: TourContent, at: Int) -> some View {
        let currentSection = c.sectionOfPage[at]
        return HStack(spacing: 10) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(c.sections) { s in
                            Chip(label: s.title, selected: s.number == currentSection) {
                                go(s.firstPage, in: c)
                            }
                            .id(s.id)
                            .accessibilityAddTraits(s.number == currentSection ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 2)
                }
                .onChange(of: currentSection) { _, section in
                    guard c.sections.indices.contains(section) else { return }
                    let target = c.sections[section].id
                    if reduceMotion {
                        proxy.scrollTo(target, anchor: .center)
                    } else {
                        withAnimation { proxy.scrollTo(target, anchor: .center) }
                    }
                }
            }
            closeButton
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private func pager(_ c: TourContent, at: Int) -> some View {
        if reduceMotion {
            // No paging animation: one page at a time, moved by the buttons and the strip.
            pageView(c.pages[at], c)
                .id(at)
        } else {
            TabView(selection: $index) {
                ForEach(c.pages.indices, id: \.self) { i in
                    pageView(c.pages[i], c)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    private func bottomBar(_ c: TourContent, at: Int) -> some View {
        let last = at >= c.pages.count - 1
        return VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button("Back") { go(at - 1, in: c) }
                    .buttonStyle(GhostButtonStyle())
                    .disabled(at == 0)
                    .opacity(at == 0 ? 0.4 : 1)
                if last {
                    Button("Done") { dismiss() }
                        .buttonStyle(ChromeButtonStyle())
                } else {
                    Button("Next") { go(at + 1, in: c) }
                        .buttonStyle(ChromeButtonStyle())
                }
            }
            Text("\(at + 1) of \(c.pages.count)")
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(JK.tertiary)
                .accessibilityLabel("Page \(at + 1) of \(c.pages.count)")
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(JK.bg)
        .overlay(alignment: .top) {
            Rectangle().fill(JK.stroke).frame(height: 1)
        }
    }

    private func go(_ page: Int, in c: TourContent) {
        let target = min(max(page, 0), c.pages.count - 1)
        if reduceMotion {
            index = target
        } else {
            withAnimation(.easeInOut(duration: 0.3)) { index = target }
        }
    }

    private func choose(_ planId: String) {
        switch mode {
        case .preview:
            return
        case .client:
            if let onChoose {
                onChoose(planId)
                dismiss()
            } else {
                choosing = planId
            }
        }
    }

    // MARK: Pages

    @ViewBuilder
    private func pageView(_ page: TourPage, _ c: TourContent) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                pageBody(page, c)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }

    @ViewBuilder
    private func pageBody(_ page: TourPage, _ c: TourContent) -> some View {
        switch page {
        case .overview:
            overviewPage(c)
        case .plan(let plan):
            planPage(plan)
        case .carried(let plan, let previous, let features):
            carriedPage(plan: plan, previous: previous, features: features)
        case .feature(let plan, let feature):
            featurePage(plan: plan, feature: feature)
        case .compare:
            comparePage(c)
        }
    }

    // Overview

    private var currentPlan: String {
        mode == .client ? (session.me?.membership?.plan ?? "none") : "none"
    }

    @ViewBuilder
    private func overviewPage(_ c: TourContent) -> some View {
        Eyebrow(text: "Coaching")
        Text("What coaching includes")
            .font(.largeTitle.weight(.semibold))
            .foregroundStyle(JK.text)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
        Text("Every plan comes with a coach who writes your training and keeps you to it. Here's what each one adds.")
            .font(.subheadline)
            .foregroundStyle(JK.secondary)
            .fixedSize(horizontal: false, vertical: true)
        if let free = c.free {
            freeCard(free, c)
        }
        Eyebrow(text: "Coaching plans")
        VStack(spacing: 8) {
            ForEach(c.paid) { p in
                Button {
                    if let s = c.sections.first(where: { $0.id == p.id }) { go(s.firstPage, in: c) }
                } label: {
                    PlanRow(plan: p)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows what \(p.name) includes")
            }
        }
    }

    private func freeCard(_ free: Plan, _ c: TourContent) -> some View {
        let features = c.features(free.featureIds)
        return VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: currentPlan == "none" ? "What you have now on \(free.name)" : "\(free.name) includes")
            if features.isEmpty {
                Text(free.detail).font(.subheadline).foregroundStyle(JK.secondary)
            } else {
                ForEach(features) { f in
                    FeatureRow(feature: f)
                }
            }
        }
        .jkCard()
    }

    // Plan

    @ViewBuilder
    private func planPage(_ plan: Plan) -> some View {
        HStack(spacing: 8) {
            Eyebrow(text: "Plan")
            if plan.isFeatured { PopularBadge() }
        }
        Text(plan.name)
            .font(.largeTitle.weight(.semibold))
            .foregroundStyle(JK.text)
            .accessibilityAddTraits(.isHeader)
        VStack(alignment: .leading, spacing: 8) {
            PriceLabel(pence: plan.monthlyPence, font: .title.weight(.semibold))
            if plan.annualPence > 0 {
                HStack(spacing: 8) {
                    Text("or").font(.caption).foregroundStyle(JK.tertiary)
                    PriceLabel(pence: plan.annualPence, period: .year, font: .subheadline.weight(.semibold))
                    if let pct = PlanPrice.savePercent(monthly: plan.monthlyPence, annual: plan.annualPence) {
                        SaveBadge(percent: pct)
                    }
                }
            }
        }
        .jkCard()
        Text(plan.pitch ?? plan.detail)
            .font(.body)
            .foregroundStyle(JK.text)
            .fixedSize(horizontal: false, vertical: true)
        if plan.credits > 0 {
            Label(plan.credits == 1 ? "1 session a month" : "\(plan.credits) sessions a month", systemImage: "calendar")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(JK.secondary)
        }
        Text("Tap Next to see what's included.")
            .font(.caption)
            .foregroundStyle(JK.tertiary)
            .padding(.top, 6)
    }

    // Everything in the previous plan

    @ViewBuilder
    private func carriedPage(plan: Plan, previous: Plan, features: [Feature]) -> some View {
        Eyebrow(text: plan.name)
        Text("Everything in \(previous.name), plus…")
            .font(.title.weight(.semibold))
            .foregroundStyle(JK.text)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
        VStack(alignment: .leading, spacing: 14) {
            ForEach(features) { f in
                FeatureRow(feature: f, showDetail: false)
            }
        }
        .jkCard()
    }

    // One new feature

    @ViewBuilder
    private func featurePage(plan: Plan, feature: Feature) -> some View {
        FeatureTile(featureId: feature.id, size: 72)
            .padding(.top, 4)
        VStack(alignment: .leading, spacing: 6) {
            Eyebrow(text: "New in \(plan.name)")
            Text(feature.title)
                .font(.title.weight(.semibold))
                .foregroundStyle(JK.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(feature.detail)
                .font(.subheadline)
                .foregroundStyle(JK.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let points = feature.points, !points.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(points, id: \.self) { point in
                    pointRow(point)
                }
            }
        }
        if OnboardingCatalog.knownFeatures.contains(feature.id) {
            Eyebrow(text: "Example")
                .padding(.top, 4)
            FeaturePreview(featureId: feature.id, credits: plan.credits)
        }
    }

    private func pointRow(_ point: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(JK.text)
                .frame(width: 16)
            Text(point)
                .font(.subheadline)
                .foregroundStyle(JK.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    // Compare

    @ViewBuilder
    private func comparePage(_ c: TourContent) -> some View {
        Eyebrow(text: "Compare")
        Text("Compare plans")
            .font(.title.weight(.semibold))
            .foregroundStyle(JK.text)
            .accessibilityAddTraits(.isHeader)
        CompareTable(plans: c.paid, features: c.comparedFeatures)
        VStack(spacing: 8) {
            ForEach(c.paid) { p in
                chooseButton(p)
            }
        }
        if mode == .preview {
            Text("Your clients choose their plan here. In this preview the buttons do nothing.")
                .font(.caption2).foregroundStyle(JK.tertiary)
        } else {
            Text("No charge is made while payments are off.")
                .font(.caption2).foregroundStyle(JK.tertiary)
        }
    }

    @ViewBuilder
    private func chooseButton(_ p: Plan) -> some View {
        let current = mode == .client && currentPlan == p.id
        let title = current ? "You're on \(p.name)" : "Choose \(p.name)"
        if p.isFeatured {
            Button(title) { choose(p.id) }
                .buttonStyle(ChromeButtonStyle())
                .disabled(current || mode == .preview)
        } else {
            Button(title) { choose(p.id) }
                .buttonStyle(GhostButtonStyle())
                .disabled(current || mode == .preview)
        }
    }
}

// MARK: - Page model

enum TourPage: Hashable {
    case overview
    case plan(Plan)
    case carried(plan: Plan, previous: Plan, features: [Feature])
    case feature(plan: Plan, feature: Feature)
    case compare
}

struct TourSection: Identifiable, Hashable {
    let id: String
    let title: String
    let number: Int
    let firstPage: Int
}

/// The walkthrough's pages and sections, worked out from the plans.
struct TourContent {
    let free: Plan?
    let paid: [Plan]
    let catalogue: [Feature]
    let pages: [TourPage]
    let sections: [TourSection]
    /// The section each page belongs to, by page index.
    let sectionOfPage: [Int]

    init(_ r: PlansResponse) {
        let catalogue = r.features ?? []
        let free = r.plans.first { $0.isFree }
        let paid = r.plans.filter { !$0.isFree }

        var pages: [TourPage] = [.overview]
        var sections = [TourSection(id: "overview", title: "Overview", number: 0, firstPage: 0)]
        var owner: [Int] = [0]
        var previous = free
        for plan in paid {
            let number = sections.count
            sections.append(TourSection(id: plan.id, title: plan.name, number: number, firstPage: pages.count))
            pages.append(.plan(plan))
            owner.append(number)
            let before = Set(previous?.featureIds ?? [])
            let carried = plan.featureIds.filter { before.contains($0) }.map { Self.feature($0, in: catalogue) }
            if let prior = previous, !carried.isEmpty {
                pages.append(.carried(plan: plan, previous: prior, features: carried))
                owner.append(number)
            }
            for id in plan.featureIds where !before.contains(id) {
                pages.append(.feature(plan: plan, feature: Self.feature(id, in: catalogue)))
                owner.append(number)
            }
            previous = plan
        }
        let compare = sections.count
        sections.append(TourSection(id: "compare", title: "Compare", number: compare, firstPage: pages.count))
        pages.append(.compare)
        owner.append(compare)

        self.free = free
        self.paid = paid
        self.catalogue = catalogue
        self.pages = pages
        self.sections = sections
        self.sectionOfPage = owner
    }

    /// The catalogue entry for an id; a plain one if the catalogue lacks it.
    static func feature(_ id: String, in catalogue: [Feature]) -> Feature {
        catalogue.first { $0.id == id }
            ?? Feature(id: id, title: id.prefix(1).uppercased() + id.dropFirst(), detail: "", points: nil)
    }

    /// Catalogue entries for these ids, in catalogue order.
    func features(_ ids: [String]) -> [Feature] {
        catalogue.filter { ids.contains($0.id) }
    }

    /// The features any paid plan has, for the comparison table.
    var comparedFeatures: [Feature] {
        let any = Set(paid.flatMap(\.featureIds))
        return catalogue.filter { any.contains($0.id) }
    }
}

// MARK: - Comparison table

/// Features down the side, paid plans across, a check where a plan has it;
/// then session credits and the monthly price.
struct CompareTable: View {
    let plans: [Plan]
    let features: [Feature]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 10) {
            GridRow {
                Color.clear.frame(width: 1, height: 1)
                ForEach(plans) { p in
                    Text(p.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(JK.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                }
            }
            Divider().overlay(JK.stroke)
            ForEach(features) { f in
                GridRow {
                    rowLabel(f.title)
                    ForEach(plans) { p in
                        mark(p, has: f)
                    }
                }
            }
            Divider().overlay(JK.stroke)
            GridRow {
                rowLabel("Sessions a month")
                ForEach(plans) { p in
                    Text(p.credits > 0 ? "\(p.credits)" : "–")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(JK.text)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(p.credits > 0 ? "\(p.name): \(p.credits) sessions a month" : "\(p.name): no sessions")
                }
            }
            GridRow {
                rowLabel("Price")
                ForEach(plans) { p in
                    VStack(spacing: 0) {
                        Text(Fmt.pounds(p.monthlyPence))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(JK.text)
                        Text("/ month")
                            .font(.system(size: 9))
                            .foregroundStyle(JK.tertiary)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .jkCard(padding: 12)
    }

    private func mark(_ p: Plan, has f: Feature) -> some View {
        let has = p.featureIds.contains(f.id)
        return Image(systemName: has ? "checkmark" : "minus")
            .font(.caption.weight(has ? .bold : .regular))
            .foregroundStyle(has ? JK.text : JK.tertiary)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(has ? "\(p.name) includes \(f.title)" : "\(p.name) doesn't include \(f.title)")
    }

    private func rowLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(JK.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: 112, alignment: .leading)
    }
}

// MARK: - Feature previews

/// A small illustration of a feature, built from the app's own pieces with
/// made-up sample content. Not interactive.
struct FeaturePreview: View {
    let featureId: String
    var credits = 4

    var body: some View {
        content
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.summary(featureId))
    }

    @ViewBuilder
    private var content: some View {
        switch featureId {
        case "programme": programme
        case "messaging": messaging
        case "habits": habits
        case "progress": progress
        case "checkin": checkin
        case "sessions": sessions
        case "nutrition": nutrition
        case "priority": priority
        case "guides": guide
        default: EmptyView()
        }
    }

    static func summary(_ id: String) -> String {
        switch id {
        case "programme": return "Example: a workout card with three exercises."
        case "messaging": return "Example: a short conversation with your coach."
        case "habits": return "Example: three daily habits with progress."
        case "progress": return "Example: a chart of body weight going down."
        case "checkin": return "Example: a weekly check-in and your coach's reply."
        case "sessions": return "Example: two sessions to book and credits left."
        case "nutrition": return "Example: calories and macros against targets."
        case "priority": return "Example: a message answered in 12 minutes."
        case "guides": return "Example: a guide from your coach."
        default: return "Example"
        }
    }

    private struct Sample: Hashable {
        let title: String
        let detail: String
        var symbol = "dumbbell"
        var fraction = 0.0
    }

    // Programme

    private static let exercises = [
        Sample(title: "Back Squat", detail: "4 × 6 · 80 kg", fraction: 1),
        Sample(title: "Romanian Deadlift", detail: "3 × 8 · 70 kg", fraction: 1),
        Sample(title: "Walking Lunge", detail: "3 × 10 / leg · 2×16 kg"),
    ]

    private var programme: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Eyebrow(text: "Today")
                    Text("Lower Body Strength").font(.headline).foregroundStyle(JK.text)
                }
                Spacer()
                Text("2 of 3 done").font(.caption2).foregroundStyle(JK.tertiary)
            }
            .padding(12)
            ForEach(Self.exercises, id: \.self) { e in
                Divider().overlay(JK.stroke)
                HStack(spacing: 10) {
                    IconTile(systemName: "dumbbell", size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(e.title).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                        Text(e.detail).font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                    CheckCircle(on: e.fraction >= 1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
            }
        }
        .jkCard(padding: 0)
    }

    // Messaging

    private func bubble(_ text: String, mine: Bool) -> some View {
        HStack {
            if mine { Spacer(minLength: 48) }
            Text(text)
                .font(.caption)
                .foregroundStyle(mine ? Color.black : JK.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(mine ? JK.text : JK.cardRaised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .fixedSize(horizontal: false, vertical: true)
            if !mine { Spacer(minLength: 48) }
        }
    }

    private var messaging: some View {
        VStack(spacing: 8) {
            bubble("How did the squats feel today? Your last set looked quick.", mine: false)
            bubble("Strong. I think I had one more rep in me.", mine: true)
            bubble("Good. We'll add 2.5 kg next week.", mine: false)
        }
        .jkCard()
    }

    // Habits

    private static let habitSamples = [
        Sample(title: "Water", detail: "2.1 of 3 L", symbol: "drop", fraction: 0.7),
        Sample(title: "Steps", detail: "8,420 of 10,000", symbol: "figure.walk", fraction: 0.84),
        Sample(title: "Sleep 7h+", detail: "7h 40m", symbol: "bed.double", fraction: 1),
    ]

    private var habits: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Self.habitSamples, id: \.self) { h in
                HStack(spacing: 10) {
                    IconTile(systemName: h.symbol, size: 28)
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(h.title).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                            Spacer()
                            Text(h.detail).font(.caption2).foregroundStyle(JK.tertiary)
                        }
                        ThinBar(fraction: h.fraction)
                    }
                    CheckCircle(on: h.fraction >= 1)
                }
            }
            Text("12-day streak").font(.caption2).foregroundStyle(JK.secondary)
        }
        .jkCard()
    }

    // Progress

    private struct WeightPoint: Identifiable {
        let week: Int
        let kg: Double
        var id: Int { week }
    }

    private static let weights: [WeightPoint] = [82.5, 82.1, 81.6, 81.8, 80.9, 80.4, 79.8, 79.9, 79.1, 78.4]
        .enumerated().map { WeightPoint(week: $0.offset, kg: $0.element) }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "Body weight")
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("78.4 kg").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                DeltaBadge(text: "−4.1 kg")
            }
            Chart(Self.weights) { p in
                LineMark(x: .value("Week", p.week), y: .value("kg", p.kg))
                    .foregroundStyle(JK.text)
                    .interpolationMethod(.catmullRom)
            }
            .chartYScale(domain: 77.5...83.5)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 90)
        }
        .jkCard()
    }

    // Check-in

    private func scaleRow(_ label: String, _ value: Int) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.caption).foregroundStyle(JK.secondary).frame(width: 52, alignment: .leading)
            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { n in
                    Capsule().fill(n <= value ? JK.text : JK.track).frame(height: 6)
                }
            }
            Text("\(value) / 5").font(.caption2).monospacedDigit().foregroundStyle(JK.tertiary)
        }
    }

    private var checkin: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "This week")
            scaleRow("Energy", 4)
            scaleRow("Sleep", 3)
            Divider().overlay(JK.stroke)
            Eyebrow(text: "Coach replied")
            bubble("Good week. Keep Thursday light and we'll push again on Saturday.", mine: false)
        }
        .jkCard()
    }

    // Sessions

    private func slot(_ when: String, _ detail: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Dot(color: color)
            VStack(alignment: .leading, spacing: 1) {
                Text(when).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            Text("Book")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(JK.secondary)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(JK.cardRaised, in: Capsule())
                .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
        }
    }

    private var sessions: some View {
        VStack(alignment: .leading, spacing: 12) {
            slot("Tue · 07:00", "1:1 in person · Studio 2", color: JK.inPerson)
            Divider().overlay(JK.stroke)
            slot("Thu · 18:30", "1:1 on video", color: JK.video)
            Divider().overlay(JK.stroke)
            Text("2 of \(max(credits, 2)) credits left this month")
                .font(.caption2)
                .foregroundStyle(JK.secondary)
        }
        .jkCard()
    }

    // Nutrition

    private static let macros = [
        Sample(title: "Calories", detail: "1,720 / 2,500 kcal", fraction: 0.69),
        Sample(title: "Protein", detail: "128 / 170 g", fraction: 0.75),
        Sample(title: "Carbs", detail: "180 / 260 g", fraction: 0.69),
        Sample(title: "Fat", detail: "52 / 80 g", fraction: 0.65),
    ]

    private var nutrition: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Self.macros, id: \.self) { m in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(m.title).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                        Spacer()
                        Text(m.detail).font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    ThinBar(fraction: m.fraction, height: 5)
                }
            }
        }
        .jkCard()
    }

    // Priority

    private var priority: some View {
        VStack(alignment: .leading, spacing: 8) {
            bubble("My knee is a bit sore after yesterday. Should I still squat tomorrow?", mine: true)
            bubble("Swap to box squats and keep it to RPE 7. Tell me how it feels.", mine: false)
            Label("Replied in 12 min", systemImage: "bolt.fill")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(JK.secondary)
        }
        .jkCard()
    }

    // Guides

    private var guide: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(systemName: "book")
            VStack(alignment: .leading, spacing: 3) {
                Eyebrow(text: "Guide · 6 min")
                Text("Warming up for a heavy lower day").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Text("Five minutes that make your first working set feel easy.")
                    .font(.caption2).foregroundStyle(JK.tertiary)
            }
        }
        .jkCard()
    }
}
