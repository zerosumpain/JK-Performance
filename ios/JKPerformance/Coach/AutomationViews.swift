import SwiftUI

// MARK: - Autoflows (Programs › Autoflows)

/// The coach's autoflows: each a list of "on day N, do X" steps that run by
/// themselves, for every new client (`join`) or for clients enrolled by hand.
struct AutoflowsTab: View {
    @State private var flows: [Autoflow]?
    @State private var error: String?
    @State private var editing: AutoflowDraft?
    @State private var enrolling: Autoflow?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { editing = AutoflowDraft() } label: { Label("New autoflow", systemImage: "plus") }
                .buttonStyle(SecondaryButtonStyle())
            Loadable(value: flows, error: error, retry: load) { list in
                if list.isEmpty {
                    EmptyCard(systemName: "bolt", title: "No autoflows yet",
                              detail: "Write your routine once: a welcome message on day 0, the intake form, a check-in on day 7. It then runs for every client.")
                }
                ForEach(list) { flow in
                    AutoflowCard(flow: flow, onEdit: { editing = AutoflowDraft(flow) }, onEnrol: { enrolling = flow }, onChanged: load)
                }
            }
        }
        .task { await load() }
        .sheet(item: $editing) { draft in
            AutoflowEditorSheet(draft: draft) { await load() }
        }
        .sheet(item: $enrolling) { flow in
            ClientPickerSheet(title: "Start \(flow.name)", action: "Start",
                              note: "Steps already due (day 0) happen straight away.") { client in
                let _: AutoflowRun = try await APIClient.shared.send("POST", "/api/autoflows/\(seg(flow.id))/enrol",
                                                                     body: EnrolInput(clientId: client.id))
                await load()
            }
        }
    }

    private func load() async {
        do {
            let reply: AutoflowsResponse = try await APIClient.shared.get("/api/autoflows")
            flows = reply.autoflows
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

private struct AutoflowCard: View {
    let flow: Autoflow
    let onEdit: () -> Void
    let onEnrol: () -> Void
    let onChanged: () async -> Void
    @State private var showRuns = false

    private var running: [AutoflowRun] { (flow.runs ?? []).filter { $0.stoppedAt == nil && $0.next != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Glyph(systemName: flow.trigger == "join" ? "person.badge.plus" : "bolt", size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(flow.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    Text(flow.trigger == "join" ? "Starts when a client joins" : "Starts when you enrol someone")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                Spacer()
                if !flow.active {
                    Text("Paused").font(.jkMicro.weight(.semibold))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
                        .foregroundStyle(JK.textSecondary)
                }
                Menu {
                    Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
                    Button { onEnrol() } label: { Label("Start for a client", systemImage: "person.badge.plus") }
                } label: {
                    Image(systemName: "ellipsis").frame(width: 30, height: 30).foregroundStyle(JK.textSecondary)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(flow.steps) { step in
                    HStack(spacing: 8) {
                        Text("Day \(step.day)")
                            .font(.jkMicro.weight(.semibold))
                            .frame(width: 46, alignment: .leading)
                            .foregroundStyle(JK.textSecondary)
                        Image(systemName: step.icon).font(.jkCaption).foregroundStyle(JK.textTertiary).frame(width: 14)
                        Text(step.label ?? step.action.capitalized).font(.jkCaption).foregroundStyle(JK.text).lineLimit(1)
                    }
                }
            }
            if let runs = flow.runs, !runs.isEmpty {
                Button { withAnimation { showRuns.toggle() } } label: {
                    HStack {
                        Text(running.isEmpty ? "\(runs.count) finished" : "\(running.count) in progress")
                        Spacer()
                        Image(systemName: showRuns ? "chevron.up" : "chevron.down")
                    }
                    .font(.jkCaption.weight(.semibold))
                    .foregroundStyle(JK.textSecondary)
                }
                .buttonStyle(.plain)
                if showRuns {
                    ForEach(runs) { run in AutoflowRunRow(run: run, onChanged: onChanged) }
                }
            }
        }
        .jkCard()
    }
}

/// One client's way through a flow: how far, and what happens next.
struct AutoflowRunRow: View {
    let run: AutoflowRun
    var showFlowName = false
    let onChanged: () async -> Void
    @State private var confirmStop = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Avatar(initials: run.client?.displayInitials ?? "?", size: 26)
                VStack(alignment: .leading, spacing: 1) {
                    Text(showFlowName ? (run.autoflowName ?? "Autoflow") : (run.client?.name ?? "Client"))
                        .font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textTertiary).lineLimit(2)
                }
                Spacer()
                Text("\(run.stepsDone)/\(run.steps)").font(.jkCaption.monospacedDigit()).foregroundStyle(JK.textSecondary)
                if run.stoppedAt == nil && run.next != nil {
                    Button { confirmStop = true } label: { Image(systemName: "stop.circle") }
                        .buttonStyle(.plain).foregroundStyle(JK.textSecondary)
                        .accessibilityLabel("Stop")
                }
            }
            ThinBar(fraction: run.steps == 0 ? 0 : Double(run.stepsDone) / Double(run.steps), height: 2)
            if let error { ErrorBanner(message: error) }
        }
        .padding(8)
        .background(JK.raised.opacity(0.5), in: RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous))
        .confirmationDialog("Stop this autoflow for \(run.client?.name ?? "them")?", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("Stop", role: .destructive) { Task { await stop() } }
        } message: {
            Text("What already happened stays; nothing more is sent.")
        }
    }

    private var detail: String {
        if run.stoppedAt != nil { return "Stopped" }
        guard let next = run.next else { return "Finished" }
        let when = Day.date(next.date).map { Day.same($0, Date()) ? "today" : Fmt.dayMonth($0) } ?? next.date
        return "Next \(when): \(next.label)"
    }

    private func stop() async {
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/autoflows/\(seg(run.autoflowId))/runs/\(seg(run.id))")
            await onChanged()
        } catch {
            self.error = error.readable
        }
    }
}

