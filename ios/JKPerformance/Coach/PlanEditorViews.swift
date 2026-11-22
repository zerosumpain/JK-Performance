import SwiftUI

// MARK: - Plans & prices (coach)

/// The coach's four plans as their clients see them: name, prices, credits,
/// features and members. Tap one to edit it; reset puts every plan back to the
/// defaults; Preview opens the walkthrough a client sees.
struct PlansPricesView: View {
    @State private var data: PlansResponse?
    @State private var members: [String: Int] = [:]
    @State private var error: String?
    @State private var actionError: String?
    @State private var confirmReset = false
    @State private var resetting = false
    @State private var previewing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Coach · Business", title: "Plans & prices")
                Text("What your clients see when they choose a plan. Changes apply straight away.")
                    .font(.caption)
                    .foregroundStyle(JK.secondary)
                Loadable(value: data, error: error, retry: load) { d in
                    planList(d)
                    footer
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .jkRefreshable { await load() }
        .task { await load() }
        .confirmationDialog("Reset every plan to the defaults?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset to defaults", role: .destructive) { Task { await reset() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Names, prices, credits and features go back to how they started. Clients see the change straight away.")
        }
        .fullScreenCover(isPresented: $previewing) {
            PlanTourView(mode: .preview, initial: data)
        }
    }

    private func planList(_ d: PlansResponse) -> some View {
        VStack(spacing: 10) {
            ForEach(d.plans) { p in
                NavigationLink {
                    PlanEditorView(plan: p, catalogue: d.features ?? []) { fresh in
                        data = fresh
                    }
                } label: {
                    PlanSummaryCard(plan: p, members: members[p.id])
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            if let actionError { ErrorBanner(message: actionError) }
            Button {
                previewing = true
            } label: {
                Label("Preview as a client", systemImage: "eye")
            }
            .buttonStyle(GhostButtonStyle())
            Button {
                confirmReset = true
            } label: {
                if resetting { ProgressView().controlSize(.small) } else { Text("Reset to defaults") }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(JK.secondary)
            .frame(maxWidth: .infinity, minHeight: 36)
            .disabled(resetting)
        }
        .padding(.top, 6)
    }

    private func load() async {
        do {
            let fresh: PlansResponse = try await APIClient.shared.get("/api/plans")
            data = fresh
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
        if let b: Business = try? await APIClient.shared.get("/api/coach/business", query: ["period": "month"]) {
            members = Dictionary((b.plans ?? []).map { ($0.id, $0.members) }, uniquingKeysWith: { first, _ in first })
        }
    }

    private func reset() async {
        resetting = true
        defer { resetting = false }
        do {
            let fresh: PlansResponse = try await APIClient.shared.send("POST", "/api/coach/plans/reset")
            data = fresh
            actionError = nil
        } catch {
            actionError = error.readable
        }
    }
}

/// One plan on the list: name, Most popular, prices, credits, features, members.
private struct PlanSummaryCard: View {
    let plan: Plan
    let members: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Text(plan.name).font(.headline).foregroundStyle(JK.text)
                if plan.isFeatured { PopularBadge() }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
            }
            Text(plan.detail)
                .font(.caption2)
                .foregroundStyle(JK.tertiary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if plan.isFree {
                    Text("Free").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                } else {
                    PriceLabel(pence: plan.monthlyPence)
                    PriceLabel(pence: plan.annualPence, period: .year, font: .subheadline.weight(.semibold))
                }
                Spacer(minLength: 0)
            }
            Text(facts)
                .font(.caption2)
                .foregroundStyle(JK.secondary)
        }
        .jkCard()
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edit this plan")
    }

    private var facts: String {
        var parts: [String] = []
        if !plan.isFree {
            parts.append(plan.credits == 1 ? "1 session credit" : "\(plan.credits) session credits")
        }
        let n = plan.featureIds.count
        parts.append(n == 1 ? "1 feature" : "\(n) features")
        if let members {
            parts.append(members == 1 ? "1 member" : "\(members) members")
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Plan editor

/// Edit one plan: wording, prices (in pounds, stored as pence), session
/// credits, Most popular, and which features it includes. Save sends the full
/// set to PUT /api/coach/plans/:id; the server's message shows on a 400.
struct PlanEditorView: View {
    let plan: Plan
    let catalogue: [Feature]
    let onSaved: (PlansResponse) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var detail: String
    @State private var pitch: String
    @State private var monthly: String
    @State private var annual: String
    @State private var credits: Int
    @State private var featured: Bool
    @State private var features: Set<String>
    @State private var saving = false
    @State private var error: String?

    private static let nameLimit = 30
    private static let detailLimit = 90
    private static let pitchLimit = 400

    init(plan: Plan, catalogue: [Feature], onSaved: @escaping (PlansResponse) -> Void) {
        self.plan = plan
        self.catalogue = catalogue
        self.onSaved = onSaved
        _name = State(initialValue: plan.name)
        _detail = State(initialValue: plan.detail)
        _pitch = State(initialValue: plan.pitch ?? "")
        _monthly = State(initialValue: PlanEditorView.poundsText(plan.monthlyPence))
        _annual = State(initialValue: PlanEditorView.poundsText(plan.annualPence))
        _credits = State(initialValue: plan.credits)
        _featured = State(initialValue: plan.isFeatured)
        _features = State(initialValue: Set(plan.featureIds))
    }

    private var isFree: Bool { plan.isFree }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Plans & prices", title: plan.name)
                Eyebrow(text: "Wording")
                wordingFields
                if isFree {
                    Text("The free plan is always free.")
                        .font(.caption)
                        .foregroundStyle(JK.secondary)
                        .jkCard(padding: 12)
                } else {
                    Eyebrow(text: "Prices")
                    priceFields
                    Eyebrow(text: "Sessions and badge")
                    creditsAndBadge
                }
                Eyebrow(text: "Features", trailing: "\(features.count) of \(catalogue.count)")
                featureToggles
                if let error { ErrorBanner(message: error) }
                saveButton
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: Wording

    private var wordingFields: some View {
        VStack(spacing: 10) {
            LimitedField(title: "Name", prompt: "Foundation", text: $name, limit: Self.nameLimit)
            LimitedField(title: "Tagline", prompt: "Programme + app messaging", text: $detail, limit: Self.detailLimit)
            LimitedField(title: "Pitch", prompt: "Who this plan is for, in a sentence or two.", text: $pitch,
                         limit: Self.pitchLimit, multiline: true)
        }
    }

    // MARK: Prices

    private var monthlyPence: Int? { Self.parsePence(monthly) }
    private var annualPence: Int? { Self.parsePence(annual) }

    private var priceHint: String? {
        guard let m = monthlyPence, m > 0 else { return nil }
        let full = m * 12
        var text = "12 × monthly is \(Fmt.pounds(full))"
        if let a = annualPence, a > 0, let pct = PlanPrice.savePercent(monthly: m, annual: a) {
            text += " · saves \(pct)%"
        } else if let a = annualPence, a >= full {
            text += " · no saving on annual"
        }
        return text
    }

    private var priceFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                PoundsField(title: "Monthly", text: $monthly)
                PoundsField(title: "Annual", text: $annual)
            }
            if let priceHint {
                Text(priceHint)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(JK.secondary)
            }
            Text("Clients see the new price straight away. Nobody is charged while payments are off; once App Store billing is on, change the price in App Store Connect too.")
                .font(.caption2)
                .foregroundStyle(JK.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var creditsAndBadge: some View {
        VStack(spacing: 12) {
            Stepper(value: $credits, in: 0...31) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Session credits").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(credits == 1 ? "1 session a month" : "\(credits) sessions a month")
                        .font(.caption2).foregroundStyle(JK.tertiary)
                }
            }
            Divider().overlay(JK.stroke)
            Toggle(isOn: $featured) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Most popular").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Shown on one plan at a time").font(.caption2).foregroundStyle(JK.tertiary)
                }
            }
            .tint(.green)
        }
        .jkCard(padding: 12)
    }

