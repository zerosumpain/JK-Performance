import SwiftUI

// MARK: - Account sheet

/// Account is a sheet from the avatar on Today (atelier-spec.md, IA): one
/// inset grouped list of eight rows. Membership and the plan tour live only
/// here.
struct AccountSheet: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var path: [AccountRoute] = []
    @State private var editingName = false
    @State private var name = ""
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var confirmDelete = false
    @State private var confirmSignOut = false
    @State private var deleting = false
    @State private var error: String?

    enum AccountRoute: Hashable { case membership, health, notifications, privacy }

    private var api: APIClient { APIClient.shared }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: JK.Space.xxl) {
                    if session.canReturnToCoach { demoNote }
                    VStack(spacing: 0) {
                        row(.settings, "Name", session.me?.name ?? "") {
                            name = session.me?.name ?? ""
                            editingName = true
                        }
                        GroupDivider()
                        link(.membership, .goal, "Membership", membershipDetail)
                        GroupDivider()
                        link(.health, .fromHealth, "Apple Health", healthDetail)
                        GroupDivider()
                        link(.notifications, .reply, "Notifications", notificationsDetail)
                        GroupDivider()
                        exportRow
                        GroupDivider()
                        link(.privacy, .lock, "Privacy", "What we store and why")
                    }
                    .surface(.group)
                    VStack(spacing: 0) {
                        row(.chevron, "Sign out", nil) { confirmSignOut = true }
                        GroupDivider()
                        row(.chevron, "Delete account", deleting ? "Deleting…" : "Erases your account, sessions and photos") {
                            confirmDelete = true
                        }
                    }
                    .surface(.group)
                    if let error { ErrorBanner(message: error) }
                }
                .padding(JK.Space.gutter)
            }
            .jkScreen()
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: AccountRoute.self) { route in
                switch route {
                case .membership: MembershipView()
                case .health: HealthDevicesView()
                case .notifications: NotificationsView()
                case .privacy: PrivacyView()
                }
            }
            .alert("Your name", isPresented: $editingName) {
                TextField("Name", text: $name)
                Button("Cancel", role: .cancel) {}
                Button("Save") { Task { await saveName() } }
            }
            .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await session.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            }
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account and all data", role: .destructive) { Task { await deleteAccount() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This permanently erases your account and everything stored about you, photos included. It can't be undone.")
            }
            .onAppear {
                if TabRouter.shared.showMembership {
                    TabRouter.shared.showMembership = false
                    path = [.membership]
                } else if TabRouter.shared.showPrivacy {
                    TabRouter.shared.showPrivacy = false
                    path = [.privacy]
                }
            }
        }
        .tint(JK.accentControl)
    }

    private var demoNote: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text("You're looking round as the demo client. Nothing here is a real client's data.")
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
            Button("Back to coach") { Task { await session.returnToCoach() } }
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private func link(_ route: AccountRoute, _ icon: IconKey, _ title: String, _ detail: String?) -> some View {
        NavigationLink(value: route) { AccountRowLabel(icon: icon, title: title, detail: detail, chevron: true) }
            .buttonStyle(.plain)
    }

    private func row(_ icon: IconKey, _ title: String, _ detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) { AccountRowLabel(icon: icon, title: title, detail: detail, chevron: false) }
            .buttonStyle(.plain)
    }

    private var healthDetail: String {
        guard HealthSync.shared.optedIn else { return "Not connected" }
        return session.me?.healthSharing == true ? "Connected · shared with JK" : "Connected · only you"
    }

    private var membershipDetail: String {
        guard let m = session.me?.membership, m.isActive else { return "No plan · Guides from JK" }
        return m.renewsOn.map { "\(m.displayName) · renews \(Fmt.dayMonth($0))" } ?? m.displayName
    }

    private var notificationsDetail: String {
        guard Reminders.shared.enabled else { return "Off" }
        return Reminders.shared.eveningTime.map { "On · evening reminder \($0)" } ?? "On"
    }

    @ViewBuilder
    private var exportRow: some View {
        if let exportURL {
            ShareLink(item: exportURL) {
                AccountRowLabel(icon: .photos, title: "Your data", detail: "Share \(exportURL.lastPathComponent)", chevron: false)
            }
            .buttonStyle(.plain)
        } else {
            row(.photos, "Your data", exporting ? "Preparing…" : "Download a copy, as JSON") {
                Task { await export() }
            }
            .disabled(exporting)
        }
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
            dismiss()
        } catch {
            self.error = error.readable
        }
    }
}

