import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RawRow } from '../src/types';
import { isValidIsoDate, validateRow } from '../src/validate';

const TODAY = '2026-09-24';

// A known-good row. Each test overrides just the field it cares about,
// so it's obvious what is being tested.
function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    partner_member_id: 'P-1',
    first_name: 'Amelia',
    last_name: 'Hart',
    date_of_birth: '1985-04-12',
    email: 'amelia@example.com',
    policy_start: '2026-01-01',
    policy_end: '2026-12-31',
    ...overrides,
  };
}

describe('isValidIsoDate', () => {
  it('accepts real dates, including a leap day', () => {
    assert.equal(isValidIsoDate('2024-02-29'), true);
  });

  it('rejects impossible dates that JavaScript would silently roll over', () => {
    assert.equal(isValidIsoDate('2024-02-30'), false);
    assert.equal(isValidIsoDate('2023-02-29'), false); // not a leap year
    assert.equal(isValidIsoDate('2026-13-01'), false);
  });

  it('rejects ambiguous or non-ISO formats', () => {
    assert.equal(isValidIsoDate('03/04/1985'), false);
    assert.equal(isValidIsoDate('1985-4-12'), false);
  });
});

describe('validateRow', () => {
  it('accepts a valid row and normalises it (trim, lower-case email, empty end -> null)', () => {
    const result = validateRow(row({ first_name: '  Amelia ', email: ' Amelia@Example.COM ', policy_end: '' }), TODAY);
    assert.equal(result.ok, true);
    if (!result.ok) return; // narrows the type for TypeScript
    assert.equal(result.member.firstName, 'Amelia');
    assert.equal(result.member.email, 'amelia@example.com');
    assert.equal(result.member.policyEnd, null);
  });

  it('rejects a date of birth in the future', () => {
    const result = validateRow(row({ date_of_birth: '2030-01-01' }), TODAY);
    assert.deepEqual(result, { ok: false, reasons: ['date_of_birth is in the future'] });
  });

  it('rejects a policy that ends before it starts', () => {
    const result = validateRow(row({ policy_start: '2026-06-01', policy_end: '2026-01-01' }), TODAY);
    assert.deepEqual(result, { ok: false, reasons: ['policy_end is before policy_start'] });
  });

  it('rejects an invalid email', () => {
    const result = validateRow(row({ email: 'not-an-email' }), TODAY);
    assert.deepEqual(result, { ok: false, reasons: ['email is not a valid email address'] });
  });

  it('reports every problem in a row at once, not just the first', () => {
    const result = validateRow(row({ partner_member_id: '', email: '', date_of_birth: '1990-02-30' }), TODAY);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.reasons, [
      'partner_member_id is required',
      'date_of_birth is not a valid YYYY-MM-DD date',
      'email is required',
    ]);
  });

  it('never puts personal data values into rejection reasons', () => {
    const result = validateRow(row({ date_of_birth: '1990-02-30', email: 'secret-person@' }), TODAY);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const text = result.reasons.join(' ');
    assert.ok(!text.includes('1990-02-30'));
    assert.ok(!text.includes('secret-person'));
  });
});
