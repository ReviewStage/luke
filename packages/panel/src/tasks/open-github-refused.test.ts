// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { appPlatform } from "../app-platform.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { BranchChip, type PublishedDoors } from "./agent-published.js";

/**
 * open-github-refused.test.ts -- a person who presses a branch's "Open on
 * GitHub" chip is told in a toast when the host refuses the open, in the
 * host's own words, rather than the press doing nothing. Synthetic repository.
 */

const BRANCH_ONLY = {
  repository: "acme/relay",
  branch: "luke/expiry-job",
  pullRequest: null,
};

const REFUSAL = "That address is not one Luke opens.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The branch's chip over the doors the desktop's window hands it, beside the window's toasts. */
async function mountChip(): Promise<HTMLAnchorElement> {
  fakeAppPlatform(DESKTOP_LINKS);
  const doors: PublishedDoors = {
    openGitHub: (url) => appPlatform().openGitHub(url),
    copy: () => undefined,
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        onRegistry(
          AtomRegistry.make(),
          createElement(BranchChip, { published: BRANCH_ONLY, doors }),
        ),
        onRegistry(rendererRegistry, createElement(ToastHost)),
      ),
    ),
  );
  return container.querySelector("a") ?? assert.fail("the branch's chip stands as a link");
}

/** What each toast standing says, oldest first. */
function toasts(): string[] {
  return [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
    (words) => words.textContent ?? "",
  );
}

test("a refused Open on GitHub raises a toast saying why", async () => {
  fakeActPort({ [ACT_KIND.GITHUB_OPEN]: () => Promise.reject(refusedOnPort(REFUSAL)) });
  const chip = await mountChip();

  await act(async () => chip.click());

  assert.ok(toasts().includes(REFUSAL), `toasts stood: ${toasts().join(" | ")}`);
});

test("an Open on GitHub the host takes raises no toast", async () => {
  const opened: string[] = [];
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      opened.push(url);
      return Promise.resolve();
    },
  });
  const chip = await mountChip();
  // The window's toast registry outlives a test, so a toast a test before left standing is not this press's.
  const before = toasts();

  await act(async () => chip.click());

  assert.deepEqual(opened, ["https://github.com/acme/relay/compare/luke/expiry-job?expand=1"]);
  assert.deepEqual(toasts(), before);
});
