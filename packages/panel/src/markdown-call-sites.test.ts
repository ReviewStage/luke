// @vitest-environment jsdom

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { MARKDOWN_MARK, MarkdownMessage } from "./markdown-message.js";
import { GitHubWords, TranscriptWords } from "./tasks/transcript-blocks.js";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { markdownHtmlParserLanded } from "./testing/markdown.js";

/**
 * markdown-call-sites.test.ts -- every place the panel draws Markdown draws
 * representative words to the byte as recorded, each with the props its
 * place hands the renderer (`@luke/ui/markdown`): a plan's section, one
 * being typed, a version's changes, a comment, a file's note, a
 * tool's description, a transcript's reply as it streams and once settled,
 * a typed message, an Inbox item, and a pull request's description as
 * GitHub rendered it. The drawings are held in
 * `markdown-call-sites.golden.json`, which `LUKE_UPDATE_FIXTURES=1` writes,
 * so a change to the renderer that moves a byte anywhere fails here.
 * Synthetic words.
 */

/** Records the drawings instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "markdown-call-sites.golden.json",
);

/** Representative words, by what each sample holds. */
const SAMPLES = {
  prose:
    "Plain words with *emphasis*, **strength**, `inline code`, ~one tilde~ and ~~a strike~~, and a [link](https://example.com/docs).",
  chips:
    "Ask [@the plan](https://tryluke.dev/acme/plan/3f6c1b2a), please; and ([@Dana](https://tryluke.dev/acme/person/d1)).",
  blocks:
    "## Goal\n\nWords.\n\n### Steps\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n- [ ] open\n- [x] done\n\n> quoted\n> words\n\n---\n\nAfter a rule.",
  table: "| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n| `d` | **e** | f |",
  code: "```\nplain block\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n    indented block",
  pictures:
    'Before ![a picture](https://example.com/a.png) after.\n\n![alone](https://example.com/b.png "Its caption")',
  html: "Press <kbd>Cmd</kbd>, <b>bold</b>\n\n<details><summary>More</summary>Hidden</details>\n\n<script>alert(1)</script>",
  breaks: "line one\nline two  \nline three",
} as const;

/** A pull request's description as GitHub rendered it. */
const GITHUB_HTML =
  '<h2>Summary</h2><p>Hi <strong>there</strong>, see <a href="https://github.com/acme/acme/pull/1">#1</a>.</p><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked> done</li></ul><pre lang="ts"><code>x()</code></pre><img src="https://example.com/c.png" alt="c"><script>alert(1)</script>';

/** A chip for a mention's link, as a place that draws its own links answers one. */
function chip(href: string, label: string): ReactElement | undefined {
  return href.startsWith("https://tryluke.dev/")
    ? createElement("span", { "data-chip": href }, label)
    : undefined;
}

/** A plan's own picture, for the one written alone. */
function planPicture(
  src: string,
  alt: string,
  title: string | undefined,
): ReactElement | undefined {
  return src.endsWith("b.png")
    ? createElement("figure", { "data-picture": src, title }, alt)
    : undefined;
}

const opens = () => undefined;
const ticks = () => Promise.resolve(true);

/** How each place draws some words, with the props it hands the renderer. */
const CALL_SITES: Record<string, (words: string) => ReactElement> = {
  planSection: (words) =>
    createElement(MarkdownMessage, {
      words,
      className: "plan-unit",
      link: chip,
      openLink: opens,
      diagrams: true,
      picture: planPicture,
      onTask: ticks,
    }),
  planTyping: (words) =>
    createElement(MarkdownMessage, {
      words,
      className: "plan-unit",
      edit: { hidden: { from: 30, to: words.length }, caret: 30 },
      link: chip,
      openLink: opens,
    }),
  version: (words) =>
    createElement(MarkdownMessage, {
      words,
      className: "plan-unit",
      edit: {
        marks: [
          { from: 0, to: 5, kind: MARKDOWN_MARK.DELETED },
          { from: 5, to: 11, kind: MARKDOWN_MARK.INSERTED },
          { from: 14, to: 30, kind: MARKDOWN_MARK.COMMENT, thread: "thread-1", active: true },
        ],
      },
      link: chip,
      openLink: opens,
      diagrams: true,
      picture: planPicture,
    }),
  search: (words) =>
    createElement(MarkdownMessage, { words, className: "plan-unit", found: ["words", "one"] }),
  comment: (words) =>
    createElement(MarkdownMessage, {
      words,
      className: "comment-words",
      link: chip,
      openLink: opens,
    }),
  fileNote: (words) =>
    createElement(MarkdownMessage, {
      words,
      className: "file-note-words",
      link: chip,
      openLink: opens,
    }),
  toolDescription: (words) =>
    createElement(MarkdownMessage, { words, className: "integration-tool-description-whole" }),
  transcript: (words) => createElement(TranscriptWords, { text: words }),
  streaming: (words) =>
    createElement(TranscriptWords, {
      text: words.slice(0, Math.ceil(words.length * 0.6)),
      streaming: true,
    }),
  typed: (words) => createElement(TranscriptWords, { text: words, typed: true }),
  inbox: (words) => createElement(TranscriptWords, { text: words, asDocument: true }),
};

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

beforeEach(() => {
  // A fenced block with a language asks main for its colours; refused, it is drawn plain.
  fakeAppBridge({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The markup an element draws, once whatever it loads has landed. */
async function drawn(element: ReactElement): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container.innerHTML;
}

test("every place that draws Markdown draws each sample exactly as recorded", async () => {
  const drawings: Record<string, Record<string, string>> = {};
  for (const [place, draw] of Object.entries(CALL_SITES)) {
    const placeDrawings: Record<string, string> = {};
    for (const [name, words] of Object.entries(SAMPLES))
      placeDrawings[name] = await drawn(draw(words));
    drawings[place] = placeDrawings;
  }
  drawings.pullRequest = {
    github: await drawn(
      createElement(GitHubWords, { html: GITHUB_HTML, picture: () => undefined }),
    ),
  };
  const recorded = `${JSON.stringify(drawings, undefined, 2)}\n`;
  if (UPDATE_FIXTURES) {
    await fs.writeFile(GOLDEN, recorded);
    return;
  }
  assert.equal(recorded, await fs.readFile(GOLDEN, "utf8"));
});
