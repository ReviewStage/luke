import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ServiceReach } from "@repo/features";
import { AGENT_CALL_FAILURE, INBOX_SCOPE_KIND, TRANSCRIPT_KIND } from "@repo/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_STATUS,
  type AgentNewestAnswer,
  type AgentStatus,
  type AgentSummary,
  QUEUE_CHANGE,
} from "@repo/features/agent-wire";
import { FAILURE_FACT, GATE_CLOSED_BY } from "@repo/features/failure-facts";
import { GITHUB_IMAGE_TYPE } from "@repo/features/github-image";
import { FAILED_RUN_WINDOW_MILLIS } from "@repo/features/inbox-live";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LIVE_SIGNED_OUT, type TranscriptNowAnswer } from "@repo/features/live-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@repo/features/pull-request-write-wire";
import { GATEWAY_METHOD } from "@repo/gateway";
import { entityPool } from "@repo/sync";
import { isRecord, type WireValue } from "@repo/wire";
import { Deferred, Duration, Effect, Exit, Fiber, Scope, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import type { AppTranscript } from "./app-state.js";
import { taskListCollections } from "./task-list-collections.js";
import {
  type ACCOUNT_PARTS,
  AGENT,
  AGENT_ID,
  ATTACHMENT_ID,
  CHANGES,
  CHAPTERS,
  FOLLOWED,
  GATE_CLOSED_SIGNED_OUT,
  ITEM,
  type ITEMS_PARTS,
  LIVE_ANSWERED,
  MESSAGE_ID,
  NOW,
  nextPoll,
  OFFLINE,
  PAGE,
  PICTURE_ID,
  settled,
  subject,
  TASK_ID,
  type TranscriptLive,
  WAITING,
  WORKSPACE_ID,
} from "./testing/agents-subject.js";
import type { PolledLive } from "./testing/polled-live.js";
import { agentListRow } from "./testing/task-list-rows.js";
import { HELD_TRANSCRIPTS } from "./transcript-follow.js";

it.effect("each method asks the service once and answers what it said, whole", () =>
  Effect.gen(function* () {
    const { acts, asked, sealTranscript } = yield* subject();
    sealTranscript(LIVE_ANSWERED);

    assert.deepEqual(
      yield* acts.AGENTS_DEFAULT_WRITE({
        model: "openai/gpt-6.1-sol",
        effort: "xhigh",
      }),
      { choice: { model: "openai/gpt-6.1-sol", effort: "xhigh" } },
    );
    assert.deepEqual(
      yield* acts.AGENTS_CHAPTERS_PROVIDER_WRITE({ provider: MODEL_PROVIDER.OPENAI }),
      { provider: MODEL_PROVIDER.OPENAI },
    );
    assert.deepEqual(yield* acts.AGENTS_LIST({ taskId: TASK_ID }), {
      agents: [AGENT],
    });
    assert.deepEqual(yield* acts.AGENTS_LIST({ taskId: TASK_ID, includeArchived: true }), {
      agents: [AGENT],
    });
    assert.deepEqual(
      yield* acts.AGENTS_WORKSPACE_LIST({
        workspaceId: "workspace-1",
        repository: "acme/relay",
      }),
      { agents: [AGENT] },
    );
    assert.deepEqual(
      yield* acts.AGENTS_START({
        taskId: TASK_ID,
        idempotencyKey: "press-1",
      }),
      { agent: { ...AGENT, status: AGENT_STATUS.STARTING } },
    );
    assert.deepEqual(
      yield* acts.AGENTS_MESSAGES({
        agentId: AGENT_ID,
        after: AGENT_CURSOR_START,
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* acts.AGENTS_MESSAGES({
        agentId: AGENT_ID,
        after: AGENT_CURSOR_START,
        callId: "call-7",
      }),
      {
        messages: [{ id: "m-1", role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
        cursor: "2:1",
        status: AGENT_STATUS.RUNNING,
        title: null,
      },
    );
    assert.deepEqual(
      yield* acts.AGENTS_MESSAGE({
        agentId: AGENT_ID,
        text: "Also expire them after a week.",
        clientKey: "send-1",
      }),
      { agent: AGENT },
    );
    assert.deepEqual(
      yield* acts.AGENTS_CHOOSE({
        agentId: AGENT_ID,
        model: "openai/gpt-6.1-sol",
        effort: "low",
      }),
      { agent: { ...AGENT, model: "openai/gpt-6.1-sol", effort: "low" } },
    );
    assert.deepEqual(
      yield* acts.AGENTS_RENAME({
        agentId: AGENT_ID,
        title: "Sign-out button",
      }),
      { agent: { ...AGENT, title: "Sign-out button" } },
    );
    assert.deepEqual(
      yield* acts.AGENTS_SERVERS({
        agentId: AGENT_ID,
        disabledServers: [INTEGRATION_PROVIDER.LINEAR],
      }),
      { agent: { ...AGENT, disabledServers: [INTEGRATION_PROVIDER.LINEAR] } },
    );
    assert.deepEqual(yield* acts.AGENTS_STOP({ agentId: AGENT_ID }), {
      agent: { ...AGENT, status: AGENT_STATUS.CANCELED },
    });
    assert.deepEqual(yield* acts.AGENTS_ARCHIVE({ agentId: AGENT_ID, archived: true }), {
      agent: { ...AGENT, archivedAt: 1_800_000_120_000 },
    });
    assert.deepEqual(yield* acts.AGENTS_PIN({ agentId: AGENT_ID, pinned: true }), {
      agent: AGENT,
    });
    assert.deepEqual(yield* acts.AGENTS_DELETE({ agentId: AGENT_ID }), {
      deleted: true,
      txid: "9102",
    });
    assert.deepEqual(yield* acts.AGENTS_PAGE({ agentId: AGENT_ID }), {
      agent: PAGE,
    });
    assert.deepEqual(yield* acts.AGENTS_CHANGES({ agentId: AGENT_ID }), CHANGES);
    assert.deepEqual(yield* acts.AGENTS_CHANGES({ agentId: AGENT_ID, number: 11 }), CHANGES);
    assert.deepEqual(
      yield* acts.CHAPTERS_GENERATE({
        agentId: AGENT_ID,
        number: 11,
      }),
      CHAPTERS,
    );
    assert.deepEqual(
      yield* acts.AGENTS_GITHUB_IMAGE({
        agentId: AGENT_ID,
        src: "https://camo.githubusercontent.com/abc",
      }),
      { contentType: GITHUB_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* acts.AGENTS_PULL_REQUEST_ACTION({
        agentId: AGENT_ID,
        number: 11,
        request: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
      }),
      { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE },
    );
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_ATTACHMENT({
        itemId: ITEM.id,
        attachmentId: ATTACHMENT_ID,
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* acts.AGENTS_PICTURE({
        agentId: AGENT_ID,
        pictureId: PICTURE_ID,
        callId: "call-worker",
      }),
      { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" },
    );
    assert.deepEqual(
      yield* acts.AGENTS_PART({
        agentId: AGENT_ID,
        messageId: "message-1",
        index: 2,
      }),
      { part: { type: "reasoning", text: "Whole." } },
    );
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_ANSWER({
        itemId: ITEM.id,
        revision: 2,
        reply: INBOX_REPLY.ACKNOWLEDGED,
        clientKey: "answer-1",
      }),
      { item: { ...ITEM, revision: 3, status: INBOX_STATUS.ANSWERED }, taken: true },
    );
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_CLOSE({
        itemId: ITEM.id,
        revision: 2,
        clientKey: "close-1",
      }),
      {
        item: { ...ITEM, status: INBOX_STATUS.CLOSED, closedBy: { userId: "u1", name: "Dana" } },
        taken: true,
      },
    );
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_MESSAGE({
        itemId: ITEM.id,
        text: "Also page on-call.",
        attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
        clientKey: "message-1",
      }),
      {
        item: {
          ...ITEM,
          messages: [
            {
              id: MESSAGE_ID,
              author: INBOX_MESSAGE_AUTHOR.MEMBER,
              text: "Also page on-call.",
              createdAt: ITEM.updatedAt,
            },
          ],
        },
      },
    );
    yield* acts.AGENTS_INBOX_MESSAGE({
      itemId: ITEM.id,
      text: "Ship it.",
      clientKey: "message-2",
      answers: { ask: MESSAGE_ID, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
    });
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_START({
        agentId: AGENT_ID,
        title: "Annual plan copy",
        text: "Draft the annual plan's line too.",
        clientKey: "start-1",
      }),
      {
        item: {
          ...ITEM,
          title: "Annual plan copy",
          messages: [
            {
              id: MESSAGE_ID,
              author: INBOX_MESSAGE_AUTHOR.MEMBER,
              text: "Draft the annual plan's line too.",
              createdAt: ITEM.updatedAt,
            },
          ],
        },
      },
    );
    assert.deepEqual(yield* acts.AGENTS_INBOX_READ_STATE({ itemId: ITEM.id, unread: true }), {
      id: ITEM.id,
      unread: true,
    });
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_READ_STATE({
        itemId: ITEM.id,
        unread: false,
      }),
      { id: ITEM.id, unread: false },
    );
    assert.deepEqual(yield* acts.AGENTS_INBOX_REMIND({ itemId: ITEM.id, until: 5_000 }), {
      id: ITEM.id,
      unread: false,
    });
    assert.deepEqual(
      yield* acts.AGENTS_INBOX_READ_ALL({
        workspaceId: WORKSPACE_ID,
        itemIds: [],
      }),
      { marked: 2 },
    );

    assert.deepEqual(asked, [
      "default:openai/gpt-6.1-sol:xhigh",
      `chapters-provider:${MODEL_PROVIDER.OPENAI}`,
      `list:${TASK_ID}`,
      `list:${TASK_ID}:archived`,
      "workspace:workspace-1:acme/relay",
      `start:${TASK_ID}:press-1:default`,
      `messages-now:${AGENT_ID}:${AGENT_CURSOR_START}`,
      `worker-now:${AGENT_ID}:call-7:${AGENT_CURSOR_START}`,
      `message:${AGENT_ID}:send-1:Also expire them after a week.`,
      `choose:${AGENT_ID}:openai/gpt-6.1-sol:low`,
      `rename:${AGENT_ID}:Sign-out button`,
      `servers:${AGENT_ID}:linear`,
      `stop:${AGENT_ID}`,
      `archive:${AGENT_ID}:true`,
      `pin:${AGENT_ID}:true`,
      `delete:${AGENT_ID}`,
      `page:${AGENT_ID}`,
      `changes:${AGENT_ID}`,
      `changes:${AGENT_ID}#11`,
      `chapters-generate:${AGENT_ID}#11`,
      `github-image:${AGENT_ID}:https://camo.githubusercontent.com/abc`,
      `pull-request-action:${AGENT_ID}#11:${PULL_REQUEST_ACTION.READY_FOR_REVIEW}`,
      `attachment:${ITEM.id}:${ATTACHMENT_ID}`,
      `picture:${AGENT_ID}:${PICTURE_ID}:call-worker`,
      `part:${AGENT_ID}:message-1:2:`,
      `answer:${ITEM.id}:2:${INBOX_REPLY.ACKNOWLEDGED}:answer-1`,
      `close:${ITEM.id}:2:close-1`,
      `inbox-message:${ITEM.id}:Also page on-call.:pager.txt:message-1`,
      `inbox-message:${ITEM.id}:Ship it.::message-2:answers ${MESSAGE_ID} chose Ship it`,
      `inbox-start:${AGENT_ID}:Annual plan copy:Draft the annual plan's line too.:start-1`,
      `inbox-unread:${ITEM.id}`,
      `inbox-read:${ITEM.id}`,
      `inbox-remind:${ITEM.id}:5000`,
      `inbox-read-all:${WORKSPACE_ID}`,
    ]);
  }),
);

it.effect(
  "behind a closed account gate, or on a run that sends nothing, every ask is unanswered",
  () =>
    Effect.gen(function* () {
      const signedOut = yield* subject({ signedIn: false });
      const offline = yield* subject({ sendsNetwork: false });

      assert.deepEqual(
        yield* signedOut.acts.AGENTS_LIST({ taskId: TASK_ID }),
        GATE_CLOSED_SIGNED_OUT,
      );
      assert.deepEqual(yield* offline.acts.AGENTS_LIST({ taskId: TASK_ID }), {
        failure: AGENT_CALL_FAILURE.UNANSWERED,
        cause: { _tag: FAILURE_FACT.GATE_CLOSED, code: GATE_CLOSED_BY.NO_NETWORK },
      });
      assert.deepEqual(signedOut.asked, []);
      assert.deepEqual(offline.asked, []);
    }),
);

it.effect(
  "a Start from an agent that names no task asks the service to start where that agent is, and one on a task still starts on it",
  () =>
    Effect.gen(function* () {
      const { acts, asked } = yield* subject();

      const fromTaskless = yield* acts.AGENTS_START({
        idempotencyKey: "press-continue",
        from: { agentId: AGENT_ID },
      });
      yield* acts.AGENTS_START({
        taskId: TASK_ID,
        idempotencyKey: "press-fork",
        from: { agentId: AGENT_ID },
      });

      assert.deepEqual(fromTaskless, { agent: { ...AGENT, status: AGENT_STATUS.STARTING } });
      assert.deepEqual(asked, [
        `start-from:${AGENT_ID}:press-continue`,
        `start:${TASK_ID}:press-fork:default`,
      ]);
    }),
);

/** The transcript's statements as they stand: `seq` its newest message, `turns` how many it has opened. */
function transcriptRows(live: { readonly transcript: TranscriptLive }, seq: number, turns = 1) {
  live.transcript.set({
    messages: [],
    turns: [{ status: "running", rows: turns, stopped: 0, changedAt: NOW - 1_000 }],
    conversation: [{ id: "conversation-1", title: null, revision: seq }],
    agent: [{ id: AGENT_ID, title: "Invites" }],
    workers: [],
    window: [],
    windowParts: [],
    queueRevision: [],
    launch: [],
  });
}

/** One message of the window as its rows deliver it: a line of the agent's at `seq`, saying `text` in one part. */
function windowRow(seq: number, text: string) {
  return {
    row: {
      id: `m-${seq}`,
      seq,
      clientId: `client-${seq}`,
      turnId: null,
      role: "assistant",
      partCount: 1,
      metadata: null,
      placedAt: NOW,
      finishedAt: null,
      sender: null,
      senderName: null,
      senderModel: null,
      memberId: null,
      memberName: null,
      agentId: null,
      agentTaskId: null,
      journalId: null,
      afterStep: null,
      askTurnId: null,
      askAfterStep: null,
      turnStartedAt: null,
      turnStatus: null,
      turnModel: null,
      turnEffort: null,
      turnUsage: null,
      turnFailure: null,
      turnFastRefused: null,
    },
    part: {
      messageId: `m-${seq}`,
      index: 0,
      part: { type: "text", text },
      cutField: null,
      bytes: null,
      head: null,
      tail: null,
    },
  };
}

/** A page the service answers read at once: its messages, its cursor, its status, and whether its held read would have held. */
function pageNow(
  cursor: string,
  options: { holds: boolean; text?: string; status?: AgentStatus },
): TranscriptNowAnswer {
  return {
    messages:
      options.text === undefined
        ? []
        : [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text: options.text }] }],
    cursor,
    status: options.status ?? AGENT_STATUS.RUNNING,
    title: "Invites",
    holds: options.holds,
  };
}

/** The newest page the service answers: one message, the cursor to follow on from, and where the older page is read below. */
function newestPage(cursor: string, text: string, before?: string): AgentNewestAnswer {
  return {
    messages: [{ id: `m-${cursor}`, role: "assistant", parts: [{ type: "text", text }] }],
    cursor,
    status: AGENT_STATUS.RUNNING,
    title: "Invites",
    ...(before === undefined ? undefined : { before }),
  };
}

it.effect(
  "a held transcript opens on its newest page, read once beside the live read and laid on the held transcripts, then follows on from its cursor once the live read's first rows land, missing nothing written between; a short page is caught up, and the next is read only as the statements move or at the edge the service names; letting it go stops the following",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        held,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      const newest = newestPage("1:0", "Reading the invites.", "40");
      pageNewest(newest);
      // A message written after the newest page was read, before the live read's first rows landed.
      const between = {
        ...pageNow("2:0", { holds: true, text: "Writing the expiry." }),
        wakeIn: 3_000,
      };
      script(between);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED), {});
      yield* settled;
      assert.deepEqual(held(), [
        {
          messages: newest.messages,
          before: "40",
          cursor: "1:0",
          word: { status: AGENT_STATUS.RUNNING, title: "Invites", caughtUp: false },
          pages: 1,
        },
      ]);
      assert.deepEqual(asked.toSorted(), [
        `messages-newest:${AGENT_ID}:cut`,
        `transcript-live:${AGENT_ID}`,
      ]);

      // The live read's first rows read on from the newest page's cursor, never from the start.
      transcriptRows(live, 2);
      yield* settled;
      assert.deepEqual(held()[1], {
        messages: [...newest.messages, ...between.messages],
        before: "40",
        cursor: "2:0",
        word: { status: AGENT_STATUS.RUNNING, title: "Invites", caughtUp: true },
        pages: 2,
      });
      const reads = asked.filter((ask) => ask.startsWith("messages-"));
      assert.deepEqual(reads, [`messages-newest:${AGENT_ID}:cut`, `messages-now:${AGENT_ID}:1:0`]);

      // Note that a short page is caught up, so nothing is read again until the clock reaches the edge the service named.
      yield* TestClock.adjust("2 seconds");
      yield* settled;
      assert.equal(held().length, 2);
      yield* TestClock.adjust("1 second");
      yield* settled;
      assert.equal(held().length, 3);
      assert.equal(asked.at(-1), `messages-now:${AGENT_ID}:2:0`);

      const moved = pageNow("3:0", { holds: false, text: "Testing the expiry." });
      script(moved);
      // A turn opening is what reads the page again; its messages come as rows (see the window's own test).
      transcriptRows(live, 3, 2);
      yield* settled;
      assert.deepEqual(ids(held().at(-1)), ["m-1:0", "m-2:0", "m-3:0"]);
      assert.equal(asked.filter((ask) => ask.startsWith("messages-newest")).length, 1);
      assert.ok(!asked.includes(`messages-now:${AGENT_ID}:${AGENT_CURSOR_START}`));

      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, FOLLOWED);
      const laidBefore = held().length;
      const askedBefore = asked.length;
      transcriptRows(live, 4, 3);
      yield* nextPoll;
      assert.equal(held().length, laidBefore, "a transcript let go moves no more");
      assert.equal(asked.length, askedBefore, "nor reads anything");
    }),
);

