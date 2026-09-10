import assert from "node:assert/strict";
import test from "node:test";
import { appendConversationThreadEntry, CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CONVERSATION_ENTRY_SPEAKER,
  CONVERSATION_LISTENING_LABEL,
  CONVERSATION_THINKING_LABEL,
  ConversationClearButton,
  ConversationPanel,
  conversationEntryPresentation,
  thinkingElapsedLabel,
} from "./conversation-panel";

const NOW = Date.parse("2026-09-08T17:30:00.000Z");
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

test("conversation asks are shown as the developer's own words", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.TYPED_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.SPOKEN_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
});

test("Luke replies and announcements use the received-message side", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.REPLY), {
    speaker: CONVERSATION_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT), {
    speaker: CONVERSATION_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
});

test("session actions remain quiet events between messages", () => {
  assert.equal(
    conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ACTION).speaker,
    CONVERSATION_ENTRY_SPEAKER.EVENT,
  );
});

test("an action Luke took on his own judgment is drawn as his own line, never as the developer's request", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.OWN_ACTION), {
    speaker: CONVERSATION_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
});

test("an announcement shows its spoken transcript", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
          words: "Checkout is ready.",
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-speaker="luke"/);
  assert.match(markup, />Checkout is ready\.<\/p>/);
  assert.doesNotMatch(markup, /provider:|running:/);
});

test("a spoken turn still owed its words holds a sent bubble in the thread", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      spokenAskPending: true,
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The wait alone is a thread: a press into an empty conversation must be
  // answered on screen, not by the empty state.
  assert.match(markup, /data-speaker="you"/);
  assert.match(markup, /conversation-listening/);
  assert.match(markup, new RegExp(CONVERSATION_LISTENING_LABEL));
  assert.doesNotMatch(markup, /No messages yet/);

  const idle = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      spokenAskPending: false,
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.doesNotMatch(idle, /conversation-listening/);
});

test("a reply keeps its lines through the thread and draws as the Markdown it was written in", () => {
  const entries = appendConversationThreadEntry([], {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: "Two things:\n\n- **lisbon-v2** is waiting\n- `deploy` finished\n\n```sh\ngit push\n```",
  });
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries,
      now: NOW,
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
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "Checkout is ready.",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The stamp is the row's last child, after the message closes: it stands in
  // the column the thread's sideways scroll brings in, never on a line of the
  // bubble's own, and the thread scrolls on two nested scrollers, one per axis.
  assert.match(
    markup,
    /<\/div><time class="conversation-time" dateTime="2026-01-02T03:04:00.000Z">[^<]+<\/time><\/li>/,
  );
  assert.match(
    markup,
    /<div class="conversation-scroll"><div class="conversation-pull"><ol class="conversation-list">/,
  );
});

test("the conversation is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /class="conversation-view ph-no-capture"/);
  assert.match(markup, /<small class="visually-hidden">You<\/small>/);
  assert.doesNotMatch(markup, /stays in memory|typed or spoken exchange/);
});

test("messages offer a copy control while quiet events offer none", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping." },
        { kind: CONVERSATION_ENTRY_KIND.ACTION, words: "Sent to Codex." },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 2);
  assert.match(markup, /aria-label="Copy message"/);
  assert.match(markup, /icon-button-glyph/);
});

test("a line still being said draws as the bubble it will settle into", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
          words: "ship it",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      live: [{ kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Checkout is" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, /data-streaming="true"/);
  assert.match(markup, />Checkout is</);
  // Copying half a sentence serves nobody: the settled ask keeps the one
  // copy control, and a line not yet recorded wears no timestamp.
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 1);
  assert.equal(markup.match(/class="conversation-time"/g)?.length, 1);
});

test("words still arriving stand the thread up without a settled line", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      live: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Looking now." }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />Looking now\.</);
  assert.doesNotMatch(markup, />No messages yet</);
  // The clear rides the tab bar beside the panel, never a row of the thread's own.
  assert.doesNotMatch(markup, /conversation-clear/);
});

test("the empty conversation reports only its state", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.match(markup, />No messages yet</);
  assert.doesNotMatch(markup, /conversation-clear|next typed|stays in memory/);
});

test("the clear control opens as one quiet button, its confirmation not yet asked", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationClearButton, { onClear: () => undefined }),
  );

  assert.match(markup, /<span class="conversation-clear-controls">/);
  assert.match(markup, /class="conversation-clear"[^>]*>Clear</);
  // The second press's words, and the way to stand down, arrive only with the
  // first press.
  assert.doesNotMatch(markup, /conversation-clear-cancel|Clear conversation/);
});

