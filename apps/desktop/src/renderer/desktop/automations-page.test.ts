// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AUTOMATION_CALL_FAILURE, type AutomationListView } from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { ToastHost } from "../toast";
import { AutomationsPage } from "./automations-page";

/**
 * automations-page.test.ts -- the Automations page as the window draws it: the listed workspace's automations, the workspace's before the personal ones, each naming its owner, an automation turned off saying so, a failed run marked, a switch's write taken in place, and a read that did not land said with a retry.
 *
 * The service is a script at the act boundary; synthetic automations and words throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

function automation(n: number, patch: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(n).padStart(12, "0")}`,
    planId: null,
    planName: null,
    workspaceId: WORKSPACE.id,
    name: `Automation ${n}`,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage today's issues." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
    ...patch,
  };
}

const SWEEP = automation(1, {
  name: "Nightly flaky-test sweep",
  scope: AUTOMATION_SCOPE.WORKSPACE,
});
const DIGEST = automation(2, { name: "Morning digest", scope: AUTOMATION_SCOPE.PERSONAL });
const FAILING = automation(3, {
  name: "Dependency bumps",
  scope: AUTOMATION_SCOPE.WORKSPACE,
  lastRun: {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
    status: AUTOMATION_RUN_STATUS.FAILED,
    reason: "unavailable",
    agent: null,
    firedAt: 2,
    settledAt: 3,
  },
});

let root: Root | undefined;
/** The service's automations, as a read of the list answers them and a change changes them. */
let standing: AutomationSummary[] = [];
/** How the next reads of the list answer before the service's own, in order. */
let lists: AutomationListView[] = [];
/** Whether a read of the list is held unanswered, so only the writes' answers draw. */
let listHeld = false;
/** The changes held unanswered, each answered by its resolver, where changes are held at all. */
let heldChanges: (() => void)[] | undefined;
/** Every workspace whose list was read, in order. */
let listed: (string | undefined)[] = [];
/** Every change asked, as the act carried it. */
let changes: unknown[] = [];
/** What a change answers: the automation as changed, or why not. */
let changeRefusal:
  | (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE]
  | undefined;

beforeEach(() => {
  standing = [DIGEST, SWEEP, FAILING];
  lists = [];
  listHeld = false;
  heldChanges = undefined;
  listed = [];
  changes = [];
  changeRefusal = undefined;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
          listed.push(request.payload.workspaceId);
          if (listHeld) return new Promise(() => undefined);
          const theirs = standing.filter(
            (each) => each.workspaceId === request.payload.workspaceId,
          );
          const value = lists.shift() ?? { automations: theirs };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_CHANGE) {
          changes.push(request.payload);
          const { automationId, change } = request.payload;
          const was = standing.find((each) => each.id === automationId);
          if (changeRefusal !== undefined || was === undefined) {
            const failure = changeRefusal ?? AUTOMATION_CALL_FAILURE.NOT_FOUND;
            return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { failure } });
          }
          const automation = { ...was, ...change };
          standing = standing.map((each) => (each.id === automationId ? automation : each));
          if (heldChanges === undefined) {
            return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { automation } });
          }
          // A held write answers in words of its own, so which answer drew is told by the row's name.
          const held = heldChanges;
          const told = { ...automation, name: `${was.name}, write ${held.length + 1}` };
          const done = { status: ACT_OUTCOME_STATUS.DONE, value: { automation: told } };
          return new Promise((resolve) => held.push(() => resolve(done)));
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The registry every render of one mount shares, so a render again is the same window. */
let registry = AtomRegistry.make();

/** The page as drawn over the plans control given, rendered again in place where one stands. */
function render(plans: ReturnType<typeof plansControl>): void {
  act(() =>
    root?.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          createElement(AutomationsPage, { plans }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
}

/** The Automations page, standing in the plan's place over the workspace listed. */
function mount(plans = plansControl({ workspace: WORKSPACE })): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  render(plans);
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Each row's name and owner, top to bottom. */
function rows(page: HTMLElement): string[][] {
  return [...page.querySelectorAll(".automation-row")].map((row) => [
    row.querySelector(".automation-row-name")?.textContent ?? "",
    row.querySelector(".automation-owner")?.textContent ?? "",
  ]);
}

/** The row of the automation named. */
function rowOf(page: HTMLElement, name: string): Element {
  const row = [...page.querySelectorAll(".automation-row")].find(
    (each) => each.querySelector(".automation-row-name")?.textContent === name,
  );
  assert.ok(row, `no row for ${name}`);
  return row;
}

test("the listed workspace's automations stand before the personal ones, under a heading each, every row naming its owner", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(listed, [WORKSPACE.id]);
  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme", "Personal"],
  );
  assert.deepEqual(rows(page), [
    ["Nightly flaky-test sweep", "Acme"],
    ["Dependency bumps", "Acme"],
    ["Morning digest", "Personal"],
  ]);
});