it.effect(
  "a held transcript's newest messages are laid as its window's rows draw them, each once and as caught up, beside what the last page said of the agent, with no page read again; a message whose parts are not all in waits for them",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        held,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites."));
      script(pageNow("1:0", { holds: true }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-")).length;
      const readBefore = reads();
      const laidBefore = held().length;

      const first = windowRow(2, "Writing the expiry.");
      const second = windowRow(3, "Testing the expiry.");
      // The second message's part has not landed yet, so only the first is drawn.
      live.transcript.set({ window: [first.row, second.row], windowParts: [first.part] });
      yield* nextPoll;
      live.transcript.set({ windowParts: [first.part, second.part] });
      yield* nextPoll;
      // Rows answered again alike lay nothing more.
      live.transcript.set({ window: [first.row, second.row] });
      yield* nextPoll;

      assert.deepEqual(
        held()
          .slice(laidBefore)
          .map((rows) => [rows?.messages.slice(1), rows?.word?.caughtUp]),
        [
          [[said(2, "Writing the expiry.")], true],
          [[said(2, "Writing the expiry."), said(3, "Testing the expiry.")], true],
        ],
      );
      assert.equal(reads(), readBefore);

      // A turn moving reads the page past the messages the rows laid.
      transcriptRows(live, 3, 2);
      yield* nextPoll;
      assert.equal(asked.at(-1), `messages-now:${AGENT_ID}:3:0`);
    }),
);

it.effect(
  "a line of the developer's that lands awaiting its turn after a stopped turn is laid with the agent at work, never under the stopped turn's word",
  () =>
    Effect.gen(function* () {
      const { call, held, sealTranscript, pageNow: script, pageNewest, live } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites.", "40"));
      script(
        pageNow("1:0", {
          holds: false,
          text: "Reading the invites.",
          status: AGENT_STATUS.CANCELED,
        }),
      );
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* nextPoll;

      // A queue's Resume hands on the member's line, which lands before any turn takes it.
      const line = windowRow(2, "Open the pull request.");
      live.transcript.set({
        window: [{ ...line.row, role: "user", turnStatus: null }],
        windowParts: [line.part],
      });
      yield* nextPoll;

      const laid = held().find((rows) => ids(rows)?.includes("m-2"));
      assert.ok(laid, "the line was laid");
      assert.equal(laid.word?.status, AGENT_STATUS.RUNNING);
    }),
);

it.effect(
  "a held transcript reads its page again when only the agent's queue moves, the page laid with the queue's revision it was read at, or when a line of the developer's lands awaiting its turn, whoever wrote it",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        held,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites.", "40"));
      script(pageNow("1:0", { holds: false, text: "Reading the invites." }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 1);
      yield* settled;
      const reads = () => asked.filter((ask) => ask.startsWith("messages-now")).length;

      // A message queued, edited, sent, or the queue paused: nothing but its revision moves.
      const beforeQueue = reads();
      live.transcript.set({ queueRevision: [{ revision: 1 }] });
      yield* nextPoll;
      assert.equal(reads(), beforeQueue + 1, "the queue moving reads the page");
      assert.equal(held().at(-1)?.word?.queueRevision, 1, "its queue is at least that new");

      // A queue's hand-off writes the member's line before its turn is opened; the page says the agent runs.
      const beforeLine = reads();
      const line = windowRow(2, "Open the pull request.");
      live.transcript.set({
        window: [{ ...line.row, role: "user", turnStatus: null }],
        windowParts: [line.part],
      });
      yield* nextPoll;
      assert.equal(reads(), beforeLine + 1, "a line awaiting its turn reads the page");
    }),
);

/** A queued message's id, as its window minted it. */
const QUEUED_ID = "4e2d6c8a-1f3b-4a5c-9d7e-8b0a2c4e6f13";

/** The agent's queue holding the one message, saying `text`, at `revision`. */
function queueOf(text: string, revision: number) {
  return { messages: [{ id: QUEUED_ID, text, queuedBy: "user-dana" }], revision };
}

/** The words of the queued messages the held transcript last laid. */
function queuedTexts(held: () => readonly (AppTranscript | undefined)[]) {
  return held()
    .at(-1)
    ?.word?.queue?.messages.map((message) => message.text);
}

/** An edit of the queued message, as the window asks it. */
const EDITED = {
  agentId: AGENT_ID,
  change: { change: QUEUE_CHANGE.EDIT, messageId: QUEUED_ID, text: "Run the tests and fix them" },
};

/** A held transcript whose newest page and first page past it carry the queue holding "Run the tests" at its first revision. */
function queueFollowed() {
  return Effect.gen(function* () {
    const harness = yield* subject();
    harness.sealTranscript(LIVE_ANSWERED);
    harness.pageNewest({
      ...newestPage("1:0", "Reading the invites."),
      queue: queueOf("Run the tests", 1),
    });
    harness.pageNow({ ...pageNow("1:0", { holds: false }), queue: queueOf("Run the tests", 1) });
    yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
    yield* settled;
    transcriptRows(harness.live, 1);
    yield* settled;
    assert.deepEqual(queuedTexts(harness.held), ["Run the tests"]);
    return harness;
  });
}

