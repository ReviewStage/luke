// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND } from "@luke/features/turn-rows";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool";
import { TranscriptOpeningCall, TranscriptTool } from "./transcript-blocks";

/**
 * transcript-call-icons.test.ts -- a read of a coding agent wears the
 * transcript's scroll, as Copy full transcript does, in a call's row and in
 * a row that opens a tab alike, rather than the two linked steps (lucide's
 * workflow) the window once drew for the coding agents. Synthetic calls.
 */

/** A finished read of an agent's row and its opening row, drawn into one box. */
function readRows(): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(TranscriptTool, {
        kind: CALL_KIND.READ_AGENT,
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        subject: "Invite flow",
        description: undefined,
        input: { kind: TOOL_BLOCK.JSON, text: "{}" },
        output: { kind: TOOL_BLOCK.TEXT, text: "Working." },
        errorText: undefined,
      }),
      createElement(TranscriptOpeningCall, {
        callId: "call-1",
        kind: CALL_KIND.READ_AGENT,
        subject: "Invite flow",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        hint: "Open the agent",
        onOpen: () => undefined,
      }),
    ),
  );
  return box;
}

test("a read of a coding agent wears the transcript's scroll in either row", () => {
  const rows = readRows();

  assert.equal(rows.querySelectorAll(".lucide-scroll-text").length, 2);
  assert.equal(rows.querySelector(".lucide-workflow"), null);
});
