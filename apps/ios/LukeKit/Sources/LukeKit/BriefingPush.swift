import Foundation

/// What a briefing's notification carries beside the words the lock screen
/// drew: the pushed message's id, under `BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID`
/// in `@sidecar/hosted`. A tap reads that one key and nothing else of the
/// payload — the words were the screen's to show and stand on the record
/// already — and refuses an id outside the wire's own UUID shape, so a
/// payload this build did not send opens the Conversation nowhere in
/// particular rather than at a string of someone else's choosing.
public struct BriefingPushTap: Equatable, Sendable {
    /// `BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID`.
    public static let messageIdKey = "messageId"

    public let messageId: String

    public init?(userInfo: [AnyHashable: Any]) {
        guard let messageId = userInfo[Self.messageIdKey] as? String, DeviceClient.isWireId(messageId) else {
            return nil
        }
        self.messageId = messageId
    }
}

extension PushEnvironment {
    private static let entitlementsKey = "Entitlements"
    private static let gatewayEntitlement = "aps-environment"
    private static let developmentGateway = "development"

    /// Which gateway issued this build's tokens, read from the entitlements
    /// inside the embedded provisioning profile: `development` is the sandbox
    /// gateway's, anything else production's, and a build with no readable
    /// profile at all — an App Store install, whose profile the store strips —
    /// is production. The profile is a signed envelope around a plist, and the
    /// plist is cut out of the envelope's text rather than the signature
    /// verified, since nothing here trusts it for more than which gateway to
    /// name: a token named to the wrong one is refused by Apple itself.
    public static func fromProvisioningProfile(_ profile: Data?) -> PushEnvironment {
        guard let profile,
              let text = String(data: profile, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>", range: start.upperBound ..< text.endIndex),
              let plist = String(text[start.lowerBound ..< end.upperBound]).data(using: .isoLatin1),
              let object = try? PropertyListSerialization.propertyList(from: plist, format: nil),
              let entitlements = (object as? [String: Any])?[entitlementsKey] as? [String: Any],
              let gateway = entitlements[gatewayEntitlement] as? String
        else { return .production }
        return gateway == developmentGateway ? .sandbox : .production
    }
}
