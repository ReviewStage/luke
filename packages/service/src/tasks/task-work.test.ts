import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { fillChildTitle } from "@luke/database/models/child-titles";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { listJournals } from "@luke/database/models/message-reads";
import { openTaskConversation } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { turns } from "@luke/database/schemas/storage";
import {
  insertConversation,
  insertTurn,
  joinWorkspace,
  openHostedStoreTestDatabase,
  startTask,
} from "@luke/database/testing";
import { LOOK_AT_BOARD_TOOL_NAME } from "@luke/features/board-vocabulary";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  TURN_ENDING,
  type TurnRecord,
} from "@luke/features/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@luke/features/page-wire";
import {
  TASK_WORK_BOUNDS,
  TASK_WORK_STATE,
  type TaskWorkAnswer,
  type TaskWorkTurn,
} from "@luke/features/tasks-view";
import { isRecord, isWireString, TURN_ORIGIN, type WireRecord, type WireValue } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { BRAIN_HOST_TURN, RELAY_TURN } from "../agents/brain-host/bounds.js";
import { BRAIN_DELEGATE_TOOL } from "../agents/brain-host/brain.js";
import { openChildConversation } from "../agents/brain-host/conversation.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "../agents/brain-host/relay.js";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../agents/repository-shell.js";
import { ASK_ORIGIN, MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE, TURN_STATUS } from "../core.js";
import { stampedEveEvent } from "../testing/eve-events.js";
import { FIRST_EVE_TURN } from "../testing/eve-turns.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";
import {
  BRAIN_POLL,
  type BrainPage,
  brainPagePast,
  brainTitleAwaited,
  brainTurnsPage,
  brainWorkerSession,
} from "./brain-transcript.js";
import { SHOW_CODE_TOOL } from "./show-code.js";
import { taskWorkOf } from "./task-work.js";
import { readTaskCode, readTaskWork } from "./task-work-store.js";

/**
 * One brain turn's work as the Work tab is sent it, over the real
 * migrations on PGlite: eve's events relayed through the store writer as the
 * hosted brain relays them, and the work projected from the turn row and its
 * journal as they stand. Synthetic throughout: no real repository, page, or
 * spoken word.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const relay = new StreamRelay({
  writer,
  asks: { binding: askRecord(), stopTurn: () => Effect.void },
  now: () => NOW,
  report: () => undefined,
});

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** One tool call of a scripted step: its tool, its input, and the output it answers with, where it answers. */
interface Call {
  readonly toolName: string;
  readonly input: WireRecord;
  readonly output?: unknown;
}

const SEQUENCE = 0;

/** A step that calls the tools named, each answered where its call has an output. */
function callingStep(turnId: string, stepIndex: number, calls: readonly Call[]) {
  const ids = calls.map((_, index) => `call-${stepIndex}-${index}`);
  return [
    stamped({
      type: "step.started",
      data: { turnId, sequence: SEQUENCE, stepIndex, modelId: "m" },
    }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence: SEQUENCE,
        stepIndex,
        actions: calls.map((call, index) => ({
          kind: "tool-call" as const,
          callId: ids[index] ?? "",
          toolName: call.toolName,
          input: call.input,
        })),
      },
    }),
    ...calls.flatMap((call, index) =>
      call.output === undefined
        ? []
        : [
            stamped({
              type: "action.result",
              data: {
                turnId,
                sequence: SEQUENCE,
                stepIndex,
                status: "completed",
                result: {
                  kind: "tool-result",
                  callId: ids[index] ?? "",
                  toolName: call.toolName,
                  output: call.output,
                },
              },
            }),
          ],
    ),
  ];
}

/** The rest of a turn after its calls: one step of words, and the end. */
function answeringStep(turnId: string, stepIndex: number, words: string) {
  return [
    stamped({
      type: "step.started",
      data: { turnId, sequence: SEQUENCE, stepIndex, modelId: "m" },
    }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence: SEQUENCE, stepIndex, finishReason: "stop", message: words },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence: SEQUENCE, stepIndex, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence: SEQUENCE } }),
  ];
}

