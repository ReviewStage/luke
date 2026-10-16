// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationCreateParams,
  type AutomationListView,
} from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationRunSummary,
  type AutomationSummary,
  GITHUB_TRIGGER_EVENT,
} from "@luke/features/automation-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
} from "@luke/features/integration-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT, type Experiment } from "@luke/settings";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { handState } from "#testing/app-state";
import { layContainersAt, shown } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { fadedEdges, layFades } from "#testing/scroll-fade";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { runAppCommand } from "../app-commands";
import { OpenFeedbackProvider } from "../open-feedback";
import { AUTOMATIONS_PAGE, type AutomationsPlace, useLeaveGuard } from "../tasks/use-tasks-tab";
import { ToastHost } from "../toast";
import { appStateNow } from "../use-app-state";
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
/** Whether a Run now is held unanswered, as one still out on the wire. */
let runHeld = false;
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

/** The secrets a write answers once: a webhook made, and a new secret asked for. Synthetic. */
const MADE_SECRET = "whsec-fixture-made-once";
const ROTATED_SECRET = "whsec-fixture-rotated-once";

/** The automations a fresh webhook secret was asked for. */
let secretsAsked: string[] = [];
/** What the window handed main's clipboard itself. */
let copied: string[] = [];
/** The experiments a Send feedback was about, in order. */
let feedbackAbout: Experiment[] = [];

beforeEach(() => {
  installScrollIntoView();
  secretsAsked = [];
  copied = [];
  feedbackAbout = [];
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
  runHeld = false;
  runRefusal = undefined;
  agentsOpened = [];
  factoryOpens = [];
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
          const hooked = trigger.kind === AUTOMATION_TRIGGER.WEBHOOK;
          const made = automation(42, {
            workspaceId: workspaceId ?? WORKSPACE.id,
            name,
            trigger,
            action,
            scope: scope ?? AUTOMATION_SCOPE.PERSONAL,
            repositories: repositories ?? [],
            ...(hooked
              ? { webhookUrl: "https://tryluke.dev/api/automations/made/webhook" }
              : undefined),
          });
          standing = [made, ...standing];
          // A webhook's secret is answered once, by the write that minted it.
          const value = hooked
            ? { automation: made, webhookSecret: MADE_SECRET }
            : { automation: made };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.INTEGRATIONS_STATUS) {
          // Linear and Sentry are connected; the rest are not.
          const integrations = Object.fromEntries(
            INTEGRATION_PROVIDER_LIST.map((provider) => [
              provider,
              provider === INTEGRATION_PROVIDER.LINEAR || provider === INTEGRATION_PROVIDER.SENTRY
                ? INTEGRATION_STATUS.CONNECTED
                : INTEGRATION_STATUS.DISCONNECTED,
            ]),
          );
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { integrations } });
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
          if (runHeld) return new Promise<never>(() => undefined);
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
        if (request.kind === ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET) {
          secretsAsked.push(request.payload.automationId);
          const automation = standing.find((each) => each.id === request.payload.automationId);
          const value =
            automation === undefined
              ? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND }
              : { automation, webhookSecret: ROTATED_SECRET };
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
        }
        if (request.kind === ACT_KIND.WINDOW_COPY_TEXT) {
          copied.push(request.payload.words);
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
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
  document.head.innerHTML = "";
});

/** The window's own stylesheet, which says how tall a row's field stands. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

/** How tall the field stands as the window's stylesheet draws it. */
function heightOf(field: Element | null): string {
  assert.ok(field, "the field stands");
  if (document.head.querySelector("style") === null) {
    document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  }
  return getComputedStyle(field).getPropertyValue("height");
}

/** The registry every render of one mount shares, so a render again is the same window. */
let registry = AtomRegistry.make();

/** The page as drawn over the plans control given, rendered again in place where one stands. */
function render(tasks: ReturnType<typeof tasksControl>): void {
  act(() =>
    root?.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          createElement(AutomationsPage, { tasks }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
}

/** The Automations page, standing in the plan's place over the workspace listed. */
function mount(tasks = tasksControl({ workspace: WORKSPACE })): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  render(tasks);
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
    row.querySelector(".automation-owner-name")?.textContent ?? "",
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

test("a schedule's time and a custom schedule's cron stand at the height of the pickers beside them", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  assert.equal(heightOf(page.querySelector("input[aria-label='Time']")), "var(--control-height)");
  pick(page, "Repeats", "Custom");
  assert.equal(heightOf(page.querySelector("input[aria-label='Cron']")), "var(--control-height)");
});

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
  render(tasksControl({ workspace: beta }));
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

  mount(tasksControl({ workspace: undefined }));
  await settle();
  assert.deepEqual(listed, []);
});

/** The workspace the account made first, its personal one, where everything is its own. */
const PERSONAL: Workspace = { ...WORKSPACE, id: "workspace-personal", name: "Ada" };

/** Each time Factory was opened past the page, as the sidebar's row opens it. */
let factoryOpens: number[] = [];

/** Opens Factory as the sidebar's row would, through the window's guarded door. */
let openFactory: () => void = () => undefined;

/** Every page the Automations pages stood on, in order, as the window moved them. */
let places: AutomationsPlace[] = [];

