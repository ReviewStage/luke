// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentSummary, TasklessAgent } from "@repo/features/agent-wire";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationCreateParams,
} from "@repo/features/automation-view";
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
  type AutomationWorkspaceRun,
} from "@repo/features/automation-wire";
import { CHAPTERS_MODEL_DEFAULT } from "@repo/features/chapters-model-choice";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import {
  SENTRY_LEVEL,
  SENTRY_TRIGGER_EVENT,
  TRIGGER_PROVIDER,
} from "@repo/features/trigger-catalog";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { type AppWorkspaceIntegrations, NO_KEYS_HELD } from "@repo/host/app-state";
import type { Experiment } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { PROFILE } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { OpenFeedbackProvider } from "../open-feedback.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type LeaveAsk,
  useLeaveGuard,
} from "../tasks/use-tasks-tab.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  type HostReadsHanded,
  handHostReads,
  holdAutomations,
  holdIntegrations,
  stateWith,
} from "../testing/app-state.js";
import { layContainersAt, shown } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { longPress, underAFinger } from "../testing/finger.js";
import { restOn } from "../testing/hint-rest.js";
import { pixelsOf, wayBackGap } from "../testing/laid-length.js";
import { playMotions } from "../testing/pane-motion.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { ToastHost } from "../toast.js";
import { appStateNow } from "../use-app-state.js";
import { AutomationsPage } from "./automations-page.js";

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
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage today's issues." },
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
const DIGEST = automation(2, {
  name: "Morning digest",
  scope: AUTOMATION_SCOPE.PERSONAL,
  mine: true,
});
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

/** An agent on no task in the workspace, working in the automations' repository, as the task list carries it. */
function onLedger(agent: AgentSummary): TasklessAgent {
  return {
    ...agent,
    automationId: null,
    workspaceId: WORKSPACE.id,
    repository: "acme/ledger",
    activityAt: agent.createdAt,
  };
}

/** The task list as the host lays it: failed before it carried any agent where the test says so, else carrying the test's agents on no task. */
function tasksView(): TasksView {
  return agentListRefused
    ? { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.FAILED }
    : {
        ...IDLE_TASKS_VIEW,
        listStatus: TASKS_READ.READY,
        taskAgents: [],
        tasklessAgents: workspaceAgents,
      };
}

let root: Root | undefined;
/** The service's automations, as a read of the list answers them and a change changes them. */
let standing: AutomationSummary[] = [];
/** How many reads of the list are refused before one answers. */
let listRefusals = 0;

/** The host's holds on the page's lists and histories, as the test's host answers them. */
let host: ReturnType<typeof holdAutomations>;

/** Every workspace whose list was read, by a hold or a Try again, in order. */
function listed(): string[] {
  return host.asked
    .filter((each) => each.kind === AUTOMATION_FOLLOW.WORKSPACE)
    .map((each) => each.id);
}

/**
 * What stands laid again for every list and history a page held, as the
 * host lays a change, a write drawn on a list before it answers among them
 * (`@repo/host`'s `automation-collections.ts`).
 */
function layStanding(): void {
  host.lay();
}

/** Whether a read of the list is held unanswered, so only the writes' answers draw. */
let listHeld = false;
/** The changes held unanswered, each answered by its resolver, where changes are held at all. */
let heldChanges: (() => void)[] | undefined;
/** Every change asked, as the act carried it. */
let changes: unknown[] = [];
/** Every automation made, as the act carried it. */
let creates: AutomationCreateParams[] = [];
/** Every automation deleted, by its id. */
let deletes: string[] = [];
/** Every search of a workspace's agents, as the act carried it. */
let agentsAsked: unknown[] = [];
/** Every agent on no task the task list carries, as the host lays it. */
let workspaceAgents: readonly TasklessAgent[] = [];
/** The agents a search for `words` finds, as the service answers it. */
let agentsFound: (words: string) => readonly AgentSummary[] = () => [];
/** The service's runs of every automation, newest first, as a read of one's runs answers them. */
let runs: AutomationRunSummary[] = [];
/** Every run of the workspace's automations, as its Runs tab's read holds them. */
let workspaceRuns: AutomationWorkspaceRun[] = [];
/** Every Run now asked, by the automation it runs. */
let runsAsked: string[] = [];
/** Whether a read of an automation's runs is held unanswered, as one still out on the wire. */
let runsHeld = false;
/** Whether a Run now is held unanswered, as one still out on the wire. */
let runHeld = false;
/** What a Run now answers where it does not start a run. */
let runRefusal: (typeof AUTOMATION_CALL_FAILURE)[keyof typeof AUTOMATION_CALL_FAILURE] | undefined;
/** Every agent whose page a run opened. */
let agentsOpened: string[] = [];
/** Whether the account's default model reads, or answers that it could not. */
let defaultRefused = false;
/** How many times the model catalog was asked again. */
let catalogReads = 0;
/** Whether the model catalog answers that it could not be read. */
let catalogRefused = false;
/** Whether the catalog marks every model as one no credential of the reader's pays for. */
let catalogUnconnected = false;
/** Whether the task list failed before it carried the workspace's agents. */
let agentListRefused = false;
/** Lays the task list on the window again, as the host does once it reads it. */
let deliverTasks: (next: TasksView) => void = () => undefined;
/** Lays the models on the window again, as the host does once it asks them again. */
let deliverModels: HostReadsHanded["deliverModels"] = () => undefined;

/** The models as the host holds them: failed while refused, and the catalog otherwise, every model unpaid where the test says so. */
const modelsHeld = () =>
  catalogRefused
    ? { failed: true as const }
    : {
        rows: {
          models: CATALOG.map((model) =>
            catalogUnconnected ? { ...model, credentialMissing: true } : model,
          ),
        },
      };

/** Lays the models and the account's row as the host holds them for the page about to draw: the row failed while the default is refused. */
function holdChoices(): void {
  deliverModels = handHostReads({
    models: modelsHeld(),
    preferences: defaultRefused
      ? { failed: true }
      : {
          rows: {
            agent: DEFAULT_CHOICE,
            chaptersModel: CHAPTERS_MODEL_DEFAULT,
            slackNotifications: true,
          },
        },
  }).deliverModels;
}
/** Whether a search among the workspace's agents answers that it could not be made. */
let agentSearchRefused = false;
/** Whether the account's tasks were about no repository lately, so a new automation starts with none. */
let noRecent = false;
/** Whether the read of the account's integrations is held unanswered, as one still out on the wire. */
let integrationsHeld = false;
/** How many reads of the account's integrations are refused before one answers. */
let integrationsRefusals = 0;
/** The workspace's Sentry as its read answers it: the deployment holds the integration, installed once, unless a test says otherwise. */
let sentryRead: WorkspaceSentry = {
  configured: true,
  installations: [{ installationId: "a1b2c3d4-0000-4000-8000-000000000001" }],
};
/** How many of the host's reads of a workspace's integrations fail before one answers. */
let sentryRefusals = 0;
/** The workspaces whose integrations the host follows, laid once as the first hold of each is taken. */
let integrationsFollowed = new Set<string>();
/** Each workspace's integrations the host holds for the window, as last laid. */
let workspaceIntegrations: AppWorkspaceIntegrations = NO_KEYS_HELD;
/** Lays each workspace's integrations on the window's document, as the host does once the editor holds them. */
let deliverIntegrations: HostReadsHanded["deliverIntegrations"] = () => undefined;