test("one owner's automations alone stand under no heading, still naming their owner", async () => {
  standing = [DIGEST];
  const page = mount();
  await settle();

  assert.equal(page.querySelectorAll(".automation-group h2").length, 0);
  assert.deepEqual(rows(page), [["Morning digest", "Personal"]]);
});

test("an automation turned off reads Off where its next run would, and a failed newest run is marked at its row's end", async () => {
  standing = [{ ...SWEEP, enabled: false }, FAILING];
  const page = mount();
  await settle();

  const off = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(off.querySelector(".automation-row-when")?.textContent, "Off");
  assert.equal(off.querySelector(".failed-mark"), null);
  assert.ok(rowOf(page, "Dependency bumps").querySelector(".failed-mark"));
});

test("a switch turns its automation off, and the row takes the service's answer in its place", async () => {
  const page = mount();
  await settle();

  const toggle = rowOf(page, "Nightly flaky-test sweep").querySelector<HTMLButtonElement>(
    "[role=switch]",
  );
  act(() => toggle?.click());
  await settle();

  assert.deepEqual(changes, [{ automationId: SWEEP.id, change: { enabled: false } }]);
  const row = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(row.querySelector(".automation-row-when")?.textContent, "Off");
  assert.equal(row.querySelector("[role=switch]")?.getAttribute("aria-checked"), "false");
});

test("an older switch's answer landing after a newer one's draws nothing over it", async () => {
  heldChanges = [];
  const page = mount();
  await settle();
  listHeld = true;
  const press = () =>
    act(() =>
      page
        .querySelector(".automation-row")
        ?.querySelector<HTMLButtonElement>("[role=switch]")
        ?.click(),
    );

  press();
  press();
  await settle();
  const [older, newer] = heldChanges;
  newer?.();
  await settle();
  older?.();
  await settle();

  assert.equal(changes.length, 2);
  assert.equal(
    page.querySelector(".automation-row-name")?.textContent,
    "Nightly flaky-test sweep, write 2",
  );
});

test("once a switch settles the list is read again, so what changed elsewhere meanwhile is drawn", async () => {
  const page = mount();
  await settle();
  standing = standing.map((each) =>
    each.id === FAILING.id ? { ...each, name: "Dependency bumps, weekly" } : each,
  );

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>("[role=switch]")
      ?.click(),
  );
  await settle();

  assert.deepEqual(rows(page), [
    ["Nightly flaky-test sweep", "Acme"],
    ["Dependency bumps, weekly", "Acme"],
    ["Morning digest", "Personal"],
  ]);
});

test("a switch that settles after the window moved to another workspace reads that workspace's list", async () => {
  const beta: Workspace = { ...WORKSPACE, id: "workspace-beta", name: "Beta" };
  const betaAutomation = automation(9, { name: "Beta's digest", workspaceId: beta.id });
  standing = [...standing, betaAutomation];
  heldChanges = [];
  const page = mount();
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>("[role=switch]")
      ?.click(),
  );
  await settle();
  render(plansControl({ workspace: beta }));
  await settle();
  heldChanges[0]?.();
  await settle();

  assert.deepEqual(rows(page), [["Beta's digest", "Personal"]]);
  assert.equal(listed.at(-1), beta.id);
});

test("a switch the service refuses stays where it was and says who may move it", async () => {
  changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mount();
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>("[role=switch]")
      ?.click(),
  );
  await settle();

  const row = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(row.querySelector("[role=switch]")?.getAttribute("aria-checked"), "true");
  assert.match(
    document.body.textContent ?? "",
    /Only its creator, or the workspace's owners and admins, can change it\./u,
  );
});

test("a list that could not be read says so, and Retry reads it again", async () => {
  standing = [DIGEST];
  lists = [{ failure: AUTOMATION_CALL_FAILURE.UNANSWERED }];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /The automations could not be read\./u);
  const retry = [...page.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  act(() => retry?.click());
  await settle();

  assert.deepEqual(listed, [WORKSPACE.id, WORKSPACE.id]);
  assert.deepEqual(rows(page), [["Morning digest", "Personal"]]);
});

test("with no automations the page says what one is, and with no workspace listed it asks for none", async () => {
  standing = [];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /No automations yet/u);
  act(() => root?.unmount());
  root = undefined;
  listed = [];

  mount(plansControl({ workspace: undefined }));
  await settle();
  assert.deepEqual(listed, []);
});
