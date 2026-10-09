import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import {
  AGENT_PART,
  agentParts,
  applyMessagesPage,
  changesUrl,
  checkoutCommand,
  choiceLabel,
  choiceModelId,
  followsAgent,
  modelLabel,
  offeredModels,
  opensOnGitHub,
  orderedModels,
  publishedSummary,
  pullRequestPillLabel,
  readModelChoice,
  START_NEEDS_REPOSITORY,
  showsPublishedRow,
  startFailureNote,
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

test("a model is named by the catalog where it has been read, else by its own id made readable", () => {
  const models = [
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["high"],
    },
  ];
  assert.equal(modelLabel("anthropic/claude-opus-5.5", models), "Claude Opus 5.5");
  assert.equal(modelLabel("anthropic/claude-opus-5.5"), "Claude Opus 5.5");
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

test("the menus list the models by provider, Anthropic first, and newest first within each, the catalog's order kept between one version's models", () => {
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
      "anthropic/claude-fable-5.1",
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-4.5",
      "openai/gpt-6-astra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.1-codex-max",
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

test("the checkout command fetches and switches to the branch, and the changes open on the pull request's Files tab, else as the branch compared, else nowhere", () => {
  assert.equal(
    checkoutCommand("luke/teammate-invitations"),
    "git fetch origin luke/teammate-invitations && git switch luke/teammate-invitations",
  );
  const repository = "acme/relay";
  assert.equal(
    changesUrl({ repository, branch: "luke/x", pullRequest: PULL_REQUEST }),
    "https://github.com/acme/relay/pull/123/files",
  );
  assert.equal(
    changesUrl({ repository, branch: "luke/x", pullRequest: null }),
    "https://github.com/acme/relay/compare/luke/x?expand=1",
  );
  assert.equal(changesUrl({ repository, branch: null, pullRequest: null }), undefined);
  // A branch a shell or an address would read into is quoted or encoded, never read.
  assert.equal(
    checkoutCommand("luke/$(touch pwned)'x"),
    "git fetch origin 'luke/$(touch pwned)'\\''x' && git switch 'luke/$(touch pwned)'\\''x'",
  );
  assert.equal(
    changesUrl({ repository, branch: "luke/issue#12 fix", pullRequest: null }),
    "https://github.com/acme/relay/compare/luke/issue%2312%20fix?expand=1",
  );
});

test("the row sums a finished turn up by where the pull request stands and how much changed, and is drawn only once the agent has ended with one", () => {
  assert.equal(publishedSummary(PULL_REQUEST), "Opened #123 · +210 −14 in 6 files");
  assert.equal(
    publishedSummary({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED, changedFiles: 1 }),
    "Merged #123 · +210 −14 in 1 file",
  );
  assert.equal(
    publishedSummary({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.DRAFT }),
    "Opened draft #123 · +210 −14 in 6 files",
  );
  assert.equal(
    pullRequestPillLabel({ ...PULL_REQUEST, checks: CHECK_SUMMARY.FAILING }),
    "Pull request #123, open, checks failing",
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
    "Claude Opus 5.5 · High · Fast",
  );
  assert.equal(
    choiceLabel({ model: "anthropic/claude-fable-5", effort: "xhigh" }, models),
    "Claude Fable 5 · Extra high",
  );
});
