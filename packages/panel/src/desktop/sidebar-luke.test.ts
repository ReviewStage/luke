// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_KIND,
  CODING_AGENT_STATUS,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import type { WireBoundaryInput } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPortAnswering, type SentPortAct } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-luke.test.ts -- Luke, the account's operator, stands in his own row at the head of the sidebar's list while the account has the operator on, and nowhere at all while it does not: drawing him ensures him once per workspace, a failed ensure draws a quiet retry rather than an error, he is not listed again among the agents, and his Reset asks nothing: it ensures a fresh Luke and opens him at once, and its toast's Undo brings the old one back and opens him again.
 *
 * The service is a script at the act boundary; synthetic workspaces and agents throughout.
 */

/** The zone this test's window reads in, which every ensure carries for the heartbeat it may make. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const SIDE: Workspace = {
  id: "workspace-side",
  name: "Side",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LUKE_ID = "6a1f0c2e-0000-4000-8000-0000000000a1";
const FRESH_ID = "6a1f0c2e-0000-4000-8000-0000000000a2";

/** The operator as the list holds him, under the name the service gave the agent. */
const OPERATOR: TasklessAgent = {
  id: LUKE_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Orla",
  kind: CODING_AGENT_KIND.OPERATOR,
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: null,
  workspaceId: ACME.id,
  repository: null,
  activityAt: 2,
};

/** An agent with no task beside him, an automation's run. */
const SWEEP: TasklessAgent = {
  id: "6a1f0c2e-0000-4000-8000-0000000000b1",
  planId: null,
  model: OPERATOR.model,
  effort: OPERATOR.effort,
  title: "Copy sweep",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationName: "Copy sweep",
  automationId: "6a1f0c2e-0000-4000-8000-0000000000c1",
  workspaceId: ACME.id,
  repository: "acme/relay",
  activityAt: 2,
};

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** Answers each ensure as the script says, every other act with nothing, and keeps every act sent. */
function serve(ensure: (payload: unknown) => WireBoundaryInput): SentPortAct[] {
  const sent: SentPortAct[] = [];
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(
      request.kind === ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR ? ensure(request.payload) : undefined,
    );
  });
  return sent;
}

/** Every ensure the window asked, by its payload. */
function ensures(sent: readonly SentPortAct[]): unknown[] {
  return sent
    .filter((request) => request.kind === ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR)
    .map((request) => request.payload);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The sidebar over `tasks`, beside the work and the window's toasts where `toasts` says, with a way to draw it again over other tasks. */
async function mount(
  tasks: TasksControl,
  toasts = false,
): Promise<{ sidebar: HTMLElement; redraw: (next: TasksControl) => Promise<void> }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (next: TasksControl) => {
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(DesktopSidebar, { ...sidebarProps(next), room: SHELL_ROOM.WIDE }),
            toasts ? createElement(ToastHost) : null,
          ),
        ),
      ),
    );
    await settle();
  };
  await draw(tasks);
  return { sidebar: container, redraw: draw };
}

/** The sidebar's tasks over Acme, listing `agents` with no task, and every agent page it opens. */
function acme(agents: readonly TasklessAgent[] = [], opened: string[] = []): TasksControl {
  const tasks = tasksControl({
    workspaces: [ACME, SIDE],
    workspace: ACME,
    listedAgents: { standing: agents, archived: [] },
  });
  return {
    ...tasks,
    agentView: { ...tasks.agentView, onOpen: (agentId: string) => void opened.push(agentId) },
  };
}

/** Luke's row, where it stands. */
function lukeRow(sidebar: HTMLElement): HTMLElement | null {
  return sidebar.querySelector<HTMLElement>('nav[aria-label="Luke"] .luke-list-row');
}

/** The names every row of the sidebar's list draws, top to bottom. */
function rowNames(sidebar: HTMLElement): string[] {
  return [...sidebar.querySelectorAll(".sidebar-section-body .luke-list-row-title")].map(
    (name) => name.firstChild?.textContent ?? "",
  );
}

/** The menu item named `label`, failing where none is drawn. */
function item(label: string): HTMLElement {
  const name = [...document.querySelectorAll(".luke-menu-item-label")].find(
    (each) => each.textContent === label,
  );
  return name?.closest<HTMLElement>('[role="menuitem"]') ?? assert.fail(`no ${label} in the menu`);
}

/** The button whose words, or else whose label, are `label`. */
function button(label: string): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const found =
    buttons.find((each) => each.textContent === label) ??
    buttons.find((each) => each.getAttribute("aria-label") === label);
  return found ?? assert.fail(`no ${label} button`);
}

test("with the operator off there is no Luke row and nothing is ensured", async () => {
  const sent = serve(() => ({ agentId: LUKE_ID }));
  handState({});
  const { sidebar } = await mount(acme([OPERATOR, SWEEP]));

  assert.equal(lukeRow(sidebar), null);
  assert.deepEqual(ensures(sent), []);
});

test("with the operator on, Luke's row stands first and is ensured once per workspace", async () => {
  const sent = serve(() => ({ agentId: LUKE_ID }));
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const { sidebar, redraw } = await mount(acme([SWEEP]));

  assert.ok(lukeRow(sidebar), "Luke's row is drawn");
  assert.equal(rowNames(sidebar)[0], "Luke");
  await redraw(acme([SWEEP]));
  assert.deepEqual(ensures(sent), [{ workspaceId: ACME.id, timeZone: ZONE }]);

  await redraw({ ...acme([SWEEP]), workspace: SIDE });
  await redraw(acme([SWEEP]));
  assert.deepEqual(ensures(sent), [
    { workspaceId: ACME.id, timeZone: ZONE },
    { workspaceId: SIDE.id, timeZone: ZONE },
  ]);
});

