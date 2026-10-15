// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan, PlanSummary } from "@luke/features/plan-wire";
import { DOCUMENT_REGION, PLANS_PAGE, type PlanMark } from "@luke/ui/planning-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopPlans } from "./desktop-plans";
import { SidebarPlan } from "./plan-actions";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OTHER: PlanSummary = {
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  workspaceId: "workspace-personal",
  name: "Billing export",
  createdAt: 4,
  updatedAt: 5,
  repository: null,
};

const DIALOG = '[role="alertdialog"]';

/** What the plan actions asked of the tab, by the plan each named. */
interface Asked {
  opened: string[];
  /** Each plan whose page Open on GitHub asked for. */
  openedOnGitHub: string[];
  /** Each plan whose chip Change repository… asked open. */
  changed: string[];
  deleted: string[];
  /** Each rename asked, as the plan and the name it was given. */
  renamed: string[][];
  /** Each pin or archive asked, as the plan and what was asked of it. */
  marked: [string, PlanMark][];
}

const roots: Root[] = [];

/** Takes down every mounted surface and the menus they drew. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

beforeEach(installScrollIntoView);

afterEach(unmountAll);

/** The open plan's tab, every per-plan press recorded; `PLAN` is open and `OTHER` beside it in the list. */
function openTab(
  repositories: Readonly<Record<string, string>> = {},
  deletes: () => Promise<ActionResult> = () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  renames: () => Promise<boolean> = () => Promise.resolve(true),
) {
  const asked: Asked = {
    opened: [],
    openedOnGitHub: [],
    changed: [],
    deleted: [],
    renamed: [],
    marked: [],
  };
  const onRepository = (plan: Plan | PlanSummary) => ({
    ...plan,
    repository: repositories[plan.id] ?? null,
  });
  const open = onRepository(PLAN);
  const plans: PlansControl = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [onRepository(PLAN), onRepository(OTHER)],
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: { ...PLAN, ...open } },
    onOpenOnGitHub: (planId) => asked.openedOnGitHub.push(planId),
    onChangeRepository: (planId) => asked.changed.push(planId),
    onDeletePlan: (planId) => {
      asked.deleted.push(planId);
      return deletes();
    },
    onRenamePlan: (planId, name) => {
      asked.renamed.push([planId, name]);
      return renames();
    },
    onMarkPlan: (planId, mark) => asked.marked.push([planId, mark]),
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
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  return more;
}

function sidebarPlan(
  plans: PlansControl,
  plan: PlanSummary,
  asked: Asked,
  current = false,
): ReactElement {
  return createElement(
    "ul",
    null,
    createElement(SidebarPlan, {
      plans,
      plan,
      current,
      unread: false,
      now: plan.updatedAt,
      onOpen: () => asked.opened.push(plan.id),
    }),
  );
}

function mountSidebarPlan(
  plans: PlansControl,
  plan: PlanSummary,
  asked: Asked,
  current = false,
): HTMLButtonElement {
  const container = mount(sidebarPlan(plans, plan, asked, current));
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
function choose(label: string): void {
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(DIALOG);
}

/** Whether a dialog stands, said as a boolean so a failure does not try to print the DOM. */
function asking(): boolean {
  return dialog() !== null;
}

/** The dialog's button with these words. */
function answer(words: string): HTMLButtonElement {
  const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent === words,
  );
  assert.ok(button, `the dialog offers ${words}`);
  return button;
}

/** Answers the question Permanently delete asked, and lets the delete it starts settle. */
async function confirmDelete(): Promise<void> {
  assert.equal(asking(), true, "Permanently delete asks first");
  const remove = answer("Permanently delete");
  await act(async () => remove.click());
}
test("Permanently delete asks in a dialog naming the plan, from the ⋯ and from a sidebar plan alike, and deletes on its answer", async () => {
  const { plans, asked } = openTab();

  const more = mountToolbar(plans);
  openMenu(more);
  assert.equal(asking(), false);
  choose("Permanently delete");
  const question = dialog();
  assert.ok(question);
  assert.equal(question.getAttribute("aria-modal"), "true");
  const title = document.getElementById(question.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(question.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Permanently delete plan?");
  assert.equal(
    body?.textContent,
    "“Teammate invitations” and its board and transcript will be deleted. This can’t be undone. To keep it out of the way instead, archive it.",
  );
  // A key already pressed lands on the answer that changes nothing.
  assert.equal(document.activeElement, answer("Cancel"));
  assert.deepEqual(asked.deleted, []);
  await confirmDelete();
  assert.equal(asking(), false);

  unmountAll();
  rightClick(mountSidebarPlan(plans, OTHER, asked), 40, 60);
  choose("Permanently delete");
  assert.match(dialog()?.textContent ?? "", /“Billing export”/u);
  assert.deepEqual(asked.deleted, [PLAN.id]);
  await confirmDelete();

  assert.deepEqual(asked.deleted, [PLAN.id, OTHER.id]);
});
test("the plan's name reaches the recording only as masked text, never in an attribute", () => {
  const { plans } = openTab();
  openMenu(mountToolbar(plans));
  choose("Permanently delete");
  const drawn = dialog()?.closest(".confirm-dialog-backdrop");
  assert.ok(drawn);
  for (const element of [drawn, ...drawn.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /Teammate invitations/u, attribute.name);
    }
  }
});
