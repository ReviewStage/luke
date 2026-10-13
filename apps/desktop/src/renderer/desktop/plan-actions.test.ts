// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { sheetStyle } from "#testing/css-rules";
import { plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { useAppKeymap } from "../app-commands";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE, type PlanMark } from "../planning/planning-model";
import { MAIN_TAB, type MainTab } from "../planning/use-main-tabs";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopPlans } from "./desktop-plans";
import { SidebarPlan } from "./plan-actions";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OTHER: PlanSummary = {
  id: "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
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

/** Answers the question Permanently delete asked, and lets the delete it starts settle. */
async function confirmDelete(): Promise<void> {
  assert.equal(asking(), true, "Permanently delete asks first");
  const remove = answer("Permanently delete");
  await act(async () => remove.click());
}

test("the open plan's ⋯ offers Copy, Pin and Archive, its repository's actions, and Permanently delete last, and the toolbar keeps no close or delete of its own", () => {
  const unset = openTab();
  openMenu(mountToolbar(unset.plans));
  assert.deepEqual(labels(), [
    "Copy plan",
    "Rename",
    "Version history",
    "Pin",
    "Archive",
    "Change repository…",
    "Permanently delete",
  ]);
  assert.equal(document.querySelector('[aria-label="Close plan"]'), null);
  // Copy plan is the menu's alone: the toolbar keeps Start and the ⋯.
  const toolbar = document.querySelector(".desktop-toolbar-actions");
  assert.doesNotMatch(toolbar?.textContent ?? "", /Copy plan/u);
  assert.match(toolbar?.textContent ?? "", /Start/u);
  assert.doesNotMatch(toolbar?.textContent ?? "", /…/u);
  // The toolbar is one row: the plan's tab alone in its heading's strip, and
  // the plan's chip in the actions row ahead of Start, waiting on a pick.
  assert.equal(document.querySelectorAll('.desktop-toolbar-heading [role="tab"]').length, 1);
  assert.equal(document.querySelector(".desktop-toolbar-subtitle"), null);
  const chip = document.querySelector(".desktop-toolbar-actions .plan-compose-chip");
  assert.equal(chip?.textContent, "Choose repository");
  assert.ok(
    chip?.compareDocumentPosition(document.querySelector(".start-agent") ?? chip) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "the chip stands left of Start",
  );

  unmountAll();
  const kept = openTab({ [PLAN.id]: "acme/relay" });
  openMenu(mountToolbar(kept.plans));
  assert.deepEqual(labels(), [
    "Copy plan",
    "Rename",
    "Version history",
    "Pin",
    "Archive",
    "Change repository…",
    "Open on GitHub",
    "Permanently delete",
  ]);
  for (const item of menuItems()) {
    assert.ok(item.querySelector(".plan-menu-icon svg"), `${item.textContent} leads with its icon`);
  }
  const deleteItem = menuItems().at(-1);
  assert.equal(deleteItem?.dataset.danger, "true");
  assert.ok(deleteItem?.previousElementSibling instanceof HTMLHRElement);
  // A plan with a repository shows it in the sidebar's row, not in the toolbar.
  assert.equal(document.querySelector(".desktop-toolbar .plan-compose-chip"), null);
  assert.equal(document.querySelectorAll('.desktop-toolbar-heading [role="tab"]').length, 1);

  choose("Open on GitHub");
  assert.deepEqual(kept.asked.openedOnGitHub, [PLAN.id]);
  assert.deepEqual(menuItems(), []);
});

test("a right-click on a sidebar plan offers that plan's actions at the pointer, and acting on it opens nothing", () => {
  const { plans, asked } = openTab({ [OTHER.id]: "acme/billing" });
  const other = mountSidebarPlan(plans, { ...OTHER, repository: "acme/billing" }, asked);
  const open = mountSidebarPlan(plans, PLAN, asked);

  rightClick(other, 40, 60);
  // Copy formats the document drawn, which is the open plan's alone.
  assert.deepEqual(labels(), [
    "Rename",
    "Version history",
    "Pin",
    "Archive",
    "Change repository…",
    "Open on GitHub",
    "Permanently delete",
  ]);
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert.equal(menu?.style.left, "40px");
  assert.equal(menu?.style.top, "60px");
  choose("Change repository…");

  rightClick(open, 40, 120);
  assert.deepEqual(labels(), [
    "Copy plan",
    "Rename",
    "Version history",
    "Pin",
    "Archive",
    "Change repository…",
    "Permanently delete",
  ]);
  choose("Change repository…");

  assert.deepEqual(asked.changed, [OTHER.id, PLAN.id]);
  assert.deepEqual(asked.opened, []);
  assert.equal(other.textContent, "Billing exportnow");
});

test("Pin and Archive mark the plan from either door, and each offers its way back: Unpin, and Unarchive with no pin, rename, or repository", () => {
  const { plans, asked } = openTab();
  const pinned = { ...OTHER, pinnedAt: 7 };
  const archived = { ...OTHER, pinnedAt: 7, archivedAt: 9 };
  const marked = (row: PlanSummary) => ({ ...plans, plans: [PLAN, row] });

  openMenu(mountToolbar(plans));
  choose("Pin");
  openMenu(mountToolbar(plans));
  choose("Archive");
  rightClick(mountSidebarPlan(marked(pinned), pinned, asked), 40, 60);
  choose("Unpin");
  unmountAll();
  const archivedPlans = { ...plans, plans: [PLAN], archived: [archived] };
  rightClick(mountSidebarPlan(archivedPlans, archived, asked), 40, 60);
  const offered = labels();
  choose("Unarchive");

  // An archived plan takes nothing until it is back, so it is neither renamed nor given a repository.
  assert.deepEqual(offered, ["Version history", "Unarchive", "Permanently delete"]);
  assert.deepEqual(asked.marked, [
    [PLAN.id, PLAN_MARK.PIN],
    [PLAN.id, PLAN_MARK.ARCHIVE],
    [OTHER.id, PLAN_MARK.UNPIN],
    [OTHER.id, PLAN_MARK.UNARCHIVE],
  ]);
  assert.deepEqual(asked.opened, []);
});

/** The buttons a sidebar row offers at its end, beside the row rather than inside it. */
function rowMarks(row: HTMLButtonElement): HTMLButtonElement[] {
  return [...(row.parentElement?.querySelectorAll<HTMLButtonElement>(":scope > * button") ?? [])];
}

test("a sidebar plan's end offers Pin and Archive, Unpin when pinned and Unarchive alone when archived, each marking it and opening nothing", () => {
  const { plans, asked } = openTab();
  const pinned = { ...OTHER, pinnedAt: 7 };
  const archived = { ...OTHER, pinnedAt: 7, archivedAt: 9 };
  const listed = rowMarks(mountSidebarPlan(plans, OTHER, asked));
  const pinnedMarks = rowMarks(
    mountSidebarPlan({ ...plans, plans: [PLAN, pinned] }, pinned, asked),
  );
  const archivedMarks = rowMarks(
    mountSidebarPlan({ ...plans, plans: [PLAN], archived: [archived] }, archived, asked),
  );
  const named = (marks: HTMLButtonElement[]) =>
    marks.map((mark) => mark.getAttribute("aria-label"));

  for (const mark of [...listed, ...pinnedMarks, ...archivedMarks]) act(() => mark.click());

  assert.deepEqual(named(listed), ["Pin", "Archive"]);
  assert.deepEqual(named(pinnedMarks), ["Unpin", "Archive"]);
  assert.deepEqual(named(archivedMarks), ["Unarchive"]);
  assert.deepEqual(asked.marked, [
    [OTHER.id, PLAN_MARK.PIN],
    [OTHER.id, PLAN_MARK.ARCHIVE],
    [OTHER.id, PLAN_MARK.UNPIN],
    [OTHER.id, PLAN_MARK.ARCHIVE],
    [OTHER.id, PLAN_MARK.UNARCHIVE],
  ]);
  assert.deepEqual(asked.opened, []);
  assert.equal(document.querySelector('[role="menu"]'), null, "no press opened the menu");
});

test("a right-click on a sidebar plan's Pin or Archive offers the plan's menu, ringing the row", () => {
  const { plans, asked } = openTab();
  const row = mountSidebarPlan(plans, OTHER, asked);
  const [, archive] = rowMarks(row);
  assert.ok(archive);

  rightClick(archive, 40, 60);

  assert.deepEqual(labels(), [
    "Rename",
    "Version history",
    "Pin",
    "Archive",
    "Change repository…",
    "Permanently delete",
  ]);
  assert.equal(row.dataset.menuOpen, "true");
  assert.deepEqual(asked.marked, []);
});

test("only the open plan's row names Command-Shift-A on its Archive, the chord archiving the open plan alone", () => {
  const { plans, asked } = openTab();
  const [, openArchive] = rowMarks(mountSidebarPlan(plans, PLAN, asked, true));
  const [, otherArchive] = rowMarks(mountSidebarPlan(plans, OTHER, asked));

  assert.equal(openArchive?.getAttribute("aria-keyshortcuts"), "Meta+Shift+A");
  assert.equal(otherArchive?.getAttribute("aria-keyshortcuts"), null);
});

test("hovered or reached from the keyboard, a sidebar plan's time steps out and its Pin and Archive step into its place", async () => {
  const styled = await sheetStyle();
  const { plans, asked } = openTab();
  const row = mountSidebarPlan(plans, OTHER, asked);
  const item = row.parentElement;
  const time = row.querySelector(".sidebar-plan-time");
  const marks = rowMarks(row)[0]?.closest("span");
  assert.ok(item && time && marks);
  const shown = () => [styled(time, "visibility") ?? "visible", styled(marks, "opacity")];

  const resting = shown();
  item.dataset.hovered = "true";
  const hovered = shown();
  delete item.dataset.hovered;
  // Tab reaches the row, as the keyboard would.
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    row.focus();
  });
  const focused = shown();

  assert.deepEqual(resting, ["visible", "0"]);
  assert.deepEqual(hovered, ["hidden", "1"]);
  assert.deepEqual(focused, ["hidden", "1"]);
});

