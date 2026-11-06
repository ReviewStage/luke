// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import type { TaskCreateRelation, TaskSummary } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdRepositoryLists, type RepositoriesRead } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import type { NewTaskStart } from "./use-tasks-tab.js";

/**
 * new-task-composer-relation.test.ts -- New task's relations on the card:
 * tasks picked from the + menu's Task relation are sent with the start
 * together, each as the kind standing at the search's foot, and a row's ×
 * drops its own; a task picked again changes its kind and a second Sub-task
 * of replaces the first; as Sub-task of, a task in another repository is
 * listed dimmed with why, and a pick holds the repository chip to the other
 * task's, the start naming no repository. Synthetic throughout.
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
const SIGNUP = task("1a2b3c4d-0000-4000-8000-000000000003", "Ship signup", 213, "acme/web");

/** The host's read of Acme's repositories, listing both on its App. */
const LISTING = (): Promise<RepositoriesRead> =>
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

/** The card in Acme on acme/web, each start's repository and relations written down. */
async function mount() {
  holdRepositoryLists(handHostReads({}).deliverRepositoryLists, LISTING);
  const control = tasksControl();
  const starts: {
    repository: string | null;
    relations: readonly TaskCreateRelation[] | undefined;
  }[] = [];
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
            tasks: [LOGIN, LIMIT, SIGNUP],
            repositoriesIn: () => ({ ...control.repositories, scope: ACME.id }),
            start: (
              _name: string,
              repository: string | null,
              _workspaceId: string | undefined,
              from?: NewTaskStart,
            ) => {
              starts.push({ repository, relations: from?.relations });
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

/** The open menu's row naming `words`: a menu item, a task, or a pinned row. */
function row(words: string): HTMLElement {
  return (
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="option"], [data-steered="true"]',
      ),
    ].find((each) => each.textContent?.startsWith(words)) ?? assert.fail(`no row ${words}`)
  );
}

/** Opens the card's + menu and its Task relation. */
async function openRelationSearch(container: HTMLElement): Promise<void> {
  const plus =
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files and more"]') ??
    assert.fail("the card's + stands");
  act(() => plus.click());
  await settle();
  act(() => row("Task relation").click());
  await settle();
}

/** Relates `name` from the + menu as `kind`, switched at the search's foot. */
async function relate(container: HTMLElement, kind: string, name: string): Promise<void> {
  await openRelationSearch(container);
  act(() => row("Relation").click());
  await settle();
  act(() => row(kind).click());
  await settle();
  act(() => row(name).click());
  await settle();
}

/** The rows docked over the card, each read as its sentence: kind, then name. */
function docked(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".new-task-relations-dock li")].map(
    (each) =>
      `${each.querySelector('[aria-label^="Relation: "]')?.textContent} ${each.querySelector(".ui-task-row-press span")?.textContent}`,
  );
}

test("tasks picked from the + menu are sent with the start together, and a row's × drops its own", async () => {
  const { container, starts } = await mount();

  await relate(container, "Blocks", "API rate limit");
  await relate(container, "Blocked by", "Ship signup");
  assert.deepEqual(docked(container), ["Blocks API rate limit", "Blocked by Ship signup"]);
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();
  const remove =
    container.querySelector<HTMLButtonElement>('button[aria-label="Remove relation"]') ??
    assert.fail("each row ends in its ×");
  act(() => remove.click());
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    {
      repository: "acme/web",
      relations: [
        { kind: "blocks", taskId: LIMIT.id },
        { kind: "blocked-by", taskId: SIGNUP.id },
      ],
    },
    { repository: "acme/web", relations: [{ kind: "blocked-by", taskId: SIGNUP.id }] },
  ]);
});

test("a task picked again changes its kind, and a second Sub-task of replaces the first", async () => {
  const { container, starts } = await mount();

  await relate(container, "Blocked by", "Ship login");
  await relate(container, "Sub-task of", "Ship login");
  await relate(container, "Sub-task of", "Ship signup");
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    { repository: null, relations: [{ kind: "sub-task-of", taskId: SIGNUP.id }] },
  ]);
});

test("as Sub-task of, a task in another repository says why and takes no pick, and a pick holds the repository to the other task's", async () => {
  const { container, starts } = await mount();

  await openRelationSearch(container);
  assert.match(row("API rate limit").textContent ?? "", /Another repository/u);
  act(() => row("API rate limit").click());
  await settle();
  act(() => row("Ship login").click());
  await settle();
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    { repository: null, relations: [{ kind: "sub-task-of", taskId: LOGIN.id }] },
  ]);
});

test("swapping the card's one tree relation takes a task of another repository, the start following it", async () => {
  const { container, starts } = await mount();

  await relate(container, "Sub-task of", "Ship login");
  const name =
    container.querySelector<HTMLElement>(".new-task-relations-dock .ui-task-row-press") ??
    assert.fail("the row's name stands");
  act(() => name.click());
  await settle();
  act(() => row("API rate limit").click());
  await settle();
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [
    { repository: null, relations: [{ kind: "sub-task-of", taskId: LIMIT.id }] },
  ]);
});
