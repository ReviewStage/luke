// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl } from "#testing/tasks-control";
import { NewTaskDialog } from "./new-task-dialog";
import type { RepositoryChooser } from "./repository-chip";

/**
 * new-task-workspace.test.ts -- New task says where the task will start,
 * "New task in Acme", and the workspace chip there chooses another: the
 * repository chip then lists that workspace's repositories, and the plan
 * starts there. Both chips are the app's one picker, Settings' bordered chip
 * and its menu. Synthetic throughout.
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

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
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

test("New plan says the workspace it starts in, and the workspace chosen there lists its own repositories and starts the plan", async () => {
  const starts: (string | undefined)[] = [];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(NewTaskDialog, {
        newTask: {
          ...control.newTask,
          open: true,
          workspaces: [PERSONAL, ACME],
          workspaceId: PERSONAL.id,
          repositoriesIn: chooserFor,
          start: (_name, _repository, workspaceId) => {
            starts.push(workspaceId);
            return Promise.resolve(undefined);
          },
        },
      }),
    ),
  );
  await settle();
  const title = () => document.querySelector(".new-task-title")?.textContent;
  assert.match(title() ?? "", /^New task in.*Personal$/u);

  const workspaceChip =
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Personal"]') ??
    assert.fail("the title's workspace is a chip");
  act(() => workspaceChip.click());
  await settle();
  const menu =
    document.querySelector('[role="dialog"][aria-label="Workspace"]') ??
    assert.fail("the chip opens its menu");
  assert.ok(
    document.querySelector('[role="dialog"][aria-modal="true"]')?.contains(menu),
    "the chip's menu stands inside the dialog, over the window it dims",
  );
  act(() => optionNamed(menu, "Acme").click());
  await settle();
  assert.match(title() ?? "", /Acme$/u, "the title says the workspace chosen");

  const repositoryChip =
    document.querySelector<HTMLButtonElement>(".repository-chip .luke-chip") ??
    assert.fail("the repository chip stands");
  act(() => repositoryChip.click());
  await settle();
  assert.deepEqual(
    // A row names the repository, then its owner after it.
    [...document.querySelectorAll('[role="option"]')].map((row) =>
      [".luke-combobox-option-detail", ".luke-combobox-option-label"]
        .map((part) => row.querySelector(part)?.textContent)
        .join("/"),
    ),
    ["acme-corp/relay"],
    "the list is the chosen workspace's repositories",
  );

  const name = document.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Usage");
    name?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    each.textContent?.startsWith("Create task"),
  );
  act(() => create?.click());
  await settle();
  assert.deepEqual(starts, [ACME.id], "the plan starts in the workspace chosen");
});

/** The menu's option that names `name`. */
function optionNamed(menu: ParentNode, name: string): HTMLElement {
  return (
    [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.endsWith(name),
    ) ?? assert.fail(`the menu offers ${name}`)
  );
}

/** New task open over the two workspaces, starting in `workspaceId`, each start's repository and workspace written down. */
async function openNewTask(workspaceId: string, preset?: string) {
  const starts: [string | null, string | undefined][] = [];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(NewTaskDialog, {
        newTask: {
          ...control.newTask,
          open: true,
          preset: preset === undefined ? undefined : { repository: preset },
          workspaces: [PERSONAL, ACME],
          workspaceId,
          repositoriesIn: chooserFor,
          start: (_name, repository, startsIn) => {
            starts.push([repository, startsIn]);
            return Promise.resolve(undefined);
          },
        },
      }),
    ),
  );
  await settle();
  const repositoryChip = () =>
    document.querySelector<HTMLButtonElement>(".repository-chip .luke-chip") ??
    assert.fail("the repository chip stands");
  const create = async (words: string) => {
    const name = document.querySelector<HTMLInputElement>('input[aria-label="Task name"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, words);
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      each.textContent?.startsWith("Create task"),
    );
    act(() => button?.click());
    await settle();
  };
  return { starts, repositoryChip, create };
}

test("a repository group's + whose repository the workspace's GitHub does not reach opens New plan on none", async () => {
  const dialog = await openNewTask(PERSONAL.id, "ReviewStage/luke");

  const label = dialog.repositoryChip().textContent;
  await dialog.create("Tmp");

  assert.equal(label, "No repository");
  assert.deepEqual(dialog.starts, [[null, PERSONAL.id]]);
});

