import SwiftUI

// MARK: - Account (client tab root)

struct AccountView: View {
    @Environment(AppSession.self) private var session
    @State private var editingName = false
    @State private var name = ""
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var error: String?

    private var api: APIClient { APIClient.shared }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Account", title: session.me?.name ?? "Account") {
                        Button {
                            name = session.me?.name ?? ""
                            editingName = true
                        } label: {
                            Image(systemName: "pencil")
                                .frame(width: 30, height: 30)
                                .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.stroke, lineWidth: 1))
                        }
                        .foregroundStyle(JK.text)
                        .accessibilityLabel("Edit name")
                    }
                    if let email = session.me?.email {
                        Text(email).font(.caption).foregroundStyle(JK.tertiary)
                    }
                    VStack(spacing: 8) {
                        AccountLink(title: "Membership", detail: membershipDetail, systemName: "creditcard") { MembershipView() }
                        AccountLink(title: "Health & devices", detail: HealthSync.shared.optedIn ? "Apple Health on" : "Apple Health off",
                                    systemName: "heart") { HealthDevicesView() }
                    }

                    Eyebrow(text: "Your data")
                    VStack(spacing: 8) {
                        exportRow
                        Link(destination: api.privacyURL) {
                            rowLabel(title: "Privacy policy", detail: "What we store and why", systemName: "hand.raised",
                                     trailing: "arrow.up.right")
                        }
                        Button {
                            confirmDelete = true
                        } label: {
                            rowLabel(title: "Delete account", detail: "Erases your account, workouts and photos",
                                     systemName: "trash", trailing: deleting ? nil : "chevron.right")
                        }
                        .buttonStyle(.plain)
                        .disabled(deleting)
                    }

                    if let error { ErrorBanner(message: error) }
                    Button("Sign out") { Task { await session.signOut() } }
                        .buttonStyle(GhostButtonStyle())
                        .padding(.top, 20)
                }
                .padding(16)
            }
            .jkScreen()
            .jkRefreshable { await session.refreshMe() }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Your name", isPresented: $editingName) {
                TextField("Name", text: $name)
                Button("Cancel", role: .cancel) {}
                Button("Save") { Task { await saveName() } }
            }
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account and all data", role: .destructive) { Task { await deleteAccount() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently erases your account and everything stored about you, photos included. It can't be undone.")
            }
        }
    }

    private var membershipDetail: String {
        guard let m = session.me?.membership, m.isActive else { return "No plan" }
        return m.renewsOn.map { "\(m.displayName) · renews \(Fmt.dayMonth($0))" } ?? m.displayName
    }

    @ViewBuilder
    private var exportRow: some View {
        if let exportURL {
            ShareLink(item: exportURL) {
                rowLabel(title: "Share your export", detail: exportURL.lastPathComponent, systemName: "square.and.arrow.up",
                         trailing: "square.and.arrow.up")
            }
        } else {
            Button {
                Task { await export() }
            } label: {
                rowLabel(title: "Export your data", detail: exporting ? "Preparing…" : "Everything stored about you, as JSON",
                         systemName: "arrow.down.doc", trailing: exporting ? nil : "chevron.right")
            }
            .buttonStyle(.plain)
            .disabled(exporting)
        }
    }

    private func rowLabel(title: String, detail: String, systemName: String, trailing: String?) -> some View {
        HStack(spacing: 12) {
            IconTile(systemName: systemName)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            if let trailing {
                Image(systemName: trailing).font(.caption).foregroundStyle(JK.tertiary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .jkCard(padding: 12)
    }

    private func saveName() async {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        do {
            let fresh: Me = try await api.send("PATCH", "/api/me", body: ["name": trimmed])
            session.update(fresh)
            error = nil
        } catch {
            self.error = error.readable
        }
    }

    private func export() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await api.data("/api/me/export")
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("jk-performance-export-\(Day.today).json")
            try data.write(to: url, options: .atomic)
            exportURL = url
            error = nil
        } catch {
            self.error = error.readable
        }
    }

    private func deleteAccount() async {
        deleting = true
        defer { deleting = false }
        do {
            try await session.deleteAccount()
        } catch {
            self.error = error.readable
        }
    }
}

