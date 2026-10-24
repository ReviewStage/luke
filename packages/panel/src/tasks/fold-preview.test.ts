// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_KIND, type CallKind } from "@luke/features/turn-rows";
import { DisclosureFind } from "@luke/ui";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { TOOL_BLOCK, TOOL_STATE, type ToolBlock } from "../ai-elements/tool.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { TranscriptTodosDock, TranscriptTool } from "./transcript-blocks.js";

/**
 * fold-preview.test.ts -- a fold whose closed line previews what its body
 * says drops that preview while the body is drawn, opened or drawn hidden
 * by a find, and says it again once the body is gone: a read's path, a
 * search's pattern, a command, the plan card's first line, and the to-do
 * dock's item. Words the body does not say, a command's description and a
 * written file's path, stay. Synthetic calls and a synthetic plan.
 */

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The element drawn into the document, under a find looking through it where `finding`. */
function drawn(element: ReactElement, finding = false): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DisclosureFind, { finding, children: element }),
      ),
    ),
  );
  return container;
}

/** What the fold's line says now. */
function line(drawing: HTMLElement): string {
  return drawing.querySelector("summary")?.textContent ?? assert.fail("No fold line");
}

/** Presses the fold's line, opening a closed fold or closing an open one. */
function press(drawing: HTMLElement): void {
  act(() => drawing.querySelector<HTMLElement>("summary")?.click());
}

/** A finished call of `kind` about `subject`, its input `input`. */
function call(kind: CallKind, subject: string, input: ToolBlock, description?: string) {
  return createElement(TranscriptTool, {
    kind,
    state: TOOL_STATE.OUTPUT_AVAILABLE,
    subject,
    description,
    input,
    output: { kind: TOOL_BLOCK.TEXT, text: "done" },
    errorText: undefined,
  });
}

const PATH = "/workspace/repository/src/members/accept-invite.ts";

test("a read's path previews its row while closed, gives way while its input says it, and comes back once closed", () => {
  const drawing = drawn(call(CALL_KIND.READ_FILE, PATH, { kind: TOOL_BLOCK.TEXT, text: PATH }));
  assert.match(line(drawing), /accept-invite\.ts/u);

  press(drawing);
  assert.doesNotMatch(line(drawing), /accept-invite\.ts/u, "the open row says its verb alone");
  assert.match(drawing.querySelector("[data-tool-input]")?.textContent ?? "", /accept-invite\.ts/u);

  press(drawing);
  assert.match(line(drawing), /accept-invite\.ts/u, "closed again, it previews the path");
});

test("a read's path gives way while a find draws its body hidden, so the find counts the path once", () => {
  const drawing = drawn(
    call(CALL_KIND.READ_FILE, PATH, { kind: TOOL_BLOCK.TEXT, text: PATH }),
    true,
  );
  assert.doesNotMatch(line(drawing), /accept-invite\.ts/u);
});

test("a search's pattern gives way while its input, which holds it among its values, is drawn", () => {
  const input = JSON.stringify({ pattern: "useDisclosure\\b", path: "packages" }, null, 2);
  const drawing = drawn(
    call(CALL_KIND.SEARCH, "useDisclosure\\b", { kind: TOOL_BLOCK.JSON, text: input }),
  );
  assert.match(line(drawing), /useDisclosure/u);

  press(drawing);
  assert.doesNotMatch(line(drawing), /useDisclosure/u);
});

test("a written file's path stays on its open row, since its input is the content and not the path", () => {
  const drawing = drawn(
    call(CALL_KIND.WRITE_FILE, PATH, { kind: TOOL_BLOCK.TEXT, text: "export {};" }),
  );
  press(drawing);
  assert.match(line(drawing), /accept-invite\.ts/u);
});

test("a described command keeps its description open and drops the command its body shows", () => {
  const drawing = drawn(
    call(
      CALL_KIND.COMMAND,
      "pnpm check",
      { kind: TOOL_BLOCK.COMMAND, text: "pnpm check" },
      "Run the checks",
    ),
  );
  assert.match(line(drawing), /Run the checks pnpm check/u);

  press(drawing);
  assert.match(line(drawing), /Run the checks/u);
  assert.doesNotMatch(line(drawing), /pnpm check/u);
});

const PLAN_LINE = "Refuse a withdrawn invite link the way a used one is refused";

/** The plan an agent was handed, as its transcript opens on it. */
function handedPlan(text: string) {
  return createElement(AgentMessage, {
    message: { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text }] },
    plan: true,
    lead: AGENT_LEAD,
    moving: false,
    delegation: { models: [] },
  });
}

test("the plan card's head previews the plan's first line while closed, reads Plan alone while open, and previews it again once closed", () => {
  const drawing = drawn(handedPlan(`# ${PLAN_LINE}\n\nSay so on the page.`));
  assert.equal(line(drawing).trim(), `Plan · ${PLAN_LINE}`);

  press(drawing);
  assert.equal(line(drawing).trim(), "Plan");
  assert.match(
    drawing.querySelector(".plan-card-body")?.textContent ?? "",
    new RegExp(PLAN_LINE, "u"),
  );

  press(drawing);
  assert.equal(line(drawing).trim(), `Plan · ${PLAN_LINE}`);
});

test("the plan card's head reads Plan alone while a find draws the plan hidden", () => {
  const drawing = drawn(handedPlan(`${PLAN_LINE}\n\nSay so on the page.`), true);
  assert.equal(line(drawing).trim(), "Plan");
});

test("the to-do dock keeps its count open and drops the item it is at, which the list shows", () => {
  const drawing = drawn(
    createElement(TranscriptTodosDock, {
      todos: [
        { content: "Read the fold", status: "done" },
        { content: "Drop the preview", status: "in_progress" },
      ],
      focus: "Drop the preview",
    }),
  );
  assert.match(line(drawing), /1 of 2 done/u);
  assert.match(line(drawing), /Drop the preview/u);

  press(drawing);
  assert.match(line(drawing), /1 of 2 done/u);
  assert.doesNotMatch(line(drawing), /Drop the preview/u);
});
