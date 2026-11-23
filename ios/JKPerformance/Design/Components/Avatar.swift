import SwiftUI
import UIKit

/// A person: their photo when there is one, otherwise initials on `raised`
/// scaled to the diameter (40%), not to the text size. Fixed circles (36 and
/// 32 are the standard sizes).
struct Avatar: View {
    let initials: String
    var size: CGFloat = JK.Size.avatar
    /// An uploaded portrait (GET /api/media/:id). Initials show while it loads or if it fails.
    var mediaId: String? = nil

    var body: some View {
        ZStack {
            Circle().fill(JK.raised)
            Text(initials)
                .font(.system(size: size * 0.4, weight: .medium))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .foregroundStyle(JK.text)
                .padding(size * 0.1)
            if let mediaId {
                PortraitImage(mediaId: mediaId)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// JK himself: his portrait (black and white sits right on the warm
/// off-black), or the monogram while it loads or when there is none, inside
/// a 1.5pt champagne ring. The ring is one of champagne's JK uses.
struct CoachAvatar: View {
    var coach: PersonRef? = nil
    var size: CGFloat = JK.Size.avatar
    /// Shows the unread dot (champagne) at the top right.
    var unread = false

    var body: some View {
        ZStack {
            Circle().fill(JK.raised)
            Text(coach.map { $0.initials ?? Fmt.initials($0.name) } ?? "JK")
                .font(.system(size: size * 0.34, weight: .semibold))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .foregroundStyle(JK.textSecondary)
            if let id = coach?.avatarMediaId {
                PortraitImage(mediaId: id)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .padding(2.5)
        .overlay(Circle().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        .overlay(alignment: .topTrailing) {
            if unread {
                Circle().fill(JK.silver)
                    .frame(width: 8, height: 8)
                    .overlay(Circle().stroke(JK.bg, lineWidth: 2))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(unread ? "JK, new" : "JK")
    }
}

/// A cached portrait filling its circle; empty until loaded so the fallback beneath shows.
struct PortraitImage: View {
    let mediaId: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            }
        }
        .task(id: mediaId) {
            image = PortraitStore.shared.cached(mediaId)
            if image == nil { image = await PortraitStore.shared.load(mediaId) }
        }
    }
}

/// Uploaded portraits, fetched once with the session token (AsyncImage sends
/// none), kept in memory and in Caches so the JK tab and avatars draw at once
/// on the next launch. Media ids are immutable: a new portrait is a new id.
@MainActor
final class PortraitStore {
    static let shared = PortraitStore()

    private let memory = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    private let folder: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("portraits", isDirectory: true)

    func cached(_ id: String) -> UIImage? {
        if let hit = memory.object(forKey: id as NSString) { return hit }
        guard let file = file(id), let data = try? Data(contentsOf: file), let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: id as NSString)
        return image
    }

    func load(_ id: String) async -> UIImage? {
        if let hit = cached(id) { return hit }
        if let running = inFlight[id] { return await running.value }
        let task = Task<UIImage?, Never> { @MainActor in
            guard let data = try? await APIClient.shared.data("/api/media/\(seg(id))"),
                  let image = UIImage(data: data) else { return nil }
            self.memory.setObject(image, forKey: id as NSString)
            if let file = self.file(id) {
                try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: file, options: .atomic)
            }
            return image
        }
        inFlight[id] = task
        let image = await task.value
        inFlight[id] = nil
        return image
    }

    /// Forget every portrait (sign-out).
    func clear() {
        memory.removeAllObjects()
        if let folder { try? FileManager.default.removeItem(at: folder) }
    }

    private func file(_ id: String) -> URL? {
        let safe = id.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        guard !safe.isEmpty else { return nil }
        return folder?.appendingPathComponent(safe)
    }
}

/// The JK tab's image: his portrait as an original-mode circle when there is
/// one, else the monogram as a template glyph (tinted like any tab). A tab
/// item only takes an Image and a Text, so this hands over a UIImage.
enum JKTabImage {
    static let side: CGFloat = JK.Size.iconTab + 4

    /// The portrait if it is cached or can be fetched, else the monogram.
    @MainActor
    static func load(for coach: PersonRef?) async -> UIImage {
        guard let id = coach?.avatarMediaId else { return monogram }
        var image = PortraitStore.shared.cached(id)
        if image == nil { image = await PortraitStore.shared.load(id) }
        return image.map { circle($0) } ?? monogram
    }

    /// The monogram at tab size, drawn once.
    static let monogram: UIImage = {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let image = renderer.image { ctx in
            let path = MonogramShape().path(in: CGRect(x: 0, y: 0, width: side, height: side))
            ctx.cgContext.addPath(path.cgPath)
            UIColor.black.setFill()
            ctx.cgContext.fillPath()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }()

    /// The photo cropped to a circle, kept in its own colours.
    static func circle(_ image: UIImage) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let out = renderer.image { _ in
            let rect = CGRect(x: 0, y: 0, width: side, height: side)
            UIBezierPath(ovalIn: rect).addClip()
            let scale = max(side / image.size.width, side / image.size.height)
            let w = image.size.width * scale, h = image.size.height * scale
            image.draw(in: CGRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
        }
        return out.withRenderingMode(.alwaysOriginal)
    }
}
