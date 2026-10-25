// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAttachment, CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { TASK_SKILL_SOURCE } from "@luke/features/task-wire";
import type { SkillOption } from "@luke/ui/skill-mention";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { editorBundleLanded, installEditorLayout, QUIET_COMPOSER } from "../testing/composer.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { AgentComposer } from "./agent-composer.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { SentWords, SkillFiles } from "./skill-chip.js";
import type { SkillSource } from "./skill-picker.js";
import { SkillRef } from "./skill-ref.js";

/**
 * skill-chip.test.ts -- a skill's chip opens its `SKILL.md`, the composer's
 * on a press as a sent message's does, and a sent chip's hover card is the
 * window's task card: the skill's name, what it is for, and its file's
 * line, which opens the file too. A coding agent's row that loaded the
 * skill names it as the chip does, hangs the same card, and opens the
 * same file.
 */

const RELEASE: SkillOption = {
  name: "release",
  description: "Use to cut a release of the relay.",
  source: TASK_SKILL_SOURCE.REPOSITORY,
  path: ".agents/skills/release/SKILL.md",
};

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// A sent message is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
});

const ignore = () => undefined;

/** A source answering the task's skills as the service read them. */
const reading: SkillSource = () =>
  Promise.resolve({ skills: [RELEASE] satisfies readonly SkillOption[] });

/** A skill installed for the whole workspace, which names no file of the repository's. */
const TRIAGE: SkillOption = {
  name: "triage",
  description: "Use to triage a Sentry issue.",
  source: TASK_SKILL_SOURCE.WORKSPACE,
};

/** The view drawn under the task's skills, every file it opens recorded, once the skills' read has landed. */
async function mounted(view: ReactNode, source: SkillSource = reading) {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(SkillFiles, {
        source,
        onOpen: (skill) => opened.push(skill.path),
        children: view,
      }),
    );
  });
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return { container, opened };
}

/** The composer holding the words given, as the developer left them. */
function Composer({ words }: { words: string }): ReactNode {
  const [draft, setDraft] = useState(words);
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>([]);
  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    composer: {
      draft,
      setDraft,
      attachments,
      setAttachments: (next) => setAttachments(next),
      sending: false,
      note: undefined,
      closed: undefined,
      send: ignore,
      retry: ignore,
      sent: [],
    },
    skills: reading,
  });
}

/** A press on an element of the box, as the pointer lands it. */
function pressOn(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

test("a press on a skill's chip in the composer opens the skill's file, and a press on its other words opens nothing", async () => {
  const { container, opened } = await mounted(
    createElement(Composer, { words: "Cut it with /release now" }),
  );
  const chip = container.querySelector(".agent-composer-input [data-skill-ref]");
  assert.equal(
    chip?.querySelector(".luke-inline-ref-label")?.textContent,
    "/release",
    "the chosen skill is drawn as a chip",
  );
  const words = container.querySelector(".agent-composer-input p");
  assert.ok(chip && words, "the box is drawn");
  pressOn(words);
  assert.deepEqual(opened, [], "a press beside the chip opens nothing");
  pressOn(chip);
  assert.deepEqual(opened, [RELEASE.path]);
  assert.equal(drawnWords(words), "Cut it with /release now", "the words are left as they were");
});

test("a skill's chip in the composer hangs the skill's card, what it is for under its name, as a sent chip's does", async () => {
  const { container } = await mounted(
    createElement(Composer, { words: "Cut it with /release now" }),
  );
  const chip = container.querySelector(".agent-composer-input [data-skill-ref]");
  assert.ok(chip, "the chosen skill is drawn as a chip");

  restOn(chip);

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "/release");
  assert.equal(card?.querySelector(".luke-hover-card-note")?.textContent, RELEASE.description);
});

