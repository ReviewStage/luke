// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCreateParams,
  type AutomationListView,
} from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { runAppCommand } from "../app-commands";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "../planning/use-plans-tab";
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
    repositories: ["acme/ledger"],
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

/** The models a new agent may run on. */
const CATALOG = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    efforts: ["low", "high"],
  },
] as const;

/** The account's default model, which a new agent runs on until another is chosen. */
const DEFAULT_CHOICE = { model: "anthropic/claude-opus-5.5", effort: "high" };

/** One agent of the workspace's on the repository, which a same-agent automation's runs may go to. */
const CI_DIGEST = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "CI digest",
  createdAt: 1,
  status: "completed",
  turnId: null,
} as const;

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
/** Every automation made, as the act carried it. */
let creates: AutomationCreateParams[] = [];
/** Every automation deleted, by its id. */
let deletes: string[] = [];
/** Every ask for a workspace's agents, as the act carried it. */
let agentsAsked: unknown[] = [];
/** The service's runs of every automation, newest first, as a read of one's runs answers them. */
let runs: AutomationRunSummary[] = [];
/** Every Run now asked, by the automation it runs. */
let runsAsked: string[] = [];
/** What a Run now answers where it does not start a run. */
let runRefusal: (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE] | undefined;
/** Every agent whose page a run opened. */
let agentsOpened: string[] = [];
/** Whether the account's default model reads, or answers that it could not. */
let defaultRefused = false;
/** How many times the model catalog was read. */
let catalogReads = 0;
/** What a change answers: the automation as changed, or why not. */
let changeRefusal:
  | (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE]
  | undefined;

beforeEach(() => {
  installScrollIntoView();
  standing = [DIGEST, SWEEP, FAILING];
  lists = [];
  listHeld = false;
  heldChanges = undefined;
  listed = [];
  changes = [];
  creates = [];
  deletes = [];
  agentsAsked = [];
  runs = [];
  runsAsked = [];
  runRefusal = undefined;
  agentsOpened = [];
  defaultRefused = false;
  catalogReads = 0;
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
        if (request.kind === ACT_KIND.AUTOMATIONS_CREATE) {
          creates.push(request.payload);
          const { workspaceId, name, trigger, action, scope, repositories } = request.payload;
          const made = automation(42, {
            workspaceId: workspaceId ?? WORKSPACE.id,
            name,
            trigger,
            action,
            scope: scope ?? AUTOMATION_SCOPE.PERSONAL,
            repositories: repositories ?? [],
          });
          standing = [made, ...standing];
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { automation: made } });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_MODELS) {
          catalogReads += 1;
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { models: CATALOG } });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_DEFAULT_READ) {
          const value = defaultRefused
            ? { failure: AUTOMATION_CALL_FAILURE.UNANSWERED }
            : { choice: DEFAULT_CHOICE };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST) {
          agentsAsked.push(request.payload);
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { agents: [CI_DIGEST] },
          });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_RUNS) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { runs } });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_RUN) {
          runsAsked.push(request.payload.automationId);
          if (runRefusal !== undefined) {
            return Promise.resolve({
              status: ACT_OUTCOME_STATUS.DONE,
              value: { failure: runRefusal },
            });
          }
          const made = {
            id: "6e7f8091-a2b3-4c4d-8e5f-60718293a4b5",
            firing: { kind: "manual" },
            status: AUTOMATION_RUN_STATUS.STARTED,
            reason: null,
            agent: { id: CI_DIGEST.id, title: null, status: "starting" },
            firedAt: 5,
            settledAt: 5,
          } as const;
          runs = [made, ...runs];
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { run: made } });
        }
        if (request.kind === ACT_KIND.AUTOMATIONS_DELETE) {
          deletes.push(request.payload.automationId);
          standing = standing.filter((each) => each.id !== request.payload.automationId);
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { deleted: true } });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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

/** The workspace the account made first, its personal one, where everything is its own. */
const PERSONAL: Workspace = { ...WORKSPACE, id: "workspace-personal", name: "Ada" };

/** Every page the Automations pages stood on, in order, as the window moved them. */
let places: AutomationsPlace[] = [];

/** Lists another workspace under the mounted pages, as the switcher would. */
let moveTo: (workspace: Workspace) => void = () => undefined;

