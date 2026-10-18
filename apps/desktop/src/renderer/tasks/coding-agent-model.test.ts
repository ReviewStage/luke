import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON } from "@luke/features/failure-remedy";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import {
  AGENT_PART,
  agentLines,
  agentListCallIds,
  agentParts,
  agentWorkingPhase,
  checkoutCommand,
  choiceLabel,
  choiceModelId,
  choiceOn,
  delegates,
  effortFor,
  followsAgent,
  knownDeveloperRows,
  messageFailureNote,
  messageFailureWords,
  messageWords,
  modelLabel,
  offeredModels,
  publishedUrl,
  pullRequestPillLabel,
  pullRequestStateWord,
  readModelChoice,
  type SentLine,
  settledPlanEdits,
  sidebarCallIds,
  startedAgentOf,
  unreadSentLines,
  withAgentRun,
} from "./coding-agent-model";

test("the transcript is followed only while the tab shows and the agent may still write", () => {
  assert.equal(followsAgent({ shown: true, status: CODING_AGENT_STATUS.RUNNING }), true);
  assert.equal(followsAgent({ shown: true, status: CODING_AGENT_STATUS.STARTING }), true);
  assert.equal(followsAgent({ shown: false, status: CODING_AGENT_STATUS.RUNNING }), false);
  for (const ended of [
    CODING_AGENT_STATUS.COMPLETED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_STATUS.CANCELLED,
  ]) {
    assert.equal(followsAgent({ shown: true, status: ended }), false, ended);
  }
});

test("a model is named by the catalog where it has been read, else by its own id made readable, either way without Claude before its name", () => {
  const models = [
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["high"],
    },
    {
      id: "openai/gpt-5.6-terra",
      name: "GPT-5.6 Terra",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["high"],
    },
  ];
  assert.equal(modelLabel("anthropic/claude-opus-5.5", models), "Opus 5.5");
  assert.equal(modelLabel("openai/gpt-5.6-terra", models), "GPT-5.6 Terra");
  assert.equal(modelLabel("anthropic/claude-opus-5.5"), "Opus 5.5");
  assert.equal(modelLabel("openai/gpt-6.1-sol"), "GPT 6.1 Sol");
  assert.equal(modelLabel("openai/gpt-6.1-sol", models), "GPT 6.1 Sol");
});

test("a stored message's parts are read for drawing: text, reasoning, a tool call with its state, and anything else skipped", () => {
  const parts = agentParts({
    id: "m",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Read the guide first." },
      {
        type: "tool-bash",
        toolCallId: "call_1",
        state: "output-error",
        input: { command: "pnpm check" },
        errorText: "exit 1",
      },
      {
        type: "tool-read_file",
        toolCallId: "call_2",
        state: "output-available",
        input: {},
        output: "ok",
      },
      { type: "text", text: "Done." },
      { type: "data-weather", data: {} },
      { type: "text" },
    ],
  });

  assert.deepEqual(parts, [
    { kind: AGENT_PART.STEP_START },
    { kind: AGENT_PART.REASONING, text: "Read the guide first." },
    {
      kind: AGENT_PART.TOOL,
      tool: "bash",
      callId: "call_1",
      state: TOOL_STATE.OUTPUT_ERROR,
      input: { command: "pnpm check" },
      output: undefined,
      errorText: "exit 1",
    },
    {
      kind: AGENT_PART.TOOL,
      tool: "read_file",
      callId: "call_2",
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      input: {},
      output: "ok",
      errorText: undefined,
    },
    { kind: AGENT_PART.TEXT, text: "Done." },
    { kind: AGENT_PART.OTHER },
    { kind: AGENT_PART.OTHER },
  ]);
});

/** A row of the developer's, as the service writes one. */
function developer(id: string, text: string): CodingAgentMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

