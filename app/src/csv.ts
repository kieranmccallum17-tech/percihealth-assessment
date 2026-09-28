import { ImportError } from './errors';

/** One parsed CSV record, plus the file line it STARTED on (for error reports). */
export interface CsvRecord {
  line: number;
  fields: string[];
}

/**
 * Minimal RFC 4180 CSV parser.
 *
 * Why not just `line.split(',')`? Because real partner files contain values like
 *   "Grant, Jr."          <- a comma inside quotes is NOT a separator
 *   "said ""hello"""      <- a doubled quote inside quotes is a literal "
 * and files saved from Excel often start with a BOM and use \r\n line endings.
 *
 * Why not a library? Zero runtime dependencies keeps a 30-minute exercise easy to
 * run and review. In production I'd use `csv-parse` instead (see README).
 *
 * How it works: walk the text one character at a time, tracking whether we're
 * inside a quoted value. Outside quotes, ',' ends a field and '\n' ends a record.
 * Inside quotes, everything is literal until the closing quote.
 */
export function parseCsv(input: string): CsvRecord[] {
  // Excel's "CSV UTF-8" export adds an invisible BOM character at the start.
  // Left in, it would make the first header "\uFEFFpartner_member_id" and fail the header check.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: CsvRecord[] = [];
  let fields: string[] = []; // fields of the record being built
  let field = ''; // the field being built
  let inQuotes = false;
  let line = 1; // current physical line in the file
  let recordStartLine = 1; // line the current record started on

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" inside quotes = one literal quote
          i++; // skip the second quote
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        if (ch === '\n') line++; // a quoted value can span lines; keep counting
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\n') {
      fields.push(field);
      records.push({ line: recordStartLine, fields });
      fields = [];
      field = '';
      line++;
      recordStartLine = line;
    } else if (ch !== '\r') {
      // '\r' is ignored so Windows (\r\n) and Unix (\n) files behave the same
      field += ch;
    }
  }

  // An unclosed quote means we can't know where any later row starts or ends.
  // Guessing could silently merge rows, so fail the whole file instead.
  if (inQuotes) {
    throw new ImportError(`Unterminated quoted value starting on line ${recordStartLine}`);
  }

  // Last record, when the file doesn't end with a newline.
  if (field !== '' || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordStartLine, fields });
  }

  // Drop completely blank lines (common at the end of exported files).
  return records.filter((r) => !(r.fields.length === 1 && r.fields[0].trim() === ''));
}
