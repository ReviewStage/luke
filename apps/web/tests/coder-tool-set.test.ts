import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHAT_BLOCK } from "@luke/features/chat-wire";
import { AGENT_ROLE } from "@luke/service/agents/agent-runtime/role";
import { toolsOf } from "@luke/service/agents/agent-runtime/tools";
import { CODER_TOOL, CODER_TOOL_SET, opensSandbox } from "@luke/service/agents/coder-host/tool-set";
import { stampedEveEvent } from "@luke/service/testing/eve-events";
import type { WireRecord } from "@luke/wire";
import { test } from "vitest";

/**
 * The coding agent's tools held to one list: the registry's coder role,
 * the names the host picks them out by, the files the coder project
 * authors one per tool, and the set the store writer holds its rows to.
 */

/** The coder project's authored tools, one file each under `coder/tools/`. */
const AUTHORED = fileURLToPath(new URL("../coder/tools/", import.meta.url));

test("every tool the registry offers a coding agent is named by the host, authored as one file under coder/tools, and held by the writer, and nothing else is", () => {
  const offered = [...toolsOf(AGENT_ROLE.CODER)].toSorted();
  assert.deepEqual(Object.values(CODER_TOOL).toSorted(), offered);
  const files = readdirSync(AUTHORED)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -".ts".length))
    .toSorted();
  assert.deepEqual(files, offered);
  for (const name of offered) assert.ok(name in CODER_TOOL_SET, name);
});

/** A step's request for one call of the tool given, as eve emits it. */
function requested(toolName: string, input: WireRecord): Parameters<typeof opensSandbox>[0] {
  return stampedEveEvent(
    {
      type: "actions.requested",
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 0,
        actions: [{ kind: "tool-call", callId: "call-1", toolName, input }],
      },
    },
    Date.UTC(2026, 9, 14),
  );
}

test("a chat post opens the sandbox only where it carries a picture, which is read from a file there", () => {
  const picture = { type: CHAT_BLOCK.IMAGE, path: "shot.png", alt: "The form." };
  assert.equal(
    opensSandbox(requested(CODER_TOOL.POST_CHAT, { text: "See.", blocks: [picture] })),
    true,
  );
  assert.equal(opensSandbox(requested(CODER_TOOL.POST_CHAT, { text: "Words alone." })), false);
  assert.equal(
    opensSandbox(
      requested(CODER_TOOL.POST_CHAT, {
        text: "A link.",
        blocks: [{ type: CHAT_BLOCK.LINK, url: "https://github.com", label: "GitHub" }],
      }),
    ),
    false,
  );
});
