import Charts
import PhotosUI
import SwiftUI

// MARK: - Progress

/// Named ProgressScreen because SwiftUI already owns `ProgressView`.
struct ProgressScreen: View {
    enum Span: String, CaseIterable {
        case threeMonths = "3M", sixMonths = "6M", all = "All"
        var query: String { self == .threeMonths ? "3m" : self == .sixMonths ? "6m" : "all" }
    }

    @State private var range: Span = .threeMonths
    @State private var progress: ProgressData?
    @State private var photos: [Photo]?
    @State private var error: String?
    @State private var actionError: String?
    @State private var measuring = false
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false

    private var api: APIClient { APIClient.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: progress?.since.map { "Since \(Fmt.dayMonth($0))" } ?? "Progress", title: "Progress") {
                    Segmented(options: Span.allCases, selection: $range) { $0.rawValue }
                        .frame(width: 130)
                }

                Loadable(value: progress, error: error, retry: load) { p in
                    weightCard(p)
                    if !p.stats.isEmpty {
                        HStack(spacing: 8) {
                            ForEach(p.stats, id: \.kind) { s in
                                StatTile(label: Self.label(s.kind), value: Self.value(s), delta: s.delta.map { Fmt.delta($0) })
                            }
                        }
                    }
                    Button { measuring = true } label: { Label("Add measurement", systemImage: "plus") }
                        .buttonStyle(SecondaryButtonStyle())

                    Eyebrow(text: "Personal records", trailing: "Best logged load")
                    if p.records.isEmpty {
                        EmptyCard(systemName: "trophy", title: "No records yet", detail: "Log sets in your workouts to see them here.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(p.records, id: \.exercise) { pr in
                                HStack {
                                    Image(systemName: "trophy").foregroundStyle(JK.textSecondary)
                                    Text(pr.exercise).font(.jkCallout.weight(.medium))
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 0) {
                                        Text("\(Fmt.number(pr.kg)) kg").font(.jkCallout.weight(.semibold))
                                        if let gain = pr.gain {
                                            Text("\(Fmt.delta(gain)) kg").font(.jkCaption).foregroundStyle(JK.textTertiary)
                                        }
                                    }
                                }
                                .foregroundStyle(JK.text)
                                .padding(12)
                            }
                        }
                        .jkCard(padding: 2)
                    }
                }

                NavigationLink { ChallengesView() } label: {
                    HStack(spacing: 12) {
                        Glyph(systemName: "trophy")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Challenges").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                            Text("Run, walk or row with the group").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                    .jkCard(padding: 12)
                }

                HStack {
                    Eyebrow(text: "Progress photos")
                    Spacer()
                    Label("Private to you and Coach", systemImage: "lock").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                photoRow
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .task(id: range) { await load() }
        .task { await loadPhotos() }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .sheet(isPresented: $measuring) {
            MeasurementSheet { input in
                let _: ProgressData = try await api.send("POST", "/api/measurements", body: input)
                await load()
            }
            .presentationDetents([.medium])
        }
        .errorAlert($actionError)
    }

    private func load() async {
        do {
            progress = try await api.get("/api/progress", query: ["range": range.query])
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func loadPhotos() async {
        do {
            let reply: PhotosResponse = try await api.get("/api/photos")
            photos = reply.photos.sorted { $0.date < $1.date }
        } catch {
            if !error.isCancellation { photos = photos ?? [] }
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        defer {
            uploading = false
            picked = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = image.jpegForUpload() else {
                actionError = "Couldn't read that photo."
                return
            }
            let photo: Photo = try await api.upload("/api/photos", data: jpeg, contentType: "image/jpeg",
                                                    query: ["date": Day.today])
            photos = (photos ?? []) + [photo]
        } catch {
            actionError = error.readable
        }
    }

    private func delete(_ photo: Photo) async {
        do {
            let _: OK = try await api.send("DELETE", "/api/photos/\(seg(photo.id))")
            photos?.removeAll { $0.id == photo.id }
        } catch {
            actionError = error.readable
        }
    }

    private var photoRow: some View {
        HStack(spacing: 8) {
            ForEach((photos ?? []).suffix(3)) { photo in
                AuthedPhoto(photo: photo)
                    .frame(height: 90)
                    .contextMenu {
                        Button(role: .destructive) { Task { await delete(photo) } } label: {
                            Label("Delete photo", systemImage: "trash")
                        }
                    }
            }
            PhotosPicker(selection: $picked, matching: .images) {
                Group {
                    if uploading { ProgressView().tint(JK.textSecondary) } else { Image(systemName: "camera") }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .overlay(RoundedRectangle(cornerRadius: JK.Radius.control).strokeBorder(JK.hairline, style: StrokeStyle(lineWidth: 1, dash: [4])))
            }
            .foregroundStyle(JK.textSecondary)
            .frame(height: 90)
            .disabled(uploading)
        }
    }

    @ViewBuilder
    private func weightCard(_ p: ProgressData) -> some View {
        let points = (p.weight?.series ?? []).compactMap { pt in Day.date(pt.date).map { ($0, pt.value) } }
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                Eyebrow(text: "Body weight")
                Spacer()
                if let delta = p.weight?.delta { DeltaBadge(text: "\(Fmt.delta(delta)) kg") }
            }
            (Text(p.weight?.latest.map { Fmt.number($0) } ?? "–").font(.jkNumberHero)
                + Text(" kg").font(.jkCaption).foregroundColor(JK.textTertiary))
                .foregroundStyle(JK.text)
            if points.count >= 2 {
                let values = points.map(\.1)
                let low = (values.min() ?? 0) - 1, high = (values.max() ?? 0) + 1
                Chart(points, id: \.0) { pt in
                    LineMark(x: .value("Day", pt.0), y: .value("kg", pt.1))
                        .foregroundStyle(JK.data)
                }
                .chartYScale(domain: low...high)
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .frame(height: 90)
            } else {
                Text("Add two weigh-ins (or turn on Apple Health) to see the trend.")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
        }
        .jkCard()
    }

    static func label(_ kind: String) -> String {
        switch kind {
        case "bodyFat": return "Body fat"
        case "waist": return "Waist"
        case "restingHr": return "Resting HR"
        case "weight": return "Weight"
        default: return kind
        }
    }

    static func unit(_ kind: String) -> String {
        switch kind {
        case "bodyFat": return "%"
        case "waist": return " cm"
        case "weight": return " kg"
        default: return ""
        }
    }

    private static func value(_ s: StatBlock) -> String {
        guard let latest = s.latest else { return "–" }
        return Fmt.number(latest) + unit(s.kind)
    }
}

extension UIImage {
    /// JPEG at most 2048 px on the long side, under the 8 MB upload limit.
    func jpegForUpload() -> Data? {
        let longest = max(size.width, size.height)
        let scale = longest > 2048 ? 2048 / longest : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        var quality: CGFloat = 0.8
        var data = resized.jpegData(compressionQuality: quality)
        while let d = data, d.count > 8_000_000, quality > 0.3 {
            quality -= 0.15
            data = resized.jpegData(compressionQuality: quality)
        }
        return data
    }
}

/// A progress photo fetched through APIClient (AsyncImage sends no token).
struct AuthedPhoto: View {
    let photo: Photo
    @State private var image: UIImage?
    @State private var failed = false

    private static let cache = NSCache<NSString, UIImage>()

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: JK.Radius.control).fill(JK.raised)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: JK.Radius.control))
            } else {
                Image(systemName: failed ? "exclamationmark.triangle" : "figure.stand")
                    .font(failed ? Font.jkHeadline : Font.largeTitle)
                    .foregroundStyle(JK.textTertiary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: failed ? .center : .bottom)
            }
            Text(Fmt.dayMonth(photo.date))
                .font(.jkMicro)
                .foregroundStyle(JK.textSecondary)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background(JK.scrim, in: Capsule())
                .padding(6)
        }
        .task(id: photo.id) {
            if let hit = Self.cache.object(forKey: photo.id as NSString) {
                image = hit
                return
            }
            do {
                let data = try await APIClient.shared.data("/api/photos/\(seg(photo.id))")
                if let decoded = UIImage(data: data) {
                    Self.cache.setObject(decoded, forKey: photo.id as NSString)
                    image = decoded
                } else {
                    failed = true
                }
            } catch {
                if !error.isCancellation { failed = true }
            }
        }
    }
}