test("a skill's chip is the one pill in the composer and in a sent message, each leading with the book", async () => {
  const { container: composer } = await mounted(
    createElement(Composer, { words: "Cut it with /release now" }),
  );
  const { container: sent } = await mounted(
    createElement(SentWords, { text: "Cut it with /release now." }),
  );
  const boxed = composer.querySelector(".agent-composer-input [data-skill-ref]");
  const said = sent.querySelector("[data-skill-ref]");
  assert.ok(boxed && said, "both draw the skill as a chip");

  for (const chip of [boxed, said]) {
    assert.equal(chip.getAttribute("data-look"), "pill");
    assert.equal(chip.querySelector(".luke-inline-ref-label")?.textContent, "/release");
    assert.ok(chip.querySelector(".luke-inline-ref-glyph svg"), "the chip leads with the book");
  }
  assert.equal(boxed.innerHTML, said.innerHTML, "the two chips are drawn alike");
});

test("a skill still being read hangs a card of its name, with a placeholder for what it is for", async () => {
  const { container } = await mounted(
    createElement(SkillRef, { name: "release", skill: undefined, onOpen: undefined }),
  );
  const chip = container.querySelector("[data-skill-ref]");
  assert.ok(chip, "the skill is a chip before it is read");
  assert.ok(chip.querySelector(".luke-inline-ref-glyph svg"), "it leads with the book");

  restOn(chip);

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "/release");
  assert.equal(card?.querySelector('[role="status"]')?.textContent, "Reading skill…");
});

test("a sent chip's hover card is the plan card: the skill's mark and name, what it is for, and its file's line, which says and opens nothing, since the chip opens it", async () => {
  const { container, opened } = await mounted(
    createElement(SentWords, { text: "Cut it with /release now." }),
  );
  const chip = container.querySelector<HTMLButtonElement>("button[data-skill-ref]");
  assert.ok(chip, "the skill is a chip");
  // The card hangs as the keyboard reaches the chip, as it does under a resting pointer.
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(chip);
  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.ok(card, "the card is the window's plan card");
  assert.ok(
    card.querySelector(".luke-hover-card-head .luke-hover-card-glyph svg"),
    "the head wears the skill's mark",
  );
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "/release");
  assert.equal(card.querySelector(".luke-hover-card-note")?.textContent, RELEASE.description);
  assert.equal(
    card.querySelector('.luke-hover-card-row[data-look="detail"]')?.textContent,
    RELEASE.path,
  );
  assert.equal(
    card.querySelector("button")?.textContent,
    undefined,
    "the card offers nothing to press",
  );
  act(() => chip.click());
  assert.deepEqual(opened, [RELEASE.path]);
});

test("an installed skill's chip is no button, yet takes the focus for its card, which says where it comes from and names no file, as a repository's card says Repo", async () => {
  const both: SkillSource = () => Promise.resolve({ skills: [RELEASE, TRIAGE] });
  const { container, opened } = await mounted(
    createElement(SentWords, { text: "Run /triage then /release now." }),
    both,
  );
  const [triage, release] = container.querySelectorAll<HTMLElement>("[data-skill-ref]");
  assert.ok(triage && release, "both skills are chips");
  assert.deepEqual(
    [triage.tagName, release.tagName],
    ["SPAN", "BUTTON"],
    "only the skill with a file to open is a button",
  );
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(triage);
  assert.equal(document.activeElement, triage, "the installed skill's chip takes the focus");
  const card = document.querySelector<HTMLElement>(".luke-tooltip-card > [data-skill-card]");
  assert.equal(card?.querySelector(".luke-hover-card-corner")?.textContent, "Workspace");
  assert.equal(card?.querySelector('.luke-hover-card-row[data-look="detail"]'), null);
  act(() => triage.click());
  assert.deepEqual(opened, [], "an installed skill has no file to open");
  act(() => triage.blur());
  focusRestOn(release);
  const repository = [...document.querySelectorAll(".luke-tooltip-card > [data-skill-card]")].at(
    -1,
  );
  assert.equal(repository?.querySelector(".luke-hover-card-corner")?.textContent, "Repository");
});

/** A node's words as drawn, without those only a screen reader hears. */
function drawnWords(node: Node): string {
  if (!(node instanceof Element)) return node.textContent ?? "";
  const drawn = node.cloneNode(true) as Element;
  for (const heard of drawn.querySelectorAll(".luke-visually-hidden")) heard.remove();
  return drawn.textContent ?? "";
}

