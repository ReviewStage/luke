// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentAttachment } from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { SentWords, SkillFiles } from "./skill-chip";
import type { SkillOption } from "./skill-mention";
import type { SkillSource } from "./skill-picker";

/**
 * skill-chip.test.ts -- a skill's chip opens its `SKILL.md`, the composer's
 * on a press as a sent message's does, and a sent chip's hover card is the
 * window's plan card: the skill's name, what it is for, and its file's
 * line, which opens the file too.
 */

const RELEASE: SkillOption = {
  name: "release",
  description: "Use to cut a release of the relay.",
  path: ".agents/skills/release/SKILL.md",
};

/** Where the layout puts the composer's one chip, in window pixels. */
const CHIP_BOX = { left: 100, top: 20, right: 160, bottom: 38 };

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
  vi.restoreAllMocks();
});

const ignore = () => undefined;

/** A source answering the plan's skills as the service read them. */
const reading: SkillSource = () =>
  Promise.resolve({ skills: [RELEASE] satisfies readonly SkillOption[] });

/** The view drawn under the plan's skills, every file it opens recorded, once the skills' read has landed. */
async function mounted(view: ReactNode) {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(SkillFiles, {
        source: reading,
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
    status: CODING_AGENT_STATUS.COMPLETED,
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
    model: undefined,
    models: undefined,
    readModels: ignore,
    usage: undefined,
    servers: { disabled: [], onSwitch: ignore, onOpenSettings: ignore },
    published: undefined,
    doors: { openGitHub: ignore, copy: ignore },
    onStop: () => Promise.resolve(),
    followsUp: true,
    skills: reading,
  });
}

/** A press on the box at the point given, as the pointer lands it. */
function pressAt(field: HTMLTextAreaElement, x: number, y: number): void {
  act(() => {
    field.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  });
}

test("a press on a skill's chip in the composer opens the skill's file, and a press on its other words opens nothing", async () => {
  // Note that jsdom lays nothing out, so the chip is given the box a window would draw it in.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    const boxes = this.matches("mark.skill-chip") ? [new DOMRect(100, 20, 60, 18)] : [];
    // SAFETY: the lookup reads the list by iterating it, as an array iterates.
    return boxes as unknown as DOMRectList;
  });
  const { container, opened } = await mounted(
    createElement(Composer, { words: "Cut it with /release now" }),
  );
  const chip = container.querySelector(".skill-chips .skill-chip");
  assert.equal(chip?.textContent, "/release", "the chosen skill is drawn as a chip");
  const field = container.querySelector("textarea");
  assert.ok(field, "the box is drawn");
  pressAt(field, CHIP_BOX.right + 40, CHIP_BOX.top + 4);
  assert.deepEqual(opened, [], "a press beside the chip opens nothing");
  pressAt(field, CHIP_BOX.left + 10, CHIP_BOX.top + 4);
  assert.deepEqual(opened, [RELEASE.path]);
  assert.equal(field.value, "Cut it with /release now", "the words are left as they were");
});

test("a sent chip's hover card is the plan card: the skill's mark and name, what it is for, and its file's line, which opens it", async () => {
  const { container, opened } = await mounted(
    createElement(SentWords, { text: "Cut it with /release now." }),
  );
  const chip = container.querySelector<HTMLButtonElement>("button.skill-chip");
  assert.ok(chip, "the skill is a chip");
  // The card hangs as the keyboard reaches the chip, as it does under a resting pointer.
  document.documentElement.dataset.keyboard = "true";
  act(() => chip.focus());
  const card = document.querySelector<HTMLElement>(".tooltip-card > [data-skill-card]");
  assert.ok(card, "the card is the window's plan card");
  assert.ok(card.querySelector(".card-head .card-glyph svg"), "the head wears the skill's mark");
  assert.equal(card.querySelector(".card-name")?.textContent, "/release");
  assert.equal(card.querySelector(".card-note")?.textContent, RELEASE.description);
  const line = card.querySelector<HTMLButtonElement>("button.plan-card-detail");
  assert.equal(line?.textContent, RELEASE.path);
  act(() => line?.click());
  assert.deepEqual(opened, [RELEASE.path]);
});
