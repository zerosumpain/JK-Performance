import AVFoundation
import Observation
import SwiftUI

// Voice notes in the chat, both ways (desk-v2.md F19, "Apps"; contract
// docs/api/wp6-ai-voice.md). Shared by the client's JK thread, the coach's
// thread and the letter composer. Client screens are monochrome: flags and
// mood stay words beside a glyph; colour lives only in Coach/VoiceInsights.

// MARK: - Recorder

/// Records an AAC m4a of at most `cap` seconds with a live level, plays it
/// back, and uploads it (`purpose` voice or letter). Polls rather than using
/// delegates so it stays on the main actor.
@MainActor
final class VoiceRecorder: NSObject, ObservableObject {
    /// The longest take; the chat sets it from `me.features.voiceMaxSec` before recording.
    var cap: TimeInterval
    let purpose: String

    @Published private(set) var recording = false
    @Published private(set) var playing = false
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var file: URL?
    /// The last few levels (0…1), newest last: the live meter, then the preview's bars.
    @Published private(set) var levels: [Float] = []
    @Published var error: String?

    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var allLevels: [Float] = []
    static let meterBars = 32

    init(cap: TimeInterval, purpose: String) {
        self.cap = cap
        self.purpose = purpose
    }

    /// Time left before the cap stops the recording.
    var remaining: TimeInterval { max(0, cap - elapsed) }
    /// The chat warns 30 s before its 5-minute cap.
    var nearCap: Bool { recording && cap >= 120 && remaining <= 30 }
    var hasTake: Bool { file != nil && !recording }

    func start() async {
        error = nil
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
            error = "Microphone access is off. Turn it on in Settings › JK Performance."
            return
        }
        VoicePlayback.shared.stop()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(purpose)-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let r = try AVAudioRecorder(url: url, settings: settings)
            r.isMeteringEnabled = true
            guard r.record(forDuration: cap) else {
                error = "Couldn't start recording."
                return
            }
            discard()
            recorder = r
            file = url
            recording = true
            elapsed = 0
            levels = []
            allLevels = []
            startTimer()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stop() {
        guard let recorder else { return }
        duration = min(recorder.currentTime, cap)
        recorder.stop()
        finishRecording()
    }

    /// Stop and throw the take away.
    func cancel() {
        if let recorder {
            recorder.stop()
            recorder.deleteRecording()
        }
        finishRecording()
        discard()
    }

