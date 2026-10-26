// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { installPressIntent } from "../press-intent.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  drawsChanges,
  drawsTerminal,
  type OpenTask,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel.js";

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

/** A task that has used every fixed tab. */
function usedTask(id: string): OpenTask {
  return { id, holds: Object.fromEntries(SIDE_PANEL_TABS.map((tab) => [tab, true])) };
}

/** The open task and its agents, every one, or nothing while unread. */
interface Stood {
  task: string;
  taskAgents: readonly string[] | undefined;
  /** Whether the plan holds nothing yet, so its strip draws no tab. */
  bare?: boolean;
}

/** Mounts the panel alone, as a launch does, over the task and agents given, answering the control as it stands. */
function launch(stood: Stood) {
  let control: SidePanelControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(
      undefined,
      held.bare === true ? { id: held.task, holds: {} } : usedTask(held.task),
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

  // A launch opens the task on the Changes tab it was left on, before its agents are read.
  const second = launch({ task: TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, [{ changes: AGENT }]);
  assert.deepEqual(second.control().tab, { changes: AGENT });
  second.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().tab, { changes: AGENT });

  // Another task, its agents unread, never draws it, nor shows it chosen.
  second.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.PLAN);
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

  // Another task never draws it, its agents read or not.
  first.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.ok(!first.control().strip.some((tab) => tab instanceof Object && "terminal" in tab));
  assert.equal(first.control().tab, SIDE_PANEL_TAB.PLAN);
  first.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(first.control().tab, SIDE_PANEL_TAB.PLAN);

  // Back on its task it stands as it was; closed, the tab viewed before it is chosen.
  first.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(first.control().tab, { terminal: AGENT });
  act(() => first.control().onClose({ terminal: AGENT }));
  assert.deepEqual(first.control().terminals, []);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.PLAN);
  act(() => first.control().onChoose({ terminal: OTHER_AGENT }));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().terminals, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.PLAN);
});

test("a Changes tab pins to the sidebar, keeps its pin across a launch, and takes its pull request's name, never its agent's", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onPin({ changes: AGENT }, "Pull request"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(
    second.control().pins.map(({ task, tab, label }) => ({ task, tab, label })),
    [{ task: TASK, tab: { changes: AGENT }, label: "Pull request" }],
  );
  // The panel's other choices read too, rather than the whole record being dropped.
  assert.deepEqual(second.control().tab, { changes: AGENT });

  const agents = new Map([[AGENT, "Expiring invites"]]);
  act(() => second.control().onRenamePins(TASK, { agents, pullRequests: new Map() }));
  assert.equal(second.control().pins[0]?.label, "Pull request", "its pull request unread");
  const pullRequests = new Map([[AGENT, "#42 Expire invitations"]]);
  act(() => second.control().onRenamePins(TASK, { agents, pullRequests }));
  assert.equal(second.control().pins[0]?.label, "#42 Expire invitations");

  // Shown from its pin on another task, it opens there, at the end of that task's strip.
  second.render({ task: OTHER_TASK, taskAgents: [OTHER_AGENT] });
  act(() => second.control().onShow(TASK, { changes: AGENT }));
  second.render({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, { changes: AGENT });
  assert.deepEqual(second.control().changes, [{ changes: AGENT }]);
});

test("a tab pinned to the sidebar keeps the place a drag gave it across a launch, on this Mac", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose({ changes: AGENT }));
  act(() => first.control().onPin({ changes: AGENT }, "Changes: Invite flow"));
  const at = first.control().pins[0]?.at ?? assert.fail("the tab is pinned");
  act(() => first.control().onPlacePins(new Map([[at, "a3"]])));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.equal(second.control().pins[0]?.position, "a3");
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

test("closing the last tab shuts the panel and leaves full screen, and the toggle shows it again empty, offering the tabs closed", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => panel.control().onChoose({ changes: AGENT }));
  act(() => panel.control().onToggleFullScreen());
  assert.equal(panel.control().fullScreen, true);

  for (const tab of SIDE_PANEL_TABS) act(() => panel.control().onClose(tab));
  assert.equal(panel.control().open, true, "a tab still stands, so the panel does");
  assert.deepEqual(panel.control().strip, [{ changes: AGENT }]);

  act(() => panel.control().onClose({ changes: AGENT }));
  assert.equal(panel.control().open, false);
  assert.equal(panel.control().fullScreen, false);

  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, true);
  assert.equal(panel.control().fullScreen, false, "shown again beside the document");
  assert.deepEqual(panel.control().strip, []);
  assert.equal(panel.control().tab, undefined);
  // The Inbox, never opened on the task, never stood to be closed.
  assert.deepEqual(
    panel.control().closedTabs,
    SIDE_PANEL_TABS.filter((tab) => tab !== SIDE_PANEL_TAB.INBOX),
  );
});

