/**
 * How the rooms are wired to each other, and which of them is faulted.
 *
 * A room page ends with the rooms its work FLOWS INTO or came from, because a
 * plan you can only leave through the breadcrumb is a plan you have to hold in
 * your head. The edges here are the same ones the plan draws between rooms, so
 * the chip row and the sheet can never disagree about what is connected to what.
 *
 * Kept out of `rooms.tsx` on purpose: that table declares WHAT a room is (id,
 * name, page), this one declares HOW rooms relate — and the two change for
 * different reasons.
 */
import type { BacktestPhase } from '../../engine/backtestStore';
import type { RoomId } from './rooms';

/** Each room's outbound edges, in the order the chip row lists them. */
export const WIRED_TO: Record<RoomId, RoomId[]> = {
  findings: ['strategies', 'qc'],
  qc: ['findings', 'backtest'],
  strategies: ['backtest', 'findings'],
  backtest: ['validation', 'deploys', 'strategies'],
  validation: ['backtest', 'deploys'],
  deploys: ['incidents', 'blotter', 'schedules', 'runway'],
  blotter: ['deploys'],
  incidents: ['deploys'],
  schedules: ['deploys'],
  runway: ['deploys', 'conns'],
  conns: ['deploys', 'qc'],
};

/**
 * The rooms that currently hold a fault, from signals the pack already keeps.
 *
 * Two sources, both facts rather than judgments:
 *  - an OPEN INCIDENT is the engine's own word that something running needs a
 *    decision, so it flags both the room that lists incidents and the room that
 *    holds the deployments they are about (the same feed the rail badges);
 *  - a backtest that FAILED or could not reach the engine flags the Backtest
 *    room, because its page is where that failure is explained.
 *
 * A room with no fault signal today is simply never flagged — an unflagged chip
 * claims nothing, where a green one would claim it had been checked.
 *
 * Pure so the mapping is unit-testable without a renderer or a live engine.
 */
export function faultedRooms(openAlerts: number, backtestPhase: BacktestPhase): Set<RoomId> {
  const faulted = new Set<RoomId>();
  if (openAlerts > 0) {
    faulted.add('incidents');
    faulted.add('deploys');
  }
  if (backtestPhase === 'failed' || backtestPhase === 'engine-down') faulted.add('backtest');
  return faulted;
}