    func togglePlay() {
        guard let file else { return }
        if playing {
            player?.pause()
            playing = false
            return
        }
        do {
            if player == nil {
                try AVAudioSession.sharedInstance().setCategory(.playback)
                player = try AVAudioPlayer(contentsOf: file)
            }
            VoicePlayback.shared.stop()
            player?.play()
            playing = true
            startTimer()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Where the preview is (0…1), for its bars.
    var playFraction: Double {
        guard let player, player.duration > 0 else { return 0 }
        return player.currentTime / player.duration
    }

    func discard() {
        player?.stop()
        player = nil
        playing = false
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        duration = 0
        elapsed = 0
        levels = []
        allLevels = []
    }

    func stopAll() {
        if recording { stop() }
        player?.stop()
        playing = false
        timer?.invalidate()
        timer = nil
    }

    /// POST /api/media (audio/mp4) → the media id. A coach names the client.
    func upload(clientId: String?) async throws -> String {
        guard let file else { throw APIError.config("No recording to send.") }
        let data = try Data(contentsOf: file)
        let seconds = max(1, Int(duration.rounded()))
        var query: [String: String?] = ["purpose": purpose, "durationSec": "\(min(seconds, Int(cap)))"]
        if let clientId { query["clientId"] = clientId }
        let media: Media = try await APIClient.shared.upload("/api/media", data: data, contentType: "audio/mp4", query: query)
        return media.id
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        if recording, let recorder {
            if recorder.isRecording {
                elapsed = recorder.currentTime
                recorder.updateMeters()
                // -50 dB (quiet room) … 0 dB, eased so speech fills the bar.
                let db = recorder.averagePower(forChannel: 0)
                let level = Float(pow(Double(max(0, min(1, (db + 50) / 50))), 1.6))
                allLevels.append(level)
                levels = Array((levels + [level]).suffix(Self.meterBars))
            } else {
                // record(forDuration:) stopped itself at the cap.
                duration = max(elapsed, duration)
                finishRecording()
            }
        } else if playing, let player {
            objectWillChange.send()
            if !player.isPlaying {
                playing = false
                player.currentTime = 0
                timer?.invalidate()
                timer = nil
            }
        }
    }

    private func finishRecording() {
        recording = false
        recorder = nil
        if duration == 0 { duration = elapsed }
        timer?.invalidate()
        timer = nil
        levels = VoiceBars.resample(allLevels, to: Self.meterBars)
    }
}

// MARK: - Playback

/// One player for the whole app: starting a note stops any other. Downloads
/// the m4a once with the bearer token (AVPlayer cannot send it), then plays
/// it with AVAudioPlayer at 1×, 1.5× or 2×.
@MainActor
@Observable
final class VoicePlayback {
    static let shared = VoicePlayback()

    private(set) var currentKey: String?
    private(set) var loadingKey: String?
    private(set) var playing = false
    private(set) var position: TimeInterval = 0
    private(set) var length: TimeInterval = 0
    private(set) var rate: Float = 1
    private(set) var failedKey: String?

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var sessionReady = false

    func isCurrent(_ key: String) -> Bool { currentKey == key }
    func fraction(_ key: String) -> Double { currentKey == key && length > 0 ? min(1, position / length) : 0 }

    func toggle(key: String, path: String) async {
        if currentKey == key, let player {
            if playing { player.pause(); playing = false } else { player.play(); playing = true; startTimer() }
            return
        }
        stop()
        loadingKey = key
        failedKey = nil
        do {
            let file = try await MediaFiles.shared.file(path: path, key: key, ext: "m4a")
            guard loadingKey == key else { return }
            loadingKey = nil
            configureSession()
            let p = try AVAudioPlayer(contentsOf: file)
            p.enableRate = true
            p.rate = rate
            p.prepareToPlay()
            player = p
            currentKey = key
            length = p.duration
            position = 0
            p.play()
            playing = true
            startTimer()
            Task { await VoicePeaks.shared.load(key, file: file) }
        } catch {
            if loadingKey == key { loadingKey = nil }
            failedKey = key
        }
    }

    /// 1× → 1.5× → 2× → 1×.
    func cycleRate() {
        rate = rate < 1.25 ? 1.5 : (rate < 1.75 ? 2 : 1)
        player?.rate = rate
    }

    func seek(_ key: String, to fraction: Double) {
        guard currentKey == key, let player else { return }
        player.currentTime = max(0, min(1, fraction)) * player.duration
        position = player.currentTime
    }

    func stop() {
        player?.stop()
        player = nil
        playing = false
        currentKey = nil
        loadingKey = nil
        position = 0
        length = 0
        timer?.invalidate()
        timer = nil
    }

    private func configureSession() {
        guard !sessionReady else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        sessionReady = true
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard let player else { return }
        position = player.currentTime
        if !player.isPlaying && playing {
            playing = false
            player.currentTime = 0
            position = 0
            timer?.invalidate()
            timer = nil
        }
    }
}

/// The real waveform of a note once it has been downloaded: 40 RMS peaks,
/// computed off the main thread and cached by media id.
@MainActor
@Observable
final class VoicePeaks {
    static let shared = VoicePeaks()
    private(set) var peaks: [String: [Float]] = [:]

    func load(_ key: String, file: URL) async {
        guard peaks[key] == nil else { return }
        let computed = await Task.detached(priority: .utility) { VoicePeaks.compute(file, count: 40) }.value
        if !computed.isEmpty { peaks[key] = computed }
    }

    nonisolated static func compute(_ url: URL, count: Int) -> [Float] {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0 else { return [] }
        let per = AVAudioFrameCount(max(1, Int(file.length) / count))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: per) else { return [] }
        var out: [Float] = []
        for _ in 0..<count {
            guard (try? file.read(into: buffer, frameCount: per)) != nil, buffer.frameLength > 0,
                  let samples = buffer.floatChannelData?[0] else { break }
            let n = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0..<n { sum += samples[i] * samples[i] }
            out.append((sum / Float(n)).squareRoot())
        }
        let top = out.max() ?? 0
        return top > 0 ? out.map { $0 / top } : []
    }
}

/// Bar heights: the real peaks once known, else a calm seeded placeholder
/// (the same for a note every time) so the bubble has its shape at once.
enum VoiceBars {
    static func placeholder(_ key: String, count: Int = 40) -> [Float] {
        var seed: UInt64 = 1469598103934665603
        for b in key.utf8 { seed = (seed ^ UInt64(b)) &* 1099511628211 }
        return (0..<count).map { i in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            let noise = Float((seed >> 33) % 1000) / 1000
            let envelope = Float(sin(Double(i) / Double(count) * .pi)) * 0.5 + 0.35
            return min(1, max(0.12, envelope * (0.55 + noise * 0.6)))
        }
    }

