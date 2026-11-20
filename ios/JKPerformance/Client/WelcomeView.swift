import AuthenticationServices
import SwiftUI

/// First launch. Sign-up is open: Sign in with Apple creates a client
/// account; coaches are designated server-side. "I have a code" is the App
/// Review demo login (POST /api/auth/code).
struct WelcomeView: View {
    @Environment(AppSession.self) private var session
    @State private var busy = false
    @State private var error: String?
    @State private var showCode = false
    @State private var code = ""

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
                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(JK.secondary)
                        .multilineTextAlignment(.center)
                }
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    handle(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .disabled(busy)
                .overlay {
                    if busy { ProgressView().tint(.black) }
                }

                Button("I have a code") { showCode = true }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(JK.secondary)
                    .padding(.top, 4)

                Text("New here? Signing in creates your client account. By continuing you agree to the Terms and Privacy Policy.")
                    .font(.caption2)
                    .foregroundStyle(JK.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
                Link("Privacy Policy", destination: APIClient.shared.privacyURL)
                    .font(.caption2)
                    .foregroundStyle(JK.secondary)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(JK.bg.ignoresSafeArea())
        .alert("Sign in with a code", isPresented: $showCode) {
            TextField("Code", text: $code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) { code = "" }
            Button("Sign in") { signInWithCode() }
        } message: {
            Text("For demo and review accounts.")
        }
    }

    private func handle(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let failure):
            if (failure as? ASAuthorizationError)?.code == .canceled { return }
            error = failure.localizedDescription
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                error = "Apple didn't return an identity token. Try again."
                return
            }
            let given = credential.fullName?.givenName
            let family = credential.fullName?.familyName
            busy = true
            error = nil
            Task {
                defer { busy = false }
                do {
                    try await session.signInWithApple(identityToken: token, givenName: given, familyName: family)
                } catch {
                    self.error = error.readable
                }
            }
        }
    }

    private func signInWithCode() {
        let value = code.trimmingCharacters(in: .whitespacesAndNewlines)
        code = ""
        guard !value.isEmpty else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await session.signInWithCode(value)
            } catch {
                self.error = (error as? APIError)?.status == 404 ? "That code isn't valid." : error.readable
            }
        }
    }
}
