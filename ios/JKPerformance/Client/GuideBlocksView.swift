import AVKit
import SwiftUI

// The native guide renderer (desk-v2.md F14): JK's block documents, drawn on
// paper like his letters. Text is plain; `**bold**` and `_italic_` are the
// only formatting (InlineMarkup), so nothing a guide says is ever HTML.
// Media come through the guide's own route (`block.url`), never /api/media.

/// GET /api/guides/coach/:id: a published guide of the client's own coach.
struct CoachGuideView: View {
    let guideId: String
    @State private var guide: CoachGuide?
    @State private var error: String?

    var body: some View {
        Group {
            if let guide {
                GuideReader(title: guide.title, summary: guide.summary, minutes: guide.readMinutes, blocks: guide.blocks, guideId: guide.id)
            } else {
                ScrollView {
                    Group {
                        if let error { ErrorCard(message: error) { await load() } } else { LoadingCard() }
                    }
                    .padding(JK.Space.gutter)
                }
                .jkScreen()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            let reply: CoachGuideResponse = try await APIClient.shared.get("/api/guides/coach/\(seg(guideId))")
            guide = reply.guide
            error = nil
        } catch {
            if !error.isCancellation {
                self.error = (error as? APIError)?.status == 404 ? "This guide isn't available any more." : error.readable
            }
        }
    }
}

/// One guide on paper: the rule, the serif title, how long, the blocks, the mark.
struct GuideReader: View {
    let title: String
    let summary: String?
    let minutes: Int?
    let blocks: [GuideBlock]
    let guideId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                BrandRule()
                Text(title).jkText(.letterHeadline).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let summary, !summary.isEmpty {
                    Text(summary).font(.jkSerif(.notes, italic: true)).foregroundStyle(JK.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let minutes, minutes > 0 {
                    Text("\(minutes) min read").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                GuideBlocksView(blocks: blocks)
                    .padding(.top, JK.Space.s)
                Monogram(size: JK.Space.huge).foregroundStyle(JK.silver).padding(.top, JK.Space.l)
                    .accessibilityHidden(true)
            }
            .surface(.paper, padding: JK.Space.xxl)
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { VoicePlayback.shared.stop() }
    }
}

/// The blocks themselves; unknown kinds are skipped.
struct GuideBlocksView: View {
    let blocks: [GuideBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.l) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                if GuideBlock.known.contains(block.t) {
                    GuideBlockView(block: block, index: index)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct GuideBlockView: View {
    let block: GuideBlock
    let index: Int

    var body: some View {
        switch block.t {
        case "h":
            SerifText(WeekText.plain(block.text ?? ""), size: .quote)
                .foregroundStyle(JK.text)
                .padding(.top, index == 0 ? 0 : JK.Space.s)
                .accessibilityAddTraits(.isHeader)
        case "p":
            InlineText(block.text ?? "").font(.jkBody).foregroundStyle(JK.text)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        case "list":
            GuideList(style: block.style ?? "bullet", items: block.items ?? [])
        case "callout":
            GuideCallout(tone: block.tone ?? "info", text: block.text ?? "")
        case "image":
            GuideImage(block: block)
        case "video":
            GuideVideo(block: block)
        case "audio":
            GuideAudio(block: block, index: index)
        case "link":
            GuideLink(block: block)
        case "exercise":
            GuideExercise(exerciseId: block.exerciseId ?? "")
        case "divider":
            Rectangle().fill(JK.hairline).frame(height: JK.Size.hairline)
                .padding(.vertical, JK.Space.xs)
                .accessibilityHidden(true)
        default:
            EmptyView()
        }
    }
}

/// `**bold**` and `_italic_`, nothing else.
struct InlineText: View {
    let source: String
    init(_ source: String) { self.source = source }

    var body: some View {
        InlineMarkup.runs(source).reduce(Text("")) { acc, run in
            var piece = Text(run.text)
            if run.bold { piece = piece.bold() }
            if run.italic { piece = piece.italic() }
            return acc + piece
        }
        .accessibilityLabel(InlineMarkup.plain(source))
    }
}

private struct GuideList: View {
    let style: String
    let items: [String]
    @State private var ticked: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                HStack(alignment: .firstTextBaseline, spacing: JK.Space.m) {
                    marker(i)
                    InlineText(item).font(.jkBody).foregroundStyle(JK.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.leading, JK.Space.xs)
    }

    @ViewBuilder
    private func marker(_ i: Int) -> some View {
        switch style {
        case "number":
            Text("\(i + 1).").font(.jkBody.monospacedDigit()).foregroundStyle(JK.textSecondary)
                .frame(minWidth: JK.Space.xl, alignment: .trailing)
        case "check":
            // A reading aid only: ticks stay on this phone and are not sent.
            Button {
                if ticked.contains(i) { ticked.remove(i) } else { ticked.insert(i) }
            } label: {
                Image(systemName: ticked.contains(i) ? "checkmark.circle.fill" : "circle")
                    .font(.jkBody)
                    .foregroundStyle(ticked.contains(i) ? JK.silver : JK.trackStrong)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ticked.contains(i) ? "Ticked" : "Not ticked")
        default:
            Circle().fill(JK.textSecondary).frame(width: 5, height: 5)
                .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 5 }
                .frame(minWidth: JK.Space.s)
                .accessibilityHidden(true)
        }
    }
}

private struct GuideCallout: View {
    let tone: String
    let text: String

