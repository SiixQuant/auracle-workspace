import Foundation

// Auracle iOS spine, M6.3 — the pure transcript reducer.
//
// Folds the engine's agent SSE stream (AgentStreamEvent) into a two-message
// turn: the user's prompt (echoed immediately) and the assistant's reply,
// which grows delta-by-delta and completes on `done`. Deterministic and
// side-effect-free so it unit-tests in isolation — the cutover slice writes
// its output into GRDB `Message` rows (the transcript webview then renders
// them unchanged).

/// One rendered message in an agent turn. Shaped to map trivially onto the
/// app's GRDB `Message` (source/direction/contentDecrypted) at persist time.
public struct AgentTranscriptMessage: Sendable, Equatable, Identifiable {
    public var id: String
    public var role: String          // "user" | "assistant"
    public var text: String
    public var isComplete: Bool
    public var model: String?
    public var finishReason: String?
    public var usageTotalTokens: Int?
    public var isError: Bool

    public init(
        id: String, role: String, text: String, isComplete: Bool,
        model: String? = nil, finishReason: String? = nil,
        usageTotalTokens: Int? = nil, isError: Bool = false
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.isComplete = isComplete
        self.model = model
        self.finishReason = finishReason
        self.usageTotalTokens = usageTotalTokens
        self.isError = isError
    }
}

/// Accumulates one prompt→reply exchange. Create with the user's prompt,
/// then `apply` each `AgentStreamEvent`; the returned value is the current
/// assistant message (nil for events that don't change it).
public struct AgentTurn: Sendable {
    public let userMessage: AgentTranscriptMessage
    private var assistant: AgentTranscriptMessage

    public init(prompt: String, turnId: String) {
        self.userMessage = AgentTranscriptMessage(
            id: "\(turnId).user", role: "user", text: prompt, isComplete: true
        )
        self.assistant = AgentTranscriptMessage(
            id: "\(turnId).assistant", role: "assistant", text: "", isComplete: false
        )
    }

    /// The assistant message as it stands right now.
    public var assistantMessage: AgentTranscriptMessage { assistant }

    /// Apply one stream event; returns the updated assistant message when the
    /// event changed it, else nil (so callers only re-render on real change).
    @discardableResult
    public mutating func apply(_ event: AgentStreamEvent) -> AgentTranscriptMessage? {
        switch event {
        case .start(let model):
            assistant.model = model
            return assistant
        case .delta(let chunk):
            assistant.text += chunk
            return assistant
        case .done(let finishReason, let usage):
            assistant.isComplete = true
            assistant.finishReason = finishReason
            assistant.usageTotalTokens = usage?.totalTokens
            return assistant
        case .error(let message):
            // The stream dropped mid-flight. Keep whatever text arrived and
            // mark the turn complete + errored, so the UI stops the spinner
            // and shows an honest note rather than hanging.
            if !assistant.text.isEmpty { assistant.text += "\n\n" }
            assistant.text += "⚠︎ " + message
            assistant.isComplete = true
            assistant.isError = true
            return assistant
        }
    }
}
