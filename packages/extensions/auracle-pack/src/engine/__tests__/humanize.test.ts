/**
 * The de-jargon helpers (FR-H3): the one place raw engine vocabulary — ops
 * action codes, dotted module paths, connector slugs, broker ids — is turned
 * into something a person reads. The contract these tests pin: known codes get
 * curated phrases, unknown ones are still rendered (never shown as a raw slug),
 * and nothing is invented for a blank input.
 */
import { describe, expect, it } from 'vitest';
import { brokerLabel, humanizeAction, prettifyPath, prettifySlug } from '../humanize';

describe('humanizeAction', () => {
  it('maps the three action codes the ops journal actually records', () => {
    // These are the sole actions `repair.apply_operation` writes (engine
    // auracle/ops/repair.py). Past tense: the ledger records what WAS done.
    expect(humanizeAction('restart_data_feed')).toBe('Restarted the data feed');
    expect(humanizeAction('redeploy_deployment')).toBe('Redeployed a deployment');
    expect(humanizeAction('rearm_schedule')).toBe('Re-armed a schedule');
  });

  it('maps run_backtest, the PRD-named operation not yet journaled', () => {
    expect(humanizeAction('run_backtest')).toBe('Ran a backtest');
  });

  it('titleizes an unknown code as a sentence rather than showing a slug', () => {
    expect(humanizeAction('pause_deployment')).toBe('Pause deployment');
    expect(humanizeAction('route-orders')).toBe('Route orders');
  });

  it('is null for a blank or missing code so a caller can drop the segment', () => {
    expect(humanizeAction(null)).toBeNull();
    expect(humanizeAction(undefined)).toBeNull();
    expect(humanizeAction('')).toBeNull();
  });
});

describe('prettifySlug', () => {
  it('strips a pipeline prefix and Title-Cases the stem', () => {
    expect(prettifySlug('forge-resga_v2')).toBe('Resga V2');
    expect(prettifySlug('forge_alpha-one')).toBe('Alpha One');
  });

  it('turns separators into spaces and titleizes', () => {
    expect(prettifySlug('daily_ma')).toBe('Daily Ma');
    expect(prettifySlug('eod')).toBe('Eod');
  });

  it('leaves a bare numeric id (a deployment target) as itself', () => {
    expect(prettifySlug('42')).toBe('42');
  });

  it('preserves an already-capitalized acronym token', () => {
    expect(prettifySlug('RSI_bands')).toBe('RSI Bands');
  });

  it('is null for a blank input', () => {
    expect(prettifySlug('')).toBeNull();
    expect(prettifySlug(null)).toBeNull();
    expect(prettifySlug('   ')).toBeNull();
  });
});

describe('prettifyPath', () => {
  it('reads the last dotted segment of a module path', () => {
    expect(prettifyPath('strategies.desk.resga_v2')).toBe('Resga V2');
    expect(prettifyPath('strategies.momentum.Mom')).toBe('Mom');
  });

  it('strips a source-file extension and folder from a file path', () => {
    expect(prettifyPath('strategies/Sandbox/breakout.py')).toBe('Breakout');
    expect(prettifyPath('notebooks/alpha_one.ipynb')).toBe('Alpha One');
  });

  it('is null for a blank input', () => {
    expect(prettifyPath('')).toBeNull();
    expect(prettifyPath(undefined)).toBeNull();
  });
});

describe('brokerLabel', () => {
  it('maps known broker ids to the product display label', () => {
    expect(brokerLabel('ibkr')).toBe('Interactive Brokers');
    expect(brokerLabel('clearstreet')).toBe('ClearStreet');
    expect(brokerLabel('alpaca')).toBe('Alpaca');
  });

  it('keeps none / blank / missing as the honest "none"', () => {
    expect(brokerLabel('none')).toBe('none');
    expect(brokerLabel('')).toBe('none');
    expect(brokerLabel(null)).toBe('none');
    expect(brokerLabel(undefined)).toBe('none');
  });

  it('titleizes an unmapped broker id rather than showing the raw slug', () => {
    expect(brokerLabel('some_new_broker')).toBe('Some New Broker');
  });
});
