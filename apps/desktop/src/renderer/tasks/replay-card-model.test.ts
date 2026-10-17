import assert from "node:assert/strict";
import {
  firstMessageText,
  REPLAY_STEP_KIND,
  type Replay,
  START_NOTE_HEADING,
} from "@luke/features/agent-replay";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { test } from "vitest";
import { messageFileChips } from "./attached-file-chips";
import { messageWords } from "./coding-agent-model";
import {
  briefAgent,
  leftOutLine,
  REPLAY_VERB,
  replayCount,
  replayOpening,
  replayVerb,
  stepLine,
} from "./replay-card-model";

/**
 * replay-card-model.test.ts -- an agent started from another opens on its
 * brief, its replay, and its note read apart from its first message, the
 * card says Continued or Forked and how many steps of how many, and an
 * agent continued from an automation's run is drawn from the run's
 * automation. A message whose markers do not add up has no replay.
 * Synthetic throughout.
 */

const SOURCE_ID = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
const FORKED_AT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const STEPS: Replay["steps"] = [
  { kind: REPLAY_STEP_KIND.LINE, summary: "Luke: Use seven days.", words: "Use seven days." },
  {
    kind: REPLAY_STEP_KIND.TOOL,
    summary: "Read: invite.ts",
    words: "read_file(invite.ts)\n→ 42 lines",
  },
  { kind: REPLAY_STEP_KIND.SAID, summary: "Said: Done: for now.", words: "Done: for now." },
];

function replay(overrides: Partial<Replay> = {}): Replay {
  return { agentId: SOURCE_ID, preamble: "Carry on.", steps: STEPS, totalSteps: 3, ...overrides };
}

const FILE = { type: "file", mediaType: "image/png", filename: "flow.png", url: "data:," };

function first(text: string): CodingAgentMessage {
  return { id: "first", role: MESSAGE_ROLE.USER, parts: [FILE, { type: "text", text }] };
}

function summary(overrides: Partial<CodingAgentSummary>): CodingAgentSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    ...overrides,
  };
}

test("a first message holding a replay opens on its brief with its files, the replay, and the note as a line of its own with none", () => {
  const text = firstMessageText("# Invite flow", replay(), "Try five days instead.");
  const opening = replayOpening(first(text));
  assert.ok(opening !== undefined);
  assert.equal(messageWords(opening.brief), "# Invite flow");
  assert.deepEqual(
    messageFileChips(opening.brief).map((file) => file.name),
    ["flow.png"],
  );
  assert.deepEqual(opening.replay.steps, STEPS);
  assert.ok(opening.note !== undefined);
  assert.equal(messageWords(opening.note), "Try five days instead.");
  assert.deepEqual(messageFileChips(opening.note), []);
  // The note is drawn under an id of its own, so no Copy link under it names the brief's message.
  assert.notEqual(opening.note.id, "first");
});

test("a replay with no note opens on its brief and the replay alone, a coding agent's note read as a note too", () => {
  assert.equal(
    replayOpening(first(firstMessageText("Fix it.", replay(), undefined)))?.note,
    undefined,
  );
  const agents = firstMessageText("Fix it.", replay(), "Go.", START_NOTE_HEADING.AGENT);
  const note = replayOpening(first(agents))?.note;
  assert.equal(note === undefined ? undefined : messageWords(note), "Go.");
});

test("a first message with no replay, or one whose markers do not add up, has no opening of its own", () => {
  assert.equal(replayOpening(first("# Invite flow")), undefined);
  const text = firstMessageText("# Invite flow", replay(), undefined);
  // A step's length one short no longer adds up.
  const broken = text.replace(
    /chars=(\d+) -->\nRead/u,
    (_, chars) => `chars=${Number(chars) - 1} -->\nRead`,
  );
  assert.notEqual(broken, text);
  assert.equal(replayOpening(first(broken)), undefined);
});

test("a replay is a continue with no message and a fork at one, and says its steps of how many where it left the earliest out", () => {
  assert.equal(replayVerb(replay()), REPLAY_VERB.CONTINUED);
  assert.equal(replayVerb(replay({ messageId: FORKED_AT })), REPLAY_VERB.FORKED);
  assert.equal(replayCount(replay()), "3 steps");
  assert.equal(replayCount(replay({ steps: STEPS.slice(0, 1), totalSteps: 1 })), "1 step");
  assert.equal(replayCount(replay({ totalSteps: 212 })), "3 of 212 steps");
  assert.equal(leftOutLine(replay()), undefined);
  assert.equal(
    leftOutLine(replay({ totalSteps: 212 })),
    "209 earlier steps were left out to keep the replay within its size limit.",
  );
  assert.equal(
    leftOutLine(replay({ totalSteps: 4 })),
    "1 earlier step was left out to keep the replay within its size limit.",
  );
});

test("a line sent to the source is named by whoever its summary says sent it, and the source's words and calls are the agent's", () => {
  assert.deepEqual(STEPS.map(stepLine), [
    { who: "Luke", line: "Use seven days." },
    { who: "Agent", line: "Read: invite.ts" },
    { who: "Agent", line: "Done: for now." },
  ]);
  // A summary that names no sender is the developer's.
  assert.deepEqual(stepLine({ kind: REPLAY_STEP_KIND.LINE, summary: "Go", words: "Go" }), {
    who: "Developer",
    line: "Go",
  });
});

test("an agent continued from an automation's run, at any remove, is drawn from the run's automation, and one from a plan's agent as itself", () => {
  const run = summary({
    id: "11111111-1111-4111-8111-111111111111",
    automationId: "22222222-2222-4222-8222-222222222222",
    automationName: "Nightly triage",
  });
  const continued = summary({
    id: "33333333-3333-4333-8333-333333333333",
    brief: CODING_AGENT_BRIEF.PROMPT,
    from: { agentId: run.id, steps: 3, totalSteps: 3 },
  });
  const again = summary({
    id: "44444444-4444-4444-8444-444444444444",
    from: { agentId: continued.id, messageId: FORKED_AT, steps: 2, totalSteps: 2 },
  });
  const drawn = briefAgent(again, [run, continued, again]);
  assert.equal(drawn.id, again.id);
  assert.equal(drawn.automationId, run.automationId);
  assert.equal(drawn.automationName, "Nightly triage");
  const planned = summary({ id: "55555555-5555-4555-8555-555555555555" });
  const fromPlan = summary({ from: { agentId: planned.id, steps: 1, totalSteps: 1 } });
  assert.equal(briefAgent(fromPlan, [planned, fromPlan]), fromPlan);
  // A source the list does not hold leaves the agent as it is.
  assert.equal(briefAgent(continued, []), continued);
});