/** Sends the window to a place among the automations, as a link opened there does. */
let sendTo: (place: AutomationsPlace) => void = () => undefined;
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
    sendTo = setPlace;
    const [listed, setListed] = useState(workspace);
    moveTo = setListed;
    // The window's own guard, over doors guarded as the Plans tab guards its own.
    const leaveGuard = useLeaveGuard();
    const plans = tasksControl({
      leaveGuard,
      agentView: {
        agentId: undefined,
        onOpen: leaveGuard.guard((agentId: string) => agentsOpened.push(agentId)),
        onClose: () => undefined,
      },
      factoryView: {
        open: false,
        onOpen: leaveGuard.guard(() => factoryOpens.push(1)),
        onClose: () => undefined,
      },
      workspace: listed,
      workspaces: [PERSONAL, WORKSPACE],
      automationsView: {
        open: true,
        place,
        onOpen: leaveGuard.guard((next: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST }) => {
          places.push(next);
          setPlace(next);
        }),
        onClose: () => undefined,
      },
    });
    const base = plans.newTask;
    openFactory = plans.factoryView.onOpen;
    return createElement(AutomationsPage, {
      tasks: {
        ...plans,
        newTask: {
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
        createElement(
          OpenFeedbackProvider,
          { value: (about: Experiment) => feedbackAbout.push(about) },
          createElement(Fragment, null, createElement(Pages), createElement(ToastHost)),
        ),
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

/** The item of the menu standing open whose words are `name`. */
function menuItem(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"]:not([data-leaving]) [role="menuitem"]',
    ),
  ].find((each) => each.textContent === name);
  assert.ok(found, `no menu item ${name}`);
  return found;
}

/** The button of the dialog standing whose words are `name`. */
function dialogButton(name: string): HTMLButtonElement {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(
      "[role=dialog] button, [role=alertdialog] button",
    ),
  ].find((each) => each.textContent === name);
  assert.ok(found, `no dialog button ${name}`);
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

/** The picker named, by its chip's own name: "Event: Issue opened". */
function picker(page: HTMLElement, label: string): HTMLButtonElement {
  const found = page.querySelector<HTMLButtonElement>(`button[aria-label^="${label}: "]`);
  assert.ok(found, `no picker ${label}`);
  return found;
}

/** What the picker named says it holds now. */
function picked(page: HTMLElement, label: string): string | undefined {
  return picker(page, label)
    .getAttribute("aria-label")
    ?.slice(label.length + 2);
}

/** What the row of the picker named says under its name: the trigger's sentence under Type. */
function pickerDetail(page: HTMLElement, label: string): string | undefined {
  const id = picker(page, label).getAttribute("aria-describedby");
  return id === null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
}

/** Picks an option as a developer would: the picker's chip, then the menu's row of that name. */
function pick(page: HTMLElement, label: string, option: string): void {
  act(() => picker(page, label).click());
  const row = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find(
    (each) => each.querySelector(".task-compose-menu-name")?.textContent === option,
  );
  assert.ok(row, `no ${option} in ${label}`);
  act(() => row.click());
}

/** The titles of the page's cards, in order. */
function cards(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".settings-group-title")].map(
    (title) => title.textContent ?? "",
  );
}

/** The switch named, wherever it is drawn. */
function switchNamed(name: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${name}"]`);
  assert.ok(found, `no switch ${name}`);
  return found;
}

/** Whether the switch named is on. */
function isOn(name: string): boolean {
  return switchNamed(name).getAttribute("aria-checked") === "true";
}

/** The crumbs' words, in order. */
function crumbs(page: HTMLElement): string {
  return page.querySelector(".automation-crumbs")?.textContent ?? "";
}

test("an automation's whole row is its press: its owner and its next run open it too, and its switch only switches it", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const row = rowOf(page, "Nightly flaky-test sweep");
  const owner = row.querySelector<HTMLElement>(".automation-owner");
  assert.ok(owner, "the row names its owner");
  act(() => owner.click());
  await settle();
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });

  act(() => root?.unmount());
  document.body.innerHTML = "";
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const when = rowOf(list, "Nightly flaky-test sweep").querySelector<HTMLElement>(
    ".automation-row-when",
  );
  assert.ok(when, "the row says when it runs next");
  act(() => when.click());
  await settle();
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });

  act(() => root?.unmount());
  document.body.innerHTML = "";
  mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  act(() => button(`Turn off ${SWEEP.name}`).click());
  await settle();
  assert.deepEqual(places, [{ kind: AUTOMATIONS_PAGE.LIST }], "the switch opens nothing");
  assert.ok(changes.length > 0, "and switches it");
});

test("a row opens its automation's page, under crumbs naming it, with what it was saved as", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep")
      .querySelector<HTMLButtonElement>(".automation-row-open")
      ?.click(),
  );
  await settle();

  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  assert.equal(crumbs(page), "AutomationsNightly flaky-test sweep");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
});

test("a new automation is created only once it is named and told its task, and then stands as its own page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.equal(crumbs(page), "AutomationsNew automation");

  act(() => button("Create").click());
  await settle();
  assert.deepEqual(creates, []);
  assert.match(page.textContent ?? "", /Name it\./u);
  assert.match(page.textContent ?? "", /Tell the agent what to do\./u);

  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage the issues opened overnight.");
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
  assert.equal(crumbs(page), "AutomationsMorning triage");
});

