import XCTest
@testable import NimbalystNative

/// M6.3 — the engine-direct data layer. Pins the pure pieces: the AgentTurn
/// transcript reducer (folding agent SSE events into a user+assistant turn)
/// and EngineStore's URL normalization + honest error copy. No live engine.
final class EngineStoreTests: XCTestCase {

    // MARK: - AgentTurn reducer

    func testTurnSeedsUserAndEmptyAssistant() {
        let turn = AgentTurn(prompt: "review my momentum strategy", turnId: "t1")
        XCTAssertEqual(turn.userMessage.role, "user")
        XCTAssertEqual(turn.userMessage.text, "review my momentum strategy")
        XCTAssertTrue(turn.userMessage.isComplete)
        XCTAssertEqual(turn.userMessage.id, "t1.user")

        XCTAssertEqual(turn.assistantMessage.role, "assistant")
        XCTAssertEqual(turn.assistantMessage.text, "")
        XCTAssertFalse(turn.assistantMessage.isComplete)
        XCTAssertEqual(turn.assistantMessage.id, "t1.assistant")
    }

    func testTurnFoldsStreamIntoGrowingAssistant() {
        var turn = AgentTurn(prompt: "hi", turnId: "t2")
        XCTAssertEqual(turn.apply(.start(model: "deepseek-chat"))?.model, "deepseek-chat")
        XCTAssertEqual(turn.apply(.delta("Momentum "))?.text, "Momentum ")
        XCTAssertEqual(turn.apply(.delta("looks fine."))?.text, "Momentum looks fine.")
        let done = turn.apply(.done(finishReason: "stop",
                                    usage: AgentUsage(promptTokens: nil, completionTokens: nil, totalTokens: 7)))
        XCTAssertEqual(done?.text, "Momentum looks fine.")
        XCTAssertTrue(done!.isComplete)
        XCTAssertEqual(done?.finishReason, "stop")
        XCTAssertEqual(done?.usageTotalTokens, 7)
        XCTAssertFalse(done!.isError)
    }

    func testTurnErrorMarksCompleteAndKeepsPartialText() {
        var turn = AgentTurn(prompt: "hi", turnId: "t3")
        _ = turn.apply(.delta("partial"))
        let errored = turn.apply(.error("stream interrupted — try again"))
        XCTAssertTrue(errored!.isComplete)
        XCTAssertTrue(errored!.isError)
        XCTAssertTrue(errored!.text.contains("partial"))
        XCTAssertTrue(errored!.text.contains("stream interrupted"))
    }

    // MARK: - EngineStore.normalizedBase

    func testNormalizedBaseConvertsWebSocketAndTrimsSlash() {
        XCTAssertEqual(EngineStore.normalizedBase("ws://192.168.1.5:1969/"), "http://192.168.1.5:1969")
        XCTAssertEqual(EngineStore.normalizedBase("wss://engine.example.com/"), "https://engine.example.com")
        XCTAssertEqual(EngineStore.normalizedBase("http://192.168.1.5:1969"), "http://192.168.1.5:1969")
    }

    // MARK: - EngineStore.friendlyMessage

    func testFriendlyMessageForEngineErrors() {
        XCTAssertEqual(EngineStore.friendlyMessage(for: EngineError.agentNeedsKey("Add your own AI key.")),
                       "Add your own AI key.")
        XCTAssertTrue(EngineStore.friendlyMessage(for: EngineError.unauthorized).localizedCaseInsensitiveContains("sign in"))
        XCTAssertTrue(EngineStore.friendlyMessage(for: EngineError.upstream).localizedCaseInsensitiveContains("temporarily"))
        XCTAssertTrue(EngineStore.friendlyMessage(for: EngineError.pairingInvalid).localizedCaseInsensitiveContains("expired"))
        XCTAssertTrue(EngineStore.friendlyMessage(for: EngineError.http(500)).contains("500"))
    }
}
