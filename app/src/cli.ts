import { readFileSync } from 'node:fs';
import { ImportError } from './errors';
import { importMembers } from './importer';
import { JsonMemberStore } from './store';
import type { ImportReport } from './types';

// Where members are stored. Override with MEMBERS_STORE=/some/path.json
const STORE_PATH = process.env.MEMBERS_STORE ?? '.data/members.json';

const USAGE = `Usage:
  npm run import -- <path-to-csv>        Import a partner eligibility file
  npm run lookup -- <partner_member_id>  Show one stored member`;

function printReport(report: ImportReport): void {
  console.log(
    `Created: ${report.created.length}  Updated: ${report.updated.length}  ` +
      `Unchanged: ${report.unchanged.length}  Rejected: ${report.rejected.length}`,
  );
  for (const r of report.rejected) {
    console.log(`  line ${r.line} (${r.partnerMemberId ?? 'no id'}): ${r.reasons.join('; ')}`);
  }
}

/** Returns the process exit code: 0 = success, 1 = failure / not found. */
function main(args: string[]): number {
  const [command, arg] = args;
  const store = new JsonMemberStore(STORE_PATH);

  if (command === 'import' && arg) {
    const report = importMembers(readFileSync(arg, 'utf8'), store);
    printReport(report);
    // Rejected rows are an expected outcome, not a crash, so still exit 0.
    return 0;
  }

  if (command === 'get' && arg) {
    const member = store.get(arg.trim());
    if (!member) {
      console.error(`No member found with partner_member_id "${arg}"`);
      return 1;
    }
    console.log(JSON.stringify(member, null, 2));
    return 0;
  }

  console.error(USAGE);
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof ImportError) {
    // Expected, user-facing problem with the file: clean message, no stack trace.
    console.error(`Import failed, nothing was imported: ${err.message}`);
  } else if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
    console.error(`File not found: ${(err as NodeJS.ErrnoException).path}`);
  } else {
    throw err; // A genuine bug: let it crash with the full stack trace.
  }
  process.exitCode = 1;
}