/** Lays a workspace's integrations as the host's read of them now stands: failed while refused, its Sentry as `sentryRead` says and no Slack bot otherwise. */
function layIntegrations(workspaceId: string): void {
  const read =
    sentryRefusals > 0
      ? { failed: true as const }
      : { rows: { sentry: sentryRead, slack: { configured: true, channelRepositories: {} } } };
  if (sentryRefusals > 0) sentryRefusals -= 1;
  workspaceIntegrations = { ...workspaceIntegrations, [workspaceId]: read };
  deliverIntegrations(workspaceIntegrations);
}
/** Every workspace a Sentry install was asked for. */
let sentryInstalls: string[] = [];
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
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  feedbackAbout = [];
  standing = [DIGEST, SWEEP, FAILING];
  listRefusals = 0;
  listHeld = false;
  heldChanges = undefined;
  changes = [];
  creates = [];
  deletes = [];
  agentsAsked = [];
  workspaceAgents = [onLedger(CI_DIGEST)];
  agentsFound = () => [];
  runs = [];
  workspaceRuns = [];
  runsAsked = [];
  runsHeld = false;
  runHeld = false;
  runRefusal = undefined;
  agentsOpened = [];
  boardOpens = [];
  defaultRefused = false;
  catalogReads = 0;
  catalogRefused = false;
  catalogUnconnected = false;
  agentListRefused = false;
  agentSearchRefused = false;
  changeRefusal = undefined;
  noRecent = false;
  integrationsHeld = false;
  integrationsRefusals = 0;
  sentryRead = {
    configured: true,
    installations: [{ installationId: "a1b2c3d4-0000-4000-8000-000000000001" }],
  };
  sentryInstalls = [];
  sentryRefusals = 0;
  integrationsFollowed = new Set();
  workspaceIntegrations = NO_KEYS_HELD;
  fakeActs({
    // Note that the task list is laid as the page is first drawn, so a test's agents stand once it mounts.
    requestAppState: () => Promise.resolve(stateWith({}, { tasks: tasksView() })),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AUTOMATIONS_CHANGE) {
        changes.push(request.payload);
        const { automationId, change } = request.payload;
        const was = standing.find((each) => each.id === automationId);
        if (changeRefusal !== undefined || was === undefined) {
          const failure = changeRefusal ?? AUTOMATION_CALL_FAILURE.NOT_FOUND;
          return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { failure } });
        }
        const automation = { ...was, ...change };
        standing = standing.map((each) => (each.id === automationId ? automation : each));
        layStanding();
        const done = { status: FAKE_ANSWER.DONE, value: { automation } } as const;
        if (heldChanges === undefined) return Promise.resolve(done);
        const held = heldChanges;
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
            ? { webhookUrl: "https://vespin.dev/api/automations/made/webhook" }
            : undefined),
        });
        // A webhook's secret is answered once, by the write that minted it.
        const value = hooked
          ? { automation: made, webhookSecret: MADE_SECRET }
          : { automation: made };
        standing = [made, ...standing];
        layStanding();
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_RUN) {
        runsAsked.push(request.payload.automationId);
        if (runHeld) return new Promise(() => undefined);
        if (runRefusal !== undefined) {
          return Promise.resolve({
            status: FAKE_ANSWER.DONE,
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
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { run: made } });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_NEW_WEBHOOK_SECRET) {
        secretsAsked.push(request.payload.automationId);
        const automation = standing.find((each) => each.id === request.payload.automationId);
        const value =
          automation === undefined
            ? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND }
            : { automation, webhookSecret: ROTATED_SECRET };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      // Note that the host follows a workspace's integrations once however many surfaces hold them, and lays what it read once the hold is taken.
      if (request.kind === ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW) {
        const { workspaceId } = request.payload;
        if (!integrationsFollowed.has(workspaceId)) {
          integrationsFollowed.add(workspaceId);
          void Promise.resolve().then(() => layIntegrations(workspaceId));
        }
        return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
      }
      if (request.kind === ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY) {
        layIntegrations(request.payload.workspaceId);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.WORKSPACE_SENTRY_INSTALL) {
        sentryInstalls.push(request.payload.workspaceId);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_DELETE) {
        deletes.push(request.payload.automationId);
        standing = standing.filter((each) => each.id !== request.payload.automationId);
        layStanding();
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { deleted: true } });
      }
      if (request.kind === ACT_KIND.AGENTS_MODELS_RETRY) {
        catalogReads += 1;
        deliverModels(modelsHeld());
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.AGENTS_WORKSPACE_LIST) {
        agentsAsked.push(request.payload);
        if (agentSearchRefused) {
          return Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: AUTOMATION_CALL_FAILURE.UNANSWERED },
          });
        }
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { agents: agentsFound(request.payload.words ?? "") },
        });
      }
      if (request.kind === ACT_KIND.TASKS_REFRESH) {
        agentListRefused = false;
        deliverTasks(tasksView());
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  // Note that each list and history a page holds is laid on its document as the host lays it.
  const reads = handHostReads({});
  deliverIntegrations = reads.deliverIntegrations;
  deliverTasks = reads.deliverTasks;
  host = holdAutomations(reads.deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: (workspaceId) => {
      if (listHeld) return undefined;
      if (listRefusals > 0) {
        listRefusals -= 1;
        return { failed: true };
      }
      return { rows: standing.filter((each) => each.workspaceId === workspaceId) };
    },
    [AUTOMATION_FOLLOW.WORKSPACE_RUNS]: () => ({ rows: workspaceRuns }),
    [AUTOMATION_FOLLOW.RUNS]: () => (runsHeld ? undefined : { rows: runs }),
  });
  // Note that the account's integrations are laid as the host holds them: none while held, failed while refused, and Linear and Sentry connected otherwise.
  holdIntegrations(() => {
    if (integrationsHeld) return undefined;
    if (integrationsRefusals > 0) {
      integrationsRefusals -= 1;
      return { failed: true };
    }
    const integrations = Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [
        provider,
        provider === INTEGRATION_PROVIDER.LINEAR || provider === INTEGRATION_PROVIDER.SENTRY
          ? INTEGRATION_STATUS.CONNECTED
          : INTEGRATION_STATUS.DISCONNECTED,
      ]),
    );
    // SAFETY: every provider on the list is given a status above, which is the whole of the record.
    return {
      rows: { integrations: integrations as Record<IntegrationProvider, IntegrationStatus> },
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** The registry every render of one mount shares, so a render again is the same window. */
let registry = AtomRegistry.make();

/** The page as drawn over the tasks control given, rendered again in place where one stands. */
function render(tasks: ReturnType<typeof tasksControl>): void {
  act(() =>
    root?.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          createElement(AutomationsPage, { tasks, room: SHELL_ROOM.WIDE }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
}

/** The Automations page, standing in the task's place over the workspace listed. */
function mount(tasks = tasksControl({ workspace: WORKSPACE })): HTMLElement {
  holdChoices();
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

/** The automations' rows, top to bottom. */
function automationRows(page: HTMLElement): Element[] {
  return [...page.querySelectorAll(".automation-group li")];
}

/** The runs' rows in the Runs panel, newest first. */
function runRows(page: HTMLElement | Element | null | undefined): Element[] {
  const panel = page?.matches("aside[aria-label='Runs']")
    ? page
    : page?.querySelector("aside[aria-label='Runs']");
  return [...(panel?.querySelectorAll("li") ?? [])];
}

/** Each row's name and owner, top to bottom. */
function rows(page: HTMLElement): string[][] {
  return automationRows(page).map((row) => [
    row.querySelector(".automation-row-name")?.textContent ?? "",
    row.querySelector(".automation-owner-name")?.textContent ?? "",
  ]);
}

/** Whether a row says `words` among its own. */
function says(row: Element, words: string): boolean {
  return (row.textContent ?? "").includes(words);
}

/** The row of the automation named. */
function rowOf(page: HTMLElement, name: string): Element {
  const row = automationRows(page).find(
    (each) => each.querySelector(".automation-row-name")?.textContent === name,
  );
  assert.ok(row, `no row for ${name}`);
  return row;
}

test("the listed workspace's automations stand before the personal ones, under a heading each, every row naming its owner", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(listed(), [WORKSPACE.id]);
  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme", "Only you"],
  );
  assert.deepEqual(rows(page), [
    ["Nightly flaky-test sweep", "Acme"],
    ["Dependency bumps", "Acme"],
    ["Morning digest", "Only you"],
  ]);
});

test("one owner's automations alone stand under no heading, still naming their owner", async () => {
  standing = [DIGEST];
  const page = mount();
  await settle();

  assert.equal(page.querySelectorAll(".automation-group h2").length, 0);
  assert.deepEqual(rows(page), [["Morning digest", "Only you"]]);
});

test("an automation turned off reads Off where its next run would, and a failed newest run is marked at its row's end", async () => {
  standing = [{ ...SWEEP, enabled: false }, FAILING];
  const page = mount();
  await settle();

  const off = rowOf(page, "Nightly flaky-test sweep");
  assert.equal(off.querySelector(".automation-row-when")?.textContent, "Off");
  assert.equal(off.querySelector(".failed-mark") === null, true);
  assert.ok(rowOf(page, "Dependency bumps").querySelector(".failed-mark"));
});

test("an automation an event fires says nothing where a next run would be, and a failed newest run is still marked", async () => {
  standing = [
    automation(8, {
      name: "Check each deploy",
      trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      lastRun: FAILING.lastRun,
    }),
  ];
  const page = mount();
  await settle();

  const row = rowOf(page, "Check each deploy");
  assert.equal(row.querySelector(".automation-row-when") === null, true);
  assert.doesNotMatch(row.textContent ?? "", /Not scheduled/u);
  assert.ok(row.querySelector(".failed-mark"));
});

test("an automation's row leads with its clock tile, wearing its newest run's state, and hangs its card", async () => {
  standing = [FAILING];
  const page = mount();
  await settle();

  const row = rowOf(page, "Dependency bumps");
  assert.ok(row.querySelector('.actor-mark[data-kind="automation"]'), "the clock tile leads");
  assert.equal(
    row.querySelector(".automation-row-glyph") === null,
    true,
    "no trigger glyph on a tile",
  );
  restOn(row.querySelector<HTMLElement>("button") ?? assert.fail("no press"));
  const card = document.querySelector('.ui-tooltip-card [data-actor-card="automation"]');
  assert.match(card?.textContent ?? "", /Dependency bumps/u);
  assert.match(card?.textContent ?? "", /Last ran/u);
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

test("what changed elsewhere is drawn as the host lays it, and a switch reads nothing again", async () => {
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
  assert.deepEqual(listed(), [WORKSPACE.id], "the switch reads the list no more");
  layStanding();
  await settle();

  assert.deepEqual(rows(page), [
    ["Nightly flaky-test sweep", "Acme"],
    ["Dependency bumps, weekly", "Acme"],
    ["Morning digest", "Only you"],
  ]);
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
  listRefusals = 1;
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /The automations could not be read\./u);
  const retry = [...page.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  act(() => retry?.click());
  await settle();

  assert.deepEqual(listed(), [WORKSPACE.id, WORKSPACE.id]);
  assert.deepEqual(rows(page), [["Morning digest", "Only you"]]);
});

test("with no automations the page says what one is, and with no workspace listed it asks for none", async () => {
  standing = [];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /No automations yet\./u);
  act(() => root?.unmount());
  root = undefined;

  mount(tasksControl({ workspace: undefined }));
  await settle();
  assert.deepEqual(listed(), [WORKSPACE.id], "no list is read with no workspace listed");
});

/** The window's bar over `page`, its parts in the order they stand, each by its text. */
function bar(page: HTMLElement): { banner: HTMLElement; parts: Element[] } {
  const banner = page.querySelector<HTMLElement>("header") ?? assert.fail("no bar");
  return { banner, parts: [...banner.children] };
}

test("the list's title is its bar's heading, and Create with an agent and New automation end the bar", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  const { banner, parts } = bar(page);
  assert.equal(banner.querySelectorAll("h1").length, 1);
  assert.equal(parts.length, 2, "a heading and the acts, with no box of the page's own between");
  const [heading, actions] = parts;
  assert.equal(heading?.querySelector("h1")?.textContent, "Automations");
  assert.deepEqual(
    [...(actions?.querySelectorAll("button") ?? [])].map(
      (each) => each.getAttribute("aria-label") ?? each.textContent,
    ),
    ["Create with an agent", "New automation"],
  );
});

test("with no workspace chosen the bar's two acts stay reachable by keyboard, press nothing, and say why on hover", async () => {
  const agentOpens: number[] = [];
  mount(tasksControl({ workspace: undefined, onNewAutomationAgent: () => agentOpens.push(1) }));
  await settle();

  for (const name of ["Create with an agent", "New automation"]) {
    const bar_ = button(name);
    assert.equal(bar_.getAttribute("aria-disabled"), "true", name);
    assert.equal(bar_.disabled, false, `${name} stays focusable`);
    assert.match(pillOver(bar_) ?? "", /Choose a workspace first/u, name);
    act(() => bar_.click());
  }
  assert.deepEqual(agentOpens, []);
});

test("New automation, in the bar, opens a new automation's page", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() => button("New automation").click());
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.NEW });
});

test("while the list is first read it stands as quiet rows under its toolbar, said to a reader as being read", async () => {
  listHeld = true;
  const page = mount();
  await settle();

  const wait = page.querySelector("[role=status][aria-busy=true]");
  assert.equal(wait?.textContent, "Reading your automations…");
  assert.ok((wait?.querySelectorAll(".ui-skeleton").length ?? 0) > 0);
  const { parts } = bar(page);
  assert.equal(parts[0]?.querySelector("h1")?.textContent, "Automations");
  assert.ok(parts[1]?.querySelector("button"), "its acts stand at the bar's end");
});

test("with no workspace listed the list and a linked automation stand as quiet blocks, never as empty or gone", async () => {
  // Note that the tasks are read apart from the workspaces, so a listed task list says nothing of them.
  const page = mount(tasksControl({ workspace: undefined, listRead: true, listFailed: false }));
  await settle();
  assert.equal(
    page.querySelector("[role=status][aria-busy=true]")?.textContent,
    "Reading your automations…",
  );
  assert.doesNotMatch(page.textContent ?? "", /No automations yet\./u);

  act(() => root?.unmount());
  root = undefined;
  mount(
    tasksControl({
      workspace: undefined,
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id },
        onOpen: () => undefined,
        onClose: () => undefined,
      },
    }),
  );
  await settle();
  const linked = document.body;
  assert.equal(
    linked
      .querySelector("[role=status][aria-busy=true]")
      ?.textContent?.startsWith("Reading the automation…"),
    true,
  );
  assert.doesNotMatch(linked.textContent ?? "", /Not found/u);
  assert.deepEqual(listed(), [], "no workspace's list is asked for");
});

/** The workspace the account made first, its personal one, where everything is its own. */
const PERSONAL: Workspace = { ...WORKSPACE, id: "workspace-personal", name: "Ada" };

/** Each time the Board was opened past the page, as the sidebar's Tasks row opens it. */
let boardOpens: number[] = [];

/** Opens the Board as the sidebar's Tasks row would, through the window's guarded door. */
let openBoard: () => void = () => undefined;

/** Every page the Automations pages stood on, in order, as the window moved them. */
let places: AutomationsPlace[] = [];

