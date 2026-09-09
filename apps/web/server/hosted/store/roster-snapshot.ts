import { eq } from "drizzle-orm";
import { rosterSnapshot } from "../../db/schema.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The latest roster an observation pass reported for a user, one row
 * replaced whole on every pass. The body is whatever the pass serialized —
 * titles, branches, error lines — and is sealed; the instant it was observed
 * stands clear, because it is what decides whether the snapshot is current.
 */
export interface RosterSnapshotRecord {
  readonly body: string;
  readonly observedAt: number;
}

export async function readRosterSnapshot(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
): Promise<RosterSnapshotRecord | undefined> {
  const [row] = await db.select().from(rosterSnapshot).where(eq(rosterSnapshot.userId, userId));
  if (!row) return undefined;
  return { body: seal.open(row.sealedBody), observedAt: row.observedAt };
}

export async function writeRosterSnapshot(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  snapshot: RosterSnapshotRecord,
): Promise<void> {
  const sealedBody = seal.seal(snapshot.body);
  await db
    .insert(rosterSnapshot)
    .values({ userId, sealedBody, observedAt: snapshot.observedAt })
    .onConflictDoUpdate({
      target: rosterSnapshot.userId,
      set: { sealedBody, observedAt: snapshot.observedAt },
    });
}
