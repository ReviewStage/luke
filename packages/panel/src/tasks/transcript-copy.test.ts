import assert from "node:assert/strict";
import { firstMessageText, REPLAY_STEP_KIND } from "@luke/features/agent-replay";
import {
  agentMessageReplyLine,
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  type CodingAgentMessage,
  OPERATOR_QUIET_REPLY,
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

test("another agent's message is copied under the agent that sent it, never as the developer's words nor as the plan, and is no step of the agent's own", () => {
  const notice: CodingAgentMessage = {
    ...said("notice", MESSAGE_ROLE.USER, "@agent-1 are you changing memberships?"),
    metadata: { author: "agent", channel: "agent_message", from: "Invite emails" },
  };
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
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
      "## Message from Invite emails",
      "@agent-1 are you changing memberships?",
      "## Agent",
      "Yes, base on my migration.",
      "## Message from Invite emails",
      "@agent-1 are you changing memberships?",
    ].join("\n\n") + "\n",
  );
  assert.deepEqual(latestActivity(transcript), {
    kind: LATEST_ACTIVITY.WORDS,
    text: "Yes, base on my migration.",
  });
});

test("another agent's message in its whole shape is copied as its words alone, without who sent it or how to answer, which its heading says instead", () => {
  const message: CodingAgentMessage = {
    ...said(
      "message",
      MESSAGE_ROLE.USER,
      [
        "Message · [@Invite emails](https://tryluke.dev/acme/agent/a1) to you:",
        "Rebase before you push.",
        agentMessageReplyLine("5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f"),
      ].join("\n\n"),
    ),
    metadata: { author: "agent", channel: "agent_message", from: "Invite emails" },
  };
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
    messages: [said("plan", MESSAGE_ROLE.USER, "Build invitations."), message],
  });
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    [
      "# Add teammate invitations",
      "## Plan",
      "Build invitations.",
      "## Message from Invite emails",
      "Rebase before you push.",
    ].join("\n\n") + "\n",
  );
});

test("an inbox answer is copied without its item's key, as the tab draws it", () => {
  const answer = said(
    "answer",
    MESSAGE_ROLE.USER,
    inboxAnswerMessage({ key: "ship-it", title: "Ship it?" }, { reply: INBOX_REPLY.APPROVED }),
  );
  const transcript = agentTranscript({
    title: "Add teammate invitations",
    brief: undefined,
    messages: [said("plan", MESSAGE_ROLE.USER, "Build invitations."), answer],
  });
  assert.equal(
    transcriptMarkdown(transcript, TRANSCRIPT_COPY.CONCISE),
    [
      "# Add teammate invitations",
      "## Plan",
      "Build invitations.",
      "## Developer",
      'Inbox answer on "Ship it?": Approved.',
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

test("an agent's inbox posts and withdrawals from version 5 are copied as the rows the tab draws, never as their inputs' JSON, and a post from before it as it was", () => {
  const call = (name: string, tool: string, input: WireRecord): WireRecord => ({
    type: `tool-${tool}`,
    toolCallId: `call-${name}`,
    state: "output-available",
    input,
    output: { status: "accepted", inbox: [] },
  });
  const messages: readonly CodingAgentMessage[] = [
    said("task", MESSAGE_ROLE.USER, "Ask about invites."),
    {
      id: "journal",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        STEP,
        call("post", "post_to_inbox", {
          key: "invite-ttl",
          title: "7 days or 14?",
          body: "The plan leaves this open.",
          ask: { type: "decide", options: [{ label: "7 days" }, { label: "14 days" }] },
        }),
        call("withdraw", "withdraw_ask", { key: "invite-ttl", reason: "The plan says 7." }),
        call("old", "post_to_inbox", {
          key: "invite-ttl",
          title: "Still 7 days?",
          response: { type: "approval" },
        }),
      ],
    },
  ];
  const copied = agentTranscript({
    title: "Invites",
    messages,
    brief: CODING_AGENT_BRIEF.PROMPT,
  });
  const markdown = transcriptMarkdown(copied, TRANSCRIPT_COPY.CONCISE);
  assert.ok(
    markdown.includes(
      "- Posted to your inbox: 7 days or 14?\n- Withdrew an ask in your inbox: invite-ttl\n- Posted to your inbox: Still 7 days?",
    ),
    markdown,
  );
  const full = transcriptMarkdown(copied, TRANSCRIPT_COPY.FULL);
  assert.ok(full.includes("The plan leaves this open.\nPick one\n- 7 days\n- 14 days"), full);
  assert.ok(full.includes("The plan says 7."), full);
  assert.ok(!full.includes('"body"'), "no input is copied as its JSON");
});

test("an agent started blank is copied with no brief, its first line, spoken on a call, copied as the developer's words", () => {
  const spoken = { channel: "voice", voice_session_id: "call-1", from_ms: 0, to_ms: 900 };
  const copied = agentTranscript({
    title: "Export",
    messages: [
      { ...said("asked", MESSAGE_ROLE.USER, "What did you change?"), metadata: spoken },
      { ...said("answered", MESSAGE_ROLE.ASSISTANT, "I moved the export."), metadata: spoken },
    ],
    brief: CODING_AGENT_BRIEF.BLANK,
  });

  assert.equal(
    transcriptMarkdown(copied, TRANSCRIPT_COPY.CONCISE),
    ["# Export", "## Developer", "What did you change?", "## Agent", "I moved the export."].join(
      "\n\n",
    ) + "\n",
  );
});

test("an operator's heartbeat that found nothing is copied, and previewed, as no reply, and any other agent's same words are copied as said", () => {
  const messages = [
    said("asked", MESSAGE_ROLE.USER, "What stands?"),
    said("answered", MESSAGE_ROLE.ASSISTANT, "Two agents run; nothing waits on you."),
    said("heartbeat", MESSAGE_ROLE.USER, "Your heartbeat: look over the developer's open work."),
    said("quiet", MESSAGE_ROLE.ASSISTANT, OPERATOR_QUIET_REPLY),
  ];
  const operator = agentTranscript({
    title: "Luke",
    messages,
    brief: CODING_AGENT_BRIEF.BLANK,
    quiet: true,
  });
  const coder = agentTranscript({
    title: "Tile",
    messages,
    brief: CODING_AGENT_BRIEF.BLANK,
  });

  assert.deepEqual(latestActivity(operator), {
    kind: LATEST_ACTIVITY.WORDS,
    text: "Two agents run; nothing waits on you.",
  });
  assert.ok(!transcriptMarkdown(operator, TRANSCRIPT_COPY.CONCISE).includes(OPERATOR_QUIET_REPLY));
  assert.deepEqual(latestActivity(coder), {
    kind: LATEST_ACTIVITY.WORDS,
    text: OPERATOR_QUIET_REPLY,
  });
});
