import assert from "node:assert/strict";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { test } from "vitest";
import { agentTranscript, TRANSCRIPT_COPY, transcriptMarkdown } from "./transcript-copy";

/**
 * transcript-copy.test.ts -- a transcript's copy follows the order its tab
 * draws: a message that reached the agent while its turn ran is copied
 * between the turn's work before it and after it, not ahead of the turn,
 * where the service keeps it. Synthetic throughout.
 */

/** One answered command the agent ran, under its own call id. */
function ran(name: string): WireRecord {
  return {
    type: "tool-bash",
    toolCallId: `call-${name}`,
    state: "output-available",
    input: { command: `pnpm ${name}` },
    output: { exitCode: 0, stdout: "", stderr: "" },
  };
}

const STEP: WireRecord = { type: "step-start" };

test("a message GitHub sent while the turn ran is copied between the steps before it and the steps after it", () => {
  // The service keeps the line ahead of the journal, which closed behind it.
  const messages: readonly CodingAgentMessage[] = [
    { id: "task", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Fix the tile." }] },
    {
      id: "github",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "@octocat reviewed your pull request #12." }],
      sentBy: { name: "octocat", kind: CODING_AGENT_SENDER.GITHUB },
      arrivedIn: { journalId: "journal", afterStep: 2 },
    },
    {
      id: "journal",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        STEP,
        ran("a"),
        STEP,
        ran("b"),
        STEP,
        ran("c"),
        STEP,
        { type: "text", text: "Fixed." },
      ],
    },
  ];
  const copied = agentTranscript({
    title: "Tile",
    messages,
    brief: CODING_AGENT_BRIEF.PROMPT,
  });

  assert.equal(
    transcriptMarkdown(copied, TRANSCRIPT_COPY.CONCISE),
    [
      "# Tile",
      "## Prompt",
      "Fix the tile.",
      "## Agent",
      "- Ran `pnpm a`\n- Ran `pnpm b`",
      "## Developer",
      "@octocat reviewed your pull request #12.",
      "## Agent",
      "- Ran `pnpm c`",
      "Fixed.",
    ].join("\n\n") + "\n",
  );
});
