/**
 * The pack's agent-callable tools — the Board, in the agent's hands.
 *
 * Two hands on one surface. Everything a person can do to the Board from the
 * canvas, the agent can do from the conversation, through the SAME store: there
 * is no agent-only path into the graph, no second set of rules, and no state
 * either of them can reach that the other cannot see.
 *
 * ## What the schemas guarantee
 *  - the credential slot is WRITE-ONLY. No tool takes a secret value and none
 *    returns one; the schemas name `credential_slot` and nothing else, and
 *    {@link ./engine/boardTools} refuses a value-shaped field by name rather
 *    than dropping it quietly.
 *  - every tool is DRAFT class. Cards, wires and questions are a drawing of the
 *    work. Nothing here reaches an order, a deployment lifecycle, or any other
 *    capital verb — those stay behind the engine's declared-and-approved lane,
 *    which no board tool touches.
 *  - `scope: 'global'`, because the Board is not a file. The host's default is
 *    editor scope, which would hide these behind whatever document happened to
 *    be open.
 *  - `access: { kind: 'filesystem' }` — no editor is mounted, nothing is read
 *    from or written to a document. The Board's transport is the engine
 *    settings lane, which the store owns.
 *
 * ## Around each call
 * A tool call ensures the Board is open (a mutation against a closed Board
 * would land in a snapshot nobody saves) and flushes after a mutation, so a
 * tool that says it placed a card has placed one that outlives the session.
 */
import type { ExtensionAITool, ExtensionToolResult } from '@nimbalyst/extension-sdk';
import { findNode } from './engine/boardGraph';
import { boardGraphStore } from './engine/boardGraphStore';
import { cardView, upstreamChain } from './engine/boardEnvelope';
import {
  boardCreateCard,
  boardDeleteCard,
  boardList,
  boardReadOutputs,
  boardUnwire,
  boardUpdateCard,
  boardWire,
  ensureBoardOpen,
  flushBoard,
  type BoardToolOutcome,
} from './engine/boardTools';
import { agentSessionHost } from './components/grid/gridAiExecutors';

/** Turn one outcome into what the host hands the agent. */
function result(outcome: BoardToolOutcome): ExtensionToolResult {
  return outcome.ok
    ? { success: true, message: outcome.message, data: outcome.data }
    : { success: false, error: outcome.error };
}

/** A read: open the Board if nothing has, then answer. */
async function read(
  workspacePath: string | undefined,
  run: () => BoardToolOutcome
): Promise<ExtensionToolResult> {
  await ensureBoardOpen(workspacePath ?? '');
  return result(run());
}

/** A write: the same, plus carrying the edit out to the lane before answering. */
async function write(
  workspacePath: string | undefined,
  run: () => BoardToolOutcome
): Promise<ExtensionToolResult> {
  await ensureBoardOpen(workspacePath ?? '');
  const outcome = run();
  if (outcome.ok) await flushBoard();
  return result(outcome);
}

/* ── the card configuration schema, written once ─────────────────────────── */

const CONFIG_FIELDS = {
  name: { type: 'string' as const, description: 'Display name for a source card.' },
  connector_kind: {
    type: 'string' as const,
    description: 'How the data arrives: feed, http_api, file_drop or database.',
  },
  endpoint: {
    type: 'string' as const,
    description: 'Where the data comes from — URL, host, or provider-specific locator.',
  },
  payload_type: {
    type: 'string' as const,
    description: 'What arrives — bars, ticks, news, provider-specific.',
  },
  credential_slot: {
    type: 'string' as const,
    description:
      'NAME of the vault slot this source reads its key from. Never a key, a token or any ' +
      'other secret value: those are typed into the card by the person who owns them, and no ' +
      'tool accepts one.',
  },
  hypothesis: {
    type: 'string' as const,
    description: 'The question a research card asks, in plain words.',
  },
};

