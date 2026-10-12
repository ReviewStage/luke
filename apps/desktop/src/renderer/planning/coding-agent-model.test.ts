import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { MESSAGE_ROLE } from "@sidecar/wire";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import {
  AGENT_PART,
  agentLines,
  agentParts,
  agentWorkingPhase,
  applyMessagesPage,
  checkoutCommand,
  choiceLabel,
  choiceModelId,
  choiceOn,
  closesComposer,
  effortFor,
  endLine,
  followsAgent,
  knownDeveloperRows,
  messageFailureNote,
  messageWords,
  modelLabel,
  offeredModels,
  opensOnGitHub,
  orderedModels,
  publishedUrl,
  pullRequestPillLabel,
  pullRequestStateWord,
  readModelChoice,
  type SentLine,
  START_NEEDS_REPOSITORY,
  settledPlanEdits,
  showsPublishedRow,
  startFailureNote,
  unreadSentLines,
  unsearchedModels,
  WORKING_PHASE,
} from "./coding-agent-model";

function message(id: string, text: string): CodingAgentMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

test("a page joins the messages held: one heard again is replaced in place, a new one joins at the end", () => {
  const held = [message("a", "first"), message("b", "second")];

  const joined = applyMessagesPage(held, [message("a", "first, amended"), message("c", "third")]);

  assert.deepEqual(
    joined.map((each) => [each.id, each.parts]),
    [
      ["a", [{ type: "text", text: "first, amended" }]],
      ["b", [{ type: "text", text: "second" }]],
      ["c", [{ type: "text", text: "third" }]],
    ],
  );
  assert.equal(applyMessagesPage(held, []), held);
});

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

test("only a page on GitHub opens from the transcript, and each Start refusal has its own words", () => {
  assert.equal(opensOnGitHub("https://github.com/acme/relay/pull/7"), true);
  assert.equal(opensOnGitHub("https://example.com/github.com/x"), false);
  assert.equal(opensOnGitHub("javascript:alert(1)"), false);
  assert.equal(startFailureNote(CODING_AGENT_CALL_FAILURE.NO_REPOSITORY), START_NEEDS_REPOSITORY);
  const notes = new Set(Object.values(CODING_AGENT_CALL_FAILURE).map(startFailureNote));
  assert.equal(notes.size, Object.values(CODING_AGENT_CALL_FAILURE).length);
});