test("a sent line is read back by a developer's row it did not know holding its words, one row answering one line in order", () => {
  const task = developer("m-plan", "Go on.");
  const sent = (id: string, text: string, known: readonly CodingAgentMessage[]): SentLine => ({
    id,
    text,
    attachments: [],
    known: knownDeveloperRows(known),
    steers: false,
  });
  // The plan already says the same words: the line is not read back by it.
  const first = sent("sent-1", "Go on.", [task]);
  assert.deepEqual(unreadSentLines([first], [task]).lines, [first]);
  // Two lines of the same words are read back one row at a time, in order.
  const second = sent("sent-2", "Go on.", [task]);
  const one = [task, developer("m-1", "Go on.")];
  const read = unreadSentLines([first, second], one);
  assert.deepEqual(read.lines, [second]);
  assert.deepEqual([...read.taken], ["m-1"]);
  // Read again with the first line let go, the row it took stays taken: the second line waits for its own.
  assert.deepEqual(unreadSentLines(read.lines, one, read.taken).lines, [second]);
  const two = [...one, developer("m-2", "Go on.")];
  assert.deepEqual(unreadSentLines(read.lines, two, read.taken).lines, []);
  assert.deepEqual(unreadSentLines([first, second], two).lines, []);
  // Other words are nobody's.
  assert.deepEqual(unreadSentLines([first], [task, developer("m-3", "Stop.")]).lines, [first]);
  assert.equal(messageWords(two[2] ?? task), "Go on.");
});

test("a chat notice of the same words as a line still on its way never reads that line back; the developer's own row does", () => {
  const plan = developer("m-plan", "Go on.");
  const line: SentLine = {
    id: "sent-1",
    text: "Stop.",
    attachments: [],
    steers: false,
    known: knownDeveloperRows([plan]),
  };
  const notice: CodingAgentMessage = {
    ...developer("m-notice", "Stop."),
    metadata: { author: "human", channel: "chat", chat_seq: 9, from: "maria" },
  };
  assert.deepEqual(unreadSentLines([line], [plan, notice]).lines, [line]);
  const typed: CodingAgentMessage = {
    ...developer("m-1", "Stop."),
    metadata: { author: "developer", channel: "typed" },
  };
  assert.deepEqual(unreadSentLines([line], [plan, notice, typed]).lines, []);
});

test("the lines sent and not read back follow the transcript's rows, as the developer's own, in the order they went", () => {
  const task = developer("m-plan", "Go on.");
  const taken = developer("m-1", "Taken.");
  const lines: SentLine[] = [
    { id: "sent-1", text: "Soon.", attachments: [], known: new Set(), steers: false },
    { id: "sent-2", text: "Later.", attachments: [], known: new Set(), steers: false },
  ];
  const drawn = agentLines([task, taken], lines);
  assert.deepEqual(
    drawn.map((each) => [each.id, each.role, messageWords(each)]),
    [
      ["m-plan", "user", "Go on."],
      ["m-1", "user", "Taken."],
      ["sent-1", "user", "Soon."],
      ["sent-2", "user", "Later."],
    ],
  );
});