test("an edit says it is unsaved and saves only what moved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the two flakiest tests.");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: {
        action: { ...SWEEP.action, prompt: "Fix the two flakiest tests.", disabledServers: [] },
      },
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

  act(() => button("Automation actions").click());
  act(() => menuItem("Delete").click());
  await settle();
  assert.deepEqual(deletes, []);
  act(() => dialogButton("Delete").click());
  await settle();

  assert.deepEqual(deletes, [SWEEP.id]);
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
});

/** The leave dialog's question, while it stands. */
function leaveAsked(): string | undefined {
  return [...document.querySelectorAll("[role=dialog], [role=alertdialog]")]
    .map((dialog) => dialog.textContent ?? "")
    .find((words) => words.includes("Leave with unsaved changes?"));
}

test("Escape leaves a page with nothing unsaved for the list, and asks first where its draft would be lost", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  assert.equal(places.length, 1, "the unsaved draft stands");
  assert.ok(leaveAsked(), "the leave question stands");
  act(() => button("Cancel").click());
  await settle();
  assert.equal(leaveAsked(), undefined);

  type(page.querySelector("input[aria-label='Automation name']"), SWEEP.name);
  act(() => runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS));
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("a new automation with something written asks before any way out leaves it, and Leave goes where was asked", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage the issues opened overnight.");
  act(() => button("Automations").click());
  assert.equal(places.length, 1, "the crumb waits on the question");
  assert.ok(leaveAsked(), "the leave question stands");
  act(() => button("Cancel").click());
  await settle();

  act(() => openFactory());
  assert.deepEqual(factoryOpens, [], "the sidebar's row waits on the question too");
  act(() => button("Leave").click());
  await settle();
  assert.deepEqual(factoryOpens, [1]);
});

test("a new automation with nothing written leaves at once, and one just created stands as its own page without asking", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  act(() => button("Automations").click());
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
  assert.equal(leaveAsked(), undefined);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage the issues opened overnight.");
  act(() => button("Create").click());
  await settle();
  assert.equal(places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.equal(leaveAsked(), undefined);
});

test("the Owner row stands in a shared workspace, and not in the account's personal one", async () => {
  const shared = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.equal(picked(shared, "Owner"), "Personal");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const personal = mountPages({ kind: AUTOMATIONS_PAGE.NEW }, PERSONAL);
  await settle();
  assert.equal(personal.querySelector("button[aria-label^='Owner: ']"), null);
});

/** The groups of the editor's form, by their titles, top to bottom. */
function formGroups(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".automation-form .settings-group-title")].map(
    (title) => title.textContent ?? "",
  );
}

test("who owns an automation is the editor's first setting, and nowhere else on its page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.equal(formGroups(page)[0], "Sharing");
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor .automation-owner"), null);
  assert.equal(page.querySelector(".automation-crumbs .automation-owner"), null);
});

test("the Owner picker draws Personal by the account's picture and the workspace by its tile, on its chip and in its menu", async () => {
  handState({});
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  const chip = picker(page, "Owner");
  assert.ok(
    chip.querySelector(".actor-mark[data-kind='person']"),
    "Personal wears the account's mark",
  );
  act(() => chip.click());
  const marks = [...document.querySelectorAll("[role=option]")].map((row) => [
    row.querySelector(".task-compose-menu-name")?.textContent,
    row.querySelector(".actor-mark") !== null
      ? "person"
      : row.querySelector(".workspace-tile") !== null
        ? "tile"
        : "none",
  ]);
  assert.deepEqual(marks, [
    ["Personal", "person"],
    ["Acme", "tile"],
  ]);

  const acme = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find(
    (row) => row.querySelector(".task-compose-menu-name")?.textContent === "Acme",
  );
  assert.ok(acme, "the menu offers the workspace");
  act(() => acme.click());
  assert.ok(picker(page, "Owner").querySelector(".workspace-tile"), "the workspace wears its tile");
});

test("another's personal automation's Owner picker draws its owner unnamed, never as the reader", async () => {
  handState({});
  standing = [{ ...DIGEST, mine: false }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id });
  await settle();

  assert.equal(
    picker(page, "Owner").querySelector(".actor-mark")?.getAttribute("data-kind"),
    "someone",
  );
});

test("the list's Owner column draws the workspace by its tile, the account's own by its picture, and another's personal one unnamed", async () => {
  handState({});
  standing = [
    SWEEP,
    { ...DIGEST, mine: true },
    { ...FAILING, scope: AUTOMATION_SCOPE.PERSONAL, mine: false },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const markOf = (name: string) => {
    const owner = rowOf(page, name).querySelector(".automation-owner");
    if (owner?.querySelector(".workspace-tile")) return "tile";
    return owner?.querySelector(".actor-mark")?.getAttribute("data-kind") ?? "none";
  };
  assert.equal(markOf(SWEEP.name), "tile");
  assert.equal(markOf(DIGEST.name), "person");
  assert.equal(markOf(FAILING.name), "someone");
});

test("a new agent's MCP servers are a field chip of the owner's connected ones until switched off, the row naming those off, and a switch saves with the task", async () => {
  standing = [{ ...SWEEP, mine: true }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const chip = button("MCP servers");
  assert.match(page.textContent ?? "", /Every connected server is on\./u);
  assert.equal(chip.querySelectorAll(".provider-mark").length, 2, "Linear's and Sentry's marks");

  act(() => chip.click());
  await settle();
  const sentry = document.querySelector<HTMLButtonElement>(
    "[role=switch][aria-label='Sentry for this agent']",
  );
  assert.ok(sentry, "the agent box's own switches stand");
  act(() => sentry.click());
  assert.match(page.textContent ?? "", /Sentry off\./u);
  assert.equal(chip.querySelectorAll(".provider-mark").length, 1, "Linear's mark alone");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: { action: { ...SWEEP.action, disabledServers: [INTEGRATION_PROVIDER.SENTRY] } },
  });
});

