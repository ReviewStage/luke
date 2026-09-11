import assert from "node:assert/strict";
import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewTurnGroup,
  isStoredToolPart,
  MESSAGE_ROLE,
  type SessionIdentity,
  selectConversationView,
} from "@sidecar/session";
import { CONVERSATION_EVENT_KIND, TURN_ORIGIN, TURN_STATUS } from "@sidecar/wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_ROW_STATUS, toolRow } from "./conversation-tool-row";
import {
  announcedWords,
  ConversationTurns,
  detailToolLabel,
  foldOpen,
  judgmentOf,
  turnPending,
} from "./conversation-turns";
import {
  FIXTURE_INPUT,
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_TURN,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";

const OPEN = (identity: SessionIdentity) => void identity;

function render(
  groups: readonly ConversationViewTurnGroup[],
  onOpenChat?: (identity: SessionIdentity) => void,
) {
  return renderToStaticMarkup(
    createElement(ConversationTurns, {
      groups,
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      ...(onOpenChat ? { onOpenChat } : undefined),
    }),
  );
}

/** How many times one fixed attribute the renderer stamps appears; a structural count, never a phrase. */
function count(markup: string, attribute: string, value: string): number {
  return markup.split(`${attribute}="${value}"`).length - 1;
}

const FOLD_OPENING = '<details class="conversation-turn-details"';

test("the fixture scenarios draw every session action kind as a row", () => {
  const markup = render(fixtureConversationTurns(), OPEN);
  const kinds = new Set<string>();
  for (const match of markup.matchAll(/data-action-kind="([^"]+)"/g)) {
    if (match[1] !== undefined) kinds.add(match[1]);
  }
  assert.deepEqual([...kinds].sort(), [
    "add-agent",
    "control",
    "create-workspace",
    "message",
    "open",
    "rename-session",
    "rename-workspace",
  ]);
  // Both the accepted actions and the three other outcomes stand in the thread.
  assert.ok(count(markup, "data-tool-status", TOOL_ROW_STATUS.ACCEPTED) >= 7);
  assert.equal(count(markup, "data-tool-status", TOOL_ROW_STATUS.REFUSED), 1);
  assert.equal(count(markup, "data-tool-status", TOOL_ROW_STATUS.UNKNOWN), 1);
  // One pending call in the refused turn, and one in the turn still running.
  assert.equal(count(markup, "data-tool-status", TOOL_ROW_STATUS.PENDING), 2);
});

test("a chip is a press exactly where the composition says the session opens, and a name everywhere else", () => {
  const groups = fixtureConversationTurns();
  const chips = groups
    .flatMap((group) => group.messages)
    .flatMap((view) =>
      view.message.role === MESSAGE_ROLE.ASSISTANT
        ? view.message.parts.filter(isStoredToolPart).flatMap((part) => {
            const row = toolRow(part, FIXTURE_ROSTER);
            return row ? row.runs.flatMap((run) => ("chip" in run ? [run.chip] : [])) : [];
          })
        : [],
    );
  const pressable = chips.filter((chip) => chip.identity !== undefined && chip.openable).length;
  assert.ok(pressable > 0 && pressable < chips.length);

  const withPress = render(groups, OPEN);
  assert.equal(
    count(withPress, "class", "conversation-action-chip") -
      withPress.split('<button type="button" class="conversation-action-chip"').length +
      1,
    chips.length - pressable,
  );
  assert.equal(
    withPress.split('<button type="button" class="conversation-action-chip"').length - 1,
    pressable,
  );

  // With nothing to hand a press to, every chip is a name.
  const withoutPress = render(groups);
  assert.equal(
    withoutPress.split('<button type="button" class="conversation-action-chip"').length - 1,
    0,
  );
  assert.equal(count(withoutPress, "class", "conversation-action-chip"), chips.length);
});

