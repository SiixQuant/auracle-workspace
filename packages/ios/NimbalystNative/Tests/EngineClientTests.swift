import XCTest
@testable import NimbalystNative

/// M6.1 — the engine-direct API client. Pins the wire contract with the
/// merged mobile API (engine PRs #362/#364/#365): DTO decoding, SSE folding
/// + event decoding, and the honest status-code mapping. Pure logic — no
/// socket, no live engine.
final class EngineClientTests: XCTestCase {

    private func decode<T: Decodable>(_ json: String, as _: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: - DTO wire contract

    func testMobileSessionDecodesSnakeCase() throws {
        let s = try decode(
            #"{"signed_in":true,"email":"g@x.com","tier":"pro","plan":"pro","picture":null,"offline":false}"#,
            as: MobileSession.self)
        XCTAssertTrue(s.signedIn)
        XCTAssertEqual(s.email, "g@x.com")
        XCTAssertEqual(s.plan, "pro")
        XCTAssertNil(s.picture)
        XCTAssertFalse(s.offline)
    }

    func testMobileStrategyRemapsDataAndUniverseSize() throws {
        let s = try decode(
            #"{"code":"momentum","path":"strategies.desk.momentum.Momentum","doc":"A momentum strategy","kind":"class","broker":"ibkr","data":"yfinance","schedule":null,"universe_size":12}"#,
            as: MobileStrategy.self)
        XCTAssertEqual(s.code, "momentum")
        XCTAssertEqual(s.id, "momentum")
        XCTAssertEqual(s.dataSource, "yfinance")   // JSON "data" -> dataSource
        XCTAssertEqual(s.universeSize, 12)         // JSON "universe_size"
        XCTAssertNil(s.schedule)
    }

    func testStrategyDetailAndSaveResult() throws {
        let d = try decode(
            #"{"code":"m","path":"strategies.desk.m.M","doc":"","source":"class M:\n    pass\n"}"#,
            as: MobileStrategyDetail.self)
        XCTAssertTrue(d.source.contains("class M"))
        let r = try decode(
            #"{"ok":true,"code":"m","path":"strategies.desk.m.M","bytes":42}"#,
            as: SaveStrategyResult.self)
        XCTAssertTrue(r.ok)
        XCTAssertEqual(r.bytes, 42)
    }

    func testPairClaimResultDecodesClerkConfig() throws {
        let r = try decode(
            #"{"ok":true,"clerk":{"configured":true,"issuer":"https://x.clerk.accounts.dev","client_id":"cid_pub"}}"#,
            as: PairClaimResult.self)
        XCTAssertTrue(r.ok)
        XCTAssertTrue(r.clerk.configured)
        XCTAssertEqual(r.clerk.issuer, "https://x.clerk.accounts.dev")
        XCTAssertEqual(r.clerk.clientId, "cid_pub")   // JSON "client_id"
    }

    func testPairClaimHonestWhenClerkUnconfigured() throws {
        let r = try decode(
            #"{"ok":true,"clerk":{"configured":false,"issuer":null,"client_id":null}}"#,
            as: PairClaimResult.self)
        XCTAssertFalse(r.clerk.configured)
        XCTAssertNil(r.clerk.issuer)
    }

    // MARK: - SSE folding

    func testSSEParserFoldsEventAndDataOnBlankLine() {
        var p = SSEParser()
        XCTAssertNil(p.push("event: delta"))
        XCTAssertNil(p.push(#"data: {"content":"hi"}"#))
        let frame = p.push("")
        XCTAssertEqual(frame, SSEFrame(event: "delta", data: #"{"content":"hi"}"#))
    }

    func testSSEParserIgnoresKeepAliveComment() {
        var p = SSEParser()
        XCTAssertNil(p.push(": keep-alive"))
        XCTAssertNil(p.push(""))   // nothing buffered -> no frame
    }

    func testSSEParserAccumulatesMultilineData() {
        var p = SSEParser()
        _ = p.push("event: done")
        _ = p.push("data: line1")
        _ = p.push("data: line2")
        let frame = p.push("")
        XCTAssertEqual(frame?.data, "line1\nline2")
    }

    // MARK: - Event decoding

    func testDecodeStartDeltaDoneError() {
        XCTAssertEqual(
            decodeAgentEvent(SSEFrame(event: "start", data: #"{"model":"deepseek-chat"}"#)),
            .start(model: "deepseek-chat"))
        XCTAssertEqual(
            decodeAgentEvent(SSEFrame(event: "delta", data: #"{"content":"tok"}"#)),
            .delta("tok"))
        XCTAssertEqual(
            decodeAgentEvent(SSEFrame(event: "error", data: #"{"message":"boom"}"#)),
            .error("boom"))
        if case .done(let reason, let usage)? =
            decodeAgentEvent(SSEFrame(event: "done",
                data: #"{"model":"deepseek-chat","finish_reason":"stop","usage":{"total_tokens":7}}"#)) {
            XCTAssertEqual(reason, "stop")
            XCTAssertEqual(usage?.totalTokens, 7)
        } else {
            XCTFail("expected .done")
        }
        XCTAssertNil(decodeAgentEvent(SSEFrame(event: "unknown_future", data: "{}")))
    }

    /// The exact byte stream the engine emits, folded end-to-end.
    func testFullAgentStreamFold() {
        let lines = [
            "event: start",  #"data: {"model":"deepseek-chat"}"#, "",
            "event: delta",  #"data: {"content":"Momentum "}"#, "",
            "event: delta",  #"data: {"content":"looks fine."}"#, "",
            "event: done",   #"data: {"model":"deepseek-chat","finish_reason":"stop","usage":{"total_tokens":7}}"#, "",
        ]
        var p = SSEParser()
        var events: [AgentStreamEvent] = []
        for line in lines {
            if let frame = p.push(line), let ev = decodeAgentEvent(frame) { events.append(ev) }
        }
        XCTAssertEqual(events, [
            .start(model: "deepseek-chat"),
            .delta("Momentum "),
            .delta("looks fine."),
            .done(finishReason: "stop", usage: AgentUsage(promptTokens: nil, completionTokens: nil, totalTokens: 7)),
        ])
    }

    // MARK: - Status mapping

    func testCheckStatusMapsHonestCodes() throws {
        let url = URL(string: "http://127.0.0.1:1969/api/mobile/session")!
        func resp(_ code: Int) -> HTTPURLResponse {
            HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: nil)!
        }
        XCTAssertNoThrow(try EngineClient.checkStatus(resp(200), nil))
        XCTAssertThrowsError(try EngineClient.checkStatus(resp(401), nil)) {
            XCTAssertEqual($0 as? EngineError, .unauthorized)
        }
        XCTAssertThrowsError(try EngineClient.checkStatus(resp(409), nil)) {
            XCTAssertEqual($0 as? EngineError, .vaultSealed)
        }
        XCTAssertThrowsError(try EngineClient.checkStatus(resp(410), nil)) {
            XCTAssertEqual($0 as? EngineError, .pairingInvalid)
        }
        XCTAssertThrowsError(try EngineClient.checkStatus(resp(502), nil)) {
            XCTAssertEqual($0 as? EngineError, .upstream)
        }
        XCTAssertThrowsError(try EngineClient.checkStatus(resp(418), nil)) {
            XCTAssertEqual($0 as? EngineError, .http(418))
        }
    }

    func testCheckStatus402CarriesEngineMessage() {
        let url = URL(string: "http://127.0.0.1:1969/api/mobile/agent/chat")!
        let body = Data(#"{"detail":{"error":"agent_requires_key","message":"Add your own AI key on the desktop to use the agent."}}"#.utf8)
        XCTAssertThrowsError(try EngineClient.checkStatus(
            HTTPURLResponse(url: url, statusCode: 402, httpVersion: nil, headerFields: nil)!, body)) {
            guard case EngineError.agentNeedsKey(let msg) = $0 else { return XCTFail("expected agentNeedsKey") }
            XCTAssertTrue(msg.contains("AI key"))
        }
    }
}
