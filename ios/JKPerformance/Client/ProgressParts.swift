import PhotosUI
import SwiftUI

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

struct MeasurementSheet: View {
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
                Segmented(options: kinds, selection: $kind) { Measure.label($0) }
                JKField(label: "\(Measure.label(kind)) (\(unitName))", text: $value, prompt: "0", keyboard: .decimalPad)
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
                        EmptyCard(systemName: IconKey.record.symbol, title: "No challenges running",
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
                                BadgeTile(systemName: IconKey.record.symbol, text: "\(c.badges ?? 0) badges")
                                BadgeTile(systemName: IconKey.done.symbol, text: "\(c.streak ?? 0) days done in a row")
                            }
                        }
                    }
                    Text("Distance comes from Apple Health (walking, running and rowing). Connect it under Account › Apple Health.")
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
            if let end = c.end {
                Text("Until \(Fmt.dayMonth(end))")
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
