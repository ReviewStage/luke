import { asc, eq } from "drizzle-orm";
import { personalFact, user } from "../../db/schema.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * The durable facts Luke keeps about the developer, listed in the order they
 * were remembered and replaced whole, so a changed fact takes the place of
 * the one it corrects and a forgotten one is simply absent from the next
 * list. The words are sealed; the id is what a request to forget names.
 */
export interface StoredFact {
  readonly id: string;
  readonly words: string;
  readonly createdAt: number;
}

export interface FactWrite {
  readonly id: string;
  readonly words: string;
}

export async function listFacts(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
): Promise<readonly StoredFact[]> {
  const rows = await db
    .select()
    .from(personalFact)
    .where(eq(personalFact.userId, userId))
    .orderBy(asc(personalFact.ordinal));
  const facts: StoredFact[] = [];
  for (const row of rows) {
    let words: string;
    try {
      words = seal.open(row.sealedWords);
    } catch {
      continue;
    }
    facts.push({ id: row.id, words, createdAt: row.createdAt });
  }
  return facts;
}

/**
 * Replaces the list whole under the user's row lock, so two replacements
 * land one after the other rather than each deleting what it saw and both
 * inserting; a fact keeping its id keeps the instant it was first remembered.
 */
export function replaceFacts(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  facts: readonly FactWrite[],
  now: number,
): Promise<readonly StoredFact[]> {
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const held = await tx
      .select({ id: personalFact.id, createdAt: personalFact.createdAt })
      .from(personalFact)
      .where(eq(personalFact.userId, userId));
    const remembered = new Map(held.map((row) => [row.id, row.createdAt]));
    await tx.delete(personalFact).where(eq(personalFact.userId, userId));
    if (facts.length > 0) {
      await tx.insert(personalFact).values(
        facts.map((fact, ordinal) => ({
          userId,
          id: fact.id,
          ordinal,
          sealedWords: seal.seal(fact.words),
          createdAt: remembered.get(fact.id) ?? now,
        })),
      );
    }
    return listFacts(tx, seal, userId);
  });
}
