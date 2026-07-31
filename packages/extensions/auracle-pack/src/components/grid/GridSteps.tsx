/**
 * Work in progress, as a short list of steps — never a spinner.
 *
 * The panel dispatches one operation at a time and learns exactly one thing
 * about it: it is running. So the list is honest about that — one current
 * step, named by what it is doing, marked with whether it costs anything —
 * rather than inventing a walk of sub-steps the client never actually sees.
 * The shape is a list because more steps can arrive (a future engine that
 * reports its own progression drops straight in), but nothing here fabricates
 * a step to fill the list out.
 *
 * When the work settles the list is gone: the outcome, or the artifact it
 * produced, is what remains. This surface is only for the interval in between.
 *
 * Cost is read from the action's class, which is a declared promise about
 * consequences: a mutation moves capital and is marked as such before it runs,
 * everything else runs without spending, and the mark is the "whether each one
 * costs anything" the redesign asks for.
 */
import type { AiRunState } from './gridAiActions';
import { ensurePanelKitStyles, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-grid-steps-styles';

export type StepStatus = 'done' | 'current' | 'pending';
export type StepCost = 'free' | 'capital';

export interface RunStep {
  label: string;
  status: StepStatus;
  cost: StepCost;
}

/**
 * The steps of the current run, or none when nothing is running. Pure, so the
 * list can be asserted without a DOM.
 */
export function runSteps(state: AiRunState): RunStep[] {
  if (!state.running) return [];
  return [
    {
      label: state.running.label,
      status: 'current',
      cost: state.running.class === 'mutation' ? 'capital' : 'free',
    },
  ];
}

const SHEET = `
.asteps { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.asteps__step { display: flex; align-items: baseline; gap: 9px; padding: 5px 10px; font-size: 12px; color: ${tone.text2}; }
.asteps__mark { flex: none; width: 8px; height: 8px; margin-top: 3px; border-radius: 999px; }
.asteps__mark[data-status='current'] { background: ${GRID_ACCENT}; }
.asteps__mark[data-status='done'] { background: ${tone.text3}; }
.asteps__mark[data-status='pending'] { border: 1px solid ${tone.border}; }
.asteps__label { flex: 1; min-width: 0; }
.asteps__cost { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; padding: 2px 7px; border-radius: 999px; }
.asteps__cost[data-cost='free'] { color: ${tone.text3}; }
.asteps__cost[data-cost='capital'] { color: ${tone.caution}; border: 1px solid ${tone.caution}; }
@media (prefers-reduced-motion: no-preference) {
  .asteps__mark[data-status='current'] { animation: asteps-pulse 1.4s ease-in-out infinite; }
}
@keyframes asteps-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
`;

function ensureStepStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

const COST_WORD: Record<StepCost, string> = {
  free: 'free',
  capital: 'approved capital action',
};

export function GridSteps({ state }: { state: AiRunState }): JSX.Element | null {
  ensurePanelKitStyles();
  ensureStepStyles();
  const steps = runSteps(state);
  if (steps.length === 0) return null;

  return (
    <ul className="asteps" data-testid="grid-steps">
      {steps.map((step, index) => (
        <li className="asteps__step" data-testid={`grid-step-${index}`} data-status={step.status} key={step.label}>
          <span className="asteps__mark" data-status={step.status} aria-hidden />
          <span className="asteps__label">{step.label}</span>
          <span className="asteps__cost" data-testid={`grid-step-cost-${index}`} data-cost={step.cost}>
            {COST_WORD[step.cost]}
          </span>
        </li>
      ))}
    </ul>
  );
}
