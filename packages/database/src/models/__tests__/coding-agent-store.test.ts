import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  delegationsOf,
  recordTurnFastRefused,
  turnUsagesOf,
  writeDelegation,
} from "../coding-agent-store.js";

/**
 * The workers a coding agent's conversation delegated to, over a real
 * dialect: every delegation its conversation recorded by a kept call, oldest
 * first, each on the pair it recorded, and none of another account's. And
 * a turn Anthropic refused Fast for, as its usage reads it.
 *
 * Synthetic accounts and conversations throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

const openConversation = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
  parentConversationId?: string,
  createdAt?: Date,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(conversations).values({
      id,
      userId,
      kind,
      ...(parentConversationId === undefined ? undefined : { parentConversationId }),
      ...(createdAt === undefined ? undefined : { createdAt }),
    });
    return id;
  });

it.layer(getTestDB())("the coding-agent store's delegations", (it) => {
  it.effect(
    "a conversation's delegations are listed oldest first on the pair each recorded, and another account's conversation reads none of them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
        const later = yield* openConversation(
          owner,
          CONVERSATION_KIND.CHILD,
          agent,
          new Date("2026-10-13T12:00:02Z"),
        );
        const first = yield* openConversation(
          owner,
          CONVERSATION_KIND.CHILD,
          agent,
          new Date("2026-10-13T12:00:01Z"),
        );
        yield* writeDelegation(later, "call-2", { model: "openai/gpt-6.1-sol", effort: "low" });
        yield* writeDelegation(first, "call-1", {
          model: "anthropic/claude-opus-5.5",
          effort: "high",
        });

        const listed = yield* delegationsOf({ userId: owner, conversationId: agent });
        assert.deepEqual(
          listed.map((each) => [each.callId, each.childConversationId, each.model, each.effort]),
          [
            ["call-1", first, "anthropic/claude-opus-5.5", "high"],
            ["call-2", later, "openai/gpt-6.1-sol", "low"],
          ],
        );
        assert.deepEqual(yield* delegationsOf({ userId: other, conversationId: agent }), []);
      }),
  );
});

/** A settled turn of the conversation, with usage recorded, as the relay leaves one. */
const settledTurn = (userId: string, conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(turns).values({
      id,
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      model: "anthropic/claude-opus-5.5-fast",
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 },
    });
    return id;
  });

it.layer(getTestDB())("the coding-agent store's Fast refusals", (it) => {
  it.effect(
    "a turn marked refused Fast reads so beside its usage, and another account's mark writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const agent = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
        const refused = yield* settledTurn(owner, agent);
        yield* settledTurn(owner, agent);

        yield* recordTurnFastRefused(other, refused);
        const unmarked = yield* turnUsagesOf(owner, agent);
        assert.deepEqual(
          unmarked.map((turn) => turn.fastRefused),
          [false, false],
        );

        yield* recordTurnFastRefused(owner, refused);
        const marked = yield* turnUsagesOf(owner, agent);
        assert.deepEqual(marked.map((turn) => turn.fastRefused).sort(), [false, true]);
      }),
  );
});
