import AVFoundation
import AVKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Media for letters, form checks, meal photos and check-in photos
// (docs/API.md, "Media"): POST /api/media takes the raw bytes; GET
// /api/media/:id needs the bearer token, so playback downloads to a cached
// file first (AVPlayer cannot send the header).

enum MediaUpload {
    /// Longest form check JK will watch (and the server accepts).
    static let maxSeconds: Double = 90

    static func image(_ image: UIImage, purpose: String) async throws -> Media {
        guard let jpeg = image.jpegForUpload() else { throw APIError.transport("Couldn't read that photo.") }
        return try await APIClient.shared.upload("/api/media", data: jpeg, contentType: "image/jpeg", query: ["purpose": purpose])
    }

    /// A video file as MP4 (the server takes video/mp4), at most 90 s, 720p.
    static func video(at url: URL, purpose: String) async throws -> Media {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        guard duration <= maxSeconds + 1 else { throw APIError.transport("Keep it under 90 seconds.") }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString).mp4")
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            throw APIError.transport("Couldn't prepare that video.")
        }
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        await export.export()
        guard export.status == .completed else { throw APIError.transport("Couldn't prepare that video.") }
        defer { try? FileManager.default.removeItem(at: out) }
        let data = try Data(contentsOf: out)
        return try await APIClient.shared.upload("/api/media", data: data, contentType: "video/mp4", query: [
            "purpose": purpose, "durationSec": String(Int(duration.rounded())),
        ])
    }
}

/// A video from the Photos picker, as a file.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("picked-\(UUID().uuidString).\(received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return Self(url: copy)
        }
    }
}

/// The camera, recording up to 90 seconds of video. Falls back to nothing
/// (the caller offers the library) where there is no camera.
struct VideoCamera: UIViewControllerRepresentable {
    let onDone: (URL?) -> Void

    static var available: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.movie.identifier]
        picker.cameraCaptureMode = .video
        picker.videoMaximumDuration = MediaUpload.maxSeconds
        picker.videoQuality = .typeIFrame1280x720
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onDone: (URL?) -> Void
        init(onDone: @escaping (URL?) -> Void) { self.onDone = onDone }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onDone(info[.mediaURL] as? URL)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onDone(nil) }
    }
}

/// "Send form check": film the set (or pick a clip) and send it to JK, tied to
/// the exercise. Shown only when JK has form checks on.
struct FormCheckButton: View {
    let exerciseId: String
    let exerciseName: String
    var workoutId: String? = nil

    @State private var filming = false
    @State private var picked: PhotosPickerItem?
    @State private var choosing = false
    @State private var sending = false
    @State private var toast: String?
    @State private var error: String?

    var body: some View {
        Button {
            if VideoCamera.available { filming = true } else { choosing = true }
        } label: {
            if sending { ProgressView().tint(JK.text) } else { Label("Send form check", systemImage: IconKey.formCheck.symbol) }
        }
        .buttonStyle(TextButtonStyle())
        .disabled(sending)
        .fullScreenCover(isPresented: $filming) {
            VideoCamera { url in
                filming = false
                if let url { Task { await send(url) } }
            }
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $choosing, selection: $picked, matching: .videos)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                defer { picked = nil }
                if let movie = try? await item.loadTransferable(type: PickedMovie.self) { await send(movie.url) }
            }
        }
        .jkToast($toast)
        .errorAlert($error)
    }

    private func send(_ url: URL) async {
        sending = true
        defer { sending = false }
        do {
            let media = try await MediaUpload.video(at: url, purpose: "formCheck")
            let _: Message = try await APIClient.shared.send("POST", "/api/messages", body: MessageInput(
                text: "Form check: \(exerciseName)", clientId: nil, workoutId: workoutId,
                exerciseId: exerciseId, mediaId: media.id, kind: "formCheck"))
            toast = "Sent to JK"
        } catch {
            self.error = error.readable
        }
    }
}

/// Plays a voice or video note: downloads it once with the token, then AVPlayer.
@MainActor
final class MediaFiles {
    static let shared = MediaFiles()
    private var local: [String: URL] = [:]

    func file(for mediaId: String, kind: String?) async throws -> URL {
        try await file(path: "/api/media/\(seg(mediaId))", key: mediaId, ext: kind == "video" ? "mp4" : "m4a")
    }

