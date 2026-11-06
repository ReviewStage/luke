import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  dropStaleFirewalls,
  keepFirewallLaunch,
  readFirewallLaunch,
} from "../sandbox-firewall-store.js";

/**
 * The swaps a runner's launch keeps for its sandbox session, over a real
 * dialect: a launch replaces the one kept before it, one account's session
 * row is never read through another's, and the sweep's drop deletes rows by
 * age. The sealed column is
 * opaque text here, as the store holds it. Synthetic accounts, sessions,
 * agents, and seals throughout.
 */

const AT = new Date("2026-11-04T12:00:00Z");
const LATER = new Date("2026-11-04T12:05:00Z");

/** An account of its own and a sandbox session of its agent's. */
const openOwner = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return { userId, sandboxSessionId: `sbx_${randomUUID()}` };
});

/** A launch under a fresh id, its seal standing in as text. */
const launchOf = (sealedEntries: string) => ({
  version: randomUUID(),
  agentId: "agent-fixture",
  sealedEntries,
});

it.layer(getTestDB())("the launch kept at a sandbox session's firewall", (it) => {
  it.effect("a launch replaces the one kept before it", () =>
    Effect.gen(function* () {
      const owner = yield* openOwner;

      yield* keepFirewallLaunch(owner, launchOf("sealed-first"), AT);
      yield* keepFirewallLaunch(owner, launchOf("sealed-relaunch"), LATER);
      assert.deepEqual(yield* readFirewallLaunch(owner), {
        agentId: "agent-fixture",
        sealedEntries: "sealed-relaunch",
      });
    }),
  );

  it.effect(
    "one account's session row is never read through another's, whose launch keeps to a row of its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openOwner;
        const other = yield* openOwner;
        const theirs = { userId: other.userId, sandboxSessionId: owner.sandboxSessionId };
        yield* keepFirewallLaunch(owner, launchOf("sealed-owner"), AT);

        assert.equal(yield* readFirewallLaunch(theirs), undefined);
        yield* keepFirewallLaunch(theirs, launchOf("sealed-other-own"), LATER);

        assert.equal((yield* readFirewallLaunch(owner))?.sealedEntries, "sealed-owner");
        assert.equal((yield* readFirewallLaunch(theirs))?.sealedEntries, "sealed-other-own");
      }),
  );

  it.effect("the sweep drops only the rows last written before its bound", () =>
    Effect.gen(function* () {
      const stale = yield* openOwner;
      const fresh = yield* openOwner;
      yield* keepFirewallLaunch(stale, launchOf("sealed-stale"), AT);
      const kept = launchOf("sealed-fresh");
      yield* keepFirewallLaunch(fresh, kept, LATER);

      const dropped = yield* dropStaleFirewalls(new Date(AT.getTime() + 1));

      assert.equal(yield* readFirewallLaunch(stale), undefined);
      assert.ok(dropped >= 1);
      assert.equal((yield* readFirewallLaunch(fresh))?.sealedEntries, kept.sealedEntries);
    }),
  );
});
