// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { ModelChoice } from "@luke/features/models-wire";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import type { NewTaskAgent, TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
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
    agentTitle: null,
    agentModel: "anthropic/claude-opus-5.5",
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
    ...(startedBy === undefined ? {} : { startedBy }),
  };
}

/** The workspace listed, which the composer starts a task in. */
const LISTED_WORKSPACE = "workspace-personal";

/** The account's default model, which the composer's chip starts on. */
const DEFAULT_CHOICE: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };

let root: Root | undefined;

// Landed before any page renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  window.localStorage.clear();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** A task the composer started: its name, repository, workspace, and the agent it asked for. */
interface Started {
  readonly name: string;
  readonly repository: string | null;
  readonly workspaceId: string | undefined;
  readonly agent: NewTaskAgent | undefined;
}

/** The tab's New task control as the welcome's composer meets it, each start written to `started`. */
function newTaskControl(started: Started[]): TasksControl["newTask"] {
  const control = tasksControl().newTask;
  return {
    ...control,
    workspaceId: LISTED_WORKSPACE,
    repositoriesIn: () => ({ ...tasksControl().repositories, recent: ["acme/relay"] }),
    readDefault: () => Promise.resolve({ choice: DEFAULT_CHOICE }),
    start: (name, repository, workspaceId, from) => {
      started.push({
        name,
        repository,
        workspaceId,
        agent: from?.handed,
      });
      return Promise.resolve(undefined);
    },
  };
}

/** The page with no task open over `overrides`, an account with nothing yet where they say nothing else, each start recorded. */
function mount(overrides: Partial<TasksControl> = {}) {
  const started: Started[] = [];
  const tasks = tasksControl({
    listRead: true,
    tasks: [],
    listed: { tasks: [], inbox: [], inboxTasks: [] },
    inbox: [],
    inboxTasks: [],
    newTask: newTaskControl(started),
    ...overrides,
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(onRegistry(AtomRegistry.make(), createElement(DesktopWelcome, { tasks }))),
  );
  return { page: container, started };
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

test("an account with no plan yet is welcomed with New task's composer under Luke's line, and nothing the page says names the sidebar", async () => {
  const { page, started } = mount();

  await settle();
  typeInComposer(page, "Set up the repository");
  pressInComposer(page, "Enter");
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Start your first task");
  assert.ok(welcomed(page), "the welcome stands");
  assert.deepEqual(
    started.map((each) => each.agent?.prompt),
    ["Set up the repository"],
    "its composer starts the first task",
  );
  assert.doesNotMatch(page.textContent ?? "", /sidebar/iu);
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

test("the welcome's composer takes the caret as the page shows, and ↑, ↓, and Return typed in it are the composer's", async () => {
  const { page, started } = mount();
  await settle();
  const editor = composerEditor(page);
  assert.ok(document.activeElement === editor, "the words take the caret");

  typeInComposer(page, "Fix the refresh");
  const down = pressInComposer(page, "ArrowDown");
  const up = pressInComposer(page, "ArrowUp");

  assert.ok(document.activeElement === editor, "the caret stays in the words");
  assert.equal(down.defaultPrevented || up.defaultPrevented, false, "the page takes neither arrow");
  pressInComposer(page, "Enter");
  await settle();
  assert.equal(started.length, 1, "Return started the composer's task");
});

test("the welcome's composer leaves the caret in a field the developer is typing in as the page shows", async () => {
  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  const { page } = mount();
  await settle();

  assert.ok(composerEditor(page));
  assert.ok(document.activeElement === field, "the field keeps the caret");
});

test("Return in the welcome's composer starts the task in the listed workspace, and an agent on the words with the chip's model", async () => {
  const { page, started } = mount();
  await settle();
  typeInComposer(page, "Make the sidebar keep its folds.");
  pressInComposer(page, "Enter");
  await settle();

  const [{ agent, ...task } = assert.fail("a task started")] = started;
  const { idempotencyKey, ...handed } = agent ?? assert.fail("an agent was asked for");
  assert.deepEqual(task, {
    name: "",
    repository: "acme/relay",
    workspaceId: LISTED_WORKSPACE,
  });
  assert.deepEqual(handed, {
    prompt: "Make the sidebar keep its folds.",
    attachments: [],
    choice: DEFAULT_CHOICE,
  });
  assert.ok(idempotencyKey, "the agent's start carries the card's key");
  assert.equal(started.length, 1);
});
