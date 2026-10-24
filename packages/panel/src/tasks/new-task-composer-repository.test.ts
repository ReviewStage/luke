// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
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
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { MENTION_MENU_SIDE } from "./mention-picker.js";
import { NewTaskComposer } from "./new-task-composer.js";

/**
 * New task's repository chip in a workspace whose GitHub App is on another
 * owner: a repository the picker lists on a member's own GitHub token stays
 * picked once chosen, and a preset the workspace's GitHub does not reach is
 * not started on before the picker's read lands. Synthetic throughout.
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
const TOKEN_LISTING = (): Promise<TasksRepositoriesAnswer> =>
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

/** The card in Acme over `read`, opened on `preset`, each start's repository written down. */
async function mount(
  read: () => Promise<TasksRepositoriesAnswer>,
  preset?: string,
  scope: { id: string | undefined } = { id: ACME.id },
  recent: readonly string[] = [],
) {
  const control = tasksControl();
  const starts: (string | null)[] = [];
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
            repositoriesIn: () => ({ ...control.repositories, recent, scope: scope.id, read }),
            start: (_name: string, repository: string | null) => {
              starts.push(repository);
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
  return { container, starts, redraw };
}

test("a repository the picker lists on a member's token, on an owner the workspace's App is not on, stays picked", async () => {
  const { container } = await mount(TOKEN_LISTING);
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
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

test("a refresh that fails when the window comes back keeps the listed repositories, says Could not refresh with Retry, and Retry lists again", async () => {
  let failing = false;
  const { container } = await mount(() =>
    failing ? Promise.reject(new Error("offline")) : TOKEN_LISTING(),
  );
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");
  act(() => chip.click());
  await settle();
  const listed = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].some((option) =>
      option.textContent?.includes("tools"),
    );
  const refreshNote = () =>
    [...document.querySelectorAll('[role="alert"]')].find((each) =>
      each.textContent?.includes("Could not refresh"),
    );
  assert.equal(listed(), true);

  failing = true;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();

  assert.equal(listed(), true, "the last listing stands");
  const note = refreshNote();
  assert.ok(note, "the failed refresh says so");

  failing = false;
  const retry = [...note.querySelectorAll("button")].find((each) =>
    each.textContent?.includes("Retry"),
  );
  act(() => retry?.click());
  await settle();

  assert.equal(listed(), true);
  assert.equal(refreshNote(), undefined);
});

test("the repository chip hangs the repository's card while the pointer rests on it: its name, and its owner under it", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  restOn(
    container.querySelector(".luke-chip") ?? assert.fail("the card draws the repository chip"),
  );
  const card = document.querySelector("[data-repository-card]");

  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "tools");
  assert.equal(card?.querySelector(".luke-hover-card-sub")?.textContent, "octo");
});

test("a repository's row in the picker hangs the same card", async () => {
  const { container } = await mount(TOKEN_LISTING);
  act(() => container.querySelector<HTMLButtonElement>(".luke-chip")?.click());
  await settle();
  restOn(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.includes("tools"),
    ) ?? assert.fail("the picker lists the token repository"),
  );
  const card = document.querySelector("[data-repository-card]");

  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "tools");
  assert.equal(card?.querySelector(".luke-hover-card-sub")?.textContent, "octo");
});

test("a preset on a token repository the picker lists stands chosen once the read lands", async () => {
  const { container } = await mount(TOKEN_LISTING, "octo/tools");
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
});

test("a preset the workspace's GitHub does not reach is not started on while the picker's read is out", async () => {
  const { container, starts } = await mount(() => new Promise(() => undefined), "alice/private");
  // ⌘Return on the empty box: a bare task, which starts on no repository as on one.
  pressInComposer(container, "Enter", { metaKey: true });
  await settle();

  assert.deepEqual(starts, [null]);
});

test("a preset a read does not list is let go, so a later read listing it does not bring it back", async () => {
  let reads = 0;
  const { container } = await mount(() => {
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
  act(() => window.dispatchEvent(new Event("focus")));
  await settle();
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(reads, 2);
  assert.equal(chip.textContent?.includes("octo/tools"), false, chip.textContent ?? "");
});

test("a preset survives a read made before the workspace resolved and stands once its workspace's read lists it", async () => {
  const scope: { id: string | undefined } = { id: undefined };
  const { container, redraw } = await mount(
    () =>
      scope.id === undefined
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
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(chip.textContent?.includes("octo/tools"), true, chip.textContent ?? "");
});

test("a recent default a read does not list is let go, so a later read listing it does not bring it back", async () => {
  let reads = 0;
  const { container } = await mount(
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
  act(() => window.dispatchEvent(new Event("focus")));
  await settle();
  const chip =
    container.querySelector<HTMLButtonElement>(".luke-chip") ??
    assert.fail("the card draws the repository chip");

  assert.equal(reads, 2);
  assert.equal(chip.textContent?.includes("octo/tools"), false, chip.textContent ?? "");
});
