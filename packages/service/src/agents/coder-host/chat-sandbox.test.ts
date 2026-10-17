import assert from "node:assert/strict";
import { CHAT_BLOCK } from "@luke/features/chat-wire";
import type { WireRecord } from "@luke/wire";
import { test } from "vitest";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { CODER_TOOL, opensSandbox } from "./tool-set.js";

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