/// One row of the Account sheet: glyph, title, one quiet line.
struct AccountRowLabel: View {
    let icon: IconKey
    let title: String
    let detail: String?
    var chevron = true

    var body: some View {
        HStack(spacing: JK.Space.m) {
            Icon(key: icon).foregroundStyle(JK.textSecondary)
            VStack(alignment: .leading, spacing: JK.Space.xs) {
                Text(title).font(.jkBody).foregroundStyle(JK.text)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if chevron { Icon(key: .chevron, size: 13).foregroundStyle(JK.textSecondary) }
        }
        .padding(.horizontal, JK.Space.l)
        .padding(.vertical, JK.Space.m)
        .frame(minHeight: JK.Size.touch)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Notifications

/// On or off, plus one evening reminder time. Never countdown copy.
struct NotificationsView: View {
    @Environment(AppSession.self) private var session
    @State private var time = Date()
    @State private var evening = false
    @State private var error: String?

    private var reminders: Reminders { Reminders.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.xxl) {
                VStack(spacing: 0) {
                    Toggle(isOn: Binding(get: { reminders.enabled }, set: { on in Task { await setOn(on) } })) {
                        VStack(alignment: .leading, spacing: JK.Space.xs) {
                            Text("Notifications").font(.jkBody).foregroundStyle(JK.text)
                            Text("JK's replies and letters, and an hour before each session").font(.jkCaption).foregroundStyle(JK.textSecondary)
                        }
                    }
                    .padding(JK.Space.l)
                    if reminders.enabled {
                        GroupDivider()
                        Toggle(isOn: Binding(get: { evening }, set: { on in
                            evening = on
                            Task { await save() }
                        })) {
                            Text("An evening reminder").font(.jkBody).foregroundStyle(JK.text)
                        }
                        .padding(JK.Space.l)
                        if evening {
                            GroupDivider()
                            DatePicker("Time", selection: $time, displayedComponents: .hourAndMinute)
                                .font(.jkBody)
                                .foregroundStyle(JK.text)
                                .padding(JK.Space.l)
                                .onChange(of: time) { _, _ in Task { await save() } }
                        }
                    }
                }
                .surface(.group)
                .tint(JK.accentControl)
                if let error { ErrorBanner(message: error) }
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            let saved = session.me?.preferences?.eveningReminderTime ?? reminders.eveningTime
            evening = saved != nil
            time = Day.at(Date(), time: saved ?? "20:30") ?? Date()
        }
    }

    private func setOn(_ on: Bool) async {
        if on {
            if !(await reminders.enable(checkIn: session.gate.checkin)) {
                error = "Notifications are off for JK Performance. Turn them on in Settings › Notifications."
                return
            }
        } else {
            reminders.disable()
        }
        error = nil
        await save()
    }

    private func save() async {
        let hhmm = evening ? Fmt.time(time) : nil
        reminders.setEveningTime(hhmm)
        await reminders.refresh(gate: session.gate, preferences: Preferences(notificationsOn: reminders.enabled, eveningReminderTime: hhmm))
        let body = PreferencesInput(notificationsOn: reminders.enabled, eveningReminderTime: hhmm)
        if let _: Preferences = try? await APIClient.shared.send("PUT", "/api/me/preferences", body: body) {
            await session.refreshMe()
        }
    }
}

/// PUT /api/me/preferences: a null time switches the evening reminder off.
struct PreferencesInput: Encodable {
    var notificationsOn: Bool
    var eveningReminderTime: String?

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(notificationsOn, forKey: .notificationsOn)
        try c.encode(eveningReminderTime, forKey: .eveningReminderTime)
    }

    enum CodingKeys: String, CodingKey { case notificationsOn, eveningReminderTime }
}

// MARK: - Privacy

struct PrivacyView: View {
    @Environment(AppSession.self) private var session
    @State private var transcribe = false
    @State private var saving = false
    @State private var error: String?