/** The ask the window's guard last told the shell of, as a browser tab's ways out hear it; nothing while no page holds unsaved work. */
let shellAsk: LeaveAsk | undefined;

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
  holdChoices();
  places = [start];
  shellAsk = undefined;
  function Pages() {
    const [place, setPlace] = useState(start);
    sendTo = setPlace;
    const [listed, setListed] = useState(workspace);
    moveTo = setListed;
    // The window's own guard, over doors guarded as the Plans tab guards its own.
    const leaveGuard = useLeaveGuard((ask) => {
      shellAsk = ask;
    });
    const tasks = tasksControl({
      leaveGuard,
      agentView: {
        agentId: undefined,
        onOpen: leaveGuard.guard((agentId: string) => agentsOpened.push(agentId)),
        onClose: () => undefined,
      },
      boardView: {
        open: false,
        onOpen: leaveGuard.guard(() => boardOpens.push(1)),
        onClose: () => undefined,
        onPreload: () => undefined,
      },
      workspace: listed,
      workspaces: [PERSONAL, WORKSPACE],
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place,
        onOpen: leaveGuard.guard((next: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST }) => {
          places.push(next);
          setPlace(next);
        }),
        onClose: () => undefined,
      },
    });
    const base = tasks.newTask;
    openBoard = tasks.boardView.onOpen;
    return createElement(AutomationsPage, {
      tasks: {
        ...tasks,
        newTask: {
          ...base,
          repositoriesIn: () => ({
            ...base.repositoriesIn(listed.id),
            scope: listed.id,
            recent: noRecent
              ? []
              : listed.id === WORKSPACE.id
                ? ["acme/ledger", "acme/web"]
                : ["beta/app"],
          }),
        },
      },
      room: SHELL_ROOM.WIDE,
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
/** What a reader names `control` by: the elements its `aria-labelledby` lists, itself among them, in order. */
function nameOf(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-labelledby") ?? "").split(" ");
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

/** The servers chip, found as a reader names it: by its hidden field name, then its own face. */
function serversChip(root: ParentNode = document): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button[aria-labelledby]")].find((each) => {
    const [fieldName] = (each.getAttribute("aria-labelledby") ?? "").split(" ");
    return (
      fieldName !== undefined && document.getElementById(fieldName)?.textContent === "Integrations"
    );
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `no button ${name}`);
  return found;
}

/** The value a copy field shows beside its "Copy {what}", or nothing where none stands. */
function copyFieldValue(page: HTMLElement, what: string): HTMLElement | undefined {
  let at: Element | null | undefined = [...page.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === `Copy ${what}`,
  );
  while (at && at !== page) {
    const value = at.querySelector<HTMLElement>("code");
    if (value !== null) return value;
    at = at.parentElement;
  }
  return undefined;
}

/** Stands a phone's automation's runs, from its head's ⋯, where its Runs now stands. */
function phoneRuns(): void {
  act(() => button("Automation actions").click());
  act(() => menuItem("Runs").click());
}

/** Whether a copy button shows its copy landed, its glyph turned to the check, once the clipboard took it. */
function copiedShown(copyButton: HTMLButtonElement): boolean {
  return copyButton.querySelector(".ui-copy-glyph")?.getAttribute("data-state") === "copied";
}

/** The option of the list standing open whose words are `words`. */
function optionWords(words: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
    (each) => each.textContent === words,
  );
  assert.ok(found, `no option ${words}`);
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

/** Whether `words` stand in an error line, which the window's announcer says as they arrive. */
function announced(words: string): boolean {
  return [...document.querySelectorAll("[data-slot=field-error]")].some(
    (region) => region.textContent === words,
  );
}

/** What describes the picker named, each part on its own: its row's why, then its row's error. */
function pickerDescription(page: HTMLElement, label: string): (string | undefined)[] {
  const ids = picker(page, label).getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? undefined);
}

/** Picks an option as a developer would: the picker's chip, then the menu's row of that name. */
function pick(page: HTMLElement, label: string, option: string): void {
  act(() => picker(page, label).click());
  const row = [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find(
    (each) => each.querySelector(".ui-combobox-option-label")?.textContent === option,
  );
  assert.ok(row, `no ${option} in ${label}`);
  act(() => row.click());
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

/** The toolbar's crumbs' words, in order. */
function crumbs(page: HTMLElement): string {
  return page.querySelector(".automation-toolbar nav")?.textContent ?? "";
}

/** The page's headings: an automation's page has one, its name, written in its title. */
function headings(page: HTMLElement): string[] {
  return [...page.querySelectorAll("h1")].map(
    (each) => each.querySelector("input")?.value ?? each.textContent?.trim() ?? "",
  );
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

test("under a finger, an automation's row draws its switch and no ⋯, and held opens its menu", async () => {
  underAFinger();
  const page = mount();
  await settle();

  const row = rowOf(page, SWEEP.name);
  assert.ok(
    row.querySelector('button[aria-label="Automation actions"]') === null,
    "the row draws no ⋯",
  );
  assert.ok(row.querySelector(`[aria-label="Turn off ${SWEEP.name}"]`), "the row keeps its switch");
  longPress(
    row.querySelector<HTMLElement>("button.ui-list-row-main") ?? assert.fail("the row is a press"),
  );
  assert.ok(menuItem("Delete"), "held, it offers its menu");
});

test("a row opens its automation's page, headed by its name, with a crumb back to the list, and what it was saved as", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  act(() =>
    rowOf(page, "Nightly flaky-test sweep").querySelector<HTMLButtonElement>("button")?.click(),
  );
  await settle();

  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  assert.deepEqual(headings(page), [SWEEP.name], "the page has one h1, the automation's name");
  assert.equal(
    page.querySelectorAll("input[aria-label='Automation name']").length,
    1,
    "the name is written once, in the title",
  );
  assert.ok(page.querySelector("h1 input[aria-label='Automation name']"), "the title is the field");
  assert.ok(
    page.querySelector('h1 .actor-mark[data-kind="automation"]'),
    "the clock tile stands before the name",
  );
  assert.equal(crumbs(page), "Automations", "the toolbar leads with the way back, not the name");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Saved");
  act(() => button("Automations").click());
  assert.deepEqual(
    places.at(-1),
    { kind: AUTOMATIONS_PAGE.LIST },
    "its crumb goes back to the list",
  );
});

test("a new automation is created only once it is named and told its task, and then stands as its own page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.deepEqual(headings(page), [""]);
  assert.equal(
    page.querySelector<HTMLInputElement>("h1 input[aria-label='Automation name']")?.placeholder,
    "New automation",
    "a page not yet made stands as New automation until it is named",
  );
  assert.equal(crumbs(page), "Automations");

  act(() => button("Create automation").click());
  await settle();
  assert.deepEqual(creates, []);
  assert.match(page.textContent ?? "", /Name the automation\./u);
  assert.match(page.textContent ?? "", /Tell the agent what to do\./u);
  assert.equal(
    page.querySelector("textarea[aria-label='Prompt']")?.getAttribute("aria-invalid"),
    "true",
    "the prompt is marked as what stops the save",
  );

  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage the issues opened overnight.");
  act(() => button("Create automation").click());
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
    action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the issues opened overnight." },
    scope: AUTOMATION_SCOPE.PERSONAL,
    target: { kind: AUTOMATION_TARGET.NEW_AGENT },
    archiveSuccessful: false,
    slackDelivery: false,
    repositories: ["acme/ledger"],
  });
  assert.equal(places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.deepEqual(headings(page), ["Morning triage"]);
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
    page.querySelector("[role='alert']")?.textContent,
    "Only its creator, or the workspace's owners and admins, can change it.",
  );
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
    "Sweep",
  );
  assert.equal(page.querySelector(".automation-editor-status")?.textContent, "Unsaved changes");
});

test("a switch the service refuses in the editor toasts, as the list's does, and leaves the page's alert and its Save unmarked", async () => {
  changeRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => page.querySelector<HTMLButtonElement>("[role=switch]")?.click());
  await settle();

  assert.equal(page.querySelector("[role='alert']") === null, true);
  assert.match(
    document.body.textContent ?? "",
    /Only its creator, or the workspace's owners and admins, can change it\./u,
  );
  assert.equal(page.querySelector("[role=switch]")?.getAttribute("aria-checked"), "true");
});

test("a deletion asks first, then goes back to the list without the automation", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Automation actions").click());
  act(() => menuItem("Delete").click());
  await settle();
  assert.deepEqual(deletes, []);
  act(() => dialogButton("Delete automation").click());
  await settle();

  assert.deepEqual(deletes, [SWEEP.id]);
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST, deleted: SWEEP.id });
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
});

test("a row's Delete asks first, and once confirmed the row leaves the list and the history passes over its page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);

  act(() => (row.querySelector('button[aria-label="Automation actions"]') as HTMLElement).click());
  await settle();
  act(() => menuItem("Delete").click());
  await settle();

  assert.deepEqual(deletes, []);
  assert.ok(rows(page).some(([name]) => name === SWEEP.name));
  assert.match(
    document.querySelector("[role=dialog], [role=alertdialog]")?.textContent ?? "",
    new RegExp(`Delete ${SWEEP.name}\\?`, "u"),
  );

  act(() => dialogButton("Delete automation").click());
  await settle();

  assert.deepEqual(deletes, [SWEEP.id]);
  assert.ok(!rows(page).some(([name]) => name === SWEEP.name));
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST, deleted: SWEEP.id });
});

test("a row's Delete withdrawn deletes nothing and leaves the row standing", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);

  act(() => (row.querySelector('button[aria-label="Automation actions"]') as HTMLElement).click());
  await settle();
  act(() => menuItem("Delete").click());
  await settle();
  act(() => dialogButton("Cancel").click());
  await settle();

  assert.deepEqual(deletes, []);
  assert.ok(rows(page).some(([name]) => name === SWEEP.name));
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
  assert.match(leaveAsked() ?? "", /Your changes to this automation are lost\./u);
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

  act(() => openBoard());
  assert.deepEqual(boardOpens, [], "the sidebar's row waits on the question too");
  act(() => button("Leave").click());
  await settle();
  assert.deepEqual(boardOpens, [1]);
});

test("the shell hears the page's ask only while an edit is unsaved, and asking through it waits on the page's question", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(shellAsk, undefined, "a page with nothing unsaved holds nothing back");

  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the two flakiest tests.");
  const left: string[] = [];
  act(() => shellAsk?.(() => left.push("sign-in")));
  assert.ok(leaveAsked(), "the shell's way out asks the page's question");
  assert.deepEqual(left, []);
  act(() => button("Leave").click());
  await settle();
  assert.deepEqual(left, ["sign-in"]);

  act(() => button("Save").click());
  await settle();
  assert.equal(shellAsk, undefined, "once saved, the shell holds nothing back");
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
  act(() => button("Create automation").click());
  await settle();
  assert.equal(places.at(-1)?.kind, AUTOMATIONS_PAGE.EDIT);
  assert.equal(leaveAsked(), undefined);
});

test("the Owner row stands in a shared workspace, and not in the account's personal one", async () => {
  const shared = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.equal(picked(shared, "Owner"), "Only you");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const personal = mountPages({ kind: AUTOMATIONS_PAGE.NEW }, PERSONAL);
  await settle();
  assert.equal(personal.querySelector("button[aria-label^='Owner: ']") === null, true);
});

/** The groups of the editor's form, by their titles, top to bottom. */
function formGroups(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".automation-form section[aria-labelledby] h2")].map(
    (title) => title.textContent ?? "",
  );
}

test("who owns an automation is the editor's first setting, and nowhere else on its page", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.equal(formGroups(page)[0], "Sharing");
  assert.equal(picked(page, "Owner"), "Acme");
  assert.equal(page.querySelector(".automation-editor .automation-owner") === null, true);
  assert.equal(page.querySelector("h1 .automation-owner") === null, true);
});

test("another's personal automation's Owner picker draws its owner unnamed, never as the reader", async () => {
  standing = [{ ...DIGEST, mine: false }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id });
  await settle();

  assert.equal(
    picker(page, "Owner").querySelector(".actor-mark")?.getAttribute("data-kind"),
    "someone",
  );
});

test("a personal automation another member made is not called Only you, in its row, its heading, or its Owner picker", async () => {
  const theirs = { ...DIGEST, name: "Their digest", mine: false };
  standing = [SWEEP, theirs];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme", "Personal"],
  );
  assert.deepEqual(rows(page).at(-1), ["Their digest", "Personal"]);
  act(() => root?.unmount());

  const editor = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: theirs.id });
  await settle();
  assert.equal(picked(editor, "Owner"), "Personal");
});