test("another member's automation says which servers its creator switched off, offering no switch of the reader's own", async () => {
  standing = [
    {
      ...SWEEP,
      mine: false,
      action: { ...SWEEP.action, disabledServers: [INTEGRATION_PROVIDER.SENTRY, "notion-2"] },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(
    page.textContent ?? "",
    /Its creator's connected servers, but Sentry, Notion \(account 2\) switched off\./u,
  );
  assert.equal(
    [...page.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === "MCP servers",
    ),
    undefined,
  );
});

test("the Runs panel hides and shows by its toggle and by the side panel's chord, and stays as it was left", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.ok(page.querySelector("aside[aria-label='Runs']"), "it stands at first");

  act(() => button("Hide runs").click());
  assert.equal(page.querySelector("aside[aria-label='Runs']"), null);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const again = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(again.querySelector("aside[aria-label='Runs']"), null, "folded as it was left");
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL));
  assert.ok(again.querySelector("aside[aria-label='Runs']"), "⌥⌘B brings it back");
  window.localStorage.clear();
});

/** A motion the page played: the element it played on, its keyframes, and a way to have it finish. */
interface Played {
  element: Element;
  keyframes: Keyframe[];
  finish: () => void;
}

/** What the recording engine answers a motion with: no more of an Animation than the page reaches for. */
interface RecordedMotion {
  onfinish: (() => void) | null;
  cancel: () => void;
}

/**
 * Gives the window the pane's motion tokens and an animation engine that
 * records what is played rather than playing it, since jsdom has neither;
 * answers what was played, and a way to take both away again.
 */
function playMotions() {
  const played: Played[] = [];
  const root = document.documentElement.style;
  root.setProperty("--duration-pane", "240ms");
  root.setProperty("--motion-pane", "ease-out");
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const animation: RecordedMotion = {
        onfinish: null,
        cancel: () => undefined,
      };
      played.push({ element: this, keyframes, finish: () => animation.onfinish?.() });
      return animation;
    },
  });
  return {
    played,
    remove: () => {
      root.removeProperty("--duration-pane");
      root.removeProperty("--motion-pane");
      Reflect.deleteProperty(Element.prototype, "animate");
    },
  };
}

test("the Runs panel slides out past the page's right edge as it is hidden, held drawn and out of reach until it has, and slides back in as it is shown", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const pane = () => page.querySelector<HTMLElement>(".automation-runs-pane");
  const motions = playMotions();
  try {
    act(() => button("Hide runs").click());
    const leaving = pane() ?? assert.fail("the panel is held drawn through its slide out");
    assert.ok(leaving.hasAttribute("data-leaving"), "it has left the layout");
    assert.ok(leaving.hasAttribute("inert"), "nothing in it is reached on its way out");
    const exit = motions.played.find((each) => each.element === leaving);
    assert.deepEqual(exit?.keyframes.at(-1), { transform: "translateX(100%)" });

    act(() => exit?.finish());
    assert.equal(pane(), null, "it is let go once its slide has played");

    act(() => button("Show runs").click());
    const arriving = pane() ?? assert.fail("it stands again");
    assert.equal(arriving.hasAttribute("data-leaving"), false);
    const entry = motions.played.find((each) => each.element === arriving);
    assert.deepEqual(entry?.keyframes, [{ transform: "translateX(100%)" }, { transform: "none" }]);
  } finally {
    motions.remove();
    window.localStorage.clear();
  }
});

test("the automations' rows, an automation's page, and its runs fade under the bar as they scroll up beneath it, rather than being sliced at its hairline", async () => {
  window.localStorage.clear();
  const list = mount();
  await settle();
  const rows = list.querySelector(".automations-scroll") ?? assert.fail("the list scrolls");
  act(() => root?.unmount());

  const edit = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const form = edit.querySelector(".automations-scroll") ?? assert.fail("the page scrolls");
  const runs = edit.querySelector("aside[aria-label='Runs']") ?? assert.fail("the runs stand");
  const sheets = layFades();
  try {
    for (const scroller of [rows, form, runs]) {
      assert.deepEqual(fadedEdges(scroller), { top: true, bottom: false });
    }
  } finally {
    sheets.remove();
  }
});

test("the Runs panel's edge resizes it within its bounds, and the width stands on the next page", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const pane = () => document.querySelector<HTMLElement>(".automation-runs-pane");
  const edge = page.querySelector<HTMLElement>("[role=separator][aria-label='Resize runs']");
  assert.ok(edge, "the panel has a resize edge");
  assert.equal(pane()?.style.width, "340px");

  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  assert.equal(pane()?.style.width, "356px", "the arrow away from the panel widens it");
  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
  assert.equal(pane()?.style.width, "280px", "Home is its least width");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(pane()?.style.width, "280px");
  window.localStorage.clear();
});

