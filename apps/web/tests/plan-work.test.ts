import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@sidecar/database/core/query";
import { askRecord } from "@sidecar/database/models/asks";
import { hostTurnId } from "@sidecar/database/models/ids";
import { createPlan, openPlanConversation } from "@sidecar/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import { turns } from "@sidecar/database/schemas/storage";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  type PlanWorkAnswer,
} from "@sidecar/hosted/planning-view";
import type { WireRecord } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { readPlanWork } from "../server/hosted/plan-work-store";
import { SHOW_CODE_TOOL } from "../server/hosted/show-code";
import { stampedEveEvent } from "./support/eve-events";
import { FIRST_EVE_TURN } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

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
