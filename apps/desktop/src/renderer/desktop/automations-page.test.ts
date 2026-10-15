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
/** How the next reads of the list answer, in order; the last stands for every read after it. */
let lists: AutomationListView[] = [];
/** Every workspace whose list was read, in order. */
let listed: (string | undefined)[] = [];
/** Every change asked, as the act carried it. */
let changes: unknown[] = [];
/** What a change answers: the automation as changed, or why not. */
let changeRefusal:
  | (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE]
  | undefined;

beforeEach(() => {
  lists = [{ automations: [DIGEST, SWEEP, FAILING] }];
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
          const value = lists.length > 1 ? lists.shift() : lists[0];
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_CHANGE) {
          changes.push(request.payload);
          const { automationId, change } = request.payload;
          const was = [DIGEST, SWEEP, FAILING].find((each) => each.id === automationId);
          const value =
            changeRefusal !== undefined || was === undefined
              ? { failure: changeRefusal ?? AUTOMATION_CALL_FAILURE.NOT_FOUND }
              : { automation: { ...was, ...change } };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
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

/** The Automations page, standing in the plan's place over the workspace listed. */
function mount(plans = plansControl({ workspace: WORKSPACE })): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(AutomationsPage, { plans }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
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
  lists = [{ automations: [DIGEST] }];
  const page = mount();
  await settle();

  assert.equal(page.querySelectorAll(".automation-group h2").length, 0);
  assert.deepEqual(rows(page), [["Morning digest", "Personal"]]);
});

test("an automation turned off reads Off where its next run would, and a failed newest run is marked at its row's end", async () => {
  lists = [{ automations: [{ ...SWEEP, enabled: false }, FAILING] }];
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
  lists = [{ failure: AUTOMATION_CALL_FAILURE.UNANSWERED }, { automations: [DIGEST] }];
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
  lists = [{ automations: [] }];
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
