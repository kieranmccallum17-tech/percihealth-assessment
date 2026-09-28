/**
 * A problem with the input FILE (not a single row) that means we can't safely
 * import anything: missing columns, an unterminated quote, an empty file.
 *
 * Two levels of failure, on purpose:
 *   - bad ROW  -> reject that row, import the rest, report it
 *   - bad FILE -> import nothing, fail loudly
 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}
