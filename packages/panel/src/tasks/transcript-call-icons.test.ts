// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND } from "@luke/features/turn-rows";
import { GLYPH, type Glyph } from "@luke/ui/icons";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool.js";
import { TranscriptOpeningCall, TranscriptTool } from "./transcript-blocks.js";

/**
 * transcript-call-icons.test.ts -- a read of a coding agent wears the
 * transcript's scroll, as Copy full transcript does, in a call's row and in
 * a row that opens a tab alike, rather than the two linked steps (lucide's
 * workflow) the window once drew for the coding agents; and each chat call
 * wears a chat glyph of its own. Synthetic calls.
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

test("each chat call wears a chat glyph of its own rather than the wrench a tool this build does not know wears", () => {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(
    createElement(
      "div",
      null,
      ...[
        CALL_KIND.CHAT_POST,
        CALL_KIND.CHAT_READ,
        CALL_KIND.CHAT_RESOLVE,
        CALL_KIND.CHAT_EDIT_CHANNEL,
      ].map((kind) =>
        createElement(TranscriptTool, {
          key: kind,
          kind,
          state: TOOL_STATE.OUTPUT_AVAILABLE,
          subject: "#launch",
          description: undefined,
          input: { kind: TOOL_BLOCK.JSON, text: "{}" },
          output: { kind: TOOL_BLOCK.JSON, text: "{}" },
          errorText: undefined,
        }),
      ),
    ),
  );

  assert.deepEqual(
    [
      ".lucide-message-square-text",
      ".lucide-messages-square",
      ".lucide-message-square-check",
      ".lucide-hash",
    ].map((icon) => box.querySelectorAll(icon).length),
    [1, 1, 1, 1],
  );
  assert.equal(box.querySelector(".lucide-wrench"), null);
});

/** The markup `glyph` draws, as any place seating it draws it. */
function glyphMarkup(glyph: Glyph): string {
  return renderToStaticMarkup(createElement(glyph));
}

/** A finished call of `kind`'s row, and the glyphs it draws, by markup. */
function glyphsOf(kind: typeof CALL_KIND.LIST_ISSUES | typeof CALL_KIND.TODOS): string[] {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(
    createElement(TranscriptTool, {
      kind,
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      subject: "",
      description: undefined,
      input: { kind: TOOL_BLOCK.JSON, text: "{}" },
      output: { kind: TOOL_BLOCK.JSON, text: "{}" },
      errorText: undefined,
    }),
  );
  return [...box.querySelectorAll("svg")].map((svg) => svg.outerHTML);
}

test("a list of issues wears the issue's glyph, and a to-do write the to-do list's, never the Tasks one", () => {
  assert.ok(glyphsOf(CALL_KIND.LIST_ISSUES).includes(glyphMarkup(GLYPH.ISSUE)));
  assert.ok(!glyphsOf(CALL_KIND.LIST_ISSUES).includes(glyphMarkup(GLYPH.TASK)));
  assert.ok(glyphsOf(CALL_KIND.TODOS).includes(glyphMarkup(GLYPH.TODOS)));
  assert.ok(!glyphsOf(CALL_KIND.TODOS).includes(glyphMarkup(GLYPH.TASK)));
});
