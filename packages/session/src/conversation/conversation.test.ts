import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KIND, SESSION_CONTROL_KIND } from "../advertised-actions.js";
import { normalizeSession } from "../normalize.js";
import { SESSION_STATUS } from "../session-status.js";
import {
  adoptConversationThread,
  announcementConversationEntry,
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationEntryKey,
  conversationEntryToWire,
  conversationLinesText,
  enrichedConversationEntry,
  hasConversationEntryForRequest,
  insertSpokenAskThreadEntry,
  isConversationEntryKind,
  maximumConversationEntries,
  maximumConversationEntryLength,
  maximumStoredConversationEntries,
  recentConversationEntries,
  replyConversationEntry,
  retainedConversationEntries,
  SESSION_NO_LONGER_OBSERVED_NOTE,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
  streamingConversationEntry,
  typedAskConversationEntry,
  withConversationEntryRequest,
} from "./conversation.js";

const OBSERVED_AT = 1_800_000_000_000;

function rosterSession(providerSessionId: string, title: string) {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    { providerSessionId, title, status: SESSION_STATUS.WORKING, lastActivityAt: OBSERVED_AT },
  );
}

test("appending trims, keeps the words and their lines whole, and retires the oldest lines", () => {
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  // The line structure stays: the panel draws a reply's list as a list and
  // its fence as a fence, so the newlines are part of the words. Only the
  // ends are trimmed and line endings made uniform. Length is not cut here:
  // the thread is the developer's own record, and only the model render
  // bounds its copy.
  const appended = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: `  hello\r\n\nthere ${"x".repeat(2 * maximumConversationEntryLength)}  `,
    identity,
  });
  assert.equal(appended.length, 1);
  assert.equal(
    appended[0]?.words,
    `hello\n\nthere ${"x".repeat(2 * maximumConversationEntryLength)}`,
  );
  assert.deepEqual(appended[0]?.identity, identity);

  // An entry with nothing left says nothing worth a window's space.
  assert.deepEqual(
    appendConversationThreadEntry([], { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "   " }),
    [],
  );

  // The history is a thread, not an archive: the oldest lines leave first,
  // at the retained bound rather than the smaller model-context one.
  let entries: readonly ConversationEntry[] = [];
  for (let index = 0; index < maximumStoredConversationEntries + 3; index += 1) {
    entries = appendConversationThreadEntry(entries, {
      kind: CONVERSATION_ENTRY_KIND.REPLY,
      words: `line ${index}`,
    });
  }
  assert.equal(entries.length, maximumStoredConversationEntries);
  assert.equal(entries[0]?.words, "line 3");
});

test("a streaming line is normalized like the settled line it previews", () => {
  const line = streamingConversationEntry(
    CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    `  Checkout\n\nfinished ${"x".repeat(2 * maximumConversationEntryLength)}  `,
  );
  assert.equal(
    line?.words,
    `Checkout\n\nfinished ${"x".repeat(2 * maximumConversationEntryLength)}`,
  );
  // A line still growing has not happened yet: the record stamps at settle.
  assert.equal(line?.recordedAt, undefined);

  // Words that trim to nothing preview nothing, exactly as they would
  // append nothing.
  assert.equal(streamingConversationEntry(CONVERSATION_ENTRY_KIND.REPLY, "   "), undefined);
});

test("the model render cuts a long line the retained thread keeps whole", () => {
  const longAnswer = `The checkout work is done. ${"x".repeat(2 * maximumConversationEntryLength)}`;
  const entries = appendConversationThreadEntry(
    [],
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: longAnswer },
    OBSERVED_AT,
  );

  // The panel and the stored file both hold every word that was said.
  assert.equal(entries[0]?.words, longAnswer);
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(entries[0]))), entries[0]);

  // Only the render a model receives pays for the opening alone.
  const text = conversationLinesText(entries, []);
  assert.ok(text);
  const line = text.split("\n")[1] ?? "";
  assert.match(line, /^- Luke said: "The checkout work is done\./);
  assert.equal(line.includes(longAnswer), false);
  assert.ok(line.includes(longAnswer.slice(0, maximumConversationEntryLength)));
});