test("switching New plan to a workspace with no GitHub connected lets the other workspace's repository go and offers none of its own", async () => {
  const dialog = await openNewTask(ACME.id);
  const before = dialog.repositoryChip().textContent;

  const workspaceChip =
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Acme"]') ??
    assert.fail("the title's workspace is a chip");
  act(() => workspaceChip.click());
  act(() => optionNamed(document.body, "Personal").click());
  await settle();
  act(() => dialog.repositoryChip().click());
  await settle();
  const offered = [...document.querySelectorAll("button")].map((button) => button.textContent);
  const note = document.querySelector(".luke-combobox-note p")?.textContent;
  const after = dialog.repositoryChip().textContent;
  await dialog.create("Tmp");

  assert.deepEqual([before, after], ["acme-corp/relay", "No repository"]);
  assert.equal(offered.includes("acme-corp/relay"), false);
  assert.equal(note, "Personal has no GitHub connected yet.");
  assert.deepEqual(dialog.starts, [[null, PERSONAL.id]]);
});

test("New task's workspace and repository chips each open their own menu", async () => {
  await openNewTask(ACME.id);
  const chips = [
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Acme"]') ??
      assert.fail("the title's workspace is a chip"),
    document.querySelector<HTMLButtonElement>(".repository-chip .luke-chip") ??
      assert.fail("the repository chip stands"),
  ];

  const drawn = [];
  for (const chip of chips) {
    act(() => chip.click());
    await settle();
    const menu = document.querySelector('[role="dialog"][aria-label]');
    drawn.push(menu?.getAttribute("aria-label"));
    act(() => chip.click());
    await settle();
  }

  assert.deepEqual(drawn, ["Workspace", "Repository"]);
});

test("Tab from the workspace picker's open list moves on to the Plan switch beside the title, and Shift-Tab back to the chip", async () => {
  await openNewTask(ACME.id);
  const chip =
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Acme"]') ??
    assert.fail("the title's workspace is a chip");
  const tabFromList = async (shiftKey: boolean) => {
    act(() => chip.click());
    await settle();
    const list = document.activeElement ?? assert.fail("the open menu holds the keyboard");
    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
    });
    await settle();
    return document.activeElement?.getAttribute("aria-label");
  };

  const forward = await tabFromList(false);
  const backward = await tabFromList(true);

  assert.deepEqual([forward, backward], ["Plan with Luke", "Workspace: Acme"]);
});

test("a switch of workspace closes the Linear search, and the chip then lists the issues of the workspace chosen", async () => {
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
  act(() =>
    root.render(
      createElement(NewTaskDialog, {
        newTask: {
          ...control.newTask,
          open: true,
          workspaces: [PERSONAL, ACME],
          workspaceId: PERSONAL.id,
          repositoriesIn: chooserFor,
          linearIssuesIn: (workspaceId) =>
            workspaceId === undefined ? undefined : () => Promise.resolve(issuesOf(workspaceId)),
        },
      }),
    ),
  );
  await settle();
  const openLinear = async () => {
    const chip =
      document.querySelector<HTMLButtonElement>('[aria-label="Choose from Linear"]') ??
      assert.fail("the Linear chip stands");
    act(() => chip.click());
    await settle();
  };
  const listed = () =>
    [
      ...document.querySelectorAll('[role="dialog"][aria-label="Linear issues"] [role="option"]'),
    ].map((option) => option.textContent);
  await openLinear();
  const before = listed();

  const workspaceChip =
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Personal"]') ??
    assert.fail("the title's workspace is a chip");
  act(() => workspaceChip.click());
  await settle();
  const menu =
    document.querySelector('[role="dialog"][aria-label="Workspace"]') ??
    assert.fail("the chip opens its menu");
  act(() => optionNamed(menu, "Acme").click());
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
  const search = () => document.querySelector('[role="dialog"][aria-label="Linear issues"]');
  draw(true);
  await settle();
  const chip =
    document.querySelector<HTMLButtonElement>('[aria-label="Choose from Linear"]') ??
    assert.fail("the Linear chip stands");
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