test("a new agent's Integrations are a field chip of the owner's connected ones until switched off, the row naming those off, and a switch saves with the task", async () => {
  standing = [{ ...SWEEP, mine: true }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const chip = serversChip() ?? assert.fail("the servers chip stands");
  assert.match(page.textContent ?? "", /Every connected integration is on\./u);
  assert.equal(chip.querySelectorAll(".ui-provider-mark").length, 2, "Linear's and Sentry's marks");

  act(() => chip.click());
  await settle();
  const sentry = document.querySelector<HTMLButtonElement>(
    "[role=switch][aria-label='Sentry for this agent']",
  );
  assert.ok(sentry, "the agent box's own switches stand");
  act(() => sentry.click());
  assert.match(page.textContent ?? "", /Sentry off\./u);
  assert.equal(chip.querySelectorAll(".ui-provider-mark").length, 1, "Linear's mark alone");
  assert.equal(nameOf(chip), "Integrations", "marks draw no words, so the field's name stands");
  const linear = document.querySelector<HTMLButtonElement>(
    "[role=switch][aria-label='Linear for this agent']",
  );
  assert.ok(linear, "Linear's switch stands");
  act(() => linear.click());
  assert.equal(nameOf(chip), "Integrations None", "the name carries the word the chip draws");
  act(() => linear.click());
  assert.equal(nameOf(chip), "Integrations");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: { action: { ...SWEEP.action, disabledServers: [INTEGRATION_PROVIDER.SENTRY] } },
  });
});

test("a new agent's Integrations row claims nothing while the owner's connections are read", async () => {
  standing = [{ ...SWEEP, mine: true }];
  integrationsHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const reading = [...page.querySelectorAll("[role=status]")].map((each) => each.textContent);
  assert.ok(reading.includes("Reading your connected integrations…"), "the row says it is reading");
  assert.doesNotMatch(page.textContent ?? "", /None connected yet\.|Every connected integration/u);
  assert.equal(serversChip(page) === undefined, true, "no chip claims None while the read is out");
});

test("a new agent's Integrations row says a refused read of the owner's connections, and Retry reads them", async () => {
  standing = [{ ...SWEEP, mine: true }];
  integrationsRefusals = 1;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const alert = page.querySelector("[role=alert]");
  assert.match(alert?.textContent ?? "", /Your connected integrations could not be read\./u);
  assert.doesNotMatch(page.textContent ?? "", /None connected yet\./u);

  act(() => button("Retry").click());
  await settle();
  assert.match(page.textContent ?? "", /Every connected integration is on\./u);
  assert.equal(
    (serversChip() ?? assert.fail("the servers chip stands")).querySelectorAll(".ui-provider-mark")
      .length,
    2,
  );
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
    /Its creator's connected integrations, but Sentry and Notion \(account 2\) switched off\./u,
  );
  assert.equal(serversChip(page) === undefined, true);
});

test("the Runs panel hides and shows by its toggle and by the side panel's chord, and stays as it was left", async () => {
  window.localStorage.clear();
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.ok(page.querySelector("aside[aria-label='Runs']"), "it stands at first");

  act(() => button("Hide runs").click());
  assert.equal(page.querySelector("aside[aria-label='Runs']") === null, true);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const again = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.equal(
    again.querySelector("aside[aria-label='Runs']") === null,
    true,
    "folded as it was left",
  );
  act(() => runAppCommand(APP_COMMAND.TOGGLE_SIDE_PANEL));
  assert.ok(again.querySelector("aside[aria-label='Runs']"), "⌥⌘B brings it back");
  window.localStorage.clear();
});

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
    assert.equal(pane() === null, true, "it is let go once its slide has played");

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

/** The pill the pointer resting on `element` raises, or nothing where it raises none. */
function pillOver(element: Element): string | undefined {
  restOn(element);
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  return pill;
}

test("an automation's toolbar too narrow for its acts' words beside its name folds the way back and Run now to their glyphs, each raising its words in its pill", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const toolbar = page.querySelector(".automation-toolbar") ?? assert.fail("no toolbar");
  const acts = () =>
    ["Automations", "Run now"].map((name) => {
      const press =
        [...toolbar.querySelectorAll("button")].find((each) => each.textContent === name) ??
        assert.fail(`no ${name}`);
      return { name, pill: pillOver(press) };
    });

  // A 760 window's toolbar, past the traffic lights.
  const narrow = layContainersAt({ "automation-toolbar": 570 });
  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", pill: "Automations" },
      { name: "Run now", pill: "Run now" },
    ]);
  } finally {
    narrow.remove();
  }
  const wide = layContainersAt({ "automation-toolbar": 1100 });
  try {
    act(() => relayout());
    assert.deepEqual(acts(), [
      { name: "Automations", pill: undefined },
      { name: "Run now", pill: undefined },
    ]);
  } finally {
    wide.remove();
  }
});

test("a Run now still out is named by what it is doing and refuses another press", async () => {
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  runHeld = true;
  const run = button("Run now");
  act(() => run.click());
  await settle();
  act(() => run.click());
  await settle();

  assert.deepEqual(
    { name: run.getAttribute("aria-label"), busy: run.getAttribute("aria-busy"), runsAsked },
    { name: "Starting", busy: "true", runsAsked: [SWEEP.id] },
  );
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

test("a page naming an automation the list does not hold keeps its bar, its way back to the list standing in it", async () => {
  const page = mountPages({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "3f0e6f5c-7d1a-4f6e-9a55-999999999999",
  });
  await settle();

  const { banner } = bar(page);
  assert.equal(banner.parentElement?.getAttribute("aria-label"), "Not found");
  const back = [...banner.querySelectorAll("button")].find(
    (each) => each.textContent === "Automations",
  );
  act(() => back?.click());
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("an automation's page opened before the list is read stands its toolbar's way back over its form as quiet blocks", async () => {
  listHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const wait = page.querySelector("[role=status][aria-busy=true]");
  assert.equal(wait?.textContent?.startsWith("Reading the automation…"), true);
  assert.ok((wait?.querySelectorAll(".ui-settings-row .ui-skeleton").length ?? 0) > 0);
  assert.match(crumbs(page), /^Automations/u);
  act(() => button("Automations").click());
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
});

test("Escape leaves an automation's page still waiting on the list for the list", async () => {
  listHeld = true;
  mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_AUTOMATIONS), "its way out is offered");
  });
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.LIST });
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

test("with no workspace listed because the workspaces could not be read, the list and a linked automation say so, and Retry reads them again", async () => {
  let retries = 0;
  const unread = (place: AutomationsPlace) =>
    tasksControl({
      workspace: undefined,
      workspacesFailed: true,
      onRetryWorkspaces: () => {
        retries += 1;
      },
      automationsView: { ...tasksControl().automationsView, open: true, place },
    });
  const page = mount(unread({ kind: AUTOMATIONS_PAGE.LIST }));
  await settle();
  assert.match(page.textContent ?? "", /The workspaces could not be read\./u);
  assert.equal(page.querySelector("[role=status][aria-busy=true]") === null, true);
  act(() => button("Retry").click());
  assert.equal(retries, 1);

  // The read Retry asked for lands, listing the workspace, whose automations are then read.
  render(tasksControl({ workspace: WORKSPACE }));
  await settle();
  assert.deepEqual(listed(), [WORKSPACE.id]);
  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
  assert.ok(rows(page).length > 0, "the workspace's automations are drawn");

  act(() => root?.unmount());
  root = undefined;
  const linked = mount(unread({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id }));
  await settle();
  assert.match(linked.textContent ?? "", /The workspaces could not be read\./u);
  assert.doesNotMatch(linked.textContent ?? "", /Reading the automation/u);
  act(() => button("Retry").click());
  assert.equal(retries, 2);
});

test("an automation's page whose list could not be read says so with Retry, rather than calling it gone", async () => {
  listRefusals = 1;
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
  act(() => button("Create automation").click());
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
    "When an issue by people is opened in acme/ledger labeled bug",
  );
  assert.equal(picked(page, "Event"), "Issue opened");
  assert.equal(page.querySelector("button[aria-label^='Time zone: ']") === null, true);
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

/** A new automation's page, named and given its prompt, ready to have its schedule picked. */
async function mountNewScheduled(): Promise<HTMLElement> {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Weekly sweep");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Update the dependencies.");
  return page;
}

test("a schedule repeated weekly is saved on Monday at nine, as its day and time are first drawn", async () => {
  const page = await mountNewScheduled();
  pick(page, "Repeats", "Weekly");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(creates.at(-1)?.trigger, {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: "0 9 * * 1",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

/** The Nightly sweep's page, standing on a schedule of Wednesdays at 07:30 Tokyo time. */
async function mountWeeklySweep(): Promise<HTMLElement> {
  standing = [
    {
      ...SWEEP,
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "30 7 * * 3", timezone: "Asia/Tokyo" },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  return page;
}

test("a weekly schedule's day picked is saved, with its time and zone as they stood", async () => {
  const page = await mountWeeklySweep();
  pick(page, "Day", "Monday");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "30 7 * * 1", timezone: "Asia/Tokyo" },
    },
  });
});

test("a schedule's time is written as its summary says it, and a time that cannot be read is marked and changes nothing", async () => {
  const page = await mountWeeklySweep();
  const field = () =>
    page.querySelector<HTMLInputElement>("input[aria-label='Time']") ?? assert.fail("no time");
  assert.equal(field().value, "7:30 AM");
  assert.match(page.textContent ?? "", /Wednesdays? at 7:30 AM/u);

  assert.equal(button("Save").disabled, true, "nothing is written yet");
  type(field(), "soon");
  assert.equal(button("Save").disabled, false, "words that are no time are unsaved work");

  // Note that "2" reads as 2:00 AM and moves the schedule before the colon after it makes the words unreadable.
  type(field(), "2");
  type(field(), "2:");
  assert.equal(field().getAttribute("aria-invalid"), "true");
  const saves = changes.length;
  act(() => button("Save").click());
  await settle();
  assert.equal(changes.length, saves, "no save runs over a time that cannot be read");
  assert.match(page.textContent ?? "", /Write the time as 2:00 AM\./u);
  type(field(), "6:45 PM");
  assert.equal(field().getAttribute("aria-invalid"), null);
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "45 18 * * 3", timezone: "Asia/Tokyo" },
    },
  });
});

test("a weekly schedule's time typed is saved, with its day and zone as they stood", async () => {
  const page = await mountWeeklySweep();
  type(page.querySelector("input[aria-label='Time']"), "18:45");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "45 18 * * 3", timezone: "Asia/Tokyo" },
    },
  });
});

test("a schedule's time zone is saved as searched for and picked", async () => {
  const page = await mountNewScheduled();
  act(() => picker(page, "Time zone").click());
  type(document.querySelector("input[placeholder='Search time zones']"), "Tokyo");
  act(() => {
    [...document.querySelectorAll<HTMLButtonElement>("[role=option]")]
      .find((each) => each.textContent?.includes("Asia/Tokyo"))
      ?.click();
  });
  assert.equal(picked(page, "Time zone"), "Asia/Tokyo");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(creates.at(-1)?.trigger, {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: "0 9 * * 1-5",
    timezone: "Asia/Tokyo",
  });
});

test("a custom cron is saved as written, in the zone the schedule already had", async () => {
  const page = await mountWeeklySweep();
  pick(page, "Repeats", "Custom");
  type(page.querySelector("input[aria-label='Cron']"), "15 2 * * 1-5");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes.at(-1), {
    automationId: SWEEP.id,
    change: {
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "15 2 * * 1-5", timezone: "Asia/Tokyo" },
    },
  });
});

test("Escape while writing the prompt lets go of the caret and reaches the window marked taken, composing or not", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  const prompt =
    page.querySelector<HTMLTextAreaElement>("textarea[aria-label='Prompt']") ??
    assert.fail("no prompt");
  type(prompt, "Triage the issues opened overnight.");
  act(() => prompt.focus());

  const reached: boolean[] = [];
  const listen = (event: KeyboardEvent) => reached.push(event.defaultPrevented);
  window.addEventListener("keydown", listen);
  const pressEscape = (init: KeyboardEventInit) =>
    act(() => {
      prompt.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }),
      );
    });

  pressEscape({ isComposing: true });
  assert.equal(
    document.activeElement === prompt,
    true,
    "the input method's cancel keeps the caret",
  );
  pressEscape({});
  window.removeEventListener("keydown", listen);

  // Note that both reach the window, whose live call Escape stops first, marked taken, so neither leaves the page.
  assert.deepEqual(reached, [true, true]);
  assert.equal(document.activeElement === prompt, false);
  assert.equal(prompt.value, "Triage the issues opened overnight.");
});

