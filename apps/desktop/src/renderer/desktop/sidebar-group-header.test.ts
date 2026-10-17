// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { sidebarProps } from "#testing/desktop-sidebar";
import { codingAgentsControl, tasksControl } from "#testing/tasks-control";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { ArchivedAgents } from "./agent-archive";
import { DesktopSidebar } from "./desktop-sidebar";

/**
 * sidebar-group-header.test.ts -- every group that folds folds under one
 * header: the sidebar's repositories and Archived, and the summary's
 * archived agents, alike but for what each counts.
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
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function task(id: string, name: string, repository: string | null): TaskSummary {
  return { id, workspaceId: "workspace-personal", name, createdAt: 1, updatedAt: 2, repository };
}

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** The sidebar on the Tasks tab, open, listing what `tasks` lists. */
function mountSidebar(tasks: TasksControl): HTMLElement {
  return mount(createElement(DesktopSidebar, sidebarProps(tasks)));
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

test("a repository's header folds on its name, says its pin, counts its plans folded, keeps its + outside the fold, and opens its menu on a right-click", () => {
  const asked: string[] = [];
  const sidebar = mountSidebar(
    tasksControl({
      tasks: [task("p-1", "Invite expiry", "acme/relay"), task("p-2", "Retry audit", "acme/relay")],
      pinnedRepositories: ["acme/relay"],
      onNewTaskIn: (repository) => asked.push(repository),
    }),
  );
  const relay = () => fold(sidebar, "relay");
  assert.equal(relay().getAttribute("aria-expanded"), "true");
  assert.equal(relay().textContent, "relay(pinned)");

  act(() => relay().click());
  assert.equal(relay().getAttribute("aria-expanded"), "false");
  assert.equal(relay().textContent, "relay(pinned)2 tasks");

  const plus = sidebar.querySelector<HTMLButtonElement>('button[aria-label="New task in relay"]');
  assert.ok(plus, "the header offers a new plan in its repository");
  act(() => plus.click());
  assert.deepEqual(asked, ["acme/relay"]);
  assert.equal(relay().getAttribute("aria-expanded"), "false", "the + folds nothing");

  act(() => {
    relay().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const menu = document.querySelector('[role="menu"][aria-label="relay actions"]');
  assert.ok(menu, "the right-click opens the repository's menu");
  assert.deepEqual(
    [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    ["Unpin", "Archive tasks", "Open on GitHub"],
  );
  const ellipsis = sidebar.querySelector('button[aria-label="Actions for relay"]');
  assert.equal(ellipsis?.getAttribute("aria-expanded"), "true");
});

test("the Inbox row counts what waits on a plan and what waits from an agent with no plan alike", () => {
  const page = mountSidebar(
    tasksControl({
      inbox: [
        {
          taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
          items: [{ id: "item-1", agentId: "agent-1", title: "Retry?", postedAt: 1 }],
        },
      ],
      inboxTaskless: [
        {
          id: "item-2",
          agentId: "agent-2",
          title: "Quarantine the flaky test?",
          postedAt: 2,
          agentTitle: null,
          agentModel: "anthropic/claude-opus-5.5",
          automationId: null,
          automationName: null,
          repository: "acme/relay",
        },
      ],
    }),
  );

  assert.equal(page.querySelector(".sidebar-inbox-waiting")?.firstChild?.textContent, "2");
});
