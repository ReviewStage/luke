import assert from "node:assert/strict";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { sqlClientOverUrl } from "@luke/database/core/sql-client";
import { type CodingAgent, createCodingAgent } from "@luke/database/models/coding-agent-store";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import {
  readMessagesByConversationTyped,
  readTurnById,
  readTurnsByConversation,
  startTask,
} from "@luke/database/testing";
import { CODING_AGENT_TODO_STATUS } from "@luke/features/coding-agent-wire";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "@luke/service/agents/brain-host/bounds";
import { CODER_MODEL_FIXTURE } from "@luke/service/agents/coder-host/bounds";
import { TODOS_SAVED } from "@luke/service/agents/coder-host/todos";
import { CODER_TOOL } from "@luke/service/agents/coder-host/tool-set";
import {
  SCRIPTED_CHAT_HEARD,
  SCRIPTED_CHAT_POST,
  SCRIPTED_CHAT_POSTED,
  SCRIPTED_CHAT_READ,
  SCRIPTED_CODER_REPLY,
  SCRIPTED_DELEGATE,
  SCRIPTED_DELEGATED_REPLY,
  SCRIPTED_SKILL_REPLY,
  SCRIPTED_SKILLS,
  SCRIPTED_TODOS,
  SCRIPTED_TODOS_REPLY,
  SCRIPTED_WORKER_CHOICE,
} from "@luke/service/testing/coder-scripted-model";
import {
  EXCESS_KEYS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { TOOL_PART_STATE } from "@luke/wire/ui-messages";
import { isTextUIPart, isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Option, Result, Schema } from "effect";
import { defineEval } from "eve/evals";

/**
 * The whole coding-agent host under eve, end to end: eve's runtime runs a
 * coding agent's first turn under the scripted fixture model, which is
 * handed the plan as the session's first message and answers in words
 * without calling a tool, so no sandbox opens, no repository is checked
 * out, and no GitHub is reached; and the relay writes the turn into the
 * store through the writer, as the real providers' turns are written. Told
 * to delegate, it hands the rest to a worker on a pair of its own choosing
 * and waits: the call is a tool part of its answer naming the pair, the
 * worker's session is recorded under the child conversation that call
 * names, on that pair, and the worker's answer is read back. Handed
 * to-dos, it writes the list, which eve holds to the schema the model is
 * shown and the writer keeps as a tool part the agent's tab draws. Told
 * a skill's `/name`, it loads the skill the session was offered. Told to
 * post in chat, it posts in its plan's channel, and another agent on the
 * plan opens its next turn with that post among the chat it had not read. The
 * eve server runs in this process with the database the environment names,
 * so the eval reads the rows back from the same Postgres. Where no database
 * is named the eval skips rather than pretending.
 */

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

const PLAN = { name: "Teammate invitations" } as const;
const PLAN_SNAPSHOT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";
const REPOSITORY = "acme/relay";
const DELEGATED_TASK = "Count the invitation routes";
const TODO_WORDS = "Read the guide; Add the invitation route";
const CHAT_WORDS = "The invite table is mine; please leave its migration to me.";

/** How long the eval waits for a turn to settle, in polls of the interval below. */
const SETTLE_POLLS = 120;
const SETTLE_INTERVAL_MS = 500;

/** What eve answers a session's opening with, read for the one field the eval continues from. */
const ACCEPTED_SESSION = Schema.Struct({ sessionId: Schema.String });

type Run = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Promise<A>;

async function ensureLocalDevUser(run: Run): Promise<void> {
  await run(
    Effect.asVoid(
      Database.use((db) =>
        db
          .insert(user)
          .values({
            id: LOCAL_DEV_PRINCIPAL,
            name: "Local developer",
            email: "local-dev@luke.test",
          })
          .onConflictDoNothing({ target: user.id }),
      ),
    ),
  );
}

function readConversationRuntimeSessionId(
  run: Run,
  conversationId: string,
): Promise<string | null> {
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      const RowSchema = Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) });
      const [row] = rows;
      return row === undefined ? null : Schema.decodeUnknownSync(RowSchema)(row).runtimeSessionId;
    }),
  );
}

function startAgent(run: Run, planId: string): Promise<CodingAgent> {
  return run(
    Effect.map(
      createCodingAgent(LOCAL_DEV_PRINCIPAL, {
        taskId: planId,
        idempotencyKey: `eval-${Date.now()}-${Math.random()}`,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        planSnapshot: PLAN_SNAPSHOT,
        prompt: null,
        repository: REPOSITORY,
      }),
      (started) => {
        assert.ok(Option.isSome(started));
        return started.value.agent;
      },
    ),
  );
}