test("a new automation with no repository is created to work in none, but not on a GitHub event, whose refusal describes the repository chip", async () => {
  noRecent = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Morning triage");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Triage the issues opened overnight.");
  pick(page, "Type", "GitHub event");
  act(() => button("Create automation").click());
  await settle();

  const refusal = "Choose the repository whose events start it.";
  assert.equal(creates.length, 0, "nothing on a GitHub event is created without a repository");
  assert.ok(announced(refusal), "the refusal is announced");
  const chip =
    page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip") ??
    assert.fail("no repository chip");
  const ids = chip.getAttribute("aria-describedby")?.split(" ") ?? [];
  assert.ok(
    ids.some((id) => document.getElementById(id)?.textContent === refusal),
    "the refusal describes the chip it is about",
  );
  assert.equal(chip.getAttribute("aria-invalid"), "true");

  pick(page, "Type", "Schedule");
  act(() => button("Create automation").click());
  await settle();
  assert.deepEqual(creates[0]?.repositories, [], "a schedule is created to work in no repository");
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

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => optionWords("webacme").click());
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /also work in/u);
});

test("runs land in a new agent on the account's default until a model is chosen, and archiving successful runs is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  assert.match(page.textContent ?? "", /Your default, until you choose one\./u);
  act(() => button("Archive finished runs").click());
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

  act(() => page.querySelector<HTMLButtonElement>(".repository-chip .ui-chip")?.click());
  await settle();
  // The repository's row names it, then its owner after it.
  act(() => optionWords("webacme").click());
  await settle();
  assert.equal(picked(page, "Agent"), "Started by its first run");
  act(() => picker(page, "Agent").click());

  assert.deepEqual(
    [...document.querySelectorAll("[role=option] .ui-combobox-option-label")].map(
      (name) => name.textContent,
    ),
    ["Started by its first run"],
  );
});

test("Same agent saves with none chosen, its first run starting one, or with one chosen from the workspace's agents on the automation's repository", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Runs land in", "Same agent");
  await settle();
  assert.ok(
    pickerDescription(page, "Agent").some((words) =>
      words?.includes("Every later run is sent to it"),
    ),
    "the Agent picker says later runs go to the first run's agent",
  );
  act(() => button("Save").click());
  await settle();

  pick(page, "Agent", "CI digest");
  assert.equal(picked(page, "Agent"), "CI digest");
  act(() => button("Save").click());
  await settle();
  // A picked agent is let go again, for the next run to start one.
  pick(page, "Agent", "Started by its first run");
  assert.equal(picked(page, "Agent"), "Started by its first run");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null } },
    },
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: CI_DIGEST.id } },
    },
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: null } },
    },
  ]);
});

/** Whether the picker named wears a glyph before its name, a chip's chevron not being one. */
function chipWearsGlyph(page: HTMLElement, label: string): boolean {
  return picker(page, label).querySelector(".ui-chip-name")?.previousElementSibling != null;
}

/** The Agent picker's rows, each as its glyph, its name, and its detail beside it, and the marks at its end. */
function agentRows(): {
  glyph: boolean;
  name: string | null;
  detail: string | null;
  ends: (string | null)[];
}[] {
  return [...document.querySelectorAll("[role=option]")].map((option) => ({
    glyph:
      option.querySelector(".ui-combobox-option-glyph svg, .ui-combobox-option-glyph img") !== null,
    name: option.querySelector(".ui-combobox-option-label")?.textContent ?? null,
    detail: option.querySelector(".ui-combobox-option-detail")?.textContent ?? null,
    // Note that the hint's marks stand inside the replay mark its menu draws them under, so a mark is a child of that mark, or of the hint where none stands.
    ends: [...(option.querySelector(".ui-combobox-option-hint")?.children ?? [])]
      .flatMap((mark) =>
        mark.matches("[data-replay-mask], [data-replay-unmask]") ? [...mark.children] : [mark],
      )
      .map((mark) => mark.getAttribute("aria-label")),
  }));
}

test("the Agent picker draws each agent as every agent menu does: its glyph, its name, its task, and the failed mark where its turn failed, the chip wearing the chosen agent's glyph and name", async () => {
  const BROKEN = {
    ...CI_DIGEST,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b22",
    title: "Nightly sweep",
    status: "failed",
  } as const;
  workspaceAgents = [onLedger(BROKEN), onLedger(CI_DIGEST)];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  assert.equal(picked(page, "Agent"), "Started by its first run");
  assert.equal(
    chipWearsGlyph(page, "Agent"),
    false,
    "no agent is chosen, so the chip wears no glyph",
  );

  act(() => picker(page, "Agent").click());
  assert.deepEqual(agentRows(), [
    { glyph: false, name: "Started by its first run", detail: null, ends: [] },
    { glyph: true, name: "Nightly sweep", detail: "No task", ends: ["Failed"] },
    { glyph: true, name: "CI digest", detail: "No task", ends: [] },
  ]);

  const row = [...document.querySelectorAll<HTMLElement>("[role=option]")][2];
  assert.ok(row, "the menu lists the second agent");
  act(() => row.click());
  assert.equal(picked(page, "Agent"), "CI digest");
  assert.equal(chipWearsGlyph(page, "Agent"), true, "the chip wears the chosen agent's glyph");
});

test("the Agent picker offers the workspace's unarchived agents on the automation's repository, newest first, its case aside", async () => {
  const named = (id: string, title: string, createdAt: number) =>
    onLedger({ ...CI_DIGEST, id: `8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3c${id}`, title, createdAt });
  workspaceAgents = [
    named("01", "Ledger cleanup", 2),
    { ...named("02", "Shouting ledger", 3), repository: "Acme/Ledger" },
    { ...named("03", "Archived digest", 4), archivedAt: 5 },
    { ...named("04", "Web checks", 4), repository: "acme/web" },
    { ...named("05", "Another workspace's", 4), workspaceId: "workspace-other" },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  assert.deepEqual(
    agentRows().map((row) => row.name),
    ["Started by its first run", "Shouting ledger", "Ledger cleanup"],
  );
});

test("the Agent picker's rows each hang their agent's card while the pointer rests on them", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  // The first row chooses none, so the agent's is the second.
  restOn(document.querySelectorAll("[role=option]")[1] ?? assert.fail("the menu lists the agent"));
  const card = document.querySelector(".ui-tooltip-card") ?? assert.fail("the row hangs a card");
  assert.equal(card.querySelector(".ui-hover-card-name")?.textContent, "CI digest");
});

test("a word typed in the Agent picker asks the service for the repository's agents it names, so one past the newest is found, chosen, kept named, and saved", async () => {
  const OLDER = {
    ...CI_DIGEST,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b23",
    title: "Seat limits",
  } as const;
  agentsFound = (words) => (words === "seat" ? [OLDER] : []);
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    "seat",
  );
  await vi.waitFor(() =>
    assert.deepEqual(
      agentRows().map((row) => row.name),
      ["Seat limits"],
    ),
  );
  assert.deepEqual(agentsAsked.at(-1), {
    workspaceId: WORKSPACE.id,
    repository: "acme/ledger",
    words: "seat",
  });

  act(() => (document.querySelector<HTMLElement>("[role=option]") ?? assert.fail("found")).click());
  await settle();
  assert.equal(picked(page, "Agent"), "Seat limits");
  act(() => button("Save").click());
  await settle();
  assert.deepEqual(changes, [
    {
      automationId: SWEEP.id,
      change: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: OLDER.id } },
    },
  ]);
});

test("a word typed in the Agent picker keeps the newest agents whose rows hold it, so one named by its model stays where the service matches no model", async () => {
  const UNTITLED = { ...CI_DIGEST, title: null, createdAt: 2 } as const;
  workspaceAgents = [
    onLedger(UNTITLED),
    onLedger({ ...CI_DIGEST, id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b27" }),
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());
  const [, named] = agentRows();
  assert.ok(named?.name, "the untitled agent is drawn under a name of its own");

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    named.name.toLowerCase(),
  );
  await settle();

  assert.deepEqual(
    agentRows().map((row) => row.name),
    [named.name],
  );
});

test("the agent a same-agent automation was saved with, once the list no longer holds it, is left out of a search's results and offered again once the search is cleared", async () => {
  const gone = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8f";
  const following = automation(11, {
    name: "Follow-up digest",
    target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: gone },
  });
  standing = [following];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: following.id });
  await settle();
  act(() => picker(page, "Agent").click());
  const names = () => agentRows().map((row) => row.name);
  assert.deepEqual(names(), ["Started by its first run", "The agent it goes to now", "CI digest"]);

  const search = () =>
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input');
  type(search(), "ci");
  await settle();
  assert.deepEqual(names(), ["CI digest"]);
  type(search(), "");
  await settle();

  assert.deepEqual(names(), ["Started by its first run", "The agent it goes to now", "CI digest"]);
});

/** What each row's glyph draws, in order: Sentry's or GitHub's mark, or the lucide icon's name. */
function glyphs(rows: readonly Element[]): string[] {
  return rows.map((row) => {
    if (row.querySelector(".integration-mark-sentry") !== null) return "sentry";
    if (row.querySelector(".ui-provider-mark") !== null) return "github";
    const icon = row.querySelector(".state-glyph svg");
    const named = [...(icon?.classList ?? [])].find(
      (name) => name.startsWith("lucide-") && name !== "lucide-icon",
    );
    return named?.slice("lucide-".length) ?? "none";
  });
}

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

  const [started, refused] = runRows(page);
  assert.match(started?.textContent ?? "", /^Fix the flaky testJan 1, 1970Working/u);
  assert.match(
    refused?.textContent ?? "",
    /^Scheduled runJan 1, 1970Its creator is no longer in the workspace\./u,
  );
  act(() => started?.querySelector("button")?.click());
  assert.deepEqual(agentsOpened, [CI_DIGEST.id]);
  const unstarted = refused?.querySelector<HTMLButtonElement>(".ui-list-row-main");
  assert.equal(unstarted?.tagName, "BUTTON", "a run that started no agent is a press too");
  act(() => unstarted?.click());
  assert.ok(
    document.activeElement?.querySelector("input[aria-label='Automation name']"),
    "it opens the automation's setup beside it, handing it the keyboard",
  );
});

test("the Runs tab lists every automation's runs, each naming its automation, narrowed to the running or the failed", async () => {
  standing = [SWEEP, DIGEST];
  workspaceRuns = [
    {
      id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 3 },
      status: AUTOMATION_RUN_STATUS.STARTED,
      reason: null,
      agent: { id: CI_DIGEST.id, title: "Fix the flaky test", status: "running" },
      firedAt: 3,
      settledAt: 3,
      automation: { id: SWEEP.id, name: SWEEP.name },
    },
    {
      id: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
      firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: "creator-left",
      agent: null,
      firedAt: 2,
      settledAt: 2,
      automation: { id: DIGEST.id, name: DIGEST.name },
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const choiceOf = (words: string) =>
    [...page.querySelectorAll<HTMLElement>("[role=radio]")].find(
      (each) => each.querySelector(".ui-choice-bar-label")?.textContent === words,
    );
  const choose = (words: string) => {
    const found = choiceOf(words);
    assert.ok(found, `no choice ${words}`);
    act(() => found.click());
  };
  choose("Runs");
  await settle();
  const listedRuns = () =>
    [...page.querySelectorAll("ul[aria-label='Runs'] li")].map((row) => row.textContent ?? "");

  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.RUNS });
  assert.equal(listedRuns().length, 2);
  assert.deepEqual(
    ["Runs", "All", "Running", "Failed"].map((words) => choiceOf(words)?.textContent),
    ["Runs1", "All", "Running1", "Failed1"],
    "the Runs tab counts what runs, and Running and Failed what each keeps",
  );
  assert.match(
    listedRuns()[0] ?? "",
    /^Fix the flaky testJan 1, 1970Nightly flaky-test sweep · Working/u,
  );
  assert.match(listedRuns()[1] ?? "", /^Scheduled runJan 1, 1970Morning digest · /u);
  choose("Failed");
  assert.deepEqual(
    listedRuns().map((row) => row.startsWith("Scheduled run")),
    [true],
  );
  choose("Running");
  assert.deepEqual(
    listedRuns().map((row) => row.startsWith("Fix the flaky test")),
    [true],
  );
  act(() => page.querySelector<HTMLButtonElement>("ul[aria-label='Runs'] li button")?.click());
  assert.deepEqual(agentsOpened, [CI_DIGEST.id]);
});