/**
 * The Automations pages as the window holds them, standing on `start` and
 * moved by their own presses, over the workspace listed, the personal one
 * first among the account's.
 */
function mountPages(start: AutomationsPlace, workspace: Workspace = WORKSPACE): HTMLElement {
  places = [start];
  function Pages() {
    const [place, setPlace] = useState(start);
    const [listed, setListed] = useState(workspace);
    moveTo = setListed;
    const plans = plansControl({
      agentView: {
        agentId: undefined,
        onOpen: (agentId) => agentsOpened.push(agentId),
        onClose: () => undefined,
      },
      workspace: listed,
      workspaces: [PERSONAL, WORKSPACE],
      automationsView: {
        open: true,
        place,
        onOpen: (next = { kind: AUTOMATIONS_PAGE.LIST }) => {
          places.push(next);
          setPlace(next);
        },
        onClose: () => undefined,
      },
    });
    const base = plans.newPlan;
    return createElement(AutomationsPage, {
      plans: {
        ...plans,
        newPlan: {
          ...base,
          repositoriesIn: () => ({
            ...base.repositoriesIn(listed.id),
            scope: listed.id,
            recent: listed.id === WORKSPACE.id ? ["acme/ledger", "acme/web"] : ["beta/app"],
          }),
        },
      },
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  act(() =>
    root?.render(
      onRegistry(
        registry,
        createElement(Fragment, null, createElement(Pages), createElement(ToastHost)),
      ),
    ),
  );
  return container;
}

/** The button named, wherever it is drawn. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

/** Types into a field as a developer would, so React hears the change. */
function type(field: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  assert.ok(field, "the field is drawn");
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The crumbs' words, in order. */
function crumbs(page: HTMLElement): string {
  return page.querySelector(".automation-crumbs")?.textContent ?? "";
}

test("a row opens its automation's page, under crumbs naming its owner, with what it was saved as", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>(".automation-row-open")
      ?.click(),
  );
  await settle();

  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  assert.equal(crumbs(page), "AutomationsAcmeNightly flaky-test sweep");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  assert.match(
    page.textContent ?? "",
    /A workspace automation: everyone in Acme sees and runs it\./u,
  );
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
});

test("a new automation is created only once it is named and told its task, and then stands as its own page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.equal(crumbs(page), "AutomationsPersonalNew automation");

  act(() => button("Create").click());
  await settle();
  assert.deepEqual(creates, []);
  assert.match(page.textContent ?? "", /Name it\./u);
  assert.match(page.textContent ?? "", /Tell the agent what to do\./u);

  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  type(page.querySelector("textarea[aria-label='Task']"), "Triage the issues opened overnight.");
  act(() => button("Create").click());
  await settle();

  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0], {
    workspaceId: WORKSPACE.id,
    name: "Morning triage",
    trigger: {
      kind: AUTOMATION_TRIGGER.SCHEDULE,
      cron: "0 9 * * 1-5",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage the issues opened overnight." },
    scope: AUTOMATION_SCOPE.PERSONAL,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
    archiveSuccessful: false,
    repositories: ["acme/ledger"],
  });
  assert.equal(places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.equal(crumbs(page), "AutomationsPersonalMorning triage");
});

test("an edit says it is unsaved and saves only what moved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("textarea[aria-label='Task']"), "Fix the two flakiest tests.");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: { action: { ...SWEEP.action, prompt: "Fix the two flakiest tests." } },
    },
  ]);
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
});

test("a save the service refuses keeps the draft and says why under the name", async () => {
  changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => button("Save").click());
  await settle();

  assert.equal(
    page.querySelector(".automation-save-refusal")?.textContent,
    "Only its creator, or the workspace's owners and admins, can change it.",
  );
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Sweep",
  );
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
});

test("a deletion asks first, then goes back to the list without the automation", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button(`Delete ${SWEEP.name}`).click());
  await settle();
  assert.deepEqual(deletes, []);
  act(() => button("Delete").click());
  await settle();

  assert.deepEqual(deletes, [SWEEP.id]);
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
});

