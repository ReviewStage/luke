// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE, readLink } from "@luke/features/link-grammar";
import { LIVE_READ } from "@luke/features/live-wire";
import { decodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { holdExits } from "@luke/ui/testing/held-exits";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { ComposerTrigger, MentionNode } from "../plan-editor/contract.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { MentionNodeChip } from "./mention-chip.js";
import { MENTION_MENU_SIDE, type MentionPicker, useMentionPicker } from "./mention-picker.js";

/**
 * mention-picker.test.ts -- the `@` list as the editor's reports drive it: a list closed with Escape, which fades out before it goes; and on a plan, the workspace's other tasks found by their keys and its Inbox threads by their titles.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

/** The list drawn as a plan's box draws it, over a plan whose one section is Margins, the latest it answered kept for the test to drive. */
function mounted() {
  let latest: MentionPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        holder: { taskId: "plan-1" },
        taskName: "Ship the palette",
        workspace: "acme",
        repository: null,
        text: () => "## Margins\n",
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

test("an @ list closed with Escape stays closed in its word, and opens again once the word is left and written anew", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Margins"]);
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  });
  assert.deepEqual(rows(page), []);
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), [], "the closed word stays closed");
  act(() => picker().onTrigger(undefined));
  act(() => picker().onTrigger(word("mar")));
  assert.deepEqual(rows(page), ["Margins"]);
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
  assert.deepEqual(fadingRows, ["Margins"], "the fading list keeps the rows it closed with");
  assert.equal(expanded, "false", "the field reads the list closed as it starts to fade");
  assert.equal(page.querySelector(".luke-rect-float"), null, "the list goes once it has faded");
});

test("the @ list's foot names its keys through Shortcut, ⏎ and ⇥ mention and Esc closes", () => {
  const { picker, page } = mounted();
  act(() => picker().onTrigger(word("mar")));
  const foot = page.querySelector(".luke-menu-keys");
  assert.ok(foot, "the list has a foot");
  assert.deepEqual(
    [...foot.children].map((item) => item.textContent),
    ["↑↓Move", "⏎⇥Mention", "EscClose"],
  );
});

/** The list drawn as a plan's editor draws it, on `plan-1` of the Stage workspace, each mention picked recorded. */
async function mountedOnPlan(chosen: MentionNode[]) {
  let latest: MentionPicker | undefined;
  function Picker() {
    const room = useRef<HTMLDivElement>(null);
    latest = useMentionPicker({
      source: {
        holder: { taskId: "plan-1" },
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

/** A workspace the reader owns, as the window lists it. */
const workspace = (id: string, name: string, slug: string) => ({
  id,
  name,
  slug,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
});

/** A task of a workspace, as the window lists it. */
const task = (id: string, workspaceId: string, number: number, name: string) => ({
  id,
  workspaceId,
  number,
  name,
  createdAt: 1,
  updatedAt: 1,
  repository: null,
});

test("on a plan, a task's key typed whole leads the @ list with that task, its key beside it, a pick written as its mention; the plan's own key leads with the plan, and another workspace's tasks are not offered", async () => {
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

/** An open Inbox thread an agent posted, changed last at `updatedAt`. */
const thread = (id: string, title: string, updatedAt: number): InboxItem => ({
  id,
  agentId: "agent-1",
  key: id,
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title,
  needsReply: false,
  status: INBOX_STATUS.OPEN,
  postedAt: 1,
  updatedAt,
});

test("on a plan, the workspace's Inbox threads are found by their title, the plan's own first, a pick written as the thread's link and drawn as its chip; another workspace's are not offered", async () => {
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
          task("plan-42", "workspace-stage", 42, "Billing usage alerts"),
          task("plan-acme", "workspace-acme", 7, "Acme's own task"),
        ],
      },
      [LIVE_READ.INBOX_ITEMS]: {
        rows: {
          [INBOX_SCOPE_KIND.PLAN]: {
            "plan-42": [thread("item-billing", "Keep the meter's old alerts?", 30)],
            "plan-1": [thread("item-palette", "Keep the palette's margins?", 10)],
            "plan-acme": [thread("item-acme", "Keep Acme's links?", 50)],
          },
          [INBOX_SCOPE_KIND.AGENT]: {},
        },
      },
    },
  );
  const chosen: MentionNode[] = [];
  const { picker, page } = await mountedOnPlan(chosen);

  act(() => picker().onTrigger(word("threads:keep")));
  assert.deepEqual(detailedRows(page), [
    "Keep the palette's margins? · Ship the palette",
    "Keep the meter's old alerts? · Billing usage alerts",
  ]);

  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
  });
  act(() => {
    picker().onKey(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  });
  const [picked] = chosen;
  assert.ok(picked, "the highlighted thread is written");
  assert.equal(picked.name, "Keep the meter's old alerts?");
  assert.deepEqual(readLink(picked.target), {
    workspace: "stage",
    place: { kind: LINK_PLACE.INBOX_ITEM, planId: "plan-42", itemId: "item-billing" },
  });

  // The box draws the thread's link as the thread's chip, not as its words.
  const box = document.body.appendChild(document.createElement("div"));
  const boxRoot = createRoot(box);
  act(() =>
    boxRoot.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MentionNodeChip, {
          mention: picked,
          doors: {
            holder: { taskId: "plan-1" },
            place: { workspace: "stage", repository: null },
            anchors: new Set<string>(),
            onOpenTask: () => undefined,
            onOpenFile: undefined,
          },
        }),
      ),
    ),
  );
  const chip = box.querySelector("[data-mention-ref]");
  act(() => boxRoot.unmount());
  assert.ok(chip, "the thread is drawn as a chip");
  assert.match(chip.textContent ?? "", /Keep the meter's old alerts\?/u);
});
