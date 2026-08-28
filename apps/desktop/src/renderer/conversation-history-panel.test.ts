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

test("an announcement shows its readable copy instead of model context", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [
        {
          kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT,
          words: 'provider: "Codex"; event: finished; work recap: "Checkout is ready."',
          displayWords: "Checkout is ready.",
        },
      ],
      onClear: () => undefined,
    }),
  );

  assert.match(markup, /data-speaker="luke"/);
  assert.match(markup, />Checkout is ready\.<\/p>/);
  assert.doesNotMatch(markup, /provider:|work recap:/);
});

test("conversation history is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      onClear: () => undefined,
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
    }),
  );

  assert.equal(markup.match(/class="history-copy"/g)?.length, 2);
  assert.match(markup, /aria-label="Copy message"/);
  assert.match(markup, /icon-button-glyph/);
});

test("the empty history reports only its state", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [],
      onClear: () => undefined,
    }),
  );

  assert.match(markup, />No messages yet</);
  assert.doesNotMatch(markup, /history-header|next typed|stays in memory/);
});
