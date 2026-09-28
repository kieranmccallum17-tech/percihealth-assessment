import type { Member, RawRow } from './types';

/**
 * Discriminated union: check `result.ok` and TypeScript knows which fields exist.
 * (Similar idea to a DRF serializer's is_valid() + validated_data / errors.)
 */
export type ValidationResult = { ok: true; member: Member } | { ok: false; reasons: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Deliberately loose: "something@something.something" with no spaces.
// Strict email regexes reject real addresses; the real test is sending an email.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EARLIEST_DOB = '1900-01-01';

/**
 * True only for a real calendar date written exactly as YYYY-MM-DD.
 *
 * Why the round-trip check: JavaScript's Date silently "rolls over" impossible
 * dates, so new Date('2024-02-30') becomes 1 March. We parse, format it back,
 * and require the same string we started with.
 *
 * Why ISO only: "03/04/1985" is 3 April in the US and 3 March in the UK.
 * Guessing wrong gives someone the wrong date of birth with no error, so we reject it.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`); // UTC, so the server's timezone can't shift the day
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validates and normalises one raw row. Pure function: no I/O, no clock.
 * `today` is passed in (YYYY-MM-DD) so tests don't depend on the real date.
 *
 * Note: YYYY-MM-DD strings sort the same way as the dates they represent,
 * so plain string comparison (<, >) is a correct date comparison here.
 *
 * Reasons never include the actual values (DOB, email). Rejection reports tend
 * to get pasted into tickets and chat; line number + member id is enough to find the row.
 */
export function validateRow(raw: RawRow, today: string): ValidationResult {
  const reasons: string[] = [];

  // Trim everything: stray spaces from spreadsheet exports aren't meaningful.
  const partnerMemberId = raw.partner_member_id.trim();
  const firstName = raw.first_name.trim();
  const lastName = raw.last_name.trim();
  const dateOfBirth = raw.date_of_birth.trim();
  const email = raw.email.trim().toLowerCase(); // emails are case-insensitive in practice
  const policyStart = raw.policy_start.trim();
  const policyEnd = raw.policy_end.trim();

  if (!partnerMemberId) reasons.push('partner_member_id is required');
  if (!firstName) reasons.push('first_name is required');
  if (!lastName) reasons.push('last_name is required');

  if (!dateOfBirth) reasons.push('date_of_birth is required');
  else if (!isValidIsoDate(dateOfBirth)) reasons.push('date_of_birth is not a valid YYYY-MM-DD date');
  else if (dateOfBirth > today) reasons.push('date_of_birth is in the future');
  else if (dateOfBirth < EARLIEST_DOB) reasons.push(`date_of_birth is before ${EARLIEST_DOB}`);

  if (!email) reasons.push('email is required');
  else if (!EMAIL.test(email)) reasons.push('email is not a valid email address');

  if (!policyStart) reasons.push('policy_start is required');
  else if (!isValidIsoDate(policyStart)) reasons.push('policy_start is not a valid YYYY-MM-DD date');

  // policy_end is optional: empty means the policy has no end date.
  if (policyEnd) {
    if (!isValidIsoDate(policyEnd)) reasons.push('policy_end is not a valid YYYY-MM-DD date');
    else if (isValidIsoDate(policyStart) && policyEnd < policyStart) {
      reasons.push('policy_end is before policy_start');
    }
  }

  // Collect ALL problems before returning, so the partner can fix a row in one go.
  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    member: {
      partnerMemberId,
      firstName,
      lastName,
      dateOfBirth,
      email,
      policyStart,
      policyEnd: policyEnd || null,
    },
  };
}
