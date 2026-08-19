import Foundation

// Auracle iOS spine, M6.1 — the engine-direct API client.
//
// The phone talks DIRECTLY to the user's own Auracle engine (Houston,
// FastAPI) over the paired LAN URL, authenticated by a Clerk bearer token.
// This replaces the hosted-sync + Stytch + E2EE spine: no relay server, no
// desktop peer, no client-side crypto — a trusted local engine over HTTP,
// so data arrives as plain JSON.
//
// Every method maps 1:1 to a route the engine already serves (mobile API,
// engine PRs #362/#364/#365):
//   GET  /api/mobile/session                    -> who am I + plan
//   GET  /api/mobile/strategies                 -> the Auracle-folder list
//   GET  /api/mobile/strategies/{code}          -> one strategy's source
//   PUT  /api/mobile/strategies/{code}          -> save edited source
//   POST /api/mobile/agent/chat/stream (SSE)    -> run the agent, streamed
//   POST /api/mobile/pair/claim (unauth)        -> redeem a pairing token
//
// The struct is Sendable: a base URL plus a Sendable token closure (reads
// the Clerk JWT from the Keychain at call time), so it crosses actor
// boundaries freely.

// MARK: - DTOs (match the engine's JSON exactly)

public struct MobileSession: Decodable, Sendable, Equatable {
    public let signedIn: Bool
    public let email: String?
    public let tier: String?
    public let plan: String?
    public let picture: String?
    public let offline: Bool

    enum CodingKeys: String, CodingKey {
        case signedIn = "signed_in"
        case email, tier, plan, picture, offline
    }
}

public struct MobileStrategy: Decodable, Sendable, Equatable, Hashable, Identifiable {
    public var id: String { code }
    public let code: String
    public let path: String
    public let doc: String
    public let kind: String
    public let broker: String?
    public let dataSource: String?
    public let schedule: String?
    public let universeSize: Int

    enum CodingKeys: String, CodingKey {
        case code, path, doc, kind, broker, schedule
        case dataSource = "data"
        case universeSize = "universe_size"
    }
}

public struct MobileStrategyDetail: Decodable, Sendable, Equatable {
    public let code: String
    public let path: String
    public let doc: String
    public let source: String
}

public struct SaveStrategyResult: Decodable, Sendable, Equatable {
    public let ok: Bool
    public let code: String
    public let path: String
    public let bytes: Int
}

public struct PairClaimResult: Decodable, Sendable, Equatable {
    public let ok: Bool
    public let clerk: ClerkConfig

    public struct ClerkConfig: Decodable, Sendable, Equatable {
        public let configured: Bool
        public let issuer: String?
        public let clientId: String?

        enum CodingKeys: String, CodingKey {
            case configured, issuer
            case clientId = "client_id"
        }
    }
}

public struct AgentUsage: Decodable, Sendable, Equatable {
    public let promptTokens: Int?
    public let completionTokens: Int?
    public let totalTokens: Int?

    enum CodingKeys: String, CodingKey {
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case totalTokens = "total_tokens"
    }
}

/// One event off the agent's SSE reply. Mirrors the engine's wire format:
/// `start` (model chosen) -> `delta`* (streamed text) -> `done` (roll-up),
/// or `error` if the stream drops mid-flight.
public enum AgentStreamEvent: Sendable, Equatable {
    case start(model: String)
    case delta(String)
    case done(finishReason: String?, usage: AgentUsage?)
    case error(String)
}

// MARK: - Errors (map the engine's honest statuses)

public enum EngineError: Error, Sendable, Equatable {
    case notConfigured                 // no paired engine URL
    case unauthorized                  // 401 — bad/expired Clerk token
    case agentNeedsKey(String)         // 402 — no AI key on the engine
    case vaultSealed                   // 409 — paid tier, vault unavailable
    case pairingInvalid                // 410 — pairing token used/expired
    case upstream                      // 502 — model/provider down
    case http(Int)                     // any other non-2xx
    case badResponse                   // non-HTTP response
    case decoding(String)              // JSON didn't match a DTO
    case transport(String)             // URLSession failure

