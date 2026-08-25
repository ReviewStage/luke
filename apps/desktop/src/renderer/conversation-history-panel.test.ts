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

test("Luke replies and non-dialogue events stay distinct", () => {
  assert.deepEqual(historyEntryPresentation(CONVERSATION_ENTRY_KIND.REPLY), {
    speaker: HISTORY_ENTRY_SPEAKER.LUKE,
    label: "Luke",
  });
  assert.equal(
    historyEntryPresentation(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT).speaker,
    HISTORY_ENTRY_SPEAKER.EVENT,
  );
  assert.equal(
    historyEntryPresentation(CONVERSATION_ENTRY_KIND.ACT).speaker,
    HISTORY_ENTRY_SPEAKER.EVENT,
  );
});

test("conversation history is blocked from optional panel recordings", () => {
  const markup = renderToStaticMarkup(
    createElement(ConversationHistoryPanel, {
      entries: [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "private words" }],
      onClear: () => undefined,
    }),
  );

  assert.match(markup, /class="history-view ph-no-capture"/);
});
