// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_SKILL_SOURCE } from "@luke/features/task-wire";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { ComposerTrigger } from "../plan-editor/contract.js";
import {
  type SkillPicker,
  type SkillSource,
  type SkillsRead,
  useSkillPicker,
} from "./skill-picker.js";

/**
 * skill-picker.test.ts -- the `/` skill list's foot, which names the keys it hears as every list's does, its line where no skill matches, and the skills read again behind those drawn as another `/` opens it.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const READ: SkillsRead = {
  skills: [{ name: "deploy", description: "Ship it", source: TASK_SKILL_SOURCE.REPOSITORY }],
};

/** Where the skills are read from: held, since a new source is a new read. */
const SOURCE = () => Promise.resolve(READ);

/** The list drawn as a composer draws it, over a repository that keeps one skill unless `source` reads others. */
async function mounted(source: SkillSource = SOURCE) {
  let latest: SkillPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    const editor = useRef(undefined);
    latest = useSkillPicker({
      editor,
      room,
      draft: "",
      source,
      onOpen: undefined,
    });
    return createElement("div", { ref: room }, latest.menu);
  }
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(createElement(Picker)));
  return {
    page,
    type: async (query: string, start = 0) => {
      const trigger: ComposerTrigger = { start, query, rect: { left: 0, top: 0, bottom: 0 } };
      act(() => latest?.onTrigger(trigger));
      await act(async () => {
        for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
      });
    },
  };
}

test("the skill list's foot names Move, Insert by ⏎ and ⇥, and Close by Esc", async () => {
  const { page, type } = await mounted();
  await type("dep");
  const foot = page.querySelector(".luke-menu-keys");
  assert.ok(foot, "the list has a foot");
  assert.deepEqual(
    [...foot.children].map((item) => item.textContent),
    ["↑↓Move", "⏎⇥Insert", "EscClose"],
  );
  assert.equal(foot.querySelectorAll("kbd.luke-shortcut").length, 5);
});

test("a search no skill matches reads the one no-match line", async () => {
  const { page, type } = await mounted();
  await type("zzz");
  assert.ok(page.textContent?.includes("No skills match"));
});

test("another `/` opening the list draws the skills last read at once and reads them again behind, offering a skill added since", async () => {
  const added: SkillsRead = {
    skills: [
      ...("skills" in READ ? READ.skills : []),
      { name: "release", description: "Cut it", source: TASK_SKILL_SOURCE.REPOSITORY },
    ],
  };
  const reads: ((read: SkillsRead) => void)[] = [];
  const source: SkillSource = () =>
    new Promise((resolve) => {
      reads.push(resolve);
    });
  const { page, type } = await mounted(source);
  const offered = () => [...page.querySelectorAll("[role='option']")].map((row) => row.textContent);

  await type("");
  await act(async () => reads[0]?.(READ));
  assert.equal(offered().length, 1);

  await type("", 12);
  assert.equal(reads.length, 2, "the second opening reads them again");
  assert.equal(offered().length, 1, "the skills last read stand while it reads");
  await act(async () => reads[1]?.(added));
  assert.equal(offered().length, 2);
});