test("a sidebar plan's Pin and Archive draw no ground under the pointer, only their glyph brightening, as a tab's × does", async () => {
  const styled = await sheetStyle();
  const { plans, asked } = openTab();
  const row = mountSidebarPlan(plans, OTHER, asked);
  const item = row.parentElement;
  assert.ok(item);
  item.dataset.hovered = "true";
  const drawn = rowMarks(row).map((mark) => {
    const resting = [styled(mark, "background"), styled(mark, "color")];
    mark.dataset.hovered = "true";
    const hovered = [styled(mark, "background"), styled(mark, "color")];
    delete mark.dataset.hovered;
    return { resting, hovered };
  });

  const glyphOnly = {
    resting: ["none", "var(--text-secondary)"],
    hovered: ["none", "var(--text-primary)"],
  };
  assert.deepEqual(drawn, [glyphOnly, glyphOnly]);
});

test("Permanently delete on an archived plan asks without pointing at Archive", () => {
  const { plans, asked } = openTab();
  const archived = { ...OTHER, archivedAt: 9 };

  const archivedPlans = { ...plans, plans: [PLAN], archived: [archived] };
  rightClick(mountSidebarPlan(archivedPlans, archived, asked), 40, 60);
  choose("Permanently delete");

  assert.equal(
    dialog()?.querySelector("p")?.textContent,
    "“Billing export” and its board and transcript will be deleted. This can’t be undone.",
  );
});