function opening(turnId: string) {
  return [
    stamped({ type: "turn.started", data: { turnId, sequence: SEQUENCE } }),
    stamped({ type: "message.received", data: { turnId, sequence: SEQUENCE, message: "q" } }),
  ];
}

function standingFor(target: ConversationTarget): RelayStanding {
  return {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

/** Lines a `show_code` call answered with, as its journal keeps them. */
function shownAt(path: string, line: string) {
  return {
    ref: { path, startLine: 1, endLine: 1 },
    repository: "acme/web",
    firstLine: 1,
    lineCount: 1,
    lines: [line],
  };
}

/** A task of a new account, with the conversation its brain runs in. */
async function taskConversation(): Promise<
  ConversationTarget & { taskId: string; workspaceId: string }
> {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: "Teammate invitations" }));
  const opened = await database.run(openTaskConversation(userId, task.id));
  assert.ok(Option.isSome(opened));
  return {
    userId,
    conversationId: opened.value.conversationId,
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

/**
 * Stamps a played turn as asked and started at `at`, so the turns of a task
 * read in the order they were asked; the row's own queue stamp is the
 * database's clock, which a test does not hold.
 */
async function askedAt(standing: RelayStanding, at: number): Promise<void> {
  await database.run(
    Database.use((db) =>
      db
        .update(turns)
        .set({ queuedAt: new Date(at), startedAt: new Date(at) })
        .where(eq(turns.id, hostTurnId(standing.sessionId, FIRST_EVE_TURN))),
    ),
  );
}

/** The code a read answered, by the call and turn that showed it, as the tab would tell them apart. */
function shownBy(read: Option.Option<TaskWorkAnswer>) {
  assert.ok(Option.isSome(read));
  return (read.value.code ?? []).map(({ callId, turnId, code }) => [callId, turnId, code]);
}

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

/** The turn's work as its record and journal now stand, read the way the voice session reads them. */
async function worked(target: ConversationTarget, standing: RelayStanding): Promise<TaskWorkTurn> {
  const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
  const [turn] = await database.run(database.store.turns.named(target.userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(
      target.userId,
      turn.conversationId,
      HOSTED_TOOL_SET,
      turn.id,
    ),
  );
  assert.ok(journal.ok);
  return taskWorkOf(turn, journal.value[0]?.message);
}

test("a plan's work reads back from its conversation after the call: its turns oldest first and every code shown with Luke's note, several of one file included, for the account that owns it alone", async () => {
  const target = await taskConversation();
  const first = standingFor(target);
  const second = standingFor(target);
  const old = shownAt("src/old.ts", "old");
  const note = "Every invite starts here, so expiry belongs in this function.";
  const invite = { ...shownAt("src/invite.ts", "export function invite() {}"), note };
  const revoke = shownAt("src/invite.ts", "export function revoke() {}");
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        // A call journaled before notes were asked for carries none, and still reads.
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/old.ts" },
          output: { status: "accepted", code: old },
        },
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts", note },
          output: { status: "accepted", code: invite },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Invites live in one file."),
    ],
    first,
  );
  await askedAt(first, NOW - 60_000);
  // A showing that was refused shows nothing, and the one after it shows the same file again.
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/missing.ts" },
          output: { status: "rejected", reason: "Not shown: no such file in the repository." },
        },
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts" },
          output: { status: "accepted", code: revoke },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Expiry is seven days."),
    ],
    second,
  );
  await askedAt(second, NOW);

  const read = await database.run(readTaskWork(target.userId, target.taskId, undefined));
  assert.ok(Option.isSome(read));
  assert.deepEqual(
    read.value.turns.map((turn) => {
      const last = turn.journal.at(-1);
      return [turn.state, isRecord(last) ? last.text : undefined];
    }),
    [
      [TASK_WORK_STATE.DONE, "Invites live in one file."],
      [TASK_WORK_STATE.DONE, "Expiry is seven days."],
    ],
  );
  assert.equal(read.value.earlier, undefined);
  const firstTurn = hostTurnId(first.sessionId, FIRST_EVE_TURN);
  const secondTurn = hostTurnId(second.sessionId, FIRST_EVE_TURN);
  assert.deepEqual(shownBy(read), [
    ["call-0-0", firstTurn, old],
    ["call-0-1", firstTurn, invite],
    ["call-0-1", secondTurn, revoke],
  ]);
  const stranger = await database.createUser();
  assert.ok(Option.isNone(await database.run(readTaskWork(stranger, target.taskId, undefined))));
});