const CONFIG_PROPERTY = {
  type: 'object' as const,
  description:
    'Named fields for the card. A source takes name, connector_kind, endpoint, payload_type ' +
    'and credential_slot; a research card takes hypothesis. Any other field is refused.',
  properties: CONFIG_FIELDS,
};

const POSITION_PROPERTY = {
  type: 'object' as const,
  description: 'Optional canvas position. Omit and the Board places the card itself.',
  properties: { x: { type: 'number' as const }, y: { type: 'number' as const } },
};

/* ── the one-conversation flow's last step ───────────────────────────────── */

/**
 * The prompt a scan request opens a session with.
 *
 * It names the card, its question and the sources wired into it, so the session
 * starts on the same lane the Board is showing rather than on a topic re-typed
 * from memory.
 */
export function boardScanPrompt(nodeId: string): string | null {
  const graph = boardGraphStore.getSnapshot().graph;
  const node = findNode(graph, nodeId);
  if (!node || node.kind !== 'research') return null;
  const sources = upstreamChain(graph, nodeId)
    .filter((row) => row.kind === 'source')
    .map((row) => cardView(row).config?.name || row.id);
  const question = node.research?.hypothesis?.trim() ?? '';
  return [
    `Scan for research on the Board card ${nodeId}.`,
    question ? `The question is: "${question}".` : 'The card carries no question yet.',
    sources.length > 0
      ? `It is wired to ${sources.length === 1 ? 'the source' : 'the sources'} ${sources.join(', ')}.`
      : 'Nothing is wired into it yet, so it has no source to read.',
    '',
    'Read those sources through the Auracle engine and report what you find against that ' +
      'question. Do not draft a strategy, run anything, or deploy anything.',
  ].join('\n');
}

/**
 * Start a scan for a research card.
 *
 * TODO(#132): the card's own Scan verb and its `boardResearch` client are being
 * built alongside this change, and that verb is the single path a scan should
 * take — one lane the canvas button and this tool both call, so the two can
 * never start a scan two different ways. Until it lands this tool dispatches
 * through the agent-session lane the pack already has
 * ({@link ../components/grid/gridAiExecutors}), which is honest about what it
 * did: a session is opened with the prompt in it, and no scan has run until the
 * agent is sent. When #132 lands, replace the body below with a call to that
 * verb and keep this tool's name and schema exactly as they are.
 */
async function dispatchScan(nodeId: string): Promise<ExtensionToolResult> {
  const prompt = boardScanPrompt(nodeId);
  if (prompt === null) {
    return { success: false, error: 'That research card is not on the Board.' };
  }
  const host = agentSessionHost();
  if (!host?.launchAgentSession) {
    return {
      success: false,
      error:
        'This build cannot start a scan from a tool — open the Auracle panel, or update the ' +
        'IDE. Nothing was started.',
    };
  }
  const outcome = await host.launchAgentSession(prompt, { title: 'Scan a research card' });
  if (!outcome.ok) {
    return { success: false, error: outcome.error ?? 'The scan hand-off failed.' };
  }
  return {
    success: true,
    // Dispatch, not delivery — the same wording the pack's other hand-off uses,
    // and for the same reason: a session exists, findings do not.
    message:
      'A session is open with the scan prompt in it. Review it and send it — nothing has been ' +
      'scanned yet.',
    data: { node_id: nodeId, dispatched: true },
  };
}

/* ── the tools ───────────────────────────────────────────────────────────── */

