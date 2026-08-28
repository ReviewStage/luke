import AuthenticationServices
import LukeKit
import SwiftUI
import UIKit

// MARK: - Act client (shared singleton for the app lifetime)

private let sharedActClient = ActClient(baseURL: AccountConstants.serviceURL)

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

// MARK: - Signed-in view

/// Its own struct so `profileShown` lives and dies with the signed-in
/// hierarchy: a sign-out tears the flag down with the view, and the next
/// sign-in starts with the sheet closed rather than inheriting a stale true.
private struct SignedInView: View {
    @Environment(AccountSession.self) private var session
    let identity: AccountIdentity
    @State private var profileShown = false
    /// Flipped by the sessions list once its first fetch has answered,
    /// success or failure alike, so the loading screen can never outlive the
    /// load it stands for.
    @State private var firstLoadDone = false

    var body: some View {
        ZStack {
            // Hidden from assistive tech and inert while the loading screen
            // stands: the overlay covers only the visual surface, and
            // VoiceOver or Full Keyboard Access would otherwise still reach
            // the controls behind it and could open the profile sheet
            // under the loader.
            signedInContent
                .accessibilityHidden(!firstLoadDone)
                .disabled(!firstLoadDone)
            // The app's own loading screen: Luke humming over the ground
            // until the first roster answer, standing over the whole surface
            // rather than inside any one component. It marks only time the
            // fetch is already spending, and stands down the moment the
            // answer lands. The whole screen leaves the safe area, not just
            // its ground, so the face centres between the device's physical
            // edges rather than sitting low in the asymmetric safe-area
            // window the notch and home indicator leave.
            if !firstLoadDone {
                ZStack {
                    Color.ground
                    LukeLoadingFace()
                        .foregroundStyle(Color.ink)
                        .frame(width: 120)
                }
                .ignoresSafeArea()
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: firstLoadDone)
    }

    private var signedInContent: some View {
        NavigationStack {
            SessionsView(firstLoadDone: $firstLoadDone)
                .navigationTitle("Sessions")
                .navigationBarTitleDisplayMode(.inline)
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
        .sheet(isPresented: $profileShown) {
            ProfileSheet(identity: identity)
        }
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
    @Environment(\.dismiss) private var dismiss
    let identity: AccountIdentity
    @State private var editingProvider: VaultProviderID?
    @State private var showingWriteDemo = false

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

                // Write-path verification panel. The read path surfaces
                // session and project identifiers from the roster; until then
                // this panel lets the developer try the act endpoints directly.
                Section {
                    Button {
                        showingWriteDemo.toggle()
                    } label: {
                        Label(
                            showingWriteDemo ? "Hide act demo" : "Try act endpoints",
                            systemImage: "arrow.up.message"
                        )
                        .font(.system(size: 14))
                    }
                    if showingWriteDemo {
                        WriteDemoPanel(actClient: sharedActClient)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    }
                } header: {
                    Text("Developer")
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        Task { await session.signOut() }
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

// MARK: - Write-path verification panel

/// Lets the developer try the act endpoints directly before the read-path
/// roster is built. Enter a session id or project id from Conductor's dashboard
/// and send a message or create a workspace.
private struct WriteDemoPanel: View {
    let actClient: ActClient

    @State private var sessionId = ""
    @State private var projectId = ""
    @State private var selectedTab = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("", selection: $selectedTab) {
                Text("Message").tag(0)
                Text("Workspace").tag(1)
            }
            .pickerStyle(.segmented)

            if selectedTab == 0 {
                VStack(alignment: .leading, spacing: 8) {
                    DemoField(label: "Conductor session ID", text: $sessionId)
                    SessionComposerView(
                        providerId: "conductor",
                        providerSessionId: sessionId,
                        actClient: actClient
                    )
                    .disabled(sessionId.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(sessionId.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    DemoField(label: "Conductor project ID", text: $projectId)
                    WorkspaceCreatorView(
                        providerId: "conductor",
                        providerProjectId: projectId,
                        actClient: actClient
                    )
                    .disabled(projectId.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(projectId.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
                }
            }
        }
    }
}

private struct DemoField: View {
    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.inkSecondary)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 14, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.cardFill)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(Color.controlStroke, lineWidth: 1)
                        )
                )
        }
    }
}
