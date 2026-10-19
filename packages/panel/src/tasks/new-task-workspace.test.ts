// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { NewTaskDialog } from "./new-task-dialog.js";
import type { RepositoryChooser } from "./repository-chip.js";

/**
 * new-task-workspace.test.ts -- New task starts in the workspace listed and
 * offers no other: its head row's repository chip lists that workspace's
 * repositories, and the task starts there. Where the owner's workspace
 * changes under the composer, as Home's does, a repository or a Linear
 * search of the other's is let go. Each test stands the card in Plan mode,
 * which starts with or without a repository, as New task keeps the mode it
 * was left in. Synthetic throughout.
 */
const PERSONAL: Workspace = {
  id: "ws-personal",
  name: "Personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "ws-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme-corp", active: true },
};

const roots: Root[] = [];

// Landed before any card renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  window.localStorage.setItem("luke.new-task-mode", "plan");
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The chooser each workspace's repository chip is handed, Acme's reaching its installation's repositories and Personal's none. */
function chooserFor(workspaceId: string | undefined): RepositoryChooser {
  const base = tasksControl().repositories;
  if (workspaceId !== ACME.id) {
    return {
      ...base,
      scope: workspaceId,
      workspaceName: PERSONAL.name,
      read: () =>
        Promise.resolve({
          repositories: {
            installed: false,
            repositories: [],
            installationUrl: "https://github.com/apps/luke/installations/new",
          },
        }),
    };
  }
  return {
    ...base,
    recent: ["acme-corp/relay"],
    scope: ACME.id,
    workspaceName: ACME.name,
    read: () =>
      Promise.resolve({
        repositories: {
          installed: true,
          repositories: [
            {
              owner: "acme-corp",
              name: "relay",
              fullName: "acme-corp/relay",
              defaultBranch: "main",
              private: true,
              updatedAt: 1,
            },
          ],
          installationUrl: "https://github.com/apps/luke/installations/new",
        },
      }),
  };
}

test("New task offers no workspace picker, and its head row's repository chip lists the listed workspace's repositories, where the plan starts", async () => {
  const dialog = await openNewTask(ACME.id);
  const head = document.querySelector(".new-task-head");

  assert.equal(document.querySelector('[aria-label^="Workspace"]'), null);
  assert.ok(head?.contains(dialog.repositoryChip()), "the repository chip stands in the head row");
  act(() => dialog.repositoryChip().click());
  await settle();
  const listed = [...document.querySelectorAll('[role="option"]')].map((row) =>
    [".luke-combobox-option-detail", ".luke-combobox-option-label"]
      .map((part) => row.querySelector(part)?.textContent)
      .join("/"),
  );
  act(() => dialog.repositoryChip().click());
  await settle();
  await dialog.create();

  assert.deepEqual(listed, ["acme-corp/relay"]);
  assert.deepEqual(dialog.starts, [["acme-corp/relay", ACME.id]]);
});

/** Plan mode's Start, the composer's round button. */
const START_WITH_LUKE = 'button[aria-label="Start planning"]';

/** New task open over the two workspaces, starting in `workspaceId` until `rehome` lists another, each start's repository and workspace written down. */
async function openNewTask(workspaceId: string, preset?: string) {
  const starts: [string | null, string | undefined][] = [];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (listed: string) =>
    act(() =>
      root.render(
        createElement(NewTaskDialog, {
          newTask: {
            ...control.newTask,
            open: true,
            preset: preset === undefined ? undefined : { repository: preset },
            workspaces: [PERSONAL, ACME],
            workspaceId: listed,
            repositoriesIn: chooserFor,
            start: (_name, repository, startsIn) => {
              starts.push([repository, startsIn]);
              return Promise.resolve(undefined);
            },
          },
        }),
      ),
    );
  draw(workspaceId);
  await settle();
  const repositoryChip = () =>
    document.querySelector<HTMLButtonElement>(".repository-chip .luke-chip") ??
    assert.fail("the repository chip stands");
  const create = async () => {
    const button = document.querySelector<HTMLButtonElement>(START_WITH_LUKE);
    act(() => button?.click());
    await settle();
  };
  /** Stands the card again with the owner listing another workspace. */
  const rehome = async (listed: string) => {
    draw(listed);
    await settle();
  };
  return { starts, repositoryChip, create, rehome };
}

