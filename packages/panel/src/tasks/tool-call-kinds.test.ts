// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { CALL_KIND } from "@luke/features/turn-rows";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { toolCallView } from "./tool-call-model.js";

/**
 * tool-call-kinds.test.ts -- every tool an agent can call reads on its row as
 * its own verb behind its own mark, never as "Used" and a tool's name behind
 * a wrench, and a call of an MCP server's tool says which server it ran on.
 */

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The first line of the row an agent's turn draws for one finished call: its words, and the mark it leads with. */
function rowOf(tool: string, input: WireRecord, output: WireRecord) {
  const message: CodingAgentMessage = {
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: `tool-${tool}`,
        toolCallId: "call",
        state: "output-available",
        input,
        output,
      },
    ],
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving: false,
        delegation: { models: [], onOpenTarget: () => undefined },
      }),
    ),
  );
  const row = container.querySelector("summary");
  assert.ok(row, `${tool} draws a row`);
  return { words: row.textContent?.trim(), wrench: row.querySelector(".lucide-wrench") !== null };
}

const NO_ANSWER = { status: "accepted" };

test("each of Luke's tools that fell through to 'Used' reads as its own verb, with no wrench", () => {
  const rows = [
    [AGENT_TOOL.LIST_TASKS, {}, "Listed the tasks"],
    [
      AGENT_TOOL.REMEMBER,
      { text: "Words are lowercase mid-sentence." },
      "Saved to memory: Words are lowercase mid-sentence.",
    ],
    [AGENT_TOOL.RECALL, { query: "transcript words" }, "Searched memory transcript words"],
    [AGENT_TOOL.LIST_OPEN_ASKS, {}, "Listed the open asks"],
    [AGENT_TOOL.READ_COMMENTS, {}, "Read the comments"],
    [
      AGENT_TOOL.REPLY_TO_COMMENT,
      { threadId: "t1", text: "Done in the next push." },
      "Replied to a comment: Done in the next push.",
    ],
    [AGENT_TOOL.RESOLVE_THREAD, { threadId: "t1" }, "Resolved a thread"],
    [AGENT_TOOL.REOPEN_THREAD, { threadId: "t1" }, "Reopened a thread"],
  ] as const;
  for (const [tool, input, words] of rows) {
    assert.deepEqual(rowOf(tool, input, NO_ANSWER), { words, wrench: false }, tool);
  }
});

test("a call of an integration's tool says the tool it ran and the server it ran on, behind the server's mark", () => {
  const { words, wrench } = rowOf(
    "linear_remote",
    { remoteTool: "list_issues", parentCallId: "wrapper", input: {} },
    NO_ANSWER,
  );
  assert.equal(words, "Ran list_issues Linear");
  assert.equal(wrench, false);
});

test("every tool an agent is offered has a kind of its own, and an MCP call a native harness made reads on its server", () => {
  for (const tool of Object.values(AGENT_TOOL)) {
    const view = toolCallView({ tool, input: undefined, output: undefined });
    assert.notEqual(view.kind, CALL_KIND.OTHER, tool);
  }

  const claudeCode = toolCallView({
    tool: "mcp__github__get_file_contents",
    input: { path: "README.md" },
    output: undefined,
  });
  assert.deepEqual(
    [claudeCode.kind, claudeCode.subject, claudeCode.server],
    [CALL_KIND.MCP_TOOL, "get_file_contents", "GitHub"],
  );

  const codex = toolCallView({ tool: "notion-2.fetch", input: {}, output: undefined });
  assert.deepEqual(
    [codex.kind, codex.subject, codex.server],
    [CALL_KIND.MCP_TOOL, "fetch", "Notion 2"],
  );

  const search = toolCallView({
    tool: "connection_search",
    input: { connection: "posthog", query: "dashboards" },
    output: undefined,
  });
  assert.deepEqual(
    [search.kind, search.subject, search.server],
    [CALL_KIND.SEARCH_TOOLS, "dashboards", "PostHog"],
  );
});
