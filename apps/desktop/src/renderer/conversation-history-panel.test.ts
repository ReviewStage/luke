import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/realtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConversationHistoryPanel,
  HISTORY_ENTRY_SPEAKER,
  historyEntryPresentation,
} from "./conversation-history-panel";

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
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
    }),
  );

  assert.match(markup, /data-speaker="luke"/);
  assert.match(markup, />Checkout is ready\.<\/p>/);
  assert.doesNotMatch(markup, /provider:|work recap:/);
});

test("a recorded entry shows its local time", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "Checkout is ready.",
          recordedAt: Date.parse("2026-01-02T03:04:00.000Z"),
        },
      ],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
    }),
  );

  assert.match(
    markup,
    /<time class="history-time" dateTime="2026-01-02T03:04:00.000Z">[^<]+<\/time>/,
  );
});

test("conversation history is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
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
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
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
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
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
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
    }),
  );

  assert.match(markup, />Looking now\.</);
  assert.doesNotMatch(markup, />No messages yet</);
  // Clear retires recorded lines, and nothing here is recorded yet.
  assert.doesNotMatch(markup, /history-header/);
});

test("the empty history reports only its state", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
    }),
  );

  assert.match(markup, />No messages yet</);
  assert.doesNotMatch(markup, /history-header|next typed|stays in memory/);
});

test("a line's named chats draw pressable chips, worded as recorded", () => {
  const asked: string[] = [];
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "checkout-service is done and billing-service is waiting.",
          mentions: [
            {
              providerId: "conductor",
              providerSessionId: "chat-1",
              title: "checkout-service",
              markId: "claude-code",
              applications: [{ id: "conductor", name: "Conductor" }],
            },
            {
              providerId: "conductor",
              providerSessionId: "chat-2",
              title: "billing-service",
              markId: "conductor",
              applications: [],
            },
          ],
        },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "No session here." },
      ],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: (identity) => {
        asked.push(identity.providerSessionId);
        return true;
      },
      onOpenSession: () => undefined,
    }),
  );

  assert.equal(markup.match(/class="history-chip"/g)?.length, 2);
  assert.match(markup, /aria-label="Open checkout-service"/);
  assert.match(markup, /aria-label="Open billing-service"/);
  // The chip leads with the agent's mark and trails the app marks its chat's
  // row wore when the line was recorded, exactly like the notice band's.
  assert.match(markup, /data-mark="claude-code"/);
  assert.match(markup, /aria-label="Also in Conductor"/);
  // Only the chats the line named ask whether they can still be opened, and
  // the session ids themselves stay out of the drawn markup.
  assert.deepEqual(asked, ["chat-1", "chat-2"]);
  assert.doesNotMatch(markup, /chat-1|chat-2/);
});

test("a chat with nowhere to go draws no chip", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
          words: "Local run finished.",
          identity: { providerId: "claude-code", providerSessionId: "local-1" },
          mentions: [
            {
              providerId: "claude-code",
              providerSessionId: "local-1",
              title: "local-run",
              markId: "claude-code",
              applications: [],
            },
          ],
        },
      ],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
    }),
  );

  assert.doesNotMatch(markup, /history-chip|history-mentions/);
});

test("a quiet act line draws its chat's chip without a copy control", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ACT,
          words: "sent Checkout a message.",
          identity: { providerId: "conductor", providerSessionId: "chat-1" },
          mentions: [
            {
              providerId: "conductor",
              providerSessionId: "chat-1",
              title: "Checkout",
              markId: "conductor",
              applications: [],
            },
          ],
        },
      ],
      onClear: () => undefined,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      openable: () => true,
      onOpenSession: () => undefined,
    }),
  );

  assert.match(markup, /class="history-chip"/);
  assert.doesNotMatch(markup, /history-copy/);
});

test("the composer stands at the foot of the thread, empty or not", () => {
  const empty = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      onClear: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
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
      onClear: () => undefined,
      openable: () => false,
      onOpenSession: () => undefined,
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
