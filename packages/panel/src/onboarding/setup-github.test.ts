// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  type GitHubRepository,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import { ACT_KIND } from "@repo/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeActPortCalls, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdGitHubToken, holdRepositoryLists } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * Setup's GitHub step drawn again, as Back draws it, over a workspace that
 * reaches its repositories through a route: that route's card stands
 * checked, the App's naming the owners reached. And the token's picker, which adds several repositories in one
 * open menu. Synthetic throughout.
 */

const WORKSPACE = "workspace-acme";

/** The reader's saved GitHub token, as the host holds it. */
const TOKEN = {
  login: "octo",
  hint: "ghp_…wxyz",
  status: GITHUB_TOKEN_STATUS.VERIFIED,
  statusAt: 1,
  addedAt: 1,
  expiresAt: null,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test.each([
  { access: GITHUB_ACCESS.TOKEN, card: "Personal access token", says: "Add repositories" },
  {
    access: GITHUB_ACCESS.APP,
    card: "GitHub App",
    says: "2 repositories on octo and acme through the GitHub App",
  },
])(
  "a workspace reached through $access draws that route's card checked, saying $says",
  async ({ access, card, says }) => {
    holdRepositoryLists(handHostReads({}).deliverRepositoryLists, () => ({
      repositories: {
        installed: access === GITHUB_ACCESS.APP,
        repositories: [reached("octo/tools", 2, access), reached("acme/web", 1, access)],
        installationUrl: "https://github.com/apps/luke/installations/new",
      },
    }));
    holdGitHubToken(() => ({ rows: { token: TOKEN } }));
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(GitHubSetup, { workspaceId: WORKSPACE, onReached: () => undefined }),
        ),
      ),
    );
    await settle();
    const checked =
      container.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      assert.fail("the step checks a route");

    assert.equal(checked.textContent?.includes(card), true, checked.textContent ?? "");
    assert.equal(container.textContent?.includes(says), true, container.textContent ?? "");
  },
);

/** A repository as the workspace's listing answers it, reached through `access`. */
function reached(fullName: string, updatedAt: number, access: GitHubAccess): GitHubRepository {
  const [owner = "", name = ""] = fullName.split("/");
  return { owner, name, fullName, defaultBranch: "main", private: true, updatedAt, access };
}

test("the token's picker adds several repositories in one open menu, checking each, and keeps standing once the workspace reaches them, its chip naming them, and taking them all back after Back keeps the token's card", async () => {
  const reach = [
    reached("octo/tools", 2, GITHUB_ACCESS.TOKEN),
    reached("octo/notes", 1, GITHUB_ACCESS.TOKEN),
  ];
  let added: WorkspaceTokenRepository[] = [];
  const reads = handHostReads({ tokenRepositories: { [WORKSPACE]: { rows: [] } } });
  const lists = holdRepositoryLists(reads.deliverRepositoryLists, () => ({
    repositories: {
      installed: false,
      repositories: reach.filter((one) => added.some((each) => each.fullName === one.fullName)),
      addable: reach.filter((one) => !added.some((each) => each.fullName === one.fullName)),
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  }));
  holdGitHubToken(() => ({ rows: { token: TOKEN } }));
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: ({ repository, added: adding }) => {
      added = adding
        ? [{ fullName: repository, addedBy: "user-octo", addedAt: 2, removable: true }, ...added]
        : added.filter((one) => one.fullName !== repository);
      reads.deliverTokenRepositories({ [WORKSPACE]: { rows: added } });
      return Promise.resolve(added);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const draw = () => {
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(GitHubSetup, { workspaceId: WORKSPACE, onReached: () => undefined }),
        ),
      ),
    );
    return root;
  };
  const first = draw();
  await settle();
  const radio = (words: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((one) =>
      one.textContent?.includes(words),
    ) ?? assert.fail(`the step offers ${words}`);
  act(() => radio("Personal access token").click());
  await settle();
  const chip = () =>
    container.querySelector<HTMLButtonElement>(".ui-chip") ??
    assert.fail("the token's card draws its chip");
  act(() => chip().click());
  await settle();
  const option = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((one) =>
      one.textContent?.includes(name),
    ) ?? assert.fail(`the menu lists ${name}`);
  act(() => option("tools").click());
  await settle();
  act(() => option("notes").click());
  await settle();
  await act(() => lists.again());
  await settle();

  assert.deepEqual(
    ["tools", "notes"].map((name) => option(name).getAttribute("aria-current")),
    ["true", "true"],
  );
  const named = chip().textContent;
  // Back draws the step again, which forgets the card last pressed.
  act(() => first.unmount());
  draw();
  // The host hands a window opened again the token repositories as they stand now.
  act(() => reads.deliverTokenRepositories({ [WORKSPACE]: { rows: added } }));
  await settle();
  act(() => chip().click());
  await settle();
  act(() => option("tools").click());
  await settle();
  act(() => option("notes").click());
  await settle();
  await act(() => lists.again());
  await settle();

  assert.equal(named, "tools, notes");
  assert.equal(radio("Personal access token").getAttribute("aria-checked"), "true");
  assert.equal(chip().textContent, "Add repositories");
});
