import SwiftUI

/// One-to-one thread between a client and Coach JK. Both apps use it, each
/// seeing the other person; messages are local until a backend exists.
struct MessagesView: View {
    let otherName: String
    let otherInitials: String
    let subtitle: String

    @AppStorage("jk.role") private var role: AppRole = .client
    @State private var messages = Mock.thread
    @State private var draft = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 10) {
                        Text("Today 08:12").font(.caption2).foregroundStyle(JK.tertiary).padding(.top, 8)
                        ForEach(messages) { m in
                            Bubble(message: m, mine: (m.fromCoach) == (role == .coach))
                        }
                    }
                    .padding(16)
                }
                HStack(spacing: 10) {
                    Image(systemName: "plus").foregroundStyle(JK.secondary)
                    TextField("Message", text: $draft)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(JK.card, in: Capsule())
                        .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
                    Button {
                        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        messages.append(ChatMessage(text: text, time: "now", fromCoach: role == .coach))
                        draft = ""
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .foregroundStyle(.black)
                            .frame(width: 34, height: 34)
                            .background(JK.chrome, in: Circle())
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(JK.bg)
            }
            .jkScreen()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        Avatar(initials: otherInitials, size: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(otherName).font(.subheadline.weight(.semibold))
                            Text(subtitle).font(.system(size: 10)).foregroundStyle(JK.tertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct Bubble: View {
    let message: ChatMessage
    let mine: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 50) }
            VStack(alignment: .trailing, spacing: 4) {
                if let attachment = message.attachment {
                    HStack(spacing: 8) {
                        IconTile(systemName: "dumbbell", size: 28)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(attachment).font(.caption.weight(.semibold))
                            Text("Plan updated · tap to view").font(.system(size: 10)).foregroundStyle(JK.tertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(message.text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
                }
                Text(message.time).font(.system(size: 9)).foregroundStyle(mine ? Color.black.opacity(0.5) : JK.tertiary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .foregroundStyle(mine ? Color.black : JK.text)
            .background(mine ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.card),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(mine ? Color.clear : JK.stroke, lineWidth: 1))
            .frame(maxWidth: 280, alignment: mine ? .trailing : .leading)
            if !mine { Spacer(minLength: 50) }
        }
    }
}