    /// Any signed-in media path the server gave (a voice note's `voice.url`, a
    /// guide's `/api/guides/coach/…/media/…`). Only our own `/api/` paths are
    /// fetched with the token; `key` names the cached file.
    func file(path: String, key: String, ext: String) async throws -> URL {
        if let hit = local[key], FileManager.default.fileExists(atPath: hit.path) { return hit }
        guard path.hasPrefix("/api/"), !path.contains("..") else { throw APIError.config("That file is not on JK's server.") }
        let data = try await APIClient.shared.data(path)
        let safe = key.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("media-\(safe).\(ext)")
        try data.write(to: url, options: .atomic)
        local[key] = url
        return url
    }
}

/// JK's voice or video note in a letter: his portrait as the poster, a play
/// button and the length. Video opens full screen.
struct MediaNote: View {
    let mediaId: String
    let kind: String?
    var durationSec: Double?
    var coach: PersonRef?

    @State private var player: AVPlayer?
    @State private var playing = false
    @State private var loading = false
    @State private var video: URL?
    @State private var error: String?

    var body: some View {
        HStack(spacing: JK.Space.m) {
            CoachAvatar(coach: coach, size: JK.Size.avatar)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(kind == "video" ? "A video from JK" : "A voice note from JK").font(.jkCallout).foregroundStyle(JK.text)
                if let durationSec {
                    Text(Fmt.clock(durationSec)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                }
                if let error { Text(error).font(.jkCaption).foregroundStyle(JK.textSecondary) }
            }
            Spacer(minLength: 0)
            Button { Task { await toggle() } } label: {
                Group {
                    if loading { ProgressView().tint(JK.text) } else {
                        Image(systemName: playing ? "pause.circle" : IconKey.play.symbol).font(.title)
                    }
                }
                .foregroundStyle(JK.text)
                .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playing ? "Pause" : "Play")
        }
        .fullScreenCover(item: Binding(get: { video.map(PlayableURL.init) }, set: { video = $0?.url })) { item in
            VideoPlayer(player: AVPlayer(url: item.url))
                .ignoresSafeArea()
                .overlay(alignment: .topTrailing) {
                    Button("Close") { video = nil }.buttonStyle(TextButtonStyle()).padding()
                }
        }
        .onDisappear { player?.pause() }
    }

    private func toggle() async {
        if let player, kind != "video" {
            if playing { player.pause() } else { player.play() }
            playing.toggle()
            return
        }
        loading = true
        defer { loading = false }
        do {
            let url = try await MediaFiles.shared.file(for: mediaId, kind: kind)
            if kind == "video" {
                video = url
            } else {
                try? AVAudioSession.sharedInstance().setCategory(.playback)
                let p = AVPlayer(url: url)
                player = p
                p.play()
                playing = true
                NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                       object: p.currentItem, queue: .main) { _ in
                    Task { @MainActor in
                        playing = false
                        p.seek(to: .zero)
                    }
                }
            }
            error = nil
        } catch {
            self.error = "Couldn't play it. Try again."
        }
    }
}

struct PlayableURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// A photo or video someone sent in the thread (form check, meal photo).
struct MessageMedia: View {
    let mediaId: String
    let isVideo: Bool

    @State private var image: UIImage?
    @State private var video: URL?
    @State private var loading = false

    var body: some View {
        Group {
            if isVideo {
                Button { Task { await play() } } label: {
                    HStack(spacing: JK.Space.s) {
                        if loading { ProgressView().tint(JK.text) } else { Icon(key: .play, size: JK.Size.iconHabit).foregroundStyle(JK.text) }
                        Text("Play the clip").font(.jkCallout).foregroundStyle(JK.text)
                    }
                    .frame(minHeight: JK.Size.touch)
                }
                .buttonStyle(.plain)
            } else if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
                    .accessibilityLabel("Photo")
            } else {
                ProgressView().tint(JK.textSecondary)
            }
        }
        .task(id: mediaId) {
            guard !isVideo, image == nil else { return }
            if let data = try? await APIClient.shared.data("/api/media/\(seg(mediaId))") { image = UIImage(data: data) }
        }
        .fullScreenCover(item: Binding(get: { video.map(PlayableURL.init) }, set: { video = $0?.url })) { item in
            VideoPlayer(player: AVPlayer(url: item.url))
                .ignoresSafeArea()
                .overlay(alignment: .topTrailing) {
                    Button("Close") { video = nil }.buttonStyle(TextButtonStyle()).padding()
                }
        }
    }

    private func play() async {
        loading = true
        defer { loading = false }
        video = try? await MediaFiles.shared.file(for: mediaId, kind: "video")
    }
}

extension Fmt {
    /// 75 → "1:15".
    static func clock(_ seconds: Double) -> String {
        let s = Int(seconds.rounded())
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }
}