    private var glyph: String {
        switch tone {
        case "tip": return "lightbulb"
        case "warn": return "exclamationmark.triangle"
        default: return "info.circle"
        }
    }

    private var word: String {
        switch tone {
        case "tip": return "Tip"
        case "warn": return "Take care"
        default: return "Note"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: JK.Space.m) {
            Rectangle().fill(tone == "warn" ? JK.text : JK.silver).frame(width: JK.Size.rule)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Label(word, systemImage: glyph)
                    .font(.jkCaption.weight(.semibold))
                    .foregroundStyle(JK.text)
                InlineText(text).font(.jkCallout).foregroundStyle(JK.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(JK.Space.m)
        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct GuideImage: View {
    let block: GuideBlock
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Group {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit()
                        .accessibilityLabel(block.caption?.isEmpty == false ? block.caption! : "Picture")
                } else {
                    RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous)
                        .fill(JK.raised)
                        .frame(height: 180)
                        .overlay {
                            if failed {
                                Image(systemName: "photo").font(.jkHeadline).foregroundStyle(JK.textTertiary)
                            } else {
                                ProgressView().tint(JK.textSecondary)
                            }
                        }
                        .accessibilityHidden(true)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
            if let caption = block.caption, !caption.isEmpty {
                Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
        }
        .task(id: block.url) {
            guard image == nil, let path = block.url, path.hasPrefix("/api/") else { failed = true; return }
            if let data = try? await APIClient.shared.data(path), let ui = UIImage(data: data) { image = ui } else { failed = true }
        }
    }
}

private struct GuideVideo: View {
    let block: GuideBlock
    @State private var video: URL?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            Button { Task { await play() } } label: {
                HStack(spacing: JK.Space.m) {
                    ZStack {
                        Circle().fill(JK.primaryFill)
                        if loading { ProgressView().tint(JK.onPrimary) } else {
                            Image(systemName: "play.fill").font(.jkCallout).foregroundStyle(JK.onPrimary)
                        }
                    }
                    .frame(width: JK.Size.touch, height: JK.Size.touch)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Watch the video").font(.jkCallout).foregroundStyle(JK.text)
                        if let caption = block.caption, !caption.isEmpty {
                            Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(JK.Space.m)
                .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(loading)
            if let error { Text(error).font(.jkCaption).foregroundStyle(JK.textSecondary) }
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
        guard let path = block.url else { error = "This video isn't available."; return }
        loading = true
        defer { loading = false }
        do {
            video = try await MediaFiles.shared.file(path: path, key: "guide-" + (block.mediaId ?? path), ext: "mp4")
            error = nil
        } catch {
            self.error = "Couldn't load the video. Try again."
        }
    }
}

/// An audio block: the same player and bars as a voice note.
private struct GuideAudio: View {
    let block: GuideBlock
    let index: Int
    private var playback: VoicePlayback { VoicePlayback.shared }
    private var key: String { "guide-" + (block.mediaId ?? "\(index)") }

    var body: some View {
        let playingNow = playback.isCurrent(key) && playback.playing
        HStack(spacing: JK.Space.m) {
            Button {
                if let path = block.url { Task { await playback.toggle(key: key, path: path) } }
            } label: {
                ZStack {
                    Circle().fill(JK.primaryFill)
                    if playback.loadingKey == key { ProgressView().tint(JK.onPrimary) } else {
                        Image(systemName: playingNow ? "pause.fill" : "play.fill").font(.jkCallout).foregroundStyle(JK.onPrimary)
                    }
                }
                .frame(width: JK.Size.touch, height: JK.Size.touch)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playingNow ? "Pause" : "Play \(block.caption ?? "the recording")")
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                VoiceWaveform(levels: VoicePeaks.shared.peaks[key] ?? VoiceBars.placeholder(key), progress: playback.fraction(key),
                              height: JK.Space.xl)
                if let caption = block.caption, !caption.isEmpty {
                    Text(caption).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
        }
        .padding(JK.Space.m)
        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
    }
}

/// An https link opens outside the app; anything else is shown as text.
private struct GuideLink: View {
    let block: GuideBlock

    var body: some View {
        if let url = block.httpsURL {
            Link(destination: url) {
                HStack(spacing: JK.Space.m) {
                    Image(systemName: "link").font(.jkCallout).foregroundStyle(JK.textSecondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(block.label?.isEmpty == false ? block.label! : (url.host ?? "Open link"))
                            .font(.jkCallout).foregroundStyle(JK.text)
                            .multilineTextAlignment(.leading)
                        Text(url.host ?? "").font(.jkMeta).foregroundStyle(JK.textTertiary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                .padding(JK.Space.m)
                .frame(minHeight: JK.Size.touch)
                .overlay(RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous)
                    .strokeBorder(JK.buttonBorder, lineWidth: JK.Size.hairline))
                .contentShape(Rectangle())
            }
            .accessibilityHint("Opens in Safari")
        } else if let label = block.label {
            Text(label).font(.jkCallout).foregroundStyle(JK.textSecondary)
        }
    }
}

/// An exercise from the library: its name and how it is done.
private struct GuideExercise: View {
    let exerciseId: String
    @State private var exercise: Exercise?

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Icon(key: .workout).foregroundStyle(JK.textSecondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise?.name ?? "Exercise").font(.jkCallout).foregroundStyle(JK.text)
                if let e = exercise {
                    Text([e.equipment, e.pattern].filter { !$0.isEmpty }.joined(separator: " · ").capitalized)
                        .font(.jkMeta).foregroundStyle(JK.textTertiary)
                }
            }
            Spacer(minLength: 0)
            if let url = LinkScan.https(exercise?.videoUrl) {
                Link(destination: url) {
                    Label("Demo", systemImage: "play.rectangle").font(.jkCaption)
                }
                .buttonStyle(SmallPillStyle())
            }
        }
        .padding(JK.Space.m)
        .overlay(RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous)
            .strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
        .task(id: exerciseId) { exercise = await ExerciseLookup.shared.find(exerciseId) }
    }
}

/// The exercise library, fetched once per launch for guide blocks.
@MainActor
final class ExerciseLookup {
    static let shared = ExerciseLookup()
    private var all: [String: Exercise]?

    func find(_ id: String) async -> Exercise? {
        if all == nil, let reply: ExercisesResponse = try? await APIClient.shared.get("/api/exercises") {
            all = Dictionary(reply.exercises.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        }
        return all?[id]
    }
}
