import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { countRowsForUser, deleteUser } from "./support/store-rows";

/**
 * The notebook search's embedding cache as the store holds it: a vector per
 * passage hash under the model that made it, read only under that model,
 * replaced by a newer model's vector, pruned to the hashes standing now,
 * kept apart per account, and gone with the account. Synthetic hashes and
 * vectors: no passage's words are anywhere near this table.
 */

const NOW = 1_800_000_000_000;
const MODEL = "embed-test";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

test("vectors are cached under their hash and model, read back only under that model, and replaced whole by a newer model's", async () => {
  const userId = await database.createUser();
  const { embeddings } = database.store;
  assert.deepEqual(await database.run(embeddings.read(userId, MODEL, ["h-1"])), new Map());
  assert.deepEqual(await database.run(embeddings.read(userId, MODEL, [])), new Map());

  await database.run(
    embeddings.write(
      userId,
      MODEL,
      [
        { hash: "h-1", vector: [0.25, -1, 3] },
        { hash: "h-2", vector: [1, 0, 0] },
      ],
      NOW,
    ),
  );
  assert.deepEqual(
    await database.run(embeddings.read(userId, MODEL, ["h-1", "h-2", "h-3"])),
    new Map([
      ["h-1", [0.25, -1, 3]],
      ["h-2", [1, 0, 0]],
    ]),
  );
  assert.deepEqual(
    await database.run(embeddings.read(userId, "another-model", ["h-1"])),
    new Map(),
  );

  await database.run(
    embeddings.write(userId, "another-model", [{ hash: "h-1", vector: [9] }], NOW + 1),
  );
  assert.deepEqual(
    await database.run(embeddings.read(userId, "another-model", ["h-1"])),
    new Map([["h-1", [9]]]),
  );
  assert.deepEqual(
    await database.run(embeddings.read(userId, MODEL, ["h-1", "h-2"])),
    new Map([["h-2", [1, 0, 0]]]),
  );
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", userId), 2);
});

test("pruning keeps the hashes named and drops the rest, an empty list dropping every row, and touches no other account", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const { embeddings } = database.store;
  const rows = [
    { hash: "h-1", vector: [1] },
    { hash: "h-2", vector: [2] },
    { hash: "h-3", vector: [3] },
  ];
  await database.run(embeddings.write(userId, MODEL, rows, NOW));
  await database.run(embeddings.write(other, MODEL, rows, NOW));

  assert.equal(await database.run(embeddings.prune(userId, ["h-1", "h-3", "h-9"])), 1);
  assert.deepEqual(
    await database.run(embeddings.read(userId, MODEL, ["h-1", "h-2", "h-3"])),
    new Map([
      ["h-1", [1]],
      ["h-3", [3]],
    ]),
  );
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", other), 3);

  assert.equal(await database.run(embeddings.prune(userId, [])), 2);
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", userId), 0);
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", other), 3);
});

test("the cache goes with the account", async () => {
  const userId = await database.createUser();
  await database.run(
    database.store.embeddings.write(userId, MODEL, [{ hash: "h-1", vector: [1, 2] }], NOW),
  );
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", userId), 1);
  await deleteUser(database.run, userId);
  assert.equal(await countRowsForUser(database.run, "workspace_embedding", userId), 0);
});
