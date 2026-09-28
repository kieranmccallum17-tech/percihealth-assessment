import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsv } from '../src/csv';
import { ImportError } from '../src/errors';

describe('parseCsv', () => {
  it('keeps commas that are inside quotes', () => {
    const [record] = parseCsv('P-1,"Grant, Jr.",x');
    assert.deepEqual(record?.fields, ['P-1', 'Grant, Jr.', 'x']);
  });

  it('turns a doubled quote inside quotes into one literal quote', () => {
    const [record] = parseCsv('"say ""hi"""');
    assert.deepEqual(record?.fields, ['say "hi"']);
  });

  it('handles a BOM, Windows line endings and blank lines', () => {
    const records = parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n3,4\r\n');
    assert.deepEqual(
      records.map((r) => r.fields),
      [
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ],
    );
  });

  it('reports the line a record starts on, even after a multi-line quoted value', () => {
    const records = parseCsv('h\n"two\nlines"\nlast');
    assert.deepEqual(
      records.map((r) => r.line),
      [1, 2, 4],
    );
  });

  it('fails the whole file on an unterminated quote instead of guessing', () => {
    assert.throws(() => parseCsv('a,b\n"oops,2\n3,4'), ImportError);
  });
});
