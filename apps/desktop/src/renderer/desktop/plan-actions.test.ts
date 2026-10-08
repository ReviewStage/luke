// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopPlans } from "./desktop-plans";
import { SidebarPlan } from "./plan-actions";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OTHER: PlanSummary = {
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  name: "Billing export",
  createdAt: 4,
  updatedAt: 5,
  openedAt: 6,
};

const DELETE_QUESTION = '[aria-label="Delete this plan? This cannot be undone."]';

/** What the plan actions asked of the tab, by the plan each named. */
interface Asked {
  opened: string[];
  revealed: string[];
  chosen: string[];
  deleted: string[];
}

const roots: Root[] = [];

/** Takes down every mounted surface and the menus they drew. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(unmountAll);

/** The open plan's tab, every per-plan press recorded; `PLAN` is open and `OTHER` beside it in the list. */
function openTab(folders: Readonly<Record<string, string>> = {}) {
  const asked: Asked = { opened: [], revealed: [], chosen: [], deleted: [] };
  const plans: PlansControl = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [PLAN, OTHER],
    folders,
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
    onRevealFolder: (planId) => asked.revealed.push(planId),
    onChooseFolder: (planId) => asked.chosen.push(planId),
    onDeletePlan: (planId) => {
      asked.deleted.push(planId);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  });
  return { plans, asked };
}

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function mountToolbar(plans: PlansControl): HTMLButtonElement {
  const container = mount(createElement(DesktopPlans, { plans }));
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  return more;
}

function mountSidebarPlan(plans: PlansControl, plan: PlanSummary, asked: Asked): HTMLButtonElement {
  const container = mount(
    createElement(
      "ul",
      null,
      createElement(SidebarPlan, {
        plans,
        plan,
        current: false,
        onOpen: () => asked.opened.push(plan.id),
      }),
    ),
  );
  const row = container.querySelector(".sidebar-plan");
  assert.ok(row instanceof HTMLButtonElement);
  return row;
}

function openMenu(more: HTMLButtonElement): void {
  act(() => more.click());
}

function rightClick(row: HTMLElement, clientX: number, clientY: number): void {
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX, clientY }));
  });
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

function labels(): string[] {
  return menuItems().map((item) => item.textContent ?? "");
}

function choose(label: string): void {
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

/** A key pressed where focus is. */
function key(name: string): void {
  const focused = document.activeElement;
  assert.ok(focused);
  act(() => {
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

/** Answers the question Delete asked, and lets the delete it starts settle. */
async function confirmDelete(): Promise<void> {
  const question = document.querySelector(DELETE_QUESTION);
  assert.ok(question, "Delete asks first");
  assert.equal(question.getAttribute("data-drawn"), "true");
  const answer = [...question.querySelectorAll("button")].find(
    (button) => button.textContent === "Delete plan",
  );
  assert.ok(answer);
  await act(async () => answer.click());
}

test("the open plan's ⋯ offers Copy, its folder's actions, and Delete last, and the toolbar keeps no close or delete of its own", () => {
  const folderless = openTab();
  openMenu(mountToolbar(folderless.plans));
  assert.deepEqual(labels(), ["Copy plan", "Choose folder…", "Delete plan…"]);
  assert.equal(document.querySelector('[aria-label="Close plan"]'), null);
  assert.equal(document.querySelector('[aria-label="Delete plan…"]'), null);
  const toolbar = document.querySelector(".desktop-toolbar-actions");
  assert.match(toolbar?.textContent ?? "", /Choose folder….*Copy plan/u);

  unmountAll();
  const kept = openTab({ [PLAN.id]: "/Users/dev/relay" });
  openMenu(mountToolbar(kept.plans));
  assert.deepEqual(labels(), ["Copy plan", "Reveal in Finder", "Change folder…", "Delete plan…"]);
  const deleteItem = menuItems().at(-1);
  assert.equal(deleteItem?.dataset.danger, "true");
  assert.ok(deleteItem?.previousElementSibling instanceof HTMLHRElement);
  assert.doesNotMatch(
    document.querySelector(".desktop-toolbar-actions")?.textContent ?? "",
    /Choose folder…/u,
  );

  choose("Reveal in Finder");
  assert.deepEqual(kept.asked.revealed, [PLAN.id]);
  assert.deepEqual(menuItems(), []);
});

test("a right-click on a sidebar plan offers that plan's actions at the pointer, and acting on it opens nothing", () => {
  const { plans, asked } = openTab({ [OTHER.id]: "/Users/dev/billing" });
  const other = mountSidebarPlan(plans, OTHER, asked);
  const open = mountSidebarPlan(plans, PLAN, asked);

  rightClick(other, 40, 60);
  // Copy formats the document drawn, which is the open plan's alone.
  assert.deepEqual(labels(), ["Reveal in Finder", "Change folder…", "Delete plan…"]);
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert.equal(menu?.style.left, "40px");
  assert.equal(menu?.style.top, "60px");
  choose("Change folder…");

  rightClick(open, 40, 120);
  assert.deepEqual(labels(), ["Copy plan", "Choose folder…", "Delete plan…"]);
  choose("Choose folder…");

  assert.deepEqual(asked.chosen, [OTHER.id, PLAN.id]);
  assert.deepEqual(asked.opened, []);
});

test("Delete asks before it deletes, from the ⋯ and from a sidebar plan alike", async () => {
  const { plans, asked } = openTab();

  openMenu(mountToolbar(plans));
  // The toolbar holds no question, nor room for one, until Delete is chosen.
  assert.equal(document.querySelector(DELETE_QUESTION), null);
  choose("Delete plan…");
  assert.deepEqual(asked.deleted, []);
  await confirmDelete();

  unmountAll();
  rightClick(mountSidebarPlan(plans, OTHER, asked), 40, 60);
  choose("Delete plan…");
  assert.deepEqual(asked.deleted, [PLAN.id]);
  await confirmDelete();

  assert.deepEqual(asked.deleted, [PLAN.id, OTHER.id]);
});

test("the menu answers the keyboard, and Escape closes it alone with focus back on what opened it", () => {
  const { plans } = openTab();
  const more = mountToolbar(plans);
  const escapes: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (event.key === "Escape") escapes.push(event.key);
  };
  window.addEventListener("keydown", listen);

  act(() => more.click());
  const [copy, folder, remove] = menuItems();
  assert.ok(copy && folder && remove);
  assert.equal(document.activeElement, copy);
  key("ArrowDown");
  assert.equal(document.activeElement, folder);
  key("End");
  assert.equal(document.activeElement, remove);
  key("ArrowDown");
  assert.equal(document.activeElement, copy);
  key("Escape");
  window.removeEventListener("keydown", listen);

  assert.deepEqual(menuItems(), []);
  assert.equal(document.activeElement, more);
  assert.deepEqual(escapes, []);
});

test("a press outside the menu closes it, and a second press on the ⋯ closes what the first opened", () => {
  const { plans } = openTab();
  const more = mountToolbar(plans);

  act(() => more.click());
  act(() => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  assert.deepEqual(menuItems(), []);

  act(() => more.click());
  act(() => more.click());
  assert.deepEqual(menuItems(), []);
});
