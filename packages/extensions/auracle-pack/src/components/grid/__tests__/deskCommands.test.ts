import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setDeskCatalogueForTest, runnableDeskCommands } from '../../../engine/deskCatalogue';
import { deskCommandsNote } from '../deskCommands';
import { filterCommands, listCommands } from '../gridCommands';
import type { GridVitals } from '../../../engine/gridVitals';

/**
 * The desk's commands, on the desktop.
 *
 * The list itself is the engine's and is tested there. What matters here is
 * that this surface offers exactly what may be offered, and says the right
 * thing when it has nothing — an engine that is merely OLD must not read as a
 * desk that can do nothing.
 */

const VITALS = {} as GridVitals;

const READY = {
  status: 'ready' as const,
  utilities: [{ id: 'see', name: 'See', blurb: 'Read the desk' }],
  commands: [
    { id: 'running', label: 'Running', hint: 'what is deployed', utility: 'see', origin: 'auracle', available: true, prompt: "What's running right now?" },
    { id: 'dcf', label: 'DCF', hint: 'value a company', utility: 'research', origin: 'langalpha', available: false },
  ],
};

describe('what the palette is offered', () => {
  beforeEach(() => __setDeskCatalogueForTest({ status: 'unread' }));

  it('offers built commands and withholds the rest', () => {
    __setDeskCatalogueForTest(READY);
    expect(runnableDeskCommands().map((c) => c.id)).toEqual(['running']);
  });

  it('withholds a command that carries no question', () => {
    // A palette RUNS what you pick. A row that asks nothing is a dead control.
    __setDeskCatalogueForTest({
      ...READY,
      commands: [{ ...READY.commands[0]!, prompt: undefined }],
    });
    expect(runnableDeskCommands()).toHaveLength(0);
  });

  it('offers nothing at all before the engine has answered', () => {
    expect(runnableDeskCommands()).toHaveLength(0);
  });

  it('reaches the palette through the provider seam, under its own heading', () => {
    __setDeskCatalogueForTest(READY);
    const rows = listCommands({ vitals: VITALS });
    const mine = rows.filter((r) => r.id.startsWith('desk.'));

    expect(mine.map((r) => r.id)).toEqual(['desk.running']);
    expect(mine[0]!.section).toBe('Ask the desk');
    // These hand work to the assistant; the row says so itself, because the
    // heading scrolls away while the rows are still on screen.
    expect(mine[0]!.badge).toBe('AI');
  });

  it('is findable by what someone would type', () => {
    __setDeskCatalogueForTest(READY);
    const all = listCommands({ vitals: VITALS });
    expect(filterCommands(all, 'running').some((r) => r.id === 'desk.running')).toBe(true);
    // The hint is a keyword too — people search for the thing, not its name.
    expect(filterCommands(all, 'deployed').some((r) => r.id === 'desk.running')).toBe(true);
  });
});

describe('when there is nothing to offer', () => {
  it('says the engine is old, not that the desk is empty', () => {
    /**
     * ★ The distinction this whole client exists for. A 404 means the engine
     * is running and simply predates the route; reporting that as "could not
     * read" sends somebody to debug a network that is fine.
     */
    __setDeskCatalogueForTest({ status: 'outdated' });
    expect(deskCommandsNote()).toMatch(/too old/i);
  });

  it('says so when the engine could not be read', () => {
    __setDeskCatalogueForTest({ status: 'unreachable' });
    expect(deskCommandsNote()).toMatch(/could not be read/i);
  });

  it('says nothing while the list is present', () => {
    __setDeskCatalogueForTest(READY);
    expect(deskCommandsNote()).toBeNull();
  });
});