it.effect(
  "an edit of a queued message is drawn in the agent's transcript before the service answers it, and taken back where the service refused it",
  () =>
    Effect.gen(function* () {
      const { acts, held, answerQueue } = yield* queueFollowed();
      const answered = yield* Deferred.make<void>();
      answerQueue({ failure: AGENT_CALL_FAILURE.NOT_FOUND }, Deferred.await(answered));

      const edit = yield* Effect.forkChild(acts.AGENTS_QUEUE(EDITED));
      yield* settled;
      assert.deepEqual(queuedTexts(held), ["Run the tests and fix them"]);

      yield* Deferred.succeed(answered, undefined);
      assert.deepEqual(yield* Fiber.join(edit), { failure: AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(queuedTexts(held), ["Run the tests"]);
    }),
);

it.effect(
  "an edit the service answered stands until a page carries its queue, so a page read before it lands without putting the old words back",
  () =>
    Effect.gen(function* () {
      const { acts, held, answerQueue, pageNow: script, live } = yield* queueFollowed();
      answerQueue({ queue: queueOf("Run the tests and fix them", 2) });
      yield* acts.AGENTS_QUEUE(EDITED);
      assert.deepEqual(queuedTexts(held), ["Run the tests and fix them"]);

      // A page read before the edit landed answers after it.
      script({ ...pageNow("1:0", { holds: false }), queue: queueOf("Run the tests", 1) });
      live.transcript.set({ queueRevision: [{ revision: 1 }] });
      yield* nextPoll;
      assert.deepEqual(queuedTexts(held), ["Run the tests and fix them"]);

      // A page carrying a later change of the queue is drawn as it says.
      script({
        ...pageNow("1:0", { holds: false }),
        queue: queueOf("Run the tests, then open the pull request", 3),
      });
      live.transcript.set({ queueRevision: [{ revision: 3 }] });
      yield* nextPoll;
      assert.deepEqual(queuedTexts(held), ["Run the tests, then open the pull request"]);
    }),
);

/**
 * A follow whose rows draw `m-2` as "Writing the expiry." at the
 * conversation's revision 2 while a moved turn's page is read, the page
 * answering `pageText` for it at the cursor named: every transcript laid
 * from the moment the turn moved, once the page and a delivery of the rows
 * after it landed.
 */
function laidBesideRead(pageCursor: string, pageText: string) {
  return Effect.gen(function* () {
    const {
      call,
      held,
      sealTranscript,
      pageNow: script,
      holdPages,
      pageNewest,
      live,
    } = yield* subject();
    sealTranscript(LIVE_ANSWERED);
    pageNewest(newestPage("1:0", "Reading the invites."));
    script(pageNow("1:0", { holds: true }));
    yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
    yield* settled;
    transcriptRows(live, 1);
    yield* settled;
    const laidBefore = held().length;

    const answer = yield* Deferred.make<void>();
    holdPages(Deferred.await(answer));
    const read: TranscriptNowAnswer = {
      ...pageNow(pageCursor, { holds: false }),
      messages: [said(2, pageText), said(3, "Testing the expiry.")],
    };
    script(read);
    // A turn opening reads the page, which the service is slow to answer.
    transcriptRows(live, 2, 2);
    yield* nextPoll;
    const drawn = windowRow(2, "Writing the expiry.");
    live.transcript.set({ window: [drawn.row], windowParts: [drawn.part] });
    yield* nextPoll;
    const beside = held().slice(laidBefore);

    yield* Deferred.succeed(answer, undefined);
    yield* settled;
    // The rows answer again as they stood, which lays nothing older than the page.
    live.transcript.set({ windowParts: [drawn.part] });
    yield* nextPoll;
    return { beside, after: held().slice(laidBefore + beside.length) };
  });
}

/** One of the agent's messages, at `seq`, saying `text` in one part. */
function said(seq: number, text: string) {
  return { id: `m-${seq}`, role: "assistant" as const, parts: [{ type: "text", text }] };
}

/** The ids of the messages a held transcript holds, in order. */
function ids(rows: AppTranscript | undefined): readonly string[] | undefined {
  return rows?.messages.map((message) => message.id);
}

it.effect(
  "a message the window's rows draw while a moved turn's page is read is laid at once, and the page's older copy of it is left out where the page read it at an older revision",
  () =>
    Effect.gen(function* () {
      const { beside, after } = yield* laidBesideRead("3:0", "Writ");

      assert.deepEqual(
        beside.map((rows) => rows?.messages.slice(1)),
        [[said(2, "Writing the expiry.")]],
      );
      assert.deepEqual(
        after.map((rows) => rows?.messages.slice(1)),
        [[said(2, "Writing the expiry."), said(3, "Testing the expiry.")]],
      );
    }),
);

it.effect(
  "a page read at the rows' revision or later lays its newer copy of a message the rows drew beside it, and the rows never draw the older one back over it",
  () =>
    Effect.gen(function* () {
      const newer = "Writing the expiry, then testing it.";
      const { after } = yield* laidBesideRead("3:5", newer);

      assert.deepEqual(
        after.map((rows) => rows?.messages.slice(1)),
        [[said(2, newer), said(3, "Testing the expiry.")]],
      );
    }),
);

it.effect(
  "a full page is followed by the next at once, and the short one after it is caught up",
  () =>
    Effect.gen(function* () {
      const { call, asked, held, sealTranscript, pageNow: script, live } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      const full: TranscriptNowAnswer = {
        ...pageNow("2:0", { holds: false }),
        messages: Array.from({ length: AGENT_BOUNDS.MESSAGES_PAGE }, (_, index) => ({
          id: `m-full-${index}`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: `Step ${index}` }],
        })),
      };
      const rest = pageNow("3:0", { holds: true, text: "Done." });
      script(full, rest);
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 2);
      yield* settled;
      const laid = held().map((rows) => rows?.word?.caughtUp);
      assert.deepEqual(laid.slice(0, 3), [false, false, true]);
      assert.deepEqual(asked.filter((ask) => ask.startsWith("messages-now")).slice(0, 2), [
        `messages-now:${AGENT_ID}:1:0`,
        `messages-now:${AGENT_ID}:2:0`,
      ]);
    }),
);

it.effect(
  "a live read that gets no answer is asked again past the bound on a backoff, and the transcript reads on the moment the service answers again",
  () =>
    Effect.gen(function* () {
      const reach = yield* SubscriptionRef.make({ reachable: false, answeredAt: 0 });
      yield* Effect.gen(function* () {
        const { call, asked, held, sealTranscript, live } = yield* subject();
        const seals = () => asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length;
        sealTranscript(OFFLINE);
        yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
        yield* settled;
        yield* TestClock.adjust("2 minutes");
        yield* settled;
        // Note that the waits double from two seconds, asking at 0, 2, 6, 14, 30, and 62 seconds: past the bound of refusals, and nowhere near once a second.
        assert.equal(seals(), 6);
        assert.deepEqual(
          held().at(-1)?.failure,
          OFFLINE,
          "the read said it got no answer, never that it gave up",
        );

        // Note that the read never gave up, so the service answering again asks at once, a minute short of its wait.
        sealTranscript(LIVE_ANSWERED);
        yield* SubscriptionRef.set(reach, { reachable: true, answeredAt: 1 });
        yield* settled;
        assert.equal(seals(), 7);
        transcriptRows(live, 2);
        yield* settled;
        assert.equal(held().at(-1)?.failure, undefined, "the failure is let go once it reads");
        assert.ok(
          asked.includes(`messages-now:${AGENT_ID}:1:0`),
          "the page past the newest is read once the live read stands",
        );
      }).pipe(Effect.provideService(ServiceReach, reach));
    }),
);

it.effect(
  "a live read the service does not answer leaves the newest page laid, is asked again a bounded number of times, then lays that the transcript could not be read beside it; Try again reads on from what is held",
  () =>
    Effect.gen(function* () {
      const { call, asked, held, sealTranscript } = yield* subject();
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(ids(held().at(-1)), ["m-1"]);
      assert.equal(held().at(-1)?.cursor, "1:0");

      yield* TestClock.adjust("1 minute");
      yield* settled;
      const seals = asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length;
      assert.ok(seals > 1 && seals < 60, `read ${seals} times`);
      assert.deepEqual(held().at(-1)?.failure, {
        failure: AGENT_CALL_FAILURE.UNANSWERED,
        cause: { _tag: FAILURE_FACT.SEAL_UNANSWERED, code: AGENT_CALL_FAILURE.UNANSWERED },
      });
      assert.deepEqual(ids(held().at(-1)), ["m-1"], "the messages held stand");
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.equal(asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length, seals);

      sealTranscript(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_RETRY, FOLLOWED);
      yield* settled;
      assert.equal(asked.filter((ask) => ask === `transcript-live:${AGENT_ID}`).length, seals + 1);
      assert.equal(held().at(-1)?.failure, undefined, "reading again lets the failure go");
      // Note that the newest page laid before stands, so reading again opens on it rather than reading it anew.
      assert.equal(asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length, 1);
    }),
);

it.effect(
  "a newest page the service keeps not answering is asked for a bounded number of times, then the follow ends on the failure laid",
  () =>
    Effect.gen(function* () {
      const { call, asked, held, sealTranscript, pageNewest } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest({ failure: AGENT_CALL_FAILURE.UNANSWERED });
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* TestClock.adjust("1 minute");
      yield* settled;
      const newest = () => asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length;
      const read = newest();
      assert.ok(read > 1 && read < 60, `read the newest page ${read} times`);
      assert.deepEqual(held().at(-1), {
        messages: [],
        pages: 0,
        failure: { failure: AGENT_CALL_FAILURE.UNANSWERED },
      });
      yield* TestClock.adjust("1 minute");
      yield* settled;
      assert.equal(newest(), read);
      assert.ok(!asked.some((ask) => ask.startsWith("messages-now")));
    }),
);

it.effect(
  "a page read at another rewind than the one held has the follow read the newest page afresh and lay it in place of what was held, though it meets it, so the messages the rewind dropped go",
  () =>
    Effect.gen(function* () {
      const {
        call,
        asked,
        held,
        sealTranscript,
        pageNow: script,
        pageNewest,
        live,
      } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest({
        ...newestPage("2:0", "Writing the expiry."),
        messages: [said(1, "Reading the invites."), said(2, "Writing the expiry.")],
      });
      script(pageNow("2:0", { holds: true }));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      transcriptRows(live, 2);
      yield* settled;
      assert.deepEqual(ids(held().at(-1)), ["m-1", "m-2"]);

      // The agent is taken back to before its second line: every page says so from now on.
      const rewound = {
        ...newestPage("3:1", "Reading the invites."),
        messages: [said(1, "Reading the invites.")],
        rewound: 1,
      };
      pageNewest(rewound);
      script({ ...pageNow("3:1", { holds: true }), rewound: 1 });
      transcriptRows(live, 3, 2);
      yield* nextPoll;

      assert.deepEqual(ids(held().at(-1)), ["m-1"]);
      assert.equal(held().at(-1)?.word?.rewound, 1);
      assert.equal(asked.filter((ask) => ask.startsWith("messages-newest")).length, 2);
    }),
);

