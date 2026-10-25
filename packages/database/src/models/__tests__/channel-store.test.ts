import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  ensureGeneralChannel,
  listChannelLooks,
  listChannels,
  stampChannelLook,
} from "../channel-store.js";

/**
 * A workspace's channels over a real dialect: its #general is minted once
 * however often and however concurrently it is asked for, every member reads
 * the workspace's channels and an account outside it reads none, and a
 * member's look moves only forward and is never stamped by an outsider.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("a workspace's channels", (it) => {
  it.effect("a workspace's #general is minted once, and only its members read it", () =>
    Effect.gen(function* () {
      const [dean, charles, outsider] = [
        yield* openAccount,
        yield* openAccount,
        yield* openAccount,
      ];
      const workspace = yield* openWorkspace(dean);
      yield* joinWorkspace(workspace, charles);
      const elsewhere = yield* openWorkspace(outsider);

      const minted = yield* Effect.all(
        [
          ensureGeneralChannel(workspace, new Date(1)),
          ensureGeneralChannel(workspace, new Date(1)),
        ],
        { concurrency: "unbounded" },
      );
      const again = yield* ensureGeneralChannel(workspace, new Date(2));
      const theirs = yield* ensureGeneralChannel(elsewhere, new Date(3));

      assert.deepEqual(minted, [again, again]);
      assert.notEqual(theirs, again);
      const general = {
        id: again,
        name: "general",
        purpose: "Anything that belongs to no other channel.",
        project: false,
        createdBy: null,
        createdAt: 1,
      };
      assert.deepEqual(yield* listChannels(charles, workspace), [general]);
      assert.deepEqual(yield* listChannels(outsider, workspace), []);
      assert.deepEqual(
        (yield* listChannels(outsider, elsewhere)).map((row) => row.id),
        [theirs],
      );
    }),
  );

  it.effect("a member's look moves only forward, and an outsider stamps none", () =>
    Effect.gen(function* () {
      const [dean, outsider] = [yield* openAccount, yield* openAccount];
      const workspace = yield* openWorkspace(dean);
      const elsewhere = yield* openWorkspace(dean);
      const general = yield* ensureGeneralChannel(workspace, new Date(1));
      const otherGeneral = yield* ensureGeneralChannel(elsewhere, new Date(1));

      yield* stampChannelLook(dean, general, new Date(20));
      yield* stampChannelLook(dean, general, new Date(10));
      yield* stampChannelLook(dean, otherGeneral, new Date(30));
      yield* stampChannelLook(outsider, general, new Date(40));

      assert.deepEqual(yield* listChannelLooks(dean, workspace), [
        { channelId: general, lookedAt: 20 },
      ]);
      assert.deepEqual(yield* listChannelLooks(outsider, workspace), []);
    }),
  );
});
