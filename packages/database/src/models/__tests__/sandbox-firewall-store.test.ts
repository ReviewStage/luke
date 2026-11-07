import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openTaskAgent, openWorkspace } from "../../testing/index.js";
import { keepFirewallLaunch, readFirewallLaunch } from "../sandbox-firewall-store.js";

/**
 * The swaps a runner's launch keeps for its sandbox session, over a real
 * dialect: a launch replaces the one kept before it, one account's session
 * row is never read through another's, a launch deletes its agent's rows
 * for the account's other sessions, and a row goes with its agent. The sealed column is
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
  it.effect("a launch replaces the one kept before it", () =>
    Effect.gen(function* () {
      const owner = yield* openOwner;

      yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-first"), AT);
      yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-relaunch"), LATER);
      assert.deepEqual(yield* readFirewallLaunch(owner), {
        agentId: owner.agentId,
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
        yield* keepFirewallLaunch(owner, launchOf(owner.agentId, "sealed-owner"), AT);

        assert.equal(yield* readFirewallLaunch(theirs), undefined);
        yield* keepFirewallLaunch(theirs, launchOf(other.agentId, "sealed-other-own"), LATER);

        assert.equal((yield* readFirewallLaunch(owner))?.sealedEntries, "sealed-owner");
        assert.equal((yield* readFirewallLaunch(theirs))?.sealedEntries, "sealed-other-own");
      }),
  );

  it.effect(
    "a launch deletes its agent's rows for the account's other sessions, leaving the account's other agents' rows",
    () =>
      Effect.gen(function* () {
        const ended = yield* openOwner;
        const relaunched = { userId: ended.userId, sandboxSessionId: `sbx_${randomUUID()}` };
        const neighbor = {
          userId: ended.userId,
          sandboxSessionId: `sbx_${randomUUID()}`,
          agentId: yield* openTaskAgent(ended.userId, yield* openWorkspace(ended.userId), null),
        };
        yield* keepFirewallLaunch(ended, launchOf(ended.agentId, "sealed-ended"), AT);
        yield* keepFirewallLaunch(neighbor, launchOf(neighbor.agentId, "sealed-neighbor"), AT);

        yield* keepFirewallLaunch(relaunched, launchOf(ended.agentId, "sealed-relaunched"), LATER);

        assert.equal(yield* readFirewallLaunch(ended), undefined);
        assert.equal((yield* readFirewallLaunch(relaunched))?.sealedEntries, "sealed-relaunched");
        assert.equal((yield* readFirewallLaunch(neighbor))?.sealedEntries, "sealed-neighbor");
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
