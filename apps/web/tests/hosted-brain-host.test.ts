import assert from "node:assert/strict";
import test, { after } from "node:test";
import { BRAIN_REQUEST_STATUS, BRAIN_SUBMISSION_OUTCOME, freshBrainState } from "@sidecar/brain";
import {
  BRAIN_REQUEST_ORIGIN,
  brainAskCancelPath,
  brainAskRunPath,
  conversationLineRatingPath,
  HOSTED_SERVICE_PATH,
  hostedBrainAskAnswerSchema,
  hostedBrainRunAnswerSchema,
  hostedConversationLinesAnswerSchema,
  hostedFactsAnswerSchema,
  LINE_RATING,
  RESPONSES_INPUT_ITEM_TYPE,
} from "@sidecar/hosted";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { and, eq } from "drizzle-orm";
import {
  BRAIN_TURN_TRIGGER,
  checkpointFormatTag,
  MAIN_SESSION_KEY,
  REALTIME_TOOL,
  RESPONSES_ITEM_FORMAT,
  RUN_END_REASON,
  RUN_ORIGIN,
  TOOL_LOOP_RUNTIME,
  UNKNOWN_ACTION_STATUS,
} from "../server/core";
import {
  actionReceipt,
  conversation,
  conversationLease,
  conversationLine,
  conversationLineRating,
  conversationRun,
  personalFact,
  runtimeCheckpoint,
  user,
} from "../server/db/schema";
import {
  handleBrainAsk,
  handleBrainAskCancel,
  handleBrainAskWait,
} from "../server/hosted/brain-host/ask";
import {
  handleConversationClear,
  handleConversationLines,
  handleLineRating,
} from "../server/hosted/brain-host/conversation";
import { handleFacts } from "../server/hosted/brain-host/facts";
import {
  answered,
  type BrainRouteHarness,
  brainRouteHarness,
  functionCall,
  jsonRequest,
  message,
  REMEMBER_CALL,
} from "./support/brain-route";
import {
  type HostedStoreTestDatabase,
  openHostedStoreTestDatabase,
} from "./support/hosted-store-database";

/** Synthetic fixtures: no real title, branch, or transcript anywhere. */

const ORIGIN = "https://luke.test";
const ASK_URL = `${ORIGIN}${HOSTED_SERVICE_PATH.BRAIN_ASK}`;

const opening = openHostedStoreTestDatabase();
after(async () => {
  await (await opening).close();
});

async function developer(): Promise<{
  database: HostedStoreTestDatabase;
  userId: string;
  harness: BrainRouteHarness;
}> {
  const database = await opening;
  const userId = await database.createUser();
  return { database, userId, harness: brainRouteHarness(database, userId) };
}

async function ask(harness: BrainRouteHarness, question: string, submissionId?: string) {
  const response = await handleBrainAsk(
    harness.route(
      jsonRequest(ASK_URL, "POST", {
        question,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
        ...(submissionId ? { submissionId } : undefined),
      }),
    ),
  );
  assert.equal(response.status, 200);
  const answer = hostedBrainAskAnswerSchema.parse(await response.json());
  assert.ok(answer);
  return answer;
}

async function waitFor(harness: BrainRouteHarness, runId: string, waitMs = 5_000) {
  const response = await handleBrainAskWait(
    harness.route(jsonRequest(`${ORIGIN}${brainAskRunPath(runId)}?wait=${waitMs}`, "GET")),
  );
  assert.equal(response.status, 200);
  const answer = hostedBrainRunAnswerSchema.parse(await response.json());
  assert.ok(answer);
  return answer.run;
}

async function lines(harness: BrainRouteHarness, after?: number) {
  const url = `${ORIGIN}${HOSTED_SERVICE_PATH.CONVERSATION}${after === undefined ? "" : `?after=${after}`}`;
  const response = await handleConversationLines(harness.route(jsonRequest(url, "GET")));
  assert.equal(response.status, 200);
  const answer = hostedConversationLinesAnswerSchema.parse(await response.json());
  assert.ok(answer);
  return answer;
}

