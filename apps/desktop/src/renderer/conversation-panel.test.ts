import assert from "node:assert/strict";
import { CONVERSATION_ENTRY_KIND, type ConversationViewTurnGroup } from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  ConversationPanel,
  conversationDistanceFromTail,
  followsConversationTail,
} from "./conversation-panel";
import { thinkingElapsedLabel } from "./conversation-rows";
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
    live: [
      {
        entry: { kind: CONVERSATION_ENTRY_KIND.ANNOUNCEMENT, words: "Checkout is" },
        at: undefined,
      },
    ],
  });
  assert.equal(count(streaming, '<ol class="conversation-list">'), 1);
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
  assert.equal(
    count(streaming, 'class="conversation-more-button"'),
    count(settled, 'class="conversation-more-button"'),
  );
  // The streaming row stands after the last stored row and before the list closes.
  assert.ok(
    streaming.lastIndexOf('data-streaming="true"') >
      streaming.lastIndexOf('class="conversation-time"'),
  );
  assert.ok(streaming.lastIndexOf('data-streaming="true"') < streaming.lastIndexOf("</ol>"));
});

test("a line still being said stands where its row will land: ahead of the turns placed after its instant, and after the last turn when no instant is known", () => {
  const [firstTurn, secondTurn] = fixtureConversationTurns();
  assert.ok(firstTurn && secondTurn);
  const secondAt = Math.min(...secondTurn.messages.map((message) => message.placedAt));
  const markup = render([firstTurn, secondTurn], {
    live: [
      { entry: { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Placed later" }, at: undefined },
      { entry: { kind: CONVERSATION_ENTRY_KIND.ASK, words: "Placed between" }, at: secondAt - 1 },
    ],
  });
  const entries = [...markup.matchAll(/class="conversation-entry/g)].map((match) => match.index);
  const between = markup.indexOf("Placed between");
  const later = markup.indexOf("Placed later");
  assert.ok(between >= 0 && later >= 0);
  // The one with an instant is drawn after exactly the first turn's rows; the one without is the last row of the thread.
  const firstTurnRows = count(render([firstTurn]), 'class="conversation-entry');
  assert.equal(entries.filter((index) => index < between).length, firstTurnRows + 1);
  assert.equal(entries.at(-1), entries.filter((index) => index < later).at(-1));
  assert.ok(later < markup.lastIndexOf("</ol>"));
});

test("the thread draws no text input, empty or not: Luke is voice only", () => {
  for (const markup of [render(SINGLE_TURN), render([])]) {
    assert.equal(markup.match(/<(textarea|input|form)\b/g), null);
  }
  assert.equal(count(render([]), 'class="conversation-empty"'), 1);
});

test("before the first read lands an empty thread claims nothing", () => {
  const unread = renderToStaticMarkup(
    createElement(ConversationPanel, {
      view: { groups: [], settled: false },
      now: NOW,
    }),
  );
  assert.equal(count(unread, 'class="conversation-empty"'), 0);
  assert.equal(count(unread, "<ol class="), 0);
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
    }),
  );
  assert.equal(count(markup, 'class="conversation-notice"'), 1);
  assert.equal(count(render(SINGLE_TURN), 'class="conversation-notice"'), 0);
  // The thread still draws the turn it last read.
  assert.equal(count(markup, '<ol class="conversation-list">'), 1);
});

test("the wait's age is worded once it is worth a word", () => {
  assert.equal(thinkingElapsedLabel(NOW, NOW + 9_999), undefined);
  assert.equal(thinkingElapsedLabel(NOW, NOW + 10_000), "Still thinking · 0:10");
  assert.equal(thinkingElapsedLabel(NOW, NOW + 605_000), "Still thinking · 10:05");
});

test("the thread counts a reader as following while they are at or near its tail", () => {
  assert.equal(
    conversationDistanceFromTail({ scrollTop: 320, scrollHeight: 640, clientHeight: 320 }),
    0,
  );
  assert.equal(
    conversationDistanceFromTail({ scrollTop: 280, scrollHeight: 640, clientHeight: 320 }),
    40,
  );
  assert.equal(
    followsConversationTail({ scrollTop: 592, scrollHeight: 960, clientHeight: 320 }),
    true,
  );
  assert.equal(
    followsConversationTail({ scrollTop: 560, scrollHeight: 960, clientHeight: 320 }),
    false,
  );
});
