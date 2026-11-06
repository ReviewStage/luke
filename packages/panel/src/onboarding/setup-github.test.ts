// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_ACCESS,
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
 * reaches its repository on a member's token: the token's card stands
 * checked. And the token's picker, which adds several repositories in one
 * open menu. Synthetic throughout.
 */

const WORKSPACE = "workspace-acme";

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

test("a workspace reached on the token draws the token's card checked", async () => {
  holdRepositoryLists(handHostReads({}).deliverRepositoryLists, () => ({
    repositories: {
      installed: false,
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
  }));
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

  assert.equal(
    checked.textContent?.includes("Personal access token"),
    true,
    checked.textContent ?? "",
  );
});

/** A repository as the workspace's listing answers it, on the token. */
function onToken(fullName: string, updatedAt: number): GitHubRepository {
  const [owner = "", name = ""] = fullName.split("/");
  return {
    owner,
    name,
    fullName,
    defaultBranch: "main",
    private: true,
    updatedAt,
    access: GITHUB_ACCESS.TOKEN,
  };
}

test("the token's picker adds several repositories in one open menu, checking each, and keeps standing once the workspace reaches them, its chip naming them", async () => {
  const reach = [onToken("octo/tools", 2), onToken("octo/notes", 1)];
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
  holdGitHubToken(() => ({
    rows: {
      token: {
        login: "octo",
        hint: "ghp_…wxyz",
        status: GITHUB_TOKEN_STATUS.VERIFIED,
        statusAt: 1,
        addedAt: 1,
        expiresAt: null,
      },
    },
  }));
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: ({ repository }) => {
      added = [
        { fullName: repository, addedBy: "user-octo", addedAt: 2, removable: true },
        ...added,
      ];
      reads.deliverTokenRepositories({ [WORKSPACE]: { rows: added } });
      return Promise.resolve(added);
    },
  });
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
  assert.equal(chip().textContent, "tools, notes");
});