test("a plan's work reads the same for every member of its workspace, whichever member opened its conversation", async () => {
  const target = await taskConversation();
  const teammate = await database.createUser();
  await database.run(joinWorkspace(target.workspaceId, teammate));
  const shown = shownAt("src/invite.ts", "export function invite() {}");
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: "src/invite.ts" },
          output: { status: "accepted", code: shown },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Invites live in one file."),
    ],
    standingFor(target),
  );

  const opener = await database.run(readTaskWork(target.userId, target.taskId, undefined));
  const member = await database.run(readTaskWork(teammate, target.taskId, undefined));
  assert.ok(Option.isSome(member));
  assert.deepEqual(
    member.value.turns.map((turn) => {
      const last = turn.journal.at(-1);
      return isRecord(last) ? last.text : undefined;
    }),
    ["Invites live in one file."],
  );
  assert.deepEqual(
    (member.value.code ?? []).map((each) => each.code),
    [shown],
  );
  assert.deepEqual(member, opener);
  const code = await database.run(readTaskCode(teammate, target.taskId));
  assert.deepEqual(
    Option.getOrThrow(code).code.map((each) => each.code),
    [shown],
  );
});

test("a plan never planned on reads as no work, and a secret file a journal holds is not read back as code", async () => {
  const userId = await database.createUser();
  const fresh = await database.run(startTask(userId, { name: "Billing export" }));
  assert.deepEqual(
    await database.run(readTaskWork(userId, fresh.id, undefined)),
    Option.some({ turns: [], code: [] }),
  );

  const target = await taskConversation();
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_CODE_TOOL.name,
          input: { path: ".env.local" },
          output: { status: "accepted", code: shownAt(".env.local", "SECRET=synthetic") },
        },
      ]),
    ],
    standingFor(target),
  );
  const read = await database.run(readTaskWork(target.userId, target.taskId, undefined));
  assert.ok(Option.isSome(read));
  assert.equal(read.value.turns.length, 1);
  assert.deepEqual(read.value.code, []);
});