test("on the Runs tab a run that started no agent and names no subject opens its automation", async () => {
  standing = [SWEEP, DIGEST];
  workspaceRuns = [{ ...UNSTARTED_RUN, automation: { id: DIGEST.id, name: DIGEST.name } }];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.RUNS });
  await settle();

  act(() => page.querySelector<HTMLElement>("ul[aria-label='Runs'] .ui-list-row-main")?.click());
  assert.deepEqual(places.at(-1), { kind: AUTOMATIONS_PAGE.EDIT, automationId: DIGEST.id });
});

test("under a finger no run draws a ⋯, and a long press opens its menu", async () => {
  underAFinger();
  standing = [SWEEP, DIGEST];
  workspaceRuns = [
    { ...SWEEP_RUN, automation: { id: SWEEP.id, name: SWEEP.name } },
    { ...UNSTARTED_RUN, automation: { id: DIGEST.id, name: DIGEST.name } },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.RUNS });
  await settle();
  const presses = [
    ...page.querySelectorAll<HTMLElement>("ul[aria-label='Runs'] .ui-list-row-main"),
  ];

  assert.equal(presses.length, 2);
  assert.ok(page.querySelector("button[aria-label='Run actions']") === null, "no run draws a ⋯");
  const [, unstarted] = presses;
  assert.ok(unstarted);
  longPress(unstarted);
  assert.ok(menuItem("Copy link"), "the long press opens the run's menu");
});

test("an automation's runs stand as quiet rows under the panel's heading while they are first read", async () => {
  runsHeld = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  const wait = page.querySelector("aside[aria-label='Runs'] [role=status]");
  assert.equal(wait?.textContent, "Reading its runs…");
  assert.ok((wait?.querySelectorAll(".ui-list-row .ui-skeleton").length ?? 0) > 0);
});

test("Run now starts a run under a key of its own, and the run stands first once it is laid", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  assert.match(
    page.querySelector("aside[aria-label='Runs'] .ui-empty-state")?.textContent ?? "",
    /^No runs yet\.$/u,
    "the panel with no run stands the empty state",
  );

  act(() => button("Run now").click());
  await settle();
  layStanding();
  await settle();

  assert.deepEqual(runsAsked, [SWEEP.id]);
  assert.match(runRows(page)[0]?.textContent ?? "", /^Run now/u);
});

test("a Run now the service refuses says why under the name, and a new automation has no Run now", async () => {
  runRefusal = AUTOMATION_CALL_FAILURE.NOT_PERMITTED;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  act(() => button("Run now").click());
  await settle();
  assert.equal(
    page.querySelector("[role='alert']")?.textContent,
    "Only its creator, or the workspace's owners and admins, can run it.",
  );
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const fresh = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  assert.ok(![...fresh.querySelectorAll("button")].some((each) => each.textContent === "Run now"));
  assert.match(fresh.textContent ?? "", /No runs yet\./u);
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

/** A run that started no agent and names no subject, so has nothing of its own to open. */
const UNSTARTED_RUN = {
  id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60",
  firing: { kind: AUTOMATION_TRIGGER.SCHEDULE, dueAt: 2 },
  status: AUTOMATION_RUN_STATUS.FAILED,
  reason: "creator-left",
  agent: null,
  firedAt: 2,
  settledAt: 2,
} as const;

test("opening a run's agent with unsaved changes asks first, and Leave opens it", async () => {
  runs = [SWEEP_RUN];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  type(page.querySelector("input[aria-label='Automation name']"), "Sweep");

  act(() => runRows(page)[0]?.querySelector("button")?.click());
  await settle();
  assert.deepEqual(agentsOpened, []);
  act(() => button("Leave").click());
  await settle();

  assert.deepEqual(agentsOpened, [CI_DIGEST.id]);
});

test("a default model that could not be read is said as unknown, and a model can still be chosen", async () => {
  defaultRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  // Note that the default reads as failed once the preferences' failure reaches their query.
  await vi.waitFor(() =>
    assert.match(
      page.textContent ?? "",
      /It runs on your default model, which could not be read\./u,
    ),
  );
  assert.equal(
    page.querySelector(".agent-model-chip") === null,
    true,
    "no model is drawn as the default",
  );
  // Note that the menu is hung from the chip by its laid-out boxes, which jsdom draws none of.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("automation-model-picker"))
      return DOMRect.fromRect({ x: 200, y: 400, width: 120, height: 24 });
    if (this.classList.contains("ui-anchored-popover"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 300 });
    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  const readsBefore = catalogReads;
  act(() => button("Choose a model").click());
  await settle();

  assert.ok(page.querySelector(".ui-searchable-menu"), "the model menu opens");
  assert.equal(
    catalogReads,
    readsBefore,
    "opening it draws the catalog the host holds, asking nothing",
  );
  assert.equal(
    page.querySelector(".automation-editor-status")?.textContent,
    "Saved",
    "opening the menu chooses nothing",
  );
});

test("the reader's own automation says a model nothing of theirs pays for cannot run, while a teammate's, run on its maker's connections, says nothing of it", async () => {
  catalogUnconnected = true;
  standing = [DIGEST, SWEEP];
  /** The pinned rows of the Model row's menu and its last line, on the automation given. */
  const footOn = async (automationId: string): Promise<string> => {
    const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId });
    await settle();
    const chip = page.querySelector<HTMLButtonElement>(".agent-model-chip button");
    assert.ok(chip, "the Model row draws the default's chip");
    act(() => chip.click());
    await settle();
    return [...page.querySelectorAll(".ui-searchable-menu-foot, .ui-searchable-menu-last-line")]
      .map((block) => block.textContent ?? "")
      .join("");
  };

  assert.match(await footOn(DIGEST.id), /Opus 5\.5 cannot run until you connect a Claude plan/u);
  const teammates = await footOn(SWEEP.id);
  assert.match(teammates, /Effort/u, "the menu is open on its pinned rows");
  assert.doesNotMatch(teammates, /cannot run|Connect/u);
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

  assert.ok(
    says(
      rowOf(page, "Code review"),
      "When a pull request by people is opened, marked ready, or pushed to in acme/ledger",
    ),
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
  act(() => switchNamed("From Vespin's agents").click());
  assert.equal(isOn("Skip drafts"), true);
  assert.equal(isOn("Include forks"), false);
  assert.equal(
    pickerDetail(page, "Type"),
    "When a pull request by people or Vespin's agents is opened, marked ready, or pushed to in acme/ledger",
  );
  type(page.querySelector("input[aria-label='Automation name']"), "Code review");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Review this pull request.");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(creates[0]?.trigger, {
    kind: AUTOMATION_TRIGGER.GITHUB,
    event: "pull-request-updated",
    senders: ["people", "app-agents"],
    moments: ["opened", "ready", "pushed"],
    drafts: false,
    forks: false,
  });
  act(() => button("Automations").click());
  await settle();
  assert.ok(
    says(
      rowOf(page, "Code review"),
      "When a pull request by people or Vespin's agents is opened, marked ready, or pushed to in acme/ledger",
    ),
  );
});

test("a schedule Vespin cannot read is not created, and the refusal is announced under its row", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  type(page.querySelector("input[aria-label='Automation name']"), "Nightly sweep");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Sweep the stale branches.");
  pick(page, "Repeats", "Custom");
  type(page.querySelector("input[aria-label='Cron']"), "every night");
  act(() => button("Create automation").click());
  await settle();

  assert.deepEqual(creates, []);
  assert.ok(announced("That isn't a schedule Vespin can read."), "the refusal is announced");
  assert.ok(
    !pickerDescription(page, "Type").includes("That isn't a schedule Vespin can read."),
    "the refusal stands under the cron's row, not the trigger's",
  );
  const cron = page.querySelector("input[aria-label='Cron']");
  const describedBy = cron?.getAttribute("aria-describedby")?.split(" ") ?? [];
  assert.ok(
    describedBy.some(
      (id) => document.getElementById(id)?.textContent === "That isn't a schedule Vespin can read.",
    ),
    "the refusal describes the Cron field it is about",
  );
  assert.equal(cron?.getAttribute("aria-invalid"), "true", "the Cron field says it is wrong");

  type(page.querySelector("input[aria-label='Cron']"), "0 2 * * *");
  await settle();
  assert.ok(!announced("That isn't a schedule Vespin can read."), "the refusal is gone");
  assert.equal(
    page.querySelector("input[aria-label='Cron']")?.getAttribute("aria-invalid"),
    null,
    "the Cron field no longer says it is wrong",
  );
});

test("a webhook made in the window shows its secret once, with Copy, left out of the screen recording and the app state, and gone once Done is pressed", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();

  const field = copyFieldValue(page, "secret");
  assert.equal(field?.textContent, MADE_SECRET);
  assert.ok(field?.closest(".ph-no-capture"), "the secret is left out of the screen recording");
  assert.match(page.textContent ?? "", /You won't be able to see this again/u);
  assert.ok(!JSON.stringify(appStateNow() ?? {}).includes(MADE_SECRET), "no app state holds it");
  act(() => button("Copy secret").click());
  await settle();
  assert.deepEqual(copied, [MADE_SECRET]);
  assert.ok(copiedShown(button("Copy secret")));

  act(() => button("Done").click());
  assert.equal(copyFieldValue(page, "secret"), undefined);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET), "it is gone");
  assert.ok(button("New secret"), "a new secret is the only way to another");
});

test("a new secret shown after one was copied says nothing was copied of it yet", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();
  act(() => button("Copy secret").click());
  await settle();
  assert.ok(copiedShown(button("Copy secret")), "the first secret's copy is shown");

  act(() => button("Done").click());
  act(() => button("New secret").click());
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((each) => each.textContent === "Make secret");
    confirm?.click();
  });
  await settle();

  assert.equal(copyFieldValue(page, "secret")?.textContent, ROTATED_SECRET);
  assert.ok(!copiedShown(button("Copy secret")), "the new secret is not shown as copied");
});

test("a shown secret is let go of once the automation is saved as anything but a webhook", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  pick(page, "Type", "Webhook");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix Sentry alerts");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the error the alert names.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(copyFieldValue(page, "secret")?.textContent, MADE_SECRET);

  pick(page, "Type", "Schedule");
  act(() => button("Save").click());
  await settle();
  pick(page, "Type", "Webhook");

  assert.equal(copyFieldValue(page, "secret"), undefined);
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(MADE_SECRET));
});

test("a new secret, asked for first, is shown once on the page that asked, and is gone once the page is left", async () => {
  const hooked = automation(8, {
    name: "Fix Sentry alerts",
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    webhookUrl: "https://vespin.dev/api/automations/hooked/webhook",
  });
  standing = [hooked];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: hooked.id });
  await settle();

  assert.equal(copyFieldValue(page, "address")?.textContent, hooked.webhookUrl);
  assert.equal(copyFieldValue(page, "secret"), undefined, "no secret is shown unasked");
  act(() => button("Copy address").click());
  await settle();
  assert.deepEqual(copied, [hooked.webhookUrl]);
  assert.ok(copiedShown(button("Copy address")));
  act(() => button("New secret").click());
  await settle();
  assert.deepEqual(secretsAsked, [], "nothing is replaced before the developer says so");
  act(() => {
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((each) => each.textContent === "Make secret");
    assert.ok(confirm, "the dialog asks first");
    confirm.click();
  });
  await settle();

  assert.deepEqual(copied, [hooked.webhookUrl]);
  assert.deepEqual(secretsAsked, [hooked.id]);
  assert.equal(copyFieldValue(page, "secret")?.textContent, ROTATED_SECRET);
  assert.match(page.textContent ?? "", /Don't send secrets in the body/u);

  act(() => button("Automations").click());
  await settle();
  act(() => rowOf(page, "Fix Sentry alerts").querySelector<HTMLButtonElement>("button")?.click());
  await settle();
  assert.equal(copyFieldValue(page, "secret"), undefined, "never shown again");
  assert.ok(!(page.ownerDocument.body.innerHTML ?? "").includes(ROTATED_SECRET));
});

