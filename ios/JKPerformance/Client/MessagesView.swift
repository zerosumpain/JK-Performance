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
                                    Text(dayLabel(m.at)).font(.jkCaption).foregroundStyle(JK.textSecondary).padding(.top, 8)
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
                .accessibilityLabel("Send")
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
                        Text(subtitle).font(.jkCaption).foregroundStyle(JK.textSecondary)
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

    /// What a non-text message is, in a word or two.
    private var tag: (key: IconKey, text: String)? {
        switch message.kind {
        case "formCheck"?: return (.formCheck, "Form check")
        case "mealPhoto"?: return (.mealPhoto, "Meal photo")
        case "answer"?: return (.reply, mine ? "Your answer to the letter" : "Answered your letter")
        case "letter"?: return (.letter, "Letter delivered")
        default:
            if message.workoutId != nil { return (.workout, "Plan updated") }
            return nil
        }
    }

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 50) }
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                if let tag {
                    HStack(spacing: JK.Space.xs) {
                        Icon(key: tag.key, size: 13).foregroundStyle(JK.textSecondary)
                        Text(tag.text).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                }
                if !message.text.isEmpty {
                    Text(message.text).font(.jkBody).foregroundStyle(JK.text)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if message.mediaId != nil {
                    Text(message.kind == "formCheck" ? "Video attached · open it on the web desk" : "Photo attached")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                Text(Fmt.time(message.at)).font(.jkCaption).foregroundStyle(JK.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(JK.Space.m)
            // Your own words sit raised; the other side's on surface.
            .background(mine ? JK.raised : JK.surface,
                        in: RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous))
            .frame(maxWidth: 300, alignment: mine ? .trailing : .leading)
            .accessibilityElement(children: .combine)
            if !mine { Spacer(minLength: 50) }
        }
    }
}

// MARK: - Coach: thread list

/// The coach's conversations, newest first. Threads from clients on a plan
/// with 'priority' carry the word "Priority".
struct CoachThreadsView: View {
    @State private var threads: [MessageThread]?
    @State private var priority: Set<String> = []
    @State private var plans: [String: String] = [:]
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.l) {
                    Text("Messages").jkText(.display).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                    Loadable(value: threads, error: error, retry: load) { list in
                        if list.isEmpty {
                            EmptyState(line: "No conversations yet.")
                        } else {
                            VStack(spacing: 0) {
                                ForEach(list) { t in
                                    NavigationLink {
                                        MessagesThreadView(clientId: t.client.id, otherName: t.client.name,
                                                           subtitle: priority.contains(t.client.id) ? "Priority · same-day reply" : Fmt.planName(plans[t.client.id]))
                                    } label: { row(t) }
                                    .buttonStyle(.plain)
                                    if t.id != list.last?.id { GroupDivider(inset: JK.Space.l + JK.Size.avatar + JK.Space.m) }
                                }
                            }
                            .surface(.group)
                        }
                    }
                }
                .padding(.horizontal, JK.Space.gutter)
                .padding(.vertical, JK.Space.l)
            }
            .jkScreen()
            .jkRefreshable { await load() }
            .toolbar(.hidden, for: .navigationBar)
            .task { await loadPlans() }
            .task {
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    private func row(_ t: MessageThread) -> some View {
        HStack(spacing: JK.Space.m) {
            Avatar(initials: t.client.displayInitials)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: JK.Space.s) {
                    Text(t.client.name).font(.jkCallout).foregroundStyle(JK.text)
                    if priority.contains(t.client.id) {
                        Text("Priority").font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                    Spacer(minLength: 0)
                    if let at = t.last?.at {
                        Text(Day.same(at, Date()) ? Fmt.time(at) : Fmt.dayMonth(at))
                            .font(.jkCaption).foregroundStyle(JK.textSecondary)
                    }
                }
                Text(preview(t)).font(.jkCaption).foregroundStyle(JK.textSecondary).lineLimit(1)
            }
            if t.unread > 0 {
                Text("\(t.unread)")
                    .font(.jkCaption.monospacedDigit())
                    .padding(.horizontal, JK.Space.s).padding(.vertical, 2)
                    .background(JK.primaryFill, in: Capsule())
                    .foregroundStyle(JK.onPrimary)
                    .accessibilityLabel("\(t.unread) unread")
            }
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.m)
        .contentShape(Rectangle())
    }

    private func preview(_ t: MessageThread) -> String {
        guard let last = t.last else { return "No messages" }
        switch last.kind {
        case "formCheck"?: return "Form check" + (last.text.isEmpty ? "" : " · \(last.text)")
        case "mealPhoto"?: return "Meal photo" + (last.text.isEmpty ? "" : " · \(last.text)")
        case "answer"?: return "Answered your letter · \(last.text)"
        default: return last.text
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

    /// Which clients are on a plan that includes 'priority'.
    private func loadPlans() async {
        guard let catalogue: PlansResponse = try? await APIClient.shared.get("/api/plans"),
              let clients: ClientsResponse = try? await APIClient.shared.get("/api/coach/clients") else { return }
        let priorityPlans = Set(catalogue.plans.filter { $0.featureIds.contains("priority") }.map(\.id))
        priority = Set(clients.clients.filter { priorityPlans.contains($0.plan ?? "") }.map(\.id))
        plans = Dictionary(clients.clients.map { ($0.id, $0.plan ?? "none") }, uniquingKeysWith: { first, _ in first })
    }
}