test("a refused action and the turn's details draw only inside the turn's fold", () => {
  const groups = fixtureConversationTurns();
  const folded = groups.filter((group) =>
    group.messages.some((view) =>
      view.tools.some(
        (tool) =>
          tool.kind === CONVERSATION_VIEW_TOOL_KIND.DETAIL ||
          (tool.kind === CONVERSATION_VIEW_TOOL_KIND.ACTION &&
            tool.outcome === CONVERSATION_VIEW_ACTION_OUTCOME.REFUSED),
      ),
    ),
  );
  assert.equal(folded.length, 2);
  for (const group of folded) {
    const markup = render([group], OPEN);
    assert.equal(count(markup, "data-folded", "true"), 1);
    const [aboveFold, insideFold] = markup.split(FOLD_OPENING);
    assert.ok(aboveFold !== undefined && insideFold !== undefined);
    assert.equal(count(aboveFold, "data-tool-status", TOOL_ROW_STATUS.FAILED), 0);
    assert.equal(count(aboveFold, "class", "conversation-detail"), 0);
    const failedActions = group.messages
      .flatMap((view) => view.tools)
      .filter(
        (tool) =>
          tool.kind === CONVERSATION_VIEW_TOOL_KIND.ACTION &&
          tool.outcome === CONVERSATION_VIEW_ACTION_OUTCOME.REFUSED,
      ).length;
    const details = group.messages
      .flatMap((view) => view.tools)
      .filter((tool) => tool.kind === CONVERSATION_VIEW_TOOL_KIND.DETAIL).length;
    assert.equal(count(insideFold, "data-tool-status", TOOL_ROW_STATUS.FAILED), failedActions);
    assert.equal(count(insideFold, "class", "conversation-detail"), details);
  }
  const unfolded = groups.filter((group) => !folded.includes(group));
  assert.ok(unfolded.length > 0);
  assert.equal(count(render(unfolded, OPEN), "data-folded", "true"), 0);
});

function groupOf(turnId: string): ConversationViewTurnGroup {
  const group = fixtureConversationTurns().find((candidate) => candidate.turnId === turnId);
  assert.ok(group);
  return group;
}

