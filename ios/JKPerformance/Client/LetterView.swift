import SwiftUI

/// A letter from JK (atelier-spec.md, Client screens 8), weekly or milestone,
/// in one full-screen reading view on paper: his portrait and the date, the
/// serif headline, the week's dots and three numbers, one thing to keep and
/// one to adjust, his voice or video note, one question to answer inline,
/// his monogram, and "Reply to JK". Opening it sends the read receipt.
struct LetterView: View {
    let reportId: String

    @Environment(AppSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var report: Report?
    @State private var error: String?
    @State private var shown = false
    @State private var answer = ""
    @State private var answering = false
    @State private var answerError: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        ScrollView {
            Loadable(value: report, error: error, retry: load) { r in
                letter(r)
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown ? 0 : JK.Space.s)
                    .onAppear {
                        withAnimation(JK.Motion.respecting(reduceMotion, JK.Motion.letterOpen)) { shown = true }
                    }
            }
            .padding(JK.Space.gutter)
        }
        .background(JK.paper.ignoresSafeArea())
        .toolbarBackground(JK.paper, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func letter(_ r: Report) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.xxl) {
            HStack(spacing: JK.Space.m) {
                CoachAvatar(coach: session.me?.coach, size: JK.Size.avatar)
                Text(LetterText.caption(r)).font(.jkCaption).foregroundStyle(JK.textSecondary)
            }
            Text(r.displayHeadline)
                .jkText(.letterHeadline)
                .foregroundStyle(JK.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            rule
            if let dots = r.weekDots, dots.count == 7 {
                WeekDots(days: dots.map { WeekDots.Entry(day: $0.date, done: $0.done == true, rest: $0.rest == true,
                                                         future: $0.future == true, isToday: false) })
            }
            if let trio = r.scoreTrio, !trio.isEmpty { ScoreTrio(scores: trio) }
            oldSummary(r)
            block("Keep", r.keepText)
            block("Adjust", r.adjustText)
            if let id = r.mediaId {
                MediaNote(mediaId: id, kind: r.mediaKind, durationSec: r.durationSec, coach: session.me?.coach)
            }
            question(r)
            rule
            Monogram(size: JK.Space.huge)
                .accessibilityLabel("JK")
            if session.gate.messaging {
                Button("Reply to JK") { reply(r) }.buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    private var rule: some View {
        Rectangle().fill(JK.silver).frame(height: JK.Size.hairline).accessibilityHidden(true)
    }

    /// An old report (before letters) keeps its summary as the body.
    @ViewBuilder
    private func oldSummary(_ r: Report) -> some View {
        if (r.headline ?? "").isEmpty && !r.summary.isEmpty && r.summary != r.displayHeadline {
            Text(r.summary).jkText(.quoteSmall).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func block(_ title: String, _ text: String) -> some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.s) {
                Text(title).font(.jkCaption).foregroundStyle(JK.textSecondary)
                Text(text).jkText(.quote).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder
    private func question(_ r: Report) -> some View {
        if let q = r.question, !q.isEmpty {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                Text(q).jkText(.title).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                if let given = r.answer, !given.isEmpty {
                    Text(given).font(.jkBody).foregroundStyle(JK.text)
                    Text("Sent to JK" + (r.answeredAt.map { " · \(Fmt.dayMonth($0))" } ?? ""))
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                } else if session.gate.checkin {
                    TextField("Your answer", text: $answer, axis: .vertical)
                        .lineLimit(2...6)
                        .font(.jkBody)
                        .foregroundStyle(JK.text)
                        .padding(JK.Space.m)
                        .frame(minHeight: JK.Size.touch)
                        .overlay(RoundedRectangle(cornerRadius: JK.Radius.control, style: .continuous)
                            .strokeBorder(JK.inputBorder, lineWidth: JK.Size.hairline))
                        .accessibilityLabel("Your answer to JK's question")
                    if let answerError { ErrorBanner(message: answerError) }
                    Button { Task { await send(r) } } label: {
                        if answering { ProgressView().tint(JK.text) } else { Text("Send answer") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(answering || answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func reply(_ r: Report) {
        guard let id = r.id else { return }
        let router = TabRouter.shared
        router.replyQuote = .init(reportId: id, headline: r.displayHeadline)
        let isLetter: (ClientRoute) -> Bool = { if case .letter = $0 { return true } else { return false } }
        router.reviewPath.removeAll(where: isLetter)
        router.actPath.removeAll(where: isLetter)
        router.planPath.removeAll(where: isLetter)
        router.jkPath.removeAll(where: isLetter)
        router.openJK(path: router.jkPath)
    }

    private func load() async {
        do {
            let fresh: Report = try await api.get("/api/reports/\(seg(reportId))")
            report = fresh
            error = nil
            if fresh.readAt == nil, session.me?.isCoach == false {
                let _: ReadReply? = try? await api.send("POST", "/api/reports/\(seg(reportId))/read")
            }
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func send(_ r: Report) async {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        answering = true
        defer { answering = false }
        do {
            report = try await api.send("POST", "/api/reports/\(seg(reportId))/answer", body: AnswerInput(answer: text))
            answer = ""
            answerError = nil
        } catch {
            answerError = error.readable
        }
    }
}
