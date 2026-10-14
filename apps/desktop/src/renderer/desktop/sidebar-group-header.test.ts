// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { UPDATE_STATUS } from "#shared/messages/update";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { PANEL_TAB } from "../panel-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import { ArchivedAgents } from "./agent-archive";
import { DesktopSidebar } from "./desktop-sidebar";

/**
 * sidebar-group-header.test.ts -- every group that folds folds under one
 * header: the sidebar's repositories and Archived, and the summary's
 * archived agents, alike but for what each counts.
 */

const ignore = () => undefined;

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
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function plan(id: string, name: string, repository: string | null): PlanSummary {
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

/** The sidebar on the Plans tab, open, listing what `plans` lists. */
function mountSidebar(plans: PlansControl): HTMLElement {
  return mount(
    createElement(DesktopSidebar, {
      sidebar: { collapsed: false, width: 264, onToggle: ignore, onResize: ignore, staged: false },
      history: { canGoBack: false, canGoForward: false, onBack: ignore, onForward: ignore },
      plans,
      tab: PANEL_TAB.PLANS,
      onTabChange: ignore,
      account: {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "dev@example.com",
        name: "Dev",
        provider: "github",
      },
      updates: {
        update: {
          status: UPDATE_STATUS.IDLE,
          currentVersion: "1.0.0",
          installSupported: true,
          upToDate: true,
        },
        build: { packaged: false },
        onCheck: () => Promise.resolve(),
        onInstall: ignore,
        onOpenLatest: ignore,
      },
      onSignOut: () => Promise.resolve(),
      call: undefined,
    }),
  );
}

/** The fold whose words start with `name`. */
function fold(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (button) => button.textContent?.startsWith(name),
  );
  assert.ok(found, `a fold named ${name} is drawn`);
  return found;
}

/** The row a fold heads, its fold and whatever stands beside it, with what its count is read as left out. */
function headerShape(within: HTMLElement, name: string, noun: string): string {
  const row = fold(within, name).parentElement;
  assert.ok(row, "the fold stands in a row");
  return row.outerHTML.replace(noun, "");
}

test("the summary's archived agents fold under the sidebar's own Archived header, folded and open alike, but for what they count", () => {
  const sidebar = mountSidebar(
    plansControl({ archived: [plan("a-1", "Old spike", null), plan("a-2", "Dropped", null)] }),
  );
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

  assert.equal(fold(sidebar, "Archived").getAttribute("aria-expanded"), "false");
  assert.equal(fold(sidebar, "Archived").textContent, "Archived2 plans");
  assert.equal(fold(summary, "Archived").textContent, "Archived2 archived agents");
  assert.equal(
    headerShape(summary, "Archived", " archived agents"),
    headerShape(sidebar, "Archived", " plans"),
  );

  act(() => fold(sidebar, "Archived").click());
  act(() => fold(summary, "Archived").click());
  assert.equal(fold(summary, "Archived").getAttribute("aria-expanded"), "true");
  assert.equal(headerShape(summary, "Archived", ""), headerShape(sidebar, "Archived", ""));
  assert.ok(summary.querySelector('[aria-label="Archived agents"]'), "the agents are listed");
});

test("a repository's header folds on its name, says its pin, counts its plans folded, keeps its + outside the fold, and opens its menu on a right-click", () => {
  const asked: string[] = [];
  const sidebar = mountSidebar(
    plansControl({
      plans: [plan("p-1", "Invite expiry", "acme/relay"), plan("p-2", "Retry audit", "acme/relay")],
      pinnedRepositories: ["acme/relay"],
      onNewPlanIn: (repository) => asked.push(repository),
    }),
  );
  const relay = () => fold(sidebar, "relay");
  assert.equal(relay().getAttribute("aria-expanded"), "true");
  assert.equal(relay().textContent, "relay(pinned)");

  act(() => relay().click());
  assert.equal(relay().getAttribute("aria-expanded"), "false");
  assert.equal(relay().textContent, "relay(pinned)2 plans");

  const plus = sidebar.querySelector<HTMLButtonElement>('button[aria-label="New plan in relay"]');
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
    ["Unpin", "Archive plans", "Open on GitHub"],
  );
  const ellipsis = sidebar.querySelector('button[aria-label="Actions for relay"]');
  assert.equal(ellipsis?.getAttribute("aria-expanded"), "true");
});
