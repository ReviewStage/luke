// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MODEL_PROVIDER, type CatalogModel } from "@repo/features/models-wire";
import type { TasksRepositoriesAnswer } from "@repo/features/tasks-view";
import type { AppInboxTasklessItem } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopWelcome } from "./desktop-welcome.js";

/** A plan of the account's, standing in some workspace. */
const PLAN = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-team",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** An automation's question with no plan, waiting on the account unless `startedBy` names a teammate. */
function automationQuestion(startedBy?: string): AppInboxTasklessItem {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000009",
    agentId: "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4",
    title: "Quarantine the flaky test?",
    postedAt: 1,
    updatedAt: 1,
    agentTitle: null,
    agentModel: "anthropic/claude-opus-5.5",
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
    ...(startedBy === undefined ? {} : { startedBy }),
  };
}

/** The workspace listed, which setup reads GitHub's repositories in. */
const LISTED_WORKSPACE = "workspace-personal";

/** A model the account's agents may run on, missing its credential where `missing` says. */
function model(missing: boolean): CatalogModel {
  return {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
    ...(missing ? { credentialMissing: true } : {}),
  };
}

/** The repositories the listed workspace reaches: one where `reached` says, none otherwise. */
function repositoriesRead(reached: boolean): () => Promise<TasksRepositoriesAnswer> {
  return () =>
    Promise.resolve({
      repositories: {
        installed: reached,
        repositories: reached
          ? [
              {
                fullName: "acme/relay",
                owner: "acme",
                name: "relay",
                defaultBranch: "main",
                private: true,
                updatedAt: 1,
              },
            ]
          : [],
        installationUrl: "https://github.com/apps/vespin/installations/new",
      },
    });
}

let root: Root | undefined;

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  window.localStorage.clear();
  document.body.innerHTML = "";
});

/** The page with no task open over `overrides`, an account with nothing yet where they say nothing else, with an agent and GitHub set up unless `setup` says otherwise; New task's presses counted in `opened`. */
function mount(overrides: Partial<TasksControl> = {}, setup = { agent: true, github: true }) {
  const opened: number[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    listRead: true,
    tasks: [],
    listed: { tasks: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    onNewTask: () => opened.push(1),
    newTask: {
      ...base.newTask,
      workspaceId: LISTED_WORKSPACE,
      models: [model(!setup.agent)],
      repositoriesIn: () => ({ ...base.repositories, read: repositoriesRead(setup.github) }),
    },
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(onRegistry(AtomRegistry.make(), createElement(DesktopWelcome, { tasks }))),
  );
  return { page: container, opened };
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Whether the welcome stands. */
function welcomed(page: HTMLElement): boolean {
  return page.querySelector("[aria-label='Welcome']") !== null;
}

/** The button the page names `name`. */
function button(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll("button")].find((each) => each.textContent?.trim() === name);
}

test("an account with an agent and GitHub set up is welcomed with New task, which opens New task's dialog, and nothing the page says names the sidebar", async () => {
  const { page, opened } = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
  assert.ok(welcomed(page), "the welcome stands");
  act(() => button(page, "New task")?.click());
  assert.equal(opened.length, 1, "New task opens its dialog");
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
});

test("an account setup left without an agent is asked to finish setting up, its first task held until one is connected", async () => {
  const { page, opened } = mount({}, { agent: false, github: true });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Finish setting up");
  assert.match(page.textContent ?? "", /Connect an agent/u);
  assert.doesNotMatch(
    page.textContent ?? "",
    /Connect GitHub/u,
    "GitHub, set up, is not asked again",
  );
  act(() => button(page, "Start your first task")?.click());
  assert.equal(opened.length, 0, "no task starts before an agent is connected");
});

test("an account whose task list is unread is not welcomed until the list says it is new", () => {
  const { page } = mount({ listRead: false });
  assert.equal(welcomed(page), false);
  assert.equal(page.textContent, "");
});

test("signed out, nothing is welcomed, since nothing could start", () => {
  const { page } = mount({ signedIn: false });
  assert.equal(welcomed(page), false);
});

test("an account with a plan in any workspace is not welcomed, the window resting on its Inbox instead", () => {
  assert.equal(welcomed(mount({ tasks: [PLAN] }).page), false, "a plan in another workspace");
});

test("an account with no plan yet but an automation's question waiting on it is not welcomed, the question waiting in its Inbox", () => {
  const { page } = mount({ me: "user-dean", inboxTaskless: [automationQuestion()] });
  assert.equal(welcomed(page), false);
});

test("an account with no plan yet whose only waiting question is a teammate's agent's with no plan is still welcomed, the question waiting on the teammate", async () => {
  const { page } = mount({
    me: "user-dean",
    inboxTaskless: [automationQuestion("user-charles")],
  });
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
});