it.effect(
  "an older page read below the place the window names is laid before the messages held and answers that it landed; one asked below a place they no longer begin at, as once a newer page took their place, is dropped, and a worker's is read under its call",
  () =>
    Effect.gen(function* () {
      const { call, acts, asked, held, sealTranscript, pageNewest } = yield* subject();
      sealTranscript(LIVE_ANSWERED);
      pageNewest(newestPage("1:0", "Reading the invites.", "40"));
      yield* call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(held().at(-1)?.before, "40");

      assert.deepEqual(yield* acts.AGENTS_TRANSCRIPT_OLDER({ ...FOLLOWED, before: "40" }), {
        landed: true,
      });
      assert.deepEqual(ids(held().at(-1)), ["m-1", "m-1:0"]);
      assert.equal(held().at(-1)?.before, "3");

      // The messages held begin below "40" now, so a page read for it would leave a gap or repeat itself.
      const laid = held().length;
      assert.deepEqual(yield* acts.AGENTS_TRANSCRIPT_OLDER({ ...FOLLOWED, before: "40" }), {
        landed: false,
      });
      assert.equal(held().length, laid);

      assert.deepEqual(
        yield* acts.AGENTS_TRANSCRIPT_OLDER({
          ...FOLLOWED,
          callId: "call-7",
          before: "40",
        }),
        { landed: false },
      );
      assert.deepEqual(
        asked.filter((ask) => ask.includes("-before:")),
        [
          `messages-before:${AGENT_ID}:40:cut`,
          `messages-before:${AGENT_ID}:40:cut`,
          `worker-before:${AGENT_ID}:call-7:40:cut`,
        ],
      );
    }),
);

it.effect(
  "a held transcript the account does not reach is laid not found once; behind a closed gate nothing is read; and a sign-out lets every held transcript go",
  () =>
    Effect.gen(function* () {
      const worker = { ...FOLLOWED, callId: "call-7" };
      const refused = yield* subject();
      refused.sealTranscript({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, worker);
      yield* settled;
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(refused.held(worker), [
        { messages: [], pages: 0, failure: { failure: AGENT_CALL_FAILURE.NOT_FOUND } },
      ]);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.deepEqual(signedOut.held(), []);
      assert.deepEqual(signedOut.asked, []);

      const followed = yield* subject();
      followed.sealTranscript(LIVE_ANSWERED);
      followed.pageNow(pageNow("1:0", { holds: true }));
      yield* followed.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(followed.live.transcript.held(), 1, "its poll is held while nothing moves");
      yield* followed.reset;
      yield* settled;
      assert.equal(followed.live.transcript.held(), 0, "a sign-out lets its poll go");
      assert.equal(followed.held().at(-1), undefined, "and what was held of it");
    }),
);

/** A held transcript opened on its newest page and caught up past it, then let go, as a window that showed it last left it. */
function followedOnce(
  harness: Effect.Success<ReturnType<typeof subject>>,
  transcript: { readonly kind: "agent"; readonly agentId: string } = FOLLOWED,
) {
  return Effect.gen(function* () {
    harness.sealTranscript(LIVE_ANSWERED);
    harness.pageNewest(newestPage("1:0", "Reading the invites.", "40"));
    harness.pageNow(pageNow("2:0", { holds: false, text: "Writing the expiry." }));
    yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, transcript);
    yield* settled;
    transcriptRows(harness.live, 2);
    yield* settled;
    yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_UNFOLLOW, transcript);
  });
}

it.effect(
  "a transcript held again stands as the host held it before the service is asked anything, then is read on once from its cursor, so a message written while away arrives",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      yield* followedOnce(harness);
      const { asked, transcripts, live } = harness;
      assert.deepEqual(ids(harness.held().at(-1)), ["m-1:0", "m-2:0"], "let go, it stays held");

      // Written while no window held it.
      const away = pageNow("3:0", { holds: false, text: "Written while away." });
      harness.pageNow(away);
      yield* TestClock.adjust("5 seconds");
      transcriptRows(live, 3);
      yield* settled;
      assert.deepEqual(ids(harness.held().at(-1)), ["m-1:0", "m-2:0"], "nor moves while let go");

      const laidBefore = transcripts().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      const laid = transcripts().slice(laidBefore);
      assert.equal(laid[0]?.asked, askedBefore, "what was held stands before any read");
      assert.equal(laid[0]?.rows?.word?.caughtUp, false, "not caught up until read on");
      assert.deepEqual(ids(laid.at(-1)?.rows), ["m-1:0", "m-2:0", "m-3:0"]);
      assert.deepEqual(asked.slice(askedBefore), [`messages-now:${AGENT_ID}:2:0`]);
    }),
);

it.effect(
  "a held message rewritten while away arrives on the read past the held cursor, laid in place",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      yield* followedOnce(harness);
      const { held, live } = harness;
      // The service answers a message older than the cursor again once its revision passed it.
      const rewrite = {
        ...pageNow("2:1", { holds: false }),
        messages: [
          {
            id: "m-1:0",
            role: "assistant" as const,
            parts: [{ type: "text" as const, text: "Read them all." }],
          },
        ],
      };
      harness.pageNow(rewrite);
      transcriptRows(live, 2);
      yield* settled;

      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(held().at(-1)?.cursor, "2:1");
      assert.deepEqual(held().at(-1)?.messages, [
        rewrite.messages[0],
        { id: "m-2:0", role: "assistant", parts: [{ type: "text", text: "Writing the expiry." }] },
      ]);
    }),
);

it.effect(
  "a held cursor the service refuses is let go for the newest page, as a follow holding nothing opens, and the refusal is never laid",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      yield* followedOnce(harness);
      const { asked, held } = harness;
      const fresh = newestPage("5:0", "Read afresh.", "41");
      harness.pageNewest(fresh);
      harness.pageNow({ failure: AGENT_CALL_FAILURE.UNANSWERED }, pageNow("6:0", { holds: false }));

      const laidBefore = held().length;
      const askedBefore = asked.length;
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      const laid = held().slice(laidBefore);
      assert.ok(
        laid.every((rows) => rows?.failure === undefined),
        "the refusal is never laid",
      );
      assert.deepEqual(
        ids(laid.at(-1)),
        ["m-5:0"],
        "the newest page takes the place of what was held",
      );
      assert.equal(laid.at(-1)?.before, "41");
      assert.deepEqual(asked.slice(askedBefore), [
        `messages-now:${AGENT_ID}:2:0`,
        `messages-newest:${AGENT_ID}:cut`,
        `messages-now:${AGENT_ID}:5:0`,
      ]);
    }),
);

it.effect(
  "a transcript held again while the service answers no read at all stays followed, and reads on the moment the service is back",
  () =>
    Effect.gen(function* () {
      const reach = yield* SubscriptionRef.make({ reachable: false, answeredAt: 0 });
      yield* Effect.gen(function* () {
        const harness = yield* subject();
        yield* followedOnce(harness);
        const { held } = harness;
        harness.pageNow({ failure: AGENT_CALL_FAILURE.UNANSWERED });
        harness.pageNewest({ failure: AGENT_CALL_FAILURE.UNANSWERED });
        yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
        yield* settled;
        yield* TestClock.adjust("40 seconds");
        yield* settled;

        const back = pageNow("3:0", { holds: false, text: "Back again." });
        harness.pageNow(back);
        harness.pageNewest(newestPage("3:0", "Back again.", "40"));
        yield* SubscriptionRef.set(reach, { reachable: true, answeredAt: 1 });
        yield* settled;
        assert.equal(held().at(-1)?.failure, undefined);
        assert.ok(JSON.stringify(held().at(-1)?.messages).includes("Back again."));
      }).pipe(Effect.provideService(ServiceReach, reach));
    }),
);

it.effect(
  "a sign-out lets go of every transcript held, and an archive of the agent's let go lately, so the next hold reads the newest page; one a window holds stays drawn",
  () =>
    Effect.gen(function* () {
      const newestReads = (asked: readonly string[]) =>
        asked.filter((ask) => ask === `messages-newest:${AGENT_ID}:cut`).length;

      const signedOut = yield* subject();
      yield* followedOnce(signedOut);
      yield* signedOut.reset;
      assert.equal(signedOut.held().at(-1), undefined);
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(signedOut.asked), 2);

      const archived = yield* subject();
      yield* followedOnce(archived);
      yield* archived.acts.AGENTS_ARCHIVE({ agentId: AGENT_ID, archived: true });
      assert.equal(archived.held().at(-1), undefined);
      yield* archived.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      assert.equal(newestReads(archived.asked), 2);

      const shown = yield* subject();
      yield* followedOnce(shown);
      yield* shown.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, FOLLOWED);
      yield* settled;
      yield* shown.acts.AGENTS_ARCHIVE({ agentId: AGENT_ID, archived: true });
      assert.deepEqual(ids(shown.held().at(-1)), ["m-1:0", "m-2:0"]);
    }),
);

it.effect(
  "an agent's picture read once is answered again without asking the service, until a switch of account, a sign-out, or the agent archived or deleted lets it go",
  () =>
    Effect.gen(function* () {
      const picture = { agentId: AGENT_ID, pictureId: PICTURE_ID };
      const pictureReads = (asked: readonly string[]) =>
        asked.filter((ask) => ask === `picture:${AGENT_ID}:${PICTURE_ID}:`).length;

      const kept = yield* subject();
      const first = yield* kept.acts.AGENTS_PICTURE(picture);
      const again = yield* kept.acts.AGENTS_PICTURE(picture);
      assert.deepEqual(again, first);
      assert.equal(pictureReads(kept.asked), 1);

      let account = "user-dana";
      const switched = yield* subject({ accountId: () => account });
      yield* switched.acts.AGENTS_PICTURE(picture);
      account = "user-eli";
      yield* switched.acts.AGENTS_PICTURE(picture);
      assert.equal(pictureReads(switched.asked), 2);

      type Harness = Effect.Success<ReturnType<typeof subject>>;
      const lettingGo = [
        (harness: Harness) => harness.reset,
        (harness: Harness) => harness.acts.AGENTS_ARCHIVE({ agentId: AGENT_ID, archived: true }),
        (harness: Harness) => harness.acts.AGENTS_DELETE({ agentId: AGENT_ID }),
      ];
      for (const letGo of lettingGo) {
        const harness = yield* subject();
        yield* harness.acts.AGENTS_PICTURE(picture);
        yield* letGo(harness);
        yield* harness.acts.AGENTS_PICTURE(picture);
        assert.equal(pictureReads(harness.asked), 2);
      }
    }),
);

it.effect(
  "a transcript let go past the bound is closed, the least recently let go first, and one a window holds never is",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      // One a window holds throughout, its tab shown.
      const shown = { kind: TRANSCRIPT_KIND.AGENT, agentId: "agent-shown" };
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, shown);
      yield* settled;
      const transcripts = Array.from({ length: HELD_TRANSCRIPTS + 1 }, (_, index) => ({
        kind: TRANSCRIPT_KIND.AGENT,
        agentId: `agent-${index}`,
      }));
      for (const transcript of transcripts) yield* followedOnce(harness, transcript);
      const newestReads = (agentId: string) =>
        harness.asked.filter((ask) => ask === `messages-newest:${agentId}:cut`).length;

      const first = transcripts[0] ?? FOLLOWED;
      const last = transcripts.at(-1) ?? FOLLOWED;
      assert.equal(harness.held(first).at(-1), undefined, "the least recently let go is closed");
      assert.notEqual(harness.held(last).at(-1), undefined);
      assert.notEqual(harness.held(shown).at(-1), undefined, "one a window holds stays drawn");

      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, last);
      yield* settled;
      assert.equal(newestReads(last.agentId), 1);
      yield* harness.call(GATEWAY_METHOD.AGENTS_TRANSCRIPT_FOLLOW, first);
      yield* settled;
      assert.equal(newestReads(first.agentId), 2);
    }),
);

/** That item as a reader who has read it reads it live. */
const LIVE_ITEM: InboxItem = { ...ITEM, unread: false };

/** That item as its row delivers it, what it leaves out held as null. */
const ITEM_ROW = {
  ...LIVE_ITEM,
  startedBy: "user-dana",
  startedByName: null,
  answeredBy: null,
  answeredByName: null,
  closedReason: null,
  closedBy: null,
  closedByName: null,
  openAskMessageId: null,
  settledAt: null,
};

const PLAN_SCOPE = { kind: "plan", id: TASK_ID } as const;

