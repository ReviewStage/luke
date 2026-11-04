import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  clearStandingFirewall,
  dropStaleFirewalls,
  readStandingFirewall,
  replaceStandingFirewall,
} from "../sandbox-firewall-store.js";

/**
 * The record of what stands at a sandbox session's firewall, over a real
 * dialect: a write lands only from the version its writer read, a write
 * that leaves nothing deletes the row, one account's session row is neither
 * read nor replaced through another's, and a clear and the sweep's drop
 * delete rows by session and by age. The sealed column is opaque text here,
 * as the store holds it. Synthetic accounts, sessions, and seals throughout.
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

/** A row's next state under a fresh version, its seal standing in as text. */
const nextState = (sealedEntries: string) => ({ version: randomUUID(), sealedEntries });

it.layer(getTestDB())("a sandbox session's firewall record", (it) => {
  it.effect(
    "a write lands only from the version its writer read, and one that leaves nothing deletes the row",
    () =>
      Effect.gen(function* () {
        const owner = yield* openOwner;
        const first = nextState("sealed-github");
        const rival = nextState("sealed-rival");

        assert.equal(yield* replaceStandingFirewall(owner, undefined, first, AT), true);
        // A second writer that also read nothing standing finds the row written and must read again.
        assert.equal(yield* replaceStandingFirewall(owner, undefined, rival, AT), false);

        const second = nextState("sealed-github-and-swap");
        assert.equal(yield* replaceStandingFirewall(owner, first.version, second, LATER), true);
        assert.equal(yield* replaceStandingFirewall(owner, first.version, rival, LATER), false);
        assert.deepEqual(yield* readStandingFirewall(owner), second);

        assert.equal(yield* replaceStandingFirewall(owner, first.version, undefined, LATER), false);
        assert.equal(yield* replaceStandingFirewall(owner, second.version, undefined, LATER), true);
        assert.equal(yield* readStandingFirewall(owner), undefined);
      }),
  );

  it.effect("one account's session row is neither read nor replaced through another's", () =>
    Effect.gen(function* () {
      const owner = yield* openOwner;
      const other = yield* openOwner;
      const theirs = { userId: other.userId, sandboxSessionId: owner.sandboxSessionId };
      const standing = nextState("sealed-owner");
      yield* replaceStandingFirewall(owner, undefined, standing, AT);

      assert.equal(yield* readStandingFirewall(theirs), undefined);
      const landed = [
        yield* replaceStandingFirewall(theirs, undefined, nextState("sealed-other"), LATER),
        yield* replaceStandingFirewall(theirs, standing.version, nextState("sealed-other"), LATER),
        yield* replaceStandingFirewall(theirs, standing.version, undefined, LATER),
      ];

      assert.deepEqual(landed, [false, false, false]);
      assert.deepEqual(yield* readStandingFirewall(owner), standing);
    }),
  );

  it.effect(
    "a clear deletes the session's row, and the sweep drops only the rows last written before its bound",
    () =>
      Effect.gen(function* () {
        const cleared = yield* openOwner;
        const stale = yield* openOwner;
        const fresh = yield* openOwner;
        yield* replaceStandingFirewall(cleared, undefined, nextState("sealed-cleared"), LATER);
        yield* replaceStandingFirewall(stale, undefined, nextState("sealed-stale"), AT);
        const kept = nextState("sealed-fresh");
        yield* replaceStandingFirewall(fresh, undefined, kept, LATER);

        yield* clearStandingFirewall(cleared.sandboxSessionId);
        const dropped = yield* dropStaleFirewalls(new Date(AT.getTime() + 1));

        assert.equal(yield* readStandingFirewall(cleared), undefined);
        assert.equal(yield* readStandingFirewall(stale), undefined);
        assert.ok(dropped >= 1);
        assert.deepEqual(yield* readStandingFirewall(fresh), kept);
      }),
  );
});
