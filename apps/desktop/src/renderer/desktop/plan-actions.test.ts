// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
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

const DIALOG = '[role="alertdialog"]';

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
function openTab(
  folders: Readonly<Record<string, string>> = {},
  deletes: () => Promise<ActionResult> = () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
) {
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
      return deletes();
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

function sidebarPlan(plans: PlansControl, plan: PlanSummary, asked: Asked): ReactElement {
  return createElement(
    "ul",
    null,
    createElement(SidebarPlan, {
      plans,
      plan,
      current: false,
      onOpen: () => asked.opened.push(plan.id),
    }),
  );
}

function mountSidebarPlan(plans: PlansControl, plan: PlanSummary, asked: Asked): HTMLButtonElement {
  const container = mount(sidebarPlan(plans, plan, asked));
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

/** Answers the question Delete asked, and lets the delete it starts settle. */
async function confirmDelete(): Promise<void> {
  assert.equal(asking(), true, "Delete asks first");
  const remove = answer("Delete");
  await act(async () => remove.click());
}

test("the open plan's ⋯ offers Copy, its folder's actions, and Delete last, and the toolbar keeps no close or delete of its own", () => {
  const folderless = openTab();
  openMenu(mountToolbar(folderless.plans));
  assert.deepEqual(labels(), ["Copy plan", "Choose folder", "Delete plan"]);
  assert.equal(document.querySelector('[aria-label="Close plan"]'), null);
  const toolbar = document.querySelector(".desktop-toolbar-actions");
  assert.match(toolbar?.textContent ?? "", /Choose folder.*Copy plan/u);
  assert.doesNotMatch(toolbar?.textContent ?? "", /…/u);

  unmountAll();
  const kept = openTab({ [PLAN.id]: "/Users/dev/relay" });
  openMenu(mountToolbar(kept.plans));
  assert.deepEqual(labels(), ["Copy plan", "Reveal in Finder", "Change folder", "Delete plan"]);
  for (const item of menuItems()) {
    assert.ok(item.querySelector(".plan-menu-icon svg"), `${item.textContent} leads with its icon`);
  }
  const deleteItem = menuItems().at(-1);
  assert.equal(deleteItem?.dataset.danger, "true");
  assert.ok(deleteItem?.previousElementSibling instanceof HTMLHRElement);
  assert.doesNotMatch(
    document.querySelector(".desktop-toolbar-actions")?.textContent ?? "",
    /Choose folder/u,
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
  assert.deepEqual(labels(), ["Reveal in Finder", "Change folder", "Delete plan"]);
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert.equal(menu?.style.left, "40px");
  assert.equal(menu?.style.top, "60px");
  choose("Change folder");

  rightClick(open, 40, 120);
  assert.deepEqual(labels(), ["Copy plan", "Choose folder", "Delete plan"]);
  choose("Choose folder");

  assert.deepEqual(asked.chosen, [OTHER.id, PLAN.id]);
  assert.deepEqual(asked.opened, []);
});

test("Delete asks in a dialog naming the plan, from the ⋯ and from a sidebar plan alike, and deletes on its answer", async () => {
  const { plans, asked } = openTab();

  const more = mountToolbar(plans);
  openMenu(more);
  assert.equal(asking(), false);
  choose("Delete plan");
  const question = dialog();
  assert.ok(question);
  assert.equal(question.getAttribute("aria-modal"), "true");
  const title = document.getElementById(question.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(question.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Delete plan?");
  assert.match(body?.textContent ?? "", /^“Teammate invitations” will be permanently deleted/u);
  // A key already pressed lands on the answer that changes nothing.
  assert.equal(document.activeElement, answer("Cancel"));
  assert.deepEqual(asked.deleted, []);
  await confirmDelete();
  assert.equal(asking(), false);

  unmountAll();
  rightClick(mountSidebarPlan(plans, OTHER, asked), 40, 60);
  choose("Delete plan");
  assert.match(dialog()?.textContent ?? "", /“Billing export”/u);
  assert.deepEqual(asked.deleted, [PLAN.id]);
  await confirmDelete();

  assert.deepEqual(asked.deleted, [PLAN.id, OTHER.id]);
});

test("Cancel, Escape, and a press on the dimmed window each leave the plan, with focus back on what asked", () => {
  const { plans, asked } = openTab();
  const more = mountToolbar(plans);
  const escapes: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (event.key === "Escape") escapes.push(event.key);
  };
  window.addEventListener("keydown", listen);

  const dismissals = [
    () => answer("Cancel").click(),
    () => key("Escape"),
    () => document.querySelector<HTMLElement>(".confirm-dialog-backdrop")?.click(),
  ];
  for (const dismiss of dismissals) {
    openMenu(more);
    choose("Delete plan");
    assert.ok(asking());
    act(dismiss);
    assert.equal(asking(), false);
    assert.equal(document.activeElement === more, true, "focus is back on the ⋯");
  }
  // A press inside the card is not a press on the window behind it.
  openMenu(more);
  choose("Delete plan");
  act(() => dialog()?.click());
  assert.equal(asking(), true);
  window.removeEventListener("keydown", listen);

  assert.deepEqual(asked.deleted, []);
  // Escape withdrew the dialog alone, and left the window behind it as it was.
  assert.deepEqual(escapes, []);
});

test("Tab keeps focus on the dialog's two answers, round and back", () => {
  const { plans } = openTab();
  openMenu(mountToolbar(plans));
  choose("Delete plan");
  const tab = (shiftKey: boolean) => {
    const press = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.activeElement?.dispatchEvent(press);
    });
  };

  tab(true);
  assert.equal(document.activeElement, answer("Delete"));
  tab(false);
  assert.equal(document.activeElement, answer("Cancel"));
});

test("a delete under way stills both answers, and a refusal stays in the dialog saying why until it is let go", async () => {
  let settle: (result: ActionResult) => void = () => undefined;
  const pending = new Promise<ActionResult>((resolve) => {
    settle = resolve;
  });
  const { plans, asked } = openTab({}, () => pending);
  const more = mountToolbar(plans);
  openMenu(more);
  choose("Delete plan");

  act(() => answer("Delete").click());
  assert.equal(answer("Deleting…").disabled, true);
  assert.equal(answer("Cancel").disabled, true);
  key("Escape");
  assert.equal(asking(), true, "an answer already given is not withdrawn");

  await act(async () => {
    settle({
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "The plan could not be deleted.",
    });
  });
  assert.equal(
    dialog()?.querySelector('[role="alert"]')?.textContent,
    "The plan could not be deleted.",
  );
  assert.equal(answer("Delete").disabled, false);
  assert.deepEqual(asked.deleted, [PLAN.id]);

  act(() => answer("Cancel").click());
  assert.equal(asking(), false);
  assert.equal(document.activeElement, more);
});

test("the dialog withdraws when its plan is deleted elsewhere, and the plan coming back does not bring it back", () => {
  const { plans, asked } = openTab();
  const row = mountSidebarPlan(plans, OTHER, asked);
  const root = roots.at(-1);
  assert.ok(root);
  const restand = (listed: readonly PlanSummary[]) => {
    act(() => root.render(sidebarPlan({ ...plans, plans: listed }, OTHER, asked)));
  };

  rightClick(row, 40, 60);
  choose("Delete plan");
  assert.equal(asking(), true);
  restand([PLAN]);
  assert.equal(asking(), false);
  restand([PLAN, OTHER]);
  assert.equal(asking(), false);
  assert.deepEqual(asked.deleted, []);
});

test("the plan's name reaches the recording only as masked text, never in an attribute", () => {
  const { plans } = openTab();
  openMenu(mountToolbar(plans));
  choose("Delete plan");
  const drawn = dialog()?.closest(".confirm-dialog-backdrop");
  assert.ok(drawn);
  for (const element of [drawn, ...drawn.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /Teammate invitations/u, attribute.name);
    }
  }
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

test("the tab going off screen closes an open menu and withdraws a Delete question, which the next opening does not bring back", () => {
  const { plans, asked } = openTab();
  const row = mountSidebarPlan(plans, OTHER, asked);
  const root = roots.at(-1);
  assert.ok(root);
  const restand = (shown: boolean) => {
    act(() => root.render(sidebarPlan({ ...plans, shown }, OTHER, asked)));
  };

  rightClick(row, 40, 60);
  restand(false);
  assert.deepEqual(menuItems(), []);
  restand(true);
  assert.deepEqual(menuItems(), []);

  rightClick(row, 40, 60);
  choose("Delete plan");
  assert.equal(asking(), true);
  restand(false);
  assert.equal(asking(), false);
  restand(true);
  assert.equal(asking(), false);
  assert.deepEqual(asked.deleted, []);
});

test("Tab closes the menu and leaves the browser's own move to go on from what opened it", () => {
  const { plans } = openTab();
  const more = mountToolbar(plans);
  openMenu(more);
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });

  act(() => {
    document.activeElement?.dispatchEvent(tab);
  });

  assert.deepEqual(menuItems(), []);
  assert.equal(document.activeElement, more);
  assert.equal(tab.defaultPrevented, false);
});

test("a plan that cannot be drawn offers its way back to the list", () => {
  for (const kind of [DOCUMENT_REGION.FAILED, DOCUMENT_REGION.MISSING] as const) {
    const left: string[] = [];
    const plans = plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind },
      onLeavePlan: () => left.push(kind),
    });
    const container = mount(createElement(DesktopPlans, { plans }));
    const close = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Close plan",
    );
    assert.ok(close, `a ${kind} plan offers Close plan`);
    act(() => close.click());
    assert.deepEqual(left, [kind]);
    unmountAll();
  }
});
