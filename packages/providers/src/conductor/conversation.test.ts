import assert from "node:assert/strict";
import test from "node:test";
import { dispatchConversation, dispatchRead, UNSUPPORTED_BY_OBSERVATION } from "@sidecar/session";
import type { JsonObject } from "@sidecar/wire/testing";
import { HTTP_STATUS } from "@sidecar/wire/testing";
import {
  fakeConductorApi,
  IDLE_SESSION_UUID,
  isoTimestamp,
  LUKE_PROJECT,
  ownedWorkspace,
  pluginFor,
  TEST_CONDUCTOR_STATUS,
  TEST_SESSION_NAME,
  TEST_TIME,
  TEST_USER_ID,
  type TestApi,
  type TestSession,
} from "../testing/conductor-api.js";

const CONVERSATION_WORKSPACE_ID = "workspace-conversation";
const STORED_MESSAGE_UUIDS = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003",
  "aaaaaaaa-0000-4000-8000-000000000004",
  "aaaaaaaa-0000-4000-8000-000000000005",
  "aaaaaaaa-0000-4000-8000-000000000006",
  "aaaaaaaa-0000-4000-8000-000000000007",
  "aaaaaaaa-0000-4000-8000-000000000008",
] as const;

function storedUserMessage(id: string, message: string, receivedAtMs: number): JsonObject {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 1,
    type: "userMessage",
    content: { type: "userMessage", message },
    receivedAt: isoTimestamp(receivedAtMs),
  };
}

function storedAgentEvent(id: string, rawPayload: JsonObject, receivedAtMs: number): JsonObject {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 2,
    type: "agent",
    content: { type: "agent", rawPayload },
    receivedAt: isoTimestamp(receivedAtMs),
  };
}

/** A conversation whose store holds every shape the parse must judge. */
function conversationApi(overrides: Partial<TestSession> = {}, api: Partial<TestApi> = {}) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [{ ...ownedWorkspace(CONVERSATION_WORKSPACE_ID, TEST_TIME - 30_000) }],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: CONVERSATION_WORKSPACE_ID,
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
        storedMessages: [
          storedUserMessage(
            STORED_MESSAGE_UUIDS[0],
            "Fix the flaky roster test",
            TEST_TIME - 9_000,
          ),
          // Thinking alone is not the agent speaking, so no bubble may wear it.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[1],
            { type: "assistant", message: { content: [{ type: "thinking", thinking: "plan" }] } },
            TEST_TIME - 8_000,
          ),
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[2],
            {
              type: "assistant",
              message: {
                content: [
                  { type: "thinking", thinking: "quiet" },
                  { type: "text", text: "Looking at the test now." },
                  { type: "tool_use", name: "Bash", input: {} },
                  { type: "text", text: "It races the clock." },
                ],
              },
            },
            TEST_TIME - 7_000,
          ),
          // A Claude-shaped `user` event is tool output, not the developer.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[3],
            { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
            TEST_TIME - 6_000,
          ),
          // A Codex item still streaming has no words yet.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[4],
            { event: { type: "item.started", item: { type: "agentMessage", text: "" } } },
            TEST_TIME - 5_000,
          ),
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[5],
            {
              event: {
                type: "item.completed",
                item: { type: "agentMessage", text: "Fixed: the test now stubs the clock." },
              },
            },
            TEST_TIME - 4_000,
          ),
          // A completed command is a tool at work, not the agent speaking.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[6],
            {
              event: {
                type: "item.completed",
                item: { type: "commandExecution", command: "pnpm test" },
              },
            },
            TEST_TIME - 3_000,
          ),
          // A lifecycle event has no author a bubble can wear.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[7],
            { type: "system", subtype: "init" },
            TEST_TIME - 2_000,
          ),
        ],
        ...overrides,
      },
    ],
    ...api,
  });
}

