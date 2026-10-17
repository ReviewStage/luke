import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { forkStart, forksOf, messageOpening, startingWords } from "./fork-model";

/**
 * fork-model.test.ts -- what a fork's chip quotes of the message, the Start
 * a forked draft sends, and where each of an agent's messages was forked
 * to, read off the task's agents.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SOURCE = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const AT = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
const LATER = "5a2f3e4d-6c7b-4a89-9b2c-3d4e5f6a7b8c";

function agent(id: string, createdAt: number, extra: Partial<CodingAgentSummary> = {}) {
  const summary: CodingAgentSummary = {
    id,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    ...extra,
  };
  return summary;
}

test("the chip quotes a message's first line as plain words, a few of them, ending on an ellipsis only where the line was cut", () => {
  assert.equal(messageOpening("Done."), "Done.");
  assert.equal(messageOpening("**Opened** the pull request"), "Opened the pull request");
  assert.equal(
    messageOpening("I moved the invite email to the queue and added a retry with backoff"),
    "I moved the invite email to the queue…",
  );
  assert.equal(messageOpening("Done.\n\nThe tests pass."), "Done.");
});

test("a forked draft's send is from the source at its message, under the draft's key, its words and files as a note, the servers even where none is off, the choice only where one was made; an empty box forks alone", () => {
  const fork = { agentId: SOURCE, messageId: AT, opening: "Done." };
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  const base = { draftId: "draft-1", fork, disabledServers: [] };
  const from = { agentId: SOURCE, messageId: AT };

  assert.deepEqual(forkStart({ ...base, words: "  ", attachments: [], choice: undefined }), {
    idempotencyKey: "draft-1",
    from,
    disabledServers: [],
  });
  assert.deepEqual(
    forkStart({
      ...base,
      words: " Use the queue. ",
      attachments: [notes],
      choice: { model: "openai/gpt-6.1-sol", effort: "low" },
      disabledServers: ["linear"],
    }),
    {
      idempotencyKey: "draft-1",
      from,
      note: "Use the queue.",
      attachments: [notes],
      disabledServers: ["linear"],
      model: "openai/gpt-6.1-sol",
      effort: "low",
    },
  );
  // Files with no words ride a note of none, as the Start takes them.
  assert.deepEqual(forkStart({ ...base, words: "", attachments: [notes], choice: undefined }), {
    idempotencyKey: "draft-1",
    from,
    note: "",
    attachments: [notes],
    disabledServers: [],
  });
  // A fork of a reply still being written names the steps it keeps, so the cut does not grow after the press.
  assert.deepEqual(
    forkStart({
      ...base,
      fork: { ...fork, messageSteps: 3 },
      words: "",
      attachments: [],
      choice: undefined,
    }).from,
    { ...from, messageSteps: 3 },
  );
});

test("where each of an agent's messages was forked to is read off the task's agents in the order started, archived ones among them, a continue and another source's forks left out", () => {
  const listed = [
    agent("fork-b", 30, { from: { agentId: SOURCE, messageId: AT, steps: 2, totalSteps: 4 } }),
    agent(SOURCE, 10),
    agent("continued", 20, { from: { agentId: SOURCE, steps: 4, totalSteps: 4 } }),
    agent("fork-a", 25, {
      from: { agentId: SOURCE, messageId: AT, steps: 2, totalSteps: 4 },
      archivedAt: 40,
    }),
    agent("fork-later", 35, {
      from: { agentId: SOURCE, messageId: LATER, steps: 3, totalSteps: 4 },
    }),
    agent("other", 36, { from: { agentId: "fork-b", messageId: AT, steps: 1, totalSteps: 1 } }),
  ];

  assert.deepEqual(
    forksOf(listed, SOURCE),
    new Map([
      [AT, ["fork-a", "fork-b"]],
      [LATER, ["fork-later"]],
    ]),
  );
  assert.deepEqual(forksOf(listed, "fork-later"), new Map());
});

test("a fork's working line names the copy of the source's work first, then the new agent starting once the copy has had its time", () => {
  assert.equal(startingWords("Fix the tile", undefined), "Copying Fix the tile's work…");
  assert.equal(startingWords("Fix the tile", 1_000), "Copying Fix the tile's work…");
  assert.equal(startingWords("Fix the tile", 3_000), "Starting the new agent…");
  assert.equal(startingWords("Fix the tile", 60_000), "Starting the new agent…");
});