test("the list and an automation's page each say they are an experiment, and each Send feedback is about Automations", async () => {
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  assert.equal(list.querySelector(".experiment-tag")?.textContent, "Experimental");
  act(() => button("Send feedback").click());
  act(() => root?.unmount());

  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(page.querySelector(".experiment-tag")?.textContent, "Experimental");
  act(() => button("Send feedback").click());

  assert.deepEqual(feedbackAbout, [EXPERIMENT.AUTOMATIONS, EXPERIMENT.AUTOMATIONS]);
});

/** The pill the pointer resting on `element` raises, or nothing where it raises none. */
function pillOver(element: Element): string | undefined {
  act(() => element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  return pill;
}

test("an automation's toolbar too narrow for its acts' words beside its name folds the way back, Send feedback, and Run now to their glyphs, each named and its words its pill, and leaves the draft's state to Save", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const toolbar = page.querySelector(".automation-toolbar") ?? assert.fail("no toolbar");
  const status = toolbar.querySelector(".automation-editor-status") ?? assert.fail("no status");
  const acts = () =>
    ["Automations", "Send feedback", "Run now"].map((name) => {
      const press =
        [...toolbar.querySelectorAll("button")].find((each) => each.textContent === name) ??
        assert.fail(`no ${name}`);
      const words = press.querySelector(".toolbar-button-words") ?? assert.fail("no words");
      return {
        name,
        drawn: shown(words),
        labelled: press.getAttribute("aria-label"),
        pill: pillOver(press),
      };
    });

  // A 760 window's toolbar, past the traffic lights.
  const narrow = layContainersAt({ "automation-toolbar": 570 });
  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", drawn: false, labelled: "Automations", pill: "Automations" },
      { name: "Send feedback", drawn: false, labelled: "Send feedback", pill: "Send feedback" },
      { name: "Run now", drawn: false, labelled: "Run now", pill: "Run now" },
    ]);
    assert.equal(shown(status), false);
  } finally {
    narrow.remove();
  }
  const wide = layContainersAt({ "automation-toolbar": 1100 });
  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", drawn: true, labelled: null, pill: undefined },
      { name: "Send feedback", drawn: true, labelled: null, pill: undefined },
      { name: "Run now", drawn: true, labelled: null, pill: undefined },
    ]);
    assert.equal(shown(status), true);
  } finally {
    wide.remove();
  }
});

test("the crumb naming an automation, cut short by its toolbar, reads whole on the pointer, and drawn whole raises nothing", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const crumb = page.querySelector(".automation-crumb") ?? assert.fail("no crumb");

  assert.equal(pillOver(crumb), undefined);
  Object.defineProperty(crumb, "scrollWidth", { configurable: true, value: 240 });
  Object.defineProperty(crumb, "clientWidth", { configurable: true, value: 60 });
  act(() => relayout());
  assert.equal(pillOver(crumb), SWEEP.name);
});

test("the Owner menu is as wide as its widest owner's name, within the room the form leaves it from the chip's edge, so a long name reads whole and no row's start is cut off", async () => {
  handState({});
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  const chip = picker(page, "Owner");
  const form = page.querySelector(".automations-scroll") ?? assert.fail("no form scroller");
  // The form beside the runs, 300px from its left edge to the chip's right one.
  vi.spyOn(chip, "getBoundingClientRect").mockReturnValue(new DOMRect(380, 120, 160, 28));
  vi.spyOn(form, "getBoundingClientRect").mockReturnValue(new DOMRect(240, 40, 420, 600));

  const sheets = layContainersAt({});
  try {
    act(() => chip.click());
    const menu = page.querySelector(".settings-picker-menu") ?? assert.fail("no menu");
    const room = chip.closest<HTMLElement>(".settings-picker")?.style;
    assert.equal(getComputedStyle(menu).width, "max-content");
    assert.equal(room?.getPropertyValue("--settings-picker-width-max"), "294px");
  } finally {
    sheets.remove();
  }
});

test("a Run now still out on a toolbar too narrow for its words draws its ring in its glyph's place", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  runHeld = true;
  const narrow = layContainersAt({ "automation-toolbar": 570 });
  try {
    act(() => relayout());
    const run = button("Run now");
    act(() => run.click());
    await settle();

    assert.deepEqual(
      {
        pressable: !run.disabled,
        ring: run.querySelector('.spinner[role="status"]') !== null,
        glyph: run.querySelector("svg.lucide-play") !== null,
      },
      { pressable: false, ring: true, glyph: false },
    );
  } finally {
    narrow.remove();
  }
});

test("a page naming an automation the list does not hold, as a link to another workspace's may, says it is not found and draws nothing of it", async () => {
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "3f0e6f5c-7d1a-4f6e-9a55-999999999999",
  });
  await settle();

  assert.match(
    page.textContent ?? "",
    /Not foundThis automation doesn't exist, or you don't have access to it\./u,
  );
});

