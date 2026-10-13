import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@sidecar/database/core/query";
import { askRecord } from "@sidecar/database/models/asks";
import { childConversationId, hostTurnId } from "@sidecar/database/models/ids";
import { listJournals } from "@sidecar/database/models/message-reads";
import { createPlan, openPlanConversation } from "@sidecar/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import { turns } from "@sidecar/database/schemas/storage";
import { LOOK_AT_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import { TURN_ENDING, type TurnRecord } from "@sidecar/hosted/coding-agent-wire";
import { SHOW_PAGE_TOOL_NAME } from "@sidecar/hosted/page-wire";
import {
  PLAN_WORK_BOUNDS,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  type PlanWorkAnswer,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { isRecord, isWireString, type WireRecord, type WireValue } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { TURN_STATUS } from "../server/core";
import { BRAIN_HOST_TURN, RELAY_TURN } from "../server/hosted/brain-host/bounds";
import { openChildConversation } from "../server/hosted/brain-host/conversation";
import { PLANNER_DELEGATE_TOOL } from "../server/hosted/brain-host/planning";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { readPlanWork } from "../server/hosted/plan-work-store";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { SHOW_CODE_TOOL } from "../server/hosted/show-code";
import { planWorkOf } from "../server/voice/plan-work";
import { stampedEveEvent } from "./support/eve-events";
import { FIRST_EVE_TURN } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * One planning turn's work as the Work tab is sent it, over the real
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

/** A plan of a new account, with the conversation its planning model runs in. */
async function planConversation(): Promise<ConversationTarget & { planId: string }> {
  const userId = await database.createUser();
  const plan = await database.run(createPlan(userId, { name: "Teammate invitations" }));
  const opened = await database.run(openPlanConversation(userId, plan.id));
  assert.ok(Option.isSome(opened));
  return { userId, conversationId: opened.value, planId: plan.id };
}

/**
 * Stamps a played turn as asked and started at `at`, so the turns of a plan
 * read in the order they were asked; the row's own queue stamp is the
 * database's clock, which a test does not hold.
 */
async function askedAt(standing: RelayStanding, at: number): Promise<void> {
  await database.run(
    db
      .update(turns)
      .set({ queuedAt: new Date(at), startedAt: new Date(at) })
      .where(eq(turns.id, hostTurnId(standing.sessionId, FIRST_EVE_TURN))),
  );
}

/** The code a read answered, by the call and turn that showed it, as the tab would tell them apart. */
function shownBy(read: Option.Option<PlanWorkAnswer>) {
  assert.ok(Option.isSome(read));
  return (read.value.code ?? []).map(({ callId, turnId, code }) => [callId, turnId, code]);
}

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

/** The turn's work as its record and journal now stand, read the way the voice session reads them. */
async function worked(target: ConversationTarget, standing: RelayStanding): Promise<PlanWorkTurn> {
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
  return planWorkOf(turn, journal.value[0]?.message);
}

test("a plan's work reads back from its conversation after the call: its turns oldest first and every code shown with Luke's note, several of one file included, for the account that owns it alone", async () => {
  const target = await planConversation();
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

  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
  assert.ok(Option.isSome(read));
  assert.deepEqual(
    read.value.turns.map((turn) => [turn.state, turn.parts.at(-1)]),
    [
      [PLAN_WORK_STATE.DONE, { type: PLAN_WORK_PART.TEXT, text: "Invites live in one file." }],
      [PLAN_WORK_STATE.DONE, { type: PLAN_WORK_PART.TEXT, text: "Expiry is seven days." }],
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
  assert.ok(Option.isNone(await database.run(readPlanWork(stranger, target.planId, undefined))));
});

test("a plan never planned on reads as no work, and a secret file a journal holds is not read back as code", async () => {
  const userId = await database.createUser();
  const fresh = await database.run(createPlan(userId, { name: "Billing export" }));
  assert.deepEqual(
    await database.run(readPlanWork(userId, fresh.id, undefined)),
    Option.some({ turns: [], code: [] }),
  );

  const target = await planConversation();
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
  const read = await database.run(readPlanWork(target.userId, target.planId, undefined));
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
          toolName: PLANNER_DELEGATE_TOOL.name,
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
    return planWorkOf(
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
  assert.equal(running.state, PLAN_WORK_STATE.DONE);
  assert.deepEqual(typed(running.journal), [
    [`tool-${PLANNER_DELEGATE_TOOL.name}`, "output-available"],
    ["text", "I've asked a worker to compare them."],
  ]);
  const [worker] = running.workers ?? [];
  assert.equal(worker?.callId, callId);
  assert.equal(worker?.taskId, "delegate-7k2m9q");
  assert.equal(worker?.task, task);
  assert.equal(worker?.state, PLAN_WORK_STATE.RUNNING);
  assert.deepEqual(typed(worker?.journal), [
    [`tool-${RUN_IN_REPOSITORY_TOOL.name}`, "input-available"],
  ]);
  // A turn that failed after its receipt leaves its worker standing as its own session does.
  const [outlived] = (await work(new Map(), true)).workers ?? [];
  assert.equal(outlived?.state, PLAN_WORK_STATE.RUNNING);

  await play(
    answeringStep(FIRST_EVE_TURN, 1, "Both libraries let an admin revoke."),
    childStanding,
  );
  const [answered] = (await work()).workers ?? [];
  assert.equal(answered?.state, PLAN_WORK_STATE.DONE);
  assert.deepEqual(typed(answered?.journal)?.at(-1), [
    "text",
    "Both libraries let an admin revoke.",
  ]);
  const [failed] = (await work(new Map([[callId, { ending: TURN_ENDING.FAILED }]]))).workers ?? [];
  assert.equal(failed?.state, PLAN_WORK_STATE.FAILED);
});

test("a turn's journal keeps its newest parts and says older ones were left out, every string in a call cut to the bound with the call's shape kept", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const long = "x".repeat(PLAN_WORK_BOUNDS.TEXT_CHARS + 50);
  const calls = Array.from({ length: PLAN_WORK_BOUNDS.PARTS + 1 }, () => ({
    toolName: RUN_IN_REPOSITORY_TOOL.name,
    input: { command: long },
    output: { status: REPOSITORY_SHELL_STATUS.RAN, exitCode: 0, stdout: "ok", stderr: "" },
  }));
  await play([...opening(FIRST_EVE_TURN), ...callingStep(FIRST_EVE_TURN, 0, calls)], standing);

  const work = await worked(target, standing);
  assert.equal(work.journal?.length, PLAN_WORK_BOUNDS.PARTS);
  assert.equal(work.earlierOmitted, true);
  const [first] = work.journal ?? [];
  assert.ok(isRecord(first) && isRecord(first.input) && isWireString(first.input.command));
  assert.ok(first.input.command.length <= PLAN_WORK_BOUNDS.TEXT_CHARS);
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
