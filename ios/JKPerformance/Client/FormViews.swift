import SwiftUI

/// Forms the coach is waiting on, at the top of the client's Home screen.
/// Shows nothing when there are none.
struct ClientFormsCard: View {
    @State private var waiting: [FormRequest] = []
    @State private var open: FormRequest?
    let refresh: Int

    var body: some View {
        Group {
            if !waiting.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: waiting.count == 1 ? "A form from your coach" : "\(waiting.count) forms from your coach")
                    ForEach(waiting) { r in
                        Button { open = r } label: {
                            HStack(spacing: 12) {
                                IconTile(systemName: "doc.text", size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                    Text("\(r.questions.count) questions · about \(max(1, r.questions.count / 2)) min")
                                        .font(.caption2).foregroundStyle(JK.tertiary)
                                }
                                Spacer()
                                Text("Fill in")
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(JK.chrome, in: Capsule())
                                    .foregroundStyle(.black)
                            }
                            .jkCard(padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
        .sheet(item: $open, onDismiss: { Task { await load() } }) { r in
            FormFillView(request: r)
        }
    }

    private func load() async {
        do {
            let reply: FormRequestsResponse = try await APIClient.shared.get("/api/form-requests")
            waiting = reply.requests.filter { $0.submittedAt == nil }
        } catch {
            // The card is a nudge; Home shows its own errors.
        }
    }
}

/// Answer a form, one question per card, and send it once.
struct FormFillView: View {
    let request: FormRequest
    @Environment(\.dismiss) private var dismiss
    @State private var answers: [String: FormAnswer] = [:]
    @State private var saving = false
    @State private var error: String?

    private var missing: [FormQuestion] {
        request.questions.filter { q in
            guard q.isRequired else { return false }
            switch answers[q.id] {
            case .none: return true
            case .text(let t): return t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            default: return false
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(request.name).font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                    if let intro = request.intro, !intro.isEmpty {
                        Text(intro).font(.subheadline).foregroundStyle(JK.secondary)
                    }
                    ForEach(Array(request.questions.enumerated()), id: \.element.id) { index, q in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(index + 1). \(q.label)\(q.isRequired ? "" : " (optional)")")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                            input(for: q)
                        }
                        .jkCard(padding: 12)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await submit() }
                    } label: {
                        if saving { ProgressView().tint(.black) } else { Text("Send to coach") }
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(saving || !missing.isEmpty)
                    if !missing.isEmpty {
                        Text(missing.count == 1 ? "1 question left" : "\(missing.count) questions left")
                            .font(.caption2).foregroundStyle(JK.tertiary).frame(maxWidth: .infinity)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Later") { dismiss() } } }
        }
    }

    @ViewBuilder
    private func input(for q: FormQuestion) -> some View {
        switch q.kind {
        case "scale":
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { n in
                    let on = answers[q.id] == .number(n)
                    Button { answers[q.id] = .number(n) } label: {
                        Text("\(n)")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .foregroundStyle(on ? Color.black : JK.text)
                            .background(on ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.cardRaised), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
        case "yesno":
            HStack(spacing: 8) {
                ForEach([true, false], id: \.self) { value in
                    Chip(label: value ? "Yes" : "No", selected: answers[q.id] == .yes(value)) { answers[q.id] = .yes(value) }
                }
            }
        case "choice":
            VStack(spacing: 0) {
                ForEach(q.options ?? [], id: \.self) { option in
                    Button { answers[q.id] = .text(option) } label: {
                        HStack {
                            Text(option).font(.subheadline).foregroundStyle(JK.text)
                            Spacer()
                            CheckCircle(on: answers[q.id] == .text(option))
                        }
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        default:
            TextField("Your answer", text: textBinding(q.id), axis: .vertical)
                .lineLimit(q.kind == "long" ? 3...8 : 1...2)
                .font(.subheadline).foregroundStyle(JK.text)
                .padding(10)
                .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private func textBinding(_ id: String) -> Binding<String> {
        Binding(
            get: { if case .text(let t) = answers[id] { return t } else { return "" } },
            set: { answers[id] = $0.isEmpty ? nil : .text($0) }
        )
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        do {
            var clean = answers
            for (key, value) in answers {
                if case .text(let t) = value { clean[key] = .text(t.trimmingCharacters(in: .whitespacesAndNewlines)) }
            }
            let _: FormRequest = try await APIClient.shared.send("POST", "/api/form-requests/\(seg(request.id))/answers",
                                                                 body: FormAnswersInput(answers: clean))
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}