test("an archived plan's page says so in a banner over its document, whose primary Unarchive brings it back", () => {
  const { plans, asked } = openTab();
  const archived = { ...PLAN, archivedAt: 9 };
  const open = { ...plans, region: { kind: DOCUMENT_REGION.READY, plan: archived } as const };

  const listed = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  assert.equal(listed.querySelector(".archived-banner"), null);
  unmountAll();
  const banner = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans: open,
    }),
  ).querySelector(".archived-banner");
  const unarchive = banner?.querySelector(".primary-button");
  assert.ok(unarchive instanceof HTMLButtonElement);
  act(() => unarchive.click());

  assert.equal(
    banner?.textContent,
    "This plan is archivedUnarchive it to edit, talk with Luke, or start agents.Unarchive",
  );
  assert.deepEqual(asked.marked, [[PLAN.id, PLAN_MARK.UNARCHIVE]]);
});

/** The plan's name field standing now, if one does. */
function nameField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[aria-label="Plan name"]');
}

/** Types into the name field standing now, as the browser would. */
function type(words: string): HTMLInputElement {
  const field = nameField();
  assert.ok(field, "a name field stands");
  act(() => {
    field.value = words;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

/** Ends the edit with the focus leaving the field, as a press elsewhere does. */
function leave(field: HTMLInputElement): void {
  act(() => field.blur());
}

test("Rename on a sidebar plan turns its row into a field with the name selected: Return renames, Escape and an empty name keep it", async () => {
  const { plans, asked } = openTab();
  const escapes: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (event.key === "Escape") escapes.push(event.key);
  };
  window.addEventListener("keydown", listen);
  const container = mount(sidebarPlan(plans, OTHER, asked));
  const row = () => container.querySelector<HTMLButtonElement>("button.sidebar-plan");

  rightClick(row() ?? assert.fail("the row stands"), 40, 60);
  choose("Rename");
  const field = nameField();
  assert.ok(field);
  assert.equal(document.activeElement, field);
  assert.equal(field.value, "Billing export");
  assert.equal([field.selectionStart, field.selectionEnd].join(), `0,${OTHER.name.length}`);
  assert.equal(field.maxLength, 200);
  assert.equal(row(), null, "the row is the field while it stands");

  type("  Billing exports ");
  await act(async () => key("Enter"));
  assert.equal(nameField(), null);
  assert.equal(document.activeElement, row(), "Return hands focus back to the row");

  rightClick(row() ?? assert.fail("the row stands"), 40, 60);
  choose("Rename");
  type("Never kept");
  key("Escape");
  assert.equal(nameField(), null);

  rightClick(row() ?? assert.fail("the row stands"), 40, 60);
  choose("Rename");
  leave(type("   "));
  window.removeEventListener("keydown", listen);

  assert.equal(nameField(), null);
  assert.deepEqual(asked.renamed, [[OTHER.id, "Billing exports"]]);
  assert.deepEqual(asked.opened, []);
  assert.deepEqual(escapes, [], "Escape in the field leaves the window's own Escape alone");
});

/** Renames the open plan from its tab's right-click, as the developer would. */
function renameFromTab(tab: HTMLElement): void {
  rightClick(tab, 40, 12);
  choose("Rename");
}

test("a press on the plan's tab only chooses it, while its right-click and the ⋯ menu rename the plan in place, and a press elsewhere keeps what was typed", async () => {
  const { plans, asked } = openTab();
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const title = () =>
    container.querySelector<HTMLButtonElement>(`.desktop-toolbar [role="tab"]`) ??
    assert.fail("the plan's tab stands");

  assert.equal(title().textContent, "Teammate invitations");
  act(() => title().click());
  assert.equal(nameField(), null, "a press opens no field");
  assert.equal(title().getAttribute("aria-selected"), "true");

  rightClick(title(), 40, 12);
  assert.deepEqual(labels(), ["Close others", "Rename"]);
  act(() => title().click());
  assert.deepEqual(labels(), [], "a press on the tab closes its menu");
  rightClick(title(), 40, 12);
  choose("Rename");
  const field = type("Team invites");
  await act(async () => leave(field));

  const more = container.querySelector<HTMLButtonElement>('[aria-label="Plan actions"]');
  assert.ok(more);
  openMenu(more);
  choose("Rename");
  assert.equal(document.activeElement, nameField(), "the ⋯ menu opens the tab as the field");
  key("Escape");

  assert.deepEqual(asked.renamed, [[PLAN.id, "Team invites"]]);
  assert.equal(nameField(), null);
  assert.equal(document.activeElement, title());
});

test("a rename the service refused says so quietly beside the name until the next edit", async () => {
  const { plans, asked } = openTab({}, undefined, () => Promise.resolve(false));
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const title = () =>
    container.querySelector<HTMLButtonElement>(`.desktop-toolbar [role="tab"]`) ??
    assert.fail("the plan's tab stands");
  const note = () => container.querySelector('.desktop-toolbar [role="alert"]')?.textContent;

  renameFromTab(title());
  type("Team invites");
  await act(async () => key("Enter"));
  assert.equal(note(), "The plan could not be renamed. Try again.");

  renameFromTab(title());
  assert.equal(note(), undefined);
  assert.deepEqual(asked.renamed, [[PLAN.id, "Team invites"]]);
});

test("the refusal of a rename a newer edit replaced leaves no note beside the newer name", async () => {
  const settles: ((renamed: boolean) => void)[] = [];
  const pending = () =>
    new Promise<boolean>((resolve) => {
      settles.push(resolve);
    });
  const { plans } = openTab({}, undefined, pending);
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const title = () =>
    container.querySelector<HTMLButtonElement>(`.desktop-toolbar [role="tab"]`) ??
    assert.fail("the plan's tab stands");
  const rename = (name: string) => {
    renameFromTab(title());
    type(name);
    key("Enter");
  };

  rename("First");
  rename("Second");
  const [first, second] = settles;
  assert.ok(first && second);
  await act(async () => second(true));
  await act(async () => first(false));

  assert.equal(container.querySelector('.desktop-toolbar [role="alert"]')?.textContent, undefined);
});

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
    choose("Permanently delete");
    assert.ok(asking());
    act(dismiss);
    assert.equal(asking(), false);
    assert.equal(document.activeElement === more, true, "focus is back on the ⋯");
  }
  // A press inside the card is not a press on the window behind it.
  openMenu(more);
  choose("Permanently delete");
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
  choose("Permanently delete");
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
  assert.equal(document.activeElement, answer("Permanently delete"));
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
  choose("Permanently delete");

  act(() => answer("Permanently delete").click());
  assert.equal(answer("Permanently delete").disabled, true);
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
  assert.equal(answer("Permanently delete").disabled, false);
  assert.deepEqual(asked.deleted, [PLAN.id]);

  act(() => answer("Cancel").click());
  assert.equal(asking(), false);
  assert.equal(document.activeElement, more);
});

