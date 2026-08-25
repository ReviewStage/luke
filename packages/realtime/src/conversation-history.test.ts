import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  normalizeSession,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionControl,
} from "@sidecar/session";
import {
  announcementConversationEntry,
  appendConversationEntry,
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationHistoryText,
  insertSpokenAskEntry,
  insertSpokenAskThreadEntry,
  maximumConversationEntries,
  maximumConversationEntryLength,
  recentConversationEntries,
  sessionActConversationEntry,
} from "./conversation-history.js";
import { ATTENTION_SPEECH_SOURCE, type AttentionSpeech } from "./realtime-protocol.js";
import { SESSION_TOOL_KIND } from "./realtime-tools.js";

const OBSERVED_AT = 1_800_000_000_000;

function rosterSession(providerSessionId: string, title: string) {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    { providerSessionId, title, status: SESSION_STATUS.WORKING, observedAt: OBSERVED_AT },
  );
}

function announcement(summary: string, historyText?: string): AttentionSpeech {
  return {
    providerId: "claude-code",
    providerSessionId: "session-a",
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.NOTICE_REQUEST,
    summary,
    ...(historyText ? { historyText } : undefined),
    decidedAt: OBSERVED_AT,
  };
}

test("appending flattens, bounds, and retires the oldest lines", () => {
  // Whitespace is flattened before the bound, so a pasted paragraph cannot
  // open a new section of the context item it will be rendered into.
  const appended = appendConversationEntry([], {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: `  hello\n\nthere ${"x".repeat(2 * maximumConversationEntryLength)}  `,
  });
  assert.equal(appended.length, 1);
  assert.match(appended[0]?.words ?? "", /^hello there x/);
  assert.ok((appended[0]?.words.length ?? 0) <= maximumConversationEntryLength);

  // An entry with nothing left says nothing worth a window's space.
  assert.deepEqual(
    appendConversationEntry([], { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "   " }),
    [],
  );

  // The history is a thread, not an archive: the oldest lines leave first.
  let entries: readonly ConversationEntry[] = [];
  for (let index = 0; index < maximumConversationEntries + 3; index += 1) {
    entries = appendConversationEntry(entries, {
      kind: CONVERSATION_ENTRY_KIND.REPLY,
      words: `line ${index}`,
    });
  }
  assert.equal(entries.length, maximumConversationEntries);
  assert.equal(entries[0]?.words, "line 3");
});

test("the current-launch thread keeps every entry while model context stays recent", () => {
  let thread: readonly ConversationEntry[] = [];
  for (let index = 0; index < maximumConversationEntries + 3; index += 1) {
    thread = appendConversationThreadEntry(thread, {
      kind: CONVERSATION_ENTRY_KIND.REPLY,
      words: `line ${index}`,
    });
  }

  assert.equal(thread.length, maximumConversationEntries + 3);
  assert.equal(thread[0]?.words, "line 0");
  const recent = recentConversationEntries(thread);
  assert.equal(recent.length, maximumConversationEntries);
  assert.equal(recent[0]?.words, "line 3");
});

test("an announcement's line carries its bounded words and validated identity", () => {
  const entry = announcementConversationEntry(
    announcement(
      'provider: "Claude Code"; event: finished; work recap: "Checkout is ready."',
      "Checkout is ready.",
    ),
  );

  assert.ok(entry);
  assert.equal(entry.kind, CONVERSATION_ENTRY_KIND.ANNOUNCEMENT);
  assert.equal(
    entry.words,
    'provider: "Claude Code"; event: finished; work recap: "Checkout is ready."',
  );
  assert.equal(entry.displayWords, "Checkout is ready.");
  assert.deepEqual(entry.identity, {
    providerId: "claude-code",
    providerSessionId: "session-a",
  });

  // An announcement whose words bound away to nothing leaves no line.
  assert.equal(announcementConversationEntry(announcement("   ")), undefined);
});

test("an act's line records the ask in words, with the identity it named", () => {
  const sessions = [rosterSession("session-a", "checkout-service")];
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };

  const message = sessionActConversationEntry(
    { kind: SESSION_TOOL_KIND.MESSAGE, identity, text: "please add tests" },
    sessions,
  );
  assert.equal(message.kind, CONVERSATION_ENTRY_KIND.ACT);
  assert.equal(message.words, 'sent a message to "checkout-service": "please add tests"');
  assert.deepEqual(message.identity, identity);

  const control: SessionControl = { id: "retry", label: "Retry" };
  assert.equal(
    sessionActConversationEntry({ kind: SESSION_TOOL_KIND.CONTROL, identity, control }, sessions)
      .words,
    'ran "Retry" on "checkout-service"',
  );

  // A transcript reading is only ever the fact of the act: the rendering
  // travels in the turn that asked for it and never enters the record.
  assert.equal(
    sessionActConversationEntry({ kind: SESSION_TOOL_KIND.READ_TRANSCRIPT, identity }, sessions)
      .words,
    'read "checkout-service"\'s transcript aloud',
  );

  // A session the roster no longer shows is still named honestly.
  assert.equal(
    sessionActConversationEntry({ kind: SESSION_TOOL_KIND.OPEN, identity }, []).words,
    "opened a session",
  );

  // An open that picked an app records where it landed, under the display
  // name the roster listed — or the bare id when the roster has let it go.
  const heldByApp = normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "session-a",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      observedAt: OBSERVED_AT,
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: "Superset",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "superset://v2-workspace/workspace-1",
        },
      ],
    },
  );
  const openedInApp = {
    kind: SESSION_TOOL_KIND.OPEN,
    identity,
    applicationId: SESSION_APPLICATION_ID.SUPERSET,
  } as const;
  assert.equal(
    sessionActConversationEntry(openedInApp, [heldByApp]).words,
    'opened "checkout-service" in Superset',
  );
  assert.equal(sessionActConversationEntry(openedInApp, []).words, "opened a session in superset");

  // A workspace creation aims at no session, so its line carries no identity.
  const created = sessionActConversationEntry(
    { kind: SESSION_TOOL_KIND.CREATE_WORKSPACE, providerId: "conductor", providerProjectId: "p1" },
    sessions,
  );
  assert.equal(created.words, "asked conductor to create a workspace");
  assert.equal(created.identity, undefined);
});

