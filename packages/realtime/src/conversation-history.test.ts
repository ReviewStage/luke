import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionControl,
} from "@sidecar/session";
import {
  adoptConversationThread,
  announcementConversationEntry,
  appendConversationEntry,
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationHistoryText,
  insertSpokenAskEntry,
  insertSpokenAskThreadEntry,
  isConversationEntryKind,
  maximumConversationEntries,
  maximumConversationEntryLength,
  maximumStoredConversationEntries,
  recentConversationEntries,
  replyConversationEntry,
  retainedConversationEntries,
  sessionActConversationEntry,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
  streamingConversationEntry,
} from "./conversation-history.js";
import { SESSION_NO_LONGER_OBSERVED_NOTE } from "./realtime-protocol.js";
import { SESSION_TOOL_KIND } from "./realtime-tools.js";

const OBSERVED_AT = 1_800_000_000_000;

function rosterSession(providerSessionId: string, title: string) {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    { providerSessionId, title, status: SESSION_STATUS.WORKING, observedAt: OBSERVED_AT },
  );
}

test("appending flattens, bounds, and retires the oldest lines", () => {
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  // Whitespace is flattened before the bound, so a pasted paragraph cannot
  // open a new section of the context item it will be rendered into.
  const appended = appendConversationEntry([], {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: `  hello\n\nthere ${"x".repeat(2 * maximumConversationEntryLength)}  `,
    identity,
  });
  assert.equal(appended.length, 1);
  assert.match(appended[0]?.words ?? "", /^hello there x/);
  assert.ok((appended[0]?.words.length ?? 0) <= maximumConversationEntryLength);
  assert.deepEqual(appended[0]?.identity, identity);

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

test("a streaming line is bounded like the settled line it previews", () => {
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  const line = streamingConversationEntry(
    CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    `  Checkout\n\nfinished ${"x".repeat(2 * maximumConversationEntryLength)}  `,
    identity,
  );
  assert.match(line?.words ?? "", /^Checkout finished x/);
  assert.ok((line?.words.length ?? 0) <= maximumConversationEntryLength);
  assert.deepEqual(line?.identity, identity);
  // A line still growing has not happened yet: the record stamps at settle.
  assert.equal(line?.recordedAt, undefined);

  // Words that flatten to nothing preview nothing, exactly as they would
  // append nothing.
  assert.equal(streamingConversationEntry(CONVERSATION_ENTRY_KIND.REPLY, "   "), undefined);
});

test("every way into the thread stamps when the line was recorded", () => {
  const before = Date.now();
  const appended = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Checkout is ready.",
  });
  const placed = insertSpokenAskThreadEntry(appended, "how is checkout going?", undefined, before);

  for (const entry of placed) {
    assert.ok(entry.recordedAt !== undefined);
    assert.ok(entry.recordedAt >= before && entry.recordedAt <= Date.now());
  }
  assert.equal(placed[0]?.recordedAt, before);

  // The stamp is the panel's alone: the model's context item is unchanged.
  assert.ok(!conversationHistoryText(placed, [])?.includes(String(placed[0]?.recordedAt)));
});

test("the retained thread keeps more entries than model context", () => {
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
  const createdNamed = sessionActConversationEntry(
    {
      kind: SESSION_TOOL_KIND.CREATE_WORKSPACE,
      providerId: "conductor",
      providerProjectId: "p1",
      name: "Notch panel clipping",
    },
    sessions,
  );
  assert.equal(
    createdNamed.words,
    'asked conductor to create a workspace named "Notch panel clipping"',
  );
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

test("a batched announcement carries every validated session through history", () => {
  const identities = [
    { providerId: "claude-code", providerSessionId: "session-a" },
    { providerId: "claude-code", providerSessionId: "session-b" },
  ];
  const entries = appendConversationEntry(
    [],
    {
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: "Checkout finished and billing needs approval.",
      identities,
    },
    OBSERVED_AT,
  );

  const text = conversationHistoryText(entries, [
    rosterSession("session-a", "checkout"),
    rosterSession("session-b", "billing"),
  ]);

  assert.ok(text);
  assert.match(text, /provider_session_id=session-a.*provider_session_id=session-b/);
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(entries[0]))), entries[0]);
});

