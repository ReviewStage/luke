import assert from "node:assert/strict";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { sqlClientOverUrl } from "@luke/database/core/sql-client";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { ensureTaskChannel, history, roster } from "@luke/database/models/chat-store";
import { toolSetHashOf } from "@luke/database/models/content-addressed";
import { hostTurnId } from "@luke/database/models/ids";
import { openTaskConversation, readTask, savePlanText } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { readMessagesByConversationTyped, readTurnById, startTask } from "@luke/database/testing";
import { CHAT_BLOCK, MEMBER_KIND } from "@luke/features/chat-wire";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "@luke/service/agents/brain-host/bounds";
import { BRAIN_DELEGATE_TOOL, brainToolDeclarations } from "@luke/service/agents/brain-host/brain";
import { REPOSITORY_SHELL_REFUSAL } from "@luke/service/agents/repository-shell";
import {
  SCRIPTED_BRAIN_REPLY,
  SCRIPTED_DELEGATE,
  SCRIPTED_NOT_READ_REPLY,
  SCRIPTED_POST,
  SCRIPTED_POSTED_REPLY,
  SCRIPTED_READ,
} from "@luke/service/testing/eve-scripted-model";
import { EXPERIMENT } from "@luke/settings";
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
 * The whole host under eve, end to end: eve's runtime runs a typed ask in a
 * task's conversation under the scripted fixture model, which is handed the
 * saved document in its standing context and answers in words, leaving the
 * document as the notetaker saved it, and the relay writes the turn into the
 * store through the writer. A read of the repository on a task that has none
 * is refused ahead of any sandbox, in words the model repeats, so the eval
 * opens no Vercel Sandbox and needs no GitHub. Asked to post, the model
 * posts in the plan's chat as `@luke`, and the message stands in the plan's
 * channel. The eve server runs in this process with the database the
 * environment names, so the eval reads the rows back from the same Postgres.
 * Where no database is named the eval skips rather than pretending: the
 * relay and the writer meet PGlite in the store tests, and this is where
 * they meet eve.
 */

const SHA256_HEX_LENGTH = 64;

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/** The task the brain's scenario runs against, and the words its two sessions open with. */
const TASK = {
  name: "Teammate invitations",
} as const;
const PLAN_TEXT =
  "## Open questions\n\n- Who may invite?\n\n## Assumptions\n\n- Invites reuse `memberships` with a `pending` state.\n";
const PLAN_SAVED = { body: PLAN_TEXT, assumptions: [] } as const;
const PLAN_WORDS = {
  FIRST: "Any member should be able to invite, not only admins.",
  POSTED: "The invite table's schema is frozen until Friday.",
} as const;

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

function readMessagesByTurn(run: Run, conversationId: string, turnId: string) {
  return readMessagesByConversationTyped(run, conversationId).then((rows) =>
    rows.filter((row) => row.turnId === turnId),
  );
}

/** The id of the task's conversation, opened on its first call; the task must stand. */
async function taskConversation(run: Run, taskId: string): Promise<string> {
  const opened = await run(openTaskConversation(LOCAL_DEV_PRINCIPAL, taskId));
  assert.ok(Option.isSome(opened));
  return opened.value.conversationId;
}

/** The document the task holds now, failing the eval where it does not read. */
async function planDocument(run: Run, taskId: string) {
  const stored = await run(readTask(LOCAL_DEV_PRINCIPAL, taskId));
  assert.ok(Option.isSome(stored));
  return stored.value.task.document;
}