    // MARK: Features

    private var featureToggles: some View {
        VStack(spacing: 0) {
            ForEach(catalogue) { f in
                Toggle(isOn: featureBinding(f.id)) {
                    FeatureRow(feature: f)
                }
                .tint(.green)
                .padding(12)
                if f.id != catalogue.last?.id { Divider().overlay(JK.stroke) }
            }
        }
        .jkCard(padding: 0)
    }

    private func featureBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { features.contains(id) },
            set: { on in
                if on { features.insert(id) } else { features.remove(id) }
            }
        )
    }

    // MARK: Save

    private var saveButton: some View {
        Button {
            Task { await save() }
        } label: {
            if saving { ProgressView().tint(.black) } else { Text("Save") }
        }
        .buttonStyle(ChromeButtonStyle())
        .disabled(saving)
    }

    private func save() async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            error = "Give the plan a name."
            return
        }
        var input = PlanInput(name: trimmedName,
                              detail: detail.trimmingCharacters(in: .whitespacesAndNewlines),
                              pitch: pitch.trimmingCharacters(in: .whitespacesAndNewlines),
                              features: catalogue.map(\.id).filter { features.contains($0) })
        if !isFree {
            guard let m = monthlyPence else {
                error = "Enter the monthly price in pounds, like 59 or 59.50."
                return
            }
            guard let a = annualPence else {
                error = "Enter the annual price in pounds, like 600."
                return
            }
            input.monthlyPence = m
            input.annualPence = a
            input.credits = credits
            input.featured = featured
        }
        saving = true
        defer { saving = false }
        do {
            let fresh: PlansResponse = try await APIClient.shared.send("PUT", "/api/coach/plans/\(seg(plan.id))", body: input)
            error = nil
            onSaved(fresh)
            dismiss()
        } catch {
            self.error = error.readable
        }
    }

    // MARK: Pounds ↔ pence

    static func poundsText(_ pence: Int) -> String {
        pence % 100 == 0 ? "\(pence / 100)" : String(format: "%.2f", Double(pence) / 100)
    }

    /// "59", "59.5", "£59.50", "1,200" or "59,50" → pence; nil if it isn't a price.
    static func parsePence(_ text: String) -> Int? {
        var s = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "£", with: "")
        s = s.replacingOccurrences(of: " ", with: "")
        if s.contains(".") {
            s = s.replacingOccurrences(of: ",", with: "")
        } else if let comma = s.lastIndex(of: ","), s.distance(from: comma, to: s.endIndex) <= 3 {
            // A decimal comma ("59,50") from a keypad that uses one.
            s.replaceSubrange(comma...comma, with: ".")
            s = s.replacingOccurrences(of: ",", with: "")
        } else {
            s = s.replacingOccurrences(of: ",", with: "")
        }
        guard !s.isEmpty, let value = Double(s), value >= 0, value.isFinite else { return nil }
        return Int((value * 100).rounded())
    }
}

