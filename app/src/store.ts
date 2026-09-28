import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Member, StoredMember, UpsertResult } from './types';

// The fields that define "has this member changed?". Timestamps are excluded:
// they're our bookkeeping, not the partner's data.
const MEMBER_FIELDS: (keyof Member)[] = [
  'partnerMemberId',
  'firstName',
  'lastName',
  'dateOfBirth',
  'email',
  'policyStart',
  'policyEnd',
];

/**
 * Stores members in a single JSON file, keyed by partner_member_id.
 *
 * The whole file is loaded into a Map on construction, changed in memory,
 * and written back once with save(). Fine for thousands of rows; for real
 * volumes I'd use SQLite/Postgres with a unique index on partner_member_id.
 */
export class JsonMemberStore {
  private readonly members = new Map<string, StoredMember>();

  // `private readonly filePath` in the constructor both declares and assigns the field.
  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, StoredMember>;
      for (const [id, member] of Object.entries(data)) this.members.set(id, member);
    }
  }

  get(partnerMemberId: string): StoredMember | undefined {
    return this.members.get(partnerMemberId);
  }

  count(): number {
    return this.members.size;
  }

  /**
   * Insert or update, keyed on partner_member_id. This is what makes the import
   * idempotent: the same row imported twice hits the same key, so no duplicates.
   * (Same idea as Django's update_or_create.)
   *
   * We only touch updatedAt when something actually changed, so "unchanged"
   * really means nothing happened.
   */
  upsert(member: Member, now: string): UpsertResult {
    const existing = this.members.get(member.partnerMemberId);

    if (!existing) {
      this.members.set(member.partnerMemberId, { ...member, createdAt: now, updatedAt: now });
      return 'created';
    }

    const changed = MEMBER_FIELDS.some((field) => existing[field] !== member[field]);
    if (!changed) return 'unchanged';

    this.members.set(member.partnerMemberId, { ...member, createdAt: existing.createdAt, updatedAt: now });
    return 'updated';
  }

  /**
   * Atomic save: write to a temp file, then rename it over the real one.
   * A rename is all-or-nothing, so a crash mid-write can't leave a half-written,
   * corrupt members.json behind.
   */
  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(Object.fromEntries(this.members), null, 2) + '\n');
    renameSync(tmpPath, this.filePath);
  }
}
