/**
 * How the rooms are wired to each other.
 *
 * A room page ends with the rooms its work FLOWS INTO or came from, because a
 * plan you can only leave through the breadcrumb is a plan you have to hold in
 * your head. These edges are the flow the sheet's districts are grouped by, so
 * the chip row and the plan never disagree about what feeds what.
 *
 * Kept out of `rooms.tsx` on purpose: that table declares WHAT a room is (id,
 * name, page) and `districts.ts` declares WHERE it sits; this declares HOW
 * rooms relate — three things that change for three different reasons.
 *
 * A chip's fault flag is deliberately NOT derived here. It is read from
 * `gridVitals`, the same readings the sheet's dots are drawn from, so a room
 * the plan calls faulted is flagged identically wherever it is named.
 */
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
