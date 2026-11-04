// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdRepositoryLists, type RepositoriesRead } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { NewTaskDialog } from "./new-task-dialog.js";
import type { RepositoryChooser } from "./repository-chip.js";

/**
 * new-task-workspace.test.ts -- New task starts in the workspace listed and
 * offers no other: its head row's repository chip lists that workspace's
 * repositories, and the task starts there. Where the owner's workspace
 * changes under the composer, as Home's does, a repository of the other's
 * is let go. Each test starts a bare task, ⌘Return on
 * an empty box, which starts with or without a repository. Synthetic
 * throughout.
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
  fakeAppBridge({});
  holdRepositoryLists(handHostReads({}).deliverRepositoryLists, listOf);
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

/** What the service answers each workspace's repositories with: Acme's installation's, and none for Personal, which has no GitHub. */
function listOf(workspace: string): RepositoriesRead {
  const installationUrl = "https://github.com/apps/luke/installations/new";
  if (workspace !== ACME.id) {
    return { repositories: { installed: false, repositories: [], installationUrl } };
  }
  return {
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
      installationUrl,
    },
  };
}

/** The chooser each workspace's repository chip is handed, the host holding Acme's installation's repositories and Personal's none. */
function chooserFor(workspaceId: string | undefined): RepositoryChooser {
  const base = tasksControl().repositories;
  if (workspaceId !== ACME.id) {
    return { ...base, scope: workspaceId, workspaceName: PERSONAL.name };
  }
  return { ...base, recent: ["acme-corp/relay"], scope: ACME.id, workspaceName: ACME.name };
}

test("New task offers no workspace picker, and its head row's repository chip lists the listed workspace's repositories, where the plan starts", async () => {
  const dialog = await openNewTask(ACME.id);
  const head = document.querySelector(".new-task-head");

  assert.equal(document.querySelector('[aria-label^="Workspace"]'), null);
  assert.ok(head?.contains(dialog.repositoryChip()), "the repository chip stands in the head row");
  act(() => dialog.repositoryChip().click());
  await settle();
  const listed = [...document.querySelectorAll('[role="option"]')].map((row) =>
    [".ui-combobox-option-detail", ".ui-combobox-option-label"]
      .map((part) => row.querySelector(part)?.textContent)
      .join("/"),
  );
  act(() => dialog.repositoryChip().click());
  await settle();
  await dialog.create();

  assert.deepEqual(listed, ["acme-corp/relay"]);
  assert.deepEqual(dialog.starts, [["acme-corp/relay", ACME.id]]);
});

/** New task open over the two workspaces, starting in `workspaceId` until `rehome` lists another, each start's repository and workspace written down. */
async function openNewTask(workspaceId: string, preset?: string) {
  const starts: [string | null, string | undefined][] = [];
  const control = tasksControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  // The window's document is read on a registry of this test's own, so what the host lays reaches it.
  const registry = AtomRegistry.make();
  const draw = (listed: string) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
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
      ),
    );
  draw(workspaceId);
  await settle();
  const repositoryChip = () =>
    document.querySelector<HTMLButtonElement>(".repository-chip .ui-chip") ??
    assert.fail("the repository chip stands");
  // ⌘Return on the empty box: a bare task, which starts on no repository as on one.
  const create = async () => {
    pressInComposer(document, "Enter", { metaKey: true });
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
  const note = document.querySelector(".ui-combobox-note p")?.textContent;
  const after = dialog.repositoryChip().textContent;
  await dialog.create();

  assert.deepEqual([before, after], ["acme-corp/relay", "No repository"]);
  assert.equal(offered.includes("acme-corp/relay"), false);
  assert.equal(note, "Personal has no GitHub connected yet.");
  assert.deepEqual(dialog.starts, [[null, PERSONAL.id]]);
});