test("reads an observed chat's conversation as the attributed words alone", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchConversation(plugin, { providerSessionId: IDLE_SESSION_UUID });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(result.messages, [
    {
      id: STORED_MESSAGE_UUIDS[0],
      author: "user",
      text: "Fix the flaky roster test",
      receivedAt: TEST_TIME - 9_000,
    },
    {
      id: STORED_MESSAGE_UUIDS[2],
      author: "agent",
      text: "Looking at the test now.\n\nIt races the clock.",
      receivedAt: TEST_TIME - 7_000,
    },
    {
      id: STORED_MESSAGE_UUIDS[5],
      author: "agent",
      text: "Fixed: the test now stubs the clock.",
      receivedAt: TEST_TIME - 4_000,
    },
  ]);
  // The cursor names the newest stored message the page consumed — dropped
  // or kept — so the poll that follows resumes past the lifecycle noise too.
  assert.equal(result.lastMessageId, STORED_MESSAGE_UUIDS[7]);
  assert.equal(result.hasMore, false);
  // The whole transcript fit in one page, so the history starts at its start.
  assert.equal(result.firstOffset, 0);
  assert.equal(result.hasOlder, false);

  const read = api.requests.at(-1);
  assert.equal(read?.method, "GET");
  assert.equal(read?.pathname, `/v0/sessions/${IDLE_SESSION_UUID}/messages`);
  // The opening read seeks the end and pages backward: offsets, never `after`.
  assert.equal(read?.searchParams.get("after"), null);
  assert.equal(read?.searchParams.get("offset"), "0");
});

test("continues a conversation read behind the cursor its last answer handed back", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[2],
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(
    result.messages.map((message) => message.id),
    [STORED_MESSAGE_UUIDS[5]],
  );
  assert.equal(result.lastMessageId, STORED_MESSAGE_UUIDS[7]);
  // A poll never looks backward, so it reports no history position.
  assert.equal(result.firstOffset, undefined);
  assert.equal(result.hasOlder, undefined);

  const read = api.requests.at(-1);
  assert.equal(read?.searchParams.get("after"), STORED_MESSAGE_UUIDS[2]);
});

test("a poll walks the store's pages to the fixed bounds and answers hasMore honestly", async () => {
  const api = conversationApi(undefined, { messagesPageSize: 3 });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[0],
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // The seven stored messages behind the cursor fit inside the page budget,
  // walked three at a time: the later pages ride the cursor the earlier
  // ones handed back.
  assert.deepEqual(
    result.messages.map((message) => message.id),
    [STORED_MESSAGE_UUIDS[2], STORED_MESSAGE_UUIDS[5]],
  );
  assert.equal(result.hasMore, false);
  const reads = api.requests.filter(
    (request) =>
      request.method === "GET" && request.pathname.endsWith(`${IDLE_SESSION_UUID}/messages`),
  );
  assert.equal(reads.length, 3);
  assert.equal(reads[0]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[0]);
  assert.equal(reads[1]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[3]);
  assert.equal(reads[2]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[6]);
});

test("an incremental transcript read keeps the inherited unsupported answer and reads nothing", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const opening = await dispatchRead(plugin, "transcriptSince", IDLE_SESSION_UUID);
  const poll = await dispatchRead(
    plugin,
    "transcriptSince",
    IDLE_SESSION_UUID,
    STORED_MESSAGE_UUIDS[2],
  );

  assert.equal(opening.status, "unsupported");
  assert.equal(poll.status, "unsupported");
  assert.equal(api.requests.length, requestsBefore);
});