test("Escape leaves a page with nothing unsaved for the list, and keeps one whose draft would be lost", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  assert.equal(places.length, 1, "the unsaved draft stands");

  type(page.querySelector("input[aria-label='Automation name']"), SWEEP.name);
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("the Owner row stands in a shared workspace, and not in the account's personal one", async () => {
  const shared = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.ok(shared.querySelector("[aria-label='Owner']"));
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const personal = mountPages({ kind: AUTOMATIONS_PAGE.NEW }, PERSONAL);
  await settle();
  assert.equal(personal.querySelector("[aria-label='Owner']"), null);
  assert.match(personal.textContent ?? "", /Your automation, in your personal workspace\./u);
});

test("a page naming an automation the list no longer holds says it is gone", async () => {
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "3f0e6f5c-7d1a-4f6e-9a55-999999999999",
  });
  await settle();

  assert.match(page.textContent ?? "", /This automation is gone/u);
});

test("what is typed while a save is out stands, unsaved, once the save lands", async () => {
  heldChanges = [];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => button("Save").click());
  await settle();
  type(page.querySelector("textarea[aria-label='Task']"), "Fix the two flakiest tests.");
  heldChanges[0]?.();
  await settle();

  assert.equal(
    page.querySelector<HTMLTextAreaElement>("textarea[aria-label='Task']")?.value,
    "Fix the two flakiest tests.",
  );
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
});

test("an automation's page whose list could not be read says so with Retry, rather than calling it gone", async () => {
  lists = [{ failure: AUTOMATION_CALL_FAILURE.UNANSWERED }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /The automations could not be read\./u);
  assert.doesNotMatch(page.textContent ?? "", /gone/u);
  act(() => button("Retry").click());
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
});

test("a new automation's page moved to another workspace starts afresh in that workspace's repository", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");

  act(() => moveTo({ ...WORKSPACE, id: "workspace-beta", name: "Beta" }));
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Beta triage");
  type(page.querySelector("textarea[aria-label='Task']"), "Triage Beta's issues.");
  act(() => button("Create").click());
  await settle();

  assert.equal(creates.length, 1);
  assert.deepEqual(
    [creates[0]?.workspaceId, creates[0]?.repositories],
    ["workspace-beta", ["beta/app"]],
  );
});

test("an automation fired by an event shows its trigger as it is, and a save leaves it so", async () => {
  const onEvent = automation(7, {
    name: "Triage new bugs",
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "issue-opened" },
  });
  standing = [onEvent];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: onEvent.id });
  await settle();

  assert.match(page.textContent ?? "", /It runs on an event rather than a schedule/u);
  assert.equal(page.querySelector("[aria-label='Time zone']"), null);
  type(page.querySelector("textarea[aria-label='Task']"), "Reproduce the bug first.");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: onEvent.id,
      change: { action: { ...onEvent.action, prompt: "Reproduce the bug first." } },
    },
  ]);
});

test("Escape keeps a new page whose schedule was changed, though nothing was typed", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  act(() => button("Daily").click());
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));

  assert.equal(places.length, 1);
});

test("a refresh that fails while an automation's page stands keeps the page and what was typed in it", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");

  lists = [{ failure: AUTOMATION_CALL_FAILURE.UNANSWERED }];
  act(() => page.querySelector<HTMLButtonElement>(".automations-view [role=switch]")?.click());
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Sweep",
  );
  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
});

test("the repository chosen first is not said again among the others its runs work in", async () => {
  const several = automation(8, {
    name: "Cross-repo sweep",
    repositories: ["acme/ledger", "acme/web"],
  });
  standing = [several];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: several.id });
  await settle();
  assert.match(page.textContent ?? "", /also work in acme\/web\./u);

  act(() => page.querySelector<HTMLButtonElement>(".automation-form .chip")?.click());
  await settle();
  act(() => button("acme/web").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /also work in/u);
});

test("runs land in a new agent on the account's default until a model is chosen, and archiving successful runs is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /Your default, until you choose one\./u);
  const archive = page.querySelector<HTMLInputElement>(".automation-check input");
  act(() => archive?.click());
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [{ automationId: SWEEP.id, change: { archiveSuccessful: true } }]);
});

