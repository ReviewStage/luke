// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { layContainersAt, shown } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { NO_LOOKS } from "../planning/use-plan-looks";
import { DesktopPlans } from "./desktop-plans";

/**
 * plan-toolbar-width.test.ts -- the plan's toolbar at the widths its column
 * is given: its controls give way before its tabs do. Start draws its glyph
 * alone where the toolbar is short of room, named still, and leaves its
 * model menu to the new agent's own composer where the column is narrowest;
 * the agents' Retry, after a first read that did not land, stands outside
 * the scrolling strip, so the strip never takes it out of reach, and draws
 * its glyph alone at the narrowest. jsdom lays nothing out, so each width is
 * the stylesheets' container queries resolved for a toolbar that wide
 * (`#testing/container-width`). Synthetic throughout.
 */

/** The toolbar's room, its insets taken off, under a column this wide. */
const TOOLBAR = {
  /** A 280px column, the window's narrowest beside the sidebar and the side panel. */
  NARROWEST: 256,
  /** A 423px column, the window's narrowest with the sidebar folded. */
  NARROW: 399,
  /** A 760px column. */
  WIDE: 736,
} as const;

const PLAN: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/web",
  document: { body: "", assumptions: [] },
};

const ignore = () => undefined;

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** The plan's page on its own tab, its toolbar `width` pixels wide, its agents as `agents` says. */
function drawnAt(width: number, agents: Partial<CodingAgentsControl> = {}): HTMLElement {
  layContainersAt({ "plan-toolbar": width });
  const control = plansControl({
    page: TASKS_PAGE.DOCUMENT,
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, task: PLAN },
    agents: codingAgentsControl({
      start: { available: true, reason: undefined, busy: false, note: undefined, onPress: ignore },
      ...agents,
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopPlans, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          captions: undefined,
          plans: control,
        }),
      ),
    ),
  );
  return container;
}

/** The button named `name`. */
function press(container: HTMLElement, name: string): HTMLButtonElement {
  return (
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
    assert.fail(`${name} stands`)
  );
}

/** Whether the words inside a press are drawn, rather than its glyph alone. */
function wordsDrawn(button: HTMLElement, selector: string): boolean {
  return shown(button.querySelector(selector) ?? assert.fail(`${selector} stands`));
}

test("a toolbar a 760px column wide draws Start with its word and its model menu", () => {
  const page = drawnAt(TOOLBAR.WIDE);
  assert.equal(wordsDrawn(press(page, "Start a coding agent"), ".start-agent-word"), true);
  assert.equal(shown(press(page, "Choose a model to start with")), true);
});

test("a toolbar a 423px column wide draws Start as its glyph alone, named still, and keeps its model menu", () => {
  const page = drawnAt(TOOLBAR.NARROW);
  assert.equal(wordsDrawn(press(page, "Start a coding agent"), ".start-agent-word"), false);
  assert.equal(shown(press(page, "Start a coding agent")), true);
  assert.equal(shown(press(page, "Choose a model to start with")), true);
});

test("a toolbar a 280px column wide draws Start as its glyph alone, and leaves its model menu to the new agent's composer", () => {
  const page = drawnAt(TOOLBAR.NARROWEST);
  assert.equal(shown(press(page, "Start a coding agent")), true);
  assert.equal(shown(press(page, "Choose a model to start with")), false);
});

test("the agents' Retry, after a first read that did not land, stands outside the scrolling strip, so it is never scrolled out of reach", () => {
  const page = drawnAt(TOOLBAR.WIDE, { listFailed: true, agents: undefined });
  const retry = press(page, "Retry agents");
  assert.equal(retry.closest('[role="tablist"]'), null);
  assert.equal(wordsDrawn(retry, ".retry-word"), true);
});

test("a toolbar a 280px column wide draws the agents' Retry as its glyph alone, named still", () => {
  const page = drawnAt(TOOLBAR.NARROWEST, { listFailed: true, agents: undefined });
  const retry = press(page, "Retry agents");
  assert.equal(shown(retry), true);
  assert.equal(wordsDrawn(retry, ".retry-word"), false);
});