/** Steps taken until the host has told `times` inboxes, since a row's digest is the platform's own promise. */
const toldTimes = (told: () => readonly unknown[], times: number) =>
  Effect.repeat(Effect.yieldNow, { until: () => told().length >= times, times: 10_000 });
const AGENT_SCOPE = { kind: "agent", id: AGENT_ID } as const;

/** One scope's read as the host last told the held inboxes, as a wire value; none where it holds none of the scope. */
function heldOf(
  told: () => readonly WireValue[],
  scope: { readonly kind: string; readonly id: string },
): WireValue | undefined {
  const last = told().at(-1);
  const ofKind = isRecord(last) ? last[scope.kind] : undefined;
  return isRecord(ofKind) ? ofKind[scope.id] : undefined;
}

it.effect(
  "a held plan's inbox is told on the held inboxes from its live read once its rows land, again each time they move and never when an answer moved nothing; let go, it stays told among the holders let go lately",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, live, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE), {});
      yield* settled;
      assert.deepEqual(told(), []);

      live.scope.set({ messages: [], files: [], items: [ITEM_ROW] });
      yield* toldTimes(told, 1);
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      const closed = {
        ...ITEM_ROW,
        revision: 3,
        status: INBOX_STATUS.CLOSED,
        closedReason: "Done",
      };
      live.scope.set({ items: [closed] });
      yield* nextPoll;
      yield* toldTimes(told, 2);
      assert.deepEqual(
        told().map((held) => heldOf(() => [held], PLAN_SCOPE)),
        [
          { rows: [LIVE_ITEM] },
          {
            rows: [
              { ...LIVE_ITEM, revision: 3, status: INBOX_STATUS.CLOSED, closedReason: "Done" },
            ],
          },
        ],
      );
      assert.deepEqual(asked, [`description-inbox-live:${TASK_ID}`]);

      // Let go, the plan stays held among those let go lately, so a change still tells it.
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      yield* toldTimes(told, 3);
      assert.deepEqual(heldOf(told, PLAN_SCOPE), { rows: [LIVE_ITEM] });
    }),
);

it.effect(
  "a holder let go and held again draws from where its read stands, nothing read from cold, until later holders let go push it out, when it is read anew",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, live, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ messages: [], files: [], items: [ITEM_ROW] });
      yield* toldTimes(told, 1);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, PLAN_SCOPE);
      yield* settled;

      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.deepEqual(asked, [`description-inbox-live:${TASK_ID}`], "nothing is read from cold");
      assert.deepEqual(heldOf(told, PLAN_SCOPE), { rows: [LIVE_ITEM] });
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, PLAN_SCOPE);
      yield* settled;

      // Eight other holders held and let go push the plan out, and its read is let go with its rows.
      const others = Array.from({ length: 8 }, (_, at) => ({
        kind: "agent",
        id: `0000000${at}-1111-4a6b-9c33-0d1e2f3a4b5c`,
      }));
      for (const scope of others) {
        yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, scope);
        yield* settled;
        yield* call(GATEWAY_METHOD.AGENTS_INBOX_UNFOLLOW, scope);
        yield* settled;
      }
      assert.equal(heldOf(told, PLAN_SCOPE), undefined, "the plan is told no more");
      assert.equal(
        asked.filter((read) => read === `description-inbox-live:${TASK_ID}`).length,
        1,
        "letting it go reads nothing",
      );

      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.equal(
        asked.filter((read) => read === `description-inbox-live:${TASK_ID}`).length,
        2,
        "held again past the bound, it is read anew",
      );
    }),
);

it.effect(
  "a message landing after its item's row is told as soon as it lands, its item's thread whole",
  () =>
    Effect.gen(function* () {
      const { call, sealScope, live, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ messages: [], files: [], items: [ITEM_ROW] });
      yield* toldTimes(told, 1);
      const message = {
        id: "6f1d2a10-7b0f-4e3b-9a55-5e3b2c1d4c7a",
        itemId: ITEM.id,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        userId: null,
        name: null,
        text: "Also the staging branch?",
        ask: null,
        answers: null,
        createdAt: ITEM.updatedAt,
      };
      live.scope.set({ messages: [message] });
      yield* nextPoll;
      yield* toldTimes(told, 2);
      assert.equal(told().length, 2);
      assert.ok(JSON.stringify(heldOf(told, PLAN_SCOPE)).includes("Also the staging branch?"));
    }),
);

it.effect(
  "an agent's inbox the account does not reach is told failed, as is one the service answers nothing for, Try again reads it anew telling nothing meanwhile, and behind a closed gate a hold reads nothing until the gate opens",
  () =>
    Effect.gen(function* () {
      const refused = yield* subject();
      refused.sealScope({ failure: AGENT_CALL_FAILURE.NOT_FOUND });
      yield* refused.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(heldOf(refused.told, AGENT_SCOPE), { failed: true });

      const unsealed = yield* subject();
      yield* unsealed.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(heldOf(unsealed.told, AGENT_SCOPE), { failed: true });
      assert.deepEqual(unsealed.asked, [`agent-inbox-live:${AGENT_ID}`]);
      unsealed.sealScope(LIVE_ANSWERED);
      yield* unsealed.call(GATEWAY_METHOD.AGENTS_INBOX_RETRY, AGENT_SCOPE);
      yield* settled;
      assert.deepEqual(heldOf(unsealed.told, AGENT_SCOPE), {});
      assert.deepEqual(unsealed.asked, [
        `agent-inbox-live:${AGENT_ID}`,
        `agent-inbox-live:${AGENT_ID}`,
      ]);

      const signedOut = yield* subject({ signedIn: false });
      yield* signedOut.call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.deepEqual(signedOut.told(), []);
      assert.deepEqual(signedOut.asked, []);
    }),
);

it.effect(
  "an agent's origin is read once however many holds stand on it, held again after a let go reads nothing, and a sign-out tells none held",
  () =>
    Effect.gen(function* () {
      const { acts, asked, live, origins, reset } = yield* subject();
      const agent = { agentId: AGENT_ID };
      const first = yield* Scope.make();
      const second = yield* Scope.make();
      live.origin.set({
        origin: [
          {
            origin: { firing: { kind: "webhook", bytes: 11 }, prompt: "Triage it.", body: "{}" },
            runnerName: null,
          },
        ],
      });
      yield* acts.AGENTS_ORIGIN_FOLLOW.hold(agent).pipe(Scope.provide(first));
      yield* acts.AGENTS_ORIGIN_FOLLOW.hold(agent).pipe(Scope.provide(second));
      yield* settled;
      assert.deepEqual(origins().at(-1), {
        [AGENT_ID]: { rows: { prompt: "Triage it.", body: "{}" } },
      });

      yield* Scope.close(first, Exit.void);
      yield* Scope.close(second, Exit.void);
      yield* settled;
      yield* acts.AGENTS_ORIGIN_FOLLOW.hold(agent);
      yield* settled;
      assert.deepEqual(asked, [`agent-origin-live:${AGENT_ID}`]);

      yield* reset;
      yield* settled;
      assert.deepEqual(origins().at(-1), {});
    }),
);

it.effect(
  "a sign-out lets every held inbox go and tells none held, and the gate opening again reads what the windows still hold",
  () =>
    Effect.gen(function* () {
      const { call, asked, sealScope, live, told, reset, open } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      assert.equal(live.scope.held(), 1, "its poll is held while nothing moves");
      yield* reset;
      yield* settled;
      assert.equal(live.scope.held(), 0, "a sign-out lets its poll go");
      assert.deepEqual(told().at(-1), { plan: {}, agent: {} });

      yield* open;
      yield* settled;
      assert.equal(live.scope.held(), 1, "the window's hold reads again");
      assert.equal(asked.filter((read) => read === `description-inbox-live:${TASK_ID}`).length, 2);
    }),
);

/** A run of the account's own automation that failed a second short of a week before now. */
const FAILED_RUN = {
  id: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  automationId: "8d2e3f4a-5b6c-4d7e-9f8a-0b1c2d3e4f5a",
  automationName: "Nightly flaky-test sweep",
  workspaceId: WORKSPACE_ID,
  reason: null,
  failedAt: NOW - FAILED_RUN_WINDOW_MILLIS + 1_000,
};

/** Every part of the account's read delivered, the item and run given and nothing else. */
function deliverAccount(
  live: { readonly account: PolledLive<(typeof ACCOUNT_PARTS)[number]> },
  rows: { readonly items?: readonly unknown[]; readonly failedRuns?: readonly unknown[] },
) {
  live.account.set({
    items: rows.items ?? [],
    planless: [],
    plans: [],
    automations: [],
    failedRuns: rows.failedRuns ?? [],
  });
}

it.effect(
  "what waits across the account is told from its live read each time it moves, whole, and a failed run aging out of the week tells it again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const { call, asked, sealAccount, live, accountInboxes } = yield* subject();
      sealAccount(LIVE_ANSWERED);

      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      deliverAccount(live, { items: [WAITING], failedRuns: [FAILED_RUN] });
      yield* settled;
      const [answered] = accountInboxes();
      assert.ok(isRecord(answered) && typeof answered.cursor === "string");
      assert.deepEqual(
        { ...answered, cursor: "" },
        {
          items: [WAITING],
          plans: [],
          planless: [],
          automations: [],
          failedRuns: [FAILED_RUN],
          cursor: "",
          readAt: NOW,
        },
      );
      deliverAccount(live, {
        items: [{ ...WAITING, revision: 3, updatedAt: NOW }],
        failedRuns: [FAILED_RUN],
      });
      yield* nextPoll;
      const moved = accountInboxes().at(-1);
      assert.ok(isRecord(moved) && typeof moved.cursor === "string");
      assert.notEqual(moved.cursor, answered.cursor);
      assert.deepEqual(moved.items, [{ ...WAITING, revision: 3, updatedAt: NOW }]);

      // No row moves as the run ages out of the week, and it is told all the same.
      yield* TestClock.adjust("2 seconds");
      yield* settled;
      const aged = accountInboxes().at(-1);
      assert.ok(isRecord(aged));
      assert.deepEqual(aged.failedRuns, []);
      assert.notEqual(aged.cursor, moved.cursor);
      assert.deepEqual(asked, ["account-inbox-live:user-dana"]);

      // Let go, nothing more is told.
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW);
      const told = accountInboxes().length;
      deliverAccount(live, { items: [] });
      yield* nextPoll;
      assert.equal(accountInboxes().length, told);
    }),
);

it.effect(
  "the account inbox is told unanswered with nobody signed in, and a session the service signs out is read again after a rest, telling nothing meanwhile",
  () =>
    Effect.gen(function* () {
      const nobody = yield* subject({ accountId: () => undefined });
      nobody.sealAccount(LIVE_ANSWERED);
      yield* nobody.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(nobody.accountInboxes(), [GATE_CLOSED_SIGNED_OUT]);
      assert.deepEqual(nobody.asked, []);

      const { call, asked, sealAccount, accountInboxes } = yield* subject();
      sealAccount(LIVE_SIGNED_OUT);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana"]);
      yield* TestClock.adjust("5 seconds");
      yield* settled;
      assert.deepEqual(asked, ["account-inbox-live:user-dana", "account-inbox-live:user-dana"]);
      assert.deepEqual(accountInboxes(), []);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW);
    }),
);

/** The item as the account's items read sends it. */
const HELD_ITEM: InboxItem = LIVE_ITEM;

/** A second task of the account's, and an item on it changed a minute before the first. */
const OTHER_TASK_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const OTHER_ITEM: InboxItem = {
  ...HELD_ITEM,
  id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  key: "deploy",
  title: "Deploy to staging?",
  updatedAt: ITEM.updatedAt - 60_000,
};