/** The lines a message's first paragraph is drawn on, each line's words as they read. */
function drawnLines(container: HTMLElement): readonly string[] {
  const paragraph = container.querySelector("p");
  assert.ok(paragraph, "the words are drawn as a paragraph");
  const lines = [""];
  for (const node of paragraph.childNodes) {
    if (node.nodeName === "BR") lines.push("");
    else lines[lines.length - 1] += drawnWords(node).replace(/\n/gu, "");
  }
  return lines;
}

test("a sent message keeps each line typed on a line of its own, rather than joined into one by a space", async () => {
  const { container } = await mounted(
    createElement(SentWords, { text: "First line\nSecond line\nThird line" }),
  );
  assert.deepEqual(drawnLines(container), ["First line", "Second line", "Third line"]);
});

test("a sent message naming a skill keeps its lines too, the skill still its chip", async () => {
  const { container } = await mounted(
    createElement(SentWords, { text: "Cut it with /release\nthen tell me." }),
  );
  assert.ok(container.querySelector("button[data-skill-ref]"), "the skill is a chip");
  assert.deepEqual(drawnLines(container), ["Cut it with /release", "then tell me."]);
});

/** A coding agent's turn that loaded the skill named, as the service stores it. */
function loadedTurn(skill: string, state = "output-available"): CodingAgentMessage {
  return {
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-load_skill",
        toolCallId: "call-load",
        state,
        input: { skill },
        ...(state === "output-error" ? { errorText: "No such skill." } : { output: "# Release" }),
      },
    ],
  };
}

/** The turn drawn as an agent's tab draws it. */
function agentTurn(message: CodingAgentMessage): ReactNode {
  return createElement(AgentMessage, {
    message,
    plan: false,
    lead: AGENT_LEAD,
    moving: false,
    delegation: undefined,
  });
}

/** The skill's card the control hangs as the keyboard reaches it, the newest hung where an earlier one is still on its way out. */
function cardOf(control: HTMLElement): string | undefined {
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(control);
  const card = [...document.querySelectorAll(".luke-tooltip-card > [data-skill-card]")].at(-1);
  act(() => control.blur());
  return card?.outerHTML;
}

test("a loaded skill's row in the transcript names the skill as its chip does, hangs the chip's card, and opens the same SKILL.md", async () => {
  const { container, opened } = await mounted(
    createElement(
      "div",
      null,
      createElement(SentWords, { text: "Cut it with /release now." }),
      createElement("div", { className: "turn" }, agentTurn(loadedTurn("release"))),
    ),
  );
  const chip = container.querySelector<HTMLButtonElement>("button[data-skill-ref]");
  const row = container.querySelector<HTMLButtonElement>(".turn button[data-opens]");
  assert.ok(chip, "the sent message names the skill as its chip");
  assert.ok(row, "the loaded skill's row is one button");
  assert.match(row.textContent ?? "", /^Loaded skill \/release$/u);
  const card = cardOf(row);
  assert.ok(card, "the row hangs the skill's card");
  assert.equal(card, cardOf(chip), "the row's card is the chip's");
  act(() => row.click());
  act(() => chip.click());
  assert.deepEqual(opened, [RELEASE.path, RELEASE.path]);
});

test("a load of a skill the plan does not hold, or one that failed, stays a call's row that folds open, naming the skill as it was asked for", async () => {
  for (const [message, said] of [
    [loadedTurn("unheard"), "/unheard"],
    [loadedTurn("release", "output-error"), "/release"],
  ] as const) {
    const { container, opened } = await mounted(agentTurn(message));
    assert.equal(container.querySelector("button[data-opens]"), null);
    const row = container.querySelector("summary");
    assert.ok(row, "the row is a fold's line");
    assert.match(row.textContent ?? "", new RegExp(`Loaded skill ${said}`, "u"));
    assert.deepEqual(opened, []);
  }
});