test("Same agent is chosen from the workspace's agents on the automation's repository, and saved as its target", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Same agent").click());
  await settle();
  assert.deepEqual(agentsAsked, [{ workspaceId: WORKSPACE.id, repository: "acme/ledger" }]);
  act(() => button("Save").click());
  await settle();
  assert.deepEqual(changes, [], "a same agent with none chosen is not saved");
  assert.match(page.textContent ?? "", /Choose the agent its runs go to\./u);

  const picker = page.querySelector<HTMLSelectElement>("select[aria-label='Agent']");
  assert.ok(picker);
  act(() => {
    picker.value = CI_DIGEST.id;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: CI_DIGEST.id } },
    },
  ]);
});

test("an automation's runs stand on its page's right, newest first, a run that started an agent opening it", async () => {
  runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 3,
      settledAt: 3,
    },
    {
      id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const panel = page.querySelector("aside[aria-label='Runs']");
  assert.deepEqual(
    [...(panel?.querySelectorAll(".automation-run") ?? [])].map((row) => [
      row.querySelector(".automation-row-name")?.textContent,
      row.querySelector(".automation-row-detail")?.textContent,
    ]),
    [
      ["Fix the flaky test", "Working"],
      ["Scheduled run", "Its creator is no longer in the workspace."],
    ],
  );
  act(() => panel?.querySelector<HTMLButtonElement>("button.automation-run")?.click());
  assert.deepEqual(agentsOpened, [CI_DIGEST.id]);
  assert.equal(
    panel?.querySelectorAll("button.automation-run").length,
    1,
    "a run that started no agent is no press",
  );
});

test("Run now starts a run under a key of its own, and the run stands first once it settles", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.match(
    page.querySelector("aside[aria-label='Runs']")?.textContent ?? "",
    /No runs yet\. Run now to try it\./u,
  );

  act(() => button("Run now").click());
  await settle();

  assert.deepEqual(runsAsked, [SWEEP.id]);
  assert.equal(
    page.querySelector("aside[aria-label='Runs'] .automation-row-name")?.textContent,
    "Run now",
  );
});

test("a Run now the service refuses says why under the name, and a new automation has no Run now", async () => {
  runRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Run now").click());
  await settle();
  assert.equal(
    page.querySelector(".automation-save-refusal")?.textContent,
    "Only its creator, or the workspace's owners and admins, can run it.",
  );
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const fresh = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.ok(![...fresh.querySelectorAll("button")].some((each) => each.textContent === "Run now"));
  assert.match(fresh.textContent ?? "", /Create it, then Run now to try it\./u);
});

/** A run of the sweep that started the CI digest agent, which a press on its row opens. */
const SWEEP_RUN = {
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
  status: AUTOMATION_RUN_STATUS.STARTED,
  reason: null,
  agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
  firedAt: 3,
  settledAt: 3,
} as const;

test("opening a run's agent with unsaved changes asks first, and Leave opens it", async () => {
  runs = [SWEEP_RUN];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");

  act(() => page.querySelector<HTMLButtonElement>("button.automation-run")?.click());
  await settle();
  assert.deepEqual(agentsOpened, []);
  act(() => button("Leave").click());
  await settle();

  assert.deepEqual(agentsOpened, [CI_DIGEST.id]);
});

test("a Run now that settles reads the list again, so its newest run stands there too", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const before = listed.length;

  act(() => button("Run now").click());
  await settle();

  assert.ok(listed.length > before);
});

test("a default model that could not be read is said as unknown, and a model can still be chosen", async () => {
  defaultRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.equal(page.querySelector(".agent-model-chip"), null, "no model is drawn as the default");
  assert.match(page.textContent ?? "", /It runs on your default model, which could not be read\./u);
  // Note that the menu is hung from the chip by its laid-out boxes, which jsdom draws none of.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("automation-model-picker"))
      return DOMRect.fromRect({ x: 200, y: 400, width: 120, height: 24 });
    if (this.classList.contains("anchored-popover"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 300 });
    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  const readsBefore = catalogReads;
  act(() => button("Choose a model").click());
  await settle();

  assert.ok(page.querySelector(".agent-model-menu"), "the model menu opens");
  assert.equal(catalogReads, readsBefore + 1, "opening it reads the catalog again");
  assert.equal(
    page.querySelector(".automation-editor-status")?.textContent,
    "Saved",
    "opening the menu chooses nothing",
  );
});
