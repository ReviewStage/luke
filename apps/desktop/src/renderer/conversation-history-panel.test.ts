import assert from "node:assert/strict";
import test from "node:test";
import { appendConversationThreadEntry, CONVERSATION_ENTRY_KIND } from "@sidecar/realtime";
import { CONVERSATION_KIND, MAIN_SESSION_KEY, threadSessionKey } from "@sidecar/runtime-contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONVERSATION_CONTROL_WORDS } from "#shared/wire/conversation";
import {
  type ConversationControls,
  ConversationHistoryPanel,
  HISTORY_ARCHIVED_NOTE,
  HISTORY_ENTRY_SPEAKER,
  HISTORY_PENDING_LABEL,
  historyEntryPresentation,
} from "./conversation-history-panel";

const MAIN = {
  sessionKey: MAIN_SESSION_KEY,
  kind: CONVERSATION_KIND.MAIN,
  name: "main",
  createdAt: 1,
  lastActivityAt: 1,
} as const;

/** The controls with main alone listed, every operation inert; a test that needs more overrides. */
function controls(overrides: Partial<ConversationControls> = {}): ConversationControls {
  return {
    directory: { entries: [MAIN], archives: [] },
    selected: MAIN_SESSION_KEY,
    onSelect: () => undefined,
    onNewThread: () => undefined,
    onStartFresh: async () => true,
    onArchive: async () => true,
    onUnarchive: async () => true,
    onDeleteHistory: async () => "complete",
    onRestore: async () => "restored",
    ...overrides,
  };
}

test("conversation asks are shown as the developer's own words", () => {
  assert.deepEqual(historyEntryPresentation(CONVERSATION_ENTRY_KIND.TYPED_ASK), {
    speaker: HISTORY_ENTRY_SPEAKER.YOU,
    label: "You",
  });
  assert.deepEqual(historyEntryPresentation(CONVERSATION_ENTRY_KIND.SPOKEN_ASK), {
    speaker: HISTORY_ENTRY_SPEAKER.YOU,
    label: "You",
  });
});

test("Luke replies and announcements use the received-message side", () => {
  assert.deepEqual(historyEntryPresentation(CONVERSATION_ENTRY_KIND.REPLY), {
    speaker: HISTORY_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
  assert.deepEqual(historyEntryPresentation(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT), {
    speaker: HISTORY_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
});

test("session acts remain quiet events between messages", () => {
  assert.equal(
    historyEntryPresentation(CONVERSATION_ENTRY_KIND.ACT).speaker,
    HISTORY_ENTRY_SPEAKER.EVENT,
  );
});

test("an announcement shows its spoken transcript", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
          words: "Checkout is ready.",
        },
      ],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-speaker="luke"/);
  assert.match(markup, />Checkout is ready\.<\/p>/);
  assert.doesNotMatch(markup, /provider:|running:/);
});

test("a reply keeps its lines through the thread and draws as the Markdown it was written in", () => {
  const entries = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Two things:\n\n- **lisbon-v2** is waiting\n- `deploy` finished\n\n```sh\ngit push\n```",
  });
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries,
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /<p>Two things:<\/p>/);
  assert.match(markup, /<li><strong>lisbon-v2<\/strong> is waiting<\/li>/);
  assert.match(markup, /<li><code>deploy<\/code> finished<\/li>/);
  assert.match(markup, /<pre><code class="language-sh">git push\n<\/code><\/pre>/);
});

test("a recorded entry keeps its local time at the row's edge, outside the bubble", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "Checkout is ready.",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The stamp is the row's last child, after the message closes: it stands in
  // the column the thread's sideways scroll brings in, never on a line of the
  // bubble's own, and the thread scrolls on two nested scrollers, one per axis.
  assert.match(
    markup,
    /<\/div><time class="history-time" dateTime="2026-01-02T03:04:00.000Z">[^<]+<\/time><\/li>/,
  );
  assert.match(
    markup,
    /<div class="history-scroll"><div class="history-pull"><ol class="history-list">/,
  );
});

test("conversation history is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /class="history-view ph-no-capture"/);
  assert.match(markup, /<small class="visually-hidden">You<\/small>/);
  assert.doesNotMatch(markup, /stays in memory|typed or spoken exchange/);
});

test("messages offer a copy control while quiet events offer none", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping." },
        { kind: CONVERSATION_ENTRY_KIND.ACT, words: "Sent to Codex." },
      ],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.equal(markup.match(/class="history-copy"/g)?.length, 2);
  assert.match(markup, /aria-label="Copy message"/);
  assert.match(markup, /icon-button-glyph/);
});

test("a line still being said draws as the bubble it will settle into", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
          words: "ship it",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      live: [{ kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Checkout is" }],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-streaming="true"/);
  assert.match(markup, />Checkout is</);
  // Copying half a sentence serves nobody: the settled ask keeps the one
  // copy control, and a line not yet recorded wears no timestamp.
  assert.equal(markup.match(/class="history-copy"/g)?.length, 1);
  assert.equal(markup.match(/class="history-time"/g)?.length, 1);
});

test("words still arriving stand the thread up without a settled line", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      live: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Looking now." }],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />Looking now\.</);
  assert.doesNotMatch(markup, />No messages yet</);
});

test("the empty history reports only its state", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />No messages yet</);
  assert.doesNotMatch(markup, /next typed|stays in memory/);
});

