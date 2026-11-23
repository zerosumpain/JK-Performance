import AuthenticationServices
import SwiftUI
import UIKit

/// Welcome (plan-act-review.md, screen 1): the faint rings, the silver
/// mark, "Plan. Act. Review." and one line; Sign in with Apple and
/// "Continue with a code" at the foot. Sign-up is open: Sign in with Apple
/// creates a client account; coaches are designated server-side. The code is
/// the App Review demo login (POST /api/auth/code).
struct WelcomeView: View {
    @Environment(AppSession.self) private var session
    @State private var busy = false
    @State private var error: String?
    @State private var showCode = false
    @State private var code = ""
    @State private var controlsShown = false
    @State private var apple = AppleSignIn()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: JK.Space.huge)
                    VStack(spacing: 0) {
                        WelcomeMark()
                        SerifText("Plan. *Act.* Review.", size: .hero)
                            .foregroundStyle(JK.text)
                            .multilineTextAlignment(.center)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.top, JK.Space.huge)
                        Text("One-to-one coaching with JK, in a simple rhythm you can keep.")
                            .font(.jkBodySmall)
                            .foregroundStyle(JK.textSecondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, JK.Space.m)
                            .padding(.horizontal, JK.Space.xxl)
                    }
                    Spacer(minLength: JK.Space.huge)
                    controls
                        .opacity(controlsShown ? 1 : 0)
                }
                .padding(.horizontal, JK.Space.xxl)
                .padding(.bottom, JK.Space.l)
                .frame(minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background {
            ZStack {
                JK.bg
                FaintRings(center: UnitPoint(x: 0.5, y: 0.34))
            }
            .ignoresSafeArea()
        }
        .task {
            if !reduceMotion { try? await Task.sleep(for: .seconds(0.3)) }
            withAnimation(JK.Motion.respecting(reduceMotion, .easeOut(duration: 0.45))) { controlsShown = true }
        }
        .alert("Continue with a code", isPresented: $showCode) {
            TextField("Code", text: $code)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) { code = "" }
            Button("Continue") { signInWithCode() }
        } message: {
            Text("For demo and review accounts.")
        }
    }

    private var controls: some View {
        VStack(spacing: JK.Space.m) {
            if let error {
                Text(error)
                    .font(.jkCaption)
                    .foregroundStyle(JK.textSecondary)
                    .multilineTextAlignment(.center)
            }
            PrimaryButton("Sign in with Apple", busy: busy, leadingSymbol: "apple.logo") {
                error = nil
                apple.start { handle($0) }
            }
            SecondaryButton("Continue with a code") { showCode = true }
                .disabled(busy)
            Text("New here? Signing in creates your client account. By continuing you agree to the Terms and Privacy Policy.")
                .font(.jkMeta)
                .foregroundStyle(JK.textTertiary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, JK.Space.xs)
            Link("Privacy Policy", destination: APIClient.shared.privacyURL)
                .font(.jkMeta)
                .foregroundStyle(JK.textSecondary)
                .frame(minHeight: JK.Size.touch)
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
            let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
            let given = credential.fullName?.givenName
            let family = credential.fullName?.familyName
            busy = true
            error = nil
            Task {
                defer { busy = false }
                do {
                    try await session.signInWithApple(identityToken: token, authorizationCode: code, givenName: given, familyName: family)
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

/// Sign in with Apple behind our own chrome button: the system sheet, with
/// the result handed back on the main thread.
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var completion: ((Result<ASAuthorization, Error>) -> Void)?
    private var controller: ASAuthorizationController?

    func start(_ completion: @escaping (Result<ASAuthorization, Error>) -> Void) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.completion = completion
        self.controller = controller
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        finish(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        finish(.failure(error))
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        let done = completion
        completion = nil
        controller = nil
        DispatchQueue.main.async { done?(result) }
    }
}
