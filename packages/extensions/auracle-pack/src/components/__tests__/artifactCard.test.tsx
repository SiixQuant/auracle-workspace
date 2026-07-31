/**
 * The artifact card — a record, never a control.
 *
 *  - it draws the name, the reason, the figures in the order given, and the
 *    badge, and it renders NO input of any kind: an artifact is read, not
 *    edited, and the panel's one surviving field is the credential paste;
 *  - the badge and its note are always present, so a caveat is never the thing
 *    that falls away.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ArtifactCard } from '../grid/ArtifactCard';
import { basketVerdictArtifact, type Artifact } from '../../engine/boardArtifacts';

const VERDICT_CARD: Artifact = basketVerdictArtifact({
  strategy_ref: 'strategies.example_ma.MACrossover',
  trials: 448,
  luck_bar_portfolio: 1.41,
  pvalue: 0.539,
  survived: false,
  default_universe: 'quant.liquid',
  ranking: [{ sharpe: 0.73 }],
  provenance: ['survivorship: drawn from currently-listed names'],
});

afterEach(cleanup);

describe('the card', () => {
  it('draws name, reason, figures in order, and the badge', () => {
    render(<ArtifactCard artifact={VERDICT_CARD} />);

    expect(screen.getByTestId('artifact-name').textContent).toContain('MACrossover');
    expect(screen.getByTestId('artifact-reason').textContent).toContain(
      'No basket beat its benchmark'
    );
    const values = Array.from(
      screen.getByTestId('artifact-metrics').querySelectorAll('.acard2__mvalue')
    ).map((el) => el.textContent);
    expect(values).toEqual(['448', '1.41', '0.73', '0.54']);
    expect(screen.getByTestId('artifact-badge').textContent).toBe('survivor-biased');
  });

  it('always draws the badge note, the caveat that must not fall off', () => {
    render(<ArtifactCard artifact={VERDICT_CARD} />);
    expect(screen.getByTestId('artifact-note').textContent).toContain('survivorship');
  });

  it('renders no control: an artifact is read, not edited', () => {
    render(<ArtifactCard artifact={VERDICT_CARD} />);
    const card = screen.getByTestId(`artifact-${VERDICT_CARD.id}`);
    expect(card.querySelectorAll('input, select, textarea, button')).toHaveLength(0);
  });

  it('carries the kind and tone as data for the sheet to key on', () => {
    render(<ArtifactCard artifact={VERDICT_CARD} />);
    expect(screen.getByTestId(`artifact-${VERDICT_CARD.id}`).getAttribute('data-kind')).toBe(
      'basket-verdict'
    );
    expect(screen.getByTestId('artifact-badge').getAttribute('data-tone')).toBe('caution');
  });
});
