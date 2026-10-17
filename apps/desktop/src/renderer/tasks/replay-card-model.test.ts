import assert from "node:assert/strict";
import {
  firstMessageText,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  type Replay,
  type ReplayStep,
  START_NOTE_HEADING,
  toolStep,
} from "@luke/features/agent-replay";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { CALL_KIND } from "@luke/features/turn-rows";
import { MESSAGE_ROLE } from "@luke/wire";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import { messageFileChips } from "./attached-file-chips";
import { messageWords } from "./coding-agent-model";
import {
  briefAgent,
  leftOutLine,
  REPLAY_VERB,
  replayCount,
  replayOpening,
  replayVerb,
  STEP_VIEW,
  stepLine,
  stepView,
  summaryLine,
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

test("the same first message answers the same opening each time it is read, so a render hands its rows the same brief and replay; a new message reads afresh", () => {
  const text = firstMessageText("# Invite flow", replay(), "Try five days instead.");
  const message = first(text);
  const opening = replayOpening(message);
  assert.ok(opening !== undefined);
  assert.equal(replayOpening(message), opening);
  const again = replayOpening(first(text));
  assert.notEqual(again, opening);
  assert.deepEqual(again, opening);
  // A message with no replay is remembered as having none.
  const plain = first("# Invite flow");
  assert.equal(replayOpening(plain), undefined);
  assert.equal(replayOpening(plain), undefined);
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
  // A sender whose name holds the separator keeps all of it.
  assert.deepEqual(
    stepLine({
      kind: REPLAY_STEP_KIND.LINE,
      summary: "Nightly: deploy: Run tests: all of them",
      words: "Run tests: all of them",
    }),
    { who: "Nightly: deploy", line: "Run tests: all of them" },
  );
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

test("a call's step is drawn as the row its call wears in a transcript: its kind by its verb, its subject, its input and result, failed or running as its words say", () => {
  const call = (summary: string, words: string) =>
    stepView({ kind: REPLAY_STEP_KIND.TOOL, summary, words });
  assert.deepEqual(
    call("Read: src/invite.ts", 'Input: {"filePath":"src/invite.ts"}\nResult: 42 lines'),
    {
      kind: STEP_VIEW.CALL,
      call: CALL_KIND.READ_FILE,
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      subject: "src/invite.ts",
      input: '{"filePath":"src/invite.ts"}',
      output: "42 lines",
      errorText: undefined,
    },
  );
  assert.deepEqual(
    call("Ran: pnpm test", 'Input: {"command":"pnpm test"}\nResult: Failed: exit 1'),
    {
      kind: STEP_VIEW.CALL,
      call: CALL_KIND.COMMAND,
      state: TOOL_STATE.OUTPUT_ERROR,
      subject: "pnpm test",
      input: '{"command":"pnpm test"}',
      output: undefined,
      errorText: "exit 1",
    },
  );
  const running = call(
    "Searched: invite (running)",
    "Input: {}\nResult: (no result: the call was still under way)",
  );
  assert.equal(running.kind === STEP_VIEW.CALL && running.state, TOOL_STATE.INPUT_AVAILABLE);
  assert.equal(running.kind === STEP_VIEW.CALL && running.subject, "invite");
  // A finished call whose subject ends in the mark's words keeps them, and its result.
  const placeholderLike = call(
    "Read: report (running)",
    "Input: {}\nResult: (no result found in archive)",
  );
  assert.equal(
    placeholderLike.kind === STEP_VIEW.CALL && placeholderLike.output,
    "(no result found in archive)",
  );
  const named = call("Read: report (running)", "Input: {}\nResult: 3 lines");
  assert.equal(named.kind === STEP_VIEW.CALL && named.state, TOOL_STATE.OUTPUT_AVAILABLE);
  assert.equal(named.kind === STEP_VIEW.CALL && named.subject, "report (running)");
  assert.equal(named.kind === STEP_VIEW.CALL && named.output, "3 lines");
  // An input is its JSON, so a result lead inside one of its strings is no boundary.
  const quoted = call(
    "Ran: printf",
    'Input: {"command":"printf \'x\\nResult: fake\'"}\nResult: done',
  );
  assert.equal(quoted.kind === STEP_VIEW.CALL && quoted.output, "done");
  // A verb no transcript row says is another call's.
  const used = call("Used: list_tasks", "Input: {}\nResult: []");
  assert.equal(used.kind === STEP_VIEW.CALL && used.call, CALL_KIND.OTHER);
});

test("a line's step is drawn as a sent message under its sender, and the agent's words as its words whole", () => {
  assert.deepEqual(
    stepView({
      kind: REPLAY_STEP_KIND.LINE,
      summary: "Luke: Use seven days.",
      words: "Use seven days.",
    }),
    {
      kind: STEP_VIEW.LINE,
      sender: "Luke",
      sentBy: undefined,
      own: false,
      words: "Use seven days.",
    },
  );
  assert.deepEqual(
    stepView({ kind: REPLAY_STEP_KIND.SAID, summary: "Said: Done.", words: "Done.\n\nAll green." }),
    {
      kind: STEP_VIEW.SAID,
      words: "Done.\n\nAll green.",
    },
  );
});

test("a call's step read from its marker is drawn as its marker says, whatever its words look like", () => {
  // A successful result that reads like a failure, and a subject that reads like a running call, are what they were.
  const done = stepView(
    toolStep({
      summary: "Read: report (running)",
      state: REPLAY_TOOL_STATE.DONE,
      input: '{"filePath":"report (running)"}',
      output: "Failed: 0 tests\nResult: all green",
    }),
  );
  assert.deepEqual(done, {
    kind: STEP_VIEW.CALL,
    call: CALL_KIND.READ_FILE,
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    subject: "report (running)",
    input: '{"filePath":"report (running)"}',
    output: "Failed: 0 tests\nResult: all green",
    errorText: undefined,
  });
  const failed = stepView(
    toolStep({
      summary: "Ran: pnpm test",
      state: REPLAY_TOOL_STATE.FAILED,
      input: "{}",
      output: "exit 1",
    }),
  );
  assert.equal(failed.kind === STEP_VIEW.CALL && failed.state, TOOL_STATE.OUTPUT_ERROR);
  assert.equal(failed.kind === STEP_VIEW.CALL && failed.errorText, "exit 1");
  const running = stepView(
    toolStep({ summary: "Ran: pnpm dev (running)", state: REPLAY_TOOL_STATE.RUNNING, input: "{}" }),
  );
  assert.equal(running.kind === STEP_VIEW.CALL && running.state, TOOL_STATE.INPUT_AVAILABLE);
  assert.equal(running.kind === STEP_VIEW.CALL && running.subject, "pnpm dev");
  assert.equal(running.kind === STEP_VIEW.CALL && running.output, undefined);
});

test("a summary Luke wrote of the oldest steps is named on its row, and the steps it stands for are not left out", () => {
  const summarized = replay({ summary: { text: "Read the code.", steps: 174 }, totalSteps: 180 });
  assert.equal(summaryLine(summarized), "Summary of 174 earlier steps (written by Luke)");
  assert.equal(
    leftOutLine(summarized),
    "3 earlier steps were left out to keep the replay within its size limit.",
  );
  assert.equal(
    leftOutLine(replay({ summary: { text: "All of it.", steps: 209 }, totalSteps: 212 })),
    undefined,
  );
  assert.equal(summaryLine(replay()), undefined);
});

test("the note's own files go with the note and the brief's stay with the brief, by the counts its marker names", () => {
  const file = (name: string, mediaType: string) => ({
    type: "file",
    mediaType,
    filename: name,
    url: "data:,",
  });
  const text = firstMessageText(
    "Fix it.",
    replay(),
    "Use this design.",
    START_NOTE_HEADING.DEVELOPER,
    {
      text: 1,
      other: 1,
    },
  );
  const message: CodingAgentMessage = {
    id: "first",
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text },
      file("brief.txt", "text/plain"),
      file("notes.txt", "text/plain"),
      file("diagram.png", "image/png"),
      file("new-design.png", "image/png"),
    ],
  };
  const opening = replayOpening(message);
  assert.ok(opening?.note !== undefined);
  assert.deepEqual(
    messageFileChips(opening.brief).map((each) => each.name),
    ["brief.txt", "diagram.png"],
  );
  assert.deepEqual(
    messageFileChips(opening.note).map((each) => each.name),
    ["notes.txt", "new-design.png"],
  );
});

test("a line whose marker names its sender is named as a transcript's line is: a member by their account, the developer as the reader's own", () => {
  const view = (sender: NonNullable<ReplayStep["sender"]>, summary: string) =>
    stepView({ kind: REPLAY_STEP_KIND.LINE, summary, words: "Go.", sender });
  const member = view({ kind: REPLAY_SENDER.MEMBER, memberId: "user-charles" }, "Charles Pan: Go.");
  assert.deepEqual(member.kind === STEP_VIEW.LINE && member.sentBy, {
    kind: CODING_AGENT_SENDER.MEMBER,
    userId: "user-charles",
    name: "Charles Pan",
  });
  const agent = view({ kind: REPLAY_SENDER.AGENT }, "Fix the tile: Go.");
  assert.deepEqual(agent.kind === STEP_VIEW.LINE && agent.sentBy, {
    name: "Fix the tile",
    agent: true,
  });
  const own = view({ kind: REPLAY_SENDER.DEVELOPER }, "The developer: Go.");
  assert.equal(own.kind === STEP_VIEW.LINE && own.own, true);
  assert.equal(own.kind === STEP_VIEW.LINE ? own.sentBy : null, undefined);
});