    /// The switch shows once the server knows voice notes (desk-v2 F19).
    private var voiceKnown: Bool { session.me?.isCoach == false && session.gate.voiceTranscription != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.l) {
                Text("Your account, sessions, habits, check-ins, messages and photos are stored so JK can coach you. Apple Health data is read only with your permission and shared with JK only if you say so. Photos are private to you and JK.")
                    .font(.jkBody).foregroundStyle(JK.text).fixedSize(horizontal: false, vertical: true)
                if voiceKnown { voiceSection }
                Link("Read the privacy policy", destination: APIClient.shared.privacyURL)
                    .buttonStyle(TextButtonStyle())
                NavigationLink("Acknowledgements") { AcknowledgementsView() }
                    .buttonStyle(TextButtonStyle())
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationTitle("Privacy")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { transcribe = session.gate.voiceTranscription == "on" }
        .onChange(of: session.gate.voiceTranscription) { _, value in transcribe = value == "on" }
    }

    private var voiceSection: some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            VStack(spacing: 0) {
                Toggle(isOn: Binding(get: { transcribe }, set: { on in Task { await setTranscribe(on) } })) {
                    VStack(alignment: .leading, spacing: JK.Space.xs) {
                        Text("Transcribe my voice notes").font(.jkBody).foregroundStyle(JK.text)
                        Text(VoiceCopy.consent(provider: session.me?.features?.voiceProvider))
                            .font(.jkCaption).foregroundStyle(JK.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .disabled(saving)
                .padding(JK.Space.l)
            }
            .surface(.group)
            .tint(JK.accentControl)
            Text(transcribe
                 ? "Turning this off stops new notes being transcribed. Transcripts already made stay until you ask JK or delete your account."
                 : "JK still hears every voice note you send.")
                .font(.jkCaption).foregroundStyle(JK.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let error { ErrorBanner(message: error) }
        }
    }

    private func setTranscribe(_ on: Bool) async {
        let before = transcribe
        transcribe = on
        saving = true
        defer { saving = false }
        do {
            try await VoiceConsentStore.set(on, session: session)
            error = nil
        } catch {
            transcribe = before
            self.error = error.readable
        }
    }
}

struct AcknowledgementsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: JK.Space.m) {
                Text("Newsreader").font(.jkHeadline).foregroundStyle(JK.text)
                Text("Copyright 2020 The Newsreader Project Authors. Licensed under the SIL Open Font License, Version 1.1 (scripts.sil.org/OFL). JK's words, letters and guides are set in it.")
                    .font(.jkBody).foregroundStyle(JK.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(JK.Space.gutter)
        }
        .jkScreen()
        .navigationTitle("Acknowledgements")
        .navigationBarTitleDisplayMode(.inline)
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
    @State private var preview: HealthSync.Preview?
    private var health: HealthSync { HealthSync.shared }
    private var isDemo: Bool { session.me?.demo == true }

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
                    Text("Apple Health").font(.jkDisplay).foregroundStyle(JK.text)
                    Text(health.optedIn ? "Connected. Your habits and progress fill themselves in."
                                        : "Connect once and your steps, sleep and workouts fill themselves in.")
                        .font(.jkCaption).foregroundStyle(JK.textSecondary)
                }
                if isDemo { demoTryIt } else if health.optedIn { connected } else { connect }
                if let error = error ?? health.lastError { ErrorBanner(message: error) }

