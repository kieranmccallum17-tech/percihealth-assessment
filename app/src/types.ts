/**
 * Shared types for the eligibility import.
 *
 * Naming convention: the CSV uses snake_case (that's the partner's format),
 * our code uses camelCase. The translation happens in one place: validate.ts.
 */

// Every column the partner file must have. Order doesn't matter and extra
// columns are ignored. Note: policy_end must EXIST as a column, but its value
// may be empty (meaning an open-ended policy). See validate.ts.
export const REQUIRED_COLUMNS = [
  'partner_member_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'policy_start',
  'policy_end',
] as const;

// Turns the array above into a union type:
// 'partner_member_id' | 'first_name' | ... (so typos in column names fail to compile)
export type Column = (typeof REQUIRED_COLUMNS)[number];

/** One CSV row after mapping header -> value, BEFORE validation. Everything is still a string. */
export type RawRow = Record<Column, string>;

/** A member AFTER validation and normalisation. This is the shape we trust and store. */
export interface Member {
  partnerMemberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  email: string; // stored lower-cased
  policyStart: string; // YYYY-MM-DD
  policyEnd: string | null; // YYYY-MM-DD, or null = no end date
}

/** What actually sits in the store: the member plus bookkeeping timestamps. */
export interface StoredMember extends Member {
  createdAt: string; // ISO timestamp of the import that first created it
  updatedAt: string; // ISO timestamp of the last import that CHANGED it
}

/** What happened to one valid row when we tried to store it. */
export type UpsertResult = 'created' | 'updated' | 'unchanged';

/** A row we refused to import, and why. */
export interface RejectedRow {
  line: number; // line number in the file (header is line 1), so a human can find it
  partnerMemberId: string | null; // null if the row had no usable id
  reasons: string[]; // ALL problems with the row, not just the first one
}

/** The result of one import run. Lists of ids, so tests can assert exactly what happened. */
export interface ImportReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  rejected: RejectedRow[];
}
