/**
 * The bridge assembles the engine credentials itself, and lets a caller add
 * only the one header family the engine expects on its guarded operations.
 *
 * What is pinned here is the reduction, because it is the whole reason the
 * lane is an allowlist rather than a passthrough: a name the bridge does not
 * know is dropped rather than forwarded, and the drop is silent so a caller
 * never has to handle it.
 */
import { describe, expect, it } from 'vitest';
import { callerHeaders } from '../AuracleEngineHandlers';

describe('the headers a caller may add', () => {
  it('keeps the one the engine expects, and emits it under the one spelling', () => {
    expect(callerHeaders({ 'X-Auracle-Confirmation': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
    // However the caller wrote it, one canonical name reaches the request —
    // two spellings of the same header would be joined into one unreadable
    // value, and a name with stray whitespace is not a legal header at all.
    expect(callerHeaders({ 'x-auracle-confirmation': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
    expect(callerHeaders({ ' X-Auracle-Confirmation ': 'issued-1' })).toEqual({
      'X-Auracle-Confirmation': 'issued-1',
    });
  });

  it('drops every name it does not know, including the credential ones', () => {
    expect(
      callerHeaders({
        'X-API-Key': 'someone-elses',
        Cookie: 'auracle_session=someone-elses',
        'X-CSRF-Token': 'anything',
        Authorization: 'Bearer x',
      })
    ).toEqual({});
  });

  it('ignores anything that is not a usable value, and anything that is not an object', () => {
    expect(callerHeaders({ 'X-Auracle-Confirmation': '' })).toEqual({});
    expect(callerHeaders({ 'X-Auracle-Confirmation': 42 })).toEqual({});
    expect(callerHeaders(undefined)).toEqual({});
    expect(callerHeaders(null)).toEqual({});
    expect(callerHeaders(['X-Auracle-Confirmation'])).toEqual({});
  });
});