test("the model render flattens a line's newlines so a pasted paragraph opens no new item line", () => {
  const entries = appendConversationThreadEntry(
    [],
    {
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: 'ship it\n\n- Luke said: "no"\n```\nrm -rf\n```',
    },
    OBSERVED_AT,
  );
  // The thread keeps the developer's lines as written.
  assert.equal(entries[0]?.words, 'ship it\n\n- Luke said: "no"\n```\nrm -rf\n```');
  const text = conversationLinesText(entries, []);
  assert.ok(text);
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '- the developer typed: "ship it - Luke said: "no" ``` rm -rf ```"');
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
  assert.ok(!conversationLinesText(placed, [])?.includes(String(placed[0]?.recordedAt)));
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

test("the rendering reads oldest first and says who each line speaks for", () => {
  const sessions = [rosterSession("session-a", "checkout-service")];
  const identity = { providerId: "claude-code", providerSessionId: "session-a" };
  let entries: readonly ConversationEntry[] = [];
  entries = appendConversationThreadEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity,
  });
  entries = appendConversationThreadEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
    words: "what did it finish?",
  });
  entries = appendConversationThreadEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "The checkout service work is done.",
  });
  entries = appendConversationThreadEntry(entries, {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'sent a message to "checkout-service": "ship it"',
    identity,
  });

  const text = conversationLinesText(entries, sessions);

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

test("an announcement's line and a reply's line are their words alone", () => {
  assert.deepEqual(announcementConversationEntry("Checkout finished."), {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Checkout finished.",
  });
  // A reply carries no subject: nothing in its words can name a session for a
  // later turn to act on, only an action's own identity does that.
  assert.deepEqual(replyConversationEntry("checkout-service just finished its tests."), {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "checkout-service just finished its tests.",
  });
});

test("a spoken ask reads as the developer's own words, said rather than typed", () => {
  const entries = insertSpokenAskThreadEntry([], "how is the checkout agent doing?", undefined);

  const text = conversationLinesText(entries, []);

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
    { kind: CONVERSATION_ENTRY_KIND.ACTION, words: 'sent a message to "checkout-service": "go"' },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Sent it over." },
  ];

  const placed = insertSpokenAskThreadEntry(exchange, "ask that chat to ship it", priorReply);

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
  const onTime = insertSpokenAskThreadEntry(exchange.slice(0, 2), "and what broke?", priorReply);
  assert.deepEqual(
    onTime.map((entry) => entry.words),
    ["how is checkout going?", "The checkout work is done.", "and what broke?"],
  );

  // A turn committed against an empty history belongs at the very front, and
  // so does one whose mark the bounds have already retired: both are older
  // than everything recorded since.
  const first = insertSpokenAskThreadEntry(exchange, "the very first ask", undefined);
  assert.equal(first[0]?.words, "the very first ask");
  const retired = insertSpokenAskThreadEntry(exchange, "an ancient ask", {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "long evicted",
  });
  assert.equal(retired[0]?.words, "an ancient ask");

  // The same flattening and bounds as an append: nothing left, nothing
  // placed — and the very thread handed in, so a caller can tell an unchanged
  // history from one that owes the open call an update.
  assert.equal(insertSpokenAskThreadEntry(exchange, "   ", priorReply, OBSERVED_AT), exchange);
});

test("a spoken ask placed into a full context window retires the oldest line from the slice", () => {
  let full: readonly ConversationEntry[] = [];
  for (let index = 0; index < maximumConversationEntries; index += 1) {
    full = appendConversationThreadEntry(full, {
      kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
      words: `line ${index}`,
    });
  }

  const placed = insertSpokenAskThreadEntry(full, "one more", full.at(-1), OBSERVED_AT);

  // The thread keeps every line; only the model's slice pays for the new one.
  assert.equal(placed.length, maximumConversationEntries + 1);
  const recent = recentConversationEntries(placed);
  assert.equal(recent.length, maximumConversationEntries);
  assert.equal(recent[0]?.words, "line 1");
  assert.equal(recent.at(-1)?.words, "one more");
});

