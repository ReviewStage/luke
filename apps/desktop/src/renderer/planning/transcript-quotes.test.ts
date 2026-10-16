// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { CaptionStrip } from "../caption-strip";
import { MarkdownMessage } from "../markdown-message";
import type { PlanEditorHandle } from "../plan-editor/contract";
import { mountPlanEditor } from "../plan-editor/plan-editor";
import { CAPTION_TONE, type CaptionTone } from "../use-caption-presentation";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";

/**
 * transcript-quotes.test.ts -- a `>` quote is drawn the one way wherever
 * Markdown is: in an agent's reply, in the developer's own bubble, in the
 * plan, and in the plan's editor, each quote wearing the shared quote class
 * and nothing of its renderer's own, flush with the words around it, and a
 * quote inside a quote one more of the same. A caption's failure or notice
 * keeps its tone's colour inside a quote. Synthetic words.
 */

/** The window's Markdown stylesheet, which draws the shared quote. */
const MARKDOWN_CSS = readFileSync(path.join(import.meta.dirname, "../styles/markdown.css"), "utf8");

/** The window's base stylesheet, which colours a caption by its tone. */
const BASE_CSS = readFileSync(path.join(import.meta.dirname, "../styles/base.css"), "utf8");

/** The class the stylesheet draws a quote by. */
const QUOTE = "markdown-quote";

/** A quote holding a quote, as a reply quoting a review would write it. */
const QUOTED = "Said:\n\n> Back off rather than spin.\n>\n> > Agreed, and cap it.\n\nDone.";

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
const editors: PlanEditorHandle[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (): Promise<ActOutcome> =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Nothing here." }),
      recordSurfaceEvent: () => undefined,
    },
  });
  document.head.appendChild(document.createElement("style")).textContent = BASE_CSS;
  document.head.appendChild(document.createElement("style")).textContent = MARKDOWN_CSS;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

async function draw(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** One message of an agent's transcript, by who wrote it. */
function transcriptMessage(role: CodingAgentMessage["role"]): ReactElement {
  return createElement(AgentMessage, {
    message: { id: role, role, parts: [{ type: "text", text: QUOTED }] },
    plan: false,
    lead: AGENT_LEAD,
    moving: false,
    delegation: undefined,
  });
}

/** The plan's text open in its editor. */
function editorView(): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  editors.push(
    mountPlanEditor(host, {
      markdown: QUOTED,
      placement: { section: 0 },
      focus: false,
      label: "Plan",
      className: "markdown plan-unit",
      onDraft: () => undefined,
      onFinish: () => undefined,
      onLeaveUp: () => undefined,
    }),
  );
  return host;
}

/** Holds a view's quotes to the shared look: its class alone, no outer margin, upright, and one nested inside a step in. */
function assertSharedQuotes(view: HTMLElement, place: string): void {
  const quotes = [...view.querySelectorAll<HTMLElement>("blockquote")];
  assert.equal(quotes.length, 2, `${place} draws the quote and the quote inside it`);
  for (const quote of quotes) {
    assert.equal(quote.className, QUOTE, `${place} draws its quote in the shared class alone`);
    const look = getComputedStyle(quote);
    assert.equal(look.marginLeft, "0px", `${place} stands its quote flush with its words`);
    assert.equal(look.fontStyle, "normal", `${place} keeps its quote upright`);
  }
  const [outer, inner] = quotes;
  assert.ok(outer !== undefined && inner !== undefined);
  assert.equal(inner.parentElement, outer, `${place} nests the inner quote in the outer`);
  assert.equal(
    getComputedStyle(inner).paddingLeft,
    getComputedStyle(outer).paddingLeft,
    `${place} steps a nested quote in by the same step`,
  );
}

test("an agent's reply and the developer's bubble draw a quote in the shared style", async () => {
  assertSharedQuotes(await draw(transcriptMessage(MESSAGE_ROLE.ASSISTANT)), "a reply");
  const sent = await draw(transcriptMessage(MESSAGE_ROLE.USER));
  assert.ok(sent.querySelector(".is-user blockquote"), "the quote stands in the bubble");
  assertSharedQuotes(sent, "a sent bubble");
});

test("the plan, read and edited, draws a quote in the same style as a transcript", async () => {
  assertSharedQuotes(
    await draw(createElement(MarkdownMessage, { words: QUOTED, className: "plan-unit" })),
    "the plan",
  );
  assertSharedQuotes(editorView(), "the plan's editor");
});

test("a failure's or a notice's caption keeps its tone's colour inside a quote", async () => {
  const tones: readonly CaptionTone[] = [CAPTION_TONE.ERROR, CAPTION_TONE.NOTICE];
  for (const tone of tones) {
    const view = await draw(
      createElement(CaptionStrip, {
        caption: { content: { tone, words: "> Connection failed." }, shown: true },
        volumeHint: { wanted: false, text: "", onDismiss: () => undefined },
      }),
    );
    const words = view.querySelector<HTMLElement>(".voice-caption-text");
    const quote = view.querySelector<HTMLElement>(`.${QUOTE}`);
    assert.ok(words !== null && quote !== null, `the ${tone} caption draws its quote`);
    assert.equal(
      getComputedStyle(quote).color,
      getComputedStyle(words).color,
      `the ${tone} quote keeps its tone`,
    );
  }
});
