import SwiftUI

/// One-to-one thread between a client and their coach. A client passes
/// `clientId: nil` (the server uses the caller); a coach passes the client's
/// id. Polls every 15 s while on screen.
struct MessagesThreadView: View {
    let clientId: String?
    let otherName: String
    let subtitle: String

    @Environment(AppSession.self) private var session
    @State private var messages: [Message]?
    @State private var error: String?
    @State private var draft = ""
    @State private var sending = false
    @State private var sendError: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 10) {
                        if let messages {
                            if let error { ErrorBanner(message: error) }
                            if messages.isEmpty {
                                EmptyCard(systemName: "bubble.left.and.bubble.right", title: "No messages yet",
                                          detail: "Say hello to \(otherName).")
                            }
                            ForEach(Array(messages.enumerated()), id: \.element.id) { index, m in
                                if index == 0 || !Day.same(messages[index - 1].at, m.at) {
                                    Text(dayLabel(m.at)).font(.jkCaption).foregroundStyle(JK.textTertiary).padding(.top, 8)
                                }
                                Bubble(message: m, mine: m.fromId == session.me?.id)
                                    .id(m.id)
                            }
                        } else if let error {
                            ErrorCard(message: error) { await load() }
                        } else {
                            LoadingCard()
                        }
                    }
                    .padding(16)
                }
                .onChange(of: messages?.last?.id) { _, last in
                    if let last { withAnimation { proxy.scrollTo(last, anchor: .bottom) } }
                }
            }
            if let sendError { ErrorBanner(message: sendError).padding(.horizontal, 16) }
            HStack(spacing: 10) {
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(JK.surface, in: Capsule())
                    .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
                Button {
                    Task { await send() }
                } label: {
                    Group {
                        if sending { ProgressView().tint(JK.onPrimary) } else { Image(systemName: "paperplane.fill") }
                    }
                    .foregroundStyle(JK.onPrimary)
                    .frame(width: 34, height: 34)
                    .background(JK.primaryFill, in: Circle())
                }
                .disabled(sending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(JK.bg)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Avatar(initials: Fmt.initials(otherName), size: 26)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(otherName).font(.jkCallout.weight(.semibold))
                        Text(subtitle).font(.jkMicro).foregroundStyle(JK.textTertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task {
            // Poll while visible; the task is cancelled when the view goes away.
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    private func dayLabel(_ date: Date) -> String {
        Day.same(date, Date()) ? "Today \(Fmt.time(date))" : "\(Fmt.shortDay(date)) \(Fmt.time(date))"
    }

    /// First load fetches the thread; each poll asks only for messages after
    /// the last one's instant (exclusive) and appends them.
    private func load() async {
        let last = messages?.last?.at
        do {
            let reply: MessagesResponse = try await api.get("/api/messages", query: [
                "clientId": clientId, "after": last.map { ISO.fractional.string(from: $0) },
            ])
            if let current = messages {
                let known = Set(current.map(\.id))
                let fresh = reply.messages.filter { !known.contains($0.id) }
                if !fresh.isEmpty { messages = current + fresh }
            } else {
                messages = reply.messages
            }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            let sent: Message = try await api.send("POST", "/api/messages",
                                                   body: MessageInput(text: text, clientId: clientId, workoutId: nil))
            draft = ""
            sendError = nil
            messages = (messages ?? []) + [sent]
            // The natural moment to ask: they'll want to know when the reply comes.
            await Reminders.shared.offerIfUndecided(checkIn: clientId == nil)
        } catch {
            sendError = error.readable
        }
    }
}

private struct Bubble: View {
    let message: Message
    let mine: Bool

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 50) }
            VStack(alignment: .trailing, spacing: 4) {
                if message.workoutId != nil {
                    HStack(spacing: 8) {
                        Glyph(systemName: "dumbbell", size: 28)
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Workout").font(.jkCaption.weight(.semibold))
                            Text("Plan updated · see your Plan tab").font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !message.text.isEmpty {
                    Text(message.text).font(.jkBody).frame(maxWidth: .infinity, alignment: .leading)
                }
                Text(Fmt.time(message.at)).font(.jkMicro).foregroundStyle(JK.textSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .foregroundStyle(JK.text)
            // Your own words sit raised; the other side's on surface.
            .background(mine ? JK.raised : JK.surface,
                        in: RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous))
            .frame(maxWidth: 280, alignment: mine ? .trailing : .leading)
            if !mine { Spacer(minLength: 50) }
        }
    }
}

// MARK: - Coach: thread list

struct CoachThreadsView: View {
    @State private var threads: [MessageThread]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach", title: "Messages")
                    Loadable(value: threads, error: error, retry: load) { list in
                        if list.isEmpty {
                            EmptyCard(systemName: "bubble.left", title: "No conversations yet")
                        } else {
                            VStack(spacing: 0) {
                                ForEach(list) { t in
                                    NavigationLink {
                                        MessagesThreadView(clientId: t.client.id, otherName: t.client.name, subtitle: "Client")
                                    } label: {
                                        HStack(spacing: 12) {
                                            Avatar(initials: t.client.displayInitials, size: 34)
                                            VStack(alignment: .leading, spacing: 2) {
                                                HStack {
                                                    Text(t.client.name).font(.jkCallout.weight(.semibold))
                                                    Spacer()
                                                    if let at = t.last?.at {
                                                        Text(Day.same(at, Date()) ? Fmt.time(at) : Fmt.dayMonth(at))
                                                            .font(.jkCaption).foregroundStyle(JK.textTertiary)
                                                    }
                                                }
                                                Text(t.last?.text ?? "No messages").font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(1)
                                            }
                                            if t.unread > 0 {
                                                Text("\(t.unread)")
                                                    .font(.jkMicro.weight(.bold))
                                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                                    .background(JK.text, in: Capsule())
                                                    .foregroundStyle(JK.onPrimary)
                                            }
                                        }
                                        .foregroundStyle(JK.text)
                                        .padding(12)
                                    }
                                }
                            }
                            .jkCard(padding: 2)
                        }
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .task {
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    private func load() async {
        do {
            let reply: ThreadsResponse = try await APIClient.shared.get("/api/threads")
            threads = reply.threads
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}
