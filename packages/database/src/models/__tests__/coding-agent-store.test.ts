import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { conversations, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  delegationsOf,
  readCodingAgent,
  recordTurnFastRefused,
  turnUsagesOf,
  writeDelegation,
} from "../coding-agent-store.js";
import { conversationReachableBy } from "../recorded-session.js";

/**
 * The workers a coding agent's conversation delegated to, over a real
 * dialect: every delegation its conversation recorded by a kept call, oldest
 * first, each on the pair it recorded, and none of another account's. And
 * a turn Anthropic refused Fast for, as its usage reads it. And an agent
 * with no plan, which its workspace's members reach and no one else does.
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

/** A workspace the account is a member of, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(organization)
      .values({ id, name: "Test Workspace", slug: `workspace-${id}`, createdAt: now });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId: id, userId, role: "owner", createdAt: now });
    return id;
  });

/** An agent of the workspace on no plan, as an automation's run leaves one. */
const planlessAgent = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = yield* openConversation(userId, CONVERSATION_KIND.CODING_AGENT);
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      task: "Sweep the flaky tests.",
      repository: "acme/api",
      repositories: ["acme/api"],
      idempotencyKey: randomUUID(),
    });
    return { agentId: id, conversationId };
  });

it.layer(getTestDB())("the coding-agent store's agents with no plan", (it) => {
  it.effect(
    "an agent with no plan and its conversation read under its workspace for its starter and a member who did not start it, and as none for an account outside the workspace",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* Effect.flatMap(Database, (db) =>
          db.insert(member).values({
            id: randomUUID(),
            organizationId: workspace,
            userId: teammate,
            role: "member",
            createdAt: new Date("2026-10-14T12:00:00Z"),
          }),
        );
        yield* openWorkspace(outsider);
        const { agentId, conversationId } = yield* planlessAgent(starter, workspace);

        const read = Option.getOrThrow(yield* readCodingAgent(teammate, agentId));
        assert.deepEqual(
          [read.planId, read.organizationId, read.userId],
          [null, workspace, starter],
        );
        assert.ok(Option.isNone(yield* readCodingAgent(outsider, agentId)));
        assert.deepEqual(
          [
            yield* conversationReachableBy(starter, conversationId),
            yield* conversationReachableBy(teammate, conversationId),
            yield* conversationReachableBy(outsider, conversationId),
          ],
          [true, true, false],
          "the agent's conversation is its workspace's, as its sessions are admitted",
        );
      }),
  );
});
