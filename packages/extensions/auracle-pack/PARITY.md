# Panel parity inventory

Every user-reachable task on the current panel surface, taken from the shipped
code, not from the redesign document's memory of it. This list is the
acceptance backbone for the conversation-stage redesign: the old surface may
be deleted only when every task below marked **carried** or **subsumed** has a
tested path in the new panel, and every task marked **dropped** names the
decision that dropped it.

Dispositions:

- **carried** — the task survives with a working path in the new panel.
- **subsumed** — the task's outcome survives, reached by asking instead of
  operating a control.
- **dropped** — the task is deliberately gone; the decision is named.

The parity suite consumes this file: each row's id anchors at least one test,
and dropped rows are asserted absent.

## Panel chrome

| id | Task | Where today | Disposition | New path / decision |
|---|---|---|---|---|
| chrome-1 | Switch between the two panel faces (control and shortcut) | face segment in the panel header, keyboard shortcut | **dropped** | one surface remains; redesign deletion set |
| chrome-2 | Open the command palette (shortcut and hint line) | palette overlay, keyboard shortcut | **carried** | unchanged; the palette is deliberately kept |
| chrome-3 | Open any room by name from the palette | palette room entries | **carried** | unchanged; rooms become destinations |
| chrome-4 | See the open-alert count without opening the panel | rail button badge | **carried** | rail badge unchanged |

## Plan face

| id | Task | Where today | Disposition | New path / decision |
|---|---|---|---|---|
| plan-1 | Survey all rooms and districts with their health at a glance | floor-plan face | **subsumed** | header health line; expanding it lists faults with consequences |
| plan-2 | Open a room from its tile | tile click | **carried** | palette entry and card handoffs |
| plan-3 | Collapse or expand a district | district fold control | **dropped** | the floor plan it organized is deleted |
| plan-4 | Peek a room's summary on hover | hover peek | **dropped** | replaced by expand-in-place on cards, which is keyboard- and touch-reachable |
| plan-5 | Read per-room vitals on the plan | readings on tiles | **subsumed** | health line expansion; full detail lives in the room itself |
| plan-6 | Watch the agent's current run and its outcome on the plan | agent strip | **subsumed** | step list on the stage; outcome becomes an artifact card |
| plan-7 | Invoke an offered repair for a fault | repair button on the agent strip | **subsumed** | conversational repair path from the health line |
| plan-8 | Fire the one-button room action | room action bar | **subsumed** | asking in the conversation |

## Board face: canvas

| id | Task | Where today | Disposition | New path / decision |
|---|---|---|---|---|
| canvas-1 | Pan the working plane | drag on the canvas | **dropped** | the canvas is deleted; the stage is a list, not a plane |
| canvas-2 | Zoom in, out, or to fit (controls, wheel, double-click) | zoom cluster and gestures | **dropped** | nothing left to zoom |
| canvas-3 | Place a source card | placement buttons and ghost slots | **subsumed** | the agent stands up sources when asked to read something |
| canvas-4 | Place a research question card | placement buttons and ghost slots | **subsumed** | a sentence in the conversation is the question |
| canvas-5 | Place a live-quote card | placement button | **dropped** | the live-quote widget is deleted with the canvas; the card verb writes only sources and questions (the rest are written by the system), and a quote asked for is answered in the conversation rather than pinned to the stage |
| canvas-6 | Learn the empty board from ghost slots and the hint line | empty-state onboarding | **dropped** | the resting state opens on status, not on an empty canvas |

## Board face: wires

| id | Task | Where today | Disposition | New path / decision |
|---|---|---|---|---|
| wire-1 | Wire a source into a question by dragging | drag handle on the source card | **dropped** | provenance becomes a sentence on the artifact |
| wire-2 | Cut a wire | cut button on the routed wire | **dropped** | with the wires |
| wire-3 | Read which sources feed a question at rest | routed overlay | **subsumed** | the artifact's provenance line names its sources |

## Board face: cards and forms

| id | Task | Where today | Disposition | New path / decision |
|---|---|---|---|---|
| card-1 | Open a card's inline editor; close it by button, key, or click-away | card face and editor chrome | **dropped** | cards are records, not forms; detail is expand-in-place |
| card-2 | Name a source and describe where it reads from and what it carries | source form fields | **subsumed** | the agent fills the connector description |
| card-3 | Paste a secret into a write-only slot, or clear it | credential fields in the editor | **carried** | the one surviving input, relocated into the conversation flow; secrets stay write-only end to end |
| card-4 | Write or revise a question's hypothesis and options | research form | **subsumed** | said in the conversation; the scope line restates what was heard |
| card-5 | Delete a card and what hangs off it | delete row with its consequence summary | **subsumed** | asking; the consequence summary must still be shown before anything is removed |
| card-6 | Run a scan for new material on a question | per-card verb | **subsumed** | asking; the budget rules are unchanged |
| card-7 | Open an agent session on a question's gathered evidence | per-card verb | **subsumed** | asking from the card or the conversation |
| card-8 | Watch or unwatch a live quote, with its quality badge | quote card toggle | **dropped** | the watch toggle and its quality badge went with the quote widget; a quote read in the conversation carries its own freshness there, not on a panel card |
| card-9 | See a standing question's new-material count | card counter | **carried** | the watch list line in the resting state |
| card-10 | See what an agent action will spend before approving it | approval dialog | **carried** | unchanged, deliberately; capital and spend approvals are not redesigned |
| card-11 | Open a materialized strategy, test, or deploy artifact in its room | materialized card handoff | **carried** | unchanged; these cards were already records |
| card-12 | Read spend against the monthly budget | budget counters | **carried** | the activity ledger and the header |

## Notes for the suite

- Rows marked **carried** need a test exercising the new path end to end.
- Rows marked **subsumed** need a test proving the outcome is reachable by
  asking, including the guardrails the old control enforced (card-5's
  consequence summary, card-6's budget rules, card-3's write-only secrecy).
- Rows marked **dropped** are asserted absent, so a regression cannot
  resurrect half of one.
- The live-quote rows (canvas-5, card-8) are dropped, not subsumed onto the
  stage: nothing on this panel places, renders, or watches a quote. The card
  verb writes only sources and questions, and a quote asked for is answered in
  the conversation. The quote domain remains as library code, reached by no
  panel path, so the suite asserts the widget absent the same as any other
  dropped row (no quote artifact on the stage, and the live-quote hook mounted
  by nothing).