test("the header lists every conversation, archived apart, and its controls say what starting fresh keeps", () => {
  const thread = {
    sessionKey: threadSessionKey("t-1"),
    kind: CONVERSATION_KIND.THREAD,
    name: "Thread 1",
    createdAt: 2,
    lastActivityAt: 2,
  } as const;
  const shelved = {
    ...thread,
    sessionKey: threadSessionKey("t-2"),
    name: "Thread 2",
    archivedAt: 3,
  } as const;
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      conversations: controls({
        directory: {
          entries: [MAIN, thread, shelved],
          archives: [
            {
              archiveId: "a-1",
              sessionKey: MAIN_SESSION_KEY,
              kind: CONVERSATION_KIND.MAIN,
              name: "main",
              createdAt: 1,
              deletedAt: Date.parse("2026-01-02T03:04:00.000Z"),
              encoding: "zstd",
              sha256: "00",
              byteLength: 10,
              fileName: "agent_main_main.jsonl.deleted.x.zst",
              publishedAt: 5,
              historyLines: 4,
              transcriptEvents: 9,
            },
          ],
        },
      }),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(
    markup,
    /<optgroup label="Conversations"><option[^>]*>Main<\/option><option[^>]*>Thread 1<\/option>/,
  );
  assert.match(markup, /<optgroup label="Archived"><option[^>]*>Thread 2<\/option>/);
  assert.match(markup, new RegExp(CONVERSATION_CONTROL_WORDS.START_FRESH));
  assert.match(markup, new RegExp(CONVERSATION_CONTROL_WORDS.NEW_THREAD));
  assert.match(markup, new RegExp(CONVERSATION_CONTROL_WORDS.DELETE_HISTORY));
  assert.match(markup, new RegExp(CONVERSATION_CONTROL_WORDS.RESTORE));
  // Main cannot be archived, and the old Clear is nowhere.
  assert.doesNotMatch(markup, />Archive<|>Clear</);
  // The archive list says how many lines it holds, never what they said.
  assert.match(markup, /4 lines/);
  // Everything, the selector and the archive list included, rides inside the blocked subtree.
  assert.ok(markup.indexOf("ph-no-capture") < markup.indexOf("history-select"));
});

test("an archived conversation shows its thread read-only, with no composer", () => {
  const shelved = {
    sessionKey: threadSessionKey("t-2"),
    kind: CONVERSATION_KIND.THREAD,
    name: "Thread 2",
    createdAt: 2,
    lastActivityAt: 2,
    archivedAt: 3,
  } as const;
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "kept" }],
      conversations: controls({
        directory: { entries: [MAIN, shelved], archives: [] },
        selected: shelved.sessionKey,
      }),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(markup, />kept</);
  assert.match(markup, new RegExp(HISTORY_ARCHIVED_NOTE));
  assert.match(markup, new RegExp(CONVERSATION_CONTROL_WORDS.UNARCHIVE));
  assert.doesNotMatch(markup, /id="ask-luke-input"/);
});

test("the composer stands at the foot of the thread, empty or not", () => {
  const empty = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  // "What needs me?" is worth typing before any line has been recorded.
  assert.match(empty, />No messages yet</);
  assert.match(empty, /id="ask-luke-input"/);

  const threaded = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" }],
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      askShortcut: "Alt+Space",
    }),
  );
  // One composer, after the list, inside the subtree recordings never see.
  assert.equal(threaded.match(/id="ask-luke-input"/g)?.length, 1);
  assert.ok(threaded.indexOf("</ol>") < threaded.indexOf('id="ask-luke-input"'));
  assert.match(threaded, /aria-keyshortcuts="Alt\+Space"/);
});

test("an ask whose run is still going waits beside its words and offers a cancel", () => {
  const cancelled: string[] = [];
  const run = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: "typed",
    question: "ship it",
    revision: 1,
    acceptedAt: 1,
    performedActs: 0,
    unknownActs: 0,
  } as const;
  const render = (status: "running" | "succeeded") =>
    renderToStaticMarkup(
      createElement(ConversationHistoryPanel, {
        entries: [
          { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it", requestId: "run-1" },
        ],
        requests: [{ ...run, status }],
        onCancelRequest: (runId) => cancelled.push(runId),
        conversations: controls(),
        ask: async () => undefined,
        onAskEngaged: () => undefined,
      }),
    );
  const pending = render("running");
  assert.match(pending, new RegExp(HISTORY_PENDING_LABEL));
  assert.match(pending, /class="history-cancel"/);
  // The wait stands beneath the words, inside the bubble, after the question's
  // own paragraph: the bubble stacks, so the status never shares the row.
  assert.match(pending, /<\/p><\/div><span class="history-pending" role="status">/);
  // Still inside the blocked subtree: a wait is drawn beside words a recording never sees.
  assert.match(pending, /ph-no-capture/);
  const settled = render("succeeded");
  assert.doesNotMatch(settled, /history-cancel|history-pending/);
  // A spoken ask is the same lifecycle: its transcript, tied to its run, waits too.
  const spoken = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "ship it", requestId: "run-1" }],
      requests: [{ ...run, origin: "spoken", status: "running" }],
      onCancelRequest: (runId) => cancelled.push(runId),
      conversations: controls(),
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(spoken, /class="history-cancel"/);
});