struct AutoflowDraft: Identifiable {
    let id = UUID()
    var flowId: String?
    var name = ""
    var trigger = "join"
    var active = true
    var steps: [AutoflowStep] = [AutoflowStep(id: UUID().uuidString, day: 0, action: "message", text: "Welcome aboard, {first}!")]

    init() {}

    init(_ f: Autoflow) {
        flowId = f.id
        name = f.name
        trigger = f.trigger
        active = f.active
        steps = f.steps
    }

    var input: AutoflowInput {
        AutoflowInput(name: name, trigger: trigger, active: active, steps: steps.sorted { $0.day < $1.day })
    }
}

struct AutoflowEditorSheet: View {
    @State var draft: AutoflowDraft
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var forms: [CoachForm] = []
    @State private var programs: [Program] = []
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    JKField(label: "Name", text: $draft.name, prompt: "New client onboarding")
                    Segmented(options: ["join", "manual"], selection: $draft.trigger) { $0 == "join" ? "When a client joins" : "When I start it" }
                    Toggle("Running", isOn: $draft.active).font(.jkCallout).foregroundStyle(JK.text).tint(JK.accentControl)

                    Eyebrow(text: "Steps", trailing: "Day 0 = the day it starts")
                    ForEach($draft.steps) { $step in
                        StepEditor(step: $step, forms: forms, programs: programs) {
                            draft.steps.removeAll { $0.id == step.id }
                        }
                    }
                    HStack(spacing: 8) {
                        addButton("Message", "bubble.left", action: "message")
                        addButton("Form", "doc.text", action: "form")
                        addButton("Program", "dumbbell", action: "program")
                    }
                    Text("Messages can say {first} for the client's first name. A program goes live on their calendar from the following Monday.")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)

                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(draft.flowId == nil ? "Create autoflow" : "Save autoflow") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.steps.isEmpty)
                    if draft.flowId != nil {
                        Button("Delete autoflow", role: .destructive) { confirmDelete = true }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle(draft.flowId == nil ? "New autoflow" : "Edit autoflow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .confirmationDialog("Delete this autoflow?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Clients part-way through stop where they are. Nothing already sent is taken back.")
            }
            .task { await loadChoices() }
        }
    }

    private func addButton(_ title: String, _ icon: String, action: String) -> some View {
        Button {
            let day = (draft.steps.map(\.day).max() ?? -1) + 1
            var step = AutoflowStep(id: UUID().uuidString, day: max(0, day), action: action)
            if action == "form" { step.formId = forms.first?.id }
            if action == "program" { step.programId = programs.first?.id }
            if action == "message" { step.text = "" }
            draft.steps.append(step)
        } label: { Label(title, systemImage: icon) }
            .buttonStyle(SmallPillStyle())
    }

    private func loadChoices() async {
        do {
            let f: FormsResponse = try await APIClient.shared.get("/api/forms")
            let p: ProgramsResponse = try await APIClient.shared.get("/api/programs")
            forms = f.forms
            programs = p.programs
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let id = draft.flowId {
                let _: Autoflow = try await APIClient.shared.send("PUT", "/api/autoflows/\(seg(id))", body: draft.input)
            } else {
                let _: Autoflow = try await APIClient.shared.send("POST", "/api/autoflows", body: draft.input)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }

    private func delete() async {
        guard let id = draft.flowId else { return }
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/autoflows/\(seg(id))")
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

private struct StepEditor: View {
    @Binding var step: AutoflowStep
    let forms: [CoachForm]
    let programs: [Program]
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: step.icon).foregroundStyle(JK.textSecondary)
                Stepper("Day \(step.day)", value: $step.day, in: 0...365)
                    .font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Button(role: .destructive) { onRemove() } label: { Image(systemName: "trash") }
                    .buttonStyle(.plain).foregroundStyle(JK.textSecondary)
            }
            switch step.action {
            case "message":
                TextField("Message", text: Binding(get: { step.text ?? "" }, set: { step.text = $0 }), axis: .vertical)
                    .lineLimit(2...6)
                    .font(.jkCallout).foregroundStyle(JK.text)
                    .padding(10)
                    .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
            case "form":
                if forms.isEmpty {
                    Text("Make a form first (Forms tab).").font(.jkCaption).foregroundStyle(JK.textTertiary)
                } else {
                    Picker("Form", selection: Binding(get: { step.formId ?? "" }, set: { step.formId = $0 })) {
                        ForEach(forms) { Text($0.name).tag($0.id) }
                    }
                    .tint(JK.text)
                }
            default:
                if programs.isEmpty {
                    Text("Make a program first (Programs tab).").font(.jkCaption).foregroundStyle(JK.textTertiary)
                } else {
                    Picker("Program", selection: Binding(get: { step.programId ?? "" }, set: { step.programId = $0 })) {
                        ForEach(programs) { Text($0.name).tag($0.id) }
                    }
                    .tint(JK.text)
                }
            }
        }
        .jkCard(padding: 12)
    }
}

