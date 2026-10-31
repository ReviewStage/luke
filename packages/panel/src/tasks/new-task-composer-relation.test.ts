// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import type { TaskCreateRelation, TaskSummary } from "@luke/features/task-wire";
import type { TasksRepositoriesAnswer } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import type { NewTaskStart } from "./use-tasks-tab.js";

/**
 * new-task-composer-relation.test.ts -- New task's Relation pill on the card:
 * a task picked on it is sent with the start as the kind chosen, and its ×
 * drops it; as Sub-task of, a task in another repository is listed dimmed
 * with why, and a pick holds the repository chip to the other task's, the
 * start naming no repository. Synthetic throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

/** A task of Acme by id, name, number, and repository. */
function task(id: string, name: string, number: number, repository: string): TaskSummary {
  return { id, workspaceId: ACME.id, name, number, createdAt: 1, updatedAt: 1, repository };
}

const LOGIN = task("1a2b3c4d-0000-4000-8000-000000000001", "Ship login", 212, "acme/web");
const LIMIT = task("1a2b3c4d-0000-4000-8000-000000000002", "API rate limit", 7, "acme/api");

/** A read listing both of Acme's repositories on its App. */
const LISTING = (): Promise<TasksRepositoriesAnswer> =>
  Promise.resolve({
    repositories: {
      installed: true,
      repositories: ["web", "api"].map((name) => ({
        owner: "acme",
        name,
        fullName: `acme/${name}`,
        defaultBranch: "main",
        private: true,
        updatedAt: 1,
        access: GITHUB_ACCESS.APP,
      })),
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  });

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The card in Acme on acme/web, each start's repository and relation written down. */
async function mount() {
  const control = tasksControl();
  const starts: { repository: string | null; relation: TaskCreateRelation | undefined }[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  act(() =>
    root.render(
      onRegistry(
        registry,
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaces: [ACME],
            workspaceId: ACME.id,
            preset: { repository: "acme/web" },
            tasks: [LOGIN, LIMIT],
            repositoriesIn: () => ({ ...control.repositories, scope: ACME.id, read: LISTING }),
            start: (
              _name: string,
              repository: string | null,
              _workspaceId: string | undefined,
              from?: NewTaskStart,
            ) => {
              starts.push({ repository, relation: from?.relation });
              return Promise.resolve(undefined);
            },
          },
          workspaceId: ACME.id,
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
        }),
      ),
    ),
  );
  await settle();
  return { container, starts };
}

/** The head row's chip whose words hold `words`. */
function chip(container: HTMLElement, words: string): HTMLElement {
  return (
    [...container.querySelectorAll<HTMLElement>(".luke-chip")].find((each) =>
      each.textContent?.includes(words),
    ) ?? assert.fail(`no chip reading ${words}`)
  );
}

/** The menu's row naming `words`, a task or a pinned row. */
function row(words: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"], [data-steered="true"]')].find(
      (each) => each.textContent?.startsWith(words),
    ) ?? assert.fail(`no row ${words}`)
  );
}

/** Switches the open menu's kind to `kind` through its pinned Relation row. */
async function switchKind(kind: string): Promise<void> {
  act(() => row("Relation").click());
  await settle();
  act(() => row(kind).click());
  await settle();
}

test("a task picked on the Relation pill is sent with the start as the kind chosen, and its × drops it", async () => {
  const { container, starts } = await mount();

  act(() => chip(container, "Relation").click());
  await settle();
  await switchKind("Blocks");
  act(() => row("API rate limit").click());
  await settle();
  assert.match(chip(container, "Blocks").textContent ?? "", /Blocks ACME-7/u);
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();
  const remove =
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove relation"]') ??
    assert.fail("the filled pill ends in its ×");
  act(() => remove.click());
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    { repository: "acme/web", relation: { kind: "blocks", taskId: LIMIT.id } },
    { repository: "acme/web", relation: undefined },
  ]);
});

test("as Sub-task of, a task in another repository says why and takes no pick, and a pick holds the repository to the other task's", async () => {
  const { container, starts } = await mount();

  act(() => chip(container, "Relation").click());
  await settle();
  assert.match(row("API rate limit").textContent ?? "", /Another repository/u);
  act(() => row("API rate limit").click());
  await settle();
  act(() => row("Ship login").click());
  await settle();
  assert.equal(chip(container, "acme/web").getAttribute("aria-disabled"), "true");
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    { repository: null, relation: { kind: "sub-task-of", taskId: LOGIN.id } },
  ]);
});
