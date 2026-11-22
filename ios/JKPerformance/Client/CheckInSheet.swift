import PhotosUI
import SwiftUI

/// The weekly check-in (atelier-spec.md, Client screens 5), a minute in three
/// paged cards: how the week felt, the body (with the week's figures filled in
/// and read-only), and one win, one struggle and any photos. Plans with
/// 'checkin' only.
struct CheckInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session
    @State private var page = 0
    @State private var energy = 3
    @State private var stress = 3
    @State private var sleep = 3
    @State private var pain: Set<String> = []
    @State private var win = ""
    @State private var struggle = ""
    @State private var note = ""
    @State private var photoIds: [String] = []
    @State private var thumbs: [UIImage] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var draft: CheckinDraft?
    @State private var saving = false
    @State private var error: String?
    @State private var sent = false

    static let painOptions = ["Knee", "Back", "Shoulder", "Hip", "Other"]
    static let energyWords = ["Drained", "Low", "Steady", "Good", "Full of it"]
    static let stressWords = ["Calm", "Settled", "Some", "High", "Very high"]
    static let sleepWords = ["Poor", "Restless", "Fair", "Good", "Deep"]

    var body: some View {
        NavigationStack {
            Group {
                if sent {
                    confirmation
                } else {
                    TabView(selection: $page) {
                        feelCard.tag(0)
                        bodyCard.tag(1)
                        weekCard.tag(2)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .always))
                }
            }
            .jkScreen()
            .navigationTitle(sent ? "" : "Check-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(sent ? "Done" : "Not now") { dismiss() } }
            }
            .task { await load() }
            .onChange(of: picked) { _, items in Task { await upload(items) } }
        }
    }

    // MARK: Cards

    private var feelCard: some View {
        card {
            Text("How did the week feel?").jkText(.title).foregroundStyle(JK.text)
            WordScale(title: "Energy", words: Self.energyWords, value: $energy)
            WordScale(title: "Stress", words: Self.stressWords, value: $stress)
            Button("Next") { withAnimation { page = 1 } }.buttonStyle(SecondaryButtonStyle())
        }
    }

    private var bodyCard: some View {
        card {
            Text("Body").jkText(.title).foregroundStyle(JK.text)
            WordScale(title: "Sleep quality", words: Self.sleepWords, value: $sleep)
            VStack(alignment: .leading, spacing: JK.Space.s) {
                Text("Any pain or niggles?").font(.jkHeadline).foregroundStyle(JK.text)
                FlowRow {
                    Chip(label: "None", selected: pain.isEmpty) { pain = [] }
                    ForEach(Self.painOptions, id: \.self) { p in
                        Chip(label: p, selected: pain.contains(p)) {
                            if pain.contains(p) { pain.remove(p) } else { pain.insert(p) }
                        }
                    }
                }
                if !pain.isEmpty {
                    JKField(label: "Tell JK more", text: $note, prompt: "Left knee tight after split squats")
                }
            }
            facts
            Button("Next") { withAnimation { page = 2 } }.buttonStyle(SecondaryButtonStyle())
        }
    }

    private var weekCard: some View {
        card {
            Text("Your week").jkText(.title).foregroundStyle(JK.text)
            JKField(label: "One win", text: $win, prompt: "Squat 102.5 for 5")
            JKField(label: "One struggle", text: $struggle, prompt: "Late nights midweek")
            photos
            if let error { ErrorBanner(message: error) }
            PrimaryButton("Send to JK", busy: saving) { Task { await submit() } }
                .disabled(uploading)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) { content() }
                .padding(JK.Space.gutter)
                .padding(.bottom, JK.Space.huge)
        }
    }

    /// The week as the app already knows it: read-only.
    @ViewBuilder
    private var facts: some View {
        if let d = draft {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                Text("Filled in for you").font(.jkCaption).foregroundStyle(JK.textSecondary)
                if let steps = d.avgSteps { fact("Steps", "\(Fmt.number(steps, digits: 0)) a day") }
                if let sleep = d.avgSleepMinutes { fact("Sleep", "\(Fmt.minutes(sleep)) a night") }
                if let h = d.habits { fact("Habits", "\(h.done) of \(h.days) days") }
                if let done = d.sessionsDone, let planned = d.sessionsPlanned { fact("Sessions", "\(done) of \(planned)") }
                ForEach(Array((d.feel ?? []).enumerated()), id: \.offset) { _, f in
                    if let word = f.word { fact(f.title ?? "Session", word) }
                }
            }
            .surface(.card, padding: JK.Space.l)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.jkCallout).foregroundStyle(JK.textSecondary)
            Spacer()
            Text(value).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
        }
        .accessibilityElement(children: .combine)
    }

    private var photos: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text("Photos (optional, private to you and JK)").font(.jkCaption).foregroundStyle(JK.textSecondary)
            HStack(spacing: JK.Space.s) {
                ForEach(Array(thumbs.enumerated()), id: \.offset) { _, image in
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                        .accessibilityLabel("Photo")
                }
                if photoIds.count < 6 {
                    PhotosPicker(selection: $picked, maxSelectionCount: 6 - photoIds.count, matching: .images) {
                        Group {
                            if uploading { ProgressView().tint(JK.textSecondary) } else { Icon(key: .mealPhoto) }
                        }
                        .foregroundStyle(JK.textSecondary)
                        .frame(width: 64, height: 64)
                        .overlay(RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous)
                            .strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                    }
                    .accessibilityLabel("Add photos")
                    .disabled(uploading)
                }
            }
        }
    }

    private var confirmation: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            Spacer()
            BrandRule()
            Text("Sent to JK. Your letter arrives Monday morning.")
                .jkText(.quote).foregroundStyle(JK.text)
            Spacer()
            Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
        }
        .padding(JK.Space.gutter)
    }

    // MARK: Data

    private func load() async {
        if let reply: CheckInsResponse = try? await APIClient.shared.get("/api/checkins"),
           let due = reply.dueWeek, let c = reply.checkins.first(where: { $0.week == due }) {
            energy = c.energy
            sleep = c.sleep
            stress = c.stress ?? 3
            pain = Set(c.pain)
            note = c.note ?? ""
            win = c.win ?? ""
            struggle = c.struggle ?? ""
            photoIds = c.photoIds ?? []
        }
        draft = try? await APIClient.shared.get("/api/checkins/draft")
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        uploading = true
        defer {
            uploading = false
            picked = []
        }
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
                let media = try await MediaUpload.image(image, purpose: "checkin")
                photoIds.append(media.id)
                thumbs.append(image)
            } catch {
                self.error = error.readable
            }
        }
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        let input = CheckInInput(energy: energy, sleep: sleep, pain: Self.painOptions.filter { pain.contains($0) },
                                 note: note.trimmingCharacters(in: .whitespacesAndNewlines), stress: stress,
                                 win: win.trimmingCharacters(in: .whitespacesAndNewlines),
                                 struggle: struggle.trimmingCharacters(in: .whitespacesAndNewlines),
                                 photoIds: photoIds.isEmpty ? nil : photoIds)
        do {
            let _: CheckIn = try await APIClient.shared.send("POST", "/api/checkins", body: input)
            error = nil
            sent = true
        } catch {
            self.error = error.readable
        }
    }
}

/// A 1 to 5 choice with a word on every option.
struct WordScale: View {
    let title: String
    let words: [String]
    @Binding var value: Int

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            HStack {
                Text(title).font(.jkHeadline).foregroundStyle(JK.text)
                Spacer()
                Text(words[max(0, min(words.count - 1, value - 1))]).font(.jkCallout).foregroundStyle(JK.textSecondary)
            }
            AdaptiveStack(spacing: JK.Space.xs) {
                ForEach(1...5, id: \.self) { n in
                    let on = value == n
                    Button { value = n } label: {
                        Text(words[n - 1])
                            .font(.jkCaption)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: .infinity, minHeight: JK.Size.touch)
                            .foregroundStyle(on ? JK.onPrimary : JK.text)
                            .background(on ? JK.primaryFill : JK.surface,
                                        in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(title): \(words[n - 1])")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }
}

/// Chips that wrap onto new lines.
struct FlowRow: Layout {
    var spacing: CGFloat = JK.Space.s

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