/** Where an item on `planId` stands as its stamp carries it, waiting on Dana with nothing on its thread, unless `moved` says otherwise. */
function stampOf(item: InboxItem, planId: string, moved: Record<string, unknown> = {}) {
  return {
    id: item.id,
    planId,
    agentId: item.agentId,
    revision: item.revision,
    version: item.version,
    status: item.status,
    updatedAt: item.updatedAt,
    unread: item.unread ?? false,
    waitsOn: "user-dana",
    messages: 0,
    ...moved,
  };
}

/** The account's items' read moved to the stamps given, the items given its rows, each as `row` writes it. */
function deliverItems(
  live: { readonly items: PolledLive<(typeof ITEMS_PARTS)[number]> },
  stamps: readonly unknown[],
  items: readonly (InboxItem | Record<string, unknown>)[],
) {
  live.items.set({
    stamps,
    items: items.map((item) => ({ ...ITEM_ROW, ...item })),
    messages: [],
    files: [],
  });
}

/** The account's items as the window is told them, by plan, none of an agent with no task. */
function byPlan(plans: Readonly<Record<string, readonly InboxItem[]>>) {
  return { rows: { [INBOX_SCOPE_KIND.PLAN]: plans, [INBOX_SCOPE_KIND.AGENT]: {} } };
}

it.effect(
  "the account's items are told whole by plan once the gate opens and their rows land, and again as an item moves, each plan it did not move on told as the very list told before",
  () =>
    Effect.gen(function* () {
      const { open, sealItems, live, accountItems } = yield* subject();
      sealItems(LIVE_ANSWERED);
      yield* open;
      yield* settled;
      const both = [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)];
      deliverItems(live, both, [HELD_ITEM, OTHER_ITEM]);
      yield* toldTimes(accountItems, 1);

      const moved = { ...HELD_ITEM, revision: 3, updatedAt: HELD_ITEM.updatedAt + 1_000 };
      deliverItems(live, [stampOf(moved, TASK_ID), both[1]], [moved, OTHER_ITEM]);
      yield* nextPoll;
      yield* toldTimes(accountItems, 2);

      assert.deepEqual(accountItems(), [
        byPlan({ [TASK_ID]: [HELD_ITEM], [OTHER_TASK_ID]: [OTHER_ITEM] }),
        byPlan({ [TASK_ID]: [moved], [OTHER_TASK_ID]: [OTHER_ITEM] }),
      ]);
      const otherPlanOf = (told: WireValue | undefined) => {
        const rows = isRecord(told) ? told.rows : undefined;
        const plans = isRecord(rows) ? rows[INBOX_SCOPE_KIND.PLAN] : undefined;
        return isRecord(plans) ? plans[OTHER_TASK_ID] : undefined;
      };
      const [first, second] = accountItems();
      assert.equal(otherPlanOf(second), otherPlanOf(first));
    }),
);

it.effect(
  "the account's items asked past a sync id that stands still longer than a hold are asked whole once, and take what moved behind it",
  () =>
    Effect.gen(function* () {
      const { open, asked, sealItems, stallItems, live, accountItems } = yield* subject();
      sealItems(LIVE_ANSWERED);
      yield* open;
      yield* settled;
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(accountItems, 1);

      // A long transaction holds the sync id, so each read past it is answered nothing moved.
      stallItems();
      const moved = { ...HELD_ITEM, revision: 3, updatedAt: HELD_ITEM.updatedAt + 1_000 };
      deliverItems(live, [stampOf(moved, TASK_ID)], [moved]);
      yield* nextPoll;
      const behind = accountItems().at(-1);
      yield* TestClock.adjust(Duration.seconds(31));
      yield* nextPoll;

      assert.deepEqual(behind, byPlan({ [TASK_ID]: [HELD_ITEM] }));
      assert.deepEqual(accountItems().at(-1), byPlan({ [TASK_ID]: [moved] }));
      assert.deepEqual(
        asked.filter((each) => each.startsWith("account-items-whole:")),
        ["account-items-whole:user-dana"],
      );
    }),
);

it.effect(
  "an item the account's items took earlier never rolls back the newer one a plan's inbox took since, as another item moves",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, sealScope, sealItems, live } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* harness.open;
      yield* settled;
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] });
      const both = [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)];
      deliverItems(live, both, [HELD_ITEM, OTHER_ITEM]);
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const retitled = { title: "Push to main instead?", updatedAt: ITEM.updatedAt + 1_000 };

      // The plan's inbox takes the item as it moved, before the account's items hear of it.
      live.scope.set({ items: [{ ...ITEM_ROW, ...retitled }] });
      yield* nextPoll;
      const other = { ...OTHER_ITEM, revision: OTHER_ITEM.revision + 1 };
      deliverItems(live, [both[0], stampOf(other, OTHER_TASK_ID)], [HELD_ITEM, other]);
      yield* nextPoll;

      assert.deepEqual(
        bothHold(harness, (item) => item.title === retitled.title),
        [true, true],
      );
    }),
);

it.effect("an item no stamp names any more is dropped, its plan told no more", () =>
  Effect.gen(function* () {
    const { open, sealItems, live, accountItems } = yield* subject();
    sealItems(LIVE_ANSWERED);
    yield* open;
    yield* settled;
    deliverItems(
      live,
      [stampOf(HELD_ITEM, TASK_ID), stampOf(OTHER_ITEM, OTHER_TASK_ID)],
      [HELD_ITEM, OTHER_ITEM],
    );
    yield* toldTimes(accountItems, 1);

    deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
    yield* nextPoll;
    yield* toldTimes(accountItems, 2);

    assert.deepEqual(accountItems()[1], byPlan({ [TASK_ID]: [HELD_ITEM] }));
  }),
);

it.effect(
  "a sign-out closes the account's read and tells the window it holds none, and the next account's gate opening reads its items whole",
  () =>
    Effect.gen(function* () {
      let signedIn: string | undefined = "user-dana";
      const { open, asked, sealItems, live, accountItems, reset } = yield* subject({
        accountId: () => signedIn,
      });
      sealItems(LIVE_ANSWERED);
      yield* open;
      yield* settled;
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(accountItems, 1);

      signedIn = undefined;
      yield* reset;
      signedIn = "user-sam";
      deliverItems(live, [stampOf(OTHER_ITEM, OTHER_TASK_ID)], [OTHER_ITEM]);
      yield* open;
      yield* toldTimes(accountItems, 3);

      assert.deepEqual(accountItems().slice(1), [{}, byPlan({ [OTHER_TASK_ID]: [OTHER_ITEM] })]);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("account-items-live:")),
        ["account-items-live:user-dana", "account-items-live:user-sam"],
      );
    }),
);

it.effect(
  "an account's items refused before they ever answered are told failed, and Try again reads them at once",
  () =>
    Effect.gen(function* () {
      const { open, acts, asked, sealItems, live, accountItems } = yield* subject();
      sealItems(undefined);
      yield* open;
      yield* toldTimes(accountItems, 1);

      sealItems(LIVE_ANSWERED);
      yield* acts.AGENTS_INBOX_ITEMS_RETRY(undefined);
      yield* settled;
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(accountItems, 2);

      assert.deepEqual(accountItems(), [{ failed: true }, byPlan({ [TASK_ID]: [HELD_ITEM] })]);
      assert.equal(asked.filter((each) => each.startsWith("account-items-live:")).length, 2);
    }),
);

/** Whether the last telling of a plan's inbox, and of the account's items, holds the item as `holds` reads it. */
function bothHold(
  harness: {
    readonly told: () => readonly WireValue[];
    readonly accountItems: () => readonly unknown[];
  },
  holds: (item: InboxItem) => boolean,
): readonly [boolean, boolean] {
  const firstOf = (items: WireValue | undefined) => {
    const first = Array.isArray(items) ? items[0] : undefined;
    // SAFETY: a telling's items are inbox items, as the window is told them.
    return first === undefined ? false : holds(first as InboxItem);
  };
  const plan = heldOf(harness.told, PLAN_SCOPE);
  // SAFETY: the account's items are told as wire values.
  const account = harness.accountItems().at(-1) as WireValue | undefined;
  const plans =
    isRecord(account) && isRecord(account.rows) ? account.rows[INBOX_SCOPE_KIND.PLAN] : undefined;
  return [
    firstOf(isRecord(plan) ? plan.rows : undefined),
    firstOf(isRecord(plans) ? plans[TASK_ID] : undefined),
  ];
}

it.effect(
  "a mark on an item a plan's inbox and the account's items both hold draws in both at once, answers once the service takes it, and holds there until each carries its transaction, and a close the agent overtook lands on the service's word in both",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, acts, sealScope, sealItems, live, commitIn, changeFirst } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* harness.open;
      yield* settled;
      // Each read is woken by a write once, so each hands a wait for the next.
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] }, ["9100"]);
      live.items.set(
        {
          stamps: [stampOf(HELD_ITEM, TASK_ID)],
          items: [{ ...ITEM_ROW, ...HELD_ITEM }],
          messages: [],
          files: [],
        },
        ["9100"],
      );
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const unread = (item: InboxItem) => item.unread === true;

      commitIn("9200");
      const marked = yield* acts.AGENTS_INBOX_READ_STATE({
        itemId: ITEM.id,
        unread: true,
      });
      yield* settled;
      assert.deepEqual(marked, { id: ITEM.id, unread: true, txid: "9200" });
      assert.deepEqual(bothHold(harness, unread), [true, true]);

      // The account's items carry the mark first, and the plan's inbox answers once more from before it.
      live.items.set({ stamps: [stampOf(HELD_ITEM, TASK_ID, { unread: true })], items: [] }, [
        "9200",
      ]);
      live.scope.set({ items: [ITEM_ROW] });
      yield* nextPoll;
      assert.deepEqual(bothHold(harness, unread), [true, true]);

      live.scope.set({ items: [{ ...ITEM_ROW, unread: true }] }, ["9200"]);
      yield* nextPoll;
      assert.deepEqual(bothHold(harness, unread), [true, true]);

      const overtaken = { ...LIVE_ITEM, revision: 3, title: "Push to main instead?" };
      changeFirst(overtaken);
      commitIn(undefined);
      const closing = yield* Effect.forkChild(
        acts.AGENTS_INBOX_CLOSE({
          itemId: ITEM.id,
          revision: ITEM.revision,
          clientKey: "close-1",
        }),
      );
      yield* settled;
      assert.deepEqual(yield* Fiber.join(closing), { item: overtaken, taken: false });
      assert.deepEqual(
        bothHold(harness, (item) => item.status === INBOX_STATUS.OPEN && item.revision === 3),
        [true, true],
      );
    }),
);

it.effect(
  "a read mark the service gives no answer stays drawn and answers as kept, and is sent again under its key once the service answers",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool({ mintKey: () => "mark-key", replayRefused: Effect.void });
      const { call, acts, sealScope, live, told, answerMarks, markKeys } = yield* subject({ pool });
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      live.scope.set({ items: [{ ...ITEM_ROW, unread: true }], messages: [], files: [] }, ["9100"]);
      yield* toldTimes(told, 1);

      answerMarks(false);
      const marked = yield* acts.AGENTS_INBOX_READ_STATE({
        itemId: ITEM.id,
        unread: false,
      });
      yield* settled;
      const drawn = planInboxOf(told().at(-1)).get(ITEM.id)?.unread;

      answerMarks(true);
      yield* pool.resend;
      yield* settled;

      assert.deepEqual(marked, { id: ITEM.id, unread: false });
      assert.equal(drawn, false);
      assert.deepEqual(markKeys, ["mark-key", "mark-key"]);
      assert.deepEqual(pool.queued(), []);
    }),
);

/** The plan's inbox as one telling of the held inboxes holds it, by id; none where it holds none. */
function planInboxOf(told: WireValue | undefined): ReadonlyMap<string, InboxItem> {
  const plans = isRecord(told) ? told[PLAN_SCOPE.kind] : undefined;
  const read = isRecord(plans) ? plans[PLAN_SCOPE.id] : undefined;
  const rows = isRecord(read) ? read.rows : undefined;
  // SAFETY: a telling's rows are inbox items, as the window is told them.
  return new Map(((Array.isArray(rows) ? rows : []) as InboxItem[]).map((item) => [item.id, item]));
}

