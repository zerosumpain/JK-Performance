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
                    if session.canReturnToCoach {
                        Button {
                            Task { await session.returnToCoach() }
                        } label: {
                            Label("Back to coach", systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(ChromeButtonStyle())
                        Text("You're looking round as the demo client. Nothing here is a real client's data.")
                            .font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    VStack(spacing: 8) {
                        AccountLink(title: "Membership", detail: membershipDetail, systemName: "creditcard") { MembershipView() }
                        AccountLink(title: "Apple Health", detail: healthDetail, systemName: "heart") { HealthDevicesView() }
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

    private var healthDetail: String {
        guard HealthSync.shared.optedIn else { return "Not connected" }
        return session.me?.healthSharing == true ? "Connected · shared with \(session.me?.coach?.name ?? "your coach")" : "Connected · only you"
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

/// Connect Apple Health, and say yes or no to the coach seeing it. Two
/// separate choices: connecting fills habits and progress for the client;
/// sharing lets the coach see daily figures and workouts too.
struct HealthDevicesView: View {
    @Environment(AppSession.self) private var session
    @State private var devices: HealthDevices?
    @State private var activities: [HealthActivity] = []
    @State private var busy = false
    @State private var error: String?
    @State private var confirmErase = false
    private var health: HealthSync { HealthSync.shared }

    private var coachName: String { session.me?.coach?.name ?? "your coach" }
    private var sharing: Bool { devices?.sharing ?? session.me?.healthSharing ?? false }

    /// Third-party wearables reach JK Performance only through Apple Health,
    /// so these rows explain rather than pretend to connect.
    private let wearables: [(name: String, detail: String, systemName: String)] = [
        ("Apple Watch", "Writes everything here on its own", "applewatch"),
        ("WHOOP", "WHOOP app › Apple Health › on", "bolt.heart"),
        ("Oura", "Oura app › Settings › Apple Health", "circle.circle"),
        ("Garmin", "Garmin Connect › Connected apps › Apple Health", "figure.run"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Apple Health").font(.title.weight(.semibold)).foregroundStyle(JK.text)
                    Text(health.optedIn ? "Connected. Your habits and progress fill themselves in."
                                        : "Connect once and your steps, sleep and workouts fill themselves in.")
                        .font(.caption).foregroundStyle(JK.secondary)
                }
                if session.me?.demo == true {
                    Text("This is the demo account, so nothing from this phone's Apple Health is sent.")
                        .font(.caption2).foregroundStyle(JK.tertiary)
                }
                if health.optedIn { connected } else { connect }
                if let error = error ?? health.lastError { ErrorBanner(message: error) }

                Eyebrow(text: "Wearables · through Apple Health")
                VStack(spacing: 0) {
                    ForEach(wearables, id: \.name) { device in
                        HStack(spacing: 12) {
                            IconTile(systemName: device.systemName, size: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(device.name).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                                Text(device.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                        }
                        .padding(10)
                    }
                }
                .jkCard(padding: 2)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .confirmationDialog("Disconnect Apple Health?", isPresented: $confirmErase, titleVisibility: .visible) {
            Button("Disconnect and delete synced data", role: .destructive) { Task { await erase() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Stops syncing and deletes every day and workout sent so far, for you and \(coachName). Your Apple Health itself isn't touched.")
        }
    }

    // MARK: Not connected yet

    private var connect: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                readRow("figure.walk", "Steps, distance and active energy")
                readRow("bed.double", "Sleep")
                readRow("heart", "Resting and workout heart rate")
                readRow("scalemass", "Body weight")
                readRow("figure.run", "Workouts: runs, rides, gym sessions and classes")
            }
            Text("Read only: the app never writes to Apple Health.")
                .font(.caption2).foregroundStyle(JK.tertiary)
            Button {
                Task { await connect(share: true) }
            } label: {
                if busy { ProgressView().tint(.black) } else { Text("Connect and share with \(coachName)") }
            }
            .buttonStyle(ChromeButtonStyle())
            .disabled(busy || !health.available || session.me?.demo == true)
            Button("Connect, but keep it to myself") { Task { await connect(share: false) } }
                .buttonStyle(GhostButtonStyle())
                .disabled(busy || !health.available || session.me?.demo == true)
            Text("Sharing lets \(coachName) see your daily figures and workouts to tailor your plan. You can change either choice here at any time.")
                .font(.caption2).foregroundStyle(JK.tertiary)
        }
        .jkCard()
    }

    private func readRow(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).frame(width: 20).foregroundStyle(JK.secondary)
            Text(text).font(.subheadline).foregroundStyle(JK.text)
        }
    }

    // MARK: Connected

    private var connected: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: Binding(get: { sharing }, set: { on in Task { await share(on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share with \(coachName)").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text(sharing ? "Sees your daily figures and workouts" + (devices?.sharingSince.map { " · since \(Fmt.dayMonth($0))" } ?? "")
                                     : "Only you see your Apple Health")
                            .font(.caption2).foregroundStyle(JK.tertiary)
                    }
                }
                .tint(.green)
                .disabled(busy)
                Divider().overlay(JK.stroke)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Last synced").font(.caption2).foregroundStyle(JK.tertiary)
                        Text(health.lastSync.map { Fmt.relative($0) } ?? "Not yet").font(.subheadline).foregroundStyle(JK.text)
                    }
                    Spacer()
                    Button {
                        Task { await health.sync(); await load() }
                    } label: {
                        if health.syncing { ProgressView().controlSize(.small) } else { Text("Sync now") }
                    }
                    .buttonStyle(GhostButtonStyle())
                    .frame(width: 110)
                    .disabled(health.syncing)
                }
            }
            .jkCard()

            Eyebrow(text: "Recent workouts", trailing: activities.isEmpty ? nil : "\(devices?.activityCount ?? activities.count) synced")
            if activities.isEmpty {
                Text("No workouts in the last four weeks. Anything your Watch, WHOOP or Garmin records shows up here.")
                    .font(.caption).foregroundStyle(JK.tertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(activities.prefix(6)) { a in
                        ActivityRow(activity: a)
                        if a.id != activities.prefix(6).last?.id { Divider().overlay(JK.stroke) }
                    }
                }
                .jkCard(padding: 4)
            }

            Button("Disconnect Apple Health") { confirmErase = true }
                .buttonStyle(GhostButtonStyle())
                .disabled(busy)
            Text("To stop iOS sharing entirely: Settings › Health › Data Access & Devices › JK Performance.")
                .font(.caption2).foregroundStyle(JK.tertiary)
        }
    }

    // MARK: Actions

    private func load() async {
        devices = try? await APIClient.shared.get("/api/health/devices")
        if health.optedIn, let r: ActivitiesResponse = try? await APIClient.shared.get("/api/health/activities") {
            activities = r.activities
        }
    }

    private func connect(share: Bool) async {
        busy = true
        defer { busy = false }
        if await health.connect(shareWithCoach: share) {
            error = nil
            await session.refreshMe()
            await load()
        }
    }

    private func share(_ on: Bool) async {
        busy = true
        defer { busy = false }
        do {
            devices = try await health.setSharing(on)
            error = nil
            await session.refreshMe()
        } catch {
            self.error = error.readable
        }
    }

    private func erase() async {
        busy = true
        defer { busy = false }
        do {
            try await health.disconnectAndErase()
            activities = []
            error = nil
            await session.refreshMe()
            await load()
        } catch {
            self.error = error.readable
        }
    }
}

