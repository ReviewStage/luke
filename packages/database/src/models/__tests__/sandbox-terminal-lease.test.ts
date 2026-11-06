import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimCredentialRenewal,
  credentialRenewedAt,
  holdSandbox,
  releaseCredentialRenewal,
  sandboxHeld,
} from "../sandbox-terminal-lease.js";

/**
 * The lease a developer's typing holds on a coding agent's sandbox, over a
 * real dialect: it moves on and never back and holds until its instant, it
 * goes with its conversation, and the GitHub token's renewal at its
 * firewall is claimed once while due and read back on its own session. Every conversation is minted per test and every
 * read is of its ids, since the lease is the deployment's and not an
 * account's.
 *
 * Synthetic accounts, conversations, and sessions throughout.
 */

const AT = Date.UTC(2026, 9, 14, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);

/** A coding agent's conversation that ran in a session of its own. */
const openAgent = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    const [row] = yield* db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.AGENT, runtimeSessionId: `wrun_${randomUUID()}` })
      .returning({ id: conversations.id });
    assert.ok(row);
    return { userId, conversationId: row.id };
  });

it.layer(getTestDB())("the sandbox terminal lease", (it) => {
  it.effect("a lease holds until its instant, and a slower writer never moves it back", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openAgent();
      const unheld = yield* sandboxHeld(conversationId, at(0));
      yield* holdSandbox(conversationId, at(5));
      yield* holdSandbox(conversationId, at(3));

      assert.equal(unheld, false, "no lease, no hold");
      assert.equal(yield* sandboxHeld(conversationId, at(4)), true);
      assert.equal(
        yield* sandboxHeld(conversationId, at(5)),
        false,
        "the lease ends at its instant",
      );
      yield* holdSandbox(conversationId, at(9));
      assert.equal(yield* sandboxHeld(conversationId, at(8)), true, "typing moves it on");
    }),
  );

  it.effect("a lease goes with its conversation", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { conversationId } = yield* openAgent();
      yield* holdSandbox(conversationId, at(5));
      yield* db.delete(conversations).where(eq(conversations.id, conversationId));

      assert.equal(yield* sandboxHeld(conversationId, at(0)), false);
    }),
  );

  it.effect(
    "the GitHub token's renewal is claimed once per lease while due, so two windows mint one token",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        const unleased = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        const first = yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        const second = yield* claimCredentialRenewal(conversationId, "sbs_1", at(1), at(-49));
        const due = yield* claimCredentialRenewal(conversationId, "sbs_1", at(51), at(1));
        const none = yield* claimCredentialRenewal(
          unleased.conversationId,
          "sbs_1",
          at(0),
          at(-50),
        );

        assert.deepEqual([first, second, due, none], [true, false, true, false]);
      }),
  );

  it.effect(
    "a renewal given back is claimed again at the next check, and a later claim is not given back",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const retried = yield* claimCredentialRenewal(conversationId, "sbs_1", at(5), at(-45));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const stillClaimed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_1",
          at(10),
          at(-40),
        );

        assert.equal(retried, true, "the failed claim was given back");
        assert.equal(stillClaimed, false, "a stale give-back leaves the later claim standing");
      }),
  );

  it.effect(
    "a resumed sandbox's new session claims its renewal at once, however lately the old one was renewed",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        yield* claimCredentialRenewal(conversationId, "sbs_before_stop", at(0), at(-50));
        const sameSession = yield* claimCredentialRenewal(
          conversationId,
          "sbs_before_stop",
          at(10),
          at(-40),
        );
        const resumed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(10),
          at(-40),
        );
        const resumedAgain = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(11),
          at(-39),
        );

        assert.deepEqual([sameSession, resumed, resumedAgain], [false, true, false]);
      }),
  );

  it.effect("a give-back from another session at the same instant leaves the standing claim", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openAgent();
      yield* holdSandbox(conversationId, at(5));

      yield* claimCredentialRenewal(conversationId, "sbs_resumed", at(0), at(-50));
      yield* releaseCredentialRenewal(conversationId, "sbs_before_stop", at(0));
      const claimedAgain = yield* claimCredentialRenewal(
        conversationId,
        "sbs_resumed",
        at(1),
        at(-49),
      );

      assert.equal(claimedAgain, false, "the resumed session's claim still stands");
    }),
  );

  it.effect(
    "the token's last renewal reads on its own session alone, and none once its claim is given back",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        const never = yield* credentialRenewedAt(conversationId, "sbs_1");
        yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        const renewed = yield* credentialRenewedAt(conversationId, "sbs_1");
        const otherSession = yield* credentialRenewedAt(conversationId, "sbs_resumed");
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const givenBack = yield* credentialRenewedAt(conversationId, "sbs_1");

        assert.deepEqual(
          [never, renewed, otherSession, givenBack],
          [Option.none(), Option.some(at(0)), Option.none(), Option.none()],
        );
      }),
  );
});
