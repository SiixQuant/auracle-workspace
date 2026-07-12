import Foundation

// Auracle iOS spine, M6.3 — the engine-direct data layer.
//
// The single place the app reads/writes strategies and runs the agent against
// the paired engine. Additive: it stands beside the sync-era managers until
// the cutover slice points the SwiftUI gate at it. Construction pulls the
// paired engine URL + Clerk bearer straight from the Keychain.

@MainActor
public final class EngineStore: ObservableObject {
    private let engine: EngineClient

    @Published public private(set) var strategies: [MobileStrategy] = []
    @Published public private(set) var isLoading = false
    @Published public var loadError: String?

    public init(engine: EngineClient) {
        self.engine = engine
    }

    /// Build a store from the paired engine URL + Clerk token in the Keychain.
    /// Returns nil when the device isn't paired yet (no engine URL).
    public static func configured() -> EngineStore? {
        guard let raw = KeychainManager.getServerUrl(),
              let url = URL(string: normalizedBase(raw)) else { return nil }
        let engine = EngineClient(baseURL: url, token: { KeychainManager.getClerkAccessToken() })
        return EngineStore(engine: engine)
    }

    /// ws(s):// → http(s):// (the engine-direct pairing URL is http, but a
    /// legacy sync URL might be ws), trailing slash stripped.
    nonisolated static func normalizedBase(_ s: String) -> String {
        var out = s
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }

    // MARK: Strategies

    public func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            strategies = try await engine.strategies()
            loadError = nil
        } catch {
            loadError = Self.friendlyMessage(for: error)
        }
    }

    public func source(for code: String) async throws -> String {
        try await engine.strategy(code: code).source
    }

    @discardableResult
    public func save(code: String, source: String) async throws -> SaveStrategyResult {
        try await engine.saveStrategy(code: code, source: source)
    }

    // MARK: Agent

    /// Run the agent against the engine and stream a two-message turn: the
    /// user's prompt (echoed at once) followed by the assistant reply as it
    /// grows. A thrown engine error (no key / signed out / provider down) is
    /// surfaced as an in-band errored assistant message, so the transcript
    /// stops the spinner and reads honestly instead of hanging.
    public func run(
        prompt: String, strategyCode: String?, turnId: String = UUID().uuidString
    ) -> AsyncThrowingStream<AgentTranscriptMessage, Error> {
        let engine = self.engine
        return AsyncThrowingStream { continuation in
            let task = Task {
                var turn = AgentTurn(prompt: prompt, turnId: turnId)
                continuation.yield(turn.userMessage)
                continuation.yield(turn.assistantMessage)   // empty → spinner
                do {
                    for try await event in engine.agentChatStream(
                        prompt: prompt, strategyCode: strategyCode
                    ) {
                        if let msg = turn.apply(event) { continuation.yield(msg) }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    turn.apply(.error(Self.friendlyMessage(for: error)))
                    continuation.yield(turn.assistantMessage)
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Error copy

    nonisolated static func friendlyMessage(for error: Error) -> String {
        guard let e = error as? EngineError else { return error.localizedDescription }
        switch e {
        case .notConfigured: return "This phone isn't paired to an engine yet."
        case .unauthorized: return "Your session expired — sign in again."
        case .agentNeedsKey(let msg): return msg
        case .vaultSealed: return "The engine's key vault is locked. Unlock it on your Mac."
        case .pairingInvalid: return "That pairing code was already used or expired."
        case .upstream: return "The agent is temporarily unavailable. Try again."
        case .http(let code): return "The engine returned an unexpected error (\(code))."
        case .badResponse: return "The engine sent an unexpected response."
        case .decoding: return "Couldn't read the engine's response."
        case .transport(let msg): return "Couldn't reach the engine: \(msg)"
        }
    }
}
