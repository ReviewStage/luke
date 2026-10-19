import assert from "node:assert/strict";
import { firstMessageText, REPLAY_STEP_KIND } from "@luke/features/agent-replay";
import { chatNoticeReplyLine } from "@luke/features/chat-wire";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { INBOX_REPLY, inboxAnswerMessage } from "@luke/features/inbox-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { test } from "vitest";
import { REPLAY_PAGE } from "./replay-card-model.js";
import {
  agentTranscript,
  LATEST_ACTIVITY,
  latestActivity,
  TRANSCRIPT_COPY,
  transcriptMarkdown,
} from "./transcript-copy.js";

/**
 * transcript-copy.test.ts -- a transcript's copy follows the order its tab
 * draws: a message that reached the agent while its turn ran is copied
 * between the turn's work before it and after it, not ahead of the turn,
 * where the service keeps it. An agent started from another is copied as
 * its tab draws it, with none of the markers its first message holds.
 * Synthetic throughout.
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
    chatOn: true,
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

function said(id: string, role: CodingAgentMessage["role"], text: string): CodingAgentMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

test("a chat notice is copied under the member it tells of a message from, never as the developer's words nor as the plan, and is no step of the agent's own", () => {
  const notice: CodingAgentMessage = {
    ...said("notice", MESSAGE_ROLE.USER, "@agent-1 are you changing memberships?"),
    metadata: { author: "agent", channel: "chat", chat_seq: 43, from: "agent-2" },
  };
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
    chatOn: true,
    messages: [
      notice,
      said("plan", MESSAGE_ROLE.USER, "Build invitations."),
      said("turn", MESSAGE_ROLE.ASSISTANT, "Yes, base on my migration."),
      { ...notice, id: "notice-2" },
    ],
  });
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    [
      "# Add teammate invitations",
      "## Plan",
      "Build invitations.",
      "## Chat from @agent-2",
      "@agent-1 are you changing memberships?",
      "## Agent",
      "Yes, base on my migration.",
      "## Chat from @agent-2",
      "@agent-1 are you changing memberships?",
    ].join("\n\n") + "\n",
  );
  assert.deepEqual(latestActivity(transcript), {
    kind: LATEST_ACTIVITY.WORDS,
    text: "Yes, base on my migration.",
  });
});

test("a notice in its whole shape is copied as the message alone under who said it, and an inbox answer without its item's key, as the tab draws both", () => {
  const notice: CodingAgentMessage = {
    ...said(
      "notice",
      MESSAGE_ROLE.USER,
      [
        "Chat · @agent-2 in #invitations (m 43):",
        "Are you changing memberships?",
        chatNoticeReplyLine(43),
      ].join("\n\n"),
    ),
    metadata: { author: "agent", channel: "chat", chat_seq: 43, from: "agent-2" },
  };
  const answer = said(
    "answer",
    MESSAGE_ROLE.USER,
    inboxAnswerMessage({ key: "ship-it", title: "Ship it?" }, { reply: INBOX_REPLY.APPROVED }),
  );
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
    chatOn: true,
    messages: [said("plan", MESSAGE_ROLE.USER, "Build invitations."), notice, answer],
  });
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    [
      "# Add teammate invitations",
      "## Plan",
      "Build invitations.",
      "## Chat from @agent-2",
      "Are you changing memberships?",
      "## Developer",
      'Inbox answer on "Ship it?": Approved.',
    ].join("\n\n") + "\n",
  );
});

test("with Chat off, a chat notice is copied as the plain line it is drawn as, under the developer's heading, and still never as the plan", () => {
  const notice: CodingAgentMessage = {
    ...said("notice", MESSAGE_ROLE.USER, "@agent-1 are you changing memberships?"),
    metadata: { author: "agent", channel: "chat", chat_seq: 43, from: "agent-2" },
  };
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
    chatOn: false,
    messages: [notice, said("plan", MESSAGE_ROLE.USER, "Build invitations.")],
  });
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    [
      "# Add teammate invitations",
      "## Plan",
      "Build invitations.",
      "## Developer",
      "@agent-1 are you changing memberships?",
    ].join("\n\n") + "\n",
  );
});

/** The first message of an agent forked from another: the brief, two of the source's three steps, and the developer's note. */
const FORKED_FIRST = firstMessageText(
  "Fix the tile.",
  {
    agentId: "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b",
    messageId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    preamble: "This is the work you continue from.",
    steps: [
      { kind: REPLAY_STEP_KIND.LINE, summary: "Luke: Make it round.", words: "Make it round." },
      {
        kind: REPLAY_STEP_KIND.TOOL,
        summary: "Ran: pnpm test",
        words: "bash(pnpm test)\n→ exit 1 (output trimmed)",
      },
    ],
    totalSteps: 3,
  },
  "Try a square instead.",
);