test("a plan whose strip holds no tab draws no panel, and the next plan with a tab draws it again, still open", () => {
  const panel = launch({ task: TASK, taskAgents: [] });
  act(() => panel.control().onChoose(SIDE_PANEL_TAB.CODE));
  assert.equal(panel.control().open, true);

  panel.render({ task: OTHER_TASK, taskAgents: [], bare: true });
  assert.deepEqual(panel.control().strip, []);
  assert.equal(panel.control().open, false);

  panel.render({ task: TASK, taskAgents: [] });
  assert.equal(panel.control().open, true);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.CODE);

  panel.render({ task: OTHER_TASK, taskAgents: [], bare: true });
  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, true, "shown on purpose, it stands empty");
  assert.deepEqual(panel.control().strip, []);
  panel.render({ task: TASK, taskAgents: [] });
  panel.render({ task: OTHER_TASK, taskAgents: [], bare: true });
  assert.equal(panel.control().open, false, "left and come back to, it is asked for again");
  act(() => panel.control().onToggle());
  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, false);
  panel.render({ task: TASK, taskAgents: [] });
  assert.equal(panel.control().open, false, "hidden by the toggle, not by the empty strip");
});

test("beside the window's Inbox the panel stands for the item's plan with none of its fixed tabs, holds what the item opens there, and the plan's page finds its strip as it left it, a fixed tab it closed still closed and one it opened still open", () => {
  const COMMIT = "0123456789abcdef0123456789abcdef01234567";
  let control: SidePanelControl | undefined;
  function Probe({ inbox }: { inbox: boolean }) {
    control = useSidePanel(
      undefined,
      inbox ? { id: TASK, holds: {}, bare: true } : usedTask(TASK),
      inbox ? [] : [AGENT],
      [],
      [],
      [],
      inbox ? undefined : [AGENT],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (inbox: boolean) => act(() => root.render(createElement(Probe, { inbox })));
  const panel = () => {
    assert.ok(control);
    return control;
  };

  render(false);
  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose({ changes: AGENT }));

  render(true);
  assert.deepEqual(panel().strip, [{ changes: AGENT }], "no fixed tab stands beside the Inbox");
  act(() => panel().onOpenFile({ path: "src/invites.ts", startLine: 3, endLine: 5 }, COMMIT));
  assert.deepEqual(panel().strip, [{ changes: AGENT }, { file: "src/invites.ts" }]);
  assert.deepEqual(panel().tab, { file: "src/invites.ts" });

  render(false);
  assert.deepEqual(panel().strip, [
    SIDE_PANEL_TAB.PLAN,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.COMMENTS,
    { changes: AGENT },
    { file: "src/invites.ts" },
  ]);
});

/** Mounts the panel over a task holding its plan and, where `inbox` says, an Inbox it may draw, answering the control. */
function inboxPanel(inbox: { task: string; held: boolean }, room: ShellRoom = SHELL_ROOM.WIDE) {
  let control: SidePanelControl | undefined;
  function Probe({ held }: { held: { task: string; held: boolean } }) {
    control = useSidePanel(
      undefined,
      {
        id: held.task,
        holds: { [SIDE_PANEL_TAB.PLAN]: true, [SIDE_PANEL_TAB.INBOX]: held.held },
      },
      undefined,
      [],
      [],
      [],
      undefined,
      room,
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (held: { task: string; held: boolean }) =>
    act(() => root.render(createElement(Probe, { held })));
  render(inbox);
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    render,
  };
}

test("a task's Inbox stands only once an item the developer has not seen waits, opening and choosing it with the panel shown, and closed, it stays closed until a newer item does", () => {
  const panel = inboxPanel({ task: TASK, held: true });
  act(() => panel.control().onToggle());
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN], "the plan stands alone");
  assert.equal(panel.control().open, false);

  act(() => panel.control().onInboxRead(TASK, ["item-1"]));
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX]);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.INBOX);
  assert.equal(panel.control().open, true, "an item not seen shows the panel");

  act(() => panel.control().onClose(SIDE_PANEL_TAB.INBOX));
  act(() => panel.control().onInboxRead(TASK, ["item-1"]));
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN], "an item seen opens nothing");
  act(() => panel.control().onInboxRead(TASK, ["item-1", "item-2"]));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.INBOX, "a newer item opens it again");
});

