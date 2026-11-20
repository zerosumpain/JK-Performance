import SwiftUI

/// First launch: pick client or coach, then sign in. Sign-in is mocked: both
/// buttons just set the role until auth exists.
struct WelcomeView: View {
    @AppStorage("jk.role") private var role: AppRole = .signedOut
    @State private var picked: AppRole = .client

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 18) {
                Text("JK")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(JK.text)
                    .frame(width: 76, height: 76)
                    .background(JK.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(JK.secondary, lineWidth: 1))
                Text("PERFORMANCE")
                    .font(.footnote.weight(.semibold))
                    .tracking(5)
                    .foregroundStyle(JK.text)
                Text("Coaching, programming and accountability.")
                    .font(.footnote)
                    .foregroundStyle(JK.tertiary)
            }
            Spacer()
            VStack(spacing: 10) {
                Segmented(options: [AppRole.client, .coach], selection: $picked) {
                    $0 == .client ? "I'm a client" : "I'm a coach"
                }
                Button {
                    role = picked
                } label: {
                    Label("Sign in with Apple", systemImage: "apple.logo")
                }
                .buttonStyle(ChromeButtonStyle())
                Button("Continue with email") {
                    role = picked
                }
                .buttonStyle(GhostButtonStyle())
                Text("Coach accounts are invite only. By continuing you agree to the Terms.")
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JK.bg.ignoresSafeArea())
    }
}

#Preview { WelcomeView().preferredColorScheme(.dark) }
