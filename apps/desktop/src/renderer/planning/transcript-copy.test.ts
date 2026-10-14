import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { test } from "vitest";
import {
  agentTranscript,
  LATEST_ACTIVITY,
  latestActivity,
  TRANSCRIPT_COPY,
  transcriptMarkdown,
} from "./transcript-copy";

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