export default defineEval({
  description:
    "A typed ask in a plan's conversation runs through eve, the relay, and the writer into the store.",
  async test(t) {
    const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
    if (!connectionString) {
      return t.skip("no database is named; the fixture writes nowhere");
    }
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);
      // Chat starts off for the account, as an account that never turned it on has it.
      const chatChosen = (on: boolean) =>
        run(
          writeAccountPreferences(LOCAL_DEV_PRINCIPAL, { experiments: { [EXPERIMENT.CHAT]: on } }),
        );
      await chatChosen(false);

      /** A typed ask opening a new session over the conversation, answered once the session is its record. */
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
        // eve names more of an accepted session than the one field read here,
        // so the read drops what it does not name.
        const accepted = Result.getOrUndefined(
          readEither(ACCEPTED_SESSION, { excess: EXCESS_KEYS.DROP })(
            unparsedWire(await opened.json()),
          ),
        );
        assert.ok(accepted);
        // The door admits a session once its first event has recorded it on the conversation row.
        for (let waited = 0; waited < 40; waited += 1) {
          const runtimeSessionId = await readConversationRuntimeSessionId(run, conversationId);
          if (runtimeSessionId === accepted.sessionId) break;
          await t.sleep(250);
        }
        return accepted;
      };

      // The brain is handed the saved document and answers in words;
      // the notetaker beside the call writes the plan, so the turn leaves the
      // document as it stood.
      const task = await run(startTask(LOCAL_DEV_PRINCIPAL, TASK));
      await run(savePlanText(LOCAL_DEV_PRINCIPAL, task.id, PLAN_TEXT));
      const taskConversationId = await taskConversation(run, task.id);
      const tasks = await openSession(taskConversationId, PLAN_WORDS.FIRST);
      const tasksSession = await t.target.attachSession(tasks.sessionId);
      tasksSession.succeeded();
      assert.deepEqual(await planDocument(run, task.id), PLAN_SAVED);

      const turnId = hostTurnId(tasks.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, taskConversationId);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint and the tool
      // set's, neither naming a row, since nothing of either is kept.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      // With Chat off, the turn ran under the tools without the chat's, and its row names that set.
      assert.equal(turn.toolSetHash, toolSetHashOf(brainToolDeclarations(false)));

      const tasksRows = await readMessagesByTurn(run, taskConversationId, turnId);
      assert.deepEqual(
        tasksRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(tasksRows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      const tasksAnswer = tasksRows[1];
      assert.ok(tasksAnswer);
      assert.ok(
        tasksAnswer.parts.some((part) => isTextUIPart(part) && part.text === SCRIPTED_BRAIN_REPLY),
      );
      const runtimeSessionId = await readConversationRuntimeSessionId(run, taskConversationId);
      assert.equal(runtimeSessionId, tasks.sessionId);

      // Research handed to the worker subagent returns a receipt at once, and
      // the brain's turn stays open until the worker's result reaches the
      // model inside it: one turn on record, settled, holding the call, the
      // words before the wait, and the words after it.
      const researchTask = await run(startTask(LOCAL_DEV_PRINCIPAL, TASK));
      const researchConversationId = await taskConversation(run, researchTask.id);
      const research = await openSession(
        researchConversationId,
        `${SCRIPTED_DELEGATE}invite links`,
      );
      const researchSession = await t.target.attachSession(research.sessionId);
      researchSession.succeeded();
      const researchTurnId = hostTurnId(research.sessionId, "turn_0");
      let held: Awaited<ReturnType<typeof readTurnById>> | undefined;
      for (let waited = 0; waited < 120 && held?.status !== TURN_STATUS.SETTLED; waited += 1) {
        held = await readTurnById(run, researchTurnId);
        await t.sleep(500);
      }
      assert.ok(held);
      assert.equal(held.origin, TURN_ORIGIN.TYPED);
      assert.equal(held.status, TURN_STATUS.SETTLED);
      assert.equal(await readTurnById(run, hostTurnId(research.sessionId, "turn_1")), undefined);
      // The worker ran to its end on its own model and tools, rather than failing for want of them.
      const settled = researchSession.events.find((event) => event.type === "task.settled");
      assert.ok(settled && settled.type === "task.settled");
      assert.equal(settled.data.name, BRAIN_DELEGATE_TOOL.name);
      assert.equal(settled.data.status, "completed");
      const researchRows = await readMessagesByTurn(run, researchConversationId, held.id);
      assert.deepEqual(
        researchRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      const researchAnswer = researchRows[1];
      assert.ok(researchAnswer);
      const delegation = researchAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(delegation);
      assert.equal(delegation.type, `tool-${BRAIN_DELEGATE_TOOL.name}`);
      assert.equal(delegation.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      // The words before the wait and the words after it, in one answer.
      assert.ok(researchAnswer.parts.filter((part) => isTextUIPart(part)).length >= 2);

      // A repository read on a task with no repository yet runs nothing and
      // says so: the refusal reaches the model as the tool's result, ahead of
      // any sandbox, and the model repeats why.
      const readingTask = await run(startTask(LOCAL_DEV_PRINCIPAL, TASK));
      const readingConversationId = await taskConversation(run, readingTask.id);
      const reading = await openSession(readingConversationId, `${SCRIPTED_READ}ls`);
      const readingSession = await t.target.attachSession(reading.sessionId);
      readingSession.succeeded();
      const readingRows = await readMessagesByTurn(
        run,
        readingConversationId,
        hostTurnId(reading.sessionId, "turn_0"),
      );
      const readingAnswer = readingRows[1];
      assert.ok(readingAnswer);
      assert.ok(
        readingAnswer.parts.some(
          (part) =>
            isTextUIPart(part) &&
            part.text === `${SCRIPTED_NOT_READ_REPLY} ${REPOSITORY_SHELL_REFUSAL.NO_REPOSITORY}`,
        ),
      );

      await chatChosen(true);
      // Asked to post, the model posts in the plan's channel as the plan's
      // Luke, and says where it landed.
      const chatTask = await run(startTask(LOCAL_DEV_PRINCIPAL, TASK));
      const chatConversationId = await taskConversation(run, chatTask.id);
      const posting = await openSession(chatConversationId, `${SCRIPTED_POST}${PLAN_WORDS.POSTED}`);
      const postingSession = await t.target.attachSession(posting.sessionId);
      postingSession.succeeded();
      const channel = await run(ensureTaskChannel(LOCAL_DEV_PRINCIPAL, chatTask.id));
      assert.ok(Option.isSome(channel));
      const { organizationId } = channel.value;
      const members = await run(roster(LOCAL_DEV_PRINCIPAL, organizationId));
      const luke = members.find(
        (member) => member.kind === MEMBER_KIND.LUKE && member.taskId === chatTask.id,
      );
      assert.ok(luke);
      const said = await run(
        history(LOCAL_DEV_PRINCIPAL, organizationId, luke.id, { channelId: channel.value.id }),
      );
      assert.ok(Option.isSome(said));
      const [posted] = said.value;
      assert.ok(posted);
      assert.equal(posted.authorMemberId, luke.id);
      assert.deepEqual(posted.blocks, [{ type: CHAT_BLOCK.MARKDOWN, text: PLAN_WORDS.POSTED }]);
      const postingRows = await readMessagesByTurn(
        run,
        chatConversationId,
        hostTurnId(posting.sessionId, "turn_0"),
      );
      assert.ok(
        postingRows[1]?.parts.some(
          (part) => isTextUIPart(part) && part.text === `${SCRIPTED_POSTED_REPLY} ${posted.seq}.`,
        ),
      );
    } finally {
      await runtime.dispose();
    }
  },
});
