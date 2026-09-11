import assert from "node:assert/strict";
import type { HostedConversationAnswer, SessionMessagesQuery } from "@sidecar/hosted";
import {
  CLOUD_AGENT_PROVIDER_ID,
  CONVERSATION_MESSAGE_AUTHOR,
  normalizeSession,
  OMISSION_MARKER,
  PROVIDER_ID,
  SESSION_STATUS,
  type Session,
  transcriptLine,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { test } from "vitest";
import { hostedTranscriptReads } from "./hosted-transcripts.js";

/*
 * The service answers the attributed page; what these tests hold this side
 * to is the rendering the brain reads — one line per attributed message, in
 * the shared vocabulary, under the agent's roster name — the cursor handed
 * back unchanged, and the refusals a read that cannot happen answers with.
 */

const NOW = 1_800_000_000_000;

const CLOUD = { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, providerSessionId: "chat-1" };
const LOCAL = { providerId: PROVIDER_ID.CODEX, providerSessionId: "local-1" };

const NAMED_AGENT: Session = normalizeSession(
  { id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, displayName: "Conductor" },
  {
    providerSessionId: "chat-1",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    agent: { id: "claude-code", displayName: "Claude Code" },
  },
);

const PAGE: HostedConversationAnswer = {
  messages: [
    { id: "m-1", author: CONVERSATION_MESSAGE_AUTHOR.USER, text: "Fix the flaky test\n\n" },
    { id: "m-2", author: CONVERSATION_MESSAGE_AUTHOR.AGENT, text: "On it." },
    { id: "m-3", author: CONVERSATION_MESSAGE_AUTHOR.AGENT, text: "   " },
  ],
  lastMessageId: "m-3",
  hasMore: false,
};

function fixture(answers: readonly (HostedConversationAnswer | undefined)[], session?: Session) {
  const queries: SessionMessagesQuery[] = [];
  const remaining = [...answers];
  const reads = hostedTranscriptReads({
    client: {
      read: async (query) => {
        queries.push(query);
        return remaining.shift();
      },
    },
    session: () => session,
  });
  return { reads, queries };
}

test("the whole read renders the page as lines under the agent's roster name, and opens with the marker when history precedes it", async () => {
  const { reads, queries } = fixture([{ ...PAGE, hasOlder: true }, PAGE], NAMED_AGENT);

  const preceded = await reads.readTranscript(CLOUD);
  const whole = await reads.readTranscript(CLOUD);

  assert.deepEqual(preceded, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    transcript: [
      OMISSION_MARKER,
      transcriptLine.developer("Fix the flaky test"),
      transcriptLine.agent("Claude Code", "On it."),
    ].join("\n"),
  });
  assert.deepEqual(whole, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    transcript: [
      transcriptLine.developer("Fix the flaky test"),
      transcriptLine.agent("Claude Code", "On it."),
    ].join("\n"),
  });
  assert.deepEqual(queries, [CLOUD, CLOUD]);
});

test("a session the roster names no agent for speaks under its provider's name", async () => {
  const { reads } = fixture([PAGE]);

  const whole = await reads.readTranscript(CLOUD);

  assert.deepEqual(whole, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    transcript: [
      transcriptLine.developer("Fix the flaky test"),
      transcriptLine.agent("Conductor", "On it."),
    ].join("\n"),
  });
});

test("the incremental read hands the cursor back as `after`, answers the newest consumed id, and says what was cut", async () => {
  const { reads, queries } = fixture([
    { ...PAGE, hasOlder: true },
    { messages: [], hasMore: false },
    { ...PAGE, lastMessageId: "m-9", hasMore: true },
  ]);

  const first = await reads.readTranscriptSince(CLOUD, undefined);
  const quiet = await reads.readTranscriptSince(CLOUD, "m-3");
  const more = await reads.readTranscriptSince(CLOUD, "m-3");

  assert.deepEqual(first, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    text: [
      transcriptLine.developer("Fix the flaky test"),
      transcriptLine.agent("Conductor", "On it."),
    ].join("\n"),
    cursor: "m-3",
    truncated: true,
  });
  // Nothing gained keeps the cursor where it was rather than losing it.
  assert.deepEqual(quiet, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    text: "",
    cursor: "m-3",
    truncated: false,
  });
  assert.equal(more.status === ACTION_RESULT_STATUS.ACCEPTED && more.cursor, "m-9");
  assert.equal(more.status === ACTION_RESULT_STATUS.ACCEPTED && more.truncated, true);
  assert.deepEqual(
    queries.map((query) => query.afterMessageId),
    [undefined, "m-3", "m-3"],
  );
});

test("a local session is refused before any call, and a page the service could not answer is a refusal", async () => {
  const { reads, queries } = fixture([undefined, undefined]);

  assert.equal((await reads.readTranscript(LOCAL)).status, ACTION_RESULT_STATUS.UNSUPPORTED);
  assert.equal(
    (await reads.readTranscriptSince(LOCAL, undefined)).status,
    ACTION_RESULT_STATUS.UNSUPPORTED,
  );
  assert.equal(queries.length, 0);

  assert.equal((await reads.readTranscript(CLOUD)).status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(
    (await reads.readTranscriptSince(CLOUD, "m-3")).status,
    ACTION_RESULT_STATUS.REJECTED,
  );
});

test("a page with no attributed words is not found rather than rendered empty", async () => {
  const { reads } = fixture([{ messages: [], hasMore: false }]);

  assert.equal((await reads.readTranscript(CLOUD)).status, ACTION_RESULT_STATUS.REJECTED);
});
