// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { AgentPullRequestTab } from "./agent-pull-request-tab.js";
import { PULL_REQUEST_VIEW } from "./use-side-panel.js";

/**
 * agent-chapters-chunk-failure.test.ts -- an agent's Pull request tab whose Chapters chunk fails to import says so in Chapters' place, with a way to try again, and keeps its other views.
 */

// Note that a chunk whose fetch failed rejects its import as the browser does.
vi.mock("./agent-chapters-tab.js", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(DESKTOP_LINKS);
  fakeActPort({});
  // Note that React says the failure its boundary caught on the console, as it would in the window.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

test("a Chapters chunk that fails to import stands its own error with a way to try again, the tab's other views still standing", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tab = createElement(AgentPullRequestTab, {
    agentId: AGENT.id,
    control: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id], models: [] }),
    shown: true,
    repository: "acme/relay",
    tree: { open: false, onToggle: () => undefined },
    view: PULL_REQUEST_VIEW.CHAPTERS,
    onView: () => undefined,
  });
  act(() => root?.render(onRegistry(AtomRegistry.make(), tab)));
  await act(async () => {
    for (let tick = 0; tick < 16; tick += 1) await Promise.resolve();
  });

  const panel = container.querySelector('[role="tabpanel"]:not([hidden])');
  assert.ok(panel?.querySelector('[role="alert"]'), "Chapters says it could not be shown");
  assert.ok(
    [...(panel?.querySelectorAll("button") ?? [])].some((button) =>
      /Retry|Reload/u.test(button.textContent ?? ""),
    ),
    "and offers a way to try again",
  );
  assert.ok(container.querySelector('[role="tab"]'), "the tab's views stand");
});
