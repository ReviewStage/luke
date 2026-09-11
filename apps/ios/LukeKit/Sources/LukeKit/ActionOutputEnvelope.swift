import Foundation

/// What became of an action, as its tool's output envelope says —
/// `ACTION_OUTPUT_STATUS` in `@sidecar/actions`. Unknown is its own word:
/// the action was dispatched and its answer lost, so it may have happened
/// and is never read as a refusal.
public enum ActionOutputStatus: String, Sendable {
    case accepted
    case unknown
    case refused
}

/// The target as it stood when the action ran — `ActionTargetSnapshot` in
/// `@sidecar/actions`. A row composes from the call's arguments and this
/// snapshot alone, so the title a session wore before it was renamed or
/// archived is here rather than looked up from a roster that has moved on.
public struct ActionTargetSnapshot: Equatable, Sendable {
    public let providerId: String
    public let providerSessionId: String?
    public let title: String?
    public let agentId: String?
    public let controlKind: RosterSessionControlKind?
    public let controlLabel: String?
    public let applicationId: String?

    public init(
        providerId: String,
        providerSessionId: String? = nil,
        title: String? = nil,
        agentId: String? = nil,
        controlKind: RosterSessionControlKind? = nil,
        controlLabel: String? = nil,
        applicationId: String? = nil
    ) {
        self.providerId = providerId
        self.providerSessionId = providerSessionId
        self.title = title
        self.agentId = agentId
        self.controlKind = controlKind
        self.controlLabel = controlLabel
        self.applicationId = applicationId
    }

    /// The identifiers stay required and exact, because an effect hangs on
    /// them; the fields a row would draw are dropped when malformed rather
    /// than refusing the snapshot, the rule `ACTION_OUTPUT` keeps.
    init?(json: JSONValue) {
        guard let providerId = json["providerId"]?.stringValue, !providerId.isEmpty else { return nil }
        if let sessionId = json["providerSessionId"], sessionId.stringValue?.isEmpty != false {
            return nil
        }
        self.init(
            providerId: providerId,
            providerSessionId: json["providerSessionId"]?.stringValue,
            title: json["title"]?.stringValue,
            agentId: json["agentId"]?.stringValue,
            controlKind: json["controlKind"]?.stringValue.flatMap(RosterSessionControlKind.init(rawValue:)),
            controlLabel: json["controlLabel"]?.stringValue,
            applicationId: json["applicationId"]?.stringValue
        )
    }
}

/// The one shape every action tool answers in — `ActionOutputEnvelope` in
/// `@sidecar/actions`: what became of the action, the target as the roster
/// held it, and the one identifier a creation named.
public enum ActionOutputEnvelope: Equatable, Sendable {
    case accepted(
        target: ActionTargetSnapshot?,
        createdSession: SessionIdentity?,
        note: String?,
        warning: String?
    )
    case unknown(reason: String, target: ActionTargetSnapshot?)
    case refused(reason: String, target: ActionTargetSnapshot?)

    public var status: ActionOutputStatus {
        switch self {
        case .accepted: .accepted
        case .unknown: .unknown
        case .refused: .refused
        }
    }

    public var target: ActionTargetSnapshot? {
        switch self {
        case .accepted(let target, _, _, _), .unknown(_, let target), .refused(_, let target):
            target
        }
    }

    /// Why a refused or unknown action ended as it did; an accepted one has no reason to give.
    public var reason: String? {
        switch self {
        case .accepted: nil
        case .unknown(let reason, _), .refused(let reason, _): reason
        }
    }

    /// Reads a tool part's output as the envelope, or nothing when the
    /// output is not one: a key a later build added is ignored, and a target
    /// that does not read back drops rather than refusing what became of the
    /// action.
    public init?(json: JSONValue) {
        guard let status = json["status"]?.stringValue.flatMap(ActionOutputStatus.init(rawValue:)) else {
            return nil
        }
        let target = json["target"].flatMap(ActionTargetSnapshot.init(json:))
        switch status {
        case .accepted:
            let created = json["createdSession"].flatMap(SessionIdentity.init(json:))
            self = .accepted(
                target: target,
                createdSession: created,
                note: json["note"]?.stringValue,
                warning: json["warning"]?.stringValue
            )
        case .unknown:
            guard let reason = json["reason"]?.stringValue else { return nil }
            self = .unknown(reason: reason, target: target)
        case .refused:
            guard let reason = json["reason"]?.stringValue else { return nil }
            self = .refused(reason: reason, target: target)
        }
    }
}
