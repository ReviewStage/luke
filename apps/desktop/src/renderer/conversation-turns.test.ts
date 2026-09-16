// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  BRAIN_INPUT_MARKER,
  OBSERVED_MESSAGES_CUT,
  observedMessagesText,
} from "@sidecar/brain/input-items";
import { FEEDBACK_LIMITS } from "@sidecar/feedback";
import { CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import {
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewMessage,
  type ConversationViewTurn,
  type ConversationViewTurnGroup,
  isStoredToolPart,
  MESSAGE_ROLE,
  type SessionIdentity,
  selectConversationView,
  TOOL_PART_STATE,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_RATING,
  OBSERVATION_SOURCE,
  RATING_WORD,
  TURN_ORIGIN,
  TURN_STATUS,
} from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import {
  DRAFT_QUOTE_MAX_LENGTH,
  DRAFT_SPEAKER,
  pressedRatingWord,
  RATING_LABEL,
  ratingFeedbackDraft,
} from "./conversation-rating";
import { CONVERSATION_ENTRY_SPEAKER } from "./conversation-rows";
import { detailToolLabel, TOOL_ROW_STATUS, toolRow } from "./conversation-tool-row";
import { ConversationTurns, foldOpen } from "./conversation-turns";
import {
  FIXTURE_INPUT,
  FIXTURE_NOW,
  FIXTURE_RATED_MESSAGE,
  FIXTURE_ROSTER,
  FIXTURE_SESSION,
  FIXTURE_TITLE,
  FIXTURE_TURN,
  fixtureChildCompletionTurns,
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

const TOOL_FOLD_OPENING = '<details class="conversation-actions-fold"';

test("the fixture scenarios draw every session action kind, folded or as a row of its own", () => {
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
    "setting",
  ]);
  assert.ok(count(markup, "data-tool-calls-fold", "settled") >= 1);
  assert.ok(count(markup, "data-tool-calls-fold", "running") >= 1);
  // Every fold's line leads with the chevron — the tool folds and the folds of thinking — and nothing else draws one.
  assert.equal(
    count(markup, "class", "settings-chevron"),
    count(markup, "data-tool-calls-fold", "settled") +
      count(markup, "data-tool-calls-fold", "running") +
      count(markup, "data-thinking-fold", "true"),
  );
  // Both the accepted actions and the other outcomes stand in the thread.
  assert.ok(count(markup, "data-tool-status", TOOL_ROW_STATUS.ACCEPTED) >= 7);
  assert.equal(count(markup, "data-tool-status", TOOL_ROW_STATUS.UNKNOWN), 1);
  assert.equal(count(markup, "data-tool-status", TOOL_ROW_STATUS.FAILED), 1);
  // One pending call in the observed running turn, and one in the main running turn.
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

function groupOf(turnId: string): ConversationViewTurnGroup {
  const group = fixtureConversationTurns().find((candidate) => candidate.turnId === turnId);
  assert.ok(group);
  return group;
}

/** The action rows a rendering draws, top level or inside a fold alike. */
function actionRows(markup: string): number {
  return (markup.match(/data-action-kind="/g) ?? []).length;
}

test("a message's tool calls fold under a count once there are two, open while it runs and closed once settled", () => {
  const running = render([groupOf(FIXTURE_TURN.RUNNING)], OPEN);
  assert.equal(count(running, "data-tool-calls-fold", "running"), 1);
  assert.equal(count(running, "data-tool-calls-fold", "settled"), 0);
  assert.equal((running.match(/<details class="conversation-actions-fold" open/g) ?? []).length, 1);
  assert.equal(actionRows(running), 3);
  // The fold's line: the chevron, then the count, and no marker of the browser's own.
  const summary = running.slice(
    running.indexOf('<summary class="conversation-turn-summary">'),
    running.indexOf("</summary>"),
  );
  assert.equal(count(summary, "class", "settings-chevron"), 1);
  assert.ok(summary.includes("3 tool calls"));

  // Inside the fold the rows carry no stamp of their own; the fold's line carries the message's.
  const [runningBefore, insideRunning] = running.split(TOOL_FOLD_OPENING);
  assert.ok(runningBefore !== undefined && insideRunning !== undefined);
  const [foldBody] = insideRunning.split("</details>");
  assert.ok(foldBody !== undefined);
  assert.equal(count(foldBody, "class", "conversation-time"), 0);
  assert.equal(count(running, "class", "conversation-time"), 2);
  assert.ok(runningBefore.indexOf('data-speaker="you"') !== -1);

  const settled = render([groupOf(FIXTURE_TURN.EVERY_KIND)], OPEN);
  assert.equal(count(settled, "data-tool-calls-fold", "settled"), 1);
  assert.equal((settled.match(/<details class="conversation-actions-fold" open/g) ?? []).length, 0);
  assert.equal((settled.match(/<details class="conversation-actions-fold"/g) ?? []).length, 1);
  assert.equal(actionRows(settled), 9);
  // The fold stands ahead of the reply it explains: after the ask and before Luke's words.
  const [beforeFold, afterFold] = settled.split(TOOL_FOLD_OPENING);
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

test("a message of one tool call draws the row itself, stamped, with no fold and no wait", () => {
  const markup = render([groupOf(FIXTURE_TURN.SINGLE)], OPEN);
  assert.equal((markup.match(/data-tool-calls-fold=/g) ?? []).length, 0);
  assert.equal(count(markup, "class", "settings-chevron"), 0);
  assert.equal(actionRows(markup), 1);
  assert.equal(count(markup, "data-thinking", "true"), 0);
  assert.equal(count(markup, "data-judgment", "ask"), 1);
  // The row stands between the ask and the reply, and carries the message's stamp as they do.
  assert.equal(count(markup, "class", "conversation-time"), 3);
  const [beforeRow, afterRow] = markup.split('data-action-kind="');
  assert.ok(beforeRow !== undefined && afterRow !== undefined);
  assert.equal(count(beforeRow, "data-speaker", "you"), 1);
  assert.equal(count(afterRow, "data-speaker", "luke"), 1);

  // One read is a row on the same terms: a transcript read led by its mark, naming its session as a chip, no fold.
  const asked = render([groupOf(FIXTURE_TURN.ASK)], OPEN);
  assert.equal((asked.match(/data-tool-calls-fold=/g) ?? []).length, 0);
  assert.equal(count(asked, "data-tool-kind", "transcript"), 1);
  assert.equal(actionRows(asked), 0);
  assert.equal(count(asked, "data-tool-status", TOOL_ROW_STATUS.ACCEPTED), 1);
  // Two marks: the read's page on its row, and the brain on the fold of the thought before it.
  assert.equal(count(asked, "class", "conversation-action-mark"), 2);
  assert.equal(count(asked, "data-thinking-fold", "true"), 1);
  assert.equal(count(asked, "class", "conversation-action-chip"), 1);
  assert.equal(count(asked, "class", "conversation-time"), 3);
});

test("the brain's own tools draw as rows of the turn's working, each led by a mark, a refusal saying why", () => {
  const working = render([groupOf(FIXTURE_TURN.WORKING)], OPEN);
  assert.equal(count(working, "data-tool-calls-fold", "settled"), 1);
  for (const kind of [
    "roster",
    "notebook-search",
    "notebook-read",
    "workspace-read",
    "workspace-write",
    "daily-note-append",
    "daily-notes-list",
  ]) {
    assert.equal(count(working, "data-tool-kind", kind), 1, kind);
  }
  // The one app action is an action, and the reads are not.
  assert.equal(actionRows(working), 1);
  assert.equal(count(working, "data-action-kind", "setting"), 1);
  // Every row wears a mark, and the refused write alone carries a reason.
  assert.equal(count(working, "class", "conversation-action-mark"), 8);
  assert.equal(count(working, "data-tool-status", TOOL_ROW_STATUS.REFUSED), 1);
  assert.equal(count(working, "class", "conversation-action-reason"), 1);
  assert.equal(count(working, "data-tool-status", TOOL_ROW_STATUS.ACCEPTED), 7);
});

test("the wait is the thread's last object: once after the newest turn, and never above a later turn", () => {
  const running = groupOf(FIXTURE_TURN.RUNNING);
  const settled = groupOf(FIXTURE_TURN.SINGLE);
  // A pending row a later turn has passed is a record eve never finished, not a run: no wait.
  assert.equal(count(render([running, settled], OPEN), "data-thinking", "true"), 0);
  // The newest turn running: one wait, after every row of the thread, stamped by nothing.
  const newest = render([settled, running], OPEN);
  assert.equal(count(newest, "data-thinking", "true"), 1);
  const [above, below] = newest.split('data-thinking="true"');
  assert.ok(above !== undefined && below !== undefined);
  assert.equal(count(below, "data-speaker", "you"), 0);
  assert.equal(count(below, "class", "conversation-time"), 0);
  assert.equal(count(above, "data-speaker", "you"), 2);
});

test("a running turn ends in Luke's wait, driven by the turn row's status alone", () => {
  assert.equal(count(render([groupOf(FIXTURE_TURN.RUNNING)], OPEN), "data-thinking", "true"), 1);
  for (const turnId of [FIXTURE_TURN.SINGLE, FIXTURE_TURN.EVERY_KIND, FIXTURE_TURN.OWN]) {
    assert.equal(count(render([groupOf(turnId)], OPEN), "data-thinking", "true"), 0);
  }
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
});

const SUBAGENT_CHIP_BUTTON =
  '<button type="button" class="conversation-action-chip conversation-subagent-chip"';

const COMPLETED_CHILD: ChildRead = {
  id: "aaaaaaaa-1111-4000-8000-000000000001",
  parentConversationId: "7a1b2c3d-0000-4000-8000-000000000001",
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  label: "Audit the release notes",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: FIXTURE_NOW - 120_000,
  settledAt: FIXTURE_NOW - 60_000,
};

function renderCompletion(
  groups: readonly ConversationViewTurnGroup[],
  extra: Partial<Parameters<typeof ConversationTurns>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(ConversationTurns, {
      groups,
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      ...extra,
    }),
  );
}

test("a child's completion leads Luke's words with a chip naming the child, pressed as the list's row is, and no other turn wears one", () => {
  const groups = fixtureChildCompletionTurns(COMPLETED_CHILD.id, COMPLETED_CHILD.label);
  const open = (childId: string) => void childId;
  const markup = renderCompletion(groups, { subagents: [COMPLETED_CHILD], onOpenChild: open });
  // The turn is Luke's own judgment: a read of his, then his words, and the
  // chip stands before the words, past the message that only read.
  assert.equal(count(markup, "data-own-words", "true"), 1);
  assert.equal(count(markup, "data-judgment", "own"), 2);
  assert.equal(markup.split(SUBAGENT_CHIP_BUTTON).length - 1, 1);
  assert.ok(markup.includes('aria-label="Open Sub-agent: Audit the release notes"'));
  assert.ok(markup.includes(">Sub-agent: Audit the release notes</button>"));
  const chipAt = markup.indexOf("conversation-subagent-chip");
  assert.ok(markup.indexOf("read_child_transcript") < chipAt);
  assert.ok(chipAt < markup.indexOf("The audit found"));
  // A child the list no longer holds is the bare word and a name, since its
  // transcript would close as it opened; a thread with no press to hand is a name.
  const unlisted = renderCompletion(groups, { onOpenChild: open });
  assert.equal(unlisted.split(SUBAGENT_CHIP_BUTTON).length - 1, 0);
  assert.ok(
    unlisted.includes(
      '<span class="conversation-action-chip conversation-subagent-chip">Sub-agent</span>',
    ),
  );
  const named = renderCompletion(groups, { subagents: [COMPLETED_CHILD] });
  assert.equal(named.split(SUBAGENT_CHIP_BUTTON).length - 1, 0);
  assert.ok(
    named.includes(
      '<span class="conversation-action-chip conversation-subagent-chip">Sub-agent: Audit the release notes</span>',
    ),
  );
  // Every other turn, the developer's and Luke's own alike, wears none.
  const others = renderCompletion(fixtureConversationTurns(), {
    subagents: [COMPLETED_CHILD],
    onOpenChild: open,
    onOpenChat: OPEN,
  });
  assert.equal(count(others, "data-judgment", "own") > 0, true);
  assert.equal(others.split("conversation-subagent-chip").length - 1, 0);
});

const SOURCE_CHIP_BUTTON =
  '<button type="button" class="conversation-action-chip conversation-source-chip"';

afterEach(() => {
  document.body.innerHTML = "";
});

test("a turn of an observed session's own conversation heads on one chip naming the session, pressed as its row is, and main's turns wear none", () => {
  const observed = groupOf(FIXTURE_TURN.ANNOUNCED);
  assert.ok(observed.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED);
  const markup = render([observed], OPEN);
  assert.equal(markup.split(SOURCE_CHIP_BUTTON).length - 1, 1);
  assert.ok(markup.includes(`aria-label="Open ${FIXTURE_TITLE.HELD}"`));
  assert.ok(markup.includes(`${FIXTURE_TITLE.HELD}</button>`));
  // The chip is the group's first row, a line of its own in the event voice,
  // and the rows below it are the turn's own, unchanged.
  const [head, ...rows] = markup.split('<li class="conversation-entry"').slice(1);
  assert.ok(head !== undefined);
  assert.ok(
    head.startsWith(
      ` data-speaker="${CONVERSATION_ENTRY_SPEAKER.EVENT}" data-source-session="true"`,
    ),
  );
  assert.ok(!head.includes("conversation-bubble"));
  // The observed message crosses cut to its announcement, so one bubble of Luke's follows.
  assert.equal(rows.length, 1);
  assert.equal(count(markup, "data-speaker", CONVERSATION_ENTRY_SPEAKER.LUKE), 1);
  // Pressed, the chip opens the chat at the session the source names.
  const opened: SessionIdentity[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    createRoot(container).render(
      createElement(ConversationTurns, {
        groups: [observed],
        roster: FIXTURE_ROSTER,
        now: FIXTURE_NOW,
        onOpenChat: (identity) => void opened.push(identity),
      }),
    );
  });
  const chip = container.querySelector(".conversation-source-chip");
  assert.ok(chip instanceof HTMLButtonElement);
  act(() => {
    chip.click();
  });
  assert.deepEqual(opened, [observed.source.session]);
  // Main's own groups, the developer's and Luke's own alike, wear none; the
  // fixture thread wears exactly one per observed group.
  for (const turnId of [FIXTURE_TURN.SINGLE, FIXTURE_TURN.OWN]) {
    assert.ok(!render([groupOf(turnId)], OPEN).includes("conversation-source-chip"));
  }
  const groups = fixtureConversationTurns();
  assert.equal(
    count(render(groups, OPEN), "data-source-session", "true"),
    groups.filter((group) => group.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED).length,
  );
});

test("a source chip for a session the roster has let go names it from its id and is never a button", () => {
  const observed = groupOf(FIXTURE_TURN.ANNOUNCED);
  const gone = renderToStaticMarkup(
    createElement(ConversationTurns, {
      groups: [observed],
      roster: [],
      now: FIXTURE_NOW,
      onOpenChat: OPEN,
    }),
  );
  assert.equal(gone.split(SOURCE_CHIP_BUTTON).length - 1, 0);
  assert.equal(count(gone, "data-source-session", "true"), 1);
  assert.ok(gone.includes('<span class="conversation-action-chip conversation-source-chip">'));
  assert.ok(gone.includes(`Session ${FIXTURE_SESSION.HELD.slice(0, 8)}</span>`));
  // With nothing to hand a press to, the chip is a name even while the roster holds the session.
  const unpressed = render([observed]);
  assert.equal(unpressed.split(SOURCE_CHIP_BUTTON).length - 1, 0);
  assert.ok(unpressed.includes(`${FIXTURE_TITLE.HELD}</span>`));
  // A session the roster holds but whose provider reported no address is
  // named by the roster's title and is a name, as its own row would be.
  assert.ok(observed.source.kind === CONVERSATION_VIEW_SOURCE.OBSERVED);
  const quiet = render(
    [
      {
        ...observed,
        source: {
          kind: CONVERSATION_VIEW_SOURCE.OBSERVED,
          session: {
            providerId: observed.source.session.providerId,
            providerSessionId: FIXTURE_SESSION.UNOPENABLE,
          },
        },
      },
    ],
    OPEN,
  );
  assert.equal(quiet.split(SOURCE_CHIP_BUTTON).length - 1, 0);
  assert.equal(count(quiet, "data-source-session", "true"), 1);
  assert.ok(quiet.includes(`${FIXTURE_TITLE.UNOPENABLE}</span>`));
  assert.ok(!quiet.includes(FIXTURE_TITLE.HELD));
});

test("a reasoning part folds to a line on Luke's side, and an announcement is his bubble whatever became of its offer", () => {
  const groups = fixtureConversationTurns();
  const markup = render(groups, OPEN);
  // Main's turn carries its thought; the observed turn's crosses cut to its announcement.
  assert.equal(count(markup, "data-reasoning", "true"), 1);
  // The reasoning row and the brain's written row open on the same one word, for now.
  const reasoning = entries(markup).find((row) => row.includes('data-reasoning="true"'));
  assert.ok(reasoning?.includes("Thinking"));

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
  // A lapsed offer draws the same bubble as a heard one: the record keeps the mark, the panel says nothing of it.
  const unheard = render(expired, OPEN);
  assert.ok(!unheard.includes("unspoken"));
  assert.ok(!unheard.includes("Not spoken"));
  assert.equal(count(unheard, "data-speaker", "luke"), 1);
  assert.equal(count(unheard, "data-reasoning", "true"), 0);
});

test("a reasoning fold keeps paragraph breaks as separate blocks inside the expanded thinking text", () => {
  const at = FIXTURE_NOW - 30_000;
  const group: ConversationViewTurnGroup = {
    turnId: "paragraph-reasoning",
    turn: {
      id: "paragraph-reasoning",
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: at,
      startedAt: at,
      settledAt: at + 1_000,
    },
    source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
    messages: [
      {
        message: {
          id: "paragraph-reasoning-message",
          role: MESSAGE_ROLE.ASSISTANT,
          metadata: { author: MESSAGE_AUTHOR.BRAIN },
          parts: [
            {
              type: "reasoning",
              text: "Read the trace first.\n\nThen compare the renderer styles.",
              state: "done",
            },
          ],
        },
        seq: 1,
        createdAt: at,
        placedAt: at,
        tools: [],
      },
    ],
  };

  const reasoning = entries(render([group], OPEN)).find((row) =>
    row.includes('data-reasoning="true"'),
  );
  assert.ok(reasoning);
  assert.ok(
    reasoning.includes(
      '<div class="markdown conversation-thinking-fold-words"><p>Read the trace first.</p>\n<p>Then compare the renderer styles.</p></div>',
    ),
  );
});

test("an announce call is a bubble and nothing else, and a detail's label is its tool's name", () => {
  assert.equal(detailToolLabel("read_transcript"), "read transcript");
  // The announce call is its bubble and nothing else: no tool call row, no fold, for a message that only announced.
  const markup = render([groupOf(FIXTURE_TURN.ANNOUNCED)], OPEN);
  assert.equal(count(markup, "data-speaker", "luke"), 1);
  assert.equal((markup.match(/data-tool-calls-fold=/g) ?? []).length, 0);
  assert.equal((markup.match(/data-tool-kind="/g) ?? []).length, 0);
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
          metadata: { author: "brain", source: "transcript_change" },
          parts: [{ type: "text", text: "Roster: a session finished." }],
        },
        seq: 1,
        turnId: "1a000000-0000-4000-8000-000000000901",
        createdAt: 1757505600000,
        placedAt: 1757505600000,
      },
    ],
  });
  const note = render(noted);
  assert.equal(count(note, "data-speaker", "you"), 0);
  assert.equal(count(note, "data-speaker", "event"), 1);
  assert.equal(count(note, "class", "conversation-copy"), 0);
  assert.equal(count(note, "class", "conversation-more-button"), 0);
});

/** The metadata each author's user row carries: a typed ask, a spoken one, or the brain's note. */
const USER_ROW_METADATA = {
  [MESSAGE_AUTHOR.DEVELOPER]: { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
  [MESSAGE_AUTHOR.VOICE_MODEL]: {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
  },
  [MESSAGE_AUTHOR.BRAIN]: {
    author: MESSAGE_AUTHOR.BRAIN,
    source: OBSERVATION_SOURCE.TRANSCRIPT_CHANGE,
  },
} as const;

/** One user row on its own, as the view selects it, under whichever author wrote it. */
function userRowGroups(
  author: keyof typeof USER_ROW_METADATA,
  text: string,
): readonly ConversationViewTurnGroup[] {
  return selectConversationView({
    ...FIXTURE_INPUT,
    observed: [],
    main: [
      {
        message: {
          id: "2b000000-0000-4000-8000-000000000902",
          role: MESSAGE_ROLE.USER,
          metadata: USER_ROW_METADATA[author],
          parts: [{ type: "text", text }],
        },
        seq: 1,
        turnId: "1a000000-0000-4000-8000-000000000902",
        createdAt: FIXTURE_NOW - 60_000,
        placedAt: FIXTURE_NOW - 60_000,
      },
    ],
  });
}

const OBSERVED_FOLD_OPENING = '<details class="conversation-observed"';

const OBSERVED_TEXT = observedMessagesText(
  {
    providerName: "Conductor",
    workspace: "luke",
    title: "Fix the login redirect",
    providerSessionId: "c1d2e3f4-0000-4000-8000-000000000001",
    updatedAt: FIXTURE_NOW - 90_000,
  },
  ["agent: The redirect now keeps\nthe query string.", "user: Ship it."],
  true,
  FIXTURE_NOW - 60_000,
);

test("an observed-messages note names the chat and counts its lines on a fold that holds them", () => {
  const markup = render(userRowGroups(MESSAGE_AUTHOR.BRAIN, OBSERVED_TEXT));
  assert.equal(count(markup, "data-speaker", "event"), 1);
  // Lines, not messages: the first message spans two, and the row keeps no boundary.
  assert.equal(count(markup, "data-observed-messages", "3"), 1);
  assert.equal(markup.split(OBSERVED_FOLD_OPENING).length - 1, 1);
  assert.ok(markup.includes("<span>Fix the login redirect — 3 new lines</span>"));
  // The cut line stands first among the lines and is not counted.
  assert.ok(
    markup.includes(
      `<pre><code>${OBSERVED_MESSAGES_CUT}\nagent: The redirect now keeps\nthe query string.\nuser: Ship it.</code></pre>`,
    ),
  );
  // A chat the roster no longer holds is named as the brain named it, and one line is singular.
  const unheld = render(
    userRowGroups(
      MESSAGE_AUTHOR.BRAIN,
      observedMessagesText(
        {
          providerName: "Conductor",
          providerSessionId: "a1b2c3d4-0000-4000-8000-000000000002",
          updatedAt: FIXTURE_NOW - 90_000,
        },
        ["agent: Done."],
        false,
        FIXTURE_NOW - 60_000,
      ),
    ),
  );
  assert.ok(unheld.includes("<span>chat a1b2c3d4-0000-4000-8000-000000000002 — 1 new line</span>"));
  assert.ok(unheld.includes("<pre><code>agent: Done.</code></pre>"));
  // The note is the brain's, so it carries no copy control and no menu.
  assert.equal(count(markup, "class", "conversation-copy"), 0);
  assert.equal(count(markup, "class", "conversation-more-button"), 0);
});

test("an observed-messages note the reader cannot hold to the shape is drawn verbatim, and only the brain's words are read as one", () => {
  const instant = new Date(FIXTURE_NOW).toISOString();
  for (const malformed of [
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES} ${instant}\nno envelope here\nagent: Done.`,
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES} ${instant}\n[Conductor · Fix the login redirect · not an instant]\nagent: Done.`,
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES} of old\n[Conductor · Fix the login redirect · ${instant}]`,
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES} ${instant}`,
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES}X ${instant}\n[Conductor · Fix the login redirect · ${instant}]`,
    `${BRAIN_INPUT_MARKER.OBSERVED_MESSAGES} ${instant}\n[Conductor · luke · Fix · the login redirect · ${instant}]`,
  ]) {
    const fallen = render(userRowGroups(MESSAGE_AUTHOR.BRAIN, malformed));
    assert.equal(count(fallen, "data-speaker", "event"), 1);
    assert.equal(fallen.split(OBSERVED_FOLD_OPENING).length - 1, 0);
    assert.ok(
      fallen.includes("Fix the login redirect") ||
        fallen.includes("no envelope here") ||
        fallen.includes(instant),
    );
  }
  const developer = render(userRowGroups(MESSAGE_AUTHOR.DEVELOPER, OBSERVED_TEXT));
  assert.equal(count(developer, "data-speaker", "you"), 1);
  assert.equal(count(developer, "data-speaker", "event"), 0);
  assert.equal(developer.split(OBSERVED_FOLD_OPENING).length - 1, 0);
  assert.equal(count(developer, "class", "conversation-copy"), 1);
  // The voice model's row is a note too, but never an observed-messages turn.
  const spoken = render(userRowGroups(MESSAGE_AUTHOR.VOICE_MODEL, OBSERVED_TEXT));
  assert.equal(count(spoken, "data-speaker", "event"), 1);
  assert.equal(spoken.split(OBSERVED_FOLD_OPENING).length - 1, 0);
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
            placedAt: message.placedAt + index * 60 * 60_000,
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

/** The rating controls a rendering draws, each on one of Luke's messages. */
function ratingControls(markup: string): number {
  return count(markup, "class", "conversation-rating");
}

/** The ellipsis buttons a rendering draws, one in the margin of each of Luke's messages. */
function menuButtons(markup: string): number {
  return count(markup, "class", "conversation-more-button");
}

/** The popovers a rendering draws: the sheet each ellipsis opens, the platform's own. */
function menus(markup: string): number {
  return count(markup, "popover", "auto");
}

function pressed(markup: string, label: string): readonly boolean[] {
  return [...markup.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*aria-pressed="([^"]+)"/g)]
    .filter((match) => match[1] === label)
    .map((match) => match[2] === "true");
}

test("each of Luke's messages carries one rating control on its last words, behind its ellipsis, and the developer's ask and the brain's note carry none", () => {
  const groups = fixtureConversationTurns();
  // The fixture's messages of Luke's with words: five replies, one briefing, one on his own judgment.
  const lukes = 7;
  const markup = render(groups, OPEN);
  assert.equal(ratingControls(markup), lukes);
  assert.equal(pressed(markup, RATING_LABEL[MESSAGE_RATING.UP]).length, lukes);
  assert.equal(pressed(markup, RATING_LABEL[MESSAGE_RATING.DOWN]).length, lukes);
  // One ellipsis and one sheet per control: the thumbs stand behind the ellipsis, never under the words.
  assert.equal(menuButtons(markup), lukes);
  assert.equal(menus(markup), lukes);
  for (const entry of markup.split('<li class="conversation-entry"').slice(1)) {
    // No control on a sent bubble or a note: every one stands on Luke's side.
    if (ratingControls(entry) === 0) {
      assert.equal(menuButtons(entry), 0);
      continue;
    }
    assert.equal(count(entry, "data-speaker", CONVERSATION_ENTRY_SPEAKER.YOU), 0);
    // The ellipsis follows the copy control in the bubble's margin, and the thumbs stand inside the sheet it opens.
    const copyAt = entry.indexOf('class="conversation-copy"');
    const moreAt = entry.indexOf('class="conversation-more-button"');
    const menuAt = entry.indexOf('class="conversation-menu"');
    const ratingAt = entry.indexOf('class="conversation-rating"');
    if (copyAt !== -1) assert.ok(copyAt < moreAt);
    assert.ok(moreAt < menuAt && menuAt < ratingAt);
  }
  // Words on Luke's own judgment take the control too: the service accepts a rating on them.
  const own = render([groupOf(FIXTURE_TURN.OWN)], OPEN);
  assert.equal(ratingControls(own), 1);
  assert.equal(menuButtons(own), 1);
  assert.equal(count(own, "data-own-words", "true"), 1);
  // The ellipsis names the sheet it opens, so the platform opens and anchors it: the button's target is the sheet's id.
  const target = own.match(/class="conversation-more-button"[^>]*popoverTarget="([^"]+)"/)?.[1];
  assert.ok(target);
  assert.equal(count(own, "id", target), 1);
  assert.ok(own.includes(`id="${target}" class="conversation-menu" popover="auto"`));
});

test("a press on the filled thumb takes the verdict back, and a press on any other thumb says its verdict", () => {
  assert.equal(pressedRatingWord(undefined, MESSAGE_RATING.UP), MESSAGE_RATING.UP);
  assert.equal(pressedRatingWord(undefined, MESSAGE_RATING.DOWN), MESSAGE_RATING.DOWN);
  assert.equal(pressedRatingWord(MESSAGE_RATING.DOWN, MESSAGE_RATING.UP), MESSAGE_RATING.UP);
  assert.equal(pressedRatingWord(MESSAGE_RATING.UP, MESSAGE_RATING.DOWN), MESSAGE_RATING.DOWN);
  assert.equal(pressedRatingWord(MESSAGE_RATING.UP, MESSAGE_RATING.UP), RATING_WORD.WITHDRAWN);
  assert.equal(pressedRatingWord(MESSAGE_RATING.DOWN, MESSAGE_RATING.DOWN), RATING_WORD.WITHDRAWN);
});

test("the thumbs show the message's newest rating, and a thumbs down stands the composer's offer beside them only where one can be offered", () => {
  const rated = groupOf(FIXTURE_TURN.ASK);
  const verdicts = rated.messages.map((view) => view.rating?.rating);
  assert.deepEqual(verdicts, [undefined, MESSAGE_RATING.DOWN]);

  const offered = renderToStaticMarkup(
    createElement(ConversationTurns, {
      groups: [rated],
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      onOfferRatingFeedback: () => undefined,
    }),
  );
  assert.deepEqual(pressed(offered, RATING_LABEL[MESSAGE_RATING.UP]), [false]);
  assert.deepEqual(pressed(offered, RATING_LABEL[MESSAGE_RATING.DOWN]), [true]);
  assert.equal(count(offered, "data-rating", MESSAGE_RATING.DOWN), 1);
  assert.equal(count(offered, "class", "conversation-rating-offer"), 1);

  // The same thread with nowhere to offer a composer: the verdict shows, the offer does not.
  const unoffered = render([rated], OPEN);
  assert.deepEqual(pressed(unoffered, RATING_LABEL[MESSAGE_RATING.DOWN]), [true]);
  assert.equal(count(unoffered, "class", "conversation-rating-offer"), 0);

  // An unrated message: neither thumb pressed, no offer.
  const unrated = render([groupOf(FIXTURE_TURN.SINGLE)], OPEN);
  assert.deepEqual(pressed(unrated, RATING_LABEL[MESSAGE_RATING.UP]), [false]);
  assert.deepEqual(pressed(unrated, RATING_LABEL[MESSAGE_RATING.DOWN]), [false]);
  assert.equal(count(unrated, "class", "conversation-rating-offer"), 0);
});

test("the offered draft quotes the ask the turn answered and then the rated message, each cut to the quote bound, over a blank line to write under", () => {
  const short = ratingFeedbackDraft({
    messageId: FIXTURE_RATED_MESSAGE,
    words: "It is holding on a permission prompt.",
    ask: "Is the fixture session still waiting?",
  }).split("\n");
  assert.deepEqual(short, [
    `${DRAFT_SPEAKER.YOU} Is the fixture session still waiting?`,
    "",
    `${DRAFT_SPEAKER.LUKE} It is holding on a permission prompt.`,
    "",
    "",
  ]);
  // A briefing answered no ask: only Luke's words are quoted.
  const briefing = ratingFeedbackDraft({ messageId: FIXTURE_RATED_MESSAGE, words: "A word." });
  assert.deepEqual(briefing.split("\n"), [`${DRAFT_SPEAKER.LUKE} A word.`, "", ""]);
  // A long reply is cut so the whole draft leaves room under the composer's bound.
  const long = ratingFeedbackDraft({
    messageId: FIXTURE_RATED_MESSAGE,
    words: "x".repeat(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH),
    ask: "y".repeat(FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH),
  }).split("\n");
  assert.equal(long.length, short.length);
  assert.deepEqual(
    [long[0]?.length, long[2]?.length],
    [
      DRAFT_SPEAKER.YOU.length + 1 + DRAFT_QUOTE_MAX_LENGTH,
      DRAFT_SPEAKER.LUKE.length + 1 + DRAFT_QUOTE_MAX_LENGTH,
    ],
  );
  assert.ok(
    ratingFeedbackDraft({ messageId: FIXTURE_RATED_MESSAGE, words: "w" }).length <
      FEEDBACK_LIMITS.MESSAGE_MAX_LENGTH,
  );
});

/** The rows of the list, each from its opening tag to the next, so a test can say which row carries what. */
function entries(markup: string): readonly string[] {
  return markup.split('<li class="conversation-entry"').slice(1);
}

test("in a spoken turn the brain's words fold as Luke's thinking, a row apart from his reasoning, where the record placed them among what his voice said, and the journal's rating stands on the reading", () => {
  const READ_TURN = "1c000000-0000-4000-8000-000000000401";
  const JOURNAL = "1c000000-0000-4000-8000-000000000402";
  const READING = "1c000000-0000-4000-8000-000000000403";
  const at = FIXTURE_NOW - 30_000;
  const turn: ConversationViewTurn = {
    id: READ_TURN,
    origin: TURN_ORIGIN.SPOKEN,
    status: TURN_STATUS.SETTLED,
    queuedAt: at,
    startedAt: at,
    settledAt: at + 6_000,
  };
  const spoken = (id: string, text: string, seq: number, fromMs: number, readFrom?: string) =>
    ({
      message: {
        id,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text, state: "done" }],
        metadata: {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: "vs_1",
          delegation_id: "dl_1",
          from_ms: fromMs,
          to_ms: fromMs + 1_000,
          ...(readFrom === undefined ? undefined : { read_from: readFrom }),
        },
      },
      seq,
      createdAt: at + fromMs,
      placedAt: at + fromMs,
      tools: [],
    }) satisfies ConversationViewMessage;
  const ask: ConversationViewMessage = {
    message: {
      id: "1c000000-0000-4000-8000-000000000400",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Open the failing one.", state: "done" }],
      metadata: {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: "vs_1",
        delegation_id: "dl_1",
        from_ms: 0,
        to_ms: 1_000,
      },
    },
    seq: 1,
    createdAt: at,
    placedAt: at,
    tools: [],
  };
  const checking = spoken("1c000000-0000-4000-8000-000000000404", "Checking now.", 2, 1_500);
  const reading_transcript = spoken(
    "1c000000-0000-4000-8000-000000000405",
    "I'm reading one session's transcript.",
    3,
    3_000,
  );
  // The journal opened at the turn's first step and closed behind the words said while it ran.
  const journal: ConversationViewMessage = {
    message: {
      id: JOURNAL,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "text", text: "It is on the `failing` test.", state: "done" }],
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
    },
    seq: 4,
    createdAt: at + 2_000,
    placedAt: at + 2_000,
    tools: [],
  };
  const reading = spoken(READING, "It's on the failing test!", 5, 7_000, JOURNAL);
  const group: ConversationViewTurnGroup = {
    turnId: READ_TURN,
    turn,
    source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
    messages: [ask, checking, reading_transcript, journal, reading],
  };
  const markup = render([group]);
  // The brain's words fold as his thinking, in markdown, as a row of their own and not
  // a reasoning row.
  assert.equal(count(markup, "data-written", "true"), 1);
  assert.equal(count(markup, "data-reasoning", "true"), 0);
  assert.equal(count(markup, "data-reading", "true"), 1);
  const rows = entries(markup);
  const thought = rows.find((row) => row.includes('data-written="true"'));
  const said = rows.find((row) => row.includes('data-reading="true"'));
  assert.ok(thought && said);
  assert.ok(thought.includes("Thinking") && thought.includes("<code>failing</code>"));
  assert.ok(said.includes("failing test!"));
  // The rows stand in the record's sequence: the ask, what was said while the brain
  // worked, the thought, then the reading — the thought never sorts above the words before it.
  assert.deepEqual(
    rows.map((row) =>
      row.includes('data-speaker="you"')
        ? "you"
        : row.includes('data-written="true"')
          ? "thought"
          : row.includes('data-reading="true"')
            ? "reading"
            : "said",
    ),
    ["you", "said", "said", "thought", "reading"],
  );
  // One control per message of Luke's with words said: the two lines of his own, and the
  // reading carrying the journal's; the thought carries none.
  assert.equal(ratingControls(markup), 3);
  assert.equal(ratingControls(thought), 0);
  assert.equal(ratingControls(said), 1);

  // Without the reading, the thought stands as it is and the brain's judgment goes unrated.
  const unread = render([{ ...group, messages: [ask, checking, reading_transcript, journal] }]);
  assert.equal(count(unread, "data-written", "true"), 1);
  assert.equal(ratingControls(unread), 2);

  // The same journal under a typed turn is the answer itself: a bubble carrying its rating.
  const typed = render([
    { ...group, turn: { ...turn, origin: TURN_ORIGIN.TYPED }, messages: [ask, journal] },
  ]);
  assert.equal(count(typed, "data-written", "true"), 0);
  assert.equal(count(typed, "data-speaker", "luke"), 1);
  assert.equal(ratingControls(typed), 1);
});

test("a briefing a device read aloud folds as the brain's written words, the reading in its own group is the bubble carrying the briefing's rating, and one nothing said of stays the bubble", () => {
  const ANNOUNCED = "1d000000-0000-4000-8000-000000000501";
  const READING = "1d000000-0000-4000-8000-000000000502";
  const at = FIXTURE_NOW - 30_000;
  const announced: ConversationViewMessage = {
    message: {
      id: ANNOUNCED,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-announce",
          toolCallId: "call-announce",
          state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
          input: { briefing: "Two sessions finished while you were away." },
          output: {},
        },
      ],
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
    },
    seq: 1,
    createdAt: at,
    placedAt: at,
    tools: [
      {
        toolCallId: "call-announce",
        toolName: "announce",
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        kind: CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE,
        unspoken: false,
      },
    ],
  };
  const reading: ConversationViewMessage = {
    message: {
      id: READING,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "text", text: "Two sessions wrapped up while you were out.", state: "done" }],
      metadata: {
        author: MESSAGE_AUTHOR.VOICE_MODEL,
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: "vs_1",
        from_ms: 1_000,
        to_ms: 4_000,
        read_from: ANNOUNCED,
      },
    },
    seq: 2,
    createdAt: at + 5_000,
    placedAt: at + 5_000,
    tools: [],
  };
  const readingGroup: ConversationViewTurnGroup = {
    turnId: "reading-only",
    turn: undefined,
    source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
    messages: [reading],
  };
  const groups: ConversationViewTurnGroup[] = [
    {
      turnId: "1d000000-0000-4000-8000-000000000500",
      turn: {
        id: "1d000000-0000-4000-8000-000000000500",
        origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
        status: TURN_STATUS.SETTLED,
        queuedAt: at,
        startedAt: at,
        settledAt: at + 1_000,
      },
      source: { kind: CONVERSATION_VIEW_SOURCE.MAIN },
      messages: [announced],
    },
    readingGroup,
  ];
  const markup = render(groups);
  assert.equal(count(markup, "data-written", "true"), 1);
  assert.equal(count(markup, "data-reading", "true"), 1);
  assert.equal(count(markup, "data-speaker", "luke"), 2);
  assert.equal(ratingControls(markup), 1);
  const rows = entries(markup);
  const folded = rows.find((row) => row.includes('data-written="true"'));
  const said = rows.find((row) => row.includes('data-reading="true"'));
  assert.ok(folded && said);
  assert.ok(folded.includes("Thinking") && folded.includes("finished while you were away"));
  assert.equal(ratingControls(folded), 0);
  assert.equal(ratingControls(said), 1);
  assert.ok(said.includes("wrapped up"));
  // The same briefing with no spoken row — pushed to a phone, or claimed by nobody — is the bubble, rated itself.
  const [announcedGroup] = groups;
  assert.ok(announcedGroup);
  const pushed = render([announcedGroup]);
  assert.equal(count(pushed, "data-written", "true"), 0);
  assert.equal(count(pushed, "data-speaker", "luke"), 1);
  assert.equal(ratingControls(pushed), 1);
  // A reading whose source is not in the thread is drawn as words of Luke's own, rated as such.
  const alone = render([readingGroup]);
  assert.equal(count(alone, "data-reading", "true"), 0);
  assert.equal(ratingControls(alone), 1);
});