it.effect(
  "ten marks asked in a row each draw at once and answer once the service takes them, an item arriving meanwhile draws at once, and no mark is taken back on the way to the read carrying them",
  () =>
    Effect.gen(function* () {
      const { call, acts, sealScope, live, commitIn, told } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      const unread = Array.from({ length: 10 }, (_, n) => ({
        ...ITEM_ROW,
        id: `${ITEM.id.slice(0, -2)}${String(n).padStart(2, "0")}`,
        key: `step-${n}`,
        unread: true,
        updatedAt: ITEM.updatedAt - n * 1_000,
      }));
      const arrived = { ...ITEM_ROW, id: OTHER_ITEM.id, key: OTHER_ITEM.key };
      // The read is woken by a write once, so it hands a wait for the marks.
      live.scope.set({ items: unread, messages: [], files: [] }, ["9100"]);
      yield* toldTimes(told, 1);
      const toldBefore = told().length;

      commitIn("9200");
      const marking = yield* Effect.forkChild(
        Effect.forEach(
          unread,
          (item) => acts.AGENTS_INBOX_READ_STATE({ itemId: item.id, unread: false }),
          { concurrency: "unbounded" },
        ),
      );
      yield* settled;
      assert.notEqual(
        marking.pollUnsafe(),
        undefined,
        "every mark answers before the read carries it",
      );

      // An item arrives while every mark stands, the read still holding them unread.
      live.scope.set({ items: [...unread, arrived] });
      yield* nextPoll;
      const meanwhile = planInboxOf(told().at(-1));

      live.scope.set({ items: [...unread, arrived].map((item) => ({ ...item, unread: false })) }, [
        "9200",
      ]);
      yield* nextPoll;

      assert.equal(meanwhile.has(arrived.id), true, "the arrival draws while the marks stand");
      assert.equal(planInboxOf(told().at(-1)).has(arrived.id), true);
      const stillUnread = told()
        .slice(toldBefore)
        .map((each) => unread.filter((item) => planInboxOf(each).get(item.id)?.unread).length);
      assert.deepEqual(
        stillUnread,
        [...stillUnread].sort((one, other) => other - one),
        "no mark is taken back",
      );
      assert.equal(stillUnread.at(-1), 0);
    }),
);

it.effect(
  "a plain reply the service answers with no transaction lands as the service answered its item in every inbox holding it",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, acts, sealScope, sealItems, live } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* harness.open;
      yield* settled;
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] });
      deliverItems(live, [stampOf(HELD_ITEM, TASK_ID)], [HELD_ITEM]);
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const replied = (item: InboxItem) => JSON.stringify(item).includes(MESSAGE_ID);
      assert.deepEqual(bothHold(harness, replied), [false, false]);

      yield* acts.AGENTS_INBOX_MESSAGE({
        itemId: ITEM.id,
        text: "Push it after the tests pass.",
        clientKey: "reply-1",
      });
      yield* settled;
      assert.deepEqual(bothHold(harness, replied), [true, true]);
    }),
);

it.effect(
  "a plain reply the service answers with a transaction stands on its thread as the service answered it in every inbox holding it until each carries it",
  () =>
    Effect.gen(function* () {
      const harness = yield* subject();
      const { call, acts, sealScope, sealItems, live, commitIn } = harness;
      sealScope(LIVE_ANSWERED);
      sealItems(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* harness.open;
      yield* settled;
      // Each read is woken by a write once, so each hands a wait for the reply.
      live.scope.set({ items: [ITEM_ROW], messages: [], files: [] }, ["9100"]);
      live.items.set(
        {
          stamps: [stampOf(HELD_ITEM, TASK_ID)],
          items: [{ ...ITEM_ROW, ...HELD_ITEM }],
          messages: [],
          files: [],
        },
        ["9100"],
      );
      yield* toldTimes(harness.told, 1);
      yield* toldTimes(harness.accountItems, 1);
      const replied = (item: InboxItem) => JSON.stringify(item).includes(MESSAGE_ID);

      commitIn("9400");
      yield* acts.AGENTS_INBOX_MESSAGE({
        itemId: ITEM.id,
        text: "Push it after the tests pass.",
        clientKey: "reply-1",
      });
      yield* settled;

      assert.deepEqual(bothHold(harness, replied), [true, true]);
    }),
);

it.effect(
  "an answer the agent posts over before the service answers it is drawn once, where the service wrote it, never again under its key below the agent's post",
  () =>
    Effect.gen(function* () {
      const { call, acts, sealScope, live, commitIn, told, holdMessages } = yield* subject();
      sealScope(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_INBOX_FOLLOW, PLAN_SCOPE);
      yield* settled;
      const askId = "6f1c2a4e-1b9d-4c7e-9a52-3d8e0f4b7c11";
      const postId = "8d3e5f7a-2c4b-4d6e-8f1a-3b5c7d9e1f2a";
      const row = (id: string, at: number) => ({
        id,
        itemId: ITEM.id,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        userId: null,
        name: null,
        text: "Push to the release branch?",
        ask: null,
        answers: null,
        createdAt: at,
      });
      const ask = {
        ...row(askId, ITEM.postedAt),
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Push" }, { label: "Wait" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
      };
      const answers = { ask: askId, reply: INBOX_REPLY.CHOSE, choices: ["Push"] };
      live.scope.set(
        { items: [{ ...ITEM_ROW, openAskMessageId: askId }], messages: [ask], files: [] },
        ["9100"],
      );
      yield* toldTimes(told, 1);

      commitIn("9400");
      const answering = yield* Deferred.make<void>();
      holdMessages(Deferred.await(answering));
      const sending = yield* Effect.forkChild(
        acts.AGENTS_INBOX_MESSAGE({
          itemId: ITEM.id,
          text: "",
          clientKey: "answer-1",
          answers,
        }),
      );
      yield* settled;

      // The service took the answer and the agent posted after it, opening the item again, before the answer came back.
      const later = ITEM.updatedAt + 2_000;
      live.scope.set({
        items: [{ ...ITEM_ROW, revision: ITEM.revision + 1, updatedAt: later }],
        messages: [
          ask,
          {
            ...row(MESSAGE_ID, ITEM.updatedAt + 1_000),
            author: INBOX_MESSAGE_AUTHOR.MEMBER,
            userId: "user-dana",
            name: "Dana",
            text: "",
            answers,
            clientKey: "answer-1",
          },
          { ...row(postId, later), text: "The fix is up for review." },
        ],
      });
      yield* nextPoll;
      const drawn = planInboxOf(told().at(-1)).get(ITEM.id);
      yield* Deferred.succeed(answering, undefined);
      yield* Fiber.join(sending);

      assert.deepEqual(
        drawn?.thread?.map((message) => message.id),
        [askId, MESSAGE_ID, postId],
      );
      assert.equal(drawn?.status, INBOX_STATUS.OPEN, "the agent's post waits on the reader");
    }),
);

it.effect(
  "a close drops its update from what waits across the account, its task counting one fewer as for a question, the moment it is asked, answers once the service takes it, and stands over the account's read until it carries it",
  () =>
    Effect.gen(function* () {
      const { call, acts, sealAccount, live, commitIn, accountInboxes } = yield* subject();
      sealAccount(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      const plan = { planId: TASK_ID, items: 1, toDo: 1, updatedAt: ITEM.updatedAt };
      const parts = { planless: [], automations: [], failedRuns: [] };
      const update = { ...WAITING, asking: false };
      live.account.set({ ...parts, items: [update], plans: [plan] }, ["9100"]);
      yield* toldTimes(accountInboxes, 1);
      /** What waits, and each task's count, as the account inbox was last told. */
      const waiting = () => {
        const told = accountInboxes().at(-1);
        assert.ok(isRecord(told) && Array.isArray(told.items) && Array.isArray(told.plans));
        return {
          items: told.items.length,
          toDo: told.plans.map((each) => (isRecord(each) ? each.toDo : undefined)),
        };
      };
      assert.deepEqual(waiting(), { items: 1, toDo: [1] });

      commitIn("9300");
      yield* acts.AGENTS_INBOX_CLOSE({
        itemId: ITEM.id,
        revision: ITEM.revision,
        clientKey: "close-1",
      });
      yield* settled;
      assert.deepEqual(waiting(), { items: 0, toDo: [0] });

      // The read answers once more from before the close, which still stands over it.
      live.account.set({ ...parts, items: [update], plans: [{ ...plan, updatedAt: NOW }] });
      yield* nextPoll;
      assert.deepEqual(waiting(), { items: 0, toDo: [0] });

      live.account.set({ ...parts, items: [], plans: [{ ...plan, toDo: 0 }] }, ["9300"]);
      yield* nextPoll;
      assert.deepEqual(waiting(), { items: 0, toDo: [0] });
    }),
);

it.effect(
  "a close held for its Undo drops its question at once and asks the service nothing until it is let go: undone, it stands again and the service never hears of it; let go, it is sent",
  () =>
    Effect.gen(function* () {
      const { call, acts, sealAccount, live, asked, accountInboxes } = yield* subject();
      sealAccount(LIVE_ANSWERED);
      yield* call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW);
      yield* settled;
      const plan = { planId: TASK_ID, items: 1, toDo: 1, updatedAt: ITEM.updatedAt };
      const parts = { planless: [], automations: [], failedRuns: [] };
      live.account.set({ ...parts, items: [WAITING], plans: [plan] }, ["9100"]);
      yield* toldTimes(accountInboxes, 1);
      /** How many items wait, as the account inbox was last told. */
      const waiting = () => {
        const told = accountInboxes().at(-1);
        assert.ok(isRecord(told) && Array.isArray(told.items));
        return told.items.length;
      };
      const closes = () => asked.filter((each) => each.startsWith("close:"));
      const close = { itemId: ITEM.id, revision: ITEM.revision, held: true };

      const undone = yield* Effect.forkChild(
        acts.AGENTS_INBOX_CLOSE({ ...close, clientKey: "close-1" }),
      );
      yield* settled;
      assert.equal(waiting(), 0);
      const undo = yield* acts.AGENTS_INBOX_CLOSE_RELEASE({
        clientKey: "close-1",
        send: false,
      });
      yield* Fiber.join(undone);
      yield* settled;
      assert.deepEqual(undo, { held: true });
      assert.equal(waiting(), 1);
      assert.deepEqual(closes(), []);

      const sent = yield* Effect.forkChild(
        acts.AGENTS_INBOX_CLOSE({ ...close, clientKey: "close-2" }),
      );
      yield* settled;
      yield* acts.AGENTS_INBOX_CLOSE_RELEASE({ clientKey: "close-2", send: true });
      yield* Fiber.join(sent);
      yield* settled;
      assert.deepEqual(closes(), [`close:${ITEM.id}:${ITEM.revision}:close-2`]);
      // Note that an Undo past the send finds nothing held to take back.
      assert.deepEqual(
        yield* acts.AGENTS_INBOX_CLOSE_RELEASE({
          clientKey: "close-2",
          send: false,
        }),
        { held: false },
      );
    }),
);

it.effect(
  "an inbox write queued on disk by an older build under its Gateway method's name is laid back and sent on relaunch, a reminder under Snooze's",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool({ mintKey: () => "write-key", replayRefused: Effect.void });
      const { asked, queueable } = yield* subject({ pool });
      // Note that the names are spelled here, not read from the composer, because they are what a disk written before this build holds.
      const waiting = [
        {
          name: "agents.inboxAnswer",
          key: "k-1",
          input: {
            itemId: ITEM.id,
            revision: 2,
            reply: INBOX_REPLY.ACKNOWLEDGED,
            clientKey: "a-1",
          },
        },
        {
          name: "agents.inboxClose",
          key: "k-2",
          input: { itemId: ITEM.id, revision: 2, clientKey: "c-1" },
        },
        { name: "agents.inboxReadState", key: "k-3", input: { itemId: ITEM.id, unread: true } },
        { name: "agents.inboxSnooze", key: "k-4", input: { itemId: ITEM.id, until: 5_000 } },
        {
          name: "agents.inboxReadAll",
          key: "k-5",
          input: { workspaceId: WORKSPACE_ID, itemIds: [ITEM.id] },
        },
      ];

      yield* pool.requeue(waiting, queueable);
      yield* pool.resend;

      assert.deepEqual(
        asked.filter(
          (each) =>
            each.startsWith("answer:") || each.startsWith("close:") || each.startsWith("inbox-"),
        ),
        [
          `answer:${ITEM.id}:2:${INBOX_REPLY.ACKNOWLEDGED}:a-1`,
          `close:${ITEM.id}:2:c-1`,
          `inbox-unread:${ITEM.id}`,
          `inbox-remind:${ITEM.id}:5000`,
          `inbox-read-all:${WORKSPACE_ID}`,
        ],
      );
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "an Undo pressed while its close waits behind a write the service has not answered is kept: the close, sent at last, is taken back and never reaches the service",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool({ mintKey: () => "write-key", replayRefused: Effect.void });
      const { acts, asked, answerMarks } = yield* subject({ pool });
      const closes = () => asked.filter((each) => each.startsWith("close:"));

      answerMarks(false);
      yield* acts.AGENTS_INBOX_READ_STATE({ itemId: ITEM.id, unread: false });
      yield* settled;
      assert.equal(pool.queued().length, 1, "the mark waits for the service");
      const closing = yield* Effect.forkChild(
        acts.AGENTS_INBOX_CLOSE({
          itemId: ITEM.id,
          revision: ITEM.revision,
          clientKey: "close-1",
          held: true,
        }),
      );
      yield* settled;
      assert.equal(pool.queued().length, 2, "the close waits behind the mark");
      assert.deepEqual(
        yield* acts.AGENTS_INBOX_CLOSE_RELEASE({
          clientKey: "close-1",
          send: false,
        }),
        { held: true },
      );

      answerMarks(true);
      yield* pool.resend;
      yield* settled;
      yield* Fiber.join(closing);
      assert.deepEqual(closes(), []);
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "a close held for its Undo is sent, not dropped, when the host quits before its window lets it go",
  () =>
    Effect.gen(function* () {
      const { acts, asked, flushHeldCloses } = yield* subject();
      const closing = yield* Effect.forkChild(
        acts.AGENTS_INBOX_CLOSE({
          itemId: ITEM.id,
          revision: ITEM.revision,
          clientKey: "close-1",
          held: true,
        }),
      );
      yield* settled;
      assert.deepEqual(
        asked.filter((each) => each.startsWith("close:")),
        [],
      );
      yield* flushHeldCloses;
      yield* Fiber.join(closing);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("close:")),
        [`close:${ITEM.id}:${ITEM.revision}:close-1`],
      );
    }),
);

