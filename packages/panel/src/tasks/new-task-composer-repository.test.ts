// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { TASK_CREATE_RELATION_KIND } from "@repo/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdRepositoryLists, type RepositoriesRead } from "../testing/app-state.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";
import type { NewTaskRelation } from "./new-task-relation.js";

/**
 * New task's repository chip in a workspace whose GitHub App is on another
 * owner: a repository the picker lists on a member's own GitHub token stays
 * picked once chosen, and a preset the workspace's GitHub does not reach is
 * not started on before the picker's read lands. The first pick replaces
 * the repository the card chose, one checked after it travels beside the
 * task's with the agent the card starts, and unchecking the task's own makes
 * the next pick the task's; a sub-task's card holds its parent's first. Synthetic throughout.
 */

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
  memberCount: 2,
};

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

/** A read listing `octo/tools` on a member's token. */
const TOKEN_LISTING = (): Promise<RepositoriesRead> =>
  Promise.resolve({
    repositories: {
      installed: true,
      repositories: [
        {
          owner: "octo",
          name: "tools",
          fullName: "octo/tools",
          defaultBranch: "main",
          private: true,
          updatedAt: 1,
          access: GITHUB_ACCESS.TOKEN,
        },
      ],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  });

/** The card in Acme over the repositories `read` answers each list the host holds, by its key, opened on `preset`, each start's repository written down. */
async function mount(
  read: (workspace: string) => Promise<RepositoriesRead>,
  preset?: string,
  scope: { id: string | undefined } = { id: ACME.id },
  recent: readonly string[] = [],
  relation?: NewTaskRelation,
) {
  const { again } = holdRepositoryLists(handHostReads({}).deliverRepositoryLists, read);
  const control = tasksControl();
  const starts: (string | null)[] = [];
  const also: (readonly string[] | undefined)[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = () =>
    root.render(
      onRegistry(
        registry,
        createElement(NewTaskComposer, {
          newTask: {
            ...control.newTask,
            workspaces: [ACME],
            workspaceId: scope.id,
            ...(preset === undefined && relation === undefined
              ? undefined
              : {
                  preset: {
                    ...(preset === undefined ? undefined : { repository: preset }),
                    ...(relation === undefined ? undefined : { relation }),
                  },
                }),
            repositoriesIn: () => ({ ...control.repositories, recent, scope: scope.id }),
            start: (_name: string, repository: string | null, _workspace, from) => {
              starts.push(repository);
              also.push(from?.handed?.alsoRepositories);
              return Promise.resolve(undefined);
            },
          },
          workspaceId: scope.id,
          onLeave: () => undefined,
          listSide: MENTION_MENU_SIDE.ABOVE,
        }),
      ),
    );
  act(draw);
  await settle();
  /** Draws the card again, as the workspaces resolving does. */
  const redraw = async () => {
    act(draw);
    await settle();
  };
  /** The host asking every list held again, as a window coming forward asks it. */
  const comeForward = async () => {
    await act(again);
    await settle();
  };
  return { container, starts, also, redraw, comeForward };
}

test("with no recent task, the chip stands on the first repository the read lists", async () => {
  const { container } = await mount(TOKEN_LISTING);
  // Note that the chip stands on the repository once the read that lists it reaches its query.
  await vi.waitFor(() => {
    const chip =
      container.querySelector<HTMLButtonElement>(".ui-chip") ??
      assert.fail("the card draws the repository chip");
    assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
  });
});

test("a repository the picker lists on a member's token, on an owner the workspace's App is not on, stays picked", async () => {
  const { container } = await mount(TOKEN_LISTING);
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");
  act(() => chip.click());
  await settle();
  act(() => row("tools").click());
  await settle();

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
});

test("the repository chip hangs the repository's card while the pointer rests on it: its name, and its owner under it", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  const chip = await vi.waitFor(() => {
    const drawn =
      container.querySelector(".ui-chip") ?? assert.fail("the card draws the repository chip");
    assert.equal(drawn.textContent?.includes("octo/tools"), true);
    return drawn;
  });
  restOn(chip);
  const card = document.querySelector("[data-repository-card]");

  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "tools");
  assert.equal(card?.querySelector(".ui-hover-card-sub")?.textContent, "octo");
});

test("a preset on a token repository the picker lists stands chosen once the read lands", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  // Note that the chip stands on the repository once the read that lists it reaches its query.
  await vi.waitFor(() => {
    const chip =
      container.querySelector<HTMLButtonElement>(".ui-chip") ??
      assert.fail("the card draws the repository chip");
    assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
  });
});

test("a preset the workspace's GitHub does not reach is not started on while the host's read is out", async () => {
  const { container, starts } = await mount(() => new Promise(() => undefined), "alice/private");
  // ⌘Return on the empty box: a bare task, which starts on no repository as on one.
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [null]);
});