struct AccountLink<Destination: View>: View {
    let title: String
    let detail: String
    let systemName: String
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                IconTile(systemName: systemName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                    Text(detail).font(.caption2).foregroundStyle(JK.tertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
            }
            .jkCard(padding: 12)
        }
    }
}

// MARK: - Health & devices

struct HealthDevicesView: View {
    @State private var devices: HealthDevices?
    @State private var toggling = false
    private var health: HealthSync { HealthSync.shared }

    /// Third-party wearables and apps reach JK Performance only through Apple
    /// Health, so these rows explain rather than pretend to connect.
    private let wearables: [(name: String, detail: String, systemName: String)] = [
        ("Apple Watch", "Writes steps, sleep, heart rate and workouts to Apple Health", "applewatch"),
        ("WHOOP", "Turn on Apple Health sharing in the WHOOP app", "bolt.heart"),
        ("Oura", "Turn on Apple Health in the Oura app's settings", "circle.circle"),
        ("Garmin", "Garmin Connect › Settings › Connected apps › Apple Health", "figure.run"),
        ("MyFitnessPal", "Shares weight and steps through Apple Health; log food here", "fork.knife"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Health & devices").font(.title.weight(.semibold)).foregroundStyle(JK.text)
                    Text("Share activity, sleep and heart rate with your coach automatically.")
                        .font(.caption).foregroundStyle(JK.secondary)
                }
                HStack(spacing: 12) {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(.red)
                        .frame(width: 40, height: 40)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Apple Health").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text("Steps, sleep, resting HR, active energy, weight, distance").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                    if toggling || health.syncing {
                        ProgressView().controlSize(.small)
                    }
                    Toggle("", isOn: Binding(get: { health.optedIn }, set: { on in
                        Task {
                            toggling = true
                            if on { await health.enable() } else { health.disable() }
                            toggling = false
                            await loadDevices()
                        }
                    }))
                    .labelsHidden()
                    .disabled(toggling || !health.available)
                }
                .jkCard()
                if let error = health.lastError { ErrorBanner(message: error) }

                Eyebrow(text: "Wearables & apps · via Apple Health")
                VStack(spacing: 0) {
                    ForEach(wearables, id: \.name) { device in
                        HStack(spacing: 12) {
                            IconTile(systemName: device.systemName, size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(device.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                Text(device.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                            Image(systemName: "arrow.triangle.merge").font(.caption).foregroundStyle(JK.tertiary)
                        }
                        .padding(12)
                    }
                }
                .jkCard(padding: 2)

                Text(statusLine)
                    .font(.caption2.monospaced())
                    .foregroundStyle(JK.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [3])))
                if health.optedIn {
                    Button("Sync now") { Task { await health.sync(); await loadDevices() } }
                        .buttonStyle(GhostButtonStyle())
                        .disabled(health.syncing)
                    Text("To stop iOS sharing entirely, open Settings › Health › Data Access & Devices › JK Performance.")
                        .font(.caption2).foregroundStyle(JK.tertiary)
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadDevices() }
    }

    private var statusLine: String {
        var parts: [String] = []
        if let last = health.lastSync { parts.append("last sync \(Fmt.relative(last))") }
        if let stored = health.lastStored { parts.append("\(stored) days sent") }
        if let server = devices?.lastSampleAt { parts.append("coach sees data to \(Fmt.dayMonth(server))") }
        return parts.isEmpty ? "HealthKit read-only · nothing synced yet" : "HealthKit read-only · " + parts.joined(separator: " · ")
    }

    private func loadDevices() async {
        devices = try? await APIClient.shared.get("/api/health/devices")
    }
}