    static func resample(_ values: [Float], to count: Int) -> [Float] {
        guard !values.isEmpty else { return [] }
        return (0..<count).map { i in
            let lo = i * values.count / count
            let hi = max(lo + 1, (i + 1) * values.count / count)
            let slice = values[lo..<min(hi, values.count)]
            return slice.max() ?? 0
        }
    }
}

/// Vertical bars, lit up to `progress` (silver), the rest on the strong track.
struct VoiceWaveform: View {
    let levels: [Float]
    var progress: Double = 0
    var lit: Color = JK.silver
    var dim: Color = JK.trackStrong
    var height: CGFloat = JK.Space.xxl

    var body: some View {
        GeometryReader { geo in
            let count = max(levels.count, 1)
            let gap: CGFloat = 2
            let width = max(1.5, (geo.size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            HStack(alignment: .center, spacing: gap) {
                ForEach(Array(levels.enumerated()), id: \.offset) { i, level in
                    Capsule()
                        .fill(Double(i) / Double(count) < progress ? lit : dim)
                        .frame(width: width, height: max(3, CGFloat(level) * geo.size.height))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

// MARK: - Bubble

/// A voice note in a thread, chosen by `kind == "voice"`: play/pause through
/// the shared player, the waveform, the time, the speed; then the transcript
/// disclosure with its per-state copy; then, only when the server sent them
/// (a coach), the summary, mood, flags and action items.
struct VoiceNoteBubble: View {
    let message: Message
    /// The signed-in person is a client (the copy differs for noConsent).
    let forClient: Bool
    /// The bubble is the signed-in person's own.
    var mine = false
    /// "Change" on a client's untranscribed note (Account › Privacy).
    var onChangeConsent: (() -> Void)? = nil
    /// Coach: the note came back with a new state (retry).
    var onUpdate: ((VoiceInfo) -> Void)? = nil

    @State private var open = false
    private var playback: VoicePlayback { VoicePlayback.shared }

    private var voice: VoiceInfo { message.voice ?? VoiceInfo(status: .failed) }
    private var key: String { voice.mediaId ?? message.id }
    private var path: String? {
        if let url = voice.url, url.hasPrefix("/api/") { return url }
        return voice.mediaId.map { "/api/media/\(seg($0))" }
    }
    private var seconds: Double? { voice.durationSec ?? message.durationSec }
    /// A typed caption, rather than the server's "Voice note · 0:42" fallback.
    private var caption: String? {
        let t = message.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty || t.hasPrefix("Voice note") ? nil : t
    }

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            if voice.playable, let path {
                player(path)
            } else {
                HStack(spacing: JK.Space.s) {
                    Image(systemName: "waveform.slash").font(.jkCallout).foregroundStyle(JK.textTertiary)
                    Text(VoiceCopy.state(voice, forClient: forClient)).font(.jkCallout).foregroundStyle(JK.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            if let caption {
                LinkedText(caption).font(.jkBody).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if voice.status != .deleted { transcript }
            if voice.hasAnalysis { VoiceInsights(message: message, voice: voice) }
            if !forClient, voice.status == .failed || (voice.status == .off && voice.reason != "noConsent") {
                VoiceRetryButton(messageId: message.id, onUpdate: onUpdate)
            }
        }
    }

    private func player(_ path: String) -> some View {
        let current = playback.isCurrent(key)
        let loading = playback.loadingKey == key
        let playingNow = current && playback.playing
        let levels = VoicePeaks.shared.peaks[key] ?? VoiceBars.placeholder(key)
        return VStack(alignment: .leading, spacing: JK.Space.xs) {
            HStack(spacing: JK.Space.m) {
                Button { Task { await playback.toggle(key: key, path: path) } } label: {
                    ZStack {
                        Circle().fill(mine ? JK.primaryFill : JK.raised)
                        if loading {
                            ProgressView().tint(mine ? JK.onPrimary : JK.text)
                        } else {
                            Image(systemName: playingNow ? "pause.fill" : "play.fill")
                                .font(.jkCallout)
                                .foregroundStyle(mine ? JK.onPrimary : JK.text)
                                .offset(x: playingNow ? 0 : 1)
                        }
                    }
                    .frame(width: JK.Size.touch, height: JK.Size.touch)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playingNow ? "Pause voice note" : "Play voice note")
                .accessibilityValue(seconds.map { VoiceCopy.clock($0) } ?? "")
                VoiceWaveform(levels: levels, progress: playback.fraction(key))
                    .overlay {
                        // Tap or drag along the bars to move through the note that is playing.
                        GeometryReader { geo in
                            Color.clear
                                .contentShape(Rectangle())
                                .gesture(DragGesture(minimumDistance: 0).onEnded { drag in
                                    guard current, geo.size.width > 0 else { return }
                                    playback.seek(key, to: drag.location.x / geo.size.width)
                                })
                        }
                    }
            }
            HStack(spacing: JK.Space.s) {
                Text(timeLabel(current: current))
                    .font(.jkMeta.monospacedDigit())
                    .foregroundStyle(JK.textSecondary)
                if playback.failedKey == key {
                    Text("Couldn't play it").font(.jkMeta).foregroundStyle(JK.textSecondary)
                }
                Spacer(minLength: 0)
                if current {
                    Button { playback.cycleRate() } label: {
                        Text(rateLabel)
                            .font(.jkMicro.monospacedDigit())
                            .foregroundStyle(JK.text)
                            .padding(.horizontal, JK.Space.s)
                            .padding(.vertical, 2)
                            .overlay(Capsule().strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                            .frame(minWidth: JK.Size.touch, minHeight: JK.Space.xxl)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Playback speed \(rateLabel)")
                }
            }
            .padding(.leading, JK.Size.touch + JK.Space.m)
        }
    }

    private var rateLabel: String {
        switch playback.rate {
        case ..<1.25: return "1×"
        case ..<1.75: return "1.5×"
        default: return "2×"
        }
    }

    private func timeLabel(current: Bool) -> String {
        let total = seconds.map { VoiceCopy.clock($0) } ?? "–:––"
        guard current else { return total }
        return "\(VoiceCopy.clock(playback.position)) / \(total)"
    }

    @ViewBuilder
    private var transcript: some View {
        switch voice.status {
        case .pending:
            HStack(spacing: JK.Space.s) {
                ProgressView().controlSize(.mini).tint(JK.textSecondary)
                Text(VoiceCopy.state(voice, forClient: forClient)).font(.jkMeta).foregroundStyle(JK.textSecondary)
            }
            .shimmering()
        case .done:
            if let text = voice.transcript {
                VStack(alignment: .leading, spacing: JK.Space.xs) {
                    Button {
                        withAnimation(JK.Motion.standard) { open.toggle() }
                    } label: {
                        HStack(spacing: JK.Space.xs) {
                            Text("Transcript").font(.jkCaption).foregroundStyle(JK.text)
                            Image(systemName: "chevron.down")
                                .font(.jkMicro)
                                .foregroundStyle(JK.textSecondary)
                                .rotationEffect(.degrees(open ? 180 : 0))
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: JK.Size.touch - JK.Space.m)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(open ? "Hide transcript" : "Show transcript")
                    if open {
                        Text(text)
                            .font(.jkSerifBody)
                            .foregroundStyle(JK.text)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .transition(.opacity)
                    }
                    Text(VoiceCopy.state(voice, forClient: forClient)).font(.jkMicro).foregroundStyle(JK.textTertiary)
                }
            } else {
                Text(VoiceCopy.state(voice, forClient: forClient)).font(.jkMeta).foregroundStyle(JK.textTertiary)
            }
        default:
            HStack(spacing: JK.Space.xs) {
                Text(VoiceCopy.state(voice, forClient: forClient)).font(.jkMeta).foregroundStyle(JK.textTertiary)
                if VoiceCopy.offersConsentChange(voice, forClient: forClient), let onChangeConsent {
                    Text("·").font(.jkMeta).foregroundStyle(JK.textTertiary)
                    Button("Change", action: onChangeConsent)
                        .font(.jkMeta.weight(.semibold))
                        .foregroundStyle(JK.text)
                        .buttonStyle(.plain)
                        .frame(minHeight: JK.Size.touch - JK.Space.m)
                }
            }
        }
    }
}

/// Coach: "Retry transcription" on a failed or switched-off note.
struct VoiceRetryButton: View {
    let messageId: String
    var onUpdate: ((VoiceInfo) -> Void)?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        HStack(spacing: JK.Space.s) {
            Button {
                Task { await retry() }
            } label: {
                if busy { ProgressView().controlSize(.mini) } else { Label("Retry transcription", systemImage: "arrow.clockwise") }
            }
            .buttonStyle(SmallPillStyle())
            .disabled(busy)
            if let error { Text(error).font(.jkMeta).foregroundStyle(JK.textSecondary) }
        }
    }

    private func retry() async {
        busy = true
        defer { busy = false }
        do {
            let reply: VoiceRetryReply = try await APIClient.shared.send("POST", "/api/voice/\(seg(messageId))/retry")
            error = nil
            onUpdate?(reply.voice)
        } catch {
            self.error = error.readable
        }
    }
}

private struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(dim ? 0.45 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
            }
    }
}

extension View {
    /// A slow breathe for "Transcribing…" (still with Reduce Motion).
    func shimmering() -> some View { modifier(Shimmer()) }
}

// MARK: - Composer

/// The recording bar that replaces the text field: Cancel, a breathing dot,
/// the timer, the live level and Stop; then the preview with Delete, Play
/// and Send. Uploads happen in the caller's `onSend`.
struct VoiceComposerBar: View {
    @ObservedObject var voice: VoiceRecorder
    let sending: Bool
    let onSend: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            HStack(spacing: JK.Space.s) {
                if voice.recording { recordingRow } else { previewRow }
            }
            .padding(.leading, JK.Space.xs)
            .padding(.trailing, JK.Space.xs)
            .frame(minHeight: JK.Size.touch + JK.Space.s)
            .background(JK.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
            if voice.nearCap {
                Text("\(Int(voice.remaining.rounded())) seconds left").font(.jkMeta).foregroundStyle(JK.textSecondary)
                    .padding(.leading, JK.Space.l)
            } else if voice.recording {
                Text("Up to \(VoiceCopy.clock(voice.cap)). Tap stop to listen back.").font(.jkMeta).foregroundStyle(JK.textTertiary)
                    .padding(.leading, JK.Space.l)
            }
        }
    }

    @ViewBuilder
    private var recordingRow: some View {
        circleButton("xmark", label: "Cancel recording", filled: false) { voice.cancel() }
        Circle()
            .fill(JK.text)
            .frame(width: JK.Space.s, height: JK.Space.s)
            .opacity(pulse ? 0.25 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
            }
            .accessibilityHidden(true)
        Text(VoiceCopy.clock(voice.elapsed))
            .font(.jkCallout.monospacedDigit())
            .foregroundStyle(JK.text)
            .accessibilityLabel("Recording, \(VoiceCopy.clock(voice.elapsed))")
        VoiceWaveform(levels: paddedLevels, progress: 1, lit: JK.text, height: JK.Space.xl)
        circleButton("stop.fill", label: "Stop recording", filled: true) { voice.stop() }
    }

    @ViewBuilder
    private var previewRow: some View {
        circleButton("trash", label: "Delete this recording", filled: false) { voice.discard() }
            .disabled(sending)
        circleButton(voice.playing ? "pause.fill" : "play.fill", label: voice.playing ? "Pause" : "Listen back", filled: false) {
            voice.togglePlay()
        }
        .disabled(sending)
        VoiceWaveform(levels: voice.levels.isEmpty ? VoiceBars.placeholder("take") : voice.levels,
                      progress: voice.playing ? voice.playFraction : 1, lit: JK.text, height: JK.Space.xl)
        Text(VoiceCopy.clock(voice.duration)).font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
        if sending {
            ProgressView().tint(JK.text).frame(width: JK.Size.touch, height: JK.Size.touch)
        } else {
            circleButton("arrow.up", label: "Send voice note", filled: true, action: onSend)
        }
    }

    /// The live meter scrolls in from the right.
    private var paddedLevels: [Float] {
        let pad = max(0, VoiceRecorder.meterBars - voice.levels.count)
        return Array(repeating: 0.06, count: pad) + voice.levels
    }

    private func circleButton(_ symbol: String, label: String, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.jkCallout)
                .foregroundStyle(filled ? JK.onPrimary : JK.text)
                .frame(width: JK.Size.touch - JK.Space.xs, height: JK.Size.touch - JK.Space.xs)
                .background(filled ? JK.primaryFill : Color.clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The mic beside the composer's field.
struct MicButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "mic")
                .font(.jkHeadline)
                .foregroundStyle(JK.text)
                .frame(minWidth: JK.Size.touch, minHeight: JK.Size.touch)
                .overlay(Circle().strokeBorder(JK.buttonBorder, lineWidth: JK.Size.hairline))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Record a voice note")
    }
}

// MARK: - Consent (D16)

/// The one-time sheet before a client's first voice note. Either answer
/// records; only Allow lets the server transcribe.
struct VoiceConsentSheet: View {
    let provider: String?
    let onChoice: (Bool) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xl) {
                HStack(spacing: JK.Space.m) {
                    Icon(key: .voiceNote, size: JK.Size.iconHabit).foregroundStyle(JK.silver)
                        .frame(width: JK.Size.ringCommitment, height: JK.Size.ringCommitment)
                        .overlay(Circle().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
                    JKLabel("Voice notes")
                }
                SerifText("Your voice, *in words* for JK.", size: .title).foregroundStyle(JK.text)
                    .accessibilityAddTraits(.isHeader)
                Text(VoiceCopy.consent(provider: provider))
                    .font(.jkBody).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: JK.Space.s) {
                    point("JK hears every voice note, whichever you choose.")
                    point("Nothing is shared with anyone else.")
                    point("Change it any time in Account › Privacy.")
                }
                VStack(spacing: JK.Space.m) {
                    PrimaryButton("Allow") { choose(true) }
                    SecondaryButton("Send without transcription") { choose(false) }
                }
                .padding(.top, JK.Space.s)
            }
            .padding(JK.Space.gutter)
            .padding(.top, JK.Space.l)
        }
        .background(JK.bg.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func point(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: JK.Space.s) {
            Image(systemName: "checkmark").font(.jkMeta).foregroundStyle(JK.textSecondary).accessibilityHidden(true)
            Text(text).font(.jkCallout).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func choose(_ allow: Bool) {
        onChoice(allow)
        dismiss()
    }
}

/// PUT /api/voice/consent, then refresh `me` so the sheet never shows again.
@MainActor
enum VoiceConsentStore {
    static func set(_ on: Bool, session: AppSession) async throws {
        let _: VoiceConsent = try await APIClient.shared.send("PUT", "/api/voice/consent", body: VoiceConsentInput(voice: on ? "on" : "off"))
        await session.refreshMe()
    }
}

/// Sends a recorded note into a thread: upload, then `kind: voice`.
@MainActor
enum VoiceSend {
    static func send(_ voice: VoiceRecorder, clientId: String?) async throws -> Message {
        do {
            let mediaId = try await voice.upload(clientId: clientId)
            let sent: Message = try await APIClient.shared.send("POST", "/api/messages", body: MessageInput(
                text: "", clientId: clientId, workoutId: nil, mediaId: mediaId, kind: "voice"))
            voice.discard()
            return sent
        } catch let error as APIError {
            throw APIError.transport(VoiceCopy.sendError(status: error.status, message: error.readable))
        }
    }
}