private struct MeasurementSheet: View {
    let save: (MeasurementInput) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "weight"
    @State private var value = ""
    @State private var date = Date()
    @State private var saving = false
    @State private var error: String?

    private let kinds = ["weight", "bodyFat", "waist", "restingHr"]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Segmented(options: kinds, selection: $kind) { ProgressScreen.label($0) }
                JKField(label: "\(ProgressScreen.label(kind)) (\(unitName))", text: $value, prompt: "0", keyboard: .decimalPad)
                DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    .font(.jkCallout)
                    .foregroundStyle(JK.text)
                if let error { ErrorBanner(message: error) }
                Button {
                    Task { await submit() }
                } label: {
                    if saving { ProgressView().tint(JK.onPrimary) } else { Text("Save") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(parseNumber(value) == nil || saving)
                Spacer()
            }
            .padding(16)
            .jkScreen()
            .navigationTitle("Add measurement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private var unitName: String {
        switch kind {
        case "bodyFat": return "%"
        case "waist": return "cm"
        case "restingHr": return "bpm"
        default: return "kg"
        }
    }

    private func submit() async {
        guard let number = parseNumber(value) else { return }
        saving = true
        defer { saving = false }
        do {
            try await save(MeasurementInput(date: Day.string(date), kind: kind, value: number))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Challenges

struct ChallengesView: View {
    @State private var challenges: [Challenge]?
    @State private var error: String?
    @State private var actionError: String?
    @State private var joining: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Community", title: "Challenges")
                Loadable(value: challenges, error: error, retry: load) { list in
                    if list.isEmpty {
                        EmptyCard(systemName: "trophy", title: "No challenges running",
                                  detail: "Your coach will post the next one here.")
                    }
                    ForEach(list) { c in
                        challengeCard(c)
                        if c.isJoined, !c.leaderboard.isEmpty {
                            Eyebrow(text: "Leaderboard", trailing: c.title)
                            VStack(spacing: 0) {
                                ForEach(c.leaderboard) { row in
                                    HStack(spacing: 12) {
                                        Text("\(row.rank)").font(.jkCallout.weight(.semibold))
                                            .foregroundStyle(row.isMe == true ? JK.textTertiary : JK.text).frame(width: 18)
                                        Avatar(initials: row.initials ?? Fmt.initials(row.name), size: 26)
                                        Text(row.isMe == true ? "You" : row.name).font(.jkCallout.weight(.medium))
                                        Spacer()
                                        Text("\(Fmt.number(row.value)) km").font(.jkCallout.weight(.semibold))
                                    }
                                    .foregroundStyle(JK.text)
                                    .padding(12)
                                }
                            }
                            .jkCard(padding: 2)
                            HStack(spacing: 10) {
                                BadgeTile(systemName: "trophy", text: "\(c.badges ?? 0) badges")
                                BadgeTile(systemName: "flame", text: "\(c.streak ?? 0)-day streak")
                            }
                        }
                    }
                    Text("Distance comes from Apple Health (walking, running and rowing). Turn it on under Account › Health & devices.")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
            }
            .padding(16)
        }
        .jkScreen()
        .jkRefreshable { await load() }
        .task { await load() }
        .errorAlert($actionError)
    }

    private func challengeCard(_ c: Challenge) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let days = c.daysLeft {
                Text(days == 1 ? "1 day left" : "\(days) days left")
                    .font(.jkCaption)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(JK.raised, in: Capsule())
                    .foregroundStyle(JK.textSecondary)
            }
            Spacer().frame(height: 30)
            Text(c.title).font(.jkHeadline.weight(.semibold)).foregroundStyle(JK.text)
            Text([c.detail, c.members.map { "\($0) members taking part." }].compactMap { $0 }.joined(separator: " "))
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
            if c.isJoined {
                HStack {
                    ThinBar(fraction: c.target > 0 ? c.myValue / c.target : 0, height: 4)
                    Text("\(Fmt.number(c.myValue)) / \(Fmt.number(c.target)) km").font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
                }
            } else {
                Button {
                    Task { await join(c) }
                } label: {
                    if joining == c.id { ProgressView().tint(JK.onPrimary) } else { Text("Join challenge") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(joining != nil)
            }
        }
        .jkCard()
    }

    private func load() async {
        do {
            let reply: ChallengesResponse = try await api.get("/api/challenges")
            challenges = reply.challenges
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func join(_ c: Challenge) async {
        joining = c.id
        defer { joining = nil }
        do {
            let fresh: Challenge = try await api.send("POST", "/api/challenges/\(seg(c.id))/join")
            challenges = challenges?.map { $0.id == fresh.id ? fresh : $0 }
        } catch {
            actionError = error.readable
        }
    }
}

private struct BadgeTile: View {
    let systemName: String
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Glyph(systemName: systemName, size: 32)
            Text(text).font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
        }
        .jkCard(padding: 10)
    }
}

// MARK: - Weekly check-in

struct WeeklyCheckInView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppSession.self) private var session
    @State private var energy = 3
    @State private var sleep = 3
    @State private var pain: Set<String> = []
    @State private var note = ""
    @State private var history: CheckInsResponse?
    @State private var loadError: String?
    @State private var saving = false
    @State private var error: String?
    @State private var sent = false