test("a repository group's + whose repository the workspace's GitHub does not reach opens New task on none", async () => {
  const dialog = await openNewTask(PERSONAL.id, "ReviewStage/luke");

  const label = dialog.repositoryChip().textContent;
  await dialog.create();

  assert.equal(label, "No repository");
  assert.deepEqual(dialog.starts, [[null, PERSONAL.id]]);
});

test("the owner's workspace changing to one with no GitHub connected lets the other workspace's repository go and offers none of its own", async () => {
  const dialog = await openNewTask(ACME.id);
  const before = dialog.repositoryChip().textContent;

  await dialog.rehome(PERSONAL.id);
  act(() => dialog.repositoryChip().click());
  await settle();
  const offered = [...document.querySelectorAll("button")].map((button) => button.textContent);
  const note = document.querySelector(".luke-combobox-note p")?.textContent;
  const after = dialog.repositoryChip().textContent;
  await dialog.create();

  assert.deepEqual([before, after], ["acme-corp/relay", "No repository"]);
  assert.equal(offered.includes("acme-corp/relay"), false);
  assert.equal(note, "Personal has no GitHub connected yet.");
  assert.deepEqual(dialog.starts, [[null, PERSONAL.id]]);
});

test("the owner's workspace changing closes the Linear search, and the chip then lists the issues of the workspace listed", async () => {
  const issuesOf = (workspaceId: string): readonly LinearIssueSummary[] => [
    {
      id: `${workspaceId}-1`,
      identifier: workspaceId === ACME.id ? "ACME-1" : "ME-1",
      title: "Rotate the deploy key",
      url: "https://linear.app/x/issue/1",
    },
  ];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (listed: string) =>
    act(() =>
      root.render(
        createElement(NewTaskDialog, {
          newTask: {
            ...control.newTask,
            open: true,
            workspaces: [PERSONAL, ACME],
            workspaceId: listed,
            repositoriesIn: chooserFor,
            linearIssuesIn: (workspaceId) =>
              workspaceId === undefined ? undefined : () => Promise.resolve(issuesOf(workspaceId)),
          },
        }),
      ),
    );
  draw(PERSONAL.id);
  await settle();
  const openLinear = async () => {
    const chip =
      document.querySelector<HTMLButtonElement>('[aria-label="Choose an issue"]') ??
      assert.fail("the Issue chip stands");
    act(() => chip.click());
    await settle();
  };
  const listed = () =>
    [...document.querySelectorAll('[role="dialog"][aria-label="Issues"] [role="option"]')].map(
      (option) => option.textContent,
    );
  await openLinear();
  const before = listed();

  draw(ACME.id);
  await settle();

  const afterSwitch = listed();
  await openLinear();

  assert.deepEqual(before, ["Rotate the deploy keyME-1"]);
  assert.deepEqual(afterSwitch, []);
  assert.deepEqual(listed(), ["Rotate the deploy keyACME-1"]);
});

test("Linear let go while its search stands closes the search, and its coming back draws none until the chip is pressed", async () => {
  const issues: readonly LinearIssueSummary[] = [
    {
      id: "acme-1",
      identifier: "ACME-1",
      title: "Rotate the deploy key",
      url: "https://linear.app/x/issue/1",
    },
  ];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (connected: boolean) =>
    act(() =>
      root.render(
        createElement(NewTaskDialog, {
          newTask: {
            ...control.newTask,
            open: true,
            workspaces: [ACME],
            workspaceId: ACME.id,
            repositoriesIn: chooserFor,
            linearIssuesIn: () => (connected ? () => Promise.resolve(issues) : undefined),
          },
        }),
      ),
    );
  const search = () => document.querySelector('[role="dialog"][aria-label="Issues"]');
  draw(true);
  await settle();
  const chip =
    document.querySelector<HTMLButtonElement>('[aria-label="Choose an issue"]') ??
    assert.fail("the Issue chip stands");
  act(() => chip.click());
  await settle();
  const opened = search() !== null;

  draw(false);
  await settle();
  draw(true);
  await settle();

  assert.equal(opened, true);
  assert.equal(search() !== null, false, "no search is drawn");
});
