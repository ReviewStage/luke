import assert from "node:assert/strict";
import { Schema } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { standingMain } from "../server/hosted/brain-host/main";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { readStandingConversations, setConversationDeletedAt } from "./support/store-rows";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = new Date(1_800_000_000_000);

const IdRowSchema = Schema.Struct({ id: Schema.String });

async function standingMains(userId: string): Promise<string[]> {
  const rows = await readStandingConversations(database.run, userId, CONVERSATION_KIND.MAIN);
  return rows.map((row) => Schema.decodeUnknownSync(IdRowSchema)(row).id);
}

test("the first ask opens the account's main once, however many open it together, and every later ask finds that one", async () => {
  const userId = await database.createUser();
  const opened = await Promise.all([
    database.run(standingMain(userId, NOW)),
    database.run(standingMain(userId, NOW)),
    database.run(standingMain(userId, NOW)),
  ]);
  const [first] = opened;
  assert.ok(first);
  assert.deepEqual(opened, [first, first, first]);
  assert.deepEqual(await standingMains(userId), [first]);
  assert.equal(await database.run(standingMain(userId, NOW)), first);
});

test("a first ask and a Clear racing on an account with no main both land, and one standing main is left: the one the Clear opened", async () => {
  const userId = await database.createUser();
  const [asked, cleared] = await Promise.all([
    database.run(standingMain(userId, NOW)),
    database.store.main.clear(userId, NOW),
  ]);
  const standing = await standingMains(userId);
  assert.deepEqual(standing, [cleared.opened]);
  assert.deepEqual(cleared.cleared, asked === cleared.opened ? [] : [asked]);
});

test("a cleared main is not the standing one: the next ask opens another beside the stamped row", async () => {
  const userId = await database.createUser();
  const first = await database.run(standingMain(userId, NOW));
  await setConversationDeletedAt(database.run, first, NOW);
  const next = await database.run(standingMain(userId, NOW));
  assert.notEqual(next, first);
  assert.deepEqual(await standingMains(userId), [next]);
});
