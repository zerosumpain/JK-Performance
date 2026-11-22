import AVFoundation
import SwiftUI

// MARK: - Letter composer (coach)

/// This week's letter for one client (atelier-spec.md, "LETTER COMPOSER"):
/// the week's context pinned at the top, then Headline, Keep, Adjust and
/// Question, an optional voice note (90 s cap), and publish now or schedule
/// for Monday 07:00. Publishing marks the check-in replied. Only the
/// headline is required, so a voice note plus a headline is enough.
struct LetterComposer: View {
    let client: PersonRef
    /// The Monday the letter covers; nil asks the server for the suggested week.
    var week: String? = nil
    /// A milestone the server suggested (from Needs you).
    var milestone: NeedsReason? = nil

    @Environment(\.dismiss) private var dismiss
    @StateObject private var voice = VoiceRecorder()
    @State private var report: Report?
    @State private var loadedWeek: String?
    @State private var error: String?
    @State private var kind = "weekly"
    @State private var headline = ""
    @State private var keep = ""
    @State private var adjust = ""
    @State private var question = ""
    @State private var milestoneKey: String?
    @State private var mediaId: String?
    @State private var contextOpen = true
    @State private var busy = false
    @State private var saveError: String?
    @State private var notice: String?

    private var firstName: String { client.firstName ?? client.name.split(separator: " ").first.map(String.init) ?? client.name }
    private var context: LetterContext? { report?.context }
    private var canSend: Bool { !headline.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !busy && !voice.recording }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xl) {
                if let error, report == nil {
                    ErrorCard(message: error) { await load() }
                } else if report == nil {
                    LoadingCard()
                } else {
                    statusLine
                    contextSection
                    kindSection
                    fields
                    voiceSection
                    actions
                }
            }
            .padding(.horizontal, JK.Space.gutter)
            .padding(.vertical, JK.Space.l)
        }
        .jkScreen()
        .navigationTitle("Letter to \(firstName)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear { voice.stopAll() }
    }

    // MARK: Sections

    @ViewBuilder
    private var statusLine: some View {
        if let r = report {
            Text(status(r)).font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    private func status(_ r: Report) -> String {
        let weekText = "Week of \(Fmt.dayMonth(r.week))"
        switch r.letterStatus {
        case "published"?: return "\(weekText) · delivered" + (r.readAt != nil ? " · read" : "")
        case "scheduled"?: return "\(weekText) · scheduled" + (r.deliverAt.map { " for \(Fmt.shortDay($0)) \(Fmt.time($0))" } ?? "")
        default: return r.id == nil ? "\(weekText) · not started" : "\(weekText) · draft"
        }
    }

    private var contextSection: some View {
        DisclosureGroup(isExpanded: $contextOpen) {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                if let scores = report?.scoreTrio, !scores.isEmpty { ScoreTrio(scores: scores) }
                if let dots = report?.weekDots, !dots.isEmpty {
                    WeekDots(days: dots.map { d in
                        WeekDots.Entry(day: d.date, done: d.done == true, rest: d.rest == true,
                                       future: d.future == true, isToday: d.date == Day.today)
                    })
                }
                checkinContext
                feelContext
                goalContext
                rhythmNote
            }
            .padding(.top, JK.Space.s)
        } label: {
            Text("This week").font(.jkHeadline).foregroundStyle(JK.text)
        }
        .tint(JK.textSecondary)
        .surface(.card)
    }

    @ViewBuilder
    private var checkinContext: some View {
        if let c = context?.checkin {
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(checkinFigures(c)).font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                if !c.pain.isEmpty { contextLine("Pain", c.pain.joined(separator: ", ")) }
                if let win = c.win, !win.isEmpty { contextLine("Win", win) }
                if let struggle = c.struggle, !struggle.isEmpty { contextLine("Struggle", struggle) }
                if let note = c.note, !note.isEmpty { contextLine("Note", note) }
            }
        } else {
            Text("No check-in for this week yet.").font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    private func checkinFigures(_ c: CheckIn) -> String {
        var parts = ["Energy \(c.energy)", "Sleep \(c.sleep)"]
        if let stress = c.stress { parts.insert("Stress \(stress)", at: 1) }
        return parts.joined(separator: " · ")
    }

    private func contextLine(_ label: String, _ text: String) -> some View {
        (Text("\(label): ").foregroundColor(JK.textSecondary) + Text(text).foregroundColor(JK.text))
            .font(.jkCaption)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var feelContext: some View {
        let feel = context?.week?.feel ?? []
        if !feel.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(feel.enumerated()), id: \.offset) { _, f in
                    Text([f.title, f.word ?? Feel.word(f.feel)].compactMap { $0 }.joined(separator: " · "))
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
        }
    }

    @ViewBuilder
    private var goalContext: some View {
        if let g = context?.goal, !g.isDraft {
            Text([g.title, g.remainingLabel, g.delta.map { "\(Fmt.delta($0)) \(g.unit ?? "") so far" }]
                    .compactMap { $0 }.joined(separator: " · "))
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    @ViewBuilder
    private var rhythmNote: some View {
        if context?.rhythm?.media == true {
            Text("Elite letters carry a voice note.").font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    @ViewBuilder
    private var kindSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Segmented(options: ["weekly", "milestone"], selection: $kind) { $0 == "weekly" ? "Weekly" : "Milestone" }
            if kind == "milestone" {
                let options = milestoneOptions
                if options.isEmpty {
                    Text("No milestone suggested this week. Write one anyway if it is earned.")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                ForEach(options, id: \.key) { m in
                    Button {
                        milestoneKey = m.key
                        if let h = m.suggestedHeadline { headline = h }
                    } label: {
                        CoachRowLabel(icon: .milestone, title: m.reason ?? m.key, detail: m.suggestedHeadline, chevron: false)
                    }
                    .buttonStyle(.plain)
                    .surface(.group)
                    .accessibilityAddTraits(milestoneKey == m.key ? .isSelected : [])
                }
            }
        }
    }

    private var milestoneOptions: [MilestoneSuggestion] {
        var list = context?.milestones ?? []
        if let m = milestone, let key = m.milestoneKey, !list.contains(where: { $0.key == key }) {
            list.insert(MilestoneSuggestion(key: key, reason: m.text, suggestedHeadline: m.suggestedHeadline), at: 0)
        }
        return list
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            JKField(label: "Headline", text: $headline, prompt: "Strongest week yet.")
            JKField(label: "Keep", text: $keep, prompt: "One win, with its number")
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                JKField(label: "Adjust", text: $adjust, prompt: "This week: protein at breakfast.")
                Text("Becomes the line on their Today.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            JKField(label: "Question", text: $question, prompt: "What got in the way on Thursday?")
        }
    }

    private var voiceSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text("Voice note").font(.jkHeadline).foregroundStyle(JK.text)
            if voice.recording {
                Text("Recording · \(clock(voice.elapsed)) of 1:30").font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                Button("Stop") { voice.stop() }.buttonStyle(SecondaryButtonStyle())
            } else if voice.file != nil {
                Text(mediaId == nil ? "Recorded · \(clock(voice.duration))" : "Attached · \(clock(voice.duration))")
                    .font(.jkCallout.monospacedDigit()).foregroundStyle(JK.text)
                HStack(spacing: JK.Space.s) {
                    Button(voice.playing ? "Pause" : "Play") { voice.togglePlay() }.buttonStyle(SecondaryButtonStyle())
                    Button("Discard") {
                        voice.discard()
                        mediaId = nil
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                if report?.mediaId != nil && mediaId != nil {
                    Text("A voice note is attached.").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Button {
                    Task { await voice.start() }
                } label: {
                    Label("Record a voice note", systemImage: IconKey.voiceNote.symbol)
                }
                .buttonStyle(SecondaryButtonStyle())
                Text("Up to 90 seconds.").font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            if let message = voice.error { ErrorBanner(message: message) }
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: JK.Space.m) {
            if let saveError { ErrorBanner(message: saveError) }
            if let notice { Text(notice).font(.jkCaption).foregroundStyle(JK.textSecondary) }
            PrimaryButton("Schedule for Monday 07:00", busy: busy) { Task { await save(status: "published", deliverAt: nil) } }
                .disabled(!canSend)
            Button("Publish now") { Task { await save(status: "published", deliverAt: "now") } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(!canSend)
            Button("Save draft") { Task { await save(status: "draft", deliverAt: nil) } }
                .buttonStyle(TextButtonStyle())
                .disabled(busy || voice.recording || report?.letterStatus == "published")
            Text("\(firstName) reads it on Monday morning, and their Today shows your Adjust line.")
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
        }
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let s = Int(seconds.rounded())
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }

    // MARK: Load and save

    private func load() async {
        do {
            var monday = week
            if monday == nil {
                let list: ReportsResponse = try await APIClient.shared.get("/api/reports", query: ["clientId": client.id])
                monday = list.suggestedWeek
            }
            guard let monday else { return }
            let r: Report = try await APIClient.shared.get("/api/reports/week/\(seg(monday))", query: ["clientId": client.id])
            loadedWeek = monday
            report = r
            fill(from: r)
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func fill(from r: Report) {
        if r.headline != nil || !r.summary.isEmpty { headline = r.displayHeadline }
        keep = r.keepText
        adjust = r.adjustText
        question = r.question ?? ""
        mediaId = r.mediaId
        if let m = milestone, m.kind == "milestone" {
            kind = "milestone"
            milestoneKey = m.milestoneKey
            headline = m.suggestedHeadline ?? headline
            keep = ""
            adjust = ""
            question = ""
            mediaId = nil
        }
    }

    private func save(status: String, deliverAt: String?) async {
        busy = true
        defer { busy = false }
        do {
            if voice.file != nil, mediaId == nil {
                mediaId = try await voice.upload(clientId: client.id)
            }
            let weekly = kind == "weekly"
            let input = LetterInput(clientId: client.id, week: weekly ? loadedWeek : nil, id: weekly ? report?.id : nil,
                                    kind: kind, headline: trimmed(headline), keep: trimmed(keep), adjust: trimmed(adjust),
                                    question: trimmed(question), mediaId: mediaId,
                                    milestoneKey: weekly ? nil : milestoneKey, status: status, deliverAt: deliverAt)
            let saved: Report = try await APIClient.shared.send("PUT", "/api/reports", body: input)
            report = saved.context == nil ? mergeContext(saved) : saved
            saveError = nil
            if status == "published" {
                dismiss()
            } else {
                notice = "Saved as a draft."
            }
        } catch {
            saveError = error.readable
        }
    }

    /// Keep the pinned context when the save reply leaves it out.
    private func mergeContext(_ fresh: Report) -> Report {
        var out = fresh
        out.context = report?.context
        out.scoreTrio = fresh.scoreTrio ?? report?.scoreTrio
        out.weekDots = fresh.weekDots ?? report?.weekDots
        return out
    }

    private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: - Voice note

/// Records an m4a (AAC) voice note of at most 90 seconds, plays it back,
/// and uploads it as letter media. Polls rather than using delegates so it
/// stays on the main actor.
@MainActor
final class VoiceRecorder: NSObject, ObservableObject {
    static let cap: TimeInterval = 90

    @Published private(set) var recording = false
    @Published private(set) var playing = false
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var file: URL?
    @Published var error: String?

    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var timer: Timer?

    func start() async {
        error = nil
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
            error = "Microphone access is off. Turn it on in Settings › JK Performance."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("letter-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let r = try AVAudioRecorder(url: url, settings: settings)
            guard r.record(forDuration: Self.cap) else {
                error = "Couldn't start recording."
                return
            }
            discard()
            recorder = r
            file = url
            recording = true
            elapsed = 0
            startTimer()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stop() {
        guard let recorder else { return }
        duration = min(recorder.currentTime, Self.cap)
        recorder.stop()
        finishRecording()
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
            player?.play()
            playing = true
            startTimer()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func discard() {
        player?.stop()
        player = nil
        playing = false
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        duration = 0
        elapsed = 0
    }

    func stopAll() {
        if recording { stop() }
        player?.stop()
        playing = false
        timer?.invalidate()
        timer = nil
    }

    /// POST /api/media (audio/mp4, purpose letter); returns the media id.
    func upload(clientId: String) async throws -> String {
        guard let file else { throw APIError.config("No recording to send.") }
        let data = try Data(contentsOf: file)
        let seconds = max(1, Int(duration.rounded()))
        let media: Media = try await APIClient.shared.upload("/api/media", data: data, contentType: "audio/mp4", query: [
            "purpose": "letter", "clientId": clientId, "durationSec": "\(min(seconds, Int(Self.cap)))",
        ])
        return media.id
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        if recording, let recorder {
            if recorder.isRecording {
                elapsed = recorder.currentTime
            } else {
                // record(forDuration:) stopped itself at the cap.
                duration = max(elapsed, duration)
                finishRecording()
            }
        } else if playing, let player, !player.isPlaying {
            playing = false
            player.currentTime = 0
            timer?.invalidate()
            timer = nil
        }
    }

    private func finishRecording() {
        recording = false
        recorder = nil
        if duration == 0 { duration = elapsed }
        timer?.invalidate()
        timer = nil
    }
}