/// A labelled text field with a character counter that stops at `limit`.
private struct LimitedField: View {
    let title: String
    let prompt: String
    @Binding var text: String
    let limit: Int
    var multiline = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(JK.secondary)
                Spacer()
                Text("\(text.count) / \(limit)")
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(JK.tertiary)
                    .accessibilityLabel("\(text.count) of \(limit) characters")
            }
            if multiline {
                TextField(prompt, text: $text, axis: .vertical)
                    .lineLimit(3...8)
                    .font(.subheadline)
                    .foregroundStyle(JK.text)
                    .accessibilityLabel(title)
            } else {
                TextField(prompt, text: $text)
                    .font(.subheadline)
                    .foregroundStyle(JK.text)
                    .accessibilityLabel(title)
            }
        }
        .jkCard(padding: 12)
        .onChange(of: text) { _, value in
            if value.count > limit { text = String(value.prefix(limit)) }
        }
    }
}

/// A price in pounds on the decimal keypad.
private struct PoundsField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(JK.secondary)
            HStack(spacing: 4) {
                Text("£").font(.title3.weight(.semibold)).foregroundStyle(JK.tertiary)
                TextField("0", text: $text)
                    .keyboardType(.decimalPad)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(JK.text)
                    .accessibilityLabel("\(title) price in pounds")
            }
        }
        .jkCard(padding: 12)
    }
}

// MARK: - Client's first-run answers (coach)

/// "About": what a client said when they first opened the app.
struct ClientAboutCard: View {
    let profile: Profile?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "About", trailing: profile?.answeredAt.map { "Answered \(Fmt.dayMonth($0))" })
            if let profile, !profile.isEmpty {
                answers(profile)
            } else {
                Text("Hasn't answered the first-run questions yet.")
                    .font(.caption)
                    .foregroundStyle(JK.tertiary)
            }
        }
        .jkCard()
    }

    @ViewBuilder
    private func answers(_ p: Profile) -> some View {
        let goals = (p.goals ?? []).map { OnboardingCatalog.goal($0)?.title ?? $0 }
        if !goals.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(goals, id: \.self) { g in
                        Text(g)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
                            .foregroundStyle(JK.text)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Goals: \(goals.joined(separator: ", "))")
        }
        if let e = p.experience {
            line("Experience", OnboardingCatalog.experienceOption(e)?.title ?? e)
        }
        if let week = weekText(p) {
            line("Training", week)
        }
        if let injuries = p.injuries?.trimmingCharacters(in: .whitespacesAndNewlines), !injuries.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text("Injuries and notes").font(.caption2).foregroundStyle(JK.tertiary)
                Text(injuries)
                    .font(.subheadline)
                    .foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func weekText(_ p: Profile) -> String? {
        var parts: [String] = []
        if let d = p.daysPerWeek { parts.append(d == 1 ? "1 day a week" : "\(d) days a week") }
        if let t = p.preferredTime {
            let label = OnboardingCatalog.time(t)?.title ?? t
            parts.append(t == "varies" ? "time varies" : label.lowercased())
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption2).foregroundStyle(JK.tertiary).frame(width: 78, alignment: .leading)
            Text(value).font(.subheadline).foregroundStyle(JK.text)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
