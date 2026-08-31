import AuthenticationServices
import LukeKit
import SwiftUI
import UIKit

// MARK: - Window anchor

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

// MARK: - Provider

private enum SocialProvider: String {
    case google, github

    var label: String {
        switch self {
        case .google: "Continue with Google"
        case .github: "Continue with GitHub"
        }
    }
}

// MARK: - Root view

struct ContentView: View {
    @Environment(AccountSession.self) private var session
    @State private var pendingProvider: SocialProvider?
    @State private var signInError: String?
    @State private var contextProvider = WindowAnchorProvider()

    var body: some View {
        switch session.state {
        case .signedOut:
            signedOutCard
        case .signedIn(let identity):
            signedInCard(identity: identity)
        }
    }

    // MARK: - Signed-out card (matches web AUTH_CARD vocabulary)

    private var signedOutCard: some View {
        ZStack {
            Color(red: 0.09, green: 0.09, blue: 0.10).ignoresSafeArea()
            VStack(spacing: 0) {
                // Luke face mark
                LukeMark()
                    .foregroundStyle(Color.white)
                    .frame(width: 52)
                    .padding(.bottom, 16)

                Text("Sign in to Luke")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .padding(.bottom, 8)

                if let error = signInError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 8)
                }

                VStack(spacing: 12) {
                    ProviderButton(
                        provider: .google,
                        pending: pendingProvider == .google
                    ) { startSignIn(provider: .google) }

                    ProviderButton(
                        provider: .github,
                        pending: pendingProvider == .github
                    ) { startSignIn(provider: .github) }
                }
                .padding(.top, 32)
                .disabled(pendingProvider != nil)

            }
            .padding(.horizontal, 32)
            .padding(.vertical, 40)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(red: 0.12, green: 0.12, blue: 0.13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color(white: 1, opacity: 0.08), lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.42), radius: 40, y: 16)
            )
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Signed-in card

    private func signedInCard(identity: AccountIdentity) -> some View {
        ZStack {
            Color(red: 0.09, green: 0.09, blue: 0.10).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 12) {
                        Text(identity.name ?? identity.email)
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color.white)
                        Text(identity.email)
                            .font(.subheadline)
                            .foregroundStyle(Color(white: 1, opacity: 0.5))
                        if !session.credentialsPersisted {
                            Text("This device is not saving the sign-in, so the next launch will ask again.")
                                .font(.caption)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(Color(red: 0.95, green: 0.75, blue: 0.4))
                        }
                        Button("Sign out") {
                            Task { await session.signOut() }
                        }
                        .buttonStyle(CardButtonStyle())
                        .padding(.top, 8)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(40)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color(red: 0.12, green: 0.12, blue: 0.13))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color(white: 1, opacity: 0.08), lineWidth: 1)
                            )
                    )

                    // Keyed by account so a different sign-in loads its own
                    // list rather than standing on the last account's.
                    VaultSection()
                        .id(identity.email)
                }
                .padding(24)
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Sign-in flow

    private func startSignIn(provider: SocialProvider) {
        pendingProvider = provider
        signInError = nil

        let pkce = PKCE()
        // Prefix state with provider so tryluke.dev/sign-in can skip the
        // selection step — mirrors the desktop's "{provider}.{randomState}" convention.
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
                   asError.code == .canceledLogin { return }
                if let error {
                    signInError = error.localizedDescription
                    return
                }
                guard
                    let callbackURL,
                    let comps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                    let code = comps.queryItems?.first(where: { $0.name == "code" })?.value,
                    let returnedState = comps.queryItems?.first(where: { $0.name == "state" })?.value,
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

// MARK: - Provider button

private struct ProviderButton: View {
    let provider: SocialProvider
    let pending: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                mark
                    .frame(width: 16, height: 16)
                Text(pending ? "Opening…" : provider.label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.white)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 46)
        }
        .buttonStyle(CardButtonStyle())
    }

    @ViewBuilder
    private var mark: some View {
        switch provider {
        case .google: GoogleMark()
        case .github: GitHubMark().foregroundStyle(Color.white)
        }
    }
}

// MARK: - Button style (matches web AUTH_BUTTON)

private struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(configuration.isPressed
                          ? Color(white: 1, opacity: 0.06)
                          : Color(red: 0.12, green: 0.12, blue: 0.13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(white: 1, opacity: 0.10), lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