                Eyebrow(text: "Wearables · through Apple Health")
                VStack(spacing: 0) {
                    ForEach(wearables, id: \.name) { device in
                        HStack(spacing: 12) {
                            Glyph(systemName: device.systemName, size: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(device.name).font(.jkCaption.weight(.semibold)).foregroundStyle(JK.text)
                                Text(device.detail).font(.jkCaption).foregroundStyle(JK.textTertiary)
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
                .font(.jkCaption).foregroundStyle(JK.textTertiary)
            Button {
                Task { await connect(share: true) }
            } label: {
                if busy { ProgressView().tint(JK.onPrimary) } else { Text("Connect and share with \(coachName)") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !health.available)
            Button("Connect, but keep it to myself") { Task { await connect(share: false) } }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy || !health.available)
            Text("Sharing lets \(coachName) see your daily figures and workouts to tailor your plan. You can change either choice here at any time.")
                .font(.jkCaption).foregroundStyle(JK.textTertiary)
        }
        .jkCard()
    }

    // MARK: Demo account: the real flow, kept on this phone

    private var demoTryIt: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Text("This is the shared demo account, so nothing from this phone's Apple Health is sent. You can still try the real permission screen and see what the app would read.")
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
                Button {
                    Task { await tryOnThisPhone() }
                } label: {
                    if busy { ProgressView().tint(JK.onPrimary) } else { Text(preview == nil ? "Try it on this phone" : "Read again") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || !health.available)
                if !health.available {
                    Text("Apple Health isn't available on this device.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
            }
            .jkCard()

            if let preview {
                Eyebrow(text: "Read from this phone · last 30 days · not sent")
                if preview.isEmpty {
                    Text("Nothing could be read. If you said no to some types, change it in Settings › Health › Data Access & Devices › JK Performance.")
                        .font(.jkCaption).foregroundStyle(JK.textTertiary)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        previewRow("figure.walk", "Steps", preview.averageSteps.map { "\($0.formatted()) a day · \(preview.stepDays) days" })
                        previewRow("bed.double", "Sleep", preview.averageSleepMinutes.map { "\(Fmt.duration(Double($0))) a night · \(preview.sleepNights) nights" })
                        previewRow("scalemass", "Weight", preview.latestWeight.map { String(format: "%.1f kg", $0) })
                        previewRow("figure.run", "Workouts", preview.workouts.isEmpty ? nil : "\(preview.workouts.count)")
                    }
                    .jkCard()
                    if !preview.workouts.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(preview.workouts.prefix(6)) { a in
                                ActivityRow(activity: a)
                                if a.id != preview.workouts.prefix(6).last?.id { Divider().overlay(JK.hairline) }
                            }
                        }
                        .jkCard(padding: 4)
                    }
                }
            }
        }
    }