test("no key pressed in the dialog reaches the window's own chords", () => {
  const { plans } = openTab();
  openMenu(mountToolbar(plans));
  choose("Permanently delete");
  const heard: string[] = [];
  const listen = (event: KeyboardEvent) => heard.push(event.key);
  window.addEventListener("keydown", listen);

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }),
    );
  });
  window.removeEventListener("keydown", listen);

  assert.deepEqual(heard, []);
  assert.equal(asking(), true);
});

test("a delete under way hides with the tab and still finishes, and its refusal does not come back with the tab", async () => {
  let settle: (result: ActionResult) => void = () => undefined;
  const pending = new Promise<ActionResult>((resolve) => {
    settle = resolve;
  });
  const { plans, asked } = openTab({}, () => pending);
  const row = mountSidebarPlan(plans, OTHER, asked);
  const root = roots.at(-1);
  assert.ok(root);
  const restand = (shown: boolean) => {
    act(() => root.render(sidebarPlan({ ...plans, shown }, OTHER, asked)));
  };

  rightClick(row, 40, 60);
  choose("Permanently delete");
  act(() => answer("Permanently delete").click());
  restand(false);
  assert.equal(asking(), false, "nothing is drawn over the surface standing in the tab's place");
  await act(async () => {
    settle({ status: ACTION_RESULT_STATUS.REJECTED, reason: "The plan could not be deleted." });
  });
  restand(true);

  assert.equal(asking(), false);
  assert.deepEqual(asked.deleted, [OTHER.id]);
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
  choose("Permanently delete");
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
  choose("Permanently delete");
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
  const [copy, rename] = menuItems();
  const remove = menuItems().at(-1);
  assert.ok(copy && rename && remove);
  assert.equal(document.activeElement, copy);
  key("ArrowDown");
  assert.equal(document.activeElement, rename);
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
  choose("Permanently delete");
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
    const container = mount(
      createElement(DesktopPlans, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        plans,
      }),
    );
    const close = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Close plan",
    );
    assert.ok(close, `a ${kind} plan offers Close plan`);
    act(() => close.click());
    assert.deepEqual(left, [kind]);
    unmountAll();
  }
});

