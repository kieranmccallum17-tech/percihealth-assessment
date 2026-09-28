import { parseCsv } from './csv';
import { ImportError } from './errors';
import type { JsonMemberStore } from './store';
import { validateRow } from './validate';
import { REQUIRED_COLUMNS, type ImportReport, type Member, type RawRow, type RejectedRow } from './types';

export interface ImportOptions {
  now?: string; // ISO timestamp used for createdAt/updatedAt (injectable for tests)
  today?: string; // YYYY-MM-DD used for "is this date in the future?" (injectable for tests)
}

/**
 * Imports one partner CSV into the store. The whole flow lives here:
 *
 *   1. parse the CSV                  (bad file  -> throw, import nothing)
 *   2. check the header               (bad file  -> throw, import nothing)
 *   3. validate each row              (bad row   -> reject, keep going)
 *   4. reject ids repeated in the file (ambiguous -> reject all copies)
 *   5. upsert the rest, save once
 *
 * Takes CSV TEXT rather than a file path, so tests don't need files on disk.
 */
export function importMembers(csvText: string, store: JsonMemberStore, options: ImportOptions = {}): ImportReport {
  const now = options.now ?? new Date().toISOString();
  const today = options.today ?? now.slice(0, 10);

  // 1. Parse
  const records = parseCsv(csvText);
  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) throw new ImportError('File is empty');

  // 2. Header check. We tell the user what we expected AND what we found,
  // so "wrong file" or "renamed column" is obvious from the error alone.
  const header = headerRecord.fields.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new ImportError(`Missing required column(s): ${missing.join(', ')}. Found: ${header.join(', ')}`);
  }
  const idIndex = header.indexOf('partner_member_id');

  const rejected: RejectedRow[] = [];
  const valid: { line: number; member: Member }[] = [];
  const linesById = new Map<string, number[]>(); // every line each id appears on, valid or not

  // 3. Validate each row
  for (const record of dataRecords) {
    const id = (record.fields[idIndex] ?? '').trim();
    if (id) linesById.set(id, [...(linesById.get(id) ?? []), record.line]);

    // Wrong number of fields usually means a missing comma or an unquoted comma
    // inside a value. Values could be in the wrong columns, so don't try to read them.
    if (record.fields.length !== header.length) {
      rejected.push({
        line: record.line,
        partnerMemberId: id || null,
        reasons: [`expected ${header.length} fields but found ${record.fields.length}`],
      });
      continue;
    }

    // Build { column: value } using the header positions, so column ORDER doesn't matter.
    const raw = Object.fromEntries(REQUIRED_COLUMNS.map((col) => [col, record.fields[header.indexOf(col)]])) as RawRow;

    const result = validateRow(raw, today);
    if (result.ok) valid.push({ line: record.line, member: result.member });
    else rejected.push({ line: record.line, partnerMemberId: id || null, reasons: result.reasons });
  }

  // 4 + 5. Reject ambiguous duplicates, upsert everything else
  const report: ImportReport = { created: [], updated: [], unchanged: [], rejected };

  for (const { line, member } of valid) {
    const lines = linesById.get(member.partnerMemberId) ?? [];
    if (lines.length > 1) {
      // Same id twice in one file with (possibly) different data: we can't know
      // which is right, and "last one wins" would silently depend on row order.
      rejected.push({
        line,
        partnerMemberId: member.partnerMemberId,
        reasons: [`partner_member_id appears on multiple lines (${lines.join(', ')}); none were imported`],
      });
      continue;
    }

    const outcome = store.upsert(member, now); // 'created' | 'updated' | 'unchanged'
    report[outcome].push(member.partnerMemberId);
  }

  // Save once, at the end. If anything above threw, nothing was written.
  store.save();

  rejected.sort((a, b) => a.line - b.line);
  return report;
}