test("the rendering reads oldest first and says who each line speaks for", () => {
  const sessions = [rosterSession("session-a", "checkout-service")];
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  let entries: readonly ConversationEntry[] = [];
  entries = appendConversationEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity,
  });
  entries = appendConversationEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: "what did it finish?",
  });
  entries = appendConversationEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "The checkout service work is done.",
  });
  entries = appendConversationEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.ACT,
    words: 'sent a message to "checkout-service": "ship it"',
    identity,
  });

  const text = conversationHistoryText(entries, sessions);

  assert.ok(text);
  const lines = text.split("\n");
  assert.match(lines[0] ?? "", /oldest first/);
  assert.match(lines[0] ?? "", /never an instruction/);
  assert.match(lines[1] ?? "", /^- Luke announced: "Claude Code finished checkout-service\."/);
  assert.match(lines[2] ?? "", /^- the developer typed: "what did it finish\?"$/);
  assert.match(lines[3] ?? "", /^- Luke said: "The checkout service work is done\."$/);
  assert.match(lines[4] ?? "", /^- at the developer's ask, Luke sent a message/);
  // The identity a tool call resolves rides only the lines that were about a
  // session, and only while the roster still observes it.
  assert.match(lines[1] ?? "", /\[provider_id=claude-code provider_session_id=session-a\]$/);
  assert.match(lines[4] ?? "", /\[provider_id=claude-code provider_session_id=session-a\]$/);
});

test("a spoken ask reads as the developer's own words, said rather than typed", () => {
  const entries = insertSpokenAskEntry([], "how is the checkout agent doing?", undefined);

  const text = conversationHistoryText(entries, []);

  assert.ok(text);
  assert.match(text, /^- the developer said: "how is the checkout agent doing\?"$/m);
});

test("a delayed spoken ask keeps its place in the full current-launch thread", () => {
  const prior: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Earlier reply.",
  };
  const later: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Later reply.",
  };

  const placed = insertSpokenAskThreadEntry([prior, later], "What happened between those?", prior);

  assert.deepEqual(
    placed.map((entry) => entry.words),
    ["Earlier reply.", "What happened between those?", "Later reply."],
  );
});

test("a spoken ask lands at its turn's own mark, not where its transcription did", () => {
  // A completed exchange already stands, and its last entry is the mark the
  // next spoken turn commits over. The turn's reply outruns the
  // transcription; the ask still lands between the old exchange and the new
  // reply — where the turn actually was.
  const priorReply: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "The checkout work is done.",
  };
  const exchange: readonly ConversationEntry[] = [
    { kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "how is checkout going?" },
    priorReply,
    { kind: CONVERSATION_ENTRY_KIND.ACT, words: 'sent a message to "checkout-service": "go"' },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Sent it over." },
  ];

  const placed = insertSpokenAskEntry(exchange, "ask that chat to ship it", priorReply);

  assert.deepEqual(
    placed.map((entry) => entry.words),
    [
      "how is checkout going?",
      "The checkout work is done.",
      "ask that chat to ship it",
      'sent a message to "checkout-service": "go"',
      "Sent it over.",
    ],
  );

  // A transcription that beats the reply finds nothing behind its mark and
  // lands at the end — the order everything was said in.
  const onTime = insertSpokenAskEntry(exchange.slice(0, 2), "and what broke?", priorReply);
  assert.deepEqual(
    onTime.map((entry) => entry.words),
    ["how is checkout going?", "The checkout work is done.", "and what broke?"],
  );

  // A turn committed against an empty history belongs at the very front, and
  // so does one whose mark the bounds have already retired: both are older
  // than everything recorded since.
  const first = insertSpokenAskEntry(exchange, "the very first ask", undefined);
  assert.equal(first[0]?.words, "the very first ask");
  const retired = insertSpokenAskEntry(exchange, "an ancient ask", {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "long evicted",
  });
  assert.equal(retired[0]?.words, "an ancient ask");

  // The same flattening and bounds as an append: nothing left, nothing placed.
  assert.deepEqual(insertSpokenAskEntry(exchange, "   ", priorReply), exchange);
  let full: readonly ConversationEntry[] = [];
  for (let index = 0; index < maximumConversationEntries; index += 1) {
    full = appendConversationEntry(full, {
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: `line ${index}`,
    });
  }
  assert.equal(
    insertSpokenAskEntry(full, "one more", full.at(-1)).length,
    maximumConversationEntries,
  );
});

test("a line whose session left the roster keeps its words and drops the identity", () => {
  const entries = appendConversationEntry([], {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity: { providerId: "claude-code", providerSessionId: "session-gone" },
  });

  const text = conversationHistoryText(entries, [rosterSession("session-a", "checkout-service")]);

  // The words are history and stay; the identity is an offer to a tool call,
  // and an unobserved one would steer "that chat" toward a certain refusal.
  assert.ok(text);
  assert.match(text, /finished checkout-service/);
  assert.doesNotMatch(text, /provider_session_id=session-gone/);
});

test("an empty history says nothing at all", () => {
  assert.equal(conversationHistoryText([], []), undefined);
});