test("the composer stands at the foot of the thread, empty or not", () => {
  const empty = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  // "What needs me?" is worth typing before any line has been recorded.
  assert.match(empty, />No messages yet</);
  assert.match(empty, /id="ask-luke-input"/);

  const threaded = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" }],
      now: NOW,
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

test("a run still going draws Luke's turn at the tail, with no control of its own", () => {
  const run = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: "typed",
    question: "ship it",
    revision: 1,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
  } as const;
  const render = (status: "running" | "succeeded", now = NOW) =>
    renderToStaticMarkup(
      createElement(ConversationPanel, {
        entries: [
          { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it", requestId: "run-1" },
        ],
        requests: [{ ...run, status }],
        now,
        ask: async () => undefined,
        onAskEngaged: () => undefined,
        onStop: () => undefined,
      }),
    );
  const pending = render("running");
  // Luke's side, after the ask, wearing the success hop on repeat, with the
  // reader's line as the live region and nothing to press.
  assert.match(pending, /data-speaker="luke" data-thinking="true"/);
  assert.match(pending, /<\/li><li class="conversation-entry" data-speaker="luke" data-thinking/);
  assert.match(pending, /class="conversation-thinking"/);
  assert.match(pending, /data-motion="success" data-repeat="true"/);
  // The dots are the shared drawing the notch strip rides beside the same hop.
  assert.match(pending, /class="thinking-dots" aria-hidden="true"><i><\/i><i><\/i><i><\/i>/);
  assert.match(pending, new RegExp(`role="status">${CONVERSATION_THINKING_LABEL}`));
  assert.doesNotMatch(pending, /conversation-cancel|conversation-pending|Cancel/);
  // Under ten seconds the wait says nothing of its age; past it, how long.
  assert.doesNotMatch(pending, /Still thinking/);
  assert.match(render("running", NOW + 71_000), /Still thinking · 1:11/);
  // Still inside the blocked subtree: a wait is drawn beside words a recording never sees.
  assert.match(pending, /ph-no-capture/);
  // The composer's disc is the stop, in both of its states.
  assert.match(pending, /data-turn="luke"/);
  assert.match(pending, /aria-label="Stop Luke&#x27;s reply"/);
  const settled = render("succeeded");
  assert.doesNotMatch(settled, /conversation-thinking|data-thinking/);
  // A spoken ask is the same lifecycle: its transcript, tied to its run, waits too.
  const spoken = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words: "ship it", requestId: "run-1" }],
      requests: [{ ...run, origin: "spoken", status: "running" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.match(spoken, /class="conversation-thinking"/);
});

test("the wait's age is worded once it is worth a word", () => {
  assert.equal(thinkingElapsedLabel(NOW, NOW + 9_999), undefined);
  assert.equal(thinkingElapsedLabel(NOW, NOW + 10_000), "Still thinking · 0:10");
  assert.equal(thinkingElapsedLabel(NOW, NOW + 605_000), "Still thinking · 10:05");
});

test("a line that followed a long silence is dated over it, in the quiet event voice", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it", recordedAt: NOW - 9 * DAY_MS },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping.", recordedAt: NOW - 9 * DAY_MS },
        {
          kind: CONVERSATION_ENTRY_KIND.ACTION,
          words: "Sent to Codex.",
          recordedAt: NOW - 2 * DAY_MS,
        },
        {
          kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
          words: "status?",
          recordedAt: NOW - HOUR_MS / 2,
        },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Quiet.", recordedAt: NOW - HOUR_MS / 4 },
      ],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  // The first recorded line is dated, then every line an hour or more after
  // the one before it; a reply half an hour on answers the ask and draws none.
  const breaks = [...markup.matchAll(/<li class="conversation-break">/g)];
  assert.equal(breaks.length, 3);
  assert.ok(
    markup.indexOf('<li class="conversation-break">') < markup.indexOf("conversation-entry"),
  );
  const dates = [...markup.matchAll(/dateTime="([^"]+)"[^>]*><strong>([^<]+)<\/strong>/g)].map(
    (match) => [match[1], match[2]],
  );
  assert.deepEqual(dates, [
    [
      new Date(NOW - 9 * DAY_MS).toISOString(),
      new Date(NOW - 9 * DAY_MS).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ],
    [
      new Date(NOW - 2 * DAY_MS).toISOString(),
      new Date(NOW - 2 * DAY_MS).toLocaleDateString(undefined, { weekday: "long" }),
    ],
    [new Date(NOW - HOUR_MS / 2).toISOString(), "Today"],
  ]);
  // The date is the thread's own line, never a message: no bubble, no copy control.
  assert.match(
    markup,
    /<li class="conversation-break"><time class="conversation-break-time" dateTime="[^"]+"><strong>/,
  );
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 4);
});

test("lines with no stamp draw no date over them", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      entries: [
        { kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "ship it" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Shipping." },
      ],
      live: [{ kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Still" }],
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );

  assert.doesNotMatch(markup, /conversation-break/);
});
