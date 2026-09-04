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
    @Environment(ProductEventSender.self) private var events
    @State private var pendingProvider: SocialProvider?
    @State private var signInError: String?
    @State private var contextProvider = WindowAnchorProvider()

    var body: some View {
        switch session.state {
        case .signedOut:
            signedOutCard
        case .signedIn(let identity):
            SignedInView(identity: identity)
        }
    }

    // MARK: - Signed-out card (matches web AUTH_CARD vocabulary)

    private var signedOutCard: some View {
        ZStack {
            Color.ground.ignoresSafeArea()
            VStack(spacing: 0) {
                // Luke face mark
                LukeMark()
                    .foregroundStyle(Color.ink)
                    .frame(width: 52)
                    .padding(.bottom, 16)

                Text("Sign in to Luke")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Color.ink)
                    .padding(.bottom, 8)

                if let error = signInError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Color.errorInk)
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
                    .fill(Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.cardStroke, lineWidth: 1)
                    )
                    .shadow(color: Color.cardShadow, radius: 40, y: 16)
            )
            .padding(24)
        }
    }

    // MARK: - Sign-in flow

    private func startSignIn(provider: SocialProvider) {
        pendingProvider = provider
        signInError = nil
        // Begun-versus-landed is the funnel; which provider is deliberately
        // not counted, the same omission the desktop makes.
        events.record(.accountAct(.signInStart))

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
        ) { [session, events] callbackURL, error in
            Task { @MainActor in
                defer { pendingProvider = nil }
                if let asError = error as? ASWebAuthenticationSessionError,
                   asError.code == .canceledLogin {
                    events.record(.accountAct(.signInCancel))
                    return
                }
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

// MARK: - Signed-in view

/// Its own struct so `profileShown` lives and dies with the signed-in
/// hierarchy: a sign-out tears the flag down with the view, and the next
/// sign-in starts with the sheet closed rather than inheriting a stale true.
private struct SignedInView: View {
    @Environment(AccountSession.self) private var session
    @Environment(ProductEventSender.self) private var events
    @Environment(PushCoordinator.self) private var push
    let identity: AccountIdentity
    @State private var profileShown = false
    /// The list's state and the stack above it, owned here so the voice
    /// screen can drive the same presses the list offers by hand, and torn
    /// down with the signed-in hierarchy like the profile flag.
    @State private var store = SessionsStore(
        rosterClient: RosterClient(serviceURL: AccountConstants.serviceURL)
    )

    var body: some View {
        @Bindable var store = store
        return NavigationStack(path: $store.path) {
            SessionsView()
                .toolbar {
                    if #available(iOS 26.0, *) {
                        ToolbarItem(placement: .topBarLeading) {
                            profileButton
                        }
                        // Separated from the bar's shared glass, which hugs an
                        // item as a capsule: the avatar's own circle is the
                        // whole control.
                        .sharedBackgroundVisibility(.hidden)
                    } else {
                        ToolbarItem(placement: .topBarLeading) {
                            profileButton
                        }
                    }
                }
        }
        .environment(store)
        .sheet(isPresented: $profileShown) {
            ProfileSheet(identity: identity)
        }
        .onChange(of: push.pendingOpen, initial: true) { _, open in
            guard let open else { return }
            Task { await answer(open) }
        }
    }

    /// A tapped notification opens the session it named, the same press its
    /// row takes, and only a session the roster reports: the tap carries an
    /// identity, never an address, so a session the roster no longer lists
    /// opens nothing. The roster is refreshed once first when the row is not
    /// yet on screen, since the notification usually arrives before the list
    /// has caught up.
    private func answer(_ open: PushOpen) async {
        defer { if push.pendingOpen == open { push.pendingOpen = nil } }
        if let found = session(matching: open) {
            store.openLeavingConversation(found)
            return
        }
        await store.refresh(account: session, events: events)
        if let found = session(matching: open) { store.openLeavingConversation(found) }
    }

    private func session(matching open: PushOpen) -> RosterSession? {
        store.sessions.first { $0.providerId == open.providerId && $0.sessionId == open.sessionId }
    }

    private var profileButton: some View {
        Button {
            profileShown = true
        } label: {
            avatarLabel
        }
        // Plain, not the toolbar's bordered default: with the shared
        // background hidden the bordered style still insets its label to
        // where the capsule's content would sit, holding the circle off the
        // bar margin the system's own circles start at.
        .buttonStyle(.plain)
        .accessibilityLabel("Account profile for \(identity.name ?? identity.email)")
    }

    /// The avatar in its own circular glass: the shared toolbar background is
    /// hidden because it hugs an item as a capsule, and this puts back the
    /// system material in the circle the photo actually is. The label fills
    /// the bar's own 44pt control size — anything smaller gets centered in
    /// the item's minimum slot and sits visibly right of where the system's
    /// circles sit.
    @ViewBuilder
    private var avatarLabel: some View {
        if #available(iOS 26.0, *) {
            AccountAvatar(identity: identity, diameter: 36)
                .padding(4)
                .glassEffect(.regular.interactive(), in: Circle())
        } else {
            AccountAvatar(identity: identity, diameter: 36)
                .padding(4)
        }
    }

}