    public static func == (lhs: EngineError, rhs: EngineError) -> Bool {
        String(describing: lhs) == String(describing: rhs)
    }
}

// MARK: - SSE parsing (pure + unit-testable)

/// One dispatched Server-Sent-Events frame: an `event:` name plus the
/// accumulated `data:` payload. Pulled out of the client so the folding
/// logic can be tested without a socket.
public struct SSEFrame: Sendable, Equatable {
    public let event: String
    public let data: String
}

/// Incremental SSE line folder. Feed it raw lines (no trailing newline, a
/// blank line between frames — exactly what `URLSession.bytes.lines`
/// yields); it returns a frame when a blank line dispatches one.
public struct SSEParser: Sendable {
    private var eventName = "message"
    private var dataBuffer = ""

    public init() {}

    public mutating func push(_ line: String) -> SSEFrame? {
        if line.isEmpty {
            defer { eventName = "message"; dataBuffer = "" }
            guard !dataBuffer.isEmpty else { return nil }
            return SSEFrame(event: eventName, data: dataBuffer)
        }
        if line.hasPrefix(":") { return nil } // SSE comment / keep-alive
        if line.hasPrefix("event:") {
            eventName = String(line.dropFirst("event:".count))
                .trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            let chunk = String(line.dropFirst("data:".count))
                .trimmingCharacters(in: .whitespaces)
            dataBuffer = dataBuffer.isEmpty ? chunk : dataBuffer + "\n" + chunk
        }
        return nil
    }
}

/// Decode a dispatched frame into a typed agent event. Returns nil for
/// frames we don't model (forward-compatible with new event names).
public func decodeAgentEvent(_ frame: SSEFrame) -> AgentStreamEvent? {
    let data = Data(frame.data.utf8)
    switch frame.event {
    case "start":
        struct S: Decodable { let model: String }
        return (try? JSONDecoder().decode(S.self, from: data)).map { .start(model: $0.model) }
    case "delta":
        struct D: Decodable { let content: String }
        return (try? JSONDecoder().decode(D.self, from: data)).map { .delta($0.content) }
    case "done":
        struct Done: Decodable {
            let finishReason: String?
            let usage: AgentUsage?
            enum CodingKeys: String, CodingKey { case finishReason = "finish_reason"; case usage }
        }
        if let d = try? JSONDecoder().decode(Done.self, from: data) {
            return .done(finishReason: d.finishReason, usage: d.usage)
        }
        return .done(finishReason: nil, usage: nil)
    case "error":
        struct E: Decodable { let message: String }
        let msg = (try? JSONDecoder().decode(E.self, from: data))?.message ?? "stream error"
        return .error(msg)
    default:
        return nil
    }
}

// MARK: - Client

public struct EngineClient: Sendable {
    /// The paired engine's base URL, e.g. `http://192.168.1.42:1969`.
    public let baseURL: URL
    /// Supplies the current Clerk access token, or nil when signed out.
    public let token: @Sendable () -> String?
    private let urlSession: URLSession

    public init(
        baseURL: URL,
        token: @escaping @Sendable () -> String?,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.token = token
        self.urlSession = session
    }

    // MARK: Reads

    public func session() async throws -> MobileSession {
        try await get("/api/mobile/session")
    }

    public func strategies() async throws -> [MobileStrategy] {
        struct Wrapper: Decodable { let strategies: [MobileStrategy] }
        let w: Wrapper = try await get("/api/mobile/strategies")
        return w.strategies
    }

    public func strategy(code: String) async throws -> MobileStrategyDetail {
        try await get("/api/mobile/strategies/\(pathEscaped(code))")
    }

    // MARK: Writes

    public func saveStrategy(code: String, source: String) async throws -> SaveStrategyResult {
        struct Body: Encodable { let source: String }
        return try await send(
            "PUT", "/api/mobile/strategies/\(pathEscaped(code))",
            body: Body(source: source), auth: true
        )
    }

    // MARK: Pairing (unauthenticated — bootstraps the engine URL + Clerk config)