/// One Apple Health workout: icon, type, when, and the figures.
struct ActivityRow: View {
    let activity: HealthActivity

    var body: some View {
        HStack(spacing: 12) {
            IconTile(systemName: Self.symbol(activity.type), size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.type).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(Fmt.weekday(activity.start)) \(Fmt.dayMonth(activity.start)) · \(Fmt.time(activity.start))")
                    .font(.caption2).foregroundStyle(JK.tertiary)
            }
            Spacer()
            Text(activity.detail).font(.caption2).foregroundStyle(JK.secondary).multilineTextAlignment(.trailing)
        }
        .padding(10)
    }

    static func symbol(_ type: String) -> String {
        switch type {
        case "Running": return "figure.run"
        case "Walking", "Hiking": return "figure.walk"
        case "Cycling": return "figure.outdoor.cycle"
        case "Swimming": return "figure.pool.swim"
        case "Rowing": return "figure.rower"
        case "Yoga", "Pilates", "Flexibility", "Cooldown": return "figure.mind.and.body"
        case "Strength training", "Functional strength", "Core training", "Cross training": return "dumbbell"
        case "HIIT", "Mixed cardio": return "bolt.heart"
        case "Boxing", "Kickboxing", "Martial arts": return "figure.boxing"
        default: return "figure.mixed.cardio"
        }
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