test("a spoken ask reads as the developer's own words, said rather than typed", () => {
  const entries = insertSpokenAskEntry([], "how is the checkout agent doing?", undefined);

  const text = conversationHistoryText(entries, []);

  assert.ok(text);
  assert.match(text, /^- the developer said: "how is the checkout agent doing\?"$/m);
});

test("a delayed spoken ask keeps its place in the retained thread", () => {
  const prior: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Earlier reply.",
  };
  const later: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Later reply.",
  };

  const placed = insertSpokenAskThreadEntry(
    [prior, later],
    "What happened between those?",
    prior,
    OBSERVED_AT,
  );

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

  // The same flattening and bounds as an append: nothing left, nothing
  // placed — and the very thread handed in, so a caller can tell an unchanged
  // history from one that owes the open call an update.
  assert.equal(insertSpokenAskThreadEntry(exchange, "   ", priorReply, OBSERVED_AT), exchange);
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

test("a line whose session left the roster keeps its words and says the session is gone", () => {
  const entries = appendConversationEntry([], {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity: { providerId: "claude-code", providerSessionId: "session-gone" },
  });

  const text = conversationHistoryText(entries, [rosterSession("session-a", "checkout-service")]);

  // The words are history and stay; the identity is an offer to a tool call,
  // and an unobserved one would steer "that chat" toward a certain refusal.
  // The departure is said in the identity's place with the note the standing
  // instructions teach: a line that merely fell silent would leave "archive
  // that chat" to be resolved by guessing among the sessions still observed.
  assert.ok(text);
  assert.match(text, /finished checkout-service/);
  assert.doesNotMatch(text, /provider_session_id=session-gone/);
  assert.match(text, new RegExp(`\\[${SESSION_NO_LONGER_OBSERVED_NOTE}\\]$`, "m"));

  // A line that never named a session carries neither identity nor note.
  const aboutNoSession = conversationHistoryText(
    appendConversationEntry([], { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "All quiet." }),
    [],
  );
  assert.ok(aboutNoSession);
  assert.doesNotMatch(aboutNoSession, /no longer observed/);
});

test("a thread restored from a past launch renders with no identity at all", () => {
  // Across a launch this is the ordinary case rather than the exception: every
  // session the last conversation named has a fresh roster to be absent from,
  // and none of those lines may still offer an identity to a tool call.
  const restored = [
    {
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: "how is checkout going",
      recordedAt: 1_800_000_000_000,
    },
    {
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: "Claude Code finished checkout-service.",
      identity: { providerId: "claude-code", providerSessionId: "yesterdays-session" },
      recordedAt: 1_800_000_000_000,
    },
  ] satisfies ConversationEntry[];

  const text = conversationHistoryText(restored, []);

  assert.ok(text);
  assert.match(text, /how is checkout going/);
  assert.match(text, /finished checkout-service/);
  assert.doesNotMatch(text, /provider_id=/);
});

test("a stored line reads back, and retention cuts by age and by count", () => {
  const now = 1_800_000_000_000;
  const line = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "two agents are working",
    recordedAt: now,
  };
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(line))), line);
  assert.equal(
    storedConversationEntry({ kind: "invented", words: "no", recordedAt: now }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ kind: CONVERSATION_ENTRY_KIND.REPLY, words: line.words }),
    undefined,
  );
  assert.equal(storedConversationEntry({ ...line, words: " two agents " }), undefined);
  assert.equal(
    storedConversationEntry({ ...line, identity: { providerId: "claude-code" } }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({
      ...line,
      identity: { providerId: "claude-code", providerSessionId: "a" },
      identities: [{ providerId: "claude-code", providerSessionId: "b" }],
    }),
    undefined,
  );

  const stale = { ...line, recordedAt: now - storedConversationMaximumAgeMs - 1 };
  assert.deepEqual(retainedConversationEntries([stale, line], now), [line]);

  const many = Array.from({ length: maximumStoredConversationEntries + 5 }, (_, index) => ({
    ...line,
    words: `line ${index}`,
  }));
  assert.equal(retainedConversationEntries(many, now).length, maximumStoredConversationEntries);
});