test("a turn carries its own journal as the agent tab reads one, and each worker it delegated to in the background beside it: running while the worker's own session runs though the call answered at its receipt, its session's parts as stored, and done once it answers", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const task = "Compare the two queue libraries.";
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: BRAIN_DELEGATE_TOOL.name,
          input: { task },
          output:
            "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "I've asked a worker to compare them."),
    ],
    standing,
  );
  const callId = "call-0-0";
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, callId),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  const work = async (records: ReadonlyMap<string, TurnRecord> = new Map(), failed = false) => {
    const turnId = hostTurnId(standing.sessionId, FIRST_EVE_TURN);
    const [stored] = await database.run(database.store.turns.named(target.userId, [turnId]));
    assert.ok(stored);
    const turn = failed ? { ...stored, status: TURN_STATUS.FAILED } : stored;
    const journal = await database.run(
      database.store.messages.byClientId(
        target.userId,
        turn.conversationId,
        HOSTED_TOOL_SET,
        turnId,
      ),
    );
    const journals = await database.run(
      listJournals(child.userId, child.conversationId, HOSTED_TOOL_SET, 10),
    );
    assert.ok(journal.ok && journals.ok);
    return taskWorkOf(
      turn,
      journal.value[0]?.message,
      new Map([[callId, journals.value]]),
      new Map(),
      records,
    );
  };
  const typed = (journal: readonly WireValue[] | undefined) =>
    journal?.map((part) => (isRecord(part) ? [part.type, part.text ?? part.state] : part));

  const running = await work();
  assert.equal(running.state, TASK_WORK_STATE.DONE);
  assert.deepEqual(typed(running.journal), [
    [`tool-${BRAIN_DELEGATE_TOOL.name}`, "output-available"],
    ["text", "I've asked a worker to compare them."],
  ]);
  const [worker] = running.workers ?? [];
  assert.equal(worker?.callId, callId);
  assert.equal(worker?.taskId, "delegate-7k2m9q");
  assert.equal(worker?.task, task);
  assert.equal(worker?.state, TASK_WORK_STATE.RUNNING);
  assert.deepEqual(typed(worker?.journal), [
    [`tool-${RUN_IN_REPOSITORY_TOOL.name}`, "input-available"],
  ]);
  // A turn that failed after its receipt leaves its worker standing as its own session does.
  const [outlived] = (await work(new Map(), true)).workers ?? [];
  assert.equal(outlived?.state, TASK_WORK_STATE.RUNNING);

  await play(
    answeringStep(FIRST_EVE_TURN, 1, "Both libraries let an admin revoke."),
    childStanding,
  );
  const [answered] = (await work()).workers ?? [];
  assert.equal(answered?.state, TASK_WORK_STATE.DONE);
  assert.deepEqual(typed(answered?.journal)?.at(-1), [
    "text",
    "Both libraries let an admin revoke.",
  ]);
  const [failed] = (await work(new Map([[callId, { ending: TURN_ENDING.FAILED }]]))).workers ?? [];
  assert.equal(failed?.state, TASK_WORK_STATE.FAILED);
});

test("a worker call a retried step abandoned stops standing as running once eve runs the step again, while its turn still runs", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(opening(FIRST_EVE_TURN), standing);
  // The relay's state as the step began, which is what eve hands its retry.
  const stepInput = standing.state.get();
  await play(
    callingStep(FIRST_EVE_TURN, 0, [
      { toolName: BRAIN_DELEGATE_TOOL.name, input: { task: "Compare the two queue libraries." } },
    ]),
    standing,
  );
  const retry = { ...standing, state: memoryRelayState(stepInput) };
  await play(answeringStep(FIRST_EVE_TURN, 0, "I'll compare them myself.").slice(0, -1), retry);

  const work = await worked(target, standing);
  assert.equal(work.state, TASK_WORK_STATE.RUNNING);
  assert.deepEqual(
    work.workers?.map((worker) => [worker.callId, worker.state]),
    [["call-0-0", TASK_WORK_STATE.DONE]],
  );
});

test("a turn's journal keeps its newest parts and says older ones were left out, every string in a call cut to the bound with the call's shape kept", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const long = "x".repeat(TASK_WORK_BOUNDS.TEXT_CHARS + 50);
  const calls = Array.from({ length: TASK_WORK_BOUNDS.PARTS + 1 }, () => ({
    toolName: RUN_IN_REPOSITORY_TOOL.name,
    input: { command: long },
    output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: "ok", stderr: "" },
  }));
  await play([...opening(FIRST_EVE_TURN), ...callingStep(FIRST_EVE_TURN, 0, calls)], standing);

  const work = await worked(target, standing);
  assert.equal(work.journal?.length, TASK_WORK_BOUNDS.PARTS);
  assert.equal(work.earlierOmitted, true);
  const [first] = work.journal ?? [];
  assert.ok(isRecord(first) && isRecord(first.input) && isWireString(first.input.command));
  assert.ok(first.input.command.length <= TASK_WORK_BOUNDS.TEXT_CHARS);
  assert.equal(first.toolCallId, "call-0-1");
});