// MARK: - Profile sheet

/// The account surface the header avatar opens, drawn with the system's own
/// sheet vocabulary — inline title, close button, grouped list: the photo
/// large at the top center, the account it belongs to, the provider keys,
/// and at the very bottom the one account act, signing out, over the build's
/// own version.
private struct ProfileSheet: View {
    @Environment(AccountSession.self) private var session
    @Environment(VaultStore.self) private var vault
    @Environment(ProductEventSender.self) private var events
    @Environment(PushRegistrar.self) private var pushRegistrar
    @Environment(\.dismiss) private var dismiss
    let identity: AccountIdentity
    @State private var editingProvider: VaultProviderID?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 12) {
                        AccountAvatar(identity: identity, diameter: 88)
                        VStack(spacing: 2) {
                            Text(identity.name ?? identity.email)
                                .font(.title2.weight(.semibold))
                            if identity.name != nil {
                                Text(identity.email)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                if !session.credentialsPersisted {
                    Section {
                        Text("This device is not saving the sign-in, so the next launch will ask again.")
                            .font(.footnote)
                            .foregroundStyle(Color.warningInk)
                    }
                }

                VaultSection(editing: $editingProvider)

                Section {
                    Button("Sign out", role: .destructive) {
                        Task {
                            // Flushed before the sign-out clears the token,
                            // or the act would wait for a sign-in to report.
                            events.record(.accountAct(.signOut))
                            await events.flush().value
                            // Forgotten on the service while this account's
                            // bearer still stands; the sign-out clears it.
                            await pushRegistrar.unregister()
                            await session.signOut()
                        }
                    }
                    .frame(maxWidth: .infinity)
                } footer: {
                    Text(Self.versionLabel)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
            }
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    closeButton
                }
            }
            // Keyed by account so a different sign-in loads its own list
            // rather than standing on the last account's.
            .task(id: identity.email) { await vault.load() }
            .sheet(item: $editingProvider) { provider in
                VaultKeyEditor(provider: provider)
            }
        }
    }

    @ViewBuilder
    private var closeButton: some View {
        if #available(iOS 26.0, *) {
            Button(role: .close) { dismiss() }
        } else {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
            }
            .accessibilityLabel("Close")
        }
    }

    private static let versionLabel: String = {
        let version = Bundle.main
            .object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return version.map { "Luke v\($0)" } ?? "Luke"
    }()
}

// MARK: - Avatar

/// The account's own avatar, falling back to its initials. A provider's
/// avatar URL can outlive the image it named, so a failed fetch draws the
/// letters rather than leaving a broken frame.
private struct AccountAvatar: View {
    let identity: AccountIdentity
    let diameter: CGFloat

    var body: some View {
        Group {
            if let url = identity.pictureURL {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initialsCircle
                    }
                }
            } else {
                initialsCircle
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
    }

    private var initialsCircle: some View {
        ZStack {
            Circle().fill(Color.ink.opacity(0.12))
            if let initials = identity.initials {
                Text(initials)
                    .font(.system(size: diameter * 0.4, weight: .semibold))
                    .foregroundStyle(Color.ink)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: diameter * 0.44))
                    .foregroundStyle(Color.inkSecondary)
            }
        }
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
                    .foregroundStyle(Color.ink)
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
        case .github: GitHubMark().foregroundStyle(Color.ink)
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
                    .fill(configuration.isPressed ? Color.pressedFill : Color.cardFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.controlStroke, lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
