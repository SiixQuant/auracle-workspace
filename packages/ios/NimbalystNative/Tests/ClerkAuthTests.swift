import XCTest
@testable import NimbalystNative

/// M6.2 — Clerk PKCE sign-in. Pins the OAuth plumbing (PKCE derivation,
/// authorize-URL shape, token exchange body, JWT email pull) against known
/// vectors. All pure/static — no browser, no live Clerk.
final class ClerkAuthTests: XCTestCase {

    // MARK: - PKCE

    /// RFC 7636 Appendix B test vector — the canonical S256 pair.
    func testPKCEChallengeMatchesRFC7636Vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        XCTAssertEqual(PKCE.challenge(for: verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertEqual(PKCE(verifier: verifier).challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testPKCEGenerateIsUrlSafeAndCorrectlySized() {
        let a = PKCE.generate()
        let b = PKCE.generate()
        XCTAssertNotEqual(a.verifier, b.verifier)          // fresh each time
        XCTAssertEqual(a.verifier.count, 43)               // 32 bytes base64url, unpadded
        XCTAssertEqual(a.challenge.count, 43)              // SHA256 digest, base64url
        let banned = CharacterSet(charactersIn: "+/=")
        XCTAssertNil(a.verifier.rangeOfCharacter(from: banned))
        XCTAssertNil(a.challenge.rangeOfCharacter(from: banned))
    }

    func testBase64URLEncodingStripsPaddingAndSwapsChars() {
        // 0xFB 0xFF 0xFE -> base64 "+//+", base64url "-__-" (no padding).
        XCTAssertEqual(Data([0xFB, 0xFF, 0xFE]).base64URLEncodedString(), "-__-")
    }

    // MARK: - Authorize URL

    func testAuthorizeURLCarriesPKCEAndClient() throws {
        let url = try XCTUnwrap(ClerkOAuth.authorizeURL(
            issuer: URL(string: "https://clerk.auracle-engine.com")!,
            clientId: "cid_pub", challenge: "CHALLENGE", state: "STATE"))
        let comps = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(comps.path, "/oauth/authorize")
        let q = Dictionary(uniqueKeysWithValues: (comps.queryItems ?? []).map { ($0.name, $0.value) })
        XCTAssertEqual(q["response_type"], "code")
        XCTAssertEqual(q["client_id"], "cid_pub")
        XCTAssertEqual(q["code_challenge"], "CHALLENGE")
        XCTAssertEqual(q["code_challenge_method"], "S256")
        XCTAssertEqual(q["state"], "STATE")
        XCTAssertEqual(q["redirect_uri"], ClerkOAuth.redirectURI)
    }

    // MARK: - Token exchange body

    func testFormURLEncodedProducesAuthCodeGrant() {
        let body = ClerkOAuth.formURLEncoded([
            "grant_type": "authorization_code",
            "code": "abc",
            "client_id": "cid",
            "code_verifier": "ver",
        ])
        let s = String(data: body, encoding: .utf8)!
        let pairs = Set(s.split(separator: "&").map(String.init))
        XCTAssertTrue(pairs.contains("grant_type=authorization_code"))
        XCTAssertTrue(pairs.contains("code=abc"))
        XCTAssertTrue(pairs.contains("client_id=cid"))
        XCTAssertTrue(pairs.contains("code_verifier=ver"))
    }

    // MARK: - Token response + JWT

    func testTokenResponseDecodes() throws {
        let t = try JSONDecoder().decode(
            ClerkTokenResponse.self,
            from: Data(#"{"access_token":"jwt.a.b","refresh_token":"r","expires_in":86400,"token_type":"Bearer"}"#.utf8))
        XCTAssertEqual(t.accessToken, "jwt.a.b")
        XCTAssertEqual(t.refreshToken, "r")
        XCTAssertEqual(t.expiresIn, 86400)
    }

    func testEmailFromJWTPullsClaim() {
        let payload = Data(#"{"email":"g@aurapointcapital.com","sub":"user_1"}"#.utf8).base64URLEncodedString()
        let jwt = "header.\(payload).signature"
        XCTAssertEqual(ClerkOAuth.emailFromJWT(jwt), "g@aurapointcapital.com")
    }

    func testEmailFromJWTNilForNonJWT() {
        XCTAssertNil(ClerkOAuth.emailFromJWT("not-a-jwt"))
        let noEmail = Data(#"{"sub":"user_1"}"#.utf8).base64URLEncodedString()
        XCTAssertNil(ClerkOAuth.emailFromJWT("h.\(noEmail).s"))
    }
}