/** A close of `ITEM` held for its Undo under `clientKey`, as a window asks it. */
const heldClose = (clientKey: string) => ({
  itemId: ITEM.id,
  revision: ITEM.revision,
  clientKey,
  held: true,
});

it.effect(
  "a close held for its Undo is sent under the account that held it as that account leaves, before it has left",
  () =>
    Effect.gen(function* () {
      let account = "user-ana";
      const { acts, asked, letGoHeldCloses } = yield* subject({ accountId: () => account });
      /** Each close the service was asked, with the account signed in as it was asked. */
      const closesUnder = () => asked.filter((each) => each.startsWith("close:"));
      const closing = yield* Effect.forkChild(acts.AGENTS_INBOX_CLOSE(heldClose("close-1")));
      yield* settled;

      yield* letGoHeldCloses;
      assert.deepEqual(closesUnder(), [`close:${ITEM.id}:${ITEM.revision}:close-1`]);
      account = "user-ben";
      yield* Fiber.join(closing);
      assert.equal(closesUnder().length, 1);
    }),
);

it.effect(
  "a held close still out as its account leaves is dropped once the bound has passed, its item standing open, and is never sent under the next account",
  () =>
    Effect.gen(function* () {
      let account = "user-ana";
      const { acts, asked, letGoHeldCloses, answerClosesAfter } = yield* subject({
        accountId: () => account,
      });
      const closes = () => asked.filter((each) => each.startsWith("close:"));
      answerClosesAfter(Effect.never);
      const closing = yield* Effect.forkChild(acts.AGENTS_INBOX_CLOSE(heldClose("close-1")));
      yield* settled;

      const leaving = yield* Effect.forkChild(letGoHeldCloses);
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(leaving);
      const answer = yield* Fiber.join(closing);
      assert.ok("failure" in answer, "the close is not taken, so its item stands open");
      account = "user-ben";
      answerClosesAfter(Effect.void);
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      assert.deepEqual(closes(), [`close:${ITEM.id}:${ITEM.revision}:close-1`]);
    }),
);

it.effect(
  "a held close let go once another account is signed in is never sent, and its item stands open",
  () =>
    Effect.gen(function* () {
      let account = "user-ana";
      const { acts, asked } = yield* subject({ accountId: () => account });
      const closing = yield* Effect.forkChild(acts.AGENTS_INBOX_CLOSE(heldClose("close-1")));
      yield* settled;

      account = "user-ben";
      yield* acts.AGENTS_INBOX_CLOSE_RELEASE({ clientKey: "close-1", send: true });
      const answer = yield* Fiber.join(closing);
      assert.ok("failure" in answer, "the close is not taken, so its item stands open");
      assert.deepEqual(
        asked.filter((each) => each.startsWith("close:")),
        [],
      );
    }),
);

it.effect(
  "a held close its window let go while it waited behind another write is never sent once another account is signed in",
  () =>
    Effect.gen(function* () {
      let account = "user-ana";
      const pool = yield* entityPool({ mintKey: () => "write-key", replayRefused: Effect.void });
      const { acts, asked, answerMarks } = yield* subject({ pool, accountId: () => account });
      answerMarks(false);
      yield* acts.AGENTS_INBOX_READ_STATE({ itemId: ITEM.id, unread: false });
      yield* settled;
      const closing = yield* Effect.forkChild(acts.AGENTS_INBOX_CLOSE(heldClose("close-1")));
      yield* settled;
      yield* acts.AGENTS_INBOX_CLOSE_RELEASE({ clientKey: "close-1", send: true });

      account = "user-ben";
      answerMarks(true);
      yield* pool.resend;
      yield* settled;
      yield* Fiber.join(closing);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("close:")),
        [],
      );
    }),
);

it.effect(
  "a held close still waiting behind another write as its account leaves is never sent under the next account",
  () =>
    Effect.gen(function* () {
      let account = "user-ana";
      const pool = yield* entityPool({ mintKey: () => "write-key", replayRefused: Effect.void });
      const { acts, asked, answerMarks, letGoHeldCloses } = yield* subject({
        pool,
        accountId: () => account,
      });
      answerMarks(false);
      yield* acts.AGENTS_INBOX_READ_STATE({ itemId: ITEM.id, unread: false });
      yield* settled;
      const closing = yield* Effect.forkChild(acts.AGENTS_INBOX_CLOSE(heldClose("close-1")));
      yield* settled;
      yield* acts.AGENTS_INBOX_CLOSE_RELEASE({ clientKey: "close-1", send: true });

      yield* letGoHeldCloses;
      account = "user-ben";
      answerMarks(true);
      yield* pool.resend;
      yield* settled;
      yield* Fiber.join(closing);
      assert.deepEqual(
        asked.filter((each) => each.startsWith("close:")),
        [],
      );
    }),
);

it.effect(
  "a rename, an archive, a change of model, and a switch of MCP servers each stand on the agent's row of the task list from the press, and a delete draws the agent gone before the service answers",
  () =>
    Effect.gen(function* () {
      const drawn: (readonly AgentSummary[])[] = [];
      const pool = yield* entityPool();
      const list = yield* taskListCollections({
        pool,
        draw: ({ taskAgents }) => void drawn.push(taskAgents),
        txWait: () => undefined,
      });
      yield* list.answer({ plans: [], agents: [{ ...agentListRow(TASK_ID, NOW), id: AGENT_ID }] });
      const answered = yield* Deferred.make<void>();
      const { acts, holdChanges } = yield* subject({ pool });
      holdChanges(Deferred.await(answered));
      const standing = () => drawn.at(-1)?.[0];

      const asked = yield* Effect.forkChild(
        Effect.all(
          [
            acts.AGENTS_RENAME({ agentId: AGENT_ID, title: "Sign-out button" }),
            acts.AGENTS_ARCHIVE({ agentId: AGENT_ID, archived: true }),
            acts.AGENTS_CHOOSE({
              agentId: AGENT_ID,
              model: "openai/gpt-6.1-sol",
              effort: "low",
            }),
            acts.AGENTS_SERVERS({ agentId: AGENT_ID, disabledServers: ["linear"] }),
          ],
          { concurrency: "unbounded" },
        ),
      );
      yield* settled;
      const pressed = standing();
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(asked);

      const held = yield* Deferred.make<void>();
      holdChanges(Deferred.await(held));
      const deleting = yield* Effect.forkChild(acts.AGENTS_DELETE({ agentId: AGENT_ID }));
      yield* settled;
      const deleted = standing();
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(deleting);

      assert.deepEqual(
        [pressed?.title, pressed?.archivedAt, pressed?.model, pressed?.effort],
        ["Sign-out button", NOW, "openai/gpt-6.1-sol", "low"],
      );
      assert.deepEqual(pressed?.disabledServers, ["linear"]);
      assert.equal(deleted, undefined, "the delete is drawn while it is out");
    }),
);

it.effect(
  "a Start answers its agent once the task list carries the Start's transaction, so its tab finds the agent the list draws",
  () =>
    Effect.gen(function* () {
      const carried = yield* Deferred.make<void>();
      const waited: (string | undefined)[] = [];
      const { acts, startCommits } = yield* subject({
        listed: (txid) =>
          Effect.andThen(
            Effect.sync(() => waited.push(txid)),
            Deferred.await(carried),
          ),
      });
      startCommits("9104");

      const starting = yield* Effect.forkChild(
        acts.AGENTS_START({ taskId: TASK_ID, idempotencyKey: "press-1" }),
      );
      yield* settled;
      assert.equal(starting.pollUnsafe(), undefined, "no answer while the list is behind");

      yield* Deferred.succeed(carried, undefined);
      assert.deepEqual(waited, ["9104"]);
      assert.deepEqual(yield* Fiber.join(starting), {
        agent: { ...AGENT, status: AGENT_STATUS.STARTING },
        txid: "9104",
      });
    }),
);

it.effect(
  "a Start the service did not answer waits, its call held until it is sent again, and then answers its agent",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool({ mintKey: () => "start-key", replayRefused: Effect.void });
      const { acts, asked, leaveStartsUnanswered } = yield* subject({ pool });
      leaveStartsUnanswered(true);

      const starting = yield* Effect.forkChild(
        acts.AGENTS_START({ taskId: TASK_ID, idempotencyKey: "press-1" }),
      );
      yield* settled;
      const meanwhile = starting.pollUnsafe();
      const waiting = pool.queued().length;
      leaveStartsUnanswered(false);
      yield* pool.resend;

      assert.equal(meanwhile, undefined, "no answer while it waits");
      assert.equal(waiting, 1);
      assert.deepEqual(yield* Fiber.join(starting), {
        agent: { ...AGENT, status: AGENT_STATUS.STARTING },
      });
      assert.deepEqual(
        asked.filter((each) => each.startsWith("start:")),
        [`start:${TASK_ID}:press-1:default`, `start:${TASK_ID}:press-1:default`],
      );
      assert.deepEqual(pool.queued(), []);
    }),
);