test("refuses a conversation read for anything the latest pass did not stand behind", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const unobserved = await dispatchConversation(plugin, {
    providerSessionId: "99999999-9999-4999-8999-999999999999",
  });
  const badCursor = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: "not-a-message-id",
  });
  const badPosition = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    beforeOffset: -3,
  });
  const bothPositions = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[0],
    beforeOffset: 100,
  });

  assert.deepEqual(unobserved, {
    status: "unsupported",
    reason: UNSUPPORTED_BY_OBSERVATION,
  });
  assert.deepEqual(badCursor, {
    status: "rejected",
    reason: "That conversation cursor is not one Conductor handed back.",
  });
  assert.deepEqual(badPosition, {
    status: "rejected",
    reason: "That conversation position is not one Conductor handed back.",
  });
  assert.deepEqual(bothPositions, {
    status: "rejected",
    reason: "A poll and a history read are different asks; a request names one position.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

// A transcript longer than one window: the opening read seeks the end and
// pages backward from it, and a scroll to the top continues from where the
// last page said it began.
const LONG_TRANSCRIPT_LENGTH = 120;

function longMessageUuid(index: number): string {
  return `cccccccc-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function longConversationApi() {
  return conversationApi({
    storedMessages: Array.from({ length: LONG_TRANSCRIPT_LENGTH }, (_, index) =>
      storedUserMessage(longMessageUuid(index), `message ${index}`, TEST_TIME - 100_000 + index),
    ),
  });
}

test("an opening read walks to the end of a long transcript one page at a time", async () => {
  const api = longConversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const result = await dispatchConversation(plugin, { providerSessionId: IDLE_SESSION_UUID });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // The walk reached the end of the 120 stored messages and answers with
  // every page it read.
  assert.equal(result.messages.length, LONG_TRANSCRIPT_LENGTH);
  assert.equal(result.messages[0]?.id, longMessageUuid(0));
  assert.equal(result.messages.at(-1)?.id, longMessageUuid(119));
  assert.equal(result.lastMessageId, longMessageUuid(119));
  assert.equal(result.firstOffset, 0);
  assert.equal(result.hasOlder, false);
  assert.equal(result.hasMore, false);
  // Two pages, and nothing else: the walk carries the fixed page size and an
  // offset it composed, and never the endpoint's own `after` cursor.
  const reads = api.requests.slice(requestsBefore);
  assert.equal(reads.length, 2);
  assert.ok(reads.every((request) => request.searchParams.get("after") === null));
  assert.deepEqual(
    reads.map((request) => request.searchParams.get("offset")),
    ["0", "100"],
  );
});

test("a re-opened chat costs one request, from where the last read reached", async () => {
  const api = longConversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  await dispatchConversation(plugin, { providerSessionId: IDLE_SESSION_UUID });
  const requestsBefore = api.requests.length;

  const result = await dispatchConversation(plugin, { providerSessionId: IDLE_SESSION_UUID });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // One page before the end this session's last read reached is where the
  // walk starts, so a re-open asks once and answers the newest page.
  const reads = api.requests.slice(requestsBefore);
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.searchParams.get("offset"), "20");
  assert.equal(result.messages.length, 100);
  assert.equal(result.messages.at(-1)?.id, longMessageUuid(119));
  assert.equal(result.firstOffset, 20);
  assert.equal(result.hasOlder, true);
});

test("a transcript cleared behind the cached end is walked again from its start", async () => {
  const api = longConversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  await dispatchConversation(plugin, { providerSessionId: IDLE_SESSION_UUID });
  const emptied = conversationApi({ storedMessages: [] });
  const restarted = pluginFor(emptied.fetch);
  await restarted.observe();

  // A cached offset past a transcript the developer cleared on Conductor's
  // own surface is the one backtrack, and it is bounded to one.
  const first = await dispatchConversation(restarted, { providerSessionId: IDLE_SESSION_UUID });
  assert.equal(first.status, "accepted");
  if (first.status !== "accepted") return;
  assert.equal(first.messages.length, 0);
  assert.equal(first.firstOffset, 0);
});

test("a scroll to the top reads the history just before what the screen holds", async () => {
  const api = longConversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const result = await dispatchConversation(plugin, {
    providerSessionId: IDLE_SESSION_UUID,
    beforeOffset: 20,
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.messages.length, 20);
  assert.equal(result.messages[0]?.id, longMessageUuid(0));
  assert.equal(result.messages.at(-1)?.id, longMessageUuid(19));
  assert.equal(result.firstOffset, 0);
  assert.equal(result.hasOlder, false);
  // Conversation must never move the poll: an older page names no forward cursor.
  assert.equal(result.lastMessageId, undefined);

  const read = api.requests.at(-1);
  assert.equal(read?.searchParams.get("offset"), "0");
  assert.equal(read?.searchParams.get("limit"), "20");
});

test("refuses a conversation read for an observed id that is not a UUID", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const result = await dispatchConversation(plugin, { providerSessionId: "session-idle" });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "That session's id is not a shape this build can read messages for.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("a conversation read names what refused it without echoing the provider", async () => {
  const refusedKey = conversationApi({ messagesHttpStatus: HTTP_STATUS.UNAUTHORIZED });
  const refusedKeyAdapter = pluginFor(refusedKey.fetch);
  await refusedKeyAdapter.observe();
  const unauthorized = await dispatchConversation(refusedKeyAdapter, {
    providerSessionId: IDLE_SESSION_UUID,
  });
  assert.deepEqual(unauthorized, {
    status: "rejected",
    reason: "Conductor rejected the configured API key.",
  });

  // A cursor the store no longer holds answers 404, which reads as the same
  // transient refusal any unreadable answer does — never a fresh guess.
  const staleCursor = conversationApi();
  const staleCursorAdapter = pluginFor(staleCursor.fetch);
  await staleCursorAdapter.observe();
  const stale = await dispatchConversation(staleCursorAdapter, {
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: "bbbbbbbb-0000-4000-8000-00000000000b",
  });
  assert.deepEqual(stale, {
    status: "rejected",
    reason: "Conductor did not answer, so the conversation could not be read.",
  });
});

test("the brain's transcript read renders the attributed words one line each, in the shared vocabulary", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const read = await dispatchRead(plugin, "transcript", IDLE_SESSION_UUID);

  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  assert.equal(
    read.transcript,
    [
      "Developer: Fix the flaky roster test",
      "Conductor: Looking at the test now.",
      "",
      "It races the clock.",
      "Conductor: Fixed: the test now stubs the clock.",
    ].join("\n"),
  );
  const reads = api.requests.slice(requestsBefore);
  assert.ok(reads.length >= 1);
  for (const request of reads) {
    assert.equal(request.method, "GET");
    assert.equal(request.pathname, `/v0/sessions/${IDLE_SESSION_UUID}/messages`);
  }
});

// An agent's final report is a document, not a line: the read hands the brain
// the whole of it, and only the brain's own tail cut bounds the total.
test("a transcript read renders a long message whole, with its line breaks", async () => {
  const report = Array.from(
    { length: 60 },
    (_, index) => `- finding ${index}: ${"x".repeat(80)}`,
  ).join("\n");
  const api = conversationApi({
    storedMessages: [
      storedUserMessage(longMessageUuid(0), "Write the report", TEST_TIME - 2_000),
      storedAgentEvent(
        longMessageUuid(1),
        { type: "assistant", message: { content: [{ type: "text", text: report }] } },
        TEST_TIME - 1_000,
      ),
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const read = await dispatchRead(plugin, "transcript", IDLE_SESSION_UUID);

  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  const lines = read.transcript.split("\n");
  assert.equal(lines.length, 1 + report.split("\n").length);
  assert.equal(
    read.transcript.length,
    "Developer: Write the report\n".length + "Conductor: ".length + report.length,
  );
});

test("a transcript read of a chat longer than one page reaches the stored newest message", async () => {
  const api = longConversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const read = await dispatchRead(plugin, "transcript", IDLE_SESSION_UUID);

  assert.equal(read.status, "accepted");
  if (read.status !== "accepted") return;
  const lines = read.transcript.split("\n");
  assert.equal(lines.length, LONG_TRANSCRIPT_LENGTH);
  assert.equal(lines.at(-1), `Developer: message ${LONG_TRANSCRIPT_LENGTH - 1}`);
});

test("a transcript read refuses a session the latest pass did not report and reaches nothing", async () => {
  const api = conversationApi();
  const plugin = pluginFor(api.fetch);
  await plugin.observe();
  const requestsBefore = api.requests.length;

  const read = await dispatchRead(plugin, "transcript", "99999999-9999-4999-8999-999999999999");

  assert.equal(read.status, "unsupported");
  assert.equal(api.requests.length, requestsBefore);
});

test("a transcript read of a chat with no attributed words is not found rather than empty", async () => {
  const api = conversationApi({
    storedMessages: [
      storedAgentEvent(STORED_MESSAGE_UUIDS[7], { type: "system", subtype: "init" }, TEST_TIME),
    ],
  });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const read = await dispatchRead(plugin, "transcript", IDLE_SESSION_UUID);

  assert.deepEqual(read, {
    status: "rejected",
    reason: "That session's transcript could not be found.",
  });
});

test("a transcript read that Conductor refuses is rejected with the reason, never thrown", async () => {
  const api = conversationApi({ messagesHttpStatus: HTTP_STATUS.UNAUTHORIZED });
  const plugin = pluginFor(api.fetch);
  await plugin.observe();

  const read = await dispatchRead(plugin, "transcript", IDLE_SESSION_UUID);

  assert.equal(read.status, "rejected");
  if (read.status !== "rejected") return;
});
