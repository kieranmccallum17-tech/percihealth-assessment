import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ImportError } from '../src/errors';
import { importMembers } from '../src/importer';
import { JsonMemberStore } from '../src/store';

const HEADER = 'partner_member_id,first_name,last_name,date_of_birth,email,policy_start,policy_end';
// Fixed clock values so results never depend on when the tests run.
const FIRST_RUN = { today: '2026-09-24', now: '2026-09-24T10:00:00.000Z' };
const SECOND_RUN = { today: '2026-09-25', now: '2026-09-25T10:00:00.000Z' };

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

// A fresh, empty store file in its own temp folder for every test.
function freshStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'perci-import-')), 'members.json');
}

const AMELIA = 'P-1,Amelia,Hart,1985-04-12,amelia@example.com,2026-01-01,2026-12-31';
const OMAR = 'P-2,Omar,Siddiqui,1990-11-03,omar@example.com,2026-02-01,';

describe('importMembers', () => {
  it('imports valid rows and rejects broken ones with line numbers and reasons', () => {
    const store = new JsonMemberStore(freshStorePath());
    const report = importMembers(
      csv(AMELIA, 'P-3,Tom,Baker,1992-02-30,tom@example.com,2026-01-01,', OMAR, 'P-4,only,three'),
      store,
      FIRST_RUN,
    );

    assert.deepEqual(report.created, ['P-1', 'P-2']);
    assert.deepEqual(report.rejected, [
      { line: 3, partnerMemberId: 'P-3', reasons: ['date_of_birth is not a valid YYYY-MM-DD date'] },
      { line: 5, partnerMemberId: 'P-4', reasons: ['expected 7 fields but found 3'] },
    ]);
    assert.equal(store.get('P-3'), undefined); // rejected rows are never stored
  });

  it('is idempotent: importing the same file twice creates no duplicates and changes nothing', () => {
    const path = freshStorePath();
    const file = csv(AMELIA, OMAR);

    importMembers(file, new JsonMemberStore(path), FIRST_RUN);
    // A NEW store instance re-reads from disk, exactly like a second run of the program.
    const store = new JsonMemberStore(path);
    const second = importMembers(file, store, SECOND_RUN);

    assert.deepEqual(second.created, []);
    assert.deepEqual(second.updated, []);
    assert.deepEqual(second.unchanged, ['P-1', 'P-2']);
    assert.equal(store.count(), 2);
    // Nothing changed, so the timestamp must not move either.
    assert.equal(store.get('P-1')?.updatedAt, FIRST_RUN.now);
  });

  it('updates a stored member when their row changes (same id + new email = same person)', () => {
    const path = freshStorePath();
    importMembers(csv(AMELIA), new JsonMemberStore(path), FIRST_RUN);

    const store = new JsonMemberStore(path);
    const report = importMembers(
      csv('P-1,Amelia,Hart,1985-04-12,amelia.new@example.com,2026-01-01,2026-12-31'),
      store,
      SECOND_RUN,
    );

    assert.deepEqual(report.updated, ['P-1']);
    const member = store.get('P-1');
    assert.equal(member?.email, 'amelia.new@example.com');
    assert.equal(member?.createdAt, FIRST_RUN.now); // original creation time kept
    assert.equal(member?.updatedAt, SECOND_RUN.now);
    assert.equal(store.count(), 1);
  });

  it('rejects every copy of an id that appears more than once in the same file', () => {
    const store = new JsonMemberStore(freshStorePath());
    const report = importMembers(
      csv(AMELIA, 'P-1,Amelia,Hart,1985-04-12,other@example.com,2026-01-01,2026-12-31', OMAR),
      store,
      FIRST_RUN,
    );

    assert.deepEqual(report.created, ['P-2']);
    assert.deepEqual(
      report.rejected.map((r) => r.line),
      [2, 3],
    );
    assert.equal(store.get('P-1'), undefined);
  });

  it('does not delete members who are missing from a later file', () => {
    const path = freshStorePath();
    importMembers(csv(AMELIA, OMAR), new JsonMemberStore(path), FIRST_RUN);

    const store = new JsonMemberStore(path);
    importMembers(csv(OMAR), store, SECOND_RUN);

    assert.ok(store.get('P-1')); // still there; see README for why
  });

  it('accepts the columns in any order', () => {
    const store = new JsonMemberStore(freshStorePath());
    const report = importMembers(
      'email,partner_member_id,first_name,last_name,date_of_birth,policy_start,policy_end\n' +
        'amelia@example.com,P-1,Amelia,Hart,1985-04-12,2026-01-01,',
      store,
      FIRST_RUN,
    );

    assert.deepEqual(report.created, ['P-1']);
    assert.equal(store.get('P-1')?.email, 'amelia@example.com');
  });

  it('fails the whole import and writes nothing when a required column is missing', () => {
    const path = freshStorePath();
    const noEmailColumn =
      'partner_member_id,first_name,last_name,date_of_birth,policy_start,policy_end\n' +
      'P-1,Amelia,Hart,1985-04-12,2026-01-01,2026-12-31';

    assert.throws(() => importMembers(noEmailColumn, new JsonMemberStore(path), FIRST_RUN), {
      name: ImportError.name,
      message: /Missing required column\(s\): email/,
    });
    assert.equal(existsSync(path), false);
  });
});
