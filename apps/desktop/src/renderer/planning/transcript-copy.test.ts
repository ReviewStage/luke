import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_BRIEF,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
} from "@sidecar/hosted/coding-agent-wire";
import { test } from "vitest";
import {
  agentTranscript,
  LATEST_ACTIVITY,
  latestActivity,
  readWholeTranscript,
  TRANSCRIPT_COPY,
  transcriptMarkdown,
} from "./transcript-copy";
import type { TranscriptReader } from "./use-agent-transcript";

/** An agent's transcript as the service stores it: the plan, a turn that reasons, runs, edits, delegates, and fails a call, a line from the developer, and the answer to it. */
const MESSAGES: readonly CodingAgentMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "# Invite flow\n\nSend invites by email." }],
  },
  {
    id: "m2",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Read the tests first.\n\nThen the route." },
      { type: "text", text: "Looking at the tests." },
      {
        type: "tool-bash",
        toolCallId: "call_1",
        state: "output-available",
        input: { command: "pnpm test" },
        output: { exitCode: 0, stdout: "12 passed\n", stderr: "", truncated: false },
      },
      {
        type: "tool-apply_patch",
        toolCallId: "call_2",
        state: "output-available",
        input: {
          patchText: "*** Begin Patch\n*** Update File: src/x.ts\n@@\n-  a\n+  b\n*** End Patch",
        },
        output: { files: [{ operation: "update", path: "src/x.ts" }] },
      },
      {
        type: "tool-delegate",
        toolCallId: "call_3",
        state: "output-available",
        input: { task: "## Find the sweep\n\nWhere is it bounded?" },
        output: { model: "m", effort: "low", result: "In bounds.ts." },
      },
      {
        type: "tool-bash",
        toolCallId: "call_4",
        state: "output-error",
        input: { command: "pnpm check" },
        errorText: "exit status 1",
      },
      { type: "text", text: "Done: the tests pass." },
    ],
  },
  { id: "m3", role: "user", parts: [{ type: "text", text: "Also add docs." }] },
  { id: "m4", role: "assistant", parts: [{ type: "text", text: "Added `docs/invites.md`." }] },
];

const transcript = agentTranscript({
  title: "Invite flow",
  messages: MESSAGES,
  brief: CODING_AGENT_BRIEF.PLAN,
});

test("the concise copy is the plan, the developer's lines, and each turn's calls one line each and its last words, with no reasoning and no tool output", () => {
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    `${[
      "# Invite flow",
      "## Plan",
      "# Invite flow\n\nSend invites by email.",
      "## Agent",
      [
        "- Ran `pnpm test`",
        "- Edited `src/x.ts`",
        "- Asked the worker: Find the sweep",
        "- Ran `pnpm check` (failed)",
      ].join("\n"),
      "Done: the tests pass.",
      "## Developer",
      "Also add docs.",
      "## Agent",
      "Added `docs/invites.md`.",
    ].join("\n\n")}\n`,
  );
});