// MARK: - Membership

/// Plan picker from /api/plans. Testing only: choosing a plan POSTs
/// /api/me/membership and takes no payment (real billing will need StoreKit).
struct MembershipView: View {
    enum Billing: String, CaseIterable { case monthly = "Monthly", annual = "Annual" }

    @Environment(AppSession.self) private var session
    @State private var billing: Billing = .monthly
    @State private var plans: [Plan]?
    @State private var picked: String?
    @State private var error: String?
    @State private var saving = false
    @State private var saveError: String?

    private var current: String { session.me?.membership?.plan ?? "none" }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 6) {
                    Text("JK")
                        .font(.headline)
                        .frame(width: 44, height: 44)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(JK.secondary, lineWidth: 1))
                    Text("Choose your plan").font(.title2.weight(.semibold))
                    Text("Testing build: switching plans takes no payment.").font(.caption).foregroundStyle(JK.tertiary)
                }
                .foregroundStyle(JK.text)

                Segmented(options: Billing.allCases, selection: $billing) { $0.rawValue }

                Loadable(value: plans, error: error, retry: load) { list in
                    ForEach(list) { p in
                        planCard(p)
                    }
                }

                if let m = session.me?.membership, m.isActive {
                    VStack(spacing: 10) {
                        if let renews = m.renewsOn {
                            HStack { Text("Renews"); Spacer(); Text(Fmt.dayMonth(renews)) }
                        }
                        if let left = m.creditsLeft, let total = m.creditsTotal {
                            HStack { Text("Session credits"); Spacer(); Text("\(left) of \(total)") }
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(JK.secondary)
                    .jkCard()
                }

                if let saveError { ErrorBanner(message: saveError) }
                Button {
                    Task { await choose() }
                } label: {
                    if saving {
                        ProgressView().tint(.black)
                    } else {
                        Text(buttonTitle)
                    }
                }
                .buttonStyle(ChromeButtonStyle())
                .disabled(saving || (picked ?? current) == current)
                Text("No charge is made while payments are off. Billing through the App Store comes later.")
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Membership")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var buttonTitle: String {
        let target = picked ?? current
        if target == current { return "Current plan" }
        let name = plans?.first { $0.id == target }?.name ?? Fmt.planName(target)
        return "Switch to \(name) (test, no charge)"
    }

    private func planCard(_ p: Plan) -> some View {
        let selected = (picked ?? current) == p.id
        return Button {
            picked = p.id
        } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(p.name).font(.subheadline.weight(.semibold))
                        if p.id == current {
                            Text("Current")
                                .font(.system(size: 9, weight: .semibold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(JK.text, in: Capsule())
                                .foregroundStyle(.black)
                        }
                    }
                    Text(p.detail).font(.caption2).foregroundStyle(JK.tertiary).multilineTextAlignment(.leading)
                    if p.credits > 0 {
                        Text("\(p.credits) session credits / month").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    let pence = billing == .monthly ? p.monthlyPence : p.annualPence
                    Text(pence == 0 ? "Free" : Fmt.pounds(pence)).font(.title3.weight(.semibold))
                    if pence > 0 {
                        Text(billing == .monthly ? "/ month" : "/ year").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                }
            }
            .foregroundStyle(JK.text)
            .padding(14)
            .background(JK.card, in: RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous)
                .stroke(selected ? JK.text : JK.stroke, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        do {
            let reply: PlansResponse = try await APIClient.shared.get("/api/plans")
            plans = reply.plans
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.readable }
        }
    }

    private func choose() async {
        guard let target = picked, target != current else { return }
        saving = true
        defer { saving = false }
        do {
            let fresh: Me = try await APIClient.shared.send("POST", "/api/me/membership", body: ["plan": target])
            session.update(fresh)
            picked = nil
            saveError = nil
        } catch {
            saveError = error.readable
        }
    }
}