test("what is typed while a save is out stands, unsaved, once the save lands", async () => {
  heldChanges = [];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");
  act(() => button("Save").click());
  await settle();
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the two flakiest tests.");
  heldChanges[0]?.();
  await settle();

  assert.equal(
    page.querySelector<HTMLTextAreaElement>("textarea[aria-label='Prompt']")?.value,
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
  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage Beta's issues.");
  act(() => button("Create").click());
  await settle();

  assert.equal(creates.length, 1);
  assert.deepEqual(
    [creates[0]?.workspaceId, creates[0]?.repositories],
    ["workspace-beta", ["beta/app"]],
  );
});

test("an automation fired by an event says its trigger in one sentence, and a save of its task leaves the trigger so", async () => {
  const onEvent = automation(7, {
    name: "Triage new bugs",
    trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "issue-opened", labels: ["bug"] },
  });
  standing = [onEvent];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: onEvent.id });
  await settle();

  assert.equal(
    pickerDetail(page, "Type"),
    "When an issue by people is opened in acme/ledger labelled bug",
  );
  assert.equal(picked(page, "Event"), "Issue opened");
  assert.equal(page.querySelector("button[aria-label^='Time zone: ']"), null);
  type(page.querySelector("textarea[aria-label='Prompt']"), "Reproduce the bug first.");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: onEvent.id,
      change: {
        action: { ...onEvent.action, prompt: "Reproduce the bug first.", disabledServers: [] },
      },
    },
  ]);
});

test("Escape keeps a new page whose schedule was changed, though nothing was typed", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Repeats", "Daily");
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

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .luke-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => button("webacme").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /also work in/u);
});

test("runs land in a new agent on the account's default until a model is chosen, and archiving successful runs is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /Your default, until you choose one\./u);
  act(() => button("Archive successful runs").click());
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [{ automationId: SWEEP.id, change: { archiveSuccessful: true } }]);
});

test("an agent the workspace's list no longer holds stays the pick it was saved as, and can be picked again after another", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
  const following = automation(10, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });
  standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();
  assert.equal(picked(page, "Agent"), "The agent it goes to now");

  pick(page, "Agent", "CI digest");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
  pick(page, "Agent", "The agent it goes to now");

  assert.equal(picked(page, "Agent"), "The agent it goes to now");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
});

test("the agent a same-agent automation was saved with is not offered once its repository is changed", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
  const following = automation(11, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });
  standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .luke-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => button("webacme").click());
  await settle();
  assert.equal(picked(page, "Agent"), "Choose an agent");
  act(() => picker(page, "Agent").click());

  assert.deepEqual(
    [...document.querySelectorAll("[role=option] .task-compose-menu-name")].map(
      (name) => name.textContent,
    ),
    ["CI digest"],
  );
});

test("Same agent is chosen from the workspace's agents on the automation's repository, and saved as its target", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Runs land in", "Same agent");
  await settle();
  assert.deepEqual(agentsAsked, [{ workspaceId: WORKSPACE.id, repository: "acme/ledger" }]);
  act(() => button("Save").click());
  await settle();
  assert.deepEqual(changes, [], "a same agent with none chosen is not saved");
  assert.match(page.textContent ?? "", /Choose the agent its runs go to\./u);

  pick(page, "Agent", "CI digest");
  assert.equal(picked(page, "Agent"), "CI digest");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: CI_DIGEST.id } },
    },
  ]);
});

/** What each glyph inside `within` draws, in order: GitHub's mark, or the lucide icon's name. */
function glyphs(within: Element | null, rows: string): string[] {
  return [...(within?.querySelectorAll(rows) ?? [])].map((row) => {
    if (row.querySelector(".provider-mark") !== null) return "github";
    const icon = row.querySelector(".state-glyph svg");
    const named = [...(icon?.classList ?? [])].find(
      (name) => name.startsWith("lucide-") && name !== "lucide-icon",
    );
    return named?.slice("lucide-".length) ?? "none";
  });
}

test("each run and each automation wears what fires it: a schedule's clock, GitHub's mark, a webhook's hook, or Run now's play", async () => {
  standing = [
    SWEEP,
    automation(7, {
      name: "Review pull requests",
      trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED },
    }),
    automation(8, {
      name: "Deploy hook",
      trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      webhookUrl: "https://tryluke.dev/api/automations/8/webhook",
    }),
  ];
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  assert.deepEqual(glyphs(list, ".automation-row"), ["clock", "github", "webhook"]);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const fired = (n: number, firing: AutomationRunSummary["firing"]): AutomationRunSummary => ({
    id: `1c2d3e4f-5a6b-4c7d-8e9f-${String(n).padStart(12, "0")}`,
    firing,
    status: AUTOMATION_RUN_STATUS.SKIPPED,
    reason: null,
    agent: null,
    firedAt: n,
    settledAt: n,
  });
  runs = [
    fired(4, { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 4 }),
    fired(3, {
      kind: AUTOMATION_TRIGGER.GITHUB,
      event: GITHUB_TRIGGER_EVENT.PULL_REQUEST_OPENED,
      repository: "acme/ledger",
      number: 12,
    }),
    fired(2, { kind: AUTOMATION_TRIGGER.WEBHOOK, bytes: 40 }),
    fired(1, { kind: "manual" }),
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.deepEqual(glyphs(page.querySelector("aside[aria-label='Runs']"), ".automation-run"), [
    "clock",
    "github",
    "webhook",
    "play",
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
    page.querySelector("aside[aria-label='Runs'] .empty-state")?.textContent ?? "",
    /^No runs yet$/u,
    "the panel with no run stands the empty state",
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
  assert.match(fresh.textContent ?? "", /No runs yet/u);
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

test("a GitHub automation's row says its trigger as one sentence, naming the repository it is heard in", async () => {
  standing = [
    automation(9, {
      name: "Code review",
      trigger: { kind: AUTOMATION_TRIGGER.GITHUB, event: "pull-request-updated" },
    }),
  ];
  const page = mount();
  await settle();

  assert.equal(
    rowOf(page, "Code review").querySelector(".automation-row-detail")?.textContent,
    "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
  );
});

test("a new automation set to a GitHub event takes its settings as switches in the Trigger card, is created on them, and the list's row says it too", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "GitHub event");
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
  );
  act(() => switchNamed("From Luke's agents").click());
  assert.equal(isOn("Skip drafts"), true);
  assert.equal(isOn("Include forks"), false);
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people or Luke's agents is opened, marked ready, or pushed to in acme/ledger",
  );
  type(page.querySelector("input[aria-label='Automation name']"), "Code review");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Review this pull request.");
  act(() => button("Create").click());
  await settle();

  assert.deepEqual(creates[0]?.trigger, {
    kind: AUTOMATION_TRIGGER.GITHUB,
    event: "pull-request-updated",
    senders: ["people", "luke-agents"],
    moments: ["opened", "ready", "pushed"],
    drafts: false,
    forks: false,
  });
  act(() => button("Automations").click());
  await settle();
  assert.equal(
    rowOf(page, "Code review").querySelector(".automation-row-detail")?.textContent,
    "When a pull request by people or Luke's agents is opened, marked ready, or pushed to in acme/ledger",
  );
});

