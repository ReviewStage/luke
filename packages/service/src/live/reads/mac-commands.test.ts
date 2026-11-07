import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { claimMacCommand, queueMacCommand } from "@repo/database/models/mac-command-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { MAC_COMMANDS_READ, macCommandsOfLiveRows } from "@repo/features/mac-command-live";
import {
  MAC_COMMAND_KIND,
  type MacCommand,
  type MacCommandKind,
  macCommandKindsQuery,
} from "@repo/features/mac-command-wire";
import { sql } from "drizzle-orm";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { macCommandsRead } from "./mac-commands.js";

/** The instant the clock reads now, which every command these tests queue is at or after. */
const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

/** The account's unclaimed commands of the kinds given as a Mac following them live decodes them, the statement run as Realtime runs it. */
const liveCommandsOf = (userId: string, kinds: readonly MacCommandKind[]) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(
      macCommandsRead.statements({ userId, kinds: macCommandKindsQuery(kinds) }),
    );
    const sqlClient = yield* SqlClient.SqlClient;
    const commands = yield* sqlClient.unsafe(statements.commands.sql, [
      ...statements.commands.params,
    ]);
    return macCommandsOfLiveRows(
      yield* Schema.decodeUnknownEffect(MAC_COMMANDS_READ.rows)({ commands }),
    );
  });

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  return { owner, other };
});

const command = (timeoutSeconds = 60): MacCommand => ({
  id: randomUUID(),
  kind: MAC_COMMAND_KIND.SHELL,
  command: "git branch --show-current",
  timeoutSeconds,
});

/**
 * A row of a kind no read names now, as a service that still queued Mac
 * Browser commands left one waiting, written as that build wrote it; its id.
 */
const queueOtherKind = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const queuedAt = (yield* now).toISOString();
    yield* db.execute(
      sql`INSERT INTO mac_command (id, user_id, kind, timeout_seconds, queued_at)
          VALUES (${id}, ${userId}, 'browser', 30, ${queuedAt})`,
    );
    return id;
  });

/** What every Mac's read names: shell alone. */
const SHELL_ONLY = [MAC_COMMAND_KIND.SHELL];

it.layer(getTestDB())("the account's Mac commands' live read", (it) => {
  it.effect(
    "the live statement delivers the account's unclaimed commands of the kinds named, the earliest first, and one claimed by its id leaves it, claimed once and by its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const [first, second] = [command(), command(30)];
        yield* queueMacCommand(owner, first);
        yield* queueMacCommand(owner, second);
        yield* queueOtherKind(owner);
        yield* queueMacCommand(other, command());

        assert.deepEqual(
          (yield* liveCommandsOf(owner, SHELL_ONLY)).map(({ id }) => id).toSorted(),
          [first.id, second.id].toSorted(),
          "a row of a kind not named is left out",
        );
        assert.equal(
          (yield* liveCommandsOf(other, SHELL_ONLY)).length,
          1,
          "another's are their own",
        );

        assert.deepEqual(
          yield* claimMacCommand(other, second.id, since, SHELL_ONLY),
          Option.none(),
        );
        assert.deepEqual(
          yield* claimMacCommand(owner, second.id, since, SHELL_ONLY),
          Option.some(second),
        );
        assert.deepEqual(
          yield* claimMacCommand(owner, second.id, since, SHELL_ONLY),
          Option.none(),
        );
        assert.deepEqual(yield* liveCommandsOf(owner, SHELL_ONLY), [first]);
      }),
  );

  it.effect("a command queued before the claim window began is never claimed by its id", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const queued = command();
      yield* queueMacCommand(owner, queued);
      const later = new Date((yield* Clock.currentTimeMillis) + 1);

      assert.deepEqual(
        yield* claimMacCommand(owner, queued.id, later, [MAC_COMMAND_KIND.SHELL]),
        Option.none(),
      );
      assert.deepEqual(yield* liveCommandsOf(owner, [MAC_COMMAND_KIND.SHELL]), [queued]);
    }),
  );
});