const PULL_REQUEST: CodingAgentPullRequest = {
  number: 123,
  title: "Teammate invitations",
  url: "https://github.com/acme/relay/pull/123",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

test("the checkout command fetches and switches to the branch, and the chip opens the pull request, else the branch compared, else nowhere", () => {
  assert.equal(
    checkoutCommand("luke/teammate-invitations"),
    "git fetch origin luke/teammate-invitations && git switch luke/teammate-invitations",
  );
  const repository = "acme/relay";
  assert.equal(
    publishedUrl({ repository, branch: "luke/x", pullRequest: PULL_REQUEST }),
    "https://github.com/acme/relay/pull/123",
  );
  assert.equal(
    publishedUrl({ repository, branch: "luke/x", pullRequest: null }),
    "https://github.com/acme/relay/compare/luke/x?expand=1",
  );
  assert.equal(publishedUrl({ repository, branch: null, pullRequest: null }), undefined);
  // A branch a shell or an address would read into is quoted or encoded, never read.
  assert.equal(
    checkoutCommand("luke/$(touch pwned)'x"),
    "git fetch origin 'luke/$(touch pwned)'\\''x' && git switch 'luke/$(touch pwned)'\\''x'",
  );
  assert.equal(
    publishedUrl({ repository, branch: "luke/issue#12 fix", pullRequest: null }),
    "https://github.com/acme/relay/compare/luke/issue%2312%20fix?expand=1",
  );
});

test("the row says where the pull request stands only once it is a draft, merged, or closed, and the mark says it to a reader without its colour", () => {
  assert.deepEqual(Object.values(PULL_REQUEST_STATE).map(pullRequestStateWord), [
    undefined,
    "Draft",
    "Merged",
    "Closed",
  ]);
  assert.equal(
    pullRequestPillLabel({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED }),
    "Pull request #123, merged",
  );
});

test("a fast version is folded into its base model by its id, read back as the base with Fast on, and named in the choice line", () => {
  const model = (id: string, name: string) => ({
    id,
    name,
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  });
  const models = [
    model("anthropic/claude-opus-5.5-fast", "Claude Opus 5.5 (Fast)"),
    model("anthropic/claude-opus-5.5", "Claude Opus 5.5"),
    model("anthropic/claude-fable-5", "Claude Fable 5"),
    // A suffixed id with no base beside it is a model of its own.
    model("anthropic/claude-haiku-4-fast", "Claude Haiku 4 (Fast)"),
  ];
  const offered = offeredModels(models);
  assert.deepEqual(
    offered.map((each) => [each.model.id, each.fast?.id]),
    [
      ["anthropic/claude-opus-5.5", "anthropic/claude-opus-5.5-fast"],
      ["anthropic/claude-fable-5", undefined],
      ["anthropic/claude-haiku-4-fast", undefined],
    ],
  );
  assert.deepEqual(readModelChoice(models, "anthropic/claude-opus-5.5-fast"), {
    base: "anthropic/claude-opus-5.5",
    fast: true,
  });
  assert.deepEqual(readModelChoice(models, "anthropic/claude-opus-5.5"), {
    base: "anthropic/claude-opus-5.5",
    fast: false,
  });
  assert.deepEqual(readModelChoice(models, "anthropic/claude-haiku-4-fast"), {
    base: "anthropic/claude-haiku-4-fast",
    fast: false,
  });
  const [opus, fable] = offered;
  assert.ok(opus && fable);
  assert.equal(choiceModelId(opus, true), "anthropic/claude-opus-5.5-fast");
  assert.equal(choiceModelId(opus, false), "anthropic/claude-opus-5.5");
  assert.equal(choiceModelId(fable, true), "anthropic/claude-fable-5", "no fast version to name");
  assert.equal(
    choiceLabel({ model: "anthropic/claude-opus-5.5-fast", effort: "high" }, models),
    "Opus 5.5 High Fast",
  );
  assert.equal(
    choiceLabel({ model: "anthropic/claude-fable-5", effort: "xhigh" }, models),
    "Fable 5 Extra high",
  );
});

test("a choice names its window after the effort only where it runs on the standard one and the model offers two, and a change of model keeps the standard window only where the next model offers two too", () => {
  const models = [
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      provider: MODEL_PROVIDER.OPENAI,
      efforts: ["low", "high"],
      contextWindows: { standardTokens: 272_000, longTokens: 1_050_000 },
    },
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "high"],
    },
  ];
  const standard = {
    model: "openai/gpt-5.5",
    effort: "high",
    contextWindow: CONTEXT_WINDOW.STANDARD,
  };
  assert.equal(choiceLabel(standard, models), "GPT-5.5 High 272K");
  assert.equal(choiceLabel({ model: "openai/gpt-5.5", effort: "high" }, models), "GPT-5.5 High");
  assert.equal(
    choiceLabel({ ...standard, contextWindow: CONTEXT_WINDOW.LONG }, models),
    "GPT-5.5 High",
  );
  assert.equal(
    choiceLabel({ ...standard, model: "anthropic/claude-opus-5.5" }, models),
    "Opus 5.5 High",
  );

  assert.deepEqual(
    choiceOn(models, { model: "openai/gpt-5.5", effort: "low" }, CONTEXT_WINDOW.STANDARD),
    { model: "openai/gpt-5.5", effort: "low", contextWindow: CONTEXT_WINDOW.STANDARD },
  );
  assert.deepEqual(
    choiceOn(
      models,
      { model: "anthropic/claude-opus-5.5", effort: "low" },
      CONTEXT_WINDOW.STANDARD,
    ),
    { model: "anthropic/claude-opus-5.5", effort: "low" },
  );
  assert.deepEqual(
    choiceOn(models, { model: "openai/gpt-5.5", effort: "low" }, CONTEXT_WINDOW.LONG),
    { model: "openai/gpt-5.5", effort: "low" },
  );
});

test("an effort carried to a model that lacks it falls to the nearest the model lists at or below it on the scale, else the lowest above, else the model's first", () => {
  assert.equal(effortFor(["low", "medium", "high"], "high"), "high", "listed, kept");
  assert.equal(effortFor(["low", "medium", "high"], "xhigh"), "high", "Extra high lands on High");
  assert.equal(effortFor(["low", "high", "max"], "medium"), "low");
  assert.equal(effortFor(["minimal", "low"], "max"), "low");
  assert.equal(effortFor(["high", "max"], "low"), "high", "nothing below, so the lowest above");
  assert.equal(effortFor(["low", "high"], undefined), "low", "nothing chosen yet");
  assert.equal(
    effortFor(["turbo", "high"], "ludicrous"),
    "turbo",
    "a name off the scale takes the first",
  );
  assert.equal(
    effortFor(["turbo", "medium"], "high"),
    "medium",
    "names off the scale are passed over",
  );
  assert.equal(effortFor([], "high"), undefined);
});

