import Foundation

/// What this app may count about its own use — a Swift transcription of the
/// vocabulary in `packages/analytics/src/product-events.ts`, which stays the
/// source of truth: the service reads every batch against that allowlist a
/// second time, so an entry here that drifts from it shows up as a refused
/// batch, never as a value that traveled. The shape keeps the guarantee the
/// TypeScript reader keeps by construction: every property value is an enum
/// case's raw value, a rung of the bucket ladder, or the build's own release
/// version, so a session title, a branch, or anything typed has no shape it
/// could travel in.

/// Every provider the shared vocabulary names (`PROVIDER_ID` in
/// `packages/session`). A roster row's provider id is read back through this
/// set before it may reach a count, so an id the vocabulary has not answered
/// for is left uncounted rather than sent to be refused.
public enum ProductProviderID: String, CaseIterable, Sendable {
    case claudeCode = "claude-code"
    case codex
    case conductor
    case omp
}

/// Where a Luke account stands after an act, never who the account is.
public enum ProductAccountAct: String, Sendable {
    case signInStart = "sign_in_start"
    case signInCancel = "sign_in_cancel"
    case signOut = "sign_out"
    case delete
}

/// Which act a session took, never what it carried.
public enum ProductSessionAct: String, Sendable {
    case messageSend = "message_send"
    case controlRun = "control_run"
    case sessionOpen = "session_open"
    case transcriptRead = "transcript_read"
    case workspaceCreate = "workspace_create"
    case workspaceRename = "workspace_rename"
    case sessionRename = "session_rename"
    case agentAdd = "agent_add"
}

/// The settings this app can change, of the shared vocabulary's
/// `APP_SETTING_ID`: the voice settings its sheet offers and nothing wider.
public enum ProductSettingID: String, Sendable {
    case voice
    case voiceSpeed = "voice_speed"
}

/// The shape a setting's new value is counted in, never the value itself:
/// whether a choice was made or returned to nothing is the whole of what
/// travels, so the voice chosen is not a property a count could carry.
public enum ProductSettingValue: String, Sendable {
    case on
    case off
    case set
    case cleared
}

/// The rungs every count travels on. A raw count is a weak fingerprint —
/// "137 Codex sessions" identifies a device across days — where a rung says
/// the same thing about adoption and says it about a crowd rather than a
/// person. Each rung is the smallest count that reaches it.
public enum ProductSessionCountBucket: Int, CaseIterable, Sendable {
    case none = 0
    case one = 1
    case few = 2
    case several = 5
    case many = 10
    case crowd = 25

    /// The highest rung a count reaches; anything below the first rung is none.
    public static func bucket(for count: Int) -> ProductSessionCountBucket {
        allCases.reversed().first { count >= $0.rawValue } ?? .none
    }
}

/// The events this app emits, of the shared vocabulary's thirty-odd: the
/// subset with an iOS act behind it. Each case carries exactly the properties
/// its event's allowlist row names, as values the types above bound — the
/// app version rides separately, supplied by the sender like the desktop
/// sender supplies it, so no call site holds a version string of its own.
public enum ProductEvent: Equatable, Sendable {
    case appLaunch
    case appDayActive
    case accountSignIn
    case accountAct(ProductAccountAct)
    case sessionObserve(provider: ProductProviderID, sessions: ProductSessionCountBucket)
    case sessionActSend(provider: ProductProviderID, act: ProductSessionAct)
    case settingUpdate(setting: ProductSettingID, value: ProductSettingValue)
    case settingsReset

    public var name: String {
        switch self {
        case .appLaunch: "app:launch"
        case .appDayActive: "app:day_active"
        case .accountSignIn: "account:sign_in"
        case .accountAct: "account:act"
        case .sessionObserve: "session:observe"
        case .sessionActSend: "session:act_send"
        case .settingUpdate: "setting:update"
        case .settingsReset: "settings:reset"
        }
    }

    /// The wire names of the shared vocabulary's properties.
    private enum Property {
        static let appVersion = "app_version"
        static let accountAct = "account_act"
        static let providerID = "provider_id"
        static let sessionCount = "session_count"
        static let sessionAct = "session_act"
        static let settingID = "setting_id"
        static let settingValue = "setting_value"
    }

    /// The properties the event's allowlist row names, in the wire's shape.
    func wireProperties(appVersion: String) -> [String: Any] {
        switch self {
        case .appLaunch, .appDayActive:
            [Property.appVersion: appVersion]
        case .accountSignIn:
            [:]
        case .accountAct(let act):
            [Property.accountAct: act.rawValue]
        case .sessionObserve(let provider, let sessions):
            [Property.providerID: provider.rawValue, Property.sessionCount: sessions.rawValue]
        case .sessionActSend(let provider, let act):
            [Property.providerID: provider.rawValue, Property.sessionAct: act.rawValue]
        case .settingUpdate(let setting, let value):
            [Property.settingID: setting.rawValue, Property.settingValue: value.rawValue]
        case .settingsReset:
            [:]
        }
    }
}
