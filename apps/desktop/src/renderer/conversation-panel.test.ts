import assert from "node:assert/strict";
import { CONVERSATION_ENTRY_KIND, type ConversationViewTurnGroup } from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ConversationPanel, conversationEntryPresentation } from "./conversation-panel";
import { CONVERSATION_ENTRY_SPEAKER, thinkingElapsedLabel } from "./conversation-rows";
import {
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_TURN,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";

const NOW = FIXTURE_NOW;

function render(
  groups: readonly ConversationViewTurnGroup[],
  extra: Partial<Parameters<typeof ConversationPanel>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(ConversationPanel, {
      view: { groups, settled: true },
      roster: FIXTURE_ROSTER,
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
      ...extra,
    }),
  );
}

/** How many times one fixed attribute or class the renderer stamps appears; a structural count, never a phrase. */
function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

const SINGLE_TURN = fixtureConversationTurns().filter(
  (group) => group.turnId === FIXTURE_TURN.SINGLE,
);

test("a line still being said is shown in the developer's or Luke's voice by its kind", () => {
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.TYPED_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
  assert.deepEqual(conversationEntryPresentation(CONVERSATION_ENTRY_KIND.SPOKEN_ASK), {
    speaker: CONVERSATION_ENTRY_SPEAKER.YOU,
    label: "You",
  });
  assert.equal(
    conversationEntryPresentation(CONVERSATION_ENTRY_KIND.REPLY).speaker,
    CONVERSATION_ENTRY_SPEAKER.LUKE,
  );
  assert.equal(
    conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ANNOUNCEMENT).speaker,
    CONVERSATION_ENTRY_SPEAKER.LUKE,
  );
  assert.equal(
    conversationEntryPresentation(CONVERSATION_ENTRY_KIND.OWN_ACTION).speaker,
    CONVERSATION_ENTRY_SPEAKER.LUKE,
  );
  assert.equal(
    conversationEntryPresentation(CONVERSATION_ENTRY_KIND.ACTION).speaker,
    CONVERSATION_ENTRY_SPEAKER.EVENT,
  );
});

test("the stored turns are mounted inside the one subtree the session recording blocks", () => {
  const markup = render(fixtureConversationTurns());
  const root = markup.indexOf('class="conversation-view ph-no-capture"');
  const list = markup.indexOf('<ol class="conversation-list">');
  assert.ok(root >= 0);
  assert.ok(list > root);
  // One list under the one root: every action chip and bubble the turns draw is inside it.
  assert.equal(count(markup, 'class="conversation-view'), 1);
  assert.equal(count(markup, '<ol class="conversation-list">'), 1);
  assert.equal(
    count(markup, "conversation-action-chip"),
    count(render(fixtureConversationTurns()), "conversation-action-chip"),
  );
  assert.ok(count(markup, "conversation-action-chip") > 0);
});

test("a line still being said joins the same list as the stored turns, without a stamp or a copy", () => {
  const settled = render(SINGLE_TURN);
  const streaming = render(SINGLE_TURN, {
    live: [{ kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Checkout is" }],
  });
  assert.equal(count(streaming, "<ol class="), 1);
  assert.equal(count(streaming, 'data-streaming="true"'), 1);
  // The stored turn keeps its stamps and copies; the streaming line adds none.
  assert.equal(
    count(streaming, 'class="conversation-time"'),
    count(settled, 'class="conversation-time"'),
  );
  assert.equal(
    count(streaming, 'class="conversation-copy"'),
    count(settled, 'class="conversation-copy"'),
  );
  // The streaming row stands after the last stored row and before the list closes.
  assert.ok(
    streaming.lastIndexOf('data-streaming="true"') >
      streaming.lastIndexOf('class="conversation-time"'),
  );
  assert.ok(streaming.lastIndexOf('data-streaming="true"') < streaming.indexOf("</ol>"));
});

test("the composer stands at the foot of the thread, empty or not", () => {
  const threaded = render(SINGLE_TURN, { askShortcut: "Alt+Space" });
  // One composer, after the list, inside the subtree recordings never see.
  assert.equal(count(threaded, 'id="ask-luke-input"'), 1);
  assert.ok(threaded.indexOf("</ol>") < threaded.indexOf('id="ask-luke-input"'));
  const empty = render([]);
  assert.equal(count(empty, 'id="ask-luke-input"'), 1);
  assert.equal(count(empty, 'class="conversation-empty"'), 1);
});

test("before the first read lands an empty thread claims nothing", () => {
  const unread = renderToStaticMarkup(
    createElement(ConversationPanel, {
      view: { groups: [], settled: false },
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.equal(count(unread, 'class="conversation-empty"'), 0);
  assert.equal(count(unread, "<ol class="), 0);
  assert.equal(count(unread, 'id="ask-luke-input"'), 1);
});

test("a row the service could not read back is said once, under the thread as it last stood", () => {
  const view = {
    groups: SINGLE_TURN,
    settled: true,
    unreadable: { conversationId: "3c000000-0000-4000-8000-000000000001", seq: 4 },
  };
  const markup = renderToStaticMarkup(
    createElement(ConversationPanel, {
      view,
      now: NOW,
      ask: async () => undefined,
      onAskEngaged: () => undefined,
    }),
  );
  assert.equal(count(markup, 'class="conversation-notice"'), 1);
  assert.equal(count(render(SINGLE_TURN), 'class="conversation-notice"'), 0);
  // The thread still draws the turn it last read.
  assert.equal(count(markup, "<ol class="), 1);
});

test("the wait's age is worded once it is worth a word", () => {
  assert.equal(thinkingElapsedLabel(NOW, NOW + 9_999), undefined);
  assert.equal(thinkingElapsedLabel(NOW, NOW + 10_000), "Still thinking · 0:10");
  assert.equal(thinkingElapsedLabel(NOW, NOW + 605_000), "Still thinking · 10:05");
});