test("the plan edits that have answered are counted, not the ones still out or the other calls", () => {
  const messages: CodingAgentMessage[] = [
    {
      id: "m1",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-edit_plan",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: {},
        },
        { type: "tool-edit_plan", toolCallId: "c2", state: "input-available", input: {} },
        { type: "tool-bash", toolCallId: "c3", state: "output-available", input: {}, output: {} },
      ],
    },
    {
      id: "m2",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          type: "tool-edit_plan",
          toolCallId: "c4",
          state: "output-available",
          input: {},
          output: {},
        },
      ],
    },
  ];
  assert.equal(settledPlanEdits(messages), 2);
  assert.equal(settledPlanEdits([]), 0);
});

test("the calls that move a task's agents are its starts, archives, and unarchives once answered, by call id, under a start's earlier name too; a call still out or of another tool names none", () => {
  const call = (callId: string, tool: string, state: string, output?: WireRecord) => ({
    type: `tool-${tool}`,
    toolCallId: callId,
    state,
    input: { agentId: "agent-2" },
    ...(output === undefined ? undefined : { output }),
  });
  const accepted = { status: "accepted", agent: { id: "agent-2" } };
  const messages: CodingAgentMessage[] = [
    {
      id: "m1",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        call("c1", "start_agent", "output-available", accepted),
        call("c2", "archive_agent", "output-available", accepted),
        call("c3", "unarchive_agent", "input-available"),
        call("c4", "message_agent", "output-available", accepted),
        call("c5", "start_coding_agent", "output-available", accepted),
        call("c6", "unarchive_agent", "output-available", accepted),
      ],
    },
  ];

  assert.deepEqual(agentListCallIds(messages), ["c1", "c2", "c5", "c6"]);
  assert.deepEqual(agentListCallIds([]), []);
});

test("the starts that made a new task and the accepted section calls are named by call id once answered, and a start on a task, a refused section call, a call still out, or another tool's answer names none", () => {
  const call = (callId: string, tool: string, output?: WireRecord) => ({
    type: `tool-${tool}`,
    toolCallId: callId,
    state: output === undefined ? "input-available" : "output-available",
    input: { newTask: "Expiry" },
    ...(output === undefined ? undefined : { output }),
  });
  const made = { status: "accepted", agent: { id: "agent-2" }, newTask: { id: "task-2" } };
  const messages: CodingAgentMessage[] = [
    {
      id: "m1",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        call("c1", "start_agent", made),
        call("c2", "start_agent", { status: "accepted", agent: { id: "agent-3" } }),
        call("c3", "start_agent"),
        call("c4", "message_agent", made),
        call("c5", "create_section", { status: "accepted", section: { id: "s-1" } }),
        call("c6", "move_task", { status: "rejected", reason: "Not moved." }),
        call("c7", "delete_section"),
        call("c8", "move_task", { status: "accepted", task: { id: "task-2" }, section: null }),
      ],
    },
  ];

  assert.deepEqual(sidebarCallIds(messages), ["c1", "c5", "c8"]);
});

test("a working agent is starting until its turn opens, thinking until the turn draws a row, and working after, a steering line leaving the turn under way as it was and a closing turn ending as working", () => {
  const task: CodingAgentMessage = {
    id: "m-plan",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: AGENT_PART.TEXT, text: "# Invitations" }],
  };
  const opened: CodingAgentMessage = {
    id: "m-turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: AGENT_PART.STEP_START }],
    startedAt: 1_000,
  };
  const calling: CodingAgentMessage = {
    ...opened,
    parts: [
      { type: AGENT_PART.STEP_START },
      { type: "tool-bash", toolCallId: "call_1", state: TOOL_STATE.INPUT_AVAILABLE },
    ],
  };
  const closed: CodingAgentMessage = { ...calling, finishedAt: 9_000 };
  const line: CodingAgentMessage = {
    id: "m-line",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: AGENT_PART.TEXT, text: "Also expire them after a week." }],
  };
  // Before the session runs a turn, whatever stands, and before the turn writes its journal.
  assert.equal(agentWorkingPhase([task], true), "starting");
  assert.equal(agentWorkingPhase([task, opened], true), "starting");
  assert.equal(agentWorkingPhase([task], false), "starting");
  // The turn open with nothing past its step boundary is the model at its first step.
  assert.equal(agentWorkingPhase([task, opened], false), "thinking");
  assert.equal(agentWorkingPhase([task, calling], false), "working");
  // A line after a closed turn awaits a turn of its own; one sent into an open turn steers it.
  assert.equal(agentWorkingPhase([task, closed, line], false), "starting");
  // A turn closing ahead of its row's settling ends as it worked, not as a start.
  assert.equal(agentWorkingPhase([task, closed], false), "working");
  assert.equal(agentWorkingPhase([task, calling, line], false), "working");
  assert.equal(agentWorkingPhase([task, opened, line], false), "thinking");
});