test("a webhook not yet saved as one says it gets its address once it is saved", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();

  pick(page, "Type", "Webhook");

  assert.equal(copyFieldValue(page, "address"), undefined);
  assert.match(page.textContent ?? "", /Save it as a webhook to get its address/u);
  assert.equal(pickerDetail(page, "Type"), "When its webhook is called");
});

test("an automation's ⋯ in its editor, its row's right-click in the list, and the right-click of a run each offer Copy link, copying its link under the listed workspace, a run that started no agent included", async () => {
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
    {
      id: "7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: null,
      agent: null,
      firedAt: 0,
      settledAt: 0,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  act(() => button("Automation actions").click());
  await act(async () => menuItem("Copy link").click());
  const run = runRows(page)[0]?.querySelector("button");
  assert.ok(run, "the run is listed");
  act(() => {
    run.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());
  const unstarted = runRows(page)[1];
  assert.ok(unstarted, "the run that started no agent is listed");
  act(() => {
    unstarted.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());
  act(() => button("Automations").click());
  await settle();
  act(() => {
    rowOf(page, SWEEP.name)
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());

  const automationLink = `https://vespin.dev/${WORKSPACE.id}/automation/${SWEEP.id}`;
  assert.deepEqual(copied.slice(-4), [
    automationLink,
    `${automationLink}/run/6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d`,
    `${automationLink}/run/7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e`,
    automationLink,
  ]);
});

test("a right-click on an automation's switch opens no menu, and Escape from its row's menu hands focus back to the row", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const openMenus = () => document.querySelectorAll('[role="menu"]:not([data-leaving])').length;
  const row = rowOf(page, SWEEP.name);

  act(() => {
    button(`Turn off ${SWEEP.name}`).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  assert.equal(openMenus(), 0, "the switch's right-click is its own");

  const press = row.querySelector("button");
  assert.ok(press, "the row is a press");
  act(() =>
    press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  assert.equal(openMenus(), 1);
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await settle();
  assert.equal(document.activeElement === press, true);
});

test("an automation row's ⋯, its right-click and the menu key open the same menu, whose Copy link copies its link and whose Run now runs it", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const row = rowOf(page, SWEEP.name);
  const press = row.querySelector("button") ?? assert.fail("the row is a press");
  const openMenus = () => document.querySelectorAll('[role="menu"]:not([data-leaving])');
  const items = () => [...(openMenus()[0]?.querySelectorAll('[role="menuitem"]') ?? [])];
  const closeMenu = async () => {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await settle();
  };
  const doors = [
    () =>
      act(() =>
        (row.querySelector('button[aria-label="Automation actions"]') as HTMLElement).click(),
      ),
    () =>
      act(() => {
        press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      }),
    () =>
      act(() => {
        press.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
        );
      }),
  ];

  for (const open of doors) {
    open();
    await settle();
    assert.equal(openMenus().length, 1);
    assert.equal(openMenus()[0]?.getAttribute("aria-label"), "Automation actions");
    assert.deepEqual(
      items().map((item) => item.textContent),
      ["Copy link", "Run now", "Delete"],
    );
    await closeMenu();
  }
  doors[2]?.();
  await settle();
  await act(async () => menuItem("Copy link").click());
  assert.equal(copied.at(-1), `https://vespin.dev/${WORKSPACE.id}/automation/${SWEEP.id}`);
  doors[0]?.();
  await settle();
  await act(async () => menuItem("Run now").click());
  await settle();
  assert.deepEqual(runsAsked, [SWEEP.id]);
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
  const current = runRows(page)[0]?.querySelector("[aria-current]")?.getAttribute("aria-current");
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
  assert.equal(folded === null, true, "the fold after it stands");
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
    runRows(page).map(
      (row) => row.querySelector("[aria-current]")?.getAttribute("aria-current") ?? null,
    ),
    [null, "true"],
  );
});

/**
 * The Automations pages on a narrow stage, a phone's, or the room given,
 * standing on `start`, with the window's stylesheets laid: the page and
 * whether its runs stand alone held as the Plans tab holds them, its runs'
 * screen shown and left by their own presses.
 */
function mountNarrow(start: AutomationsPlace, room: ShellRoom = SHELL_ROOM.NARROW): HTMLElement {
  function Pages() {
    const [place, setPlace] = useState(start);
    // As the Plans tab does, a page opened on a run's link stands its runs.
    const [runsShown, setRunsShown] = useState(
      start.kind === AUTOMATIONS_PAGE.EDIT && start.runId !== undefined,
    );
    const tasks = tasksControl({
      workspace: WORKSPACE,
      workspaces: [PERSONAL, WORKSPACE],
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place,
        runs: runsShown,
        onOpen: (next: AutomationsPlace = { kind: AUTOMATIONS_PAGE.LIST }) => setPlace(next),
        onRuns: setRunsShown,
      },
    });
    return createElement(
      "div",
      { className: "desktop-shell", "data-room": room },
      createElement(AutomationsPage, { tasks, room }),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, createElement(Pages))));
  return container;
}

/** Which of an automation's two screens are on screen: its setup, and its runs. */
function screensShown(page: HTMLElement): string[] {
  const setup = page.querySelector(".automation-editor-screen") ?? assert.fail("no setup");
  const runsScreen = page.querySelector("section[aria-label='Runs']") ?? assert.fail("no runs");
  return [...(shown(setup) ? ["setup"] : []), ...(shown(runsScreen) ? ["runs"] : [])];
}

test("on a narrow stage an automation's setup stands the whole width with its runs hidden, until Runs stands them alone under a way back that returns to the setup", async () => {
  window.localStorage.clear();
  runs = [SWEEP_RUN, UNSTARTED_RUN];
  const sheets = layContainersAt({});
  try {
    const page = mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
    await settle();
    assert.deepEqual(screensShown(page), ["setup"]);
    assert.equal(
      page.querySelector(".automation-runs-pane") === null,
      true,
      "no Runs panel stands beside the setup, kept open or not",
    );

    phoneRuns();
    assert.deepEqual(screensShown(page), ["runs"]);
    const runsScreen = page.querySelector("section[aria-label='Runs']");
    assert.equal(runsScreen?.querySelectorAll("li").length, 2, "its runs are listed");

    act(() => button(SWEEP.name).click());
    assert.deepEqual(screensShown(page), ["setup"]);

    phoneRuns();
    act(() => runsScreen?.querySelectorAll<HTMLElement>(".ui-list-row-main")[1]?.click());
    assert.deepEqual(
      screensShown(page),
      ["setup"],
      "a run that opens nothing else opens the setup",
    );
  } finally {
    sheets.remove();
  }
});

test("on a wide stage an automation's page under the split's line by its own width stands its setup alone, its toolbar's Runs standing the runs alone under a way back to the setup", async () => {
  window.localStorage.clear();
  runs = [SWEEP_RUN];
  const sheets = layContainersAt({});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("automations-view") ? 700 : 0 });
  });
  try {
    const page = mountNarrow(
      { kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id },
      SHELL_ROOM.WIDE,
    );
    await settle();
    assert.deepEqual(screensShown(page), ["setup"]);
    assert.equal(
      page.querySelector(".automation-runs-pane") === null,
      true,
      "no Runs panel stands beside it",
    );

    act(() => button("Runs").click());
    assert.deepEqual(screensShown(page), ["runs"]);
    assert.equal(
      page.querySelector(".automation-runs-screen h2") === null,
      true,
      "the screen is titled Runs already, so its runs wear no second heading",
    );

    act(() => button(SWEEP.name).click());
    assert.deepEqual(screensShown(page), ["setup"]);
  } finally {
    sheets.remove();
  }
});

test("on a narrow stage Runs, from the head's ⋯, takes the focus to the runs' way back, and the way back hands it to the ⋯ it was chosen from", async () => {
  window.localStorage.clear();
  mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const more = button("Automation actions");
  act(() => {
    more.focus();
    more.click();
  });
  const runsItem = menuItem("Runs");
  act(() => runsItem.click());
  const back = button(SWEEP.name);
  assert.ok(document.activeElement === back, "the way back to the setup");

  act(() => {
    back.focus();
    back.click();
  });
  assert.ok(document.activeElement === button("Automation actions"), "the setup's ⋯");
});

test("on a narrow stage a link to a run opens on its runs, with the run marked and the way back to the setup", async () => {
  runs = [SWEEP_RUN];
  const page = mountNarrow({
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: SWEEP.id,
    runId: SWEEP_RUN.id,
  });
  await settle();
  assert.equal(page.querySelector(".automation-editor-screen")?.hasAttribute("hidden"), true);
  const runsScreen = page.querySelector("section[aria-label='Runs']");
  assert.equal(runsScreen?.hasAttribute("hidden"), false);
  assert.ok(runsScreen?.querySelector("[aria-current]"), "the run the link named is marked");
  assert.ok(document.activeElement === button(SWEEP.name), "the focus on the way back");
});

test("on a narrow stage each row says when it runs next before what fires it, under its name, a far run with its year, and a lone owner's card is headed in place of each row's owner", async () => {
  standing = [
    { ...SWEEP, nextRunAt: Date.UTC(2026, 9, 22, 9) },
    { ...FAILING, enabled: false },
    {
      ...automation(4, { name: "Yearly audit", scope: AUTOMATION_SCOPE.WORKSPACE }),
      nextRunAt: Date.UTC(2099, 1, 1, 9),
    },
  ];
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();

  assert.deepEqual(
    [...page.querySelectorAll(".automation-group h2")].map((heading) => heading.textContent),
    ["Acme"],
  );
  assert.equal(page.querySelector(".automation-owner") === null, true, "no row names its owner");
  const line = (name: string) =>
    rowOf(page, name).querySelector(".ui-list-row-description")?.textContent ?? "";
  assert.match(line("Nightly flaky-test sweep"), /^Next .+ · Weekdays at 9:00 AM · UTC$/u);
  assert.equal(line("Dependency bumps"), "Weekdays at 9:00 AM · UTC");
  assert.match(
    line("Yearly audit"),
    /^Next .*2099.* · Weekdays at 9:00 AM · UTC$/u,
    "a far run names its year",
  );
  assert.ok(rowOf(page, "Dependency bumps").querySelector(".failed-mark"));
});

/** An automation fired by Sentry alerts from two projects at the error level, waiting six hours before the same issue runs again. */
const SENTRY_ALERTS = automation(11, {
  name: "Fix Sentry errors",
  trigger: {
    kind: AUTOMATION_TRIGGER.INTEGRATION,
    provider: TRIGGER_PROVIDER.SENTRY,
    event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    filters: { project: ["web", "api"], level: [SENTRY_LEVEL.ERROR] },
  },
  guards: { ...AUTOMATION_DEFAULT_GUARDS, subjectCooldownHours: 6 },
});

/** A Sentry issue's firing, as its run keeps it. Synthetic. */
const ISSUE_FIRING = {
  kind: AUTOMATION_FIRING.INTEGRATION,
  provider: TRIGGER_PROVIDER.SENTRY,
  event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
  subject: {
    id: "4711",
    title: "TypeError: cart is undefined",
    url: "https://acme.sentry.io/issues/4711/",
  },
} as const;

