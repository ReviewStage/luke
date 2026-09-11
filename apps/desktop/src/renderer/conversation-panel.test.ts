import assert from "node:assert/strict";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  CONVERSATION_ENTRY_SPEAKER,
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
  // Copying half a sentence serves nobody: the settled ask keeps the one
  // copy control, and a line not yet recorded wears no timestamp.
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 1);
  assert.equal(markup.match(/class="conversation-time"/g)?.length, 1);
});

test("the composer stands at the foot of the thread, empty or not", () => {
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
  assert.equal(markup.match(/class="conversation-copy"/g)?.length, 4);
});
