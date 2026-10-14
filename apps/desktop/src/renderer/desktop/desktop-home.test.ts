// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import type { PlansControl } from "../planning/use-plans-tab";
import { DesktopHome } from "./desktop-home";

const DAY = 86_400_000;
const NOW = Date.now();

/** A plan of the personal workspace, saved `ago` before now. */
function plan(n: number, name: string, ago: number, repository: string | null): PlanSummary {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - DAY,
    updatedAt: NOW - ago,
    repository,
  };
}

const INVITES = plan(1, "Teammate invitations", 4 * 60_000, "acme/relay");
const BILLING = plan(2, "Billing export", 2 * 3_600_000, "acme/ledger");
const PLANS: readonly PlanSummary[] = [
  plan(3, "Usage alerts", 5 * DAY, "acme/relay"),
  INVITES,
  plan(4, "Onboarding checklist", 12 * DAY, null),
  BILLING,
  plan(5, "Search across plans", 19 * DAY, "acme/relay"),
  plan(6, "Schema output", 3 * DAY, "acme/schema"),
  plan(7, "Nightly bump", 6 * 3_600_000, "acme/relay"),
  plan(8, "Old dashboard", 40 * DAY, "acme/relay"),
];

let root: Root | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Every door the page opens, in order. */
interface Opened {
  readonly plans: string[];
  newPlans: number;
}

/** The home page over `overrides`, every door it opens recorded. */
function mount(overrides: Partial<PlansControl> = {}, accountName = "Dean Stratakos") {
  const opened: Opened = { plans: [], newPlans: 0 };
  const plans = plansControl({
    plans: PLANS,
    listed: { plans: PLANS, archived: [] },
    onSelect: (planId) => opened.plans.push(planId),
    onNewPlan: () => {
      opened.newPlans += 1;
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopHome, { plans, accountName })),
    ),
  );
  return { page: container, opened };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** A section's rows as a reader scans them: each row's name, then its context. */
function rows(page: HTMLElement, section: string): string[] {
  const region = page.querySelector(`section[aria-labelledby="${section}"]`);
  assert.ok(region, `${section} stands`);
  return [...region.querySelectorAll(".sidebar-plan")].map(
    (row) =>
      `${row.querySelector(".sidebar-plan-name")?.textContent} · ${row.querySelector(".home-row-context")?.textContent}`,
  );
}

function button(page: HTMLElement, text: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((each) =>
    each.textContent?.startsWith(text),
  );
  assert.ok(found, `${text} stands`);
  return found;
}

test("the home page greets the account and lists the plans saved latest with their repositories", async () => {
  const { page } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.ok(button(page, "New plan"));
  assert.deepEqual(rows(page, "home-recent"), [
    "Teammate invitations · acme/relay",
    "Billing export · acme/ledger",
    "Nightly bump · acme/relay",
    "Schema output · acme/schema",
    "Usage alerts · acme/relay",
    "Onboarding checklist · No repository",
  ]);
  assert.ok(button(page, "Search all 8 plans"));
});

test("a recent plan opens the plan, and New plan asks for one", async () => {
  const { page, opened } = mount();
  await settle();

  button(page, "Usage alerts").click();
  button(page, "New plan").click();

  assert.deepEqual(opened.plans, [PLANS[0]?.id]);
  assert.equal(opened.newPlans, 1);
});

test("an account with no plan yet is welcomed with New plan, and nothing the page says names the sidebar", () => {
  const { page } = mount({
    plans: [],
    listed: { plans: [], archived: [] },
  });

  assert.equal(page.querySelector("h1")?.textContent, "Plan your first feature");
  assert.ok(button(page, "New plan"));
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
});

test("↑ and ↓ move the focus through the rows from the window, Search all included, and leave a key pressed elsewhere alone", async () => {
  mount();
  await settle();
  const field = document.createElement("input");
  document.body.append(field);
  const press = (key: string) =>
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  const focused = () => document.activeElement?.textContent ?? "";

  press("ArrowDown");
  assert.match(focused(), /^Teammate invitations/u);
  press("ArrowDown");
  press("ArrowDown");
  assert.match(focused(), /^Nightly bump/u);
  press("ArrowUp");
  assert.match(focused(), /^Billing export/u);

  field.focus();
  press("ArrowDown");
  assert.ok(document.activeElement === field, "the field keeps the focus");

  field.blur();
  press("ArrowUp");
  assert.match(focused(), /^Search all 8 plans/u);
});

test("a workspace with no plan of its own, in an account with plans elsewhere, is greeted rather than welcomed as a new account", async () => {
  const { page } = mount({ listed: { plans: [], archived: [] } });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Welcome back, Dean");
  assert.equal(page.querySelector('section[aria-labelledby="home-recent"]'), null);
});

test("↑ and ↓ pressed on New plan leave the focus on it", async () => {
  const { page } = mount();
  await settle();
  const newPlan = button(page, "New plan");
  newPlan.focus();
  act(() => {
    newPlan.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
  });
  assert.ok(document.activeElement === newPlan, "New plan keeps the focus");
});
