import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { type CodingAgent, createCodingAgent } from "@luke/database/models/coding-agent-store";
import { listMemories, MEMORY_OUTCOME } from "@luke/database/models/memory-store";
import { user } from "@luke/database/schemas/auth";
import type { StoredAutomationOrigin } from "@luke/database/schemas/coding-agent";
import { messages, turns } from "@luke/database/schemas/storage";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { CLAUDE_CODE_TOOL } from "@luke/features/agent-tools";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Option } from "effect";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
} from "../core.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { AGENT_CALLER, type CodingAgentCall } from "./coding-agent-tools.js";
import { MEMORY_PROVENANCE_REFUSAL } from "./memory-provenance.js";
import { runAgentRemember } from "./memory-tools.js";

/**
 * memory-provenance.test.ts -- a coding agent's `remember` refused on a turn whose words are no member's.
 *
 * Through `runAgentRemember`, over a real dialect, with the turn under way
 * written as the relay writes it: a turn an automation's run opened keeps
 * nothing, an eve agent an automation started included, whose first line
 * the relay wrote with no sender, and neither does an operator's turn its heartbeat opened, nor a
 * turn whose journal already holds a web read, eve's or Claude Code's; a
 * turn a member's own line opened, which read nothing of the web, keeps the
 * memory; and a turn that settled refuses nothing. Synthetic accounts,
 * workspaces, and words throughout.
 */

const FACT = "The web server's store tests run on PGlite through test:store.";

/** A member with Memory on, in a workspace of their own, and an agent of the kind given there. */
const openAgent = (
  kind: typeof CODING_AGENT_KIND.CODER | typeof CODING_AGENT_KIND.OPERATOR,
  automationOrigin?: StoredAutomationOrigin,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });
    const workspaceId = yield* openWorkspace(userId);
    const place =
      kind === CODING_AGENT_KIND.OPERATOR
        ? ({
            taskId: null,
            organizationId: workspaceId,
            planSnapshot: null,
            prompt: null,
            kind,
          } as const)
        : ({
            taskId: null,
            organizationId: workspaceId,
            planSnapshot: null,
            prompt: "Tidy the docs.",
          } as const);
    const started = yield* createCodingAgent(userId, {
      ...place,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      automationOrigin,
    });
    assert.ok(Option.isSome(started));
    return { agent: started.value.agent, workspaceId };
  });

/** What sent a turn's opening line, as its row keeps it. */
type Opener =
  | { readonly sender: undefined }
  | { readonly sender: typeof MESSAGE_SENDER.MEMBER }
  | { readonly sender: typeof MESSAGE_SENDER.AUTOMATION; readonly name: string };

/**
 * A turn of the agent's, as the relay writes one: its row, the line that
 * opened it, and its journal holding a call of each tool named.
 */
const writeTurn = (
  agent: CodingAgent,
  opener: Opener,
  called: readonly string[],
  status: typeof TURN_STATUS.RUNNING | typeof TURN_STATUS.SETTLED = TURN_STATUS.RUNNING,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = new Date();
    const own = { userId: agent.userId, conversationId: agent.conversationId };
    const [turn] = yield* db
      .insert(turns)
      .values({ ...own, origin: TURN_ORIGIN.TYPED, status, queuedAt: now, startedAt: now })
      .returning({ id: turns.id });
    assert.ok(turn !== undefined);
    yield* db.insert(messages).values({
      ...own,
      seq: 1,
      turnId: turn.id,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Look over what changed today." }],
      metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      placedAt: now,
      finishedAt: now,
      ...(opener.sender === undefined
        ? undefined
        : opener.sender === MESSAGE_SENDER.AUTOMATION
          ? { sender: opener.sender, senderName: opener.name }
          : { sender: opener.sender, senderUserId: agent.userId }),
    });
    yield* db.insert(messages).values({
      ...own,
      seq: 2,
      turnId: turn.id,
      clientId: turn.id,
      role: MESSAGE_ROLE.ASSISTANT,
      // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
      parts: called.map((tool, index) => ({
        type: `tool-${tool}`,
        toolCallId: `call-${index}`,
        state: "output-available",
        input: { url: "https://example.com/" },
        output: "Example Domain",
      })) as never,
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
      placedAt: now,
    });
  });