test("the full copy is every block in order: words, reasoning quoted, and each call with its input and its answer or its error", () => {
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.FULL),
    `${[
      "# Invite flow",
      "## Plan",
      "# Invite flow\n\nSend invites by email.",
      "## Agent",
      "**Reasoning**\n\n> Read the tests first.\n>\n> Then the route.",
      "Looking at the tests.",
      "**Ran** `pnpm test`",
      "```sh\npnpm test\n```",
      "Output:\n\n```\n12 passed\n```",
      "**Edited** `src/x.ts`",
      "```diff\n*** Begin Patch\n*** Update File: src/x.ts\n@@\n-  a\n+  b\n*** End Patch\n```",
      "Output:\n\n```\nupdate src/x.ts\n```",
      "**Asked the worker**: Find the sweep",
      "```\n## Find the sweep\n\nWhere is it bounded?\n```",
      "Output:\n\n```\nIn bounds.ts.\n```",
      "**Ran** `pnpm check`",
      "```sh\npnpm check\n```",
      "Error:\n\n```\nexit status 1\n```",
      "Done: the tests pass.",
      "## Developer",
      "Also add docs.",
      "## Agent",
      "Added `docs/invites.md`.",
    ].join("\n\n")}\n`,
  );
});

test("the latest step is the agent's last words as plain text on one line, past the developer's later line, and nothing before the agent said or ran anything", () => {
  assert.deepEqual(latestActivity(transcript), {
    kind: LATEST_ACTIVITY.WORDS,
    text: "Added docs/invites.md.",
  });
  const answered = agentTranscript({
    title: "Invite flow",
    messages: [
      ...MESSAGES,
      {
        id: "m5",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "## Done\n\nThe **invite** route [sends mail](https://x.dev).\n\n```ts\nsend()\n```\n- Tests pass",
          },
        ],
      },
      { id: "m6", role: "user", parts: [{ type: "text", text: "Thanks." }] },
    ],
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  assert.deepEqual(latestActivity(answered), {
    kind: LATEST_ACTIVITY.WORDS,
    text: "Done The invite route sends mail. send() Tests pass",
  });
  const planOnly = agentTranscript({
    title: "Invite flow",
    messages: MESSAGES.slice(0, 1),
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  assert.equal(latestActivity(planOnly), undefined);
});

test("the latest step that is a call says it as the concise copy's line does, its reasoning after it passed over", () => {
  // The turn ends on the plan's turn's call at `at`, and a thought after it.
  const ending = (at: number) => {
    const part = MESSAGES[1]?.parts[at];
    assert.ok(part, `no part at ${at}`);
    return latestActivity(
      agentTranscript({
        title: "Invite flow",
        messages: [
          ...MESSAGES.slice(0, 1),
          {
            id: "m2",
            role: "assistant",
            parts: [part, { type: "reasoning", text: "Next, the docs.", state: "done" }],
          },
        ],
        brief: CODING_AGENT_BRIEF.PLAN,
      }),
    );
  };
  assert.deepEqual(ending(3), {
    kind: LATEST_ACTIVITY.CALL,
    verb: "Ran",
    subject: "pnpm test",
    code: true,
  });
  assert.deepEqual(ending(4), {
    kind: LATEST_ACTIVITY.CALL,
    verb: "Edited",
    subject: "src/x.ts",
    code: true,
  });
  assert.deepEqual(ending(5), {
    kind: LATEST_ACTIVITY.CALL,
    verb: "Asked the worker:",
    subject: "Find the sweep",
    code: false,
  });
});

test("the full copy cuts a huge answer and says so, and fences an answer holding a fence with a longer one", () => {
  const huge = "x".repeat(5_000);
  const copied = transcriptMarkdown(
    agentTranscript({
      title: "Agent",
      brief: CODING_AGENT_BRIEF.TASK,
      messages: [
        { id: "t", role: "user", parts: [{ type: "text", text: "Read the docs." }] },
        {
          id: "a",
          role: "assistant",
          parts: [
            {
              type: "tool-read_file",
              toolCallId: "r1",
              state: "output-available",
              input: { filePath: "README.md" },
              output: { content: `${huge}` },
            },
            {
              type: "tool-read_file",
              toolCallId: "r2",
              state: "output-available",
              input: { filePath: "docs/a.md" },
              output: { content: "```ts\nconst a = 1;\n```" },
            },
          ],
        },
      ],
    }),
    TRANSCRIPT_COPY.FULL,
  );
  assert.ok(copied.startsWith("# Agent\n\n## Task\n\nRead the docs.\n\n## Agent\n\n"));
  assert.ok(copied.includes(`Output:\n\n\`\`\`\n${"x".repeat(4_000)}\n…truncated\n\`\`\``));
  assert.ok(!copied.includes("x".repeat(4_001)));
  assert.ok(copied.includes("Output:\n\n````\n```ts\nconst a = 1;\n```\n````"));
});

test("a worker's copy opens on the task it was handed and names its turns the subagent's", () => {
  const copied = transcriptMarkdown(
    agentTranscript({
      title: "Find the sweep",
      brief: undefined,
      task: "## Find the sweep\n\nWhere is it bounded?",
      messages: [
        { id: "w0", role: "user", parts: [{ type: "text", text: "the service's own task row" }] },
        { id: "w1", role: "assistant", parts: [{ type: "text", text: "In bounds.ts." }] },
      ],
    }),
    TRANSCRIPT_COPY.CONCISE,
  );
  assert.equal(
    copied,
    "# Find the sweep\n\n## Task\n\n## Find the sweep\n\nWhere is it bounded?\n\n## Subagent\n\nIn bounds.ts.\n",
  );
});

/** A message of the agent's, numbered, for a transcript of many pages. */
function numbered(index: number): CodingAgentMessage {
  return { id: `p${index}`, role: "assistant", parts: [{ type: "text", text: String(index) }] };
}

/** A reader answering the pages given, one per read in turn, each past the cursor the last one gave. */
function pagedReader(pages: readonly (readonly CodingAgentMessage[])[]): TranscriptReader {
  return (params) => {
    const at = params.after === CODING_AGENT_CURSOR_START ? 0 : Number(params.after);
    const messages = pages[at] ?? [];
    return Promise.resolve({
      messages,
      cursor: String(at + 1),
      status: CODING_AGENT_STATUS.RUNNING,
      title: null,
    });
  };
}

test("the whole transcript is read page by page, and a page shorter than a full one is its end, so a running agent's copy waits on no held read", async () => {
  const full = Array.from({ length: CODING_AGENT_BOUNDS.MESSAGES_PAGE }, (_, index) =>
    numbered(index),
  );
  const short = [numbered(full.length)];
  const past = [numbered(full.length + 1)];
  const read = await readWholeTranscript(pagedReader([full, short, past]), { agentId: "a" });
  assert.deepEqual(
    read?.map((message) => message.id),
    [...full, ...short].map((message) => message.id),
  );
});

test("a read that did not answer copies nothing", async () => {
  const refused: TranscriptReader = () =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(await readWholeTranscript(refused, { agentId: "a" }), undefined);
  const rejected: TranscriptReader = () => Promise.reject(new Error("gone"));
  assert.equal(await readWholeTranscript(rejected, { agentId: "a" }), undefined);
});