test("the live thread obeys the same count and age retention as storage", () => {
  const now = 1_800_000_000_000;
  let entries: readonly ConversationEntry[] = [];
  for (let index = 0; index <= maximumStoredConversationEntries; index += 1) {
    entries = appendConversationThreadEntry(
      entries,
      { kind: CONVERSATION_ENTRY_KIND.REPLY, words: `line ${index}` },
      now,
    );
  }
  assert.equal(entries.length, maximumStoredConversationEntries);
  assert.equal(entries[0]?.words, "line 1");
  assert.deepEqual(
    retainedConversationEntries(entries, now + storedConversationMaximumAgeMs + 1),
    [],
  );
});

test("an appended line carries retention's clock without it reaching the model", () => {
  const now = 1_800_000_000_000;
  const entries = appendConversationEntry(
    [],
    { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "what is running" },
    now,
  );
  assert.equal(entries[0]?.recordedAt, now);
  assert.doesNotMatch(conversationHistoryText(entries, []) ?? "", /1800000000000/);
});

test("an empty history says nothing at all", () => {
  assert.equal(conversationHistoryText([], []), undefined);
});

test("the kind guard admits every history line kind and nothing else", () => {
  for (const kind of Object.values(CONVERSATION_ENTRY_KIND)) {
    assert.equal(isConversationEntryKind(kind), true);
  }
  assert.equal(isConversationEntryKind("transcript"), false);
  assert.equal(isConversationEntryKind(""), false);
  assert.equal(isConversationEntryKind(3), false);
  assert.equal(isConversationEntryKind(undefined), false);
});

test("adopting another window's thread reuses the entry objects already held", () => {
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  const ask: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: "how is it going?",
    recordedAt: 1,
  };
  const reply: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Two chats are working.",
    recordedAt: 2,
  };
  // The relay recreates every object on the way over; the adoption must hand
  // back the local ones, because the spoken-turn marks locate a turn by
  // entry identity.
  const adopted = adoptConversationThread(
    [ask, reply],
    [
      { ...ask },
      { ...reply },
      { kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "A chat finished.", identity },
    ],
  );
  assert.equal(adopted.length, 3);
  assert.equal(adopted[0], ask);
  assert.equal(adopted[1], reply);
  assert.deepEqual(adopted[2]?.identity, identity);

  // Two same-worded lines are told apart by when they were recorded, and a
  // local object is adopted at most once even when its line repeats.
  const twin: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "ok",
    recordedAt: 5,
  };
  const doubled = adoptConversationThread([twin], [{ ...twin }, { ...twin }]);
  assert.equal(doubled[0], twin);
  assert.notEqual(doubled[1], twin);

  // A cleared or diverged thread is taken as reported: entries the report no
  // longer carries do not survive the adoption.
  assert.deepEqual(adoptConversationThread([ask, reply], []), []);
});

test("a reply answering about one session records its subject and its chip", () => {
  const sessions = [
    rosterSession("session-a", "checkout-service"),
    rosterSession("session-b", "billing-service"),
  ];

  const entry = replyConversationEntry("checkout-service just finished its tests.", sessions);
  assert.equal(entry.kind, CONVERSATION_ENTRY_KIND.REPLY);
  assert.deepEqual(entry.identity, {
    providerId: "claude-code",
    providerSessionId: "session-a",
  });
  assert.deepEqual(entry.mentions, [
    {
      providerId: "claude-code",
      providerSessionId: "session-a",
      title: "checkout-service",
      markId: "claude-code",
      applications: [],
    },
  ]);
});

test("a reply naming several sessions draws every chip but records no subject", () => {
  const sessions = [
    rosterSession("session-a", "checkout-service"),
    rosterSession("session-b", "billing-service"),
  ];

  // Two chats named: a chip each, but the subject a later turn's bare "that
  // chat" resolves through cannot choose between them.
  const both = replyConversationEntry(
    "checkout-service is done and billing-service is waiting.",
    sessions,
  );
  assert.equal(both.identity, undefined);
  assert.deepEqual(
    both.mentions?.map((mention) => [mention.providerSessionId, mention.title, mention.markId]),
    [
      ["session-a", "checkout-service", "claude-code"],
      ["session-b", "billing-service", "claude-code"],
    ],
  );

  // No observed name appears whole, so nothing a model said earns a chip.
  const neither = replyConversationEntry("Nothing is running right now.", sessions);
  assert.equal(neither.identity, undefined);
  assert.equal(neither.mentions, undefined);
});

