// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_TREE_ENTRY } from "@repo/features/task-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useQuery } from "@tanstack/react-query";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { forgetAccountReads } from "./query-keys.js";
import { taskTreeQueryOptions } from "./tasks/repository-reads.js";
import { fakeActPort, fakeAppBridge } from "./testing/app-bridge.js";
import { onRegistry, testQueryClientNow } from "./testing/copy-feedback.js";

/**
 * query-keys.test.ts -- a read taken as the account signed in but keyed by
 * no account is let go of once the account changes, so the next account is
 * never drawn what the last one read. Synthetic paths.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The task's tree root as the service answers it to whoever asks now: one file, by name. */
function listing(file: string) {
  return {
    folder: {
      path: "",
      repository: "acme/relay",
      branch: "main",
      entries: [{ name: file, kind: TASK_TREE_ENTRY.FILE }],
      truncated: false,
    },
  };
}

test("a task's tree one account read is not drawn to the next account once the window lets go of its account's reads", async () => {
  let reader = "one.ts";
  fakeAppBridge({});
  fakeActPort({ [ACT_KIND.TASKS_TREE]: () => Promise.resolve(listing(reader)) });
  function Tree() {
    const read = useQuery(taskTreeQueryOptions({ taskId: "task-1" }, ""));
    const entries = read.data === undefined ? [] : read.data.folder.entries;
    return createElement("p", null, entries.map((entry) => entry.name).join(","));
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Tree))));
  await vi.waitFor(() => assert.equal(container.textContent, "one.ts"));

  reader = "two.ts";
  await act(() => forgetAccountReads(testQueryClientNow()));

  // Note that the tree is drawn from what the next account is answered, never from the last account's listing held.
  await vi.waitFor(() => assert.equal(container.textContent, "two.ts"));
});
