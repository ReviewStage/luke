import { and, eq, isNull } from "drizzle-orm";
import { CONVERSATION_KIND, conversations, user } from "../../db/schema.js";
import type { HostedStoreDatabase } from "../store/database.js";

/**
 * The account's standing main conversation, opened on first use. Nothing
 * else opens the first main: Clear opens the next one in the same
 * transaction that stamps the last, and a read over an account with none
 * answers empty. The open takes the account's user row lock first, the same
 * lock Clear holds, so a first ask and a Clear on an account with no main
 * run one after the other and neither fails on the other's insert. Two
 * first asks racing here queue on that lock, and the second finds the
 * first's row. The partial unique index over the standing main is the
 * guarantee itself, and it stands whether or not anything catches its
 * refusal: a path that inserts a main without this lock is refused a second
 * row by the index and fails visibly, which is what makes the missing lock
 * a defect someone sees rather than a silence that answered. Nothing here
 * catches that refusal on purpose.
 */

async function standingMainId(
  db: Pick<HostedStoreDatabase, "select">,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.kind, CONVERSATION_KIND.MAIN),
        isNull(conversations.deletedAt),
      ),
    );
  return row?.id;
}

/** The id of the account's standing main, opened now where none stood. */
export function standingMain(db: HostedStoreDatabase, userId: string, now: Date): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const standing = await standingMainId(tx, userId);
    if (standing !== undefined) return standing;
    const [opened] = await tx
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.MAIN, createdAt: now, lastActivityAt: now })
      .returning({ id: conversations.id });
    if (opened === undefined) throw new Error("the open inserted no main conversation");
    return opened.id;
  });
}