test("a webhook made in the window shows its secret once, read-only with Copy, left out of the screen recording and the app state, and gone once Done is pressed", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create").click());
  await settle();

  const field = page.querySelector<HTMLInputElement>("input[aria-label='Secret']");
  assert.equal(field?.value, MADE_SECRET);
  assert.equal(field?.readOnly, true);
  assert.ok(field?.closest(".ph-no-capture"), "the secret is left out of the screen recording");
  assert.match(page.textContent ?? "", /You won't be able to see this again/u);
  assert.ok(!JSON.stringify(appStateNow() ?? {}).includes(MADE_SECRET), "no app state holds it");
  act(() => button("Copy secret").click());
  await settle();
  assert.deepEqual(copied, [MADE_SECRET]);

  act(() => button("Done").click());
  assert.equal(page.querySelector("input[aria-label='Secret']"), null);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET), "it is gone");
  assert.ok(button("New secret"), "a new secret is the only way to another");
});

test("a new secret shown after one was copied says nothing was copied of it yet", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create").click());
  await settle();
  act(() => button("Copy secret").click());
  await settle();
  assert.ok(button("Copied"), "the first secret's copy is said");

  act(() => button("Done").click());
  act(() => button("New secret").click());
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(".confirm-dialog button"),
    ].find((each) => each.textContent === "New secret");
    confirm?.click();
  });
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Secret']")?.value,
    ROTATED_SECRET,
  );
  assert.ok(button("Copy secret"), "the new secret is not said to be copied");
});

test("a shown secret is let go of once the automation is saved as anything but a webhook", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create").click());
  await settle();
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Secret']")?.value,
    MADE_SECRET,
  );

  pick(page, "Type", "Schedule");
  act(() => button("Save").click());
  await settle();
  pick(page, "Type", "Webhook");

  assert.equal(page.querySelector("input[aria-label='Secret']"), null);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET));
});

test("a new secret, asked for first, is shown once on the page that asked, and is gone once the page is left", async () => {
  const hooked = automation(8, {
    name: "Fix Sentry alerts",
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    webhookUrl: "https://tryluke.dev/api/automations/hooked/webhook",
  });
  standing = [hooked];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: hooked.id });
  await settle();

  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Webhook address']")?.value,
    hooked.webhookUrl,
  );
  assert.equal(
    page.querySelector("input[aria-label='Secret']"),
    null,
    "no secret is shown unasked",
  );
  act(() => button("Copy address").click());
  act(() => button("New secret").click());
  await settle();
  assert.deepEqual(secretsAsked, [], "nothing is replaced before the developer says so");
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(".confirm-dialog button"),
    ].find((each) => each.textContent === "New secret");
    assert.ok(confirm, "the dialog asks first");
    confirm.click();
  });
  await settle();

  assert.deepEqual(copied, [hooked.webhookUrl]);
  assert.deepEqual(secretsAsked, [hooked.id]);
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Secret']")?.value,
    ROTATED_SECRET,
  );
  assert.match(page.textContent ?? "", /Don't send secrets in the body/u);

  act(() => button("Automations").click());
  await settle();
  act(() =>
    rowOf(page, "Fix Sentry alerts")
      .querySelector<HTMLButtonElement>(".automation-row-open")
      ?.click(),
  );
  await settle();
  assert.equal(page.querySelector("input[aria-label='Secret']"), null, "never shown again");
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(ROTATED_SECRET));
});

test("a webhook not yet saved as one says it gets its address once it is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Type", "Webhook");

  assert.equal(page.querySelector("input[aria-label='Webhook address']"), null);
  assert.match(page.textContent ?? "", /Save it as a webhook to get its address/u);
  assert.equal(pickerDetail(page, "Type"), "When its webhook is called");
});

