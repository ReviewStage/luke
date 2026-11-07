import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openTaskAgent, openWorkspace } from "../../testing/index.js";
import {
  clearStandingFirewall,
  countStandingFirewalls,
  dropStaleFirewalls,
  keepFirewallLaunch,
  listStandingFirewalls,
  readFirewallLaunch,
  renewFirewallLaunch,
} from "../sandbox-firewall-store.js";

/**
 * The swaps a runner's launch keeps for its sandbox session, over a real
 * dialect: a launch replaces the one kept before it, a renewal writes over
 * the row as it stands and never makes one, one account's session row is
 * neither read nor renewed through another's, a clear and the sweep's drop delete rows by session and by
 * age, and a row goes with its agent. The sealed column is
 * opaque text here, as the store holds it. Synthetic accounts, sessions,
 * agents, and seals throughout.
 */

const AT = new Date("2026-11-04T12:00:00Z");
const LATER = new Date("2026-11-04T12:05:00Z");

/** An account of its own, its agent, and a sandbox session of that agent's. */
const openOwner = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const agentId = yield* openTaskAgent(userId, yield* openWorkspace(userId), null);
  return { userId, sandboxSessionId: `sbx_${randomUUID()}`, agentId };
});

/** A launch of the agent's under a fresh id, its seal standing in as text. */
const launchOf = (agentId: string, sealedEntries: string) => ({
  version: randomUUID(),
  agentId,
  sealedEntries,
});

it.layer(getTestDB())("the launch kept at a sandbox session's firewall", (it) => {
  it.effect(
    "a launch replaces the one kept before it, a renewal writes over the row as it stands, and a cleared row no renewal brings back",
    () =>
      Effect.gen(function* () {
        const owner = yield* openOwner;

        yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-first"), AT);
        yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-relaunch"), LATER);
        assert.deepEqual(yield* readFirewallLaunch(owner), {
          agentId: owner.agentId,
          sealedEntries: "sealed-relaunch",
        });
        yield* renewFirewallLaunch(owner, "sealed-renewed", LATER);
        assert.deepEqual(yield* readFirewallLaunch(owner), {
          agentId: owner.agentId,
          sealedEntries: "sealed-renewed",
        });

        yield* clearStandingFirewall(owner.sandboxSessionId);
        yield* renewFirewallLaunch(owner, "sealed-late", LATER);
        assert.equal(yield* readFirewallLaunch(owner), undefined);
      }),
  );

  it.effect(
    "one account's session row is neither read nor renewed through another's, whose launch keeps to a row of its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openOwner;
        const other = yield* openOwner;
        const theirs = { userId: other.userId, sandboxSessionId: owner.sandboxSessionId };
        yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-owner"), AT);

        assert.equal(yield* readFirewallLaunch(theirs), undefined);
        yield* renewFirewallLaunch(theirs, "sealed-other", LATER);
        yield* keepFirewallLaunch(theirs, launchOf(other.agentId, "sealed-other-own"), LATER);

        assert.equal((yield* readFirewallLaunch(owner))?.sealedEntries, "sealed-owner");
        assert.equal((yield* readFirewallLaunch(theirs))?.sealedEntries, "sealed-other-own");
      }),
  );

  it.effect(
    "a clear deletes the session's row, the sweep drops only the rows last written before its bound, and the sweep's list names the sessions whose row stands",
    () =>
      Effect.gen(function* () {
        const cleared = yield* openOwner;
        const stale = yield* openOwner;
        const fresh = yield* openOwner;
        yield* keepFirewallLaunch(cleared, launchOf(cleared.agentId, "sealed-cleared"), LATER);
        yield* keepFirewallLaunch(stale, launchOf(stale.agentId, "sealed-stale"), AT);
        const kept = launchOf(fresh.agentId, "sealed-fresh");
        yield* keepFirewallLaunch(fresh, kept, LATER);

        yield* clearStandingFirewall(cleared.sandboxSessionId);
        const dropped = yield* dropStaleFirewalls(new Date(AT.getTime() + 1));

        assert.equal(yield* readFirewallLaunch(cleared), undefined);
        assert.equal(yield* readFirewallLaunch(stale), undefined);
        assert.ok(dropped >= 1);
        assert.equal((yield* readFirewallLaunch(fresh))?.sealedEntries, kept.sealedEntries);
        const standing = yield* countStandingFirewalls();
        const listed = (yield* listStandingFirewalls(0, standing)).map(
          (each) => each.sandboxSessionId,
        );
        assert.equal(listed.length, standing);
        assert.ok(listed.includes(fresh.sandboxSessionId));
        assert.ok(!listed.includes(cleared.sandboxSessionId));
      }),
  );

  it.effect("deleting the agent deletes its rows", () =>
    Effect.gen(function* () {
      const owner = yield* openOwner;
      yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-gone"), AT);

      yield* Effect.flatMap(Database, (db) =>
        db.delete(agentTable).where(eq(agentTable.id, owner.agentId)),
      );

      assert.equal(yield* readFirewallLaunch(owner), undefined);
    }),
  );
});
