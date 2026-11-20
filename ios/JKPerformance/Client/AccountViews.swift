import SwiftUI

// MARK: - Account (client tab root)

struct AccountView: View {
    @AppStorage("jk.role") private var role: AppRole = .client

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Account", title: "Sam Carter")
                    VStack(spacing: 8) {
                        AccountLink(title: "Membership", detail: "Elite · renews 1 Dec", systemName: "creditcard") { MembershipView() }
                        AccountLink(title: "Health & devices", detail: "Apple Health, Watch, Oura", systemName: "heart") { HealthDevicesView() }
                    }
                    Button("Sign out") { role = .signedOut }
                        .buttonStyle(GhostButtonStyle())
                        .padding(.top, 20)
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
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
    @State private var appleHealth = true
    @State private var devices = Mock.devices

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
                        Text("Steps, sleep, HR, workouts, weight").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    Spacer()
                    Toggle("", isOn: $appleHealth).labelsHidden()
                }
                .jkCard()

                Eyebrow(text: "Wearables & apps")
                VStack(spacing: 0) {
                    ForEach($devices) { $device in
                        HStack(spacing: 12) {
                            IconTile(systemName: device.systemName, size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(device.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                Text(device.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                            Toggle("", isOn: $device.connected).labelsHidden()
                        }
                        .padding(12)
                    }
                }
                .jkCard(padding: 2)

                Text("HealthKit read scopes · last sync 2 min ago")
                    .font(.caption2.monospaced())
                    .foregroundStyle(JK.tertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [3])))
            }
            .padding(16)
        }
        .jkScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Membership

/// Plan picker. Payment is a placeholder: real billing needs StoreKit (the
/// design says "Billed through the App Store") — not wired yet.
struct MembershipView: View {
    enum Billing: String, CaseIterable { case monthly = "Monthly", annual = "Annual · save 15%" }

    @State private var billing: Billing = .monthly
    @State private var plan = "Elite"

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 6) {
                    Text("JK")
                        .font(.headline)
                        .frame(width: 44, height: 44)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(JK.secondary, lineWidth: 1))
                    Text("Choose your plan").font(.title2.weight(.semibold))
                    Text("Cancel anytime. Billed through the App Store.").font(.caption).foregroundStyle(JK.tertiary)
                }
                .foregroundStyle(JK.text)

                Segmented(options: Billing.allCases, selection: $billing) { $0.rawValue }

                ForEach(Mock.plans) { p in
                    Button {
                        plan = p.name
                    } label: {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(p.name).font(.subheadline.weight(.semibold))
                                    if p.name == "Elite" {
                                        Text("Current")
                                            .font(.system(size: 9, weight: .semibold))
                                            .padding(.horizontal, 6).padding(.vertical, 2)
                                            .background(JK.text, in: Capsule())
                                            .foregroundStyle(.black)
                                    }
                                }
                                Text(p.detail).font(.caption2).foregroundStyle(JK.tertiary).multilineTextAlignment(.leading)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(billing == .monthly ? p.monthly : p.annual).font(.title3.weight(.semibold))
                                Text(billing == .monthly ? "/ month" : "/ year").font(.caption2).foregroundStyle(JK.tertiary)
                            }
                        }
                        .foregroundStyle(JK.text)
                        .padding(14)
                        .background(JK.card, in: RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous)
                            .stroke(plan == p.name ? JK.text : JK.stroke, lineWidth: plan == p.name ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                }

                VStack(spacing: 10) {
                    HStack { Text("Next payment"); Spacer(); Text("1 Dec 2026") }
                    HStack { Text("Payment method"); Spacer(); Label("Pay · Visa 4421", systemImage: "apple.logo") }
                }
                .font(.caption)
                .foregroundStyle(JK.secondary)
                .jkCard()

                Button {} label: { Label("Pay with Apple Pay", systemImage: "apple.logo") }
                    .buttonStyle(ChromeButtonStyle())
                HStack(spacing: 20) {
                    Text("Restore purchases")
                    Text("Manage in Settings")
                }
                .font(.caption2)
                .foregroundStyle(JK.tertiary)
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Membership")
        .navigationBarTitleDisplayMode(.inline)
    }
}