    /// Redeem a scanned pairing token against a not-yet-trusted engine URL.
    /// Static because it runs before an `EngineClient` is configured.
    public static func claimPairing(
        engineURL: URL, token: String, session: URLSession = .shared
    ) async throws -> PairClaimResult {
        struct Body: Encodable { let token: String }
        var req = URLRequest(url: engineURL.appending(path: "/api/mobile/pair/claim"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(Body(token: token))
        let (data, response) = try await dataCall(session, req)
        try checkStatus(response, data)
        return try decode(data)
    }

    // MARK: Agent (streamed)

    /// Run the Auracle Agent on the engine and stream its reply. All gates
    /// (auth, key, vault) surface as a thrown `EngineError` before the first
    /// event — an honest failure, never a silent dead stream. The stream ends
    /// on `.done` (or `.error` for a mid-flight drop).
    public func agentChatStream(
        prompt: String, strategyCode: String? = nil, model: String? = nil
    ) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    struct Body: Encodable {
                        let prompt: String
                        let strategyCode: String?
                        let model: String?
                        enum CodingKeys: String, CodingKey {
                            case prompt
                            case strategyCode = "strategy_code"
                            case model
                        }
                    }
                    var req = try self.request(
                        "POST", "/api/mobile/agent/chat/stream", auth: true
                    )
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.httpBody = try JSONEncoder().encode(
                        Body(prompt: prompt, strategyCode: strategyCode, model: model)
                    )
                    let (bytes, response) = try await self.urlSession.bytes(for: req)
                    try Self.checkStatus(response, nil)  // headers are in before the body streams
                    var parser = SSEParser()
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        guard let frame = parser.push(line),
                              let event = decodeAgentEvent(frame) else { continue }
                        continuation.yield(event)
                        if case .done = event { break }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: Self.wrap(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Plumbing

    private func request(_ method: String, _ path: String, auth: Bool) throws -> URLRequest {
        var req = URLRequest(url: baseURL.appending(path: path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if auth {
            guard let jwt = token() else { throw EngineError.unauthorized }
            req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        }
        return req
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let req = try request("GET", path, auth: true)
        let (data, response) = try await Self.dataCall(urlSession, req)
        try Self.checkStatus(response, data)
        return try Self.decode(data)
    }

    private func send<Body: Encodable, T: Decodable>(
        _ method: String, _ path: String, body: Body, auth: Bool
    ) async throws -> T {
        var req = try request(method, path, auth: auth)
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await Self.dataCall(urlSession, req)
        try Self.checkStatus(response, data)
        return try Self.decode(data)
    }

    private func pathEscaped(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private static func dataCall(
        _ session: URLSession, _ req: URLRequest
    ) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: req) }
        catch { throw EngineError.transport(error.localizedDescription) }
    }

    private static func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw EngineError.decoding(String(describing: error)) }
    }

    /// Map the engine's status codes onto typed errors. `body` is nil for the
    /// streaming path (we only have headers before the body flows).
    static func checkStatus(_ response: URLResponse, _ body: Data?) throws {
        guard let http = response as? HTTPURLResponse else { throw EngineError.badResponse }
        switch http.statusCode {
        case 200...299: return
        case 401: throw EngineError.unauthorized
        case 402:
            let msg = decodeAgentKeyMessage(body) ?? "Add an AI key on the engine to use the agent."
            throw EngineError.agentNeedsKey(msg)
        case 409: throw EngineError.vaultSealed
        case 410: throw EngineError.pairingInvalid
        case 502: throw EngineError.upstream
        default: throw EngineError.http(http.statusCode)
        }
    }

    /// The 402 body is `{detail: {error, message}}` — pull the human message.
    private static func decodeAgentKeyMessage(_ body: Data?) -> String? {
        guard let body else { return nil }
        struct Envelope: Decodable { struct Detail: Decodable { let message: String? }; let detail: Detail? }
        return (try? JSONDecoder().decode(Envelope.self, from: body))?.detail?.message
    }

    private static func wrap(_ error: Error) -> Error {
        if error is EngineError { return error }
        if error is CancellationError { return error }
        return EngineError.transport(error.localizedDescription)
    }
}