test("a preset a read does not list is let go, so a later read listing it does not bring it back", async () => {
  let reads = 0;
  const { container, comeForward } = await mount(() => {
    reads += 1;
    return reads === 1
      ? Promise.resolve({
          repositories: {
            installed: true,
            repositories: [],
            installationUrl: "https://github.com/apps/luke/installations/new",
          },
        })
      : TOKEN_LISTING();
  }, "octo/tools");
  await comeForward();
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(reads, 2);
  assert.equal(chip.textContent?.includes("octo/tools"), false, chip.textContent ?? "");
});

test("a preset survives a read made before the workspace resolved and stands once its workspace's read lists it", async () => {
  const scope: { id: string | undefined } = { id: undefined };
  const { container, redraw } = await mount(
    (workspace) =>
      workspace === EVERY_WORKSPACE
        ? Promise.resolve({
            repositories: {
              installed: true,
              repositories: [],
              installationUrl: "https://github.com/apps/luke/installations/new",
            },
          })
        : TOKEN_LISTING(),
    "octo/tools",
    scope,
  );
  scope.id = ACME.id;
  await redraw();
  // Note that the chip stands on the repository once the read that lists it reaches its query.
  await vi.waitFor(() => {
    const chip =
      container.querySelector<HTMLButtonElement>(".ui-chip") ??
      assert.fail("the card draws the repository chip");
    assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
  });
});

test("a recent default a read does not list is let go, so a later read listing it does not bring it back", async () => {
  let reads = 0;
  const { container, comeForward } = await mount(
    () => {
      reads += 1;
      return reads === 1
        ? Promise.resolve({
            repositories: {
              installed: true,
              repositories: [],
              installationUrl: "https://github.com/apps/luke/installations/new",
            },
          })
        : TOKEN_LISTING();
    },
    undefined,
    { id: ACME.id },
    ["octo/tools"],
  );
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");
  // Note that the first read, which lists nothing, reaches the chip before the window comes forward.
  await vi.waitFor(() => assert.equal(chip.textContent, "No repository"));
  await comeForward();

  assert.equal(reads, 2);
  assert.equal(chip.textContent?.includes("octo/tools"), false, chip.textContent ?? "");
});

/** A read listing three repositories the workspace's App reaches, and one reached only on a member's token. */
const SEVERAL_LISTING = (): Promise<RepositoriesRead> =>
  Promise.resolve({
    repositories: {
      installed: true,
      repositories: [
        ...["api", "web", "docs"].map((name) => ({
          owner: "acme",
          name,
          fullName: `acme/${name}`,
          defaultBranch: "main",
          private: true,
          updatedAt: 1,
          access: GITHUB_ACCESS.APP,
        })),
        {
          owner: "octo",
          name: "tools",
          fullName: "octo/tools",
          defaultBranch: "main",
          private: true,
          updatedAt: 1,
          access: GITHUB_ACCESS.TOKEN,
        },
      ],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  });

/** The chip's menu's row naming `name`, where it lists one. */
function row(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes(name),
    ) ?? assert.fail(`the menu lists ${name}`)
  );
}

test("the first pick replaces the repository the card chose, later ones check beside it with the menu standing open and a row the service would refuse dimmed, and unchecking the primary makes the next pick the task's", async () => {
  const { container, starts, also } = await mount(SEVERAL_LISTING, "acme/api");
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");
  act(() => chip.click());
  await settle();
  act(() => row("web").click());
  await settle();
  act(() => row("api").click());
  await settle();

  assert.deepEqual(
    ["web", "api"].map((name) => row(name).getAttribute("aria-current")),
    ["true", "true"],
  );
  assert.equal(row("web").textContent?.includes("Primary"), true);
  assert.equal(row("tools").getAttribute("aria-disabled"), "true");
  assert.equal(row("tools").textContent?.includes("Token only"), true);
  assert.equal(chip.textContent, "web, api");
  act(() => row("docs").click());
  await settle();
  act(() => row("web").click());
  await settle();
  typeInComposer(container, "Bump the client in both");
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(starts, ["acme/api"]);
  assert.deepEqual(also, [["acme/docs"]]);
});

test("a sub-task's card holds its parent's repository first and checks another beside it, which travels with the agent the card starts", async () => {
  const parent = {
    id: "1a2b3c4d-0000-4000-8000-000000000001",
    workspaceId: ACME.id,
    name: "Ship login",
    number: 7,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/api",
  };
  const { container, starts, also } = await mount(SEVERAL_LISTING, undefined, { id: ACME.id }, [], {
    kind: TASK_CREATE_RELATION_KIND.SUB_TASK_OF,
    task: parent,
  });
  act(() => container.querySelector<HTMLButtonElement>(".ui-chip")?.click());
  await settle();
  act(() => row("web").click());
  await settle();

  assert.equal(row("api").getAttribute("aria-disabled"), "true");
  assert.deepEqual(
    ["api", "web"].map((name) => row(name).getAttribute("aria-current")),
    ["true", "true"],
  );
  typeInComposer(container, "Bump the client in both");
  pressInComposer(container, "Enter");
  await settle();

  // Note that a tree's start names no repository, since the service gives it the parent's.
  assert.deepEqual(starts, [null]);
  assert.deepEqual(also, [["acme/web"]]);
});