/** The action rows a rendering draws, top level or inside a fold alike. */
function actionRows(markup: string): number {
  return (markup.match(/data-action-kind="/g) ?? []).length;
}

test("a turn's actions fold under a count once there are two: open while it runs, closed once settled", () => {
  const running = render([groupOf(FIXTURE_TURN.RUNNING)], OPEN);
  assert.equal(count(running, "data-actions-fold", "running"), 1);
  assert.equal(count(running, "data-actions-fold", "settled"), 0);
  assert.equal((running.match(/<details class="conversation-actions-fold" open/g) ?? []).length, 1);
  assert.equal(actionRows(running), 3);

  // Inside the fold the rows carry no stamp of their own; the fold's line carries the turn's.
  const [, insideRunning] = running.split('<details class="conversation-actions-fold"');
  assert.ok(insideRunning !== undefined);
  const [foldBody] = insideRunning.split("</details>");
  assert.ok(foldBody !== undefined);
  assert.equal(count(foldBody, "class", "conversation-time"), 0);
  assert.equal(count(running, "class", "conversation-time"), 2);

  const settled = render([groupOf(FIXTURE_TURN.EVERY_KIND)], OPEN);
  assert.equal(count(settled, "data-actions-fold", "settled"), 1);
  assert.equal((settled.match(/<details class="conversation-actions-fold" open/g) ?? []).length, 0);
  assert.equal((settled.match(/<details class="conversation-actions-fold"/g) ?? []).length, 1);
  assert.equal(actionRows(settled), 9);
  // The fold stands where the first action stood: after the ask and before the reply.
  const [beforeFold, afterFold] = settled.split('<details class="conversation-actions-fold"');
  assert.ok(beforeFold !== undefined && afterFold !== undefined);
  assert.equal(count(beforeFold, "data-speaker", "you"), 1);
  assert.equal(actionRows(beforeFold), 0);
  assert.equal(count(afterFold, "data-speaker", "luke"), 1);
});

test("a fold follows the turn's state, and a press holds only until that state next changes", () => {
  assert.equal(foldOpen(undefined, true), true);
  assert.equal(foldOpen(undefined, false), false);
  // Pressed closed while running: held closed while it still runs.
  assert.equal(foldOpen({ pending: true, open: false }, true), false);
  // Pressed open once settled: held open while it stays settled.
  assert.equal(foldOpen({ pending: false, open: true }, false), true);
  // The turn settled after the press: the turn's own word is the later one, and the fold closes.
  assert.equal(foldOpen({ pending: true, open: true }, false), false);
  assert.equal(foldOpen({ pending: true, open: false }, false), false);
  // And a press made while settled does not reopen a fold for a turn that started running again.
  assert.equal(foldOpen({ pending: false, open: false }, true), true);
});

test("a turn of one action draws the row itself, with no fold and no wait", () => {
  const markup = render([groupOf(FIXTURE_TURN.SINGLE)], OPEN);
  assert.equal((markup.match(/data-actions-fold=/g) ?? []).length, 0);
  assert.equal(actionRows(markup), 1);
  assert.equal(count(markup, "data-thinking", "true"), 0);
  assert.equal(count(markup, "data-judgment", "ask"), 1);
});

test("a running turn ends in Luke's wait, driven by the turn row's status alone", () => {
  assert.equal(count(render([groupOf(FIXTURE_TURN.RUNNING)], OPEN), "data-thinking", "true"), 1);
  for (const turnId of [FIXTURE_TURN.SINGLE, FIXTURE_TURN.EVERY_KIND, FIXTURE_TURN.OWN]) {
    assert.equal(count(render([groupOf(turnId)], OPEN), "data-thinking", "true"), 0);
  }
  const turn = groupOf(FIXTURE_TURN.RUNNING).turn;
  assert.ok(turn);
  assert.equal(turnPending(turn), true);
  assert.equal(turnPending({ ...turn, status: TURN_STATUS.QUEUED }), true);
  for (const status of [TURN_STATUS.SETTLED, TURN_STATUS.CANCELLED, TURN_STATUS.FAILED]) {
    assert.equal(turnPending({ ...turn, status }), false);
  }
  assert.equal(turnPending(undefined), false);
});

test("a turn nobody opened is Luke's own judgment: his face leads every row, and his words are never a reply bubble", () => {
  const own = render([groupOf(FIXTURE_TURN.OWN)], OPEN);
  assert.equal(count(own, "data-judgment", "own"), 2);
  assert.equal(count(own, "data-judgment", "ask"), 0);
  assert.equal(count(own, "data-own-words", "true"), 1);
  assert.equal(count(own, "data-speaker", "luke"), 0);
  assert.equal((own.match(/class="luke-face"/g) ?? []).length, 2);

  const asked = render([groupOf(FIXTURE_TURN.SINGLE)], OPEN);
  assert.equal(count(asked, "data-judgment", "own"), 0);
  assert.equal((asked.match(/class="luke-face"/g) ?? []).length, 0);

  // The observed session's own turn: its announcement stays his bubble, its action his judgment.
  const announced = render([groupOf(FIXTURE_TURN.ANNOUNCED)], OPEN);
  assert.equal(count(announced, "data-speaker", "luke"), 1);

  const turn = groupOf(FIXTURE_TURN.OWN).turn;
  assert.ok(turn);
  for (const origin of [TURN_ORIGIN.ROSTER_DIFF, TURN_ORIGIN.HOLD_RELEASE, TURN_ORIGIN.CHILD]) {
    assert.equal(judgmentOf({ ...turn, origin }), "own");
  }
  for (const origin of [TURN_ORIGIN.TYPED, TURN_ORIGIN.SPOKEN]) {
    assert.equal(judgmentOf({ ...turn, origin }), "ask");
  }
  assert.equal(judgmentOf(undefined), "ask");
});

test("a reasoning part folds to a line on Luke's side, and an announcement is his bubble marked when unheard", () => {
  const groups = fixtureConversationTurns();
  const markup = render(groups, OPEN);
  // Main's turn carries its thought; the observed turn's crosses cut to its announcement.
  assert.equal(count(markup, "data-reasoning", "true"), 1);
  assert.equal(count(markup, "data-unspoken", "true"), 0);

  const announced = FIXTURE_INPUT.observed[0]?.messages[0];
  assert.ok(announced);
  const expired = selectConversationView({
    ...FIXTURE_INPUT,
    main: [],
    events: [
      { messageId: announced.message.id, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, seq: 1 },
      { messageId: announced.message.id, kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED, seq: 2 },
    ],
  });
  const unheard = render(expired, OPEN);
  assert.equal(count(unheard, "data-unspoken", "true"), 1);
  assert.equal(count(unheard, "data-speaker", "luke"), 1);
  assert.equal(count(unheard, "data-reasoning", "true"), 0);
});

test("the words an announce call carries are its briefing, and a detail's label is its tool's name", () => {
  const announced = FIXTURE_INPUT.observed[0]?.messages[0]?.message;
  assert.ok(announced && announced.role === MESSAGE_ROLE.ASSISTANT);
  const announce = announced.parts
    .filter(isStoredToolPart)
    .find((part) => part.type === "tool-announce");
  assert.ok(announce);
  assert.equal(announcedWords(announce), "The fixture session is waiting on a permission prompt.");
  assert.equal(announcedWords({ ...announce, input: { text: "not a briefing" } }), undefined);
  assert.equal(detailToolLabel("read_transcript"), "read transcript");
});

test("a developer's row is a sent bubble with a copy control, and a note the brain wrote is a quiet row", () => {
  const groups = fixtureConversationTurns();
  const markup = render(groups, OPEN);
  const asks = FIXTURE_INPUT.main.filter((row) => row.message.role === MESSAGE_ROLE.USER).length;
  assert.equal(count(markup, "data-speaker", "you"), asks);
  const noted = selectConversationView({
    ...FIXTURE_INPUT,
    observed: [],
    main: [
      {
        message: {
          id: "2b000000-0000-4000-8000-000000000901",
          role: MESSAGE_ROLE.USER,
          metadata: { author: "brain", source: "roster_look" },
          parts: [{ type: "text", text: "Roster: a session finished." }],
        },
        seq: 1,
        turnId: "1a000000-0000-4000-8000-000000000901",
        createdAt: 1757505600000,
      },
    ],
  });
  const note = render(noted);
  assert.equal(count(note, "data-speaker", "you"), 0);
  assert.equal(count(note, "data-speaker", "event"), 1);
  assert.equal(count(note, "class", "conversation-copy"), 0);
});

test("a turn that followed a long silence is dated over it, and the caller's rows close the one list", () => {
  const groups = fixtureConversationTurns();
  const markup = render(groups);
  // The first turn is always dated; the fixtures' turns follow one another
  // within minutes, so no later one is.
  assert.equal(markup.match(/<li class="conversation-break">/g)?.length, 1);
  assert.ok(
    markup.indexOf('<li class="conversation-break">') < markup.indexOf("conversation-entry"),
  );
  const hourLater = groups.map((group, index) =>
    index === 0
      ? group
      : {
          ...group,
          messages: group.messages.map((message) => ({
            ...message,
            createdAt: message.createdAt + index * 60 * 60_000,
          })),
        },
  );
  assert.equal(render(hourLater).match(/<li class="conversation-break">/g)?.length, groups.length);
  const withFoot = renderToStaticMarkup(
    createElement(
      ConversationTurns,
      { groups, roster: FIXTURE_ROSTER, now: FIXTURE_NOW },
      createElement("li", { className: "conversation-entry", "data-foot": "true" }),
    ),
  );
  assert.equal(withFoot.match(/<ol class="conversation-list">/g)?.length, 1);
  assert.ok(
    withFoot.lastIndexOf('data-foot="true"') > withFoot.lastIndexOf('class="conversation-time"'),
  );
  assert.ok(withFoot.lastIndexOf('data-foot="true"') < withFoot.lastIndexOf("</ol>"));
});
