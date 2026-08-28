import CryptoKit
import XCTest

@testable import LukeKit

final class PKCETests: XCTestCase {
    func testVerifierLength() {
        let pkce = PKCE()
        // base64url of 64 bytes = 86 chars; RFC 7636 requires 43–128
        XCTAssertGreaterThanOrEqual(pkce.verifier.count, 43)
        XCTAssertLessThanOrEqual(pkce.verifier.count, 128)
    }

    func testVerifierCharset() {
        let pkce = PKCE()
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        // base64url uses A-Z a-z 0-9 - _ (subset of RFC 7636 unreserved)
        XCTAssertTrue(pkce.verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    func testChallengeLength() {
        let pkce = PKCE()
        // SHA-256 produces 32 bytes → 43 base64url chars
        XCTAssertEqual(pkce.challenge.count, 43)
    }

    func testNoPaddingInChallenge() {
        let pkce = PKCE()
        XCTAssertFalse(pkce.challenge.contains("="))
    }

    /// RFC 7636 Appendix B known vector.
    func testKnownVector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        XCTAssertEqual(PKCE.challenge(for: verifier), expected)
    }
}