test("in a narrow room an Inbox item not seen opens the Inbox's tab at the strip's end without choosing it, so the plan the panel stood on, or the column it stood shut over, stays", () => {
  const panel = inboxPanel({ task: TASK, held: true }, SHELL_ROOM.NARROW);
  assert.deepEqual(
    { open: panel.control().open, tab: panel.control().tab },
    { open: true, tab: SIDE_PANEL_TAB.PLAN },
  );
  act(() => panel.control().onInboxRead(TASK, ["item-1"]));
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX]);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.PLAN, "the plan stays chosen");

  act(() => panel.control().onClose(SIDE_PANEL_TAB.INBOX));
  act(() => panel.control().onSetOpen(false));
  act(() => panel.control().onInboxRead(TASK, ["item-1", "item-2"]));
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX]);
  assert.equal(panel.control().open, false, "a newer item leaves the panel shut");
});

test("a task that may draw no Inbox, holding no agent and nothing waiting, draws none, though an item read on it was not seen", () => {
  const panel = inboxPanel({ task: TASK, held: false });
  act(() => panel.control().onInboxRead(TASK, ["item-1"]));
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN]);
  panel.render({ task: TASK, held: true });
  assert.deepEqual(panel.control().strip, [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX]);
});

test("a record kept while the Call stood in the panel reads with its tab let go from the strip, and its pin let go too", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["board", "code", "call", "comments"],
      tab: "call",
      width: 400,
      tasks: { [TASK]: { opened: ["call"], closed: [], recent: ["call"], order: ["call"] } },
      pins: [{ task: TASK, tab: "call", label: "Call", at: 1 }],
    }),
  );
  const panel = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(
    panel.control().strip,
    [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE, SIDE_PANEL_TAB.COMMENTS],
    "the Call stands in no strip of the panel, and the plan leads it",
  );
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.PLAN);
  assert.deepEqual(panel.control().pins, [], "a pin of the Call, which is gone, is let go");
});

test("a narrow room holds the open panel full screen alone, so the window's ways out of full screen shut it there, and a room widened again stands it beside the document", () => {
  let room: ShellRoom = SHELL_ROOM.NARROW;
  let control: SidePanelControl | undefined;
  function Probe({ at }: { at: ShellRoom }) {
    control = useSidePanel(undefined, usedTask(TASK), [], [], [], [], [], at);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = () => act(() => root.render(createElement(Probe, { at: room })));
  const now = () => control ?? assert.fail("the panel is held");
  // The panel opens shown on the plan, which the narrow room holds full screen.
  render();
  assert.deepEqual([now().open, now().fullScreen, now().fullScreenOnly], [true, true, true]);

  // Back, a column's tab shown, and a pin opened step out of full screen this way.
  act(() => now().onToggleFullScreen());
  assert.equal(now().open, false, "leaving full screen in a narrow room shuts the panel");

  act(() => now().onToggle());
  room = SHELL_ROOM.WIDE;
  render();
  assert.deepEqual([now().open, now().fullScreen, now().fullScreenOnly], [true, false, false]);
});

test("the Inbox with nothing chosen has no task, so the panel left open shows over it in no room, neither full screen on a phone nor empty beside it", () => {
  let control: SidePanelControl | undefined;
  function Probe({ at, task }: { at: ShellRoom; task: OpenTask }) {
    control = useSidePanel(undefined, task, [], [], [], [], [], at);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const now = () => control ?? assert.fail("the panel is held");
  const render = (at: ShellRoom, task: OpenTask) =>
    act(() => root.render(createElement(Probe, { at, task })));
  // The panel stands open on a plan, and is kept open for the next launch.
  render(SHELL_ROOM.NARROW, usedTask(TASK));
  assert.equal(now().open, true);
  assert.equal(JSON.parse(window.localStorage.getItem("luke.sidePanel") ?? "{}").open, true);

  for (const room of [SHELL_ROOM.NARROW, SHELL_ROOM.WIDE]) {
    render(room, { id: undefined, holds: {}, bare: true });
    assert.deepEqual(
      [now().open, now().fullScreen, now().fullScreenOnly],
      [false, false, false],
      `the ${room} room shows the Inbox with no panel over it`,
    );
  }
});

test("a link opens its tab as the panel's preview, and the next link takes its place, so a run of links read leaves one tab", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview({ changes: AGENT }));
  assert.deepEqual(panel.control().preview, { changes: AGENT });
  assert.deepEqual(panel.control().tab, { changes: AGENT });

  act(() => panel.control().onPreview({ changes: OTHER_AGENT }));
  assert.deepEqual(panel.control().preview, { changes: OTHER_AGENT });
  assert.deepEqual(panel.control().tab, { changes: OTHER_AGENT });
  assert.deepEqual(
    panel.control().changes,
    [{ changes: OTHER_AGENT }],
    "the first preview gave way",
  );
});

