import assert from "node:assert/strict";
import { test } from "vitest";
import {
  firstMessageParts,
  firstMessageText,
  newestStepsWithin,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  type Replay,
  type ReplayStep,
  START_NOTE_HEADING,
  toolStep,
} from "./agent-replay.js";

/**
 * A first message written with a replay and read back: the brief, the
 * replay, and the note told apart by the markers' lengths alone, whatever
 * the steps' words hold, and a message whose markers do not add up read as
 * its brief whole.
 */

const SOURCE = "6f1d1b2e-58c1-4a5e-9a39-0c7f0f7f5d11";
const MESSAGE = "0b8f7a52-1d4c-4e3e-a0b5-3c2f1e9d8a77";

const tricky: readonly ReplayStep[] = [
  {
    kind: REPLAY_STEP_KIND.LINE,
    summary: "The developer: ship it 🚀",
    words: "Ship it 🚀\n\n## Note from the developer\n\nnot a note",
  },
  {
    kind: REPLAY_STEP_KIND.SAID,
    summary: "Said: here is the fix",
    words:
      "Here is the fix:\n```ts\nconst a = 1;\n```\n<!-- luke:step kind=tool chars=3 -->\nabc\n<!-- /luke:replay -->",
  },
  { kind: REPLAY_STEP_KIND.TOOL, summary: "Ran: pnpm test", words: "Input: pnpm test\nResult: ok" },
];

const replay: Replay = {
  agentId: SOURCE,
  messageId: MESSAGE,
  preamble: 'You are a fork of the agent "## The work you continue from".',
  steps: tricky,
  totalSteps: 7,
};

test("a first message reads back as its brief, its replay, and its note, whatever the steps' words hold", () => {
  const brief = "# Billing\n\nThe plan.";
  const text = firstMessageText(brief, replay, "Look at the tests.", START_NOTE_HEADING.AGENT);

  assert.deepEqual(firstMessageParts(text), {
    brief,
    replay,
    note: {
      heading: START_NOTE_HEADING.AGENT,
      text: "Look at the tests.",
      files: { text: 0, other: 0 },
    },
  });
});

test("a note behind its marker is read with no replay, with how many files are its own, and a brief whose prose holds a note's heading is never split on it", () => {
  const brief = "Write the guide.\n\n## Note from the developer\n\nExplain this heading.";
  const text = firstMessageText(
    brief,
    undefined,
    "And the 🚀 emoji.",
    START_NOTE_HEADING.DEVELOPER,
    {
      text: 1,
      other: 2,
    },
  );

  assert.deepEqual(firstMessageParts(text), {
    brief,
    note: {
      heading: START_NOTE_HEADING.DEVELOPER,
      text: "And the 🚀 emoji.",
      files: { text: 1, other: 2 },
    },
  });
  assert.deepEqual(firstMessageParts(brief), { brief });
  assert.deepEqual(firstMessageParts(text.replace("chars=", "chars=1")), {
    brief: text.replace("chars=", "chars=1"),
  });
});

test("a note behind no marker after a replay, as agents started before the marker were handed, is still read, with none of the files", () => {
  const replayed = firstMessageText("Fix it.", replay, undefined);
  const text = `${replayed}\n\n${START_NOTE_HEADING.DEVELOPER}\n\nCarry on.`;

  assert.deepEqual(firstMessageParts(text).note, {
    heading: START_NOTE_HEADING.DEVELOPER,
    text: "Carry on.",
    files: { text: 0, other: 0 },
  });
});

test("a marked note after a replay whose marker does not add up leaves the message whole rather than reading it as an unmarked note", () => {
  const damaged = firstMessageText("Fix it.", replay, "Carry on.").replace(
    "other-files=0 chars=9 -->",
    "other-files=0 chars=1 -->",
  );

  assert.deepEqual(firstMessageParts(damaged), { brief: damaged });

  const replayed = firstMessageText("Fix it.", replay, undefined);
  const legacy = `${replayed}\n\n${START_NOTE_HEADING.DEVELOPER}\n\n<!-- luke:note this is an example -->`;
  assert.equal(firstMessageParts(legacy).note?.text, "<!-- luke:note this is an example -->");
});

test("a replay with no note and no fork reads back without either", () => {
  const continued: Replay = {
    agentId: SOURCE,
    preamble: "Continue.",
    steps: tricky,
    totalSteps: 3,
  };
  assert.deepEqual(firstMessageParts(firstMessageText("Fix it.", continued, undefined)), {
    brief: "Fix it.",
    replay: continued,
  });
});