test("a message's refusals each say what to do, the agent ended for good closes the box, and a refusal no message meets reads as no answer", () => {
  assert.match(messageFailureNote(CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY), /still starting/u);
  assert.match(messageFailureNote(CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG), /too long/u);
  assert.match(messageFailureNote(CODING_AGENT_CALL_FAILURE.AGENT_RETIRED), /ended for good/u);
  assert.match(messageFailureNote(CODING_AGENT_CALL_FAILURE.NOT_FOUND), /no longer exists/u);
  // An archive another Mac or a race made is said as such, under the box and beside Start alike.
  assert.match(
    messageFailureNote(CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED),
    /This plan is archived/u,
  );
  assert.match(startFailureNote(CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED), /This plan is archived/u);
  assert.equal(
    messageFailureNote(CODING_AGENT_CALL_FAILURE.NO_REPOSITORY),
    messageFailureNote(CODING_AGENT_CALL_FAILURE.INVALID_CHOICE),
  );
  // No answer is not a refusal: the words may have reached the agent.
  assert.match(messageFailureNote(CODING_AGENT_CALL_FAILURE.UNANSWERED), /didn't hear back/u);
  assert.equal(closesComposer(CODING_AGENT_CALL_FAILURE.AGENT_RETIRED), true);
  assert.equal(closesComposer(CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY), false);
});

/** A row of the developer's, as the service writes one. */
function developer(id: string, text: string): CodingAgentMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

test("a sent line is read back by a developer's row it did not know holding its words, one row answering one line in order", () => {
  const plan = developer("m-plan", "Go on.");
  const sent = (id: string, text: string, known: readonly CodingAgentMessage[]): SentLine => ({
    id,
    text,
    attachments: [],
    known: knownDeveloperRows(known),
  });
  // The plan already says the same words: the line is not read back by it.
  const first = sent("sent-1", "Go on.", [plan]);
  assert.deepEqual(unreadSentLines([first], [plan]).lines, [first]);
  // Two lines of the same words are read back one row at a time, in order.
  const second = sent("sent-2", "Go on.", [plan]);
  const one = [plan, developer("m-1", "Go on.")];
  const read = unreadSentLines([first, second], one);
  assert.deepEqual(read.lines, [second]);
  assert.deepEqual([...read.taken], ["m-1"]);
  // Read again with the first line let go, the row it took stays taken: the second line waits for its own.
  assert.deepEqual(unreadSentLines(read.lines, one, read.taken).lines, [second]);
  const two = [...one, developer("m-2", "Go on.")];
  assert.deepEqual(unreadSentLines(read.lines, two, read.taken).lines, []);
  assert.deepEqual(unreadSentLines([first, second], two).lines, []);
  // Other words are nobody's.
  assert.deepEqual(unreadSentLines([first], [plan, developer("m-3", "Stop.")]).lines, [first]);
  assert.equal(messageWords(two[2] ?? plan), "Go on.");
});

test("the lines sent and not read back follow the transcript's rows, as the developer's own, in the order they went", () => {
  const plan = developer("m-plan", "Go on.");
  const taken = developer("m-1", "Taken.");
  const lines: SentLine[] = [
    { id: "sent-1", text: "Soon.", attachments: [], known: new Set() },
    { id: "sent-2", text: "Later.", attachments: [], known: new Set() },
  ];
  const drawn = agentLines([plan, taken], lines);
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

test("the menus list the models by provider, Anthropic first, by lead family within each and the rest after, newest first within a family, the catalog's order kept between one version's models", () => {
  const model = (
    id: string,
    provider: typeof MODEL_PROVIDER.ANTHROPIC | typeof MODEL_PROVIDER.OPENAI,
  ) => ({
    id,
    name: id,
    provider,
    efforts: ["high"],
  });
  const ordered = orderedModels([
    model("openai/gpt-5.1-codex-max", MODEL_PROVIDER.OPENAI),
    model("anthropic/claude-opus-4.5", MODEL_PROVIDER.ANTHROPIC),
    model("openai/gpt-6-astra", MODEL_PROVIDER.OPENAI),
    model("anthropic/claude-fable-5.1", MODEL_PROVIDER.ANTHROPIC),
    model("anthropic/claude-opus-5.5-fast", MODEL_PROVIDER.ANTHROPIC),
    model("anthropic/claude-opus-5.5", MODEL_PROVIDER.ANTHROPIC),
    model("anthropic/claude-fable-5", MODEL_PROVIDER.ANTHROPIC),
    model("openai/gpt-5.6-luna", MODEL_PROVIDER.OPENAI),
  ]);

  assert.deepEqual(
    ordered.map((each) => each.id),
    [
      "anthropic/claude-opus-5.5-fast",
      "anthropic/claude-opus-5.5",
      "anthropic/claude-opus-4.5",
      "anthropic/claude-fable-5.1",
      "anthropic/claude-fable-5",
      "openai/gpt-6-astra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.1-codex-max",
    ],
  );
});

test("before a search the menus list the newest of each lead family by its version's numbers, and the chosen model however old; a catalog with no lead family lists everything", () => {
  const model = (id: string) => ({
    id,
    name: id,
    provider: id.startsWith("openai/") ? MODEL_PROVIDER.OPENAI : MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
  });
  const models = [
    model("anthropic/claude-opus-5"),
    model("anthropic/claude-opus-5.5"),
    model("anthropic/claude-opus-5.1"),
    model("anthropic/claude-opus-5.5-fast"),
    model("anthropic/claude-sonnet-4.5"),
    model("anthropic/claude-haiku-5"),
    model("openai/gpt-6-astra"),
    model("openai/gpt-6.1-astra"),
    model("openai/gpt-6-astra-mini"),
    model("openai/gpt-5.6-luna"),
    model("openai/gpt-5.10-sol"),
    model("openai/gpt-5.9-sol"),
  ];
  const listed = (chosen?: string) =>
    orderedModels(models)
      .map((each) => each.id)
      .filter((id) => unsearchedModels(models, chosen).has(id));

  assert.deepEqual(listed(), [
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-haiku-5",
    "openai/gpt-6.1-astra",
    "openai/gpt-5.10-sol",
    "openai/gpt-5.6-luna",
  ]);
  assert.deepEqual(listed("anthropic/claude-opus-5"), [
    "anthropic/claude-opus-5.5",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-haiku-5",
    "openai/gpt-6.1-astra",
    "openai/gpt-5.10-sol",
    "openai/gpt-5.6-luna",
  ]);
  const unled = [model("openai/gpt-6-astra-mini"), model("openai/gpt-5.1-codex-max")];
  assert.deepEqual([...unsearchedModels(unled, undefined)].sort(), [
    "openai/gpt-5.1-codex-max",
    "openai/gpt-6-astra-mini",
  ]);
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

test("the row says where the pull request stands only once it is a draft, merged, or closed, the chip says it to a reader without its colour, and the row is drawn only once the agent has ended with one", () => {
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
  const published = { repository: "acme/relay", branch: "luke/x", pullRequest: PULL_REQUEST };
  assert.equal(showsPublishedRow(CODING_AGENT_STATUS.COMPLETED, published), true);
  assert.equal(showsPublishedRow(CODING_AGENT_STATUS.CANCELLED, published), true);
  assert.equal(showsPublishedRow(CODING_AGENT_STATUS.RUNNING, published), false);
  assert.equal(
    showsPublishedRow(CODING_AGENT_STATUS.COMPLETED, { ...published, pullRequest: null }),
    false,
  );
  assert.equal(showsPublishedRow(CODING_AGENT_STATUS.COMPLETED, undefined), false);
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

test("a turn failed on the account's own API key ends saying so and where to replace it", () => {
  assert.equal(
    endLine(CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.PROVIDER_KEY),
    "Failed: your API key was refused or can't be read; check Settings › API keys",
  );
});

test("a working agent is starting until its turn opens, thinking until the turn draws a row, and working after, a steering line leaving the turn under way as it was", () => {
  const plan: CodingAgentMessage = {
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
  assert.equal(agentWorkingPhase([plan], true), WORKING_PHASE.STARTING);
  assert.equal(agentWorkingPhase([plan, opened], true), WORKING_PHASE.STARTING);
  assert.equal(agentWorkingPhase([plan], false), WORKING_PHASE.STARTING);
  // The turn open with nothing past its step boundary is the model at its first step.
  assert.equal(agentWorkingPhase([plan, opened], false), WORKING_PHASE.THINKING);
  assert.equal(agentWorkingPhase([plan, calling], false), WORKING_PHASE.WORKING);
  // A line after a closed turn awaits a turn of its own; one sent into an open turn steers it.
  assert.equal(agentWorkingPhase([plan, closed, line], false), WORKING_PHASE.STARTING);
  assert.equal(agentWorkingPhase([plan, calling, line], false), WORKING_PHASE.WORKING);
  assert.equal(agentWorkingPhase([plan, opened, line], false), WORKING_PHASE.THINKING);
});