test("a preview kept stands as a tab of its own, so the next link opens beside it rather than in its place", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview({ changes: AGENT }));
  act(() => panel.control().onKeep({ changes: AGENT }));
  assert.equal(panel.control().preview, undefined);

  act(() => panel.control().onPreview({ changes: OTHER_AGENT }));
  assert.deepEqual(panel.control().changes, [{ changes: AGENT }, { changes: OTHER_AGENT }]);
  assert.deepEqual(panel.control().preview, { changes: OTHER_AGENT });
});

test("a link to a tab standing as one of its own only chooses it, and a fixed kind opens as chosen, never as a preview", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onChoose({ changes: AGENT }));
  act(() => panel.control().onPreview({ changes: OTHER_AGENT }));
  act(() => panel.control().onPreview({ changes: AGENT }));
  assert.deepEqual(panel.control().tab, { changes: AGENT });
  assert.deepEqual(panel.control().preview, { changes: OTHER_AGENT }, "the preview still stands");

  act(() => panel.control().onPreview(SIDE_PANEL_TAB.PLAN));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.PLAN);
  assert.deepEqual(panel.control().preview, { changes: OTHER_AGENT });
  assert.equal(panel.control().changes.length, 2);
});

test("a link pressed with ⌘ opens a tab of its own, as a double-click keeps a preview", () => {
  const stop = installPressIntent(window);
  try {
    const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
    const link = document.body.appendChild(document.createElement("a"));
    link.addEventListener("click", () => panel.control().onPreview({ changes: AGENT }));
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    });
    assert.deepEqual(panel.control().tab, { changes: AGENT });
    assert.equal(panel.control().preview, undefined, "⌘ keeps it");
    act(() => panel.control().onPreview({ changes: OTHER_AGENT }));
    assert.deepEqual(panel.control().changes, [{ changes: AGENT }, { changes: OTHER_AGENT }]);
  } finally {
    stop();
  }
});

test("a preview closed lets its preview go, so the same tab opened again by a chosen door stands as a tab of its own", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview({ changes: AGENT }));
  act(() => panel.control().onClose({ changes: AGENT }));
  act(() => panel.control().onChoose({ changes: AGENT }));
  assert.equal(panel.control().preview, undefined);
});

test("a preview browsed on to another file stays the preview on that file, so the next link still takes its place", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreviewFile({ path: "src/a.ts" }));
  assert.deepEqual(panel.control().preview, { file: "src/a.ts" });
  act(() => panel.control().onBrowseFile("src/a.ts", "src/b.ts", false));
  assert.deepEqual(panel.control().preview, { file: "src/b.ts" });

  act(() => panel.control().onPreview({ changes: AGENT }));
  assert.deepEqual(panel.control().preview, { changes: AGENT });
  assert.ok(
    !panel.control().strip.some((tab) => typeof tab === "object" && "file" in tab),
    "the browsed preview gave way",
  );
});

