import AuthenticationServices
import LukeKit
import SwiftUI
import UIKit

/// Provides a UIWindow anchor for ASWebAuthenticationSession.
@MainActor
private final class WindowAnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .compactMap { $0.keyWindow }
            .first ?? UIWindow()
    }
}

private enum SocialProvider: String {
    case google
    case github

    var label: String {
        switch self {
        case .google: "Continue with Google"
        case .github: "Continue with GitHub"
        }
    }
}

struct ContentView: View {
    @Environment(AccountSession.self) private var session
    @State private var pendingProvider: SocialProvider?
    @State private var signInError: String?
    @State private var contextProvider = WindowAnchorProvider()

    var body: some View {
        switch session.state {
        case .signedOut:
            signedOutView
        case .signedIn(let identity):
            signedInView(identity: identity)
        }
    }

    // MARK: - Signed-out

    private var signedOutView: some View {
        VStack(spacing: 20) {
            Text("Luke")
                .font(.largeTitle.bold())
            if let error = signInError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            // Mirror the desktop: show individual provider buttons so the
            // sign-in page knows which provider to launch without a selection step.
            Button {
                startSignIn(provider: .google)
            } label: {
                Label(SocialProvider.google.label, systemImage: "globe")
                    .frame(maxWidth: 280)
            }
            .buttonStyle(.borderedProminent)
            .disabled(pendingProvider != nil)

            Button {
                startSignIn(provider: .github)
            } label: {
                Label(SocialProvider.github.label, systemImage: "chevron.left.forwardslash.chevron.right")
                    .frame(maxWidth: 280)
            }
            .buttonStyle(.bordered)
            .disabled(pendingProvider != nil)

            if pendingProvider != nil {
                Text("Opening…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
    }

    // MARK: - Signed-in

    private func signedInView(identity: AccountIdentity) -> some View {
        VStack(spacing: 12) {
            Text(identity.name ?? identity.email)
                .font(.title2.bold())
            Text(identity.email)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Sign out") {
                Task { await session.signOut() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }

    // MARK: - Sign-in flow

    private func startSignIn(provider: SocialProvider) {
        pendingProvider = provider
        signInError = nil

        let pkce = PKCE()
        // The sign-in page reads the state prefix to select the provider automatically,
        // matching the desktop's "{provider}.{randomState}" discipline.
        let state = "\(provider.rawValue).\(UUID().uuidString)"
        let client = AccountClient(
            baseURL: AccountConstants.baseURL,
            clientID: AccountConstants.clientID
        )
        let authorizeURL = client.authorizeURL(
            redirectURI: AccountConstants.redirectURI,
            state: state,
            codeChallenge: pkce.challenge
        )

        let webSession = ASWebAuthenticationSession(
            url: authorizeURL,
            callbackURLScheme: "dev.tryluke.ios"
        ) { [session] callbackURL, error in
            Task { @MainActor in
                defer { pendingProvider = nil }
                if let asError = error as? ASWebAuthenticationSessionError,
                   asError.code == .canceledLogin
                {
                    return
                }
                if let error {
                    signInError = error.localizedDescription
                    return
                }
                guard
                    let callbackURL,
                    let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                    let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
                    let returnedState = components.queryItems?.first(where: {
                        $0.name == "state"
                    })?.value,
                    returnedState == state
                else {
                    signInError = "Invalid callback URL"
                    return
                }
                do {
                    try await session.completeSignIn(code: code, verifier: pkce.verifier)
                } catch {
                    signInError = error.localizedDescription
                }
            }
        }
        webSession.presentationContextProvider = contextProvider
        webSession.prefersEphemeralWebBrowserSession = false
        webSession.start()
    }
}
