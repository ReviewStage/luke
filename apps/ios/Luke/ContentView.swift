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

struct ContentView: View {
    @Environment(AccountSession.self) private var session
    @State private var isSigningIn = false
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
            Button(isSigningIn ? "Signing in…" : "Sign in to Luke") {
                startSignIn()
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSigningIn)
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

    private func startSignIn() {
        isSigningIn = true
        signInError = nil

        let pkce = PKCE()
        let state = UUID().uuidString
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
                defer { isSigningIn = false }
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