test("an automation's ⋯ in its editor, its row's right-click in the list, and the right-click of a run that started an agent each offer Copy link, copying its link under the listed workspace", async () => {
  runs = [
    {
      id: "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 1,
      settledAt: 1,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  act(() => button("Automation actions").click());
  await act(async () => menuItem("Copy link").click());
  const run = page.querySelector<HTMLElement>(".automation-run");
  assert.ok(run, "the run is listed");
  act(() => {
    run.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());
  act(() => button("Automations").click());
  await settle();
  act(() => {
    rowOf(page, SWEEP.name)
      .querySelector(".automation-row-open")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());

  const automationLink = `https://tryluke.dev/${WORKSPACE.id}/automation/${SWEEP.id}`;
  assert.deepEqual(copied.slice(-3), [
    automationLink,
    `${automationLink}/run/6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`,
    automationLink,
  ]);
});

test("a link to a run shows the Runs panel a reader folded, its run marked current, a fold after it stands, and the link opened again shows it again", async () => {
  window.localStorage.clear();
  runs = [
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
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  act(() => button("Hide runs").click());
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  });
  await settle();
  const current = page.querySelector(".automation-run")?.getAttribute("aria-current");
  act(() => button("Hide runs").click());
  const folded = page.querySelector("aside[aria-label='Runs']");
  act(() =>
    sendTo({
      kind: AUTOMATIONS_PAGE.EDIT,
      automationId: SWEEP.id,
      runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
    }),
  );

  assert.equal(current, "true");
  assert.equal(folded, null, "the fold after it stands");
  assert.ok(page.querySelector("aside[aria-label='Runs']"), "the same link opened again shows it");
  window.localStorage.clear();
});

test("a link to a run opens its automation's editor with that run marked current among its runs", async () => {
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
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  });
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".automation-run")].map((row) => row.getAttribute("aria-current")),
    [null, "true"],
  );
});

test("an automation whose task opens with no code review settings shows no Code review card", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.ok(!cards(page).includes("Code review"));
});

/** The suggestion named, under the list. */
function suggestion(page: HTMLElement, name: string): HTMLButtonElement {
  const found = [
    ...page.querySelectorAll<HTMLButtonElement>("[aria-label='Suggested'] .automation-suggestion"),
  ].find((each) => each.querySelector(".automation-suggestion-name")?.textContent === name);
  assert.ok(found, `no suggestion ${name}`);
  return found;
}

test("Code review is suggested under an empty list as under a full one, and a blank new automation offers no preset of its own", async () => {
  standing = [];
  const empty = mount();
  await settle();
  assert.match(empty.textContent ?? "", /No automations yet/u);
  assert.ok(suggestion(empty, "Code review"));
  act(() => root?.unmount());
  document.body.innerHTML = "";

  standing = [DIGEST, SWEEP, FAILING];
  const full = mount();
  await settle();
  assert.equal(rows(full).length, 3);
  assert.ok(suggestion(full, "Code review"));
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const blank = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.deepEqual(cards(blank).slice(0, 3), ["Sharing", "Trigger", "Prompt"]);
  assert.equal(
    blank.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "",
  );
});

test("a new automation started from the Code review suggestion is made on pull requests opened or updated, archiving its successful runs, at most five at once and fifty a day", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() => suggestion(page, "Code review").click());
  await settle();
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.NEW, preset: "code-review" });
  // Note that the page opens filled in, so a Create pressed straight away saves the review.
  // Note that the owner is chosen first, as Dean asked, then its trigger and its own settings.
  assert.deepEqual(cards(page).slice(0, 3), ["Sharing", "Trigger", "Code review"]);
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Code review",
  );
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people or Luke's agents is opened, marked ready, or pushed to in acme/ledger",
  );
  // Its own settings, Cursor Bugbot's kind, in a card of their own and written into the lines its task opens with.
  assert.ok(cards(page).includes("Code review"));
  act(() => switchNamed("Comment when no issues are found").click());
  pick(page, "Most findings", "3");
  type(page.querySelector("input[aria-label='Rules file']"), ".cursor/BUGBOT.md");
  act(() => button("Create").click());
  await settle();

  const made = creates[0];
  assert.ok(made, "the automation is made");
  assert.deepEqual(
    {
      name: made.name,
      trigger: made.trigger,
      archiveSuccessful: made.archiveSuccessful,
      guards: made.guards,
      target: made.target,
      repositories: made.repositories,
    },
    {
      name: "Code review",
      trigger: {
        kind: AUTOMATION_TRIGGER.GITHUB,
        event: "pull-request-updated",
        senders: ["people", "luke-agents"],
        moments: ["opened", "ready", "pushed"],
        drafts: false,
        forks: false,
      },
      archiveSuccessful: true,
      guards: { maxConcurrentRuns: 5, dailyRunCap: 50 },
      target: { kind: AUTOMATION_TARGET.NEW_AGENT },
      repositories: ["acme/ledger"],
    },
  );
  assert.match(made.action.prompt, /post what you find as one GitHub review/u);
  assert.ok(
    made.action.prompt.startsWith(
      [
        "Code review settings:",
        "- Comment when you find nothing: no",
        "- Most findings to post: 3",
        "- Rules file: .cursor/BUGBOT.md",
        "- Fix what you find: no",
      ].join("\n"),
    ),
    "the settings open the task the agent is handed",
  );
  assert.equal(made.action.choice, undefined, "it runs on the creator's own model");
});
