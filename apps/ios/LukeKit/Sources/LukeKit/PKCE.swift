import CryptoKit
import Foundation
import Security

/// PKCE verifier/challenge pair per RFC 7636.
public struct PKCE {
    /// 86-character base64url-encoded random verifier (unreserved charset, length 43–128).
    public let verifier: String
    /// S256 challenge: SHA-256(verifier bytes) base64url-encoded without padding.
    public let challenge: String

    public init() {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let v = Data(bytes).base64URLEncoded()
        verifier = v
        challenge = PKCE.challenge(for: v)
    }

    /// Derives the S256 challenge for an arbitrary verifier string (for testing).
    public static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
    }
}

extension DataProtocol {
    func base64URLEncoded() -> String {
        Data(self)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
