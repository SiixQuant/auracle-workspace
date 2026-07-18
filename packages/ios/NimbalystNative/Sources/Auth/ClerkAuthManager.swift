import Foundation
import CryptoKit
import Security
import os
#if os(iOS)
import AuthenticationServices
#endif

// Auracle iOS spine, M6.2 — Clerk sign-in, engine-direct.
//
// Replaces the Stytch `AuthManager`: the phone runs the OAuth 2.0 PKCE dance
// (RFC 8252 native-app pattern) directly against Clerk in a system browser
// via ASWebAuthenticationSession, gets a Clerk access token, and uses it as
// the bearer to the engine's /api/mobile/* routes (the engine verifies it
// offline via JWKS). No server round-trip owns the flow, no client secret
// ships — a public client with PKCE.
//
// The issuer + client id come from pairing (`PairClaimResult.clerk`), so the
// phone signs in against whatever Clerk instance its engine is wired to.
//
// Published surface mirrors `AuthManager` (isAuthenticated / email /
// isAuthenticating / authError) so the SwiftUI gate can swap managers with
// minimal change at cutover.

// MARK: - PKCE (pure + testable)

/// An OAuth 2.0 PKCE pair. `challenge` = BASE64URL(SHA256(verifier)), the
/// S256 method every modern IdP expects.
public struct PKCE: Sendable, Equatable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String) {
        self.verifier = verifier
        self.challenge = PKCE.challenge(for: verifier)
    }

    /// Derive the S256 challenge for a verifier (RFC 7636 §4.2).
    public static func challenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest).base64URLEncodedString()
    }

    /// A fresh pair with a 32-byte (43-char base64url) random verifier.
    public static func generate() -> PKCE {
        PKCE(verifier: randomURLSafe(byteCount: 32))
    }

    static func randomURLSafe(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        return Data(bytes).base64URLEncodedString()
    }
}

extension Data {
    /// base64url without padding (RFC 4648 §5) — the OAuth/JWT encoding.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - Token response

public struct ClerkTokenResponse: Decodable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresIn: Int?
    public let tokenType: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
    }
}

public enum ClerkAuthError: Error, Sendable, Equatable {
    case notConfigured        // no issuer/client id from pairing yet
    case stateMismatch        // callback state didn't match (possible CSRF)
    case missingCode
    case exchangeFailed(String)
}

// MARK: - OAuth plumbing (pure, nonisolated, testable)

/// The stateless OAuth 2.0 + PKCE mechanics, kept out of the @MainActor
/// manager so they're callable from any context (and from tests).
public enum ClerkOAuth {
    /// The callback scheme the OAuth redirect uses. Matches the app's URL
    /// scheme (renamed nimbalyst→auracle in the M6/M7 cutover).
    public static let callbackScheme = "auracle"
    public static let redirectURI = "auracle://oauth-callback"

    static func authorizeURL(issuer: URL, clientId: String, challenge: String, state: String) -> URL? {
        var comps = URLComponents(url: issuer.appending(path: "/oauth/authorize"), resolvingAgainstBaseURL: false)
        comps?.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "scope", value: "openid profile email"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        return comps?.url
    }

    static func exchangeCode(
        issuer: URL, clientId: String, code: String, verifier: String,
        session: URLSession = .shared
    ) async throws -> ClerkTokenResponse {
        var req = URLRequest(url: issuer.appending(path: "/oauth/token"))
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = formURLEncoded([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirectURI,
            "client_id": clientId,
            "code_verifier": verifier,
        ])
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await session.data(for: req) }
        catch { throw ClerkAuthError.exchangeFailed(error.localizedDescription) }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw ClerkAuthError.exchangeFailed("HTTP \(status)")
        }
        do { return try JSONDecoder().decode(ClerkTokenResponse.self, from: data) }
        catch { throw ClerkAuthError.exchangeFailed("bad token response") }
    }

    static func formURLEncoded(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        // Explicit String typing + concatenation: GRDB is @_exported module-
        // wide, and its `SQL` is ExpressibleByStringInterpolation, so a bare
        // "\(k)=\(v)" here would infer as `SQL`, not `String`.
        let pairs: [String] = params.map { (k: String, v: String) -> String in
            let ek: String = k.addingPercentEncoding(withAllowedCharacters: allowed) ?? k
            let ev: String = v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v
            return ek + "=" + ev
        }
        let body: String = pairs.joined(separator: "&")
        return Data(body.utf8)
    }

    /// Best-effort email pull from the access token's JWT claims (Clerk tokens
    /// are JWTs). Returns nil if the token isn't a JWT or has no email — the
    /// engine's /api/mobile/session is the authoritative source either way.
    static func emailFromJWT(_ jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64) else { return nil }
        struct Claims: Decodable { let email: String? }
        return (try? JSONDecoder().decode(Claims.self, from: data))?.email
    }
}