export default defineEval({
  description:
    "A coding agent's first turn runs through eve, the relay, and the writer into the store, under the scripted model.",
  async test(t) {
    const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
    if (!connectionString) {
      return t.skip("no database is named; the fixture writes nowhere");
    }
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);
      const plan = await run(startTask(LOCAL_DEV_PRINCIPAL, { ...PLAN, repository: REPOSITORY }));
      const agent = await startAgent(run, plan.id);

      /** The Start as the route makes it: the first message of a typed turn on the agent's conversation, answered once the door has recorded the session on the conversation row. */
      const openSession = async (conversationId: string, message: string) => {
        const opened = await t.target.fetch("/eve/v1/session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [BRAIN_HOST_HEADER.CONVERSATION]: conversationId,
            [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
          },
          body: JSON.stringify({ message }),
        });
        assert.equal(opened.status, 202);
        const accepted = Result.getOrUndefined(
          readEither(ACCEPTED_SESSION, { excess: EXCESS_KEYS.DROP })(
            unparsedWire(await opened.json()),
          ),
        );
        assert.ok(accepted);
        for (let waited = 0; waited < 40; waited += 1) {
          const runtimeSessionId = await readConversationRuntimeSessionId(run, conversationId);
          if (runtimeSessionId === accepted.sessionId) break;
          await t.sleep(250);
        }
        return accepted;
      };

      const accepted = await openSession(agent.conversationId, PLAN_SNAPSHOT);
      const session = await t.target.attachSession(accepted.sessionId);
      session.succeeded();

      const turnId = hostTurnId(accepted.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, agent.conversationId);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      assert.equal(turn.model, CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID);
      assert.equal(turn.reasoningEffort, "high");
      assert.ok(turn.promptHash);

      const rows = await readMessagesByConversationTyped(run, agent.conversationId);
      assert.deepEqual(
        rows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(rows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      assert.ok(rows[0]?.parts.some((part) => isTextUIPart(part) && part.text === PLAN_SNAPSHOT));
      assert.ok(
        rows[1]?.parts.some(
          (part) => isTextUIPart(part) && part.text.startsWith(SCRIPTED_CODER_REPLY),
        ),
      );
      assert.equal(
        await readConversationRuntimeSessionId(run, agent.conversationId),
        accepted.sessionId,
      );

      // A delegation is a task the agent waits for, as a foreground one is:
      // one turn on record, settled, holding the call as a tool part that
      // names the pair asked and answers with eve's receipt, then the wait,
      // then the worker's answer in the agent's words, and the worker's own
      // session recorded under the child conversation the call names, on
      // that pair.
      const delegating = await startAgent(run, plan.id);
      const delegation = await openSession(
        delegating.conversationId,
        `${SCRIPTED_DELEGATE}${DELEGATED_TASK}`,
      );
      const delegatingTurnId = hostTurnId(delegation.sessionId, "turn_0");
      let held: Awaited<ReturnType<typeof readTurnById>> | undefined;
      for (
        let polled = 0;
        polled < SETTLE_POLLS && held?.status !== TURN_STATUS.SETTLED;
        polled += 1
      ) {
        held = await readTurnById(run, delegatingTurnId);
        await t.sleep(SETTLE_INTERVAL_MS);
      }
      assert.ok(held);
      assert.equal(held.status, TURN_STATUS.SETTLED);
      const delegatingRows = await readMessagesByConversationTyped(run, delegating.conversationId);
      const answer = delegatingRows.at(-1);
      assert.ok(answer);
      assert.equal(answer.role, MESSAGE_ROLE.ASSISTANT);
      const call = answer.parts.find((part) => isToolUIPart(part));
      assert.ok(call);
      assert.equal(call.type, `tool-${CODER_TOOL.DELEGATE}`);
      assert.equal(call.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.deepEqual(call.input, { task: DELEGATED_TASK, ...SCRIPTED_WORKER_CHOICE });
      // The call answers with eve's receipt, which names the task it started.
      assert.match(JSON.stringify(call.output), /^"Started task delegate-/u);
      assert.ok(
        answer.parts.some(
          (part) =>
            isTextUIPart(part) &&
            part.text === `${SCRIPTED_DELEGATED_REPLY} ${SCRIPTED_CODER_REPLY} ${DELEGATED_TASK}`,
        ),
        "the worker's answer reaches the agent's words",
      );
      const childId = childConversationId(delegating.conversationId, call.toolCallId);
      const [childTurn] = await readTurnsByConversation(run, childId);
      assert.ok(childTurn);
      assert.equal(childTurn.origin, TURN_ORIGIN.CHILD);
      assert.equal(childTurn.status, TURN_STATUS.SETTLED);
      assert.equal(childTurn.model, CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID);
      assert.equal(childTurn.reasoningEffort, SCRIPTED_WORKER_CHOICE.effort);
      const childRows = await readMessagesByConversationTyped(run, childId);
      assert.deepEqual(
        childRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.ok(
        childRows[0]?.parts.some(
          (part) => isTextUIPart(part) && part.text.includes(DELEGATED_TASK),
        ),
      );

      // A to-do write is a tool part of the agent's answer holding the
      // whole list as the model wrote it, answered at once.
      const listing = await startAgent(run, plan.id);
      const listed = await openSession(listing.conversationId, `${SCRIPTED_TODOS}${TODO_WORDS}`);
      (await t.target.attachSession(listed.sessionId)).succeeded();
      const listingAnswer = (await readMessagesByConversationTyped(run, listing.conversationId)).at(
        -1,
      );
      assert.ok(listingAnswer);
      const write = listingAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(write);
      assert.equal(write.type, `tool-${CODER_TOOL.WRITE_TODOS}`);
      assert.equal(write.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.deepEqual(write.input, {
        todos: [
          { content: "Read the guide", status: CODING_AGENT_TODO_STATUS.IN_PROGRESS },
          { content: "Add the invitation route", status: CODING_AGENT_TODO_STATUS.PENDING },
        ],
      });
      assert.equal(write.output, TODOS_SAVED);
      assert.ok(
        listingAnswer.parts.some(
          (part) => isTextUIPart(part) && part.text === SCRIPTED_TODOS_REPLY,
        ),
      );

      // A `/name` the developer types names one of the skills the session
      // is offered: the agent loads it with eve's own `load_skill`, a tool
      // part of its answer holding the skill's body, and follows it.
      const skilled = await startAgent(run, plan.id);
      const [skill] = SCRIPTED_SKILLS;
      const named = await openSession(skilled.conversationId, `/${skill.name} for this week`);
      (await t.target.attachSession(named.sessionId)).succeeded();
      const skilledAnswer = (await readMessagesByConversationTyped(run, skilled.conversationId)).at(
        -1,
      );
      assert.ok(skilledAnswer);
      const load = skilledAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(load);
      assert.equal(load.type, `tool-${CODER_TOOL.LOAD_SKILL}`);
      assert.equal(load.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.deepEqual(load.input, { skill: skill.name });
      assert.equal(load.output, skill.markdown);
      assert.ok(
        skilledAnswer.parts.some(
          (part) =>
            isTextUIPart(part) &&
            part.text === `${SCRIPTED_SKILL_REPLY} Write one line per change, newest first.`,
        ),
      );

      // A chat post is a tool part of the agent's answer, accepted in its
      // plan's channel, and another agent on the plan has its next turn open
      // with it, as the chat it had not read, named by its poster's handle.
      // The reader is started first: a member joins the chat at its head, and the poster's first post
      // seats every agent of the plan not yet seated, so the reader stands before the post lands.
      const reader = await startAgent(run, plan.id);
      const poster = await startAgent(run, plan.id);
      const posting = await openSession(
        poster.conversationId,
        `${SCRIPTED_CHAT_POST}${CHAT_WORDS}`,
      );
      (await t.target.attachSession(posting.sessionId)).succeeded();
      const postAnswer = (await readMessagesByConversationTyped(run, poster.conversationId)).at(-1);
      assert.ok(postAnswer);
      const post = postAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(post);
      assert.equal(post.type, `tool-${CODER_TOOL.POST_CHAT}`);
      assert.equal(post.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.deepEqual(post.input, { text: CHAT_WORDS });
      assert.match(JSON.stringify(post.output), /"status":"accepted"/u);
      // A plan of the same name already standing in the workspace, from an earlier run, takes the next name.
      assert.match(JSON.stringify(post.output), /"in":"#teammate-invitations(-\d+)?"/u);
      assert.ok(
        postAnswer.parts.some(
          (part) => isTextUIPart(part) && part.text.startsWith(SCRIPTED_CHAT_POSTED),
        ),
      );
      const reading = await openSession(reader.conversationId, SCRIPTED_CHAT_READ);
      (await t.target.attachSession(reading.sessionId)).succeeded();
      const readAnswer = (await readMessagesByConversationTyped(run, reader.conversationId)).at(-1);
      assert.ok(readAnswer);
      assert.ok(
        readAnswer.parts.some(
          (part) =>
            isTextUIPart(part) &&
            part.text.startsWith(`${SCRIPTED_CHAT_HEARD} m `) &&
            part.text.includes(" · @agent-") &&
            part.text.endsWith(`: ${CHAT_WORDS}`),
        ),
        "the other agent's turn opens with the post it had not read, named by its poster's handle",
      );
    } finally {
      await runtime.dispose();
    }
  },
});