test("an agent started from another is copied as its brief, the source's steps it was handed, and the note as the developer's turn, with no marker", () => {
  const copied = agentTranscript({
    title: "Tile (2)",
    messages: [
      said("first", MESSAGE_ROLE.USER, FORKED_FIRST),
      said("turn", MESSAGE_ROLE.ASSISTANT, "Squared."),
    ],
    brief: CODING_AGENT_BRIEF.PROMPT,
    chatOn: true,
  });
  const concise = transcriptMarkdown(copied, TRANSCRIPT_COPY.CONCISE);
  assert.equal(
    concise,
    [
      "# Tile (2)",
      "## Prompt",
      "Fix the tile.",
      "## Forked from an earlier agent · 2 of 3 steps",
      "_1 earlier step was left out to keep the replay within its size limit._",
      "- **Luke:** Make it round.\n- **Agent:** Ran: pnpm test",
      "## Developer",
      "Try a square instead.",
      "## Agent",
      "Squared.",
    ].join("\n\n") + "\n",
  );
  const full = transcriptMarkdown(copied, TRANSCRIPT_COPY.FULL);
  assert.ok(
    full.includes(
      "**Agent:** Ran: pnpm test\n\n```\nbash(pnpm test)\n→ exit 1 (output trimmed)\n```",
    ),
  );
  for (const copy of [concise, full]) {
    assert.ok(!copy.includes("<!--"), copy);
    assert.ok(!copy.includes("This is the work you continue from."), copy);
    assert.ok(!copy.includes("## Note from the developer"), copy);
  }
});

test("an agent started from another that has done nothing yet previews no step, its note being the developer's words", () => {
  const copied = agentTranscript({
    title: "Tile (2)",
    messages: [said("first", MESSAGE_ROLE.USER, FORKED_FIRST)],
    brief: CODING_AGENT_BRIEF.PLAN,
    chatOn: true,
  });
  assert.equal(latestActivity(copied), undefined);
});

test("a summary Luke wrote of the source's oldest steps is copied under its line, as his words, and its steps are not counted as left out", () => {
  const first = firstMessageText(
    "Fix the tile.",
    {
      agentId: "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b",
      preamble: "This is the work you continue from.",
      summary: { text: "Read the tile code.\n\nFound the radius bug.", steps: 40 },
      steps: [{ kind: REPLAY_STEP_KIND.SAID, summary: "Said: Fixed.", words: "Fixed." }],
      totalSteps: 41,
    },
    undefined,
  );
  const copied = agentTranscript({
    title: "Tile (2)",
    messages: [said("first", MESSAGE_ROLE.USER, first)],
    brief: CODING_AGENT_BRIEF.PROMPT,
    chatOn: true,
  });
  assert.equal(
    transcriptMarkdown(copied, TRANSCRIPT_COPY.CONCISE),
    [
      "# Tile (2)",
      "## Prompt",
      "Fix the tile.",
      "## Continued from an earlier agent · 1 of 41 steps",
      "**Summary of 40 earlier steps (written by Luke)**",
      "> Read the tile code.\n>\n> Found the radius bug.",
      "- **Agent:** Fixed.",
    ].join("\n\n") + "\n",
  );
});

test("a replay longer than the card draws at first is copied whole, every kept step in order, whatever the card shows", () => {
  const count = REPLAY_PAGE * 3 + 5;
  const steps = Array.from({ length: count }, (_, at) => ({
    kind: REPLAY_STEP_KIND.SAID,
    summary: `Said: Step ${at + 1}.`,
    words: `Step ${at + 1}.`,
  }));
  const first = firstMessageText(
    "Fix the tile.",
    {
      agentId: "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b",
      preamble: "This is the work you continue from.",
      steps,
      totalSteps: count,
    },
    undefined,
  );
  const copied = agentTranscript({
    title: "Tile (2)",
    messages: [said("first", MESSAGE_ROLE.USER, first)],
    brief: CODING_AGENT_BRIEF.PROMPT,
    chatOn: true,
  });
  for (const copy of [TRANSCRIPT_COPY.CONCISE, TRANSCRIPT_COPY.FULL]) {
    const markdown = transcriptMarkdown(copied, copy);
    const copiedSteps = [...markdown.matchAll(/Step (\d+)\./gu)].map((match) => Number(match[1]));
    // The full copy says each step twice, its line and its words.
    assert.deepEqual(
      [...new Set(copiedSteps)],
      Array.from({ length: count }, (_, at) => at + 1),
    );
  }
});