test("a reply's subject is single when the identities are, not when the names were", () => {
  // The chat's own title and its workspace's name both resolve to session-a:
  // two mentions, one chat, one chip, still one attributable subject.
  const chat = normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "session-a",
      title: "checkout-service",
      status: SESSION_STATUS.WORKING,
      observedAt: OBSERVED_AT,
      workspace: { providerWorkspaceId: "ws-1", name: "hong-kong" },
    },
  );

  const entry = replyConversationEntry("checkout-service in hong-kong is finished.", [chat]);
  assert.deepEqual(entry.identity, {
    providerId: "conductor",
    providerSessionId: "session-a",
  });
  assert.equal(entry.mentions?.length, 1);
});

test("an announcement's line carries every subject and subject chip", () => {
  const sessions = [
    rosterSession("session-a", "checkout-service"),
    rosterSession("session-b", "billing"),
  ];
  const about = { providerId: "claude-code", providerSessionId: "session-a" };

  const entry = announcementConversationEntry("checkout-service finished.", [about], sessions);
  assert.equal(entry.kind, CONVERSATION_ENTRY_KIND.ANNOUNCEMENT);
  assert.deepEqual(entry.identity, about);
  assert.equal(entry.mentions?.length, 1);
  assert.equal(entry.mentions?.[0]?.title, "checkout-service");

  const batched = announcementConversationEntry(
    "Checkout finished and billing needs approval.",
    [about, { providerId: "claude-code", providerSessionId: "session-b" }],
    sessions,
  );
  assert.equal(batched.identity, undefined);
  assert.deepEqual(
    batched.identities?.map(({ providerSessionId }) => providerSessionId),
    ["session-a", "session-b"],
  );
  assert.deepEqual(
    batched.mentions?.map(({ providerSessionId }) => providerSessionId),
    ["session-a", "session-b"],
  );

  // A subject the roster cannot word keeps its identity and draws no chip.
  const unworded = announcementConversationEntry("It finished.", [about], []);
  assert.deepEqual(unworded.identity, about);
  assert.equal(unworded.mentions, undefined);
});

test("an act's line wears its session's chip while the roster can word it", () => {
  const sessions = [rosterSession("session-a", "checkout-service")];
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };

  const acted = sessionActConversationEntry(
    { kind: SESSION_TOOL_KIND.MESSAGE, identity, text: "ship it" },
    sessions,
  );
  assert.deepEqual(acted.mentions, [
    {
      providerId: "claude-code",
      providerSessionId: "session-a",
      title: "checkout-service",
      markId: "claude-code",
      applications: [],
    },
  ]);

  const departed = sessionActConversationEntry({ kind: SESSION_TOOL_KIND.OPEN, identity }, []);
  assert.deepEqual(departed.identity, identity);
  assert.equal(departed.mentions, undefined);
});

test("a line's chips survive the append, the store, and the read back", () => {
  const mentions = [
    {
      providerId: "conductor",
      providerSessionId: "chat-1",
      title: "checkout-service",
      markId: "claude-code",
      applications: [{ id: "conductor", name: "Conductor" }],
    },
  ];
  const appended = appendConversationThreadEntry(
    [],
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "checkout-service is done.", mentions },
    OBSERVED_AT,
  );
  assert.deepEqual(appended[0]?.mentions, mentions);

  // The stored round trip keeps the chips exactly, so a restart or another
  // display's panel draws the same row of ways back.
  const stored = storedConversationEntry(JSON.parse(JSON.stringify(appended[0])));
  assert.deepEqual(stored?.mentions, mentions);
});

test("a stored line whose mentions this build cannot read drops whole", () => {
  const line = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "checkout-service is done.",
    recordedAt: OBSERVED_AT,
  };
  // Absent mentions are an older build's record and read back fine.
  assert.ok(storedConversationEntry(line));
  // A mentions list from another spelling refuses the line, like a misspelled
  // identity: half a chip row would press for chats it cannot name.
  assert.equal(storedConversationEntry({ ...line, mentions: "checkout" }), undefined);
  assert.equal(storedConversationEntry({ ...line, mentions: [{ title: "checkout" }] }), undefined);
  assert.equal(
    storedConversationEntry({
      ...line,
      mentions: [
        {
          providerId: "conductor",
          providerSessionId: "chat-1",
          title: "checkout-service",
          markId: "claude-code",
          applications: [{ id: "conductor" }],
        },
      ],
    }),
    undefined,
  );
});