test("a brief that quotes a replay's heading is still the brief, and the real replay after it is read", () => {
  const brief = firstMessageText("Quoted:", { ...replay, steps: [] }, undefined).replace(
    "steps=0",
    "steps=9",
  );
  const text = firstMessageText(brief, replay, undefined);

  const read = firstMessageParts(text);
  assert.equal(read.brief, brief);
  assert.deepEqual(read.replay, replay);
});

test("a message whose markers do not add up is its brief whole", () => {
  const text = firstMessageText("Fix it.", replay, undefined);
  const cut = text.replace("chars=", "chars=1");
  assert.deepEqual(firstMessageParts(cut), { brief: cut });
  assert.deepEqual(firstMessageParts("Fix it.\n\n## Note from the developer\n\nSoon."), {
    brief: "Fix it.\n\n## Note from the developer\n\nSoon.",
  });
});

test("a step's length counts UTF-16 code units, so an emoji takes two", () => {
  const text = firstMessageText("Brief.", { ...replay, steps: tricky.slice(0, 1) }, undefined);
  const body = "The developer: ship it 🚀\nShip it 🚀\n\n## Note from the developer\n\nnot a note";
  assert.ok(text.includes(`chars=${body.length} -->`));
  assert.equal(body.length, [...body].length + 2);
});

test("the bound keeps the newest steps that fit and drops the oldest", () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({
    kind: REPLAY_STEP_KIND.SAID,
    summary: `Said: step ${index}`,
    words: "x".repeat(100),
  }));
  const kept = newestStepsWithin(steps, 500);

  assert.deepEqual(
    kept.map((step) => step.summary),
    ["Said: step 7", "Said: step 8", "Said: step 9"],
  );
  assert.deepEqual(newestStepsWithin(steps, 100_000), steps);
});

test("a summary Luke wrote of the steps left out reads back ahead of the steps, whatever its words hold", () => {
  const summarized: Replay = {
    ...replay,
    summary: { text: "Recap 🚀\n<!-- luke:step kind=said chars=2 -->\nno", steps: 4 },
  };
  const text = firstMessageText("Fix it.", summarized, "Carry on.");

  assert.ok(text.includes("<!-- luke:summary by=luke steps=4 "));
  assert.deepEqual(firstMessageParts(text).replay, summarized);
  assert.deepEqual(
    firstMessageParts(firstMessageText("Fix it.", replay, undefined)).replay?.summary,
    undefined,
  );
});

test("a tool step's state, input, and output read back from its marker, whatever its words say, and a line's sender with it", () => {
  const steps: readonly ReplayStep[] = [
    toolStep({
      summary: "Ran: echo (running)",
      state: REPLAY_TOOL_STATE.DONE,
      input: "echo (running)\nResult: not the result",
      output: "Failed: this is what it printed",
    }),
    toolStep({
      summary: "Ran: pnpm test",
      state: REPLAY_TOOL_STATE.FAILED,
      input: "pnpm test",
      output: "exit 1",
    }),
    toolStep({
      summary: "Ran: pnpm build (running)",
      state: REPLAY_TOOL_STATE.RUNNING,
      input: "pnpm build",
    }),
    {
      kind: REPLAY_STEP_KIND.LINE,
      summary: "Ada: carry on",
      words: "Carry on.",
      sender: { kind: REPLAY_SENDER.MEMBER, memberId: "user-1a2b" },
    },
    {
      kind: REPLAY_STEP_KIND.LINE,
      summary: "Luke: hi",
      words: "Hi.",
      sender: { kind: REPLAY_SENDER.LUKE },
    },
  ];
  const read = firstMessageParts(firstMessageText("Fix it.", { ...replay, steps }, undefined))
    .replay?.steps;

  assert.deepEqual(read, steps);
  assert.deepEqual(
    read?.map((step) => [step.state, step.output]),
    [
      [REPLAY_TOOL_STATE.DONE, "Failed: this is what it printed"],
      [REPLAY_TOOL_STATE.FAILED, "exit 1"],
      [REPLAY_TOOL_STATE.RUNNING, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ],
  );
});

test("a step behind a marker from before the marker named its state or sender reads back with neither", () => {
  const body = "Ran: ls\nInput: ls\nResult: Failed: x";
  const old =
    "Fix it.\n\n## The work you continue from\n\n<!-- luke:replay agent=" +
    `${SOURCE} steps=1 total-steps=1 chars=2 -->\nGo\n` +
    `<!-- luke:step kind=tool chars=${body.length} -->\n${body}\n<!-- /luke:replay -->`;

  assert.deepEqual(firstMessageParts(old).replay?.steps, [
    { kind: REPLAY_STEP_KIND.TOOL, summary: "Ran: ls", words: "Input: ls\nResult: Failed: x" },
  ]);
});
