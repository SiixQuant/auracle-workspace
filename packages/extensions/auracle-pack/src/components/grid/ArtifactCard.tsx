/**
 * One artifact, as a card.
 *
 * A record that something exists — a name, a one-line reason, up to four
 * numbers, and a badge — and nothing more. There is no control on it: an
 * artifact card is read, expanded, or opened in its room, never edited, and
 * the only input surviving anywhere in the panel is the credential paste,
 * which is not here.
 *
 * The figures keep the order the adapter gave them, because that order is the
 * honesty rule made visible: a qualifying number sits to the left of the
 * result it qualifies. The badge is always drawn, in every tier, so a caveat
 * is never the thing that falls off when the card gets small.
 */
import type { Artifact, ArtifactBadge } from '../../engine/boardArtifacts';
import { ensurePanelKitStyles, tint, tone } from '../panelkit';
import { GRID_ACCENT } from './gridTheme';

const STYLE_ID = 'auracle-artifact-card-styles';

const BADGE_TINT: Record<ArtifactBadge['tone'], string> = {
  certified: GRID_ACCENT,
  caution: tone.caution,
  neutral: tone.text3,
};

const SHEET = `
.acard2 { display: flex; flex-direction: column; gap: 9px; padding: 12px 14px; border: 1px solid ${tone.border}; border-radius: 12px; background: ${tone.surface}; }
.acard2__head { display: flex; align-items: baseline; gap: 10px; }
.acard2__name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: ${tone.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acard2__badge { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; padding: 2px 7px; border-radius: 999px; }
.acard2__reason { margin: 0; font-size: 12px; color: ${tone.text2}; }
.acard2__metrics { display: flex; flex-wrap: wrap; gap: 14px; }
.acard2__metric { display: flex; flex-direction: column; gap: 1px; }
.acard2__mlabel { font-size: 9.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: ${tone.text3}; }
.acard2__mvalue { font-family: ${tone.mono}; font-variant-numeric: tabular-nums; font-size: 13.5px; color: ${tone.text}; }
.acard2__note { margin: 0; font-size: 10.5px; color: ${tone.text3}; }
`;

function ensureArtifactStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SHEET;
  document.head.appendChild(el);
}

export function ArtifactCard({ artifact }: { artifact: Artifact }): JSX.Element {
  ensurePanelKitStyles();
  ensureArtifactStyles();
  const accent = BADGE_TINT[artifact.badge.tone];

  return (
    <article className="acard2" data-testid={`artifact-${artifact.id}`} data-kind={artifact.kind}>
      <div className="acard2__head">
        <span className="acard2__name" data-testid="artifact-name" title={artifact.name}>
          {artifact.name}
        </span>
        <span
          className="acard2__badge"
          data-testid="artifact-badge"
          data-tone={artifact.badge.tone}
          style={{
            color: accent,
            border: `1px solid ${tint(accent, 55)}`,
            background: tint(accent, 12),
          }}
        >
          {artifact.badge.label}
        </span>
      </div>
      <p className="acard2__reason" data-testid="artifact-reason">
        {artifact.reason}
      </p>
      {artifact.metrics.length > 0 ? (
        <div className="acard2__metrics" data-testid="artifact-metrics">
          {artifact.metrics.map((metric) => (
            <div className="acard2__metric" key={metric.label}>
              <span className="acard2__mlabel">{metric.label}</span>
              <span className="acard2__mvalue" data-testid={`artifact-metric-${metric.label}`}>
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {/* The badge's line rides with it, always drawn, so the caveat is never
          the thing that falls off when the card is skimmed. */}
      <p className="acard2__note" data-testid="artifact-note">
        {artifact.badge.note}
      </p>
    </article>
  );
}