    private let painOptions = ["Knee", "Back", "Shoulder", "Hip", "Other"]
    private var coachName: String { session.me?.coach?.name ?? "Your coach" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("How did this week feel, \(session.me?.firstName ?? "")?").font(.jkDisplay).foregroundStyle(JK.text)
                    Text("\(coachName) reviews these every week.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                if let loadError { ErrorBanner(message: loadError) }
                RatingCard(title: "Energy levels", hint: "1 = drained, 5 = excellent", value: $energy)
                RatingCard(title: "Sleep quality", hint: nil, value: $sleep)
                VStack(alignment: .leading, spacing: 10) {
                    Text("Any pain or niggles?").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            Chip(label: "None", selected: pain.isEmpty) { pain = [] }
                            ForEach(painOptions, id: \.self) { p in
                                Chip(label: p, selected: pain.contains(p)) {
                                    if pain.contains(p) { pain.remove(p) } else { pain.insert(p) }
                                }
                            }
                        }
                    }
                    TextField("Tell \(coachName) more", text: $note, axis: .vertical)
                        .lineLimit(2...5)
                        .font(.jkCaption)
                        .padding(10)
                        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip))
                }
                .jkCard()
                NavigationLink { ProgressScreen() } label: {
                    HStack {
                        Label("Add weekly photos", systemImage: "camera").font(.jkCallout.weight(.medium))
                        Spacer()
                        Text("Optional").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                    .foregroundStyle(JK.text)
                    .jkCard()
                }
                if let error { ErrorBanner(message: error) }
                Button {
                    Task { await submit() }
                } label: {
                    if saving { ProgressView().tint(JK.onPrimary) } else { Text(sent ? "Sent ✓" : (current == nil ? "Send check-in" : "Update check-in")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving)

                if let last = history?.checkins.first(where: { $0.reply?.isEmpty == false }) {
                    Eyebrow(text: "Latest reply · week of \(Fmt.dayMonth(last.week))")
                    Text(last.reply ?? "").font(.jkCaption).foregroundStyle(JK.text).jkCard()
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Weekly check-in")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var current: CheckIn? {
        guard let history, let due = history.dueWeek else { return nil }
        return history.checkins.first { $0.week == due }
    }

    private func load() async {
        do {
            let reply: CheckInsResponse = try await APIClient.shared.get("/api/checkins")
            history = reply
            loadError = nil
            if let c = current {
                energy = c.energy
                sleep = c.sleep
                pain = Set(c.pain)
                note = c.note ?? ""
            }
        } catch {
            if !error.isCancellation { loadError = error.readable }
        }
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        do {
            let _: CheckIn = try await APIClient.shared.send("POST", "/api/checkins", body: CheckInInput(
                energy: energy, sleep: sleep, pain: painOptions.filter { pain.contains($0) }, note: note))
            error = nil
            sent = true
            try? await Task.sleep(for: .milliseconds(600))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

