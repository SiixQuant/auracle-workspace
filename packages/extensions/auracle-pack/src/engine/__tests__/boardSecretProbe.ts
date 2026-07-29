/**
 * The audit every agent-visible payload is put through.
 *
 * Not a fixture: a MEASUREMENT. The acceptance the Board's agent surface is
 * built against is "an audit of every agent-visible payload finds no credential
 * value", and a test that only checked the fields it remembered to check would
 * pass the day somebody adds a field. So this walks whatever it is handed and
 * looks for three things:
 *
 *  - a probe VALUE, planted in the input the payload was built from. If a
 *    secret can travel, this is what proves it did;
 *  - a key SHAPED like a value (`secret`, `api_key`, `token`, ...). The slot
 *    NAME is allowed and is the one exception, so it is excluded by exact name
 *    rather than by pattern;
 *  - a key that reports the slot's STATE. Whether a vault slot holds something
 *    is a fact about the person's credentials, and the Board never volunteers
 *    it — an envelope that says "empty" has told the agent something it was not
 *    given to know.
 *
 * Findings come back as sentences rather than a boolean so a failure names the
 * path that leaked.
 */

/** The value planted wherever a caller could try to smuggle one in. */
export const SECRET_PROBE = 'sk-live-probe-value-must-never-travel';

/** A second one, for the cases that need two distinguishable plants. */
export const SECRET_PROBE_ALT = 'bearer-probe-value-must-never-travel';

/** The one credential-ish key that is allowed: a NAME, never a value. */
const ALLOWED_KEYS = new Set(['credential_slot', 'credentialSlot']);

const VALUE_SHAPED =
  /(secret|password|passwd|passphrase|token|api[-_ ]?key|apikey|bearer|private[-_ ]?key|access[-_ ]?key|credential)/i;

/** Keys that would report whether a slot holds a secret. */
const STATE_SHAPED = new Set([
  'set',
  'is_set',
  'isSet',
  'secret_set',
  'secretSet',
  'credential_set',
  'credentialSet',
  'has_secret',
  'hasSecret',
  'slot_state',
  'slotState',
]);

function walk(value: unknown, path: string, findings: string[]): void {
  if (typeof value === 'string') {
    if (value.includes(SECRET_PROBE) || value.includes(SECRET_PROBE_ALT)) {
      findings.push(`${path} carries a credential value`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`, findings));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (!ALLOWED_KEYS.has(key)) {
      if (VALUE_SHAPED.test(key)) findings.push(`${here} is a value-shaped field`);
      if (STATE_SHAPED.has(key)) findings.push(`${here} reports the slot's set/unset state`);
    }
    walk(entry, here, findings);
  }
}

/**
 * Everything wrong with `payload`, as sentences. An empty array is the pass.
 * `label` names the payload so a failure says which one it was.
 */
export function secretFindings(label: string, payload: unknown): string[] {
  const findings: string[] = [];
  walk(payload, '', findings);
  return findings.map((finding) => `${label}: ${finding}`);
}