test("a planning transcript's raw parts read as the agent tab reads them: eve's own worker call is a delegation, and a start names the agent it began once it answered one", () => {
  const [worker, started, refused, coding] = agentParts({
    id: "turn-raw",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-worker",
        toolCallId: "w",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: { message: "Compare the queues." },
        output: "Started task worker-ha1bbn.",
      },
      {
        type: "tool-start_coding_agent",
        toolCallId: "s",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: { task: "Fix the invite emails." },
        output: { status: "accepted", agent: { id: "agent-9" } },
      },
      {
        type: "tool-start_coding_agent",
        toolCallId: "r",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        input: {},
        output: { status: "rejected", reason: "The plan has no repository." },
      },
      { type: "tool-bash", toolCallId: "b", state: TOOL_STATE.OUTPUT_AVAILABLE, input: {} },
    ],
  });
  assert.ok(worker?.kind === AGENT_PART.TOOL && started?.kind === AGENT_PART.TOOL);
  assert.ok(refused?.kind === AGENT_PART.TOOL && coding?.kind === AGENT_PART.TOOL);
  assert.equal(delegates(worker), true);
  assert.equal(delegates(coding), false);
  assert.equal(startedAgentOf(started), "agent-9");
  assert.equal(startedAgentOf(refused), undefined);
  assert.equal(startedAgentOf(worker), undefined);
});

test("a message refused for a repository out of reach names the plan's remedy on a plan, and on an agent with no plan says its words alone but where the remedy needs no plan", () => {
  const refused = {
    failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
    unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: "acme/relay" },
  } as const;

  const onTask = messageFailureNote(refused, "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10");
  const taskless = messageFailureNote(refused, null);

  assert.equal("taskId" in onTask && onTask.taskId, "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10");
  assert.deepEqual(taskless, {
    reason: FAILURE_REASON.OTHER,
    text: messageFailureWords(CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE),
  });
  // Giving the repository to Luke on GitHub is pressed on GitHub, not the task, so it stands for an agent with no task.
  const notSelected = messageFailureNote(
    {
      failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      unreached: {
        reason: REPOSITORY_UNREACHED.NOT_SELECTED,
        repository: "acme/relay",
        settingsUrl: "https://github.com/settings/installations/7",
      },
    },
    null,
  );
  assert.deepEqual(notSelected, {
    reason: FAILURE_REASON.ADD_REPOSITORY,
    text: "Luke on GitHub doesn't have access to acme/relay.",
    repository: "acme/relay",
    settingsUrl: "https://github.com/settings/installations/7",
  });
});

test("a page that reads an agent as the list already holds it answers the list as it was, and one that moves it moves only that agent", () => {
  const agent = (id: string): CodingAgentSummary => ({
    id,
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: id,
    createdAt: 1,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c99",
    runStartedAt: 5,
  });
  const agents = [agent("a"), agent("b")];
  assert.equal(
    withAgentRun(agents, "a", { status: CODING_AGENT_STATUS.RUNNING, runStartedAt: 5 }),
    agents,
  );
  assert.equal(
    withAgentRun(agents, "unknown", {
      status: CODING_AGENT_STATUS.COMPLETED,
    }),
    agents,
  );
  const ended = withAgentRun(agents, "a", {
    status: CODING_AGENT_STATUS.COMPLETED,
  });
  assert.equal(ended[0]?.status, CODING_AGENT_STATUS.COMPLETED);
  assert.equal(ended[0]?.runStartedAt, undefined);
  assert.equal(ended[1], agents[1]);
});
