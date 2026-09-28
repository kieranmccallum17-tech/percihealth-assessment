# Partner eligibility import

A small TypeScript / Node.js command-line tool that imports a partner's eligibility CSV,
rejects invalid rows with a reason, can be safely re-run, and lets you look up a member
by `partner_member_id`.

## How to run it

Requires Node.js 22+.

```bash
npm install

npm run import -- data/members.csv           # first import: 3 created, 9 rejected (on purpose)
npm run import -- data/members.csv           # same file again: 3 unchanged, no duplicates
npm run import -- data/members-updated.csv   # 1 updated, 1 created, 2 unchanged
npm run lookup -- P-1001                     # prints the stored member as JSON
```

Members are stored in `.data/members.json` (override with `MEMBERS_STORE=path.json`).
Delete that file to start from empty.

## How to run the tests

```bash
npm test            # Node's built-in test runner, 21 tests
npm run typecheck   # strict TypeScript check
```

## How it's structured

```
src/
  csv.ts        parse CSV text into records (handles quotes, BOM, \r\n)
  validate.ts   validate + normalise ONE row (pure function, easy to test)
  store.ts      JSON-file store with upsert keyed on partner_member_id
  importer.ts   the flow: parse -> check header -> validate rows -> dedupe -> upsert -> save
  cli.ts        thin command-line wrapper: `import <file>` and `get <id>`
test/           one test file per module
data/           sample files, including deliberately broken rows
```

The CLI is kept thin on purpose: all the logic is in functions that take plain inputs,
so the tests exercise the real behaviour without spawning processes.

## Decisions and assumptions

**Identity.** `partner_member_id` is the identity of a member. If the email (or name, or
dates) changes for the same id, it's the same person and the record is updated. I assumed
one partner per file / store; with several partners the key would be
`(partner_id, partner_member_id)`, since two partners could use the same id.

**Re-running (idempotency).** Import is an upsert keyed on `partner_member_id`. Each valid row is
`created`, `updated` (some field differs) or `unchanged`. `updatedAt` only moves when data
actually changed.

**Members missing from a later file are not deleted.** I can't tell from the spec whether
partners send full snapshots or partial updates. Deleting on a partial file would silently
remove eligible people, which is the worse mistake. If files are confirmed to be full
snapshots, the next step would be to mark missing members as no longer eligible (not hard-delete).

**Two levels of failure.**
- A bad *row* is rejected with all of its problems listed, and the rest of the file is imported.
- A bad *file* (missing required column, unterminated quote, empty file) imports nothing and
  exits with code 1. The missing-column error lists what was expected and what was found.

**Same id twice in one file.** Every copy is rejected. I can't know which row is right,
and "last one wins" would make the result depend on row order without anyone noticing.

**Validation rules.**
- All fields are trimmed. Required: `partner_member_id`, `first_name`, `last_name`,
  `date_of_birth`, `email`, `policy_start`.
- Dates must be strict `YYYY-MM-DD` and a real calendar date (`2024-02-30` is rejected;
  JavaScript's `Date` would silently turn it into 1 March). Formats like `03/04/1985` are
  rejected because they mean different dates in the US and UK.
- `date_of_birth` can't be in the future or before 1900.
- `policy_end` is optional (empty = no end date), but if present it can't be before `policy_start`.
- Email: a loose shape check only, stored lower-case. A strict regex rejects real addresses.
- Expired policies are **stored**, not rejected. Whether someone is eligible *today* is a
  question for the lookup / business logic, not for the import.

**Personal data in reports.** Rejection reasons name the field and the problem but never
echo the value (no DOBs or emails), since these reports tend to get pasted into tickets and
chat. Line number + member id is enough to find the row.

**Storage.** A JSON file, written atomically (write to a temp file, then rename) so a crash
can't leave a corrupt store.

**CSV parsing.** A small hand-written parser to keep zero runtime dependencies. It is tested for
quoted commas, escaped quotes, BOM and Windows line endings. In production I'd use `csv-parse`.