test("a turn's journal leaves out what the Mac is not sent: a page's HTML, which only the frame drawing the page reads, and the image a board look answered with", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_PAGE_TOOL_NAME,
          input: { title: "Invite funnel", html: "<!doctype html><p>secret-looking page body</p>" },
          output: { status: "accepted", page: { id: "page-1", version: 1 } },
        },
        { toolName: LOOK_AT_BOARD_TOOL_NAME, input: {}, output: { image: "iVBORw0KGgo" } },
      ]),
    ],
    standing,
  );

  const { journal } = await worked(target, standing);
  const [page, look] = journal ?? [];
  assert.ok(isRecord(page) && isRecord(look));
  assert.deepEqual(page.input, { title: "Invite funnel" });
  assert.equal(look.type, `tool-${LOOK_AT_BOARD_TOOL_NAME}`);
  assert.equal(look.output, undefined);
});

/** The store's id for the session of the call a spoken ask was said on. */
const SPOKEN_CALL = "3f6a1c2e-8b4d-4e7f-9a1b-5c2d3e4f6a7b";

/**
 * A spoken ask on the task's conversation, as the voice leaves it: the ask
 * under its delegation's id, made at `at` on the call, dispatched into the
 * standing's eve session, and the developer's lines the delegation was
 * about, written and attached to it. Answers the delegation's id, which eve
 * names the ask's delivery by.
 */
async function delegatedAsk(
  target: ConversationTarget,
  standing: RelayStanding,
  lines: readonly (readonly [rowId: string, text: string, fromMs: number])[],
  at: number,
  revision: number,
): Promise<string> {
  const delegationId = `dl_${randomUUID()}`;
  const record = askRecord();
  const ask = await database.run(
    record.record({
      ...target,
      clientId: delegationId,
      origin: ASK_ORIGIN.SPOKEN,
      createdAt: new Date(at),
      voice: { sessionId: SPOKEN_CALL, revision },
    }),
  );
  await database.run(
    record.dispatchOnce(target, ask.id, () =>
      Effect.succeed({ sessionId: standing.sessionId, deliveryId: delegationId }),
    ),
  );
  for (const [clientId, text, fromMs] of lines) {
    await database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.USER,
        clientId,
        text,
        metadata: {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: SPOKEN_CALL,
          from_ms: fromMs,
          to_ms: fromMs + 900,
        },
      }),
    );
  }
  await database.run(
    writer.attachSpokenAsk(target, { delegationId, rowIds: lines.map(([rowId]) => rowId) }),
  );
  return delegationId;
}

test("the developer's first ask of a call, steered into the turn the call's explore ask opened, names its lines as the turn's ask, so the turn stands under them though it ends after the call; a follow-up steered in while the turn runs names none, made in the same instant included", async () => {
  const target = await taskConversation();
  const standing = standingFor(target);
  // The call opens with the explore ask, keyed by the call's session and naming no line, and eve opens a turn for it at once.
  const record = askRecord();
  const explore = await database.run(
    record.record({
      ...target,
      clientId: SPOKEN_CALL,
      origin: ASK_ORIGIN.SPOKEN,
      createdAt: new Date(NOW - 5_000),
    }),
  );
  await database.run(
    record.dispatchOnce(target, explore.id, () =>
      Effect.succeed({
        sessionId: standing.sessionId,
        turnId: hostTurnId(standing.sessionId, FIRST_EVE_TURN),
      }),
    ),
  );
  const received = { turnId: FIRST_EVE_TURN, sequence: SEQUENCE, message: "q" };
  await play(
    [
      stampedEveEvent({ type: "turn.started", data: received }, NOW - 4_000),
      stampedEveEvent({ type: "message.received", data: received }, NOW - 4_000),
    ],
    standing,
  );
  // The developer's ask, said while the explore turn runs (the relay starts it at its own NOW), which eve steers into it.
  const asked = await delegatedAsk(
    target,
    standing,
    [["row-ask", "Look into how invites expire.", 7_400]],
    NOW + 1_000,
    1,
  );
  await play(
    [stampedEveEvent({ type: "message.received", data: received }, NOW + 2_000, [asked])],
    standing,
  );
  // While the turn waits on its subagent, the developer says more, and eve steers that in too. Note
  // that it is made in the same instant as the ask, which the store's clock can do, so the voice's
  // revision is what tells the follow-up from the ask.
  const followUp = await delegatedAsk(
    target,
    standing,
    [["row-follow", "And who can resend one?", 62_000]],
    NOW + 1_000,
    2,
  );
  await play(
    [
      stampedEveEvent({ type: "message.received", data: received }, NOW + 3_000, [asked, followUp]),
      ...answeringStep(FIRST_EVE_TURN, 0, "Seven days, and the inviter."),
    ],
    standing,
  );

  const read = await database.run(readTaskWork(target.userId, target.taskId, undefined));
  assert.ok(Option.isSome(read));
  assert.deepEqual(
    read.value.turns.map((turn) => [turn.asked, turn.askedAt]),
    [[["row-ask"], [{ voiceSessionId: SPOKEN_CALL, fromMs: 7_400 }]]],
  );
});

