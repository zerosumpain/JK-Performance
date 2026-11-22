import SwiftUI

/// Guides (atelier-spec.md, Client screens 9): every plan includes them, Free
/// too. A list of JK's guides with a one-line summary and reading time; each
/// opens on paper. GET /api/client/guides never refuses a client.
struct GuidesList: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                Text("Guides").jkText(.display).foregroundStyle(JK.text).accessibilityAddTraits(.isHeader)
                GuidesListContent()
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// The list itself, shared with the Free JK tab.
struct GuidesListContent: View {
    @State private var guides: [ClientGuide]?
    @State private var error: String?

    var body: some View {
        Loadable(value: guides, error: error, retry: load) { list in
            if list.isEmpty {
                EmptyState(line: "JK's guides will appear here.")
            } else {
                VStack(spacing: 0) {
                    ForEach(list) { g in
                        Button { TabRouter.shared.jkPath.append(.guide(g.id)) } label: { row(g) }
                            .buttonStyle(.plain)
                        if g.id != list.last?.id { GroupDivider() }
                    }
                }
                .surface(.group)
            }
        }
        .task { await load() }
    }

    private func row(_ g: ClientGuide) -> some View {
        HStack(alignment: .top, spacing: JK.Space.m) {
            Icon(key: .guide).foregroundStyle(JK.textSecondary)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(g.title).font(.jkHeadline).foregroundStyle(JK.text).multilineTextAlignment(.leading)
                if let summary = g.summary {
                    Text(summary).font(.jkCallout).foregroundStyle(JK.textSecondary).multilineTextAlignment(.leading)
                }
                if let minutes = g.minutes {
                    Text("\(minutes) min read").font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(JK.Space.l)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        do {
            let reply: ClientGuidesResponse = try await APIClient.shared.get("/api/client/guides")
            guides = reply.guides
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}

/// One guide on paper: the serif headline and a sans body.
struct GuideView: View {
    let guideId: String
    @State private var guide: ClientGuide?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                Loadable(value: guide, error: error, retry: load) { g in
                    VStack(alignment: .leading, spacing: JK.Space.l) {
                        BrandRule()
                        Text(g.title).jkText(.letterHeadline).foregroundStyle(JK.text)
                            .accessibilityAddTraits(.isHeader)
                        if let minutes = g.minutes {
                            Text("\(minutes) min read").font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                        ForEach(Array(paragraphs(g).enumerated()), id: \.offset) { _, p in
                            Text(p).font(.jkBody).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                        }
                        Monogram(size: JK.Space.huge).foregroundStyle(JK.accent).padding(.top, JK.Space.l)
                    }
                    .surface(.paper, padding: JK.Space.xxl)
                }
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func paragraphs(_ g: ClientGuide) -> [String] {
        (g.body ?? g.summary ?? "").components(separatedBy: "\n\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func load() async {
        do {
            guide = try await APIClient.shared.get("/api/client/guides/\(seg(guideId))")
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }
}