test("another account signed in to the same workspace ensures its own Luke rather than opening the last one's", async () => {
  const sent = serve(() => ({ agentId: ensures(sent).length === 1 ? LUKE_ID : FRESH_ID }));
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const opened: string[] = [];
  const { sidebar, redraw } = await mount({ ...acme([], opened), me: "user-alice" });
  await redraw({ ...acme([], opened), me: "user-bob" });

  const press = lukeRow(sidebar)?.querySelector<HTMLElement>("button") ?? assert.fail("Luke's row");
  act(() => press.click());

  assert.deepEqual(ensures(sent), [
    { workspaceId: ACME.id, timeZone: ZONE },
    { workspaceId: ACME.id, timeZone: ZONE },
  ]);
  assert.deepEqual(opened, [FRESH_ID]);
});

test("a press on Luke's row opens his page", async () => {
  serve(() => ({ agentId: LUKE_ID }));
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const opened: string[] = [];
  const { sidebar } = await mount(acme([OPERATOR], opened));

  const press = lukeRow(sidebar)?.querySelector<HTMLElement>("button") ?? assert.fail("Luke's row");
  act(() => press.click());

  assert.deepEqual(opened, [LUKE_ID]);
});

test("a failed ensure leaves Luke's row standing with a quiet retry, which asks again", async () => {
  let refusing = true;
  const sent = serve(() =>
    refusing ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : { agentId: LUKE_ID },
  );
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const { sidebar } = await mount(acme());

  assert.ok(lukeRow(sidebar), "Luke's row still stands");
  assert.equal(document.querySelector('[role="alert"]'), null);
  refusing = false;
  act(() => button("Retry").click());
  await settle();

  assert.deepEqual(ensures(sent), [
    { workspaceId: ACME.id, timeZone: ZONE },
    { workspaceId: ACME.id, timeZone: ZONE },
  ]);
  assert.equal(
    [...document.querySelectorAll("button")].find(
      (each) => each.getAttribute("aria-label") === "Retry",
    ),
    undefined,
  );
});

test("Luke is listed once, in his own row, not again among the agents with no task", async () => {
  serve(() => ({ agentId: LUKE_ID }));
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const { sidebar } = await mount(acme([OPERATOR, SWEEP]));

  const names = rowNames(sidebar);
  assert.equal(names.filter((name) => name === "Luke").length, 1);
  assert.ok(!names.includes("Orla"), "the operator is not drawn again by its agent's name");
  assert.ok(names.includes("Copy sweep"), "every other agent still stands");
});

test("Luke is known by his kind, so a list read before his ensure answers never draws him twice", async () => {
  fakeActPortAnswering(() => new Promise<never>(() => undefined));
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const { sidebar } = await mount(acme([OPERATOR, SWEEP]));

  assert.deepEqual(rowNames(sidebar), ["Luke", "Copy sweep"]);
});

test("Reset asks nothing: it ensures a fresh Luke and opens him at once, and Undo brings the old one back and opens him", async () => {
  const sent = serve((payload) => {
    const asked = payload as { reset?: boolean; restore?: string };
    if (asked.reset === true) return { agentId: FRESH_ID };
    return { agentId: asked.restore ?? LUKE_ID };
  });
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const opened: string[] = [];
  const { sidebar } = await mount(acme([OPERATOR], opened), true);

  act(() => button("Luke actions").click());
  assert.ok(!document.body.textContent?.includes("Archive"), "Luke offers no Archive");
  assert.ok(!document.body.textContent?.includes("Permanently delete"), "Luke offers no delete");
  act(() => item("Reset Luke").click());
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "the reset asks nothing");
  assert.deepEqual(ensures(sent), [
    { workspaceId: ACME.id, timeZone: ZONE },
    { workspaceId: ACME.id, reset: true, timeZone: ZONE },
  ]);
  assert.deepEqual(opened, [FRESH_ID]);
  assert.match(newestToastSays() ?? "", /Luke reset/u);

  const undo = newestToastAction() ?? assert.fail("the toast offers Undo");
  assert.equal(undo.textContent, "Undo");
  act(() => undo.click());
  await settle();

  assert.deepEqual(ensures(sent).at(-1), {
    workspaceId: ACME.id,
    restore: LUKE_ID,
    timeZone: ZONE,
  });
  assert.deepEqual(opened, [FRESH_ID, LUKE_ID]);
  assert.ok(lukeRow(sidebar), "Luke's row still stands");
});

test("a Reset the service refuses opens nothing and says so, offering no Undo", async () => {
  serve((payload) =>
    (payload as { reset?: boolean }).reset === true
      ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
      : { agentId: LUKE_ID },
  );
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  const opened: string[] = [];
  await mount(acme([OPERATOR], opened), true);

  act(() => button("Luke actions").click());
  act(() => item("Reset Luke").click());
  await settle();

  assert.deepEqual(opened, []);
  assert.match(newestToastSays() ?? "", /Luke could not be reset/u);
  assert.notEqual(newestToastAction()?.textContent, "Undo");
});