/** The turn and last words of each message a brain page carries, as the Call tab places and reads them. */
function turnsOf(page: BrainPage) {
  return page.messages.map((message) => {
    const last = message.parts.at(-1);
    return [message.turnId, isRecord(last) ? last.text : undefined];
  });
}

test("a plan's conversation reads on the agent tab's own wire: its newest turns' journals oldest first, each naming its turn and leaving a page's HTML out, and a reader past the cursor hears only a turn that moved, for the account that owns it alone", async () => {
  const target = await taskConversation();
  const first = standingFor(target);
  const second = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: SHOW_PAGE_TOOL_NAME,
          input: { title: "Invite funnel", html: "<!doctype html><p>secret-looking page body</p>" },
          output: { status: "accepted", page: { id: "page-1", version: 1 } },
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "Here is the funnel."),
    ],
    first,
  );
  await askedAt(first, NOW - 60_000);
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Expiry is seven days.")],
    second,
  );
  await askedAt(second, NOW);
  const firstTurn = hostTurnId(first.sessionId, FIRST_EVE_TURN);
  const secondTurn = hostTurnId(second.sessionId, FIRST_EVE_TURN);

  const page = await database.run(brainTurnsPage(target, undefined));
  assert.deepEqual(turnsOf(page), [
    [firstTurn, "Here is the funnel."],
    [secondTurn, "Expiry is seven days."],
  ]);
  assert.equal(page.status, CODING_AGENT_STATUS.COMPLETED);
  assert.equal(page.earlier, undefined);
  assert.doesNotMatch(JSON.stringify(page.messages), /page body/u);
  // Each turn says what opened it, which is how the Call tab tells a spoken turn no line asked for, as the look around a call opens with is.
  assert.deepEqual(
    page.messages.map((message) => message.origin),
    [TURN_ORIGIN.SPOKEN, TURN_ORIGIN.SPOKEN],
  );

  const third = standingFor(target);
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Admins may revoke.")],
    third,
  );
  const past = await database.run(brainPagePast(target, page.cursor));
  assert.deepEqual(turnsOf(past), [
    [hostTurnId(third.sessionId, FIRST_EVE_TURN), "Admins may revoke."],
  ]);
  const stranger = await database.createUser();
  const theirs = await database.run(
    brainTurnsPage({ userId: stranger, conversationId: target.conversationId }, undefined),
  );
  assert.deepEqual(theirs.messages, []);
});

test("a plan at rest answers a reader with nothing new at once, and the page before its newest turns reads the older ones", async () => {
  const target = await taskConversation();
  const standings = Array.from({ length: TASK_WORK_BOUNDS.TURNS + 1 }, () => standingFor(target));
  for (const [index, standing] of standings.entries()) {
    await play(
      [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, `Answer ${index}.`)],
      standing,
    );
    await askedAt(standing, NOW + index * 1_000);
  }

  const newest = await database.run(brainTurnsPage(target, undefined));
  assert.equal(newest.messages.length, TASK_WORK_BOUNDS.TURNS);
  assert.deepEqual(turnsOf(newest).at(0)?.[1], "Answer 1.");
  assert.ok(newest.earlier !== undefined);
  const older = await database.run(brainTurnsPage(target, newest.earlier));
  assert.deepEqual(turnsOf(older), [
    [hostTurnId(standings[0]?.sessionId ?? "", FIRST_EVE_TURN), "Answer 0."],
  ]);
  const quiet = await database.run(brainPagePast(target, newest.cursor));
  assert.deepEqual(quiet.messages, []);
});

