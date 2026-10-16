// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  type OpenTask,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel";

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const OTHER_TASK = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER_AGENT = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** A plan that has used every fixed tab. */
function usedTask(id: string): OpenTask {
  return { id, holds: Object.fromEntries(SIDE_PANEL_TABS.map((tab) => [tab, true])) };
}

/** The open plan and its agents, every one, or nothing while unread. */
interface Stood {
  task: string;
  taskAgents: readonly string[] | undefined;
}

/** Mounts the panel alone, as a launch does, over the plan and agents given, answering the control as it stands. */
function launch(stood: Stood) {
  let control: SidePanelControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(
      undefined,
      usedTask(held.task),
      held.taskAgents,
      [],
      [],
      [],
      held.taskAgents,
    );
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (held: Stood) => act(() => root.render(createElement(Probe, { held })));
  render(stood);
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    render,
    quit: () => {
      act(() => root.unmount());
      roots.splice(roots.indexOf(root), 1);
    },
  };
}

test("an agent's Changes tab opens on its plan, stands chosen across a launch, and stands on no other plan", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onChoose({ changes: AGENT }));
  assert.deepEqual(first.control().changes, [{ changes: AGENT }], "opened once, chosen again");
  assert.deepEqual(first.control().tab, { changes: AGENT });
  first.quit();

  // A launch opens the plan on the Changes tab it was left on, before its agents are read.
  const second = launch({ task: TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, [{ changes: AGENT }]);
  assert.deepEqual(second.control().tab, { changes: AGENT });
  second.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().tab, { changes: AGENT });

  // Another plan, its agents unread, never draws it, nor shows it chosen.
  second.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.SUMMARY);
});

test("the Summary leads a plan's strip and is the tab it opens on, a record kept before it was a tab included", () => {
  const first = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(first.control().strip, SIDE_PANEL_TABS);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.SUMMARY);
  first.quit();

  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({ open: true, tabs: ["call", "board", "code"], width: 400 }),
  );
  const second = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(second.control().strip, [
    SIDE_PANEL_TAB.SUMMARY,
    SIDE_PANEL_TAB.CALL,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.CODE,
  ]);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.SUMMARY);
});

test("a record kept before tasks had their name holds each task's choices under plans and its pins' task under plan, and a launch still opens on both", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onPin({ changes: AGENT }, "Changes: Invite flow"));
  first.quit();
  const { tasks, pins, ...kept } = JSON.parse(
    window.localStorage.getItem("luke.sidePanel") ?? "{}",
  );
  assert.ok(tasks, "the record keeps the task's choices");
  const earlierPins = pins.map(({ task, ...pin }: { readonly task: string }) => ({
    ...pin,
    plan: task,
  }));
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({ ...kept, plans: tasks, pins: earlierPins }),
  );

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, { changes: AGENT });
  assert.deepEqual(
    second.control().pins.map(({ task, tab, label }) => ({ task, tab, label })),
    [{ task: TASK, tab: { changes: AGENT }, label: "Changes: Invite flow" }],
  );
});

test("a Changes tab closed stays closed across a launch, and closing the chosen one chooses the tab viewed before it", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(SIDE_PANEL_TAB.CODE));
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onClose({ changes: AGENT }));
  assert.deepEqual(first.control().changes, []);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.CODE);
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.CODE);
});

test("an agent's Terminal tab opens once at the strip's end and chosen, stands only on its agent's plan, and is kept across no launch", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => first.control().onChoose({ terminal: AGENT }));
  act(() => first.control().onChoose({ terminal: AGENT }));
  assert.deepEqual(first.control().terminals, [{ terminal: AGENT }], "opened once, chosen again");
  assert.deepEqual(first.control().strip.at(-1), { terminal: AGENT });
  assert.deepEqual(first.control().tab, { terminal: AGENT });

  // Another plan never draws it, its agents read or not.
  first.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.ok(!first.control().strip.some((tab) => tab instanceof Object && "terminal" in tab));
  assert.equal(first.control().tab, SIDE_PANEL_TAB.SUMMARY);
  first.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(first.control().tab, SIDE_PANEL_TAB.SUMMARY);

  // Back on its plan it stands as it was; closed, the tab viewed before it is chosen.
  first.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(first.control().tab, { terminal: AGENT });
  act(() => first.control().onClose({ terminal: AGENT }));
  assert.deepEqual(first.control().terminals, []);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.SUMMARY);
  act(() => first.control().onChoose({ terminal: OTHER_AGENT }));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().terminals, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.SUMMARY);
});

test("a Changes tab pins to the sidebar, keeps its pin across a launch, and takes its agent's new name", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onPin({ changes: AGENT }, "Changes: Invite flow"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(
    second.control().pins.map(({ task, tab, label }) => ({ task, tab, label })),
    [{ task: TASK, tab: { changes: AGENT }, label: "Changes: Invite flow" }],
  );
  // The panel's other choices read too, rather than the whole record being dropped.
  assert.deepEqual(second.control().tab, { changes: AGENT });

  act(() => second.control().onRenamePins(TASK, new Map([[AGENT, "Expiring invites"]])));
  assert.equal(second.control().pins[0]?.label, "Changes: Expiring invites");

  // Shown from its pin on another plan, it opens there, at the end of that plan's strip.
  second.render({ task: OTHER_TASK, taskAgents: [OTHER_AGENT] });
  act(() => second.control().onShow(TASK, { changes: AGENT }));
  second.render({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, { changes: AGENT });
  assert.deepEqual(second.control().changes, [{ changes: AGENT }]);
});

test("a file named alone, as ⌘K finds it, shows the tab it has as it stands, and one Luke never showed opens in a tab the plan draws", () => {
  const shown = "src/invites/accept.ts";
  const found = "src/invites/expire.ts";
  let control: SidePanelControl | undefined;
  function Probe() {
    control = useSidePanel(undefined, usedTask(TASK), [], [], [shown], [], []);
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const now = () => {
    assert.ok(control);
    return control;
  };
  act(() => now().onOpenFile({ path: shown, startLine: 3, endLine: 5 }));
  act(() => now().onChoose(SIDE_PANEL_TAB.CODE));

  act(() => now().onOpenFile({ path: shown }));
  assert.deepEqual(now().tab, { file: shown });
  assert.deepEqual(
    now().files.map(({ path, range }) => ({ path, range })),
    [{ path: shown, range: { startLine: 3, endLine: 5 } }],
    "the tab keeps the lines it had lit",
  );

  act(() => now().onOpenFile({ path: found }));
  assert.deepEqual(now().tab, { file: found });
  assert.deepEqual(
    now().files.map(({ path }) => path),
    [shown, found],
  );
});

test("the agent whose Terminal tab was shown last on a plan is the plan's own, which ⌘J goes to among several", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.equal(panel.control().lastTerminal, undefined);
  act(() => panel.control().onChoose({ terminal: AGENT }));
  act(() => panel.control().onChoose({ terminal: OTHER_AGENT }));
  act(() => panel.control().onChoose(SIDE_PANEL_TAB.CODE));
  assert.equal(panel.control().lastTerminal, OTHER_AGENT);
  panel.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(panel.control().lastTerminal, undefined);
});
