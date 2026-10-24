// @vitest-environment jsdom

import assert from "node:assert/strict";
import { decodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { personActor } from "@luke/ui/actor-model";
import { holdExits } from "@luke/ui/testing/held-exits";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { ComposerTrigger, MentionNode } from "../plan-editor/contract.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { MENTION_MENU_SIDE, type MentionPicker, useMentionPicker } from "./mention-picker.js";
import { NO_TASK } from "./task-mentions.js";

/**
 * mention-picker.test.ts -- the `@` list as the editor's reports drive it: where the words are a chat message's, the members a mention tells offered in place of the workspace's, and a list closed with Escape, which fades out before it goes and which a `#` written over its word opens again on the channels; and on a plan, the workspace's other tasks found by their keys.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

/** The list drawn as a chat box draws it, the latest it answered kept for the test to drive. */
function mounted() {
  let latest: MentionPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        taskId: NO_TASK,
        taskName: "",
        workspace: "acme",
        repository: null,
        text: () => "",
      },
      members: {
        people: [
          {
            userId: "maria",
            name: "Maria Chen",
            email: "maria@example.com",
            actor: personActor({ userId: "maria", name: "Maria Chen" }, undefined, undefined, []),
          },
        ],
        agents: [],
      },
      channels: {
        known: [{ name: "general", taskId: undefined, detail: undefined }],
        onChoose: () => undefined,
      },
      room,
      side: MENTION_MENU_SIDE.ABOVE,
      onChoose: () => undefined,
    });
    return createElement("div", { ref: room }, latest.menu);
  }
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Picker))));
  return {
    picker: (): MentionPicker => {
      assert.ok(latest, "the picker is drawn");
      return latest;
    },
    page,
  };
}

/** A word the editor reports at the start of the words, typed as far as `query`. */
function word(query: string): ComposerTrigger {
  return { start: 0, query, rect: { left: 0, top: 0, bottom: 0 } };
}

/** The rows the open list draws, by name. */
const rows = (page: HTMLElement) =>
  [...page.querySelectorAll(".luke-combobox-option-label")].map((row) => row.textContent);

test("an @ list closed with Escape stays closed in its word, and a # written over that @ opens the channels", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Maria Chen"]);
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  assert.deepEqual(rows(page), []);
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), [], "the closed word stays closed");
  // The editor reports both words as one change lands: the `@` gone, a `#` at the same place.
  act(() => {
    picker().onTrigger(undefined);
    picker().onChannelTrigger(word(""));
  });
  assert.deepEqual(rows(page), ["general"]);
});

test("an @ list closed with Escape stays drawn, inert, with its rows while it fades, and goes once the fade has run", () => {
  const exits = holdExits();
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  const fading = page.querySelector<HTMLElement>(".luke-rect-float");
  const fadingRows = rows(page);
  const expanded = picker().aria["aria-expanded"];
  act(() => exits.finish());

  assert.ok(fading, "the list stands while it fades");
  assert.equal(fading.hasAttribute("inert"), true, "the fading list takes nothing");
  assert.deepEqual(fadingRows, ["Maria Chen"], "the fading list keeps the rows it closed with");
  assert.equal(expanded, "false", "the field reads the list closed as it starts to fade");
  assert.equal(page.querySelector(".luke-rect-float"), null, "the list goes once it has faded");
});

/** The list drawn as a plan's editor draws it, on `plan-1` of the Stage workspace, each mention picked recorded. */
async function mountedOnPlan(chosen: MentionNode[]) {
  let latest: MentionPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        taskId: "plan-1",
        taskName: "Ship the palette",
        workspace: "stage",
        repository: null,
        text: () => "",
      },
      room,
      side: MENTION_MENU_SIDE.BELOW,
      onChoose: (mention) => chosen.push(mention),
    });
    return createElement("div", { ref: room }, latest.menu);
  }
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Picker))));
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return {
    picker: (): MentionPicker => {
      assert.ok(latest, "the picker is drawn");
      return latest;
    },
    page,
  };
}

/** The rows the open list draws, by name and the detail beside it. */
const detailedRows = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="option"]')].map((row) =>
    [".luke-combobox-option-label", ".luke-combobox-option-detail"]
      .map((part) => row.querySelector(part)?.textContent)
      .filter((words) => words !== undefined)
      .join(" · "),
  );

test("on a plan, a task's key typed whole leads the @ list with that task, its key beside it, a pick written as its mention; the plan's own key leads with the plan, and another workspace's tasks are not offered", async () => {
  const workspace = (id: string, name: string, slug: string) => ({
    id,
    name,
    slug,
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  });
  const task = (id: string, workspaceId: string, number: number, name: string) => ({
    id,
    workspaceId,
    number,
    name,
    createdAt: 1,
    updatedAt: 1,
    repository: null,
  });
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          workspace("workspace-stage", "Stage", "stage"),
          workspace("workspace-acme", "Acme", "acme"),
        ],
        tasks: [
          task("plan-1", "workspace-stage", 1, "Ship the palette"),
          task("plan-421", "workspace-stage", 421, "Cut the release"),
          task("plan-42", "workspace-stage", 42, "Billing usage alerts from the meter"),
          task("plan-acme", "workspace-acme", 42, "Acme's own task"),
        ],
      },
    },
  );
  const chosen: MentionNode[] = [];
  const { picker, page } = await mountedOnPlan(chosen);

  act(() => picker().onTrigger(word("stag-42")));
  assert.deepEqual(detailedRows(page).slice(0, 2), [
    "Billing usage alerts from the meter · STAG-42",
    "Cut the release · STAG-421",
  ]);
  act(() => picker().onTrigger(word("STAG-1")));
  assert.deepEqual(
    detailedRows(page)[0],
    "Ship the palette · The whole plan",
    "the plan's own key leads with the plan's own row, not another task's",
  );
  act(() => picker().onTrigger(word("acme")));
  assert.ok(!rows(page).includes("Acme's own task"), "another workspace's task is not offered");

  act(() => picker().onTrigger(word("stag-421")));
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });
  const [picked] = chosen;
  assert.ok(picked, "the highlighted task is written");
  assert.equal(picked.name, "Cut the release");
  assert.deepEqual(decodeMention(picked.target, null), {
    kind: MENTION_KIND.TASK,
    taskId: "plan-421",
  });
});

test("a row in the @ list marks the word that found it, where it starts a word of its name", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("chen")));
  const row = page.querySelector<HTMLElement>('[role="option"]');
  assert.equal(row?.querySelector(".luke-combobox-option-label")?.textContent, "Maria Chen");
  assert.deepEqual(
    [...(row?.querySelectorAll(".luke-combobox-option-label mark") ?? [])].map(
      (mark) => mark.textContent,
    ),
    ["Chen"],
  );
});

test("a person's row in the @ list hangs their card while the pointer rests on it", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  const row = page.querySelector<HTMLElement>('[role="option"]');
  assert.ok(row, "Maria is listed");
  restOn(row);
  const card = document.querySelector('.luke-tooltip-card [data-actor-card="person"]');
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Maria Chen");
});