test("a planner page says where each worker its turns delegated to stands, read from the worker's own session: running while it runs though its call answered at its receipt, and done once it answers", async () => {
  const target = await taskConversation();
  const standing = standingFor(target);
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: BRAIN_DELEGATE_TOOL.name,
          input: { task: "Compare the two queue libraries." },
          output:
            "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "A worker is comparing them."),
    ],
    standing,
  );
  const callId = "call-0-0";
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, callId),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  const statusOf = (page: BrainPage) =>
    page.subagents?.map((worker) => [worker.callId, worker.status]);

  const running = await database.run(brainTurnsPage(target, undefined));
  assert.deepEqual(statusOf(running), [[callId, CODING_AGENT_STATUS.RUNNING]]);
  // The turn that started the worker has answered, but the brain still works while its worker does.
  assert.equal(running.status, CODING_AGENT_STATUS.RUNNING);

  await play(answeringStep(FIRST_EVE_TURN, 1, "Both let an admin revoke."), childStanding);
  const answered = await database.run(brainPagePast(target, running.cursor));
  assert.deepEqual(statusOf(answered), [[callId, CODING_AGENT_STATUS.COMPLETED]]);
});

test("a reader past the cursor reads on through a run of the voice's rows longer than a page to the turn's journal behind it", async () => {
  const target = await taskConversation();
  const first = standingFor(target);
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Invites live in one file.")],
    first,
  );
  const { cursor } = await database.run(brainTurnsPage(target, undefined));
  for (let line = 0; line <= CODING_AGENT_BOUNDS.MESSAGES_PAGE; line += 1) {
    await database.run(
      writer.upsertSpokenRow(target, {
        role: MESSAGE_ROLE.USER,
        clientId: `line-${line}`,
        text: `Line ${line}`,
        metadata: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
      }),
    );
  }
  const second = standingFor(target);
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Expiry is seven days.")],
    second,
  );

  const past = await database.run(brainPagePast(target, cursor));
  assert.deepEqual(turnsOf(past), [
    [hostTurnId(second.sessionId, FIRST_EVE_TURN), "Expiry is seven days."],
  ]);
});

test("a planning call names the session of the worker it started, the one a later call sent more work to included, and no session for a call no delegation made", async () => {
  const target = await taskConversation();
  const task = "delegate-7k2m9q";
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: BRAIN_DELEGATE_TOOL.name,
          input: { task: "Compare the two queue libraries." },
          output: `Started task ${task}. Its result will arrive in a <task_result> message.`,
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "A worker is comparing them."),
    ],
    standingFor(target),
  );
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 2, [
        {
          toolName: BRAIN_DELEGATE_TOOL.name,
          input: { task: "Also read their licenses.", taskId: task },
          output: "Sent.",
        },
      ]),
    ],
    standingFor(target),
  );

  assert.equal(await database.run(brainWorkerSession(target, "call-0-0")), "call-0-0");
  assert.equal(await database.run(brainWorkerSession(target, "call-2-0")), "call-0-0");
  assert.equal(await database.run(brainWorkerSession(target, "call-9-9")), undefined);
});