/** The open plan's toolbar under the window's keymap. */
function mountToolbarWithKeys(plans: PlansControl): HTMLButtonElement {
  function Toolbar() {
    useAppKeymap(true);
    return createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    });
  }
  const container = mount(createElement(Toolbar));
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  return more;
}

/** A Command chord pressed on a target, answering whether the window claimed it. */
function chord(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", {
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("Command-Delete asks before the open plan is deleted, and leaves a text field's own Command-Delete alone", async () => {
  const { plans, asked } = openTab();
  mountToolbarWithKeys(plans);
  const field = document.body.appendChild(document.createElement("textarea"));

  assert.equal(chord(field, { key: "Backspace" }), false);
  assert.equal(dialog(), null);

  assert.equal(chord(window, { key: "Backspace" }), true);
  assert.deepEqual(asked.deleted, [], "nothing is deleted before the answer");
  await confirmDelete();
  assert.deepEqual(asked.deleted, [PLAN.id]);
});

test("Command-Shift-A archives the open plan, and an archived plan leaves the chord unclaimed", () => {
  const { plans, asked } = openTab();
  mountToolbarWithKeys(plans);

  assert.equal(chord(window, { key: "a", code: "KeyA", shiftKey: true }), true);
  unmountAll();
  mountToolbarWithKeys({
    ...plans,
    region: { kind: DOCUMENT_REGION.READY, plan: { ...PLAN, archivedAt: 9 } },
  });

  assert.equal(chord(window, { key: "a", code: "KeyA", shiftKey: true }), false);
  assert.deepEqual(asked.marked, [[PLAN.id, PLAN_MARK.ARCHIVE]]);
});

/** The open plan's column on `tab`, the window's chords heard, Copy plan's presses counted into `copies`. */
function PlanOnTab({
  plans,
  tab,
  copies,
}: {
  plans: PlansControl;
  tab: MainTab;
  copies: MainTab[];
}): React.JSX.Element {
  useAppKeymap(true);
  return createElement(DesktopPlans, {
    summary: UNPINNED_SUMMARY,
    looks: NO_LOOKS,
    plans: {
      ...plans,
      mainTabs: { ...plans.mainTabs, tabs: [MAIN_TAB.PLAN, AGENT_TAB, MAIN_TAB.INBOX], tab },
      copy: { onPress: () => copies.push(tab) },
    },
  });
}

const AGENT_TAB: MainTab = { agent: "agent-1" };

test("Start and the ⋯ stand only on the plan's own tab, while the plan's chords copy, archive, and ask to delete from an agent's tab and the Inbox alike", async () => {
  const { plans, asked } = openTab();
  const copies: MainTab[] = [];
  const container = mount(createElement(PlanOnTab, { plans, tab: MAIN_TAB.PLAN, copies }));
  const root = roots.at(-1);
  assert.ok(root);
  const drawn = () =>
    ["Start a coding agent", "Plan actions"].filter(
      (label) => container.querySelector(`.desktop-toolbar [aria-label="${label}"]`) !== null,
    );
  assert.deepEqual(drawn(), ["Start a coding agent", "Plan actions"]);
  // A menu open as the tab changes goes with the button it dropped from.
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  openMenu(more);
  assert.ok(labels().length > 0);

  for (const tab of [AGENT_TAB, MAIN_TAB.INBOX]) {
    act(() => root.render(createElement(PlanOnTab, { plans, tab, copies })));
    assert.deepEqual(drawn(), [], `nothing of the plan's on ${JSON.stringify(tab)}`);
    assert.deepEqual(labels(), [], "no menu left without its button");
    assert.ok(container.querySelector('.desktop-toolbar [aria-label="Toggle pinned summary"]'));
    assert.equal(chord(window, { key: "c", code: "KeyC", shiftKey: true }), true);
    assert.equal(chord(window, { key: "a", code: "KeyA", shiftKey: true }), true);
  }
  assert.deepEqual(copies, [AGENT_TAB, MAIN_TAB.INBOX]);
  assert.deepEqual(asked.marked, [
    [PLAN.id, PLAN_MARK.ARCHIVE],
    [PLAN.id, PLAN_MARK.ARCHIVE],
  ]);
  assert.equal(chord(window, { key: "Backspace" }), true);
  await confirmDelete();
  assert.deepEqual(asked.deleted, [PLAN.id]);
});

test("Change repository… from the ⋯ opens the open plan's chip menu over its toolbar", () => {
  const { plans } = openTab({ [PLAN.id]: "acme/relay" });
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);

  openMenu(more);
  choose("Change repository…");
  // The tab counts the ask; the toolbar's chip opens on it.
  act(() => {
    roots.at(-1)?.render(
      createElement(DesktopPlans, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        plans: { ...plans, repositoryMenu: { planId: PLAN.id, request: 1 } },
      }),
    );
  });

  const picker = container.querySelector(".desktop-toolbar-actions .plan-compose-menu");
  assert.ok(picker, "the picker hangs from the toolbar");
  assert.equal(picker.querySelector('[role="listbox"]')?.getAttribute("aria-label"), "Repository");
  const search = picker.querySelector('input[aria-label="Search repositories"]');
  assert.ok(document.activeElement === search, "the search field holds focus");

  // Escape closes it and hands focus back to the ⋯ that asked, the plan having no chip of its own.
  act(() => {
    search?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(container.querySelector(".plan-compose-menu"), null);
  assert.ok(document.activeElement === more, "focus is back on the plan actions button");
});

test("Change repository… on a plan that still has its chip hands focus back to the ⋯, not the chip", () => {
  const { plans } = openTab();
  const container = mount(
    createElement(DesktopPlans, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      plans,
    }),
  );
  const more = container.querySelector('[aria-label="Plan actions"]');
  assert.ok(more instanceof HTMLButtonElement);
  assert.ok(container.querySelector(".desktop-toolbar-actions .plan-compose-chip"));

  openMenu(more);
  choose("Change repository…");
  act(() => {
    roots.at(-1)?.render(
      createElement(DesktopPlans, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        plans: { ...plans, repositoryMenu: { planId: PLAN.id, request: 1 } },
      }),
    );
  });
  const search = container.querySelector('input[aria-label="Search repositories"]');
  assert.ok(search, "the picker opened");
  act(() => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(document.activeElement === more, "focus is back on the plan actions button");
});
