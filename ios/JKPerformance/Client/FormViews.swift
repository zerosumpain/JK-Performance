import SwiftUI

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
                    Text(request.name).font(.jkDisplay).foregroundStyle(JK.text)
                    if let intro = request.intro, !intro.isEmpty {
                        Text(intro).font(.jkCallout).foregroundStyle(JK.textSecondary)
                    }
                    ForEach(Array(request.questions.enumerated()), id: \.element.id) { index, q in
                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(index + 1). \(q.label)\(q.isRequired ? "" : " (optional)")")
                                .font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                            input(for: q)
                        }
                        .jkCard(padding: 12)
                    }
                    if let error { ErrorBanner(message: error) }
                    Button {
                        Task { await submit() }
                    } label: {
                        if saving { ProgressView().tint(JK.onPrimary) } else { Text("Send to coach") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(saving || !missing.isEmpty)
                    if !missing.isEmpty {
                        Text(missing.count == 1 ? "1 question left" : "\(missing.count) questions left")
                            .font(.jkCaption).foregroundStyle(JK.textTertiary).frame(maxWidth: .infinity)
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
                            .font(.jkCallout.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .foregroundStyle(on ? JK.onPrimary : JK.text)
                            .background(on ? AnyShapeStyle(JK.primaryFill) : AnyShapeStyle(JK.raised), in: RoundedRectangle(cornerRadius: JK.Radius.chip))
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
                            Text(option).font(.jkCallout).foregroundStyle(JK.text)
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
                .font(.jkCallout).foregroundStyle(JK.text)
                .padding(10)
                .background(JK.raised, in: RoundedRectangle(cornerRadius: JK.Radius.chip, style: .continuous))
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
