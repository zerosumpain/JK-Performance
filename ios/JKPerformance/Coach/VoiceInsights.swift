import SwiftUI

/// What the server worked out from a client's voice note, shown only when it
/// sent it (a coach; the server never sends it to a client): the one-line
/// summary on an accent rule, the mood and topics, the flags as worded pills
/// with a glyph (urgent ones in the urgent tone), and the action items with
/// "Add as tasks".
struct VoiceInsights: View {
    let message: Message
    let voice: VoiceInfo

    @State private var adding = false
    @State private var added: String?

    var body: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            if let summary = voice.summary, !summary.isEmpty {
                HStack(alignment: .top, spacing: JK.Space.s) {
                    Rectangle().fill(JK.silver).frame(width: JK.Size.rule).accessibilityHidden(true)
                    Text(summary)
                        .font(.jkCallout)
                        .foregroundStyle(JK.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Summary: \(summary)")
            }
            if !(voice.flags ?? []).isEmpty { flags }
            if VoiceCopy.mood(voice.mood) != nil || !(voice.topics ?? []).isEmpty { moodAndTopics }
            if let actions = voice.actions, !actions.isEmpty { actionList(actions) }
        }
        .padding(JK.Space.m)
        .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.button, style: .continuous))
    }

    private var flags: some View {
        FlowRow(spacing: JK.Space.xs) {
            ForEach(Array((voice.flags ?? []).enumerated()), id: \.offset) { _, flag in
                let tone = flag.isUrgent ? JK.urgent : JK.attention
                HStack(spacing: JK.Space.xs) {
                    Image(systemName: Self.symbol(flag.kind)).font(.jkMicro)
                    Text(flag.label + (flag.severity == "high" ? " · high" : "")).font(.jkMicro.weight(.semibold))
                }
                .foregroundStyle(tone)
                .padding(.horizontal, JK.Space.s)
                .padding(.vertical, JK.Space.xs)
                .overlay(Capsule().strokeBorder(tone, lineWidth: JK.Size.hairline))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Flag: \(flag.label)" + (flag.quote.map { ". They said: \($0)" } ?? ""))
            }
        }
    }

    private var moodAndTopics: some View {
        FlowRow(spacing: JK.Space.xs) {
            if let mood = VoiceCopy.mood(voice.mood) {
                HStack(spacing: JK.Space.xs) {
                    Image(systemName: Self.moodSymbol(voice.mood)).font(.jkMicro)
                    Text("Mood: \(mood)").font(.jkMicro.weight(.semibold))
                }
                .foregroundStyle(JK.text)
                .padding(.horizontal, JK.Space.s)
                .padding(.vertical, JK.Space.xs)
                .background(JK.surface, in: Capsule())
            }
            ForEach(voice.topics ?? [], id: \.self) { topic in
                Text(topic)
                    .font(.jkMicro)
                    .foregroundStyle(JK.textSecondary)
                    .padding(.horizontal, JK.Space.s)
                    .padding(.vertical, JK.Space.xs)
                    .overlay(Capsule().strokeBorder(JK.hairline, lineWidth: JK.Size.hairline))
            }
        }
    }

    private func actionList(_ actions: [VoiceAction]) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xs) {
            ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                HStack(alignment: .firstTextBaseline, spacing: JK.Space.s) {
                    Image(systemName: "circle").font(.jkMicro).foregroundStyle(JK.textTertiary).accessibilityHidden(true)
                    Text(action.text).font(.jkCaption).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Text(action.owner == "client" ? "Them" : "You").font(.jkMicro).foregroundStyle(JK.textTertiary)
                }
            }
            HStack(spacing: JK.Space.s) {
                Button {
                    Task { await addTasks() }
                } label: {
                    if adding { ProgressView().controlSize(.mini) } else { Label("Add as tasks", systemImage: "checklist") }
                }
                .buttonStyle(SmallPillStyle())
                .disabled(adding || added != nil)
                if let added { Text(added).font(.jkMeta).foregroundStyle(JK.textSecondary) }
            }
            .padding(.top, JK.Space.xs)
        }
    }

    private func addTasks() async {
        adding = true
        defer { adding = false }
        do {
            let reply: VoiceTasksReply = try await APIClient.shared.send("POST", "/api/voice/\(seg(message.id))/tasks",
                                                                          body: VoiceTasksInput(indexes: nil))
            added = reply.created == 1 ? "1 task added" : "\(reply.created) tasks added"
        } catch {
            added = error.readable
        }
    }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "pain", "injury": return IconKey.pain.symbol
        case "illness": return "thermometer.medium"
        case "mentalHealth": return "cloud.rain"
        case "safeguarding": return "exclamationmark.shield"
        case "cancelIntent": return "door.left.hand.open"
        case "billing": return "sterlingsign.circle"
        default: return "flag"
        }
    }

    static func moodSymbol(_ mood: String?) -> String {
        switch mood {
        case "upbeat": return "sun.max"
        case "steady": return "equal.circle"
        case "flat": return "minus.circle"
        case "low": return "cloud"
        case "stressed": return "bolt.heart"
        default: return "circle"
        }
    }
}