/** A `remember` from the agent, as its tool door calls it. */
const remember = (agent: CodingAgent) => {
  const call: CodingAgentCall = {
    caller: { kind: AGENT_CALLER.AGENT, agent },
    eve: undefined,
    writer: Effect.die(new Error("a memory call writes no line")),
    clientKey: randomUUID(),
  };
  return runAgentRemember(call, { text: FACT });
};

it.layer(getTestDB())("a remember's provenance", (it) => {
  it.effect("a turn an automation's run opened keeps nothing", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openAgent(CODING_AGENT_KIND.CODER);
      yield* writeTurn(agent, { sender: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" }, []);

      const answer = yield* remember(agent);

      assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(answer.reason, MEMORY_PROVENANCE_REFUSAL.AUTOMATION);
      assert.deepEqual(yield* listMemories(workspaceId), []);
    }),
  );

  it.effect(
    "an eve agent's first turn, whose line the relay wrote with no sender, keeps nothing where an automation started the agent",
    () =>
      Effect.gen(function* () {
        const origin = {
          name: "Nightly triage",
          firing: { kind: AUTOMATION_FIRING.MANUAL },
          prompt: "Triage the overnight errors.",
        };
        const { agent, workspaceId } = yield* openAgent(CODING_AGENT_KIND.CODER, origin);
        yield* writeTurn(agent, { sender: undefined }, []);

        assert.equal((yield* remember(agent)).reason, MEMORY_PROVENANCE_REFUSAL.AUTOMATION);
        assert.deepEqual(yield* listMemories(workspaceId), []);
      }),
  );

  it.effect("an operator's turn its heartbeat opened keeps nothing", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openAgent(CODING_AGENT_KIND.OPERATOR);
      yield* writeTurn(agent, { sender: MESSAGE_SENDER.AUTOMATION, name: "Luke's heartbeat" }, []);

      const answer = yield* remember(agent);

      assert.equal(answer.reason, MEMORY_PROVENANCE_REFUSAL.AUTOMATION);
      assert.deepEqual(yield* listMemories(workspaceId), []);
    }),
  );

  it.effect(
    "a turn that read the web, through Luke's page read or Claude Code's search, keeps nothing",
    () =>
      Effect.gen(function* () {
        for (const read of [AGENT_TOOL.READ_WEB_PAGE, CLAUDE_CODE_TOOL.WEB_SEARCH]) {
          const { agent, workspaceId } = yield* openAgent(CODING_AGENT_KIND.OPERATOR);
          yield* writeTurn(agent, { sender: MESSAGE_SENDER.MEMBER }, [AGENT_TOOL.BASH, read]);

          const answer = yield* remember(agent);

          assert.equal(answer.reason, MEMORY_PROVENANCE_REFUSAL.WEB_READ, read);
          assert.deepEqual(yield* listMemories(workspaceId), []);
        }
      }),
  );

  it.effect("a turn a member's line opened, which read nothing of the web, keeps the memory", () =>
    Effect.gen(function* () {
      const { agent, workspaceId } = yield* openAgent(CODING_AGENT_KIND.OPERATOR);
      yield* writeTurn(agent, { sender: MESSAGE_SENDER.MEMBER }, [AGENT_TOOL.BASH]);

      const answer = yield* remember(agent);

      assert.equal(answer.outcome, MEMORY_OUTCOME.KEPT);
      assert.deepEqual(
        (yield* listMemories(workspaceId)).map((kept) => kept.text),
        [FACT],
      );
    }),
  );

  it.effect("a turn that settled refuses nothing, whatever opened it", () =>
    Effect.gen(function* () {
      const { agent } = yield* openAgent(CODING_AGENT_KIND.CODER);
      yield* writeTurn(
        agent,
        { sender: MESSAGE_SENDER.AUTOMATION, name: "Nightly triage" },
        [AGENT_TOOL.READ_WEB_PAGE],
        TURN_STATUS.SETTLED,
      );

      assert.equal((yield* remember(agent)).outcome, MEMORY_OUTCOME.KEPT);
    }),
  );
});