test("an agent's transcript stands in a panel beside the Inbox alone, once the task's agents hold it, and as the panel's preview like any link's tab", () => {
  let control: SidePanelControl | undefined;
  function Probe({ bare }: { bare: boolean }) {
    control = useSidePanel(
      undefined,
      bare ? { id: TASK, holds: {}, bare: true } : usedTask(TASK),
      [],
      [],
      [],
      [],
      [AGENT, OTHER_AGENT],
    );
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const render = (bare: boolean) => act(() => root.render(createElement(Probe, { bare })));
  const panel = () => {
    assert.ok(control);
    return control;
  };

  render(true);
  act(() => panel().onPreview({ transcript: AGENT }));
  assert.deepEqual(panel().strip, [{ transcript: AGENT }]);
  assert.deepEqual(panel().preview, { transcript: AGENT });
  act(() => panel().onPreview({ transcript: OTHER_AGENT }));
  assert.deepEqual(panel().strip, [{ transcript: OTHER_AGENT }], "the next link took its place");

  render(false);
  assert.ok(
    !panel().strip.some((tab) => typeof tab === "object" && "transcript" in tab),
    "a task's own page draws its agents in its column, never beside",
  );
});

test("beside a channel's stream the panel's Inbox tab is the thread open there: what the thread opens stands beside it and closing that goes back to it, closing it closes the panel where nothing else stands, and the task's own page keeps no Inbox tab of it", () => {
  /** Where the panel stands: the task's own page, beside a stream with a thread open, or beside the stream alone. */
  type Beside = "task" | "thread" | "stream";
  let control: SidePanelControl | undefined;
  function Probe({ beside }: { beside: Beside }) {
    control = useSidePanel(
      undefined,
      beside === "task"
        ? usedTask(TASK)
        : { id: TASK, holds: {}, bare: true, thread: beside === "thread" ? true : undefined },
      [],
      [],
      [],
      [],
      [AGENT],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (beside: Beside) => act(() => root.render(createElement(Probe, { beside })));
  const panel = () => {
    assert.ok(control);
    return control;
  };

  render("stream");
  assert.deepEqual(panel().strip, [], "a stream with no thread open holds no tab beside it");
  render("thread");
  act(() => panel().onChoose(SIDE_PANEL_TAB.INBOX));
  assert.equal(panel().open, true);
  assert.equal(panel().tab, SIDE_PANEL_TAB.INBOX);

  // A pull request the thread links opens beside it, and closing it is the way back to the thread.
  act(() => panel().onPreview({ changes: AGENT }));
  assert.deepEqual(panel().strip, [SIDE_PANEL_TAB.INBOX, { changes: AGENT }]);
  assert.deepEqual(panel().tab, { changes: AGENT });
  act(() => panel().onClose({ changes: AGENT }));
  assert.equal(panel().tab, SIDE_PANEL_TAB.INBOX);

  // Closing the thread's tab, the last standing, closes the panel with it.
  act(() => panel().onClose(SIDE_PANEL_TAB.INBOX));
  assert.equal(panel().open, false);

  render("task");
  assert.ok(
    !panel().strip.includes(SIDE_PANEL_TAB.INBOX),
    "the thread's tab was the stream's, never a choice of the task's",
  );
});

test("closing a channel's thread beside its stream leaves the task's own Inbox tab viewed as it was, so a tab closed on the task's page still goes back to it", () => {
  let control: SidePanelControl | undefined;
  function Probe({ thread }: { thread: boolean }) {
    control = useSidePanel(
      undefined,
      thread ? { id: TASK, holds: {}, bare: true, thread: true } : usedTask(TASK),
      [],
      [],
      [],
      [],
      [AGENT],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (thread: boolean) => act(() => root.render(createElement(Probe, { thread })));
  const panel = () => {
    assert.ok(control);
    return control;
  };

  render(false);
  act(() => panel().onChoose(SIDE_PANEL_TAB.CODE));
  act(() => panel().onChoose(SIDE_PANEL_TAB.INBOX));
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));

  render(true);
  act(() => panel().onChoose(SIDE_PANEL_TAB.INBOX));
  act(() => panel().onClose(SIDE_PANEL_TAB.INBOX));

  render(false);
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  assert.equal(panel().tab, SIDE_PANEL_TAB.INBOX, "the tab viewed before the Board is the Inbox");
});

test("an archived agent's Pull request tab is drawn as a live agent's, while its Terminal tab is not", () => {
  const drawn = { taskAgents: ["live"], heldAgents: ["live", "archived"] };
  assert.equal(drawsChanges({ changes: "archived" }, drawn), true);
  assert.equal(drawsChanges({ changes: "other" }, drawn), false);
  assert.equal(drawsTerminal({ terminal: "archived" }, drawn), false);
  // A place that names no held agents draws Pull request tabs by its live ones, as before.
  assert.equal(drawsChanges({ changes: "archived" }, { taskAgents: ["live"] }), false);
});
