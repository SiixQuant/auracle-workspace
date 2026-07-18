import Foundation
import Combine

// Auracle iOS spine, M6 cutover — the app's root state.
//
// Replaces the sync-era AppState: no CryptoManager, no SyncManager, no
// desktop peer. The whole app is three states — pair, sign in, use — over
// the engine-direct foundation (ClerkAuthManager + EngineStore). Pairing
// exchanges a scanned code for the engine URL + the Clerk config; sign-in is
// PKCE against that Clerk; then EngineStore talks to the paired engine with
// the Clerk bearer.

@MainActor
public final class AuracleSession: ObservableObject {
    public let auth = ClerkAuthManager()

    @Published public private(set) var isPaired: Bool
    @Published public private(set) var isAuthenticated: Bool
    @Published public private(set) var store: EngineStore?
    @Published public var pairError: String?
    @Published public var isPairing = false

    private var bag = Set<AnyCancellable>()

    public init() {
        isPaired = KeychainManager.getServerUrl() != nil && KeychainManager.getClerkIssuer() != nil
        isAuthenticated = KeychainManager.hasClerkSession()
        store = isPaired ? EngineStore.configured() : nil

        // Mirror the auth manager so the gate reacts, and re-emit its UI
        // changes (isAuthenticating / authError) to observers of the session.
        auth.$isAuthenticated
            .receive(on: RunLoop.main)
            .sink { [weak self] signedIn in
                guard let self else { return }
                self.isAuthenticated = signedIn
                if signedIn { Task { await self.store?.refresh() } }
            }
            .store(in: &bag)
        auth.objectWillChange
            .sink { [weak self] in self?.objectWillChange.send() }
            .store(in: &bag)
    }

    // MARK: - Pairing

    /// Pair from a scanned `auracle://pair?u=<engineURL>&t=<token>` payload.
    public func pair(qrPayload: String) async {
        guard let (engineURL, token) = Self.parsePairPayload(qrPayload) else {
            pairError = "That doesn't look like an Auracle pairing code."
            return
        }
        await claim(engineURLString: engineURL, token: token)
    }

    /// Pair from a manually-typed engine URL + pairing code.
    public func pairManual(engineURL: String, token: String) async {
        let url = engineURL.trimmingCharacters(in: .whitespaces)
        let code = token.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, !code.isEmpty else {
            pairError = "Enter both your engine address and pairing code."
            return
        }
        await claim(engineURLString: url, token: code)
    }

    private func claim(engineURLString: String, token: String) async {
        isPairing = true
        defer { isPairing = false }
        let base = EngineStore.normalizedBase(engineURLString)
        guard let url = URL(string: base), url.host != nil else {
            pairError = "That engine address isn't a valid URL."
            return
        }
        do {
            let result = try await EngineClient.claimPairing(engineURL: url, token: token)
            guard result.ok else { pairError = "The engine rejected that pairing code."; return }
            try KeychainManager.storeServerUrl(base)
            try KeychainManager.storeClerkConfig(issuer: result.clerk.issuer, clientId: result.clerk.clientId)
            store = EngineStore.configured()
            isPaired = true
            pairError = nil
        } catch {
            pairError = EngineStore.friendlyMessage(for: error)
        }
    }

    /// `auracle://pair?u=<engineURL>&t=<token>` → (engineURL, token).
    static func parsePairPayload(_ payload: String) -> (String, String)? {
        guard let comps = URLComponents(string: payload),
              comps.scheme == "auracle", comps.host == "pair" else { return nil }
        let items = comps.queryItems ?? []
        guard let u = items.first(where: { $0.name == "u" })?.value,
              let t = items.first(where: { $0.name == "t" })?.value,
              !u.isEmpty, !t.isEmpty else { return nil }
        return (u, t)
    }

    // MARK: - Auth

    /// Start Clerk sign-in against the paired engine's Clerk instance.
    public func signIn() {
        #if os(iOS)
        guard let issuer = KeychainManager.getClerkIssuer(),
              let clientId = KeychainManager.getClerkClientId() else {
            auth.authError = "This engine isn't configured for sign-in."
            return
        }
        auth.signIn(issuer: issuer, clientId: clientId)
        #endif
    }

    public func signOut() {
        auth.logout()
    }

    /// Forget the engine + sign out — a clean handoff of the device.
    public func unpair() {
        auth.logout()
        KeychainManager.deleteAll()
        store = nil
        isPaired = false
        pairError = nil
    }

    // MARK: - Lifecycle

    /// Refresh strategies when the app returns to the foreground.
    public func onForeground() {
        guard isAuthenticated else { return }
        Task { await store?.refresh() }
    }

    // MARK: - Deep links

    /// Route `auracle://…` — the OAuth callback and Camera-app pairing links.
    public func handleDeepLink(_ url: URL) {
        guard url.scheme == "auracle" else { return }
        switch url.host {
        case "oauth-callback":
            auth.handleCallback(url)
        case "pair":
            Task { await pair(qrPayload: url.absoluteString) }
        default:
            break
        }
    }
}