test("a Sentry automation's runs wear Sentry's mark, its row says its event and filters, and a skipped run says its issue and opens it", async () => {
  const opened: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, openWeb: (url: string) => opened.push(url) });
  standing = [SENTRY_ALERTS];
  const list = mountPages({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  assert.ok(
    rowOf(list, "Fix Sentry errors").querySelector(
      '.actor-mark[data-kind="automation"] .integration-mark-sentry',
    ),
    "the row's tile wears Sentry's mark",
  );
  assert.ok(
    says(rowOf(list, "Fix Sentry errors"), "When an alert fires in Sentry · web, api · error"),
  );
  act(() => root?.unmount());
  document.body.innerHTML = "";

  runs = [
    {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-000000000011",
      firing: ISSUE_FIRING,
      status: AUTOMATION_RUN_STATUS.SKIPPED,
      reason: "same-subject",
      agent: null,
      firedAt: 1,
      settledAt: 1,
    },
  ];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();
  const [row] = runRows(page);
  assert.ok(row, "the run is listed");
  assert.deepEqual(glyphs([row]), ["sentry"]);
  assert.ok(says(row, "TypeError: cart is undefined"));
  assert.ok(says(row, "Skipped: already ran for this issue within its cooldown."));
  act(() => row.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(opened, ["https://acme.sentry.io/issues/4711/"]);
});

test("a new Sentry automation is made on the event, filters, levels, and cooldown picked, the alert recommended and how to send it said", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Sentry");
  assert.equal(picked(page, "Event"), "Alert triggered (recommended)");
  assert.match(pickerDetail(page, "Event") ?? "", /alert rule's action/u);
  pick(page, "Event", "New issue");
  type(page.querySelector("input[aria-label='Projects']"), "web, api,");
  type(page.querySelector("input[aria-label='Environments']"), "production");
  act(() => button("Fatal").click());
  act(() => button("Error").click());
  assert.equal(
    pickerDetail(page, "Type"),
    "When a new issue is created in Sentry · web, api · production · error, fatal",
  );
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Projects']")?.value,
    "web, api,",
    "a comma still to be followed stands as typed",
  );

  type(page.querySelector("input[aria-label='Hours before the same issue runs again']"), "0");
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(creates.length, 0);
  assert.match(page.textContent ?? "", /Wait a whole number of hours, from 1 to 168\./u);

  type(page.querySelector("input[aria-label='Hours before the same issue runs again']"), "12");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0]?.trigger, {
    kind: AUTOMATION_TRIGGER.INTEGRATION,
    provider: TRIGGER_PROVIDER.SENTRY,
    event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
    filters: {
      project: ["web", "api"],
      environment: ["production"],
      level: [SENTRY_LEVEL.FATAL, SENTRY_LEVEL.ERROR],
    },
  });
  assert.deepEqual(creates[0]?.guards, { ...AUTOMATION_DEFAULT_GUARDS, subjectCooldownHours: 12 });
});

test("a Sentry filter over its bounds says so under its own row, never under Type", async () => {
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();

  pick(page, "Type", "Sentry");
  type(
    page.querySelector("input[aria-label='Projects']"),
    Array.from({ length: 11 }, (_, n) => `project-${n}`).join(", "),
  );
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();

  assert.equal(creates.length, 0);
  assert.ok(announced("Keep each filter to 10 values of up to 100 characters."));
  assert.equal(
    page.querySelector("input[aria-label='Projects']")?.getAttribute("aria-invalid"),
    "true",
  );
  assert.notEqual(
    page.querySelector("input[aria-label='Environments']")?.getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(picker(page, "Type").getAttribute("aria-invalid"), null);
});

test("a saved Sentry automation opens on its filters and cooldown, and a cooldown changed saves over its guards alone", async () => {
  standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  assert.equal(picked(page, "Type"), "Sentry");
  assert.equal(
    page.querySelector<HTMLInputElement>("input[aria-label='Projects']")?.value,
    "web, api",
  );
  assert.equal(button("Error").getAttribute("aria-checked"), "true");
  const hours = page.querySelector<HTMLInputElement>(
    "input[aria-label='Hours before the same issue runs again']",
  );
  assert.equal(hours?.value, "6");

  type(hours, "48");
  act(() => button("Save").click());
  await settle();

  assert.deepEqual(changes, [
    {
      automationId: SENTRY_ALERTS.id,
      change: { guards: { ...AUTOMATION_DEFAULT_GUARDS, subjectCooldownHours: 48 } },
    },
  ]);
});

test("where the workspace has no Sentry installed, a Sentry trigger offers Install Sentry in its rows' place, which installs on the workspace", async () => {
  sentryRead = { configured: true, installations: [] };
  standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  assert.match(page.textContent ?? "", /Sentry isn't installed/u);
  assert.equal(page.querySelector("button[aria-label^='Event: ']") === null, true);
  assert.equal(page.querySelector("input[aria-label='Projects']") === null, true);
  act(() => button("Install Sentry").click());
  await settle();
  assert.deepEqual(sentryInstalls, [WORKSPACE.id]);
});

test("a Sentry read that fails says so above a saved trigger's rows, which stay editable, and Retry reads again", async () => {
  sentryRefusals = 1;
  standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();

  assert.match(page.textContent ?? "", /The workspace's Sentry could not be read\./u);
  assert.ok(page.querySelector("input[aria-label='Projects']"), "the saved trigger's rows stand");
  act(() => button("Retry").click());
  await settle();
  assert.doesNotMatch(page.textContent ?? "", /could not be read/u);
  assert.ok(page.querySelector("input[aria-label='Projects']"));
});

test("Sentry stays listed but unpickable, saying why, where this deployment holds no Sentry integration, and one already fired by it keeps its rows", async () => {
  sentryRead = { configured: false, installations: [] };
  standing = [SENTRY_ALERTS];
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  await settle();
  act(() => picker(page, "Type").click());
  const sentry = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
    (row) => row.querySelector(".ui-combobox-option-label")?.textContent === "Sentry",
  );
  assert.ok(sentry, "Sentry is listed");
  assert.equal(sentry.getAttribute("aria-disabled"), "true");
  assert.match(sentry.textContent ?? "", /Not set up on this deployment yet/u);
  act(() => sentry.click());
  assert.equal(picked(page, "Type"), "Schedule");
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const saved = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SENTRY_ALERTS.id });
  await settle();
  assert.equal(picked(saved, "Type"), "Sentry");
});

test("Sentry chosen before the read says the deployment holds no Sentry integration is held back from saving", async () => {
  sentryRead = { configured: false, installations: [] };
  const page = mountPages({ kind: AUTOMATIONS_PAGE.NEW });
  // Chosen before the read answers.
  pick(page, "Type", "Sentry");
  await settle();

  assert.match(page.textContent ?? "", /Sentry isn't available/u);
  type(page.querySelector("input[aria-label='Automation name']"), "Fix new issues");
  type(page.querySelector("textarea[aria-label='Prompt']"), "Fix the issue Sentry opened.");
  act(() => button("Create automation").click());
  await settle();
  assert.equal(creates.length, 0);
  assert.match(page.textContent ?? "", /Vespin cannot receive Sentry events here/u);
});

test("on a phone the list is headed by New automation and one ⋯ holding Create with an agent, its title centered between them", async () => {
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.LIST });
  await settle();
  const head = page.querySelector<HTMLElement>(".automations-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["New automation", "Automation list actions"],
  );
  assert.equal(head.querySelector("h1")?.textContent, "Automations");
  act(() => button("Automation list actions").click());
  assert.ok(menuItem("Create with an agent"), "the ⋯ holds Create with an agent");
});

test("on a phone an automation's page is headed by the way back to the list, its name a section's gap under it, and one ⋯ holding Save, Run now, its switch, Runs, and the automation's own actions, where the draft stands its heading", async () => {
  // Note that the window's sheets are laid on a phone's root, whose tokens the gap is read in.
  const sheets = layContainersAt({});
  document.documentElement.dataset.uiProfile = PROFILE.WEB;
  document.documentElement.dataset.uiRoom = SHELL_ROOM.NARROW;
  onTestFinished(() => {
    sheets.remove();
    delete document.documentElement.dataset.uiProfile;
    delete document.documentElement.dataset.uiRoom;
  });
  const page = mountNarrow({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  const head = page.querySelector<HTMLElement>(".automation-head");
  assert.ok(head, "the phone's head stands");
  const header = page.querySelector<HTMLElement>(".ui-detail-page-header");
  assert.ok(header, "the page's header stands");
  assert.equal(
    wayBackGap(head, header),
    pixelsOf(header, "var(--ui-section-gap)"),
    "the name stands a section's gap under the way back",
  );
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Automations", "Automation actions"],
  );
  // The page's header names it, and the head picks the name up once that scrolls away, so it is the one h1.
  assert.equal(head.querySelector("h1") === null, true);
  assert.equal(
    page.querySelector<HTMLInputElement>("h1 input[aria-label='Automation name']")?.value,
    SWEEP.name,
  );
  act(() => button("Automation actions").click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.match(menu?.textContent ?? "", /Saved/, "the draft's standing heads the menu");
  for (const offered of ["Save", "Run now", "Runs", "Copy link", "Delete"]) {
    assert.ok(
      [...(menu?.querySelectorAll(".ui-menu-item-label") ?? [])].some(
        (each) => each.textContent === offered,
      ),
      `the ⋯ offers ${offered}`,
    );
  }
  assert.ok(menu?.querySelector('[role="menuitemcheckbox"]'), "and the automation's switch");
});

test("a model catalog that could not be read says so in the model menu, and Retry reads it again", async () => {
  defaultRefused = true;
  catalogRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  // Note that the menu is hung from the chip by its laid-out boxes, which jsdom draws none of.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("automation-model-picker"))
      return DOMRect.fromRect({ x: 200, y: 400, width: 120, height: 24 });
    if (this.classList.contains("ui-anchored-popover"))
      return DOMRect.fromRect({ x: 0, y: 0, width: 340, height: 300 });
    return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  // Note that the picker stands once the failed reads reach their queries.
  const choose = await vi.waitFor(() => button("Choose a model"));
  act(() => choose.click());
  await settle();

  const menu = page.querySelector(".ui-searchable-menu") ?? assert.fail("the model menu opens");
  await vi.waitFor(() =>
    assert.equal(
      menu.querySelector("[role=alert]")?.textContent,
      "The models could not be read.Retry",
    ),
  );
  assert.equal(menu.querySelector("[role=status]") === null, true, "it does not read for ever");

  catalogRefused = false;
  const readsBefore = catalogReads;
  act(() =>
    (menu.querySelector<HTMLButtonElement>("[role=alert] button") ?? assert.fail()).click(),
  );
  await settle();

  assert.equal(catalogReads, readsBefore + 1, "Retry reads the catalog again");
  await vi.waitFor(() => assert.equal(menu.querySelector("[role=alert]") === null, true));
  assert.ok(menu.querySelectorAll("[role=option]").length > 0, "the models are listed");
});

test("workspace agents the task list failed to carry say so in the Agent row, and Retry reads the list again", async () => {
  agentListRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();

  assert.match(page.textContent ?? "", /The workspace's agents could not be read\./u);

  act(() => button("Retry").click());

  await vi.waitFor(() => assert.doesNotMatch(page.textContent ?? "", /could not be read/u));
  assert.equal(picked(page, "Agent"), "Started by its first run");
});

test("a search of the Agent picker that failed says it failed rather than that no agent matches, and Retry searches again", async () => {
  agentSearchRefused = true;
  const page = mountPages({ kind: AUTOMATIONS_PAGE.EDIT, automationId: SWEEP.id });
  await settle();
  pick(page, "Runs land in", "Same agent");
  await settle();
  act(() => picker(page, "Agent").click());

  type(
    document.querySelector<HTMLInputElement>('[role="dialog"][aria-label="Agent"] input'),
    "zzz",
  );
  const dialog = document.querySelector('[role="dialog"][aria-label="Agent"]') ?? assert.fail();
  await vi.waitFor(() =>
    assert.equal(
      dialog.querySelector("[role=alert]")?.textContent,
      "The search for agents could not be read.Retry",
    ),
  );
  assert.doesNotMatch(dialog.textContent ?? "", /No agents match/u);

  agentSearchRefused = false;
  act(() =>
    (dialog.querySelector<HTMLButtonElement>("[role=alert] button") ?? assert.fail()).click(),
  );
  await vi.waitFor(() => assert.match(dialog.textContent ?? "", /No agents match/u));

  assert.equal(dialog.querySelector("[role=alert]") === null, true);
});
