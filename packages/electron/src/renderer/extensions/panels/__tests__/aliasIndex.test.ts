import { describe, expect, it } from 'vitest';
import { buildAliasIndex, panelToggleNext } from '../panelRouting';

const PACK = 'com.auracle.pack';

describe('buildAliasIndex resolves absorbed panel ids to their hub', () => {
  const panels = [
    { id: `${PACK}.backtest`, aliases: [] as string[] },
    {
      id: `${PACK}.strategy-lab`,
      aliases: [`${PACK}.research`, `${PACK}.qc-import`, `${PACK}.validation`],
    },
    {
      id: `${PACK}.live-desk`,
      aliases: [
        `${PACK}.live-algorithms`,
        `${PACK}.blotter`,
        `${PACK}.incidents`,
        `${PACK}.schedules`,
        `${PACK}.runway`,
      ],
    },
  ];

  it('maps every absorbed id to its owning hub', () => {
    const index = buildAliasIndex(panels);
    expect(index.get(`${PACK}.research`)).toBe(`${PACK}.strategy-lab`);
    expect(index.get(`${PACK}.qc-import`)).toBe(`${PACK}.strategy-lab`);
    expect(index.get(`${PACK}.validation`)).toBe(`${PACK}.strategy-lab`);
    expect(index.get(`${PACK}.live-algorithms`)).toBe(`${PACK}.live-desk`);
    expect(index.get(`${PACK}.blotter`)).toBe(`${PACK}.live-desk`);
    expect(index.get(`${PACK}.incidents`)).toBe(`${PACK}.live-desk`);
    expect(index.get(`${PACK}.schedules`)).toBe(`${PACK}.live-desk`);
    expect(index.get(`${PACK}.runway`)).toBe(`${PACK}.live-desk`);
  });

  it('never indexes canonical ids', () => {
    const index = buildAliasIndex(panels);
    expect(index.has(`${PACK}.backtest`)).toBe(false);
    expect(index.has(`${PACK}.strategy-lab`)).toBe(false);
    expect(index.has(`${PACK}.live-desk`)).toBe(false);
  });

  it('a registered panel id wins over a stale alias claiming it', () => {
    const index = buildAliasIndex([
      { id: 'ext.hub', aliases: ['ext.legacy', 'ext.other-panel'] },
      // 'ext.other-panel' is ALSO a real panel — the alias must not shadow it.
      { id: 'ext.other-panel', aliases: [] },
    ]);
    expect(index.has('ext.other-panel')).toBe(false);
    expect(index.get('ext.legacy')).toBe('ext.hub');
  });

  it('panels without aliases produce an empty index', () => {
    expect(buildAliasIndex([{ id: 'a.b', aliases: [] }]).size).toBe(0);
  });
});

describe('panelToggleNext toggles own ids but navigates aliased ones', () => {
  const desk = { id: `${PACK}.live-desk` };

  it('pressing the rail button again closes the panel', () => {
    expect(panelToggleNext(desk.id, desk, desk.id)).toBeNull();
  });

  it('pressing the rail button while closed opens it', () => {
    expect(panelToggleNext(null, desk, desk.id)).toBe(desk.id);
  });

  it('switching from another panel opens this one', () => {
    expect(panelToggleNext(`${PACK}.backtest`, desk, desk.id)).toBe(desk.id);
  });

  // The regression the alias machinery exists to prevent: a hand-off to an
  // absorbed id while its hub is already open must SHOW that surface, never
  // close the hub.
  it('an aliased request keeps an already-open hub open', () => {
    expect(panelToggleNext(desk.id, desk, `${PACK}.blotter`)).toBe(desk.id);
  });

  it('an aliased request opens a closed hub', () => {
    expect(panelToggleNext(null, desk, `${PACK}.blotter`)).toBe(desk.id);
  });
});
