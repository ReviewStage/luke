// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handHostReads, holdRepositoryLists } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { GitHubSetup } from "./setup-github.js";

/**
 * Setup's GitHub step drawn again, as Back draws it, over a workspace that
 * reaches its repository on a member's token: the token's card stands
 * checked with the done line naming the repository's owner and the token. Synthetic throughout.
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

test("a workspace reached on the token draws the token's card checked, its done line naming the owner and the token", async () => {
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
  assert.equal(
    container.textContent?.includes("1 repository on octo through your token"),
    true,
    container.textContent ?? "",
  );
});