    private func previewRow(_ symbol: String, _ title: String, _ value: String?) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).frame(width: 20).foregroundStyle(JK.textSecondary)
            Text(title).font(.jkCallout).foregroundStyle(JK.text)
            Spacer()
            Text(value ?? "None").font(.jkCallout).foregroundStyle(value == nil ? JK.textTertiary : JK.text)
        }
    }

    private func tryOnThisPhone() async {
        busy = true
        defer { busy = false }
        if let found = await health.preview() { preview = found }
    }

    private func readRow(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).frame(width: 20).foregroundStyle(JK.textSecondary)
            Text(text).font(.jkCallout).foregroundStyle(JK.text)
        }
    }

    // MARK: Connected

    private var connected: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: Binding(get: { sharing }, set: { on in Task { await share(on) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share with \(coachName)").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                        Text(sharing ? "Sees your daily figures and workouts" + (devices?.sharingSince.map { " · since \(Fmt.dayMonth($0))" } ?? "")
                                     : "Only you see your Apple Health")
                            .font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
                .tint(JK.accentControl)
                .disabled(busy)
                Divider().overlay(JK.hairline)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Last synced").font(.jkCaption).foregroundStyle(JK.textTertiary)
                        Text(health.lastSync.map { Fmt.relative($0) } ?? "Not yet").font(.jkCallout).foregroundStyle(JK.text)
                    }
                    Spacer()
                    Button {
                        Task { await health.sync(); await load() }
                    } label: {
                        if health.syncing { ProgressView().controlSize(.small) } else { Text("Sync now") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(width: 110)
                    .disabled(health.syncing)
                }
            }
            .jkCard()

            Eyebrow(text: "Recent workouts", trailing: activities.isEmpty ? nil : "\(devices?.activityCount ?? activities.count) synced")
            if activities.isEmpty {
                Text("No workouts in the last four weeks. Anything your Watch, WHOOP or Garmin records shows up here.")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(activities.prefix(6)) { a in
                        ActivityRow(activity: a)
                        if a.id != activities.prefix(6).last?.id { Divider().overlay(JK.hairline) }
                    }
                }
                .jkCard(padding: 4)
            }

            Button("Disconnect Apple Health") { confirmErase = true }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(busy)
            Text("To stop iOS sharing entirely: Settings › Health › Data Access & Devices › JK Performance.")
                .font(.jkCaption).foregroundStyle(JK.textTertiary)
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
            Glyph(systemName: Self.symbol(activity.type), size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(activity.type).font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(Fmt.weekday(activity.start)) \(Fmt.dayMonth(activity.start)) · \(Fmt.time(activity.start))")
                    .font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            Spacer()
            Text(activity.detail).font(.jkCaption).foregroundStyle(JK.textSecondary).multilineTextAlignment(.trailing)
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
    @State private var touring = false
    @State private var featureNames: [String: String] = [:]

    /// `preselected`: a plan chosen in the walkthrough, picked ready to switch.
    init(preselected: String? = nil) {
        _picked = State(initialValue: preselected)
    }

    private var current: String { session.me?.membership?.plan ?? "none" }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 6) {
                    Monogram(size: 44)
                    Text("Membership").jkText(.display)
                    Text("Testing build: switching plans takes no payment.").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                .foregroundStyle(JK.text)

                current(plans)

                Segmented(options: Billing.allCases, selection: $billing) { $0.rawValue }

                tourRow

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
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .jkCard()
                }

                if let saveError { ErrorBanner(message: saveError) }
                Button {
                    Task { await choose() }
                } label: {
                    if saving {
                        ProgressView().tint(JK.onPrimary)
                    } else {
                        Text(buttonTitle)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving || (picked ?? current) == current)
                Text("No charge is made while payments are off. Billing through the App Store comes later.")
                    .font(.jkCaption)
                    .foregroundStyle(JK.textTertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Membership")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .fullScreenCover(isPresented: $touring) {
            PlanTourView(mode: .client) { chosen in picked = chosen }
        }
    }

    /// Your plan, JK's rhythm for it in one quiet line, and what it includes.
    @ViewBuilder
    private func current(_ plans: [Plan]?) -> some View {
        VStack(alignment: .leading, spacing: JK.Space.s) {
            Text(session.me?.membership?.displayName ?? "No plan").font(.jkHeadline).foregroundStyle(JK.text)
            Text(Self.rhythm(current)).jkText(.quoteSmall).foregroundStyle(JK.text)
            if let plan = plans?.first(where: { $0.id == current }), !plan.featureIds.isEmpty {
                Text(plan.featureIds.compactMap { featureNames[$0] }.joined(separator: " · "))
                    .font(.jkCaption).foregroundStyle(JK.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surface(.card, padding: JK.Space.l)
    }

    /// JK's rhythm for each plan (decisions.md).
    static func rhythm(_ plan: String) -> String {
        switch plan {
        case "elite": return "A weekly letter from JK, with a voice or video note"
        case "performance": return "A weekly written letter from JK"
        case "foundation": return "Messages with JK, any day"
        default: return "Guides from JK"
        }
    }

    private var tourRow: some View {
        Button {
            touring = true
        } label: {
            HStack(spacing: 12) {
                Glyph(systemName: "sparkles")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Take the tour").font(.jkCallout.weight(.semibold)).foregroundStyle(JK.text)
                    Text("What each plan includes, step by step").font(.jkCaption).foregroundStyle(JK.textTertiary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.jkCaption).foregroundStyle(JK.textTertiary)
            }
            .jkCard(padding: 12)
        }
        .buttonStyle(.plain)
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
                        Text(p.name).font(.jkCallout.weight(.semibold))
                        if p.isFeatured && p.id != current { PopularBadge() }
                        if p.id == current {
                            Text("Current")
                                .font(.jkMicro.weight(.semibold))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(JK.text, in: Capsule())
                                .foregroundStyle(JK.onPrimary)
                        }
                    }
                    Text(p.detail).font(.jkCaption).foregroundStyle(JK.textTertiary).multilineTextAlignment(.leading)
                    if p.credits > 0 {
                        Text("\(p.credits) session credits / month").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    let pence = billing == .monthly ? p.monthlyPence : p.annualPence
                    Text(pence == 0 ? "Free" : Fmt.pounds(pence)).font(.jkHeadline.weight(.semibold))
                    if pence > 0 {
                        Text(billing == .monthly ? "/ month" : "/ year").font(.jkCaption).foregroundStyle(JK.textTertiary)
                    }
                }
            }
            .foregroundStyle(JK.text)
            .padding(14)
            .background(JK.surface, in: RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous)
                .stroke(selected ? JK.text : JK.hairline, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        do {
            let reply: PlansResponse = try await APIClient.shared.get("/api/plans")
            plans = reply.plans
            featureNames = Dictionary((reply.features ?? []).map { ($0.id, $0.title) }, uniquingKeysWith: { a, _ in a })
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