test("a held reader hears a worker end beside one still running at the next look, rather than at the hold's end", async () => {
  const target = await taskConversation();
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Two workers are on it.")],
    standingFor(target),
  );
  const workerTurns: string[] = [];
  for (const callId of ["call-a", "call-b"]) {
    const child = childConversationId(target.conversationId, callId);
    await database.run(openChildConversation(target, child, "worker"));
    workerTurns.push(
      await insertTurn(database.run, {
        userId: target.userId,
        conversationId: child,
        origin: TURN_ORIGIN.CHILD,
        status: TURN_STATUS.RUNNING,
      }),
    );
  }
  const { cursor } = await database.run(brainTurnsPage(target, undefined));

  const answered = await database.run(
    Effect.gen(function* () {
      const read = yield* Effect.forkChild(brainPagePast(target, cursor));
      yield* TestClock.adjust(BRAIN_POLL);
      const db = yield* Database;
      yield* db
        .update(turns)
        .set({ status: TURN_STATUS.SETTLED, settledAt: new Date() })
        .where(eq(turns.id, workerTurns[0] ?? ""));
      yield* TestClock.adjust(BRAIN_POLL);
      return yield* Fiber.join(read);
    }).pipe(Effect.provide(TestClock.layer())),
  );
  assert.deepEqual(answered.messages, []);
});

test("a planning worker's title is awaited while it is untitled and its turn settled inside the title's bound, and not once it is titled", async () => {
  const target = await taskConversation();
  const child = childConversationId(target.conversationId, "call-0-0");
  await database.run(openChildConversation(target, child, "worker"));
  await insertTurn(database.run, {
    userId: target.userId,
    conversationId: child,
    origin: TURN_ORIGIN.CHILD,
    status: TURN_STATUS.SETTLED,
    settledAt: new Date(),
  });

  assert.equal(await database.run(brainTitleAwaited(target, child)), true);
  await database.run(fillChildTitle(target, child, "Queue libraries"));
  assert.equal(await database.run(brainTitleAwaited(target, child)), false);
});

test("a page no journal moved says where a worker under a turn older than a page of them stands, so its end is heard", async () => {
  const target = await taskConversation();
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        {
          toolName: BRAIN_DELEGATE_TOOL.name,
          input: { task: "Compare the two queue libraries." },
          output:
            "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
        },
      ]),
      ...answeringStep(FIRST_EVE_TURN, 1, "A worker is comparing them."),
    ],
    standingFor(target),
  );
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, "call-0-0"),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  const childStanding: RelayStanding = { ...standingFor(child), turn: RELAY_TURN.CHILD };
  await play(
    [
      ...opening(FIRST_EVE_TURN),
      ...callingStep(FIRST_EVE_TURN, 0, [
        { toolName: RUN_IN_REPOSITORY_TOOL.name, input: { command: "ls vendor" } },
      ]),
    ],
    childStanding,
  );
  // More turns follow than a page of them, so the worker's own turn is older than any page reads.
  for (let index = 0; index <= TASK_WORK_BOUNDS.TURNS; index += 1) {
    await play(
      [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, `Answer ${index}.`)],
      standingFor(target),
    );
  }
  const { cursor } = await database.run(brainTurnsPage(target, undefined));
  await play(answeringStep(FIRST_EVE_TURN, 1, "Both let an admin revoke."), childStanding);

  const past = await database.run(brainPagePast(target, cursor));
  assert.deepEqual(past.messages, []);
  assert.deepEqual(
    past.subagents?.map((worker) => [worker.callId, worker.status]),
    [["call-0-0", CODING_AGENT_STATUS.COMPLETED]],
  );
});

test("a planner page's journal of a turn longer than the bound says its older parts were left out, and a short one says nothing", async () => {
  const target = await taskConversation();
  const calls = Array.from({ length: TASK_WORK_BOUNDS.PARTS + 1 }, () => ({
    toolName: RUN_IN_REPOSITORY_TOOL.name,
    input: { command: "ls" },
    output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: "src", stderr: "" },
  }));
  await play(
    [...opening(FIRST_EVE_TURN), ...callingStep(FIRST_EVE_TURN, 0, calls)],
    standingFor(target),
  );
  await play(
    [...opening(FIRST_EVE_TURN), ...answeringStep(FIRST_EVE_TURN, 0, "Short.")],
    standingFor(target),
  );

  const page = await database.run(brainTurnsPage(target, undefined));
  assert.deepEqual(
    page.messages.map((message) => message.earlierOmitted),
    [true, undefined],
  );
});