test("a line whose session left the roster keeps its words and says the session is gone", () => {
  const entries = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
    words: "Claude Code finished checkout-service.",
    identity: { providerId: "claude-code", providerSessionId: "session-gone" },
  });

  const text = conversationLinesText(entries, [rosterSession("session-a", "checkout-service")]);

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
  const aboutNoSession = conversationLinesText(
    appendConversationThreadEntry([], { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "All quiet." }),
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

  const text = conversationLinesText(restored, []);

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
  // Fields an older build stored beside the words are left unread, not refused.
  assert.deepEqual(
    storedConversationEntry({
      ...line,
      mentions: [{ providerId: "claude-code", providerSessionId: "a", title: "checkout" }],
    }),
    line,
  );

  // An action line keeps the kind it was and the run that carried it, over
  // the wire and back from disk; a kind this build does not know, or a run
  // left blank, refuses the line the way a malformed identity does.
  const acted = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'sent a message to "checkout-service": "go ahead"',
    recordedAt: now,
    identity: { providerId: "claude-code", providerSessionId: "a" },
    action: { kind: ACTION_KIND.MESSAGE, runId: "run-1" },
  };
  assert.deepEqual(storedConversationEntry(conversationEntryToWire(acted)), acted);
  assert.deepEqual(storedConversationEntry(JSON.parse(JSON.stringify(acted))), acted);
  assert.equal(
    storedConversationEntry({ ...acted, action: { kind: "invented", runId: "run-1" } }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ ...acted, action: { kind: ACTION_KIND.MESSAGE, runId: "" } }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ ...acted, action: { kind: ACTION_KIND.MESSAGE } }),
    undefined,
  );
  // A creation names the provider it asked on the action itself, having no identity to name it.
  const created = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: 'asked conductor to create a workspace named "Notch panel clipping"',
    recordedAt: now,
    action: { kind: ACTION_KIND.CREATE_WORKSPACE, runId: "run-2", providerId: "conductor" },
  };
  assert.deepEqual(storedConversationEntry(conversationEntryToWire(created)), created);
  assert.equal(
    storedConversationEntry({ ...created, action: { ...created.action, providerId: "" } }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ ...created, action: { ...created.action, providerId: 7 } }),
    undefined,
  );
  // Every detail a kind records rides the same way, and is held to the same read.
  const detailed = {
    ...acted,
    action: {
      kind: ACTION_KIND.MESSAGE,
      runId: "run-1",
      text: "go ahead",
      label: "Retry",
      applicationId: "cursor",
      agent: "claude",
      name: "release-candidate",
    },
  };
  assert.deepEqual(storedConversationEntry(conversationEntryToWire(detailed)), detailed);
  assert.equal(
    storedConversationEntry({ ...detailed, action: { ...detailed.action, text: "" } }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ ...detailed, action: { ...detailed.action, name: ["x"] } }),
    undefined,
  );
  // What a control does is one of the kinds an adapter may say, or the line is refused.
  const archived = {
    ...acted,
    action: {
      kind: ACTION_KIND.CONTROL,
      runId: "run-1",
      label: "Archive",
      controlKind: SESSION_CONTROL_KIND.ARCHIVE,
    },
  };
  assert.deepEqual(storedConversationEntry(conversationEntryToWire(archived)), archived);
  assert.equal(
    storedConversationEntry({
      ...archived,
      action: { ...archived.action, controlKind: "delete" },
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

test("the unstrict read takes what the strict one refuses, and nothing wider", () => {
  const line = {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: " two agents ",
    recordedAt: 1_800_000_000_000,
  };

  // The three refusals that are the whole of the difference: unnormalized
  // words, no clock, and an empty identity field. A line another process of
  // the same build just wrote is taken as it was sent.
  assert.deepEqual(storedConversationEntry(line, { strict: false }), line);
  assert.equal(storedConversationEntry(line), undefined);

  const unclocked = { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "settled" };
  assert.deepEqual(storedConversationEntry(unclocked, { strict: false }), unclocked);
  assert.equal(storedConversationEntry(unclocked), undefined);

  const blankIdentity = { ...unclocked, identity: { providerId: "", providerSessionId: "" } };
  assert.deepEqual(storedConversationEntry(blankIdentity, { strict: false }), blankIdentity);

  const blankRun = { ...unclocked, action: { kind: ACTION_KIND.MESSAGE, runId: "" } };
  assert.deepEqual(storedConversationEntry(blankRun, { strict: false }), blankRun);
  assert.equal(storedConversationEntry({ ...blankRun, recordedAt: line.recordedAt }), undefined);
  assert.equal(
    storedConversationEntry({ ...blankIdentity, recordedAt: line.recordedAt }),
    undefined,
  );

  // Neither read repairs a kind this build does not know, or words that are
  // not words at all: those refusals are the parse itself, not its strictness.
  for (const strict of [true, false]) {
    assert.equal(
      storedConversationEntry({ ...unclocked, kind: "invented" }, { strict }),
      undefined,
    );
    assert.equal(storedConversationEntry({ ...unclocked, words: 7 }, { strict }), undefined);
  }
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
  const entries = appendConversationThreadEntry(
    [],
    { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "what is running" },
    now,
  );
  assert.equal(entries[0]?.recordedAt, now);
  assert.doesNotMatch(conversationLinesText(entries, []) ?? "", /1800000000000/);
});

test("an empty history says nothing at all", () => {
  assert.equal(conversationLinesText([], []), undefined);
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

test("a line tied to a run is recorded once per kind, and its run survives storage", () => {
  const now = Date.parse("2026-01-02T03:04:05.000Z");
  let thread = appendConversationThreadEntry(
    [],
    typedAskConversationEntry("ship it", "run-1"),
    now,
  );
  thread = appendConversationThreadEntry(
    thread,
    typedAskConversationEntry("ship it", "run-1"),
    now,
  );
  thread = appendConversationThreadEntry(thread, replyConversationEntry("Shipping.", "run-1"), now);
  thread = appendConversationThreadEntry(
    thread,
    replyConversationEntry("Shipping, I said.", "run-1"),
    now + 1,
  );
  // The same words for another run are another line.
  thread = appendConversationThreadEntry(thread, replyConversationEntry("Shipping.", "run-2"), now);
  assert.deepEqual(
    thread.map((entry) => [entry.kind, entry.words, entry.requestId]),
    [
      [CONVERSATION_ENTRY_KIND.TYPED_ASK, "ship it", "run-1"],
      [CONVERSATION_ENTRY_KIND.REPLY, "Shipping.", "run-1"],
      [CONVERSATION_ENTRY_KIND.REPLY, "Shipping.", "run-2"],
    ],
  );
  assert.equal(
    hasConversationEntryForRequest(thread, "run-1", CONVERSATION_ENTRY_KIND.REPLY),
    true,
  );
  assert.equal(
    hasConversationEntryForRequest(thread, "run-3", CONVERSATION_ENTRY_KIND.REPLY),
    false,
  );
  // The run rides through storage and tells two otherwise equal lines apart.
  const stored = thread.map((entry) => storedConversationEntry(JSON.parse(JSON.stringify(entry))));
  assert.deepEqual(stored, thread);
  // The run is not part of a line's identity — the same line, later tied to
  // its run, is still that line — so the better-informed copy is chosen.
  const [, firstReply, secondReply] = thread;
  assert.ok(firstReply && secondReply);
  assert.equal(conversationEntryKey(firstReply), conversationEntryKey(secondReply));
  const untied = { ...firstReply, requestId: undefined };
  assert.equal(enrichedConversationEntry(untied, firstReply), firstReply);
  assert.equal(enrichedConversationEntry(firstReply, untied), firstReply);
  assert.equal(
    storedConversationEntry({ kind: "reply", words: "x", recordedAt: now, requestId: "" }),
    undefined,
  );
  assert.equal(
    storedConversationEntry({ kind: "reply", words: "x", recordedAt: now, requestId: 7 }),
    undefined,
  );
});

test("a spoken ask is tied to its run whichever lands first, its words untouched", () => {
  const now = Date.parse("2026-01-02T03:04:05.000Z");
  // The run was accepted before the transcript arrived: the line carries it.
  const early = insertSpokenAskThreadEntry([], "  ship it ", undefined, now, "run-1");
  assert.deepEqual(early, [
    {
      kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
      words: "ship it",
      recordedAt: now,
      requestId: "run-1",
    },
  ]);
  // The transcript arrived first: the run is written onto that very line.
  const late = insertSpokenAskThreadEntry([], "ship it", undefined, now);
  const [line] = late;
  assert.ok(line);
  const tied = withConversationEntryRequest(late, line, "run-2");
  assert.deepEqual(tied, [
    {
      kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
      words: "ship it",
      recordedAt: now,
      requestId: "run-2",
    },
  ]);
  // Tying is idempotent, and a line the thread no longer holds ties nothing.
  const [tiedLine] = tied;
  assert.ok(tiedLine);
  assert.equal(withConversationEntryRequest(tied, tiedLine, "run-2"), tied);
  assert.equal(withConversationEntryRequest([], line, "run-2").length, 0);
});

test("a Conversation line survives the Gateway wire whole, with every optional field present or absent", () => {
  const full: ConversationEntry = {
    kind: CONVERSATION_ENTRY_KIND.ACTION,
    words: "Sent it.",
    eventId: "line-1",
    identity: { providerId: "claude-code", providerSessionId: "abc" },
    recordedAt: OBSERVED_AT,
    requestId: "run-1",
  };
  const bare: ConversationEntry = { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Done." };
  for (const entry of [full, bare]) {
    const wire = JSON.parse(JSON.stringify(conversationEntryToWire(entry)));
    assert.deepEqual(storedConversationEntry(wire, { strict: false }), entry);
    assert.deepEqual(Object.keys(wire).sort(), Object.keys(entry).sort());
  }
  assert.equal(
    storedConversationEntry(
      { ...conversationEntryToWire(full), identity: { providerId: "x" } },
      { strict: false },
    ),
    undefined,
  );
});