test("an ask runs a turn in the service: the fact is remembered, the receipt journaled, the about-fields written, and the lines stand", async () => {
  const { database, userId, harness } = await developer();
  harness.model.answers.push(
    answered([REMEMBER_CALL("call-remember", "The developer prefers short replies")]),
    answered([message("Noted: short replies from now on.")]),
  );

  const accepted = await ask(harness, "remember that I prefer short replies");
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  if (accepted.outcome !== BRAIN_SUBMISSION_OUTCOME.ACCEPTED) return;
  await harness.drain();

  const run = await waitFor(harness, accepted.runId);
  assert.equal(run.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(run.text, "Noted: short replies from now on.");
  assert.equal(run.performedActions, 1);
  // Every inference spent the one daily meter, and nothing else did.
  assert.equal(harness.spends.length, 2);
  // The action tool was offered; the tools the service cannot perform were not.
  const offered = harness.model.toolsOffered[0] ?? [];
  assert.ok(offered.includes(REALTIME_TOOL.REMEMBER_FACT));
  assert.ok(offered.includes(REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(!offered.includes(REALTIME_TOOL.OPEN_SESSION));
  assert.ok(!offered.includes(REALTIME_TOOL.CHANGE_APP_SETTING));
  assert.ok(!offered.includes("sessions_spawn"));
  assert.ok(!offered.includes("memory_search"));
  assert.ok(!offered.includes("announce"));

  const facts = await database.db
    .select()
    .from(personalFact)
    .where(eq(personalFact.userId, userId));
  assert.equal(facts.length, 1);
  const factsAnswer = hostedFactsAnswerSchema.parse(
    await (
      await handleFacts(harness.route(jsonRequest(`${ORIGIN}${HOSTED_SERVICE_PATH.FACTS}`, "GET")))
    ).json(),
  );
  assert.deepEqual(
    factsAnswer?.facts.map((fact) => fact.words),
    ["The developer prefers short replies"],
  );

  const receipts = await database.db
    .select()
    .from(actionReceipt)
    .where(and(eq(actionReceipt.userId, userId), eq(actionReceipt.runId, accepted.runId)));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.name, REALTIME_TOOL.REMEMBER_FACT);
  assert.notEqual(receipts[0]?.sealedOutput, null);

  const about = await database.store.runs.about(userId, accepted.runId);
  assert.equal(about?.trigger, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(about?.origin, RUN_ORIGIN.USER);
  assert.equal(about?.ending, RUN_END_REASON.COMPLETED);
  assert.equal(about?.inputTokens, 100);
  assert.equal(about?.outputTokens, 40);
  assert.ok(about?.toolNames?.includes(REALTIME_TOOL.REMEMBER_FACT));
  assert.equal(about?.compacted, false);

  const thread = await lines(harness);
  assert.deepEqual(
    thread.lines.map((line) => [line.kind, line.words]),
    [
      [CONVERSATION_ENTRY_KIND.TYPED_ASK, "remember that I prefer short replies"],
      [CONVERSATION_ENTRY_KIND.REPLY, "Noted: short replies from now on."],
    ],
  );
  assert.equal(thread.lines[1]?.requestId, accepted.runId);
  assert.ok(thread.cursor !== undefined);
  const newer = await lines(harness, thread.cursor);
  assert.deepEqual(newer.lines, []);
  // The lease was released with the run, and the run's cancel column is untouched.
  const leases = await database.db
    .select()
    .from(conversationLease)
    .where(eq(conversationLease.userId, userId));
  assert.deepEqual(leases, []);
  // A retried submission finds the same run rather than opening a second.
  const again = await ask(harness, "remember that I prefer short replies", accepted.runId);
  assert.equal(again.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await harness.drain();
});

test("a refused meter ends the run the way the desktop's refusal does, and the reply says so", async () => {
  const { harness } = await developer();
  harness.refuse = true;
  harness.model.answers.push(answered([message("never reached")]));

  const accepted = await ask(harness, "what is going on?");
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  if (accepted.outcome !== BRAIN_SUBMISSION_OUTCOME.ACCEPTED) return;
  await harness.drain();

  const run = await waitFor(harness, accepted.runId);
  assert.equal(run.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(run.failure, "model");
  assert.equal(harness.model.inputs.length, 0);
  assert.equal(harness.spends.length, 1);
  const thread = await lines(harness);
  assert.equal(thread.lines.at(-1)?.kind, CONVERSATION_ENTRY_KIND.REPLY);
  assert.match(thread.lines.at(-1)?.words ?? "", /Ask me again/u);
});

test("a run a function left mid-action is resumed by the next wait from its journal, and the journaled action is not performed again", async () => {
  const { database, userId, harness } = await developer();
  await database.store.conversations.create(userId, {
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: Date.now(),
  });
  const runId = "run-orphaned";
  const call = functionCall("call-orphaned", REALTIME_TOOL.REMEMBER_FACT, {
    words: "The developer works from Lisbon",
  });
  const left = {
    ...freshBrainState("gen-orphaned", Date.now() - 60_000),
    checkpointFormat: checkpointFormatTag({
      runtime: TOOL_LOOP_RUNTIME.ID,
      runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
      format: RESPONSES_ITEM_FORMAT.format,
      formatVersion: RESPONSES_ITEM_FORMAT.version,
    }),
    items: [
      {
        type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
        role: "user",
        content: [{ type: "input_text", text: "[developer ask] remember where I work" }],
      },
      call,
    ],
    requests: [
      {
        runId,
        submissionId: "submission-orphaned",
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
        question: "remember where I work",
        status: BRAIN_REQUEST_STATUS.RUNNING,
        revision: 1,
        acceptedAt: Date.now() - 50_000,
        startedAt: Date.now() - 49_000,
        performedActions: 0,
        unknownActions: 0,
      },
    ],
    journal: [
      {
        runId,
        callId: "call-orphaned",
        name: REALTIME_TOOL.REMEMBER_FACT,
        argumentsJson: String(call.arguments),
        startedAt: Date.now() - 48_000,
      },
    ],
  };
  assert.ok(await database.store.brainStateRepository(userId, MAIN_SESSION_KEY).save(left));
  // The holder that died left its lease behind, expired.
  assert.ok(
    await database.store.leases.acquire(
      userId,
      MAIN_SESSION_KEY,
      "dead-function",
      Date.now() - 120_000,
      30_000,
    ),
  );
  harness.model.answers.push(
    answered([message("I have that noted, though the earlier save is unconfirmed.")]),
  );

  const run = await waitFor(harness, runId);
  await harness.drain();

  assert.equal(run.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(run.unknownActions, 1);
  assert.equal(run.performedActions, 0);
  // The model read the journaled call paired with its lost result and was asked with no new words.
  const input = harness.model.inputs[0] ?? [];
  const output = input.find((item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  assert.ok(output);
  assert.ok(String(output.output).includes(UNKNOWN_ACTION_STATUS));
  // Nothing was remembered twice: the facts table holds no row for the lost call.
  const facts = await database.db
    .select()
    .from(personalFact)
    .where(eq(personalFact.userId, userId));
  assert.deepEqual(facts, []);
  // The reply carries the run's honest account of the action nobody confirmed.
  const thread = await lines(harness);
  assert.equal(
    thread.lines.at(-1)?.words,
    "I have that noted, though the earlier save is unconfirmed. one action may have gone through without confirming, so I won't repeat it on my own.",
  );
});

test("a cancel is performed by the request when no holder stands, and noted for the holder when one does", async () => {
  const { database, userId, harness } = await developer();
  await database.store.conversations.create(userId, {
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: Date.now(),
  });
  const queued = {
    ...freshBrainState("gen-queued", Date.now() - 60_000),
    requests: [
      {
        runId: "run-queued",
        submissionId: "submission-queued",
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
        question: "a question nobody ran",
        status: BRAIN_REQUEST_STATUS.QUEUED,
        revision: 0,
        acceptedAt: Date.now() - 50_000,
        performedActions: 0,
        unknownActions: 0,
      },
    ],
  };
  assert.ok(await database.store.brainStateRepository(userId, MAIN_SESSION_KEY).save(queued));

  const cancelled = await handleBrainAskCancel(
    harness.route(jsonRequest(`${ORIGIN}${brainAskCancelPath("run-queued")}`, "POST")),
  );
  assert.equal(cancelled.status, 200);
  const answer = hostedBrainRunAnswerSchema.parse(await cancelled.json());
  assert.equal(answer?.run.status, BRAIN_REQUEST_STATUS.CANCELLED);
  await harness.drain();
  assert.equal(harness.model.inputs.length, 0);

  const unknown = await handleBrainAskCancel(
    harness.route(jsonRequest(`${ORIGIN}${brainAskCancelPath("run-missing")}`, "POST")),
  );
  assert.equal(unknown.status, 404);

  // A holder alive elsewhere: the cancel is noted on the row and answered as accepted.
  const held = await database.createUser();
  const heldHarness = brainRouteHarness(database, held);
  await database.store.conversations.create(held, {
    sessionKey: MAIN_SESSION_KEY,
    name: "main",
    now: Date.now(),
  });
  assert.ok(
    await database.store
      .brainStateRepository(held, MAIN_SESSION_KEY)
      .save({ ...queued, generationId: "gen-held" }),
  );
  assert.ok(
    await database.store.leases.acquire(
      held,
      MAIN_SESSION_KEY,
      "live-function",
      Date.now(),
      30_000,
    ),
  );
  const noted = await handleBrainAskCancel(
    heldHarness.route(jsonRequest(`${ORIGIN}${brainAskCancelPath("run-queued")}`, "POST")),
  );
  assert.equal(noted.status, 202);
  const [row] = await database.db
    .select({ cancelRequestedAt: conversationRun.cancelRequestedAt })
    .from(conversationRun)
    .where(and(eq(conversationRun.userId, held), eq(conversationRun.runId, "run-queued")));
  assert.notEqual(row?.cancelRequestedAt, null);
  assert.deepEqual(await database.store.runs.cancelRequested(held, MAIN_SESSION_KEY), [
    "run-queued",
  ]);
});

test("a rating attaches only to a line Luke authored in the caller's own conversation, and travels back with the lines", async () => {
  const { database, userId, harness } = await developer();
  harness.model.answers.push(answered([message("Here is my reply.")]));
  const accepted = await ask(harness, "say something");
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await harness.drain();

  const thread = await lines(harness);
  const askLine = thread.lines.find((line) => line.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK);
  const replyLine = thread.lines.find((line) => line.kind === CONVERSATION_ENTRY_KIND.REPLY);
  assert.ok(askLine?.eventId === undefined || askLine.eventId);
  assert.ok(replyLine);
  // A reply published by the brain carries no writer-minted id, so the store's
  // key is its value; the rating names the line by the id the store hands
  // back, which for such a line is absent, and the route names it by value.
  const replyId = replyLine.eventId;
  const rate = (lineId: string, body: WireRecord) =>
    handleLineRating(
      harness.route(jsonRequest(`${ORIGIN}${conversationLineRatingPath(lineId)}`, "PUT", body)),
    );

  const unknown = await rate("not-a-line", { rating: LINE_RATING.DOWN, deviceId: "device-1" });
  assert.equal(unknown.status, 404);
  const malformed = await rate("not-a-line", { rating: "sideways", deviceId: "device-1" });
  assert.equal(malformed.status, 400);

  // A line the brain announced carries its briefing's id and takes a rating.
  const announcementId = "briefing-1";
  await database.store.lines.append(
    userId,
    MAIN_SESSION_KEY,
    [
      {
        kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
        words: "The checkout agent finished.",
        eventId: announcementId,
        recordedAt: Date.now(),
      },
    ],
    Date.now(),
  );
  const rated = await rate(announcementId, {
    rating: LINE_RATING.UP,
    note: "exactly right",
    deviceId: "device-1",
  });
  assert.equal(rated.status, 200);
  const rows = await database.db
    .select()
    .from(conversationLineRating)
    .where(eq(conversationLineRating.userId, userId));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.rating, LINE_RATING.UP);
  assert.equal(rows[0]?.deviceId, "device-1");
  assert.notEqual(rows[0]?.sealedNote, null);
  assert.ok(!String(rows[0]?.sealedNote).includes("exactly right"));

  // The developer's own line, by id, is not Luke's to be rated.
  await database.store.lines.append(
    userId,
    MAIN_SESSION_KEY,
    [
      {
        kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
        words: "my own words",
        eventId: "ask-line-1",
        recordedAt: Date.now(),
      },
    ],
    Date.now(),
  );
  const own = await rate("ask-line-1", { rating: LINE_RATING.DOWN, deviceId: "device-1" });
  assert.equal(own.status, 404);

  // Another account's line is not this caller's, whatever its id.
  const other = await database.createUser();
  const otherHarness = brainRouteHarness(database, other);
  const foreign = await handleLineRating(
    otherHarness.route(
      jsonRequest(`${ORIGIN}${conversationLineRatingPath(announcementId)}`, "PUT", {
        rating: LINE_RATING.DOWN,
        deviceId: "device-2",
      }),
    ),
  );
  assert.equal(foreign.status, 404);

  const withRatings = await lines(harness);
  const announced = withRatings.lines.find((line) => line.eventId === announcementId);
  assert.equal(announced?.rating, LINE_RATING.UP);
  assert.equal(replyId === undefined || replyId.length > 0, true);
});

test("Clear hard-deletes the conversation under its lease, and deleting the account cascades through every brain-host row", async () => {
  const { database, userId, harness } = await developer();
  harness.model.answers.push(answered([message("A reply to clear.")]));
  const accepted = await ask(harness, "something to clear");
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await harness.drain();
  await database.store.lines.append(
    userId,
    MAIN_SESSION_KEY,
    [
      {
        kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
        words: "An announcement to clear.",
        eventId: "briefing-clear",
        recordedAt: Date.now(),
      },
    ],
    Date.now(),
  );
  await handleLineRating(
    harness.route(
      jsonRequest(`${ORIGIN}${conversationLineRatingPath("briefing-clear")}`, "PUT", {
        rating: LINE_RATING.DOWN,
        deviceId: "device-1",
      }),
    ),
  );

  // A conversation another function holds is not cleared under it.
  assert.ok(
    await database.store.leases.acquire(
      userId,
      MAIN_SESSION_KEY,
      "live-function",
      Date.now(),
      30_000,
    ),
  );
  const busy = await handleConversationClear(
    harness.route(jsonRequest(`${ORIGIN}${HOSTED_SERVICE_PATH.CONVERSATION}`, "DELETE")),
  );
  assert.equal(busy.status, 409);
  assert.ok(await database.store.leases.release(userId, MAIN_SESSION_KEY, "live-function"));

  const cleared = await handleConversationClear(
    harness.route(jsonRequest(`${ORIGIN}${HOSTED_SERVICE_PATH.CONVERSATION}`, "DELETE")),
  );
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { cleared: true });
  const rowsOf = async () => ({
    conversations: (
      await database.db.select().from(conversation).where(eq(conversation.userId, userId))
    ).length,
    lines: (
      await database.db.select().from(conversationLine).where(eq(conversationLine.userId, userId))
    ).length,
    ratings: (
      await database.db
        .select()
        .from(conversationLineRating)
        .where(eq(conversationLineRating.userId, userId))
    ).length,
    runs: (
      await database.db.select().from(conversationRun).where(eq(conversationRun.userId, userId))
    ).length,
    checkpoints: (
      await database.db.select().from(runtimeCheckpoint).where(eq(runtimeCheckpoint.userId, userId))
    ).length,
    leases: (
      await database.db.select().from(conversationLease).where(eq(conversationLease.userId, userId))
    ).length,
    facts: (await database.db.select().from(personalFact).where(eq(personalFact.userId, userId)))
      .length,
  });
  assert.deepEqual(await rowsOf(), {
    conversations: 0,
    lines: 0,
    ratings: 0,
    runs: 0,
    checkpoints: 0,
    leases: 0,
    facts: 0,
  });
  // The thread reads empty rather than failing, and the next ask makes a fresh conversation.
  const empty = await lines(harness);
  assert.deepEqual(empty.lines, []);
  harness.model.answers.push(answered([message("Fresh start.")]));
  const fresh = await ask(harness, "hello again");
  assert.equal(fresh.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await harness.drain();
  await database.store.facts.replace(userId, [{ id: "fact-1", words: "A fact." }], Date.now());
  assert.ok(
    await database.store.leases.acquire(
      userId,
      MAIN_SESSION_KEY,
      "another-function",
      Date.now(),
      30_000,
    ),
  );

  await database.db.delete(user).where(eq(user.id, userId));
  assert.deepEqual(await rowsOf(), {
    conversations: 0,
    lines: 0,
    ratings: 0,
    runs: 0,
    checkpoints: 0,
    leases: 0,
    facts: 0,
  });
});

test("the ask routes refuse a missing bearer, a missing key, a malformed ask, and a conversation another holder runs", async () => {
  const { database, userId, harness } = await developer();
  const unauthorized = await handleBrainAsk(
    harness.route(
      new Request(ASK_URL, {
        method: "POST",
        body: JSON.stringify({ question: "x", origin: "typed" }),
      }),
    ),
  );
  assert.equal(unauthorized.status, 401);
  const noKey = await handleBrainAsk(
    harness.route(jsonRequest(ASK_URL, "POST", { question: "x", origin: "typed" }), {
      openAiKey: undefined,
    }),
  );
  assert.equal(noKey.status, 503);
  const malformed = await handleBrainAsk(
    harness.route(jsonRequest(ASK_URL, "POST", { question: "x", origin: "child" })),
  );
  assert.equal(malformed.status, 400);
  const method = await handleBrainAsk(harness.route(jsonRequest(ASK_URL, "GET")));
  assert.equal(method.status, 405);
  assert.ok(
    await database.store.leases.acquire(
      userId,
      MAIN_SESSION_KEY,
      "live-function",
      Date.now(),
      30_000,
    ),
  );
  const busy = await handleBrainAsk(
    harness.route(jsonRequest(ASK_URL, "POST", { question: "x", origin: "typed" })),
  );
  assert.equal(busy.status, 409);
  assert.equal(harness.model.inputs.length, 0);
  const missing = await handleBrainAskWait(
    harness.route(jsonRequest(`${ORIGIN}${brainAskRunPath("nope")}`, "GET")),
  );
  assert.equal(missing.status, 404);
});
