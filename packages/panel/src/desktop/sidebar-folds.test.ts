// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { ArchivedAgents } from "./agent-archive.js";

/**
 * sidebar-folds.test.ts -- every group that folds folds under one
 * header, `GroupHeader`: the sidebar's Pinned and repositories, and the summary's archived
 * agents, alike but for what each counts, each unrolling as it opens, and a
 * folded group leaving the task open standing.
 */

const roots: Root[] = [];

beforeEach(() => {
  window.localStorage.clear();
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** The fold whose words start with `name`. */
function fold(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (button) => button.textContent?.startsWith(name),
  );
  assert.ok(found, `a fold named ${name} is drawn`);
  return found;
}

test("the summary's archived agents fold under a group header that counts them folded and lists them unfolded", () => {
  const agent = {
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1,
    status: CODING_AGENT_STATUS.CANCELLED,
    turnId: null,
    archivedAt: 2,
  } as const;
  const summary = mount(
    createElement(ArchivedAgents, {
      agents: codingAgentsControl({
        archived: [
          { ...agent, id: "agent-1", title: "Retry audit" },
          { ...agent, id: "agent-2", title: "Spike" },
        ],
      }),
      shown: true,
    }),
  );

  assert.equal(fold(summary, "Archived").getAttribute("aria-expanded"), "false");
  assert.equal(fold(summary, "Archived").textContent, "Archived2 archived agents");
  act(() => fold(summary, "Archived").click());
  assert.equal(fold(summary, "Archived").getAttribute("aria-expanded"), "true");
  assert.ok(summary.querySelector('[aria-label="Archived agents"]'), "the agents are listed");
});