// MARK: - Manager

@MainActor
public final class ClerkAuthManager: ObservableObject {
    private let logger = Logger(subsystem: "com.auracle.app", category: "ClerkAuth")

    @Published public var isAuthenticated: Bool = false
    @Published public var email: String?
    @Published public var isAuthenticating: Bool = false
    @Published public var authError: String?

    #if os(iOS)
    private var authSession: ASWebAuthenticationSession?
    #endif
    private var pending: Pending?

    private struct Pending {
        let pkce: PKCE
        let state: String
        let issuer: URL
        let clientId: String
    }

    /// The bearer the engine client uses. nil when signed out.
    public var accessToken: String? { KeychainManager.getClerkAccessToken() }

    public init() {
        isAuthenticated = KeychainManager.hasClerkSession()
        email = KeychainManager.getClerkEmail()
    }

    // MARK: Sign in

    #if os(iOS)
    /// Begin Clerk sign-in against the paired engine's Clerk instance.
    /// `issuer` + `clientId` come from `PairClaimResult.clerk`.
    public func signIn(issuer: String, clientId: String) {
        guard !isAuthenticating else { return }
        authError = nil

        guard let issuerURL = URL(string: issuer.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
              !clientId.isEmpty else {
            authError = "This engine isn't configured for sign-in yet."
            return
        }

        let pkce = PKCE.generate()
        let state = PKCE.randomURLSafe(byteCount: 16)
        pending = Pending(pkce: pkce, state: state, issuer: issuerURL, clientId: clientId)

        guard let authorizeURL = ClerkOAuth.authorizeURL(
            issuer: issuerURL, clientId: clientId, challenge: pkce.challenge, state: state
        ) else {
            authError = "Couldn't build the sign-in request."
            return
        }

        isAuthenticating = true
        let session = ASWebAuthenticationSession(
            url: authorizeURL, callbackURLScheme: ClerkOAuth.callbackScheme
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.isAuthenticating = false
                self.authSession = nil
                if let error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        return  // user dismissed — not an error to surface
                    }
                    self.authError = error.localizedDescription
                    return
                }
                guard let callbackURL else { self.authError = "No callback received"; return }
                self.handleCallback(callbackURL)
            }
        }
        session.presentationContextProvider = ASWebAuthPresentationContext.shared
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }
    #endif

    /// Handle the `auracle://oauth-callback?code=…&state=…` redirect.
    public func handleCallback(_ url: URL) {
        guard let pending else { authError = "No sign-in in progress"; return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let params = Dictionary(uniqueKeysWithValues: items.compactMap { i -> (String, String)? in
            i.value.map { (i.name, $0) }
        })

        if let err = params["error"] {
            self.pending = nil
            authError = "Sign-in failed: \(err)"
            return
        }
        guard params["state"] == pending.state else {
            self.pending = nil
            authError = "Sign-in couldn't be verified. Please try again."
            return
        }
        guard let code = params["code"] else {
            self.pending = nil
            authError = "Sign-in didn't return an authorization code."
            return
        }

        let p = pending
        self.pending = nil
        Task { await exchange(code: code, pending: p) }
    }

    private func exchange(code: String, pending p: Pending) async {
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            let token = try await ClerkOAuth.exchangeCode(
                issuer: p.issuer, clientId: p.clientId,
                code: code, verifier: p.pkce.verifier
            )
            let email = ClerkOAuth.emailFromJWT(token.accessToken)
            try KeychainManager.storeClerkSession(
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                email: email
            )
            self.email = email
            self.isAuthenticated = true
            self.authError = nil
        } catch {
            let msg = (error as? ClerkAuthError).map { String(describing: $0) } ?? error.localizedDescription
            self.authError = "Couldn't complete sign-in (\(msg))."
        }
    }

    public func logout() {
        KeychainManager.deleteClerkSession()
        isAuthenticated = false
        email = nil
        authError = nil
    }
}
