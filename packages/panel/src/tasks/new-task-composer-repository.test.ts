// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { EVERY_WORKSPACE } from "@repo/host/app-state";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  handHostReads,
  handState,
  holdRepositoryLists,
  type RepositoriesRead,
} from "../testing/app-state.js";
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

/**
 * New task's repository chip in a workspace whose GitHub App is on another
 * owner: a repository the picker lists on a member's own GitHub token stays
 * picked once chosen, and a preset the workspace's GitHub does not reach is
 * not started on before the picker's read lands. With Several repositories
 * on, a repository added beside the task's travels with the agent the card
 * starts; with it off, none is offered. Synthetic throughout.
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
            ...(preset === undefined ? undefined : { preset: { repository: preset } }),
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

test("a repository the picker lists on a member's token, on an owner the workspace's App is not on, stays picked", async () => {
  const { container } = await mount(TOKEN_LISTING);
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");
  act(() => chip.click());
  await settle();
  const row =
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("tools"),
    ) ?? assert.fail("the picker lists the token repository");
  act(() => row.click());
  await settle();

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
});

test("the repository chip hangs the repository's card while the pointer rests on it: its name, and its owner under it", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  restOn(container.querySelector(".ui-chip") ?? assert.fail("the card draws the repository chip"));
  const card = document.querySelector("[data-repository-card]");

  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "tools");
  assert.equal(card?.querySelector(".ui-hover-card-sub")?.textContent, "octo");
});

test("a repository's row in the picker hangs the same card", async () => {
  const { container } = await mount(TOKEN_LISTING);
  act(() => container.querySelector<HTMLButtonElement>(".ui-chip")?.click());
  await settle();
  restOn(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("tools"),
    ) ?? assert.fail("the picker lists the token repository"),
  );
  const card = document.querySelector("[data-repository-card]");

  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "tools");
  assert.equal(card?.querySelector(".ui-hover-card-sub")?.textContent, "octo");
});

test("a preset on a token repository the picker lists stands chosen once the read lands", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
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
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
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
  await comeForward();
  const chip =
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(reads, 2);
  assert.equal(chip.textContent?.includes("octo/tools"), false, chip.textContent ?? "");
});

/** A read listing two repositories the workspace's App reaches. */
const APP_LISTING = (): Promise<RepositoriesRead> =>
  Promise.resolve({
    repositories: {
      installed: true,
      repositories: ["api", "web"].map((name) => ({
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

/** The card's Add repository chip, where it draws one. */
function addRepositoryChip(container: ParentNode): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>(".ui-chip")].find((chip) =>
    chip.textContent?.includes("Add repository"),
  );
}

test("with Several repositories on, a repository added beside the task's travels with the agent the card starts", async () => {
  handState(experimentsOn(EXPERIMENT.SEVERAL_REPOSITORIES));
  const { container, starts, also } = await mount(APP_LISTING, "acme/api");
  const add = addRepositoryChip(container) ?? assert.fail("the card offers to add one");
  act(() => add.click());
  await settle();
  const offered = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  assert.deepEqual(
    offered.map((option) => option.textContent?.includes("acme/api")),
    [false],
    "the task's own repository is not offered again",
  );
  act(() => offered[0]?.click());
  await settle();
  typeInComposer(container, "Bump the client in both");
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(starts, ["acme/api"]);
  assert.deepEqual(also, [["acme/web"]]);
});

test("with Several repositories off, the card offers no repository beside the task's", async () => {
  handState(experimentsOn());
  const { container } = await mount(APP_LISTING, "acme/api");

  assert.equal(addRepositoryChip(container), undefined);
});