// MARK: - Forms (Programs › Forms)

struct FormsTab: View {
    @State private var data: FormsResponse?
    @State private var error: String?
    @State private var editing: FormDraft?
    @State private var sending: CoachForm?
    @State private var inbox: [FormRequest] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Menu {
                Button { editing = FormDraft() } label: { Label("Blank form", systemImage: "doc") }
                ForEach(data?.templates ?? [], id: \.name) { t in
                    Button { editing = FormDraft(template: t) } label: { Label(t.name, systemImage: "doc.on.doc") }
                }
            } label: {
                Label("New form", systemImage: "plus")
                    .font(.jkCallout.weight(.semibold))
                    .foregroundStyle(JK.text)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: JK.Radius.card, style: .continuous).stroke(JK.hairline, lineWidth: 1))
            }
            if !inbox.isEmpty {
                Eyebrow(text: "Answers to read", trailing: "\(inbox.count)")
                VStack(spacing: 0) {
                    ForEach(inbox) { r in
                        NavigationLink { FormResponseView(request: r) } label: { FormRequestRow(request: r, showClient: true) }
                    }
                }
                .jkCard(padding: 2)
            }
            Loadable(value: data, error: error, retry: load) { reply in
                Eyebrow(text: "Your forms")
                if reply.forms.isEmpty {
                    EmptyCard(systemName: "doc.text", title: "No forms yet",
                              detail: "Start from Intake or PAR-Q above, or build your own.")
                }
                ForEach(reply.forms) { f in
                    HStack(spacing: 12) {
                        Glyph(systemName: "doc.text", size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                            Text(formLine(f)).font(.jkCaption).foregroundStyle(JK.textTertiary)
                        }
                        Spacer()
                        Menu {
                            Button { sending = f } label: { Label("Send to a client", systemImage: "paperplane") }
                            Button { editing = FormDraft(f) } label: { Label("Edit", systemImage: "pencil") }
                        } label: {
                            Image(systemName: "ellipsis").frame(width: 30, height: 30).foregroundStyle(JK.textSecondary)
                        }
                    }
                    .jkCard(padding: 12)
                    .contentShape(Rectangle())
                    .onTapGesture { editing = FormDraft(f) }
                }
            }
        }
        .task { await load() }
        .sheet(item: $editing) { draft in
            FormEditorSheet(draft: draft) { await load() }
        }
        .sheet(item: $sending) { form in
            ClientPickerSheet(title: "Send \(form.name)", action: "Send", note: "They get a notification and find it on their Home screen.") { client in
                let _: FormRequest = try await APIClient.shared.send("POST", "/api/forms/\(seg(form.id))/send", body: ClientIdInput(clientId: client.id))
                await load()
            }
        }
    }

    private func formLine(_ f: CoachForm) -> String {
        var parts = ["\(f.questions.count) questions"]
        if let sent = f.sent, sent > 0 { parts.append("sent \(sent)×") }
        if let waiting = f.waiting, waiting > 0 { parts.append("\(waiting) not answered") }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            data = try await APIClient.shared.get("/api/forms")
            let reply: FormRequestsResponse = try await APIClient.shared.get("/api/form-requests")
            inbox = reply.requests
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

struct FormRequestRow: View {
    let request: FormRequest
    var showClient = false

    var body: some View {
        HStack(spacing: 12) {
            if showClient {
                Avatar(initials: request.client?.displayInitials ?? "?", size: 30)
            } else {
                Glyph(systemName: "doc.text", size: 30)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(showClient ? "\(request.client?.name ?? "Client") · \(request.name)" : request.name)
                    .font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text).lineLimit(1)
                Text(status).font(.jkCaption).foregroundStyle(request.isFlagged && request.reviewedAt == nil ? JK.urgent : JK.textTertiary)
            }
            Spacer()
            if request.submittedAt != nil && request.reviewedAt == nil {
                Dot(color: request.isFlagged ? JK.urgent : JK.attention)
            }
            Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        .padding(10)
    }

    private var status: String {
        if let at = request.submittedAt {
            let flagged = request.isFlagged ? "Said yes to \(request.flagged?.count == 1 ? "a health question" : "health questions") · " : ""
            return "\(flagged)Answered \(Fmt.relative(at))\(request.reviewedAt == nil ? "" : " · read")"
        }
        return "Sent \(Fmt.relative(request.sentAt)) · not answered yet"
    }
}

/// A client's answers, for the coach. Opening it marks it read.
struct FormResponseView: View {
    @State var request: FormRequest
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    @State private var confirmWithdraw = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(request.name).font(.jkDisplay).foregroundStyle(JK.text)
                    Text("\(request.client?.name ?? "Client") · sent \(Fmt.dayMonth(request.sentAt))\(request.fromAutoflow == true ? " by an autoflow" : "")")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                if let error { ErrorBanner(message: error) }
                if request.isFlagged {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Answered yes to", systemImage: "exclamationmark.triangle.fill")
                            .font(.jkCaption.weight(.semibold)).foregroundStyle(JK.urgent)
                        ForEach(request.flagged ?? [], id: \.self) { Text("• \($0)").font(.jkCaption).foregroundStyle(JK.text) }
                        Text("Talk to them before the next hard session.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                    .jkCard()
                    .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.urgent.opacity(0.6), lineWidth: 1))
                }
                if request.submittedAt == nil {
                    EmptyCard(systemName: "hourglass", title: "Not answered yet", detail: "Sent \(Fmt.relative(request.sentAt)).")
                    Button("Withdraw form", role: .destructive) { confirmWithdraw = true }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    ForEach(request.questions) { q in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(q.label).font(.jkCaption).foregroundStyle(JK.textTertiary)
                            let answer = request.answers?[q.id]
                            Text(answer?.display ?? "–")
                                .font(.jkCallout.weight(.medium))
                                .foregroundStyle(q.flag == true && answer == .yes(true) ? JK.urgent : JK.text)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .jkCard(padding: 12)
                    }
                    if let client = request.client {
                        NavigationLink {
                            MessagesThreadView(clientId: client.id, otherName: client.name, subtitle: "Client")
                        } label: { Label("Message \(client.name.split(separator: " ").first.map(String.init) ?? client.name)", systemImage: "bubble.left") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .task { await markRead() }
        .confirmationDialog("Withdraw this form?", isPresented: $confirmWithdraw, titleVisibility: .visible) {
            Button("Withdraw", role: .destructive) { Task { await withdraw() } }
        }
    }

    private func markRead() async {
        guard request.submittedAt != nil, request.reviewedAt == nil else { return }
        do {
            request = try await APIClient.shared.send("POST", "/api/form-requests/\(seg(request.id))/review")
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func withdraw() async {
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/form-requests/\(seg(request.id))")
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

struct FormDraft: Identifiable {
    let id = UUID()
    var formId: String?
    var name = ""
    var intro = ""
    var questions: [FormQuestion] = [FormQuestion(id: "q1", kind: "long", label: "")]

    init() {}

    init(template: FormTemplate) {
        name = template.name
        intro = template.intro ?? ""
        questions = template.questions
    }

    init(_ f: CoachForm) {
        formId = f.id
        name = f.name
        intro = f.intro ?? ""
        questions = f.questions
    }

    var input: FormInput { FormInput(name: name, intro: intro, questions: questions) }

    /// An id no other question in this form has.
    func nextId() -> String {
        var n = questions.count + 1
        while questions.contains(where: { $0.id == "q\(n)" }) { n += 1 }
        return "q\(n)"
    }
}

struct FormEditorSheet: View {
    @State var draft: FormDraft
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    JKField(label: "Name", text: $draft.name, prompt: "Intake")
                    JKField(label: "Intro (shown at the top)", text: $draft.intro, prompt: "A few questions before we start")
                    Eyebrow(text: "Questions", trailing: "\(draft.questions.count)")
                    ForEach(Array(draft.questions.enumerated()), id: \.element.id) { index, _ in
                        QuestionEditor(question: $draft.questions[index], number: index + 1,
                                       onMove: { move(index, by: $0) },
                                       onRemove: { draft.questions.remove(at: index) })
                    }
                    Menu {
                        ForEach(FormQuestion.kinds, id: \.0) { kind in
                            Button(kind.1) {
                                draft.questions.append(FormQuestion(id: draft.nextId(), kind: kind.0, label: "",
                                                                    options: kind.0 == "choice" ? ["Option 1", "Option 2"] : nil))
                            }
                        }
                    } label: {
                        Label("Add question", systemImage: "plus").font(.jkCaption.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .overlay(Capsule().stroke(JK.hairline, lineWidth: 1))
                            .foregroundStyle(JK.text)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await save() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(draft.formId == nil ? "Create form" : "Save form") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.questions.isEmpty)
                    if draft.formId != nil {
                        Text("Forms already sent keep the questions they were sent with.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        Button("Delete form", role: .destructive) { confirmDelete = true }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle(draft.formId == nil ? "New form" : "Edit form")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .confirmationDialog("Delete this form?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await delete() } }
            } message: {
                Text("Answers clients already gave stay on their record.")
            }
        }
    }

    private func move(_ index: Int, by offset: Int) {
        let target = index + offset
        guard draft.questions.indices.contains(target) else { return }
        draft.questions.swapAt(index, target)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let id = draft.formId {
                let _: CoachForm = try await APIClient.shared.send("PUT", "/api/forms/\(seg(id))", body: draft.input)
            } else {
                let _: CoachForm = try await APIClient.shared.send("POST", "/api/forms", body: draft.input)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }

    private func delete() async {
        guard let id = draft.formId else { return }
        do {
            let _: OK = try await APIClient.shared.send("DELETE", "/api/forms/\(seg(id))")
            await onSaved()
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

private struct QuestionEditor: View {
    @Binding var question: FormQuestion
    let number: Int
    let onMove: (Int) -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("\(number). \(FormQuestion.kindName(question.kind))").font(.jkCaption.weight(.semibold)).foregroundStyle(JK.textSecondary)
                Spacer()
                Button { onMove(-1) } label: { Image(systemName: "arrow.up") }
                Button { onMove(1) } label: { Image(systemName: "arrow.down") }
                Button(role: .destructive) { onRemove() } label: { Image(systemName: "trash") }
            }
            .font(.jkCaption)
            .buttonStyle(.plain)
            .foregroundStyle(JK.textSecondary)
            JKField(label: "Question", text: $question.label, prompt: "What do you want to achieve?")
            if question.kind == "choice" {
                JKField(label: "Choices, separated by commas",
                        text: Binding(get: { (question.options ?? []).joined(separator: ", ") },
                                      set: { question.options = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }),
                        prompt: "Yes, No, Not sure")
            }
            HStack(spacing: 16) {
                Toggle("Required", isOn: Binding(get: { question.isRequired }, set: { question.required = $0 ? nil : false }))
                if question.kind == "yesno" {
                    Toggle("Flag a yes", isOn: Binding(get: { question.flag == true }, set: { question.flag = $0 ? true : nil }))
                }
            }
            .font(.jkCaption)
            .foregroundStyle(JK.text)
            .tint(JK.accentControl)
        }
        .jkCard(padding: 12)
    }
}

// MARK: - On a client's page (Feedback tab)

/// Forms sent to this client and the autoflows they're in, with buttons to send or start one.
struct ClientAutomationSection: View {
    let client: PersonRef
    @State private var requests: [FormRequest]?
    @State private var runs: [AutoflowRun] = []
    @State private var forms: [CoachForm] = []
    @State private var flows: [Autoflow] = []
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Eyebrow(text: "Forms")
                Menu {
                    ForEach(forms) { f in Button(f.name) { Task { await send(f) } } }
                } label: { Label("Send", systemImage: "paperplane").font(.jkCaption.weight(.semibold)) }
                    .foregroundStyle(JK.text)
                    .disabled(forms.isEmpty)
            }
            if let error { ErrorBanner(message: error) }
            if let requests {
                if requests.isEmpty {
                    Text("No forms sent yet.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                } else {
                    VStack(spacing: 0) {
                        ForEach(requests) { r in
                            NavigationLink { FormResponseView(request: r) } label: { FormRequestRow(request: r) }
                        }
                    }
                    .jkCard(padding: 2)
                }
            } else {
                LoadingCard()
            }
            HStack {
                Eyebrow(text: "Autoflows")
                Menu {
                    ForEach(flows.filter { f in !runs.contains { $0.autoflowId == f.id && $0.stoppedAt == nil } }) { f in
                        Button(f.name) { Task { await enrol(f) } }
                    }
                } label: { Label("Start", systemImage: "bolt").font(.jkCaption.weight(.semibold)) }
                    .foregroundStyle(JK.text)
                    .disabled(flows.isEmpty)
            }
            if runs.isEmpty {
                Text("Not in any autoflow.").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            ForEach(runs) { run in
                AutoflowRunRow(run: run, showFlowName: true, onChanged: load)
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            let r: FormRequestsResponse = try await APIClient.shared.get("/api/form-requests", query: ["clientId": client.id])
            let a: AutoflowRunsResponse = try await APIClient.shared.get("/api/coach/clients/\(seg(client.id))/autoflows")
            let f: FormsResponse = try await APIClient.shared.get("/api/forms")
            let flowsReply: AutoflowsResponse = try await APIClient.shared.get("/api/autoflows")
            requests = r.requests
            runs = a.runs
            forms = f.forms
            flows = flowsReply.autoflows
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func send(_ form: CoachForm) async {
        do {
            let _: FormRequest = try await APIClient.shared.send("POST", "/api/forms/\(seg(form.id))/send", body: ClientIdInput(clientId: client.id))
            await load()
        } catch {
            self.error = error.readable
        }
    }

    private func enrol(_ flow: Autoflow) async {
        do {
            let _: AutoflowRun = try await APIClient.shared.send("POST", "/api/autoflows/\(seg(flow.id))/enrol", body: EnrolInput(clientId: client.id))
            await load()
        } catch {
            self.error = error.readable
        }
    }
}

// MARK: - Shared: pick a client

struct ClientPickerSheet: View {
    let title: String
    let action: String
    var note: String? = nil
    let perform: (PersonRef) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var clients: [ClientSummary]?
    @State private var chosen: String?
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let note { Text(note).font(.jkCaption).foregroundStyle(JK.textTertiary) }
                    if let clients {
                        VStack(spacing: 0) {
                            ForEach(clients.sorted { $0.name < $1.name }) { c in
                                Button { chosen = c.id } label: {
                                    HStack(spacing: 10) {
                                        Avatar(initials: c.displayInitials, size: 28)
                                        Text(c.name).font(.jkCallout).foregroundStyle(JK.text)
                                        Spacer()
                                        CheckCircle(on: chosen == c.id)
                                    }
                                    .padding(10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .jkCard(padding: 2)
                    } else {
                        LoadingCard()
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await go() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text(action) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || chosen == nil)
                }
                .padding(16)
            }
            .jkScreen()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task {
                do {
                    let reply: ClientsResponse = try await APIClient.shared.get("/api/coach/clients")
                    clients = reply.clients
                } catch {
                    if !error.isCancellation { self.error = error.readable }
                }
            }
        }
    }

    private func go() async {
        guard let id = chosen, let c = clients?.first(where: { $0.id == id }) else { return }
        saving = true
        defer { saving = false }
        do {
            try await perform(PersonRef(id: c.id, name: c.name, initials: c.initials))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}