export const boardAiTools: ExtensionAITool[] = [
  {
    name: 'board_list',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      "Read the workspace's Board: every card, every wire, and how the graph is doing. Source " +
      'cards report the NAME of their vault slot and never whether it holds anything. ' +
      'Materialized cards (strategy, test, deploy) carry a reference to an engine artifact, ' +
      'never a copy of it.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_params, context) => read(context.workspacePath, boardList),
  },
  {
    name: 'board_create_card',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Place a card on the Board. Only source and research cards are placed by hand; strategy, ' +
      'test and deploy cards are written by the system when real work produces an artifact. ' +
      'Returns the card id everything else addresses it by.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['source', 'research'],
          description: 'source for something to read; research for a question to ask of it.',
        },
        config: CONFIG_PROPERTY,
        position: POSITION_PROPERTY,
      },
      required: ['kind'],
    },
    handler: async (params, context) =>
      write(context.workspacePath, () => boardCreateCard(params)),
  },
  {
    name: 'board_update_card',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Edit a source or research card in place. A field that is not part of the card is ' +
      'refused rather than ignored — including anything shaped like a credential value, which ' +
      'never travels through a tool.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The card to edit.' },
        config: CONFIG_PROPERTY,
        label: { type: 'string', description: 'Short display label. Empty string clears it.' },
      },
      required: ['node_id'],
    },
    handler: async (params, context) =>
      write(context.workspacePath, () => boardUpdateCard(params)),
  },
  {
    name: 'board_wire',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Wire a source card into a research card, so the question is asked of that data. Only ' +
      'source-to-research wires are drawable: the downstream wires are provenance the system ' +
      'writes when an artifact appears.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'The source card id.' },
        to: { type: 'string', description: 'The research card id.' },
      },
      required: ['from', 'to'],
    },
    handler: async (params, context) => write(context.workspacePath, () => boardWire(params)),
  },
  {
    name: 'board_unwire',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Cut a wire drawn between two cards. A provenance wire — the system-written one that ' +
      'records where a strategy or a run came from — refuses, because cutting it would make ' +
      'the Board lie about where the work came from.',
    inputSchema: {
      type: 'object',
      properties: { edge_id: { type: 'string', description: 'The wire id, from board_list.' } },
      required: ['edge_id'],
    },
    handler: async (params, context) => write(context.workspacePath, () => boardUnwire(params)),
  },
  {
    name: 'board_delete_card',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Remove a card from the Board, or with preview:true say what removing it would do ' +
      'without doing it. Either way the answer states what STAYS: only the named card and its ' +
      'own wires go, and everything downstream remains, still pointing at engine artifacts ' +
      'that no board action destroys.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The card to remove.' },
        preview: {
          type: 'boolean',
          description: 'True to report the plan and change nothing. Defaults to false.',
        },
      },
      required: ['node_id'],
    },
    handler: async (params, context) =>
      params.preview === true
        ? read(context.workspacePath, () => boardDeleteCard(params))
        : write(context.workspacePath, () => boardDeleteCard(params)),
  },
  {
    name: 'board_read_outputs',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'What a card is answerable for: the artifacts it and everything downstream of it point ' +
      'at, by kind and id, plus the chain of cards feeding it. References only — read the ' +
      'artifacts themselves through the engine.',
    inputSchema: {
      type: 'object',
      properties: { node_id: { type: 'string', description: 'The card to read.' } },
      required: ['node_id'],
    },
    handler: async (params, context) =>
      read(context.workspacePath, () => boardReadOutputs(params)),
  },
  {
    name: 'board_scan_card',
    scope: 'global',
    access: { kind: 'filesystem' },
    description:
      'Start the scan for a research card, reading whatever sources are wired into it. This ' +
      'DISPATCHES: a session opens with the scan prompt in it and nothing has been scanned ' +
      'until it is sent.',
    inputSchema: {
      type: 'object',
      properties: { node_id: { type: 'string', description: 'The research card to scan for.' } },
      required: ['node_id'],
    },
    handler: async (params, context) => {
      await ensureBoardOpen(context.workspacePath ?? '');
      const nodeId = typeof params.node_id === 'string' ? params.node_id.trim() : '';
      if (!nodeId) return { success: false, error: 'node_id is required.' };
      return dispatchScan(nodeId);
    },
  },
];

export const aiTools = boardAiTools;
