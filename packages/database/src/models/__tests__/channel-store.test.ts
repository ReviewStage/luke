import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  archiveChannel,
  CHANNEL_NAME_REFUSAL,
  CHANNEL_WRITE_REFUSAL,
  type ChannelWriteRefusal,
  createChannel,
  ensureGeneralChannel,
  listChannelLooks,
  listChannels,
  openChannels,
  renameChannel,
  resolveChannel,
  stampChannelLook,
} from "../channel-store.js";

/**
 * A workspace's channels over a real dialect: its #general is minted once
 * however often and however concurrently it is asked for, every member reads
 * the workspace's channels and an account outside it reads none, and a
 * member's look moves only forward and is never stamped by an outsider. Any
 * member makes, renames, and archives a channel, an outsider none, and
 * #general is never renamed or archived; an agent's name for a channel
 * finds only an open one.
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

  it.effect(
    "any member makes, renames, and archives a channel, an outsider none, and #general stays named and open",
    () =>
      Effect.gen(function* () {
        const [dean, charles, outsider] = [
          yield* openAccount,
          yield* openAccount,
          yield* openAccount,
        ];
        const workspace = yield* openWorkspace(dean);
        yield* joinWorkspace(workspace, charles);
        const draft = (name: string) => ({ name, purpose: "Desktop and panel.", project: false });

        const app = Result.getOrThrow(
          yield* createChannel(charles, workspace, draft("app"), new Date(5)),
        );
        const general = yield* ensureGeneralChannel(workspace, new Date(6));
        const outcomes: readonly Result.Result<unknown, ChannelWriteRefusal>[] = [
          yield* createChannel(dean, workspace, draft("app"), new Date(7)),
          yield* createChannel(dean, workspace, draft("general"), new Date(7)),
          yield* createChannel(outsider, workspace, draft("infra"), new Date(7)),
          yield* renameChannel(dean, workspace, general, "lobby"),
          yield* archiveChannel(dean, workspace, general, new Date(7)),
          yield* renameChannel(outsider, workspace, app.id, "web"),
          yield* archiveChannel(outsider, workspace, app.id, new Date(7)),
        ];
        const refused = outcomes.map((outcome) =>
          Result.isFailure(outcome) ? outcome.failure : "written",
        );
        const renamed = yield* renameChannel(dean, workspace, app.id, "web");
        const archived = yield* archiveChannel(dean, workspace, app.id, new Date(8));
        const remade = yield* createChannel(dean, workspace, draft("web"), new Date(9));

        assert.deepEqual(app, {
          id: app.id,
          name: "app",
          purpose: "Desktop and panel.",
          project: false,
          createdBy: charles,
          createdAt: 5,
        });
        assert.deepEqual(refused, [
          CHANNEL_WRITE_REFUSAL.NAME_TAKEN,
          CHANNEL_WRITE_REFUSAL.NAME_TAKEN,
          CHANNEL_WRITE_REFUSAL.NOT_FOUND,
          CHANNEL_WRITE_REFUSAL.GENERAL,
          CHANNEL_WRITE_REFUSAL.GENERAL,
          CHANNEL_WRITE_REFUSAL.NOT_FOUND,
          CHANNEL_WRITE_REFUSAL.NOT_FOUND,
        ]);
        assert.deepEqual(
          Result.map(renamed, (row) => row.name),
          Result.succeed("web"),
        );
        assert.ok(Result.isSuccess(archived));
        assert.ok(Result.isSuccess(remade));
        assert.deepEqual(
          (yield* listChannels(charles, workspace)).map((row) => [row.id, row.name]),
          [
            [general, "general"],
            [Result.getOrThrow(remade).id, "web"],
          ],
        );
      }),
  );

  it.effect(
    "a channel's name finds the open one, refusing one only archived or unknown, and an outsider finds none",
    () =>
      Effect.gen(function* () {
        const [dean, outsider] = [yield* openAccount, yield* openAccount];
        const workspace = yield* openWorkspace(dean);
        const draft = { name: "infra", purpose: "CI and releases.", project: false };
        const infra = Result.getOrThrow(yield* createChannel(dean, workspace, draft, new Date(1)));
        const retired = Result.getOrThrow(
          yield* createChannel(dean, workspace, { ...draft, name: "retired" }, new Date(1)),
        );
        yield* archiveChannel(dean, workspace, retired.id, new Date(2));

        assert.deepEqual(yield* resolveChannel(dean, workspace, "infra"), Result.succeed(infra));
        assert.deepEqual(
          yield* resolveChannel(dean, workspace, "retired"),
          Result.fail(CHANNEL_NAME_REFUSAL.ARCHIVED),
        );
        assert.deepEqual(
          yield* resolveChannel(dean, workspace, "nowhere"),
          Result.fail(CHANNEL_NAME_REFUSAL.UNKNOWN),
        );
        assert.deepEqual(
          yield* resolveChannel(outsider, workspace, "infra"),
          Result.fail(CHANNEL_NAME_REFUSAL.UNKNOWN),
        );
        assert.deepEqual(
          (yield* openChannels(dean, workspace, new Date(3))).map((row) => row.name),
          ["general", "infra"],
        );
        assert.deepEqual(yield* openChannels(outsider, workspace, new Date(3)), []);
      }),
  );
});
