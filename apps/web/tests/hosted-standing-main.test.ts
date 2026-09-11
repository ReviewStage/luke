import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND, conversations } from "../server/db/storage-schema";
import { standingMain } from "../server/hosted/brain-host/main";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = new Date(1_800_000_000_000);

async function standingMains(userId: string): Promise<string[]> {
  const rows = await database.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.kind, CONVERSATION_KIND.MAIN),
        isNull(conversations.deletedAt),
      ),
    );
  return rows.map((row) => row.id);
}

test("the first ask opens the account's main once, however many open it together, and every later ask finds that one", async () => {
  const userId = await database.createUser();
  const opened = await Promise.all([
    standingMain(database.db, userId, NOW),
    standingMain(database.db, userId, NOW),
    standingMain(database.db, userId, NOW),
  ]);
  const [first] = opened;
  assert.ok(first);
  assert.deepEqual(opened, [first, first, first]);
  assert.deepEqual(await standingMains(userId), [first]);
  assert.equal(await standingMain(database.db, userId, NOW), first);
});

test("a first ask and a Clear racing on an account with no main both land, and one standing main is left: the one the Clear opened", async () => {
  const userId = await database.createUser();
  const [asked, cleared] = await Promise.all([
    standingMain(database.db, userId, NOW),
    database.store.main.clear(userId, NOW),
  ]);
  const standing = await standingMains(userId);
  assert.deepEqual(standing, [cleared.opened]);
  assert.deepEqual(cleared.cleared, asked === cleared.opened ? [] : [asked]);
});

test("a cleared main is not the standing one: the next ask opens another beside the stamped row", async () => {
  const userId = await database.createUser();
  const first = await standingMain(database.db, userId, NOW);
  await database.db
    .update(conversations)
    .set({ deletedAt: NOW })
    .where(eq(conversations.id, first));
  const next = await standingMain(database.db, userId, NOW);
  assert.notEqual(next, first);
  assert.deepEqual(await standingMains(userId), [next]);
});
