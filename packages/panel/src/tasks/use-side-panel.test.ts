// @vitest-environment jsdom

import assert from "node:assert/strict";
import { changesTab, fileTab, pageTab, terminalTab, transcriptTab } from "@repo/ui/tab-strip-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  drawsChanges,
  drawsTerminal,
  type OpenTask,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel.js";

const TASK = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const OTHER_TASK = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const BARE_TASK = "6c8e0a2b-4d6f-4b8c-8e2a-3c5d7e9f1a2b";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER_AGENT = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
/** A cloud terminal tab of each agent. */
const CLOUD = terminalTab(AGENT, "2f6e0c1a-5b3d-4c8e-9a1f-7d2b4e6a8c10", "Cloud 1");
const OTHER_CLOUD = terminalTab(OTHER_AGENT, "3a7f1d2b-6c4e-4d9f-8b2a-8e3c5f7b9d21", "Cloud 1");

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
  act(() => first.control().onChoose(changesTab(AGENT)));
  act(() => first.control().onChoose(changesTab(AGENT)));
  assert.deepEqual(first.control().changes, [changesTab(AGENT)], "opened once, chosen again");
  assert.deepEqual(first.control().tab, changesTab(AGENT));
  first.quit();

  // A launch opens the task on the Changes tab it was left on, before its agents are read.
  const second = launch({ task: TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, [changesTab(AGENT)]);
  assert.deepEqual(second.control().tab, changesTab(AGENT));
  second.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().tab, changesTab(AGENT));

  // Another task, its agents unread, never draws it, nor shows it chosen.
  second.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, undefined);
});

test("a record keeps each tab without its kind, as a build before tabs carried their kind wrote it, and one kept before tasks had their name holds each task's choices under plans and its pins' task under plan; a launch still opens on both, each tab tagged with its kind", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(AGENT)));
  act(() => first.control().onPin({ task: TASK }, changesTab(AGENT), "Changes: Invite flow"));
  first.quit();
  const { tasks, pins, ...kept } = JSON.parse(window.localStorage.getItem("app.sidePanel") ?? "{}");
  assert.ok(tasks, "the record keeps the task's choices");
  assert.deepEqual(
    [kept.tab, tasks[TASK].changes, pins[0].tab],
    [{ changes: AGENT }, [{ changes: AGENT }], { changes: AGENT }],
    "a rollback reads the tabs this build wrote",
  );
  const earlierPins = pins.map(({ task, ...pin }: { readonly task: string }) => ({
    ...pin,
    plan: task,
  }));
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({ ...kept, plans: tasks, pins: earlierPins }),
  );

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, changesTab(AGENT));
  assert.deepEqual(
    second.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [{ task: TASK, tab: changesTab(AGENT), label: "Changes: Invite flow" }],
  );
});

test("a Changes tab closed stays closed across a launch, and closing the chosen one chooses the tab viewed before it", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(CLOUD));
  act(() => first.control().onChoose(changesTab(AGENT)));
  act(() => first.control().onClose(changesTab(AGENT)));
  assert.deepEqual(first.control().changes, []);
  assert.deepEqual(first.control().tab, CLOUD);
  first.quit();

  // Note that a Terminal tab is kept across no launch, so nothing stands to choose.
  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().changes, []);
  assert.equal(second.control().tab, undefined);
});

test("an agent's Terminal tab opens once at the strip's end and chosen, stands only on its agent's plan, and is kept across no launch", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => first.control().onChoose(CLOUD));
  act(() => first.control().onChoose(CLOUD));
  assert.deepEqual(first.control().terminals, [CLOUD], "opened once, chosen again");
  assert.deepEqual(first.control().strip.at(-1), CLOUD);
  assert.deepEqual(first.control().tab, CLOUD);

  // Another task never draws it, its agents read or not.
  first.render({ task: OTHER_TASK, taskAgents: undefined });
  assert.ok(!first.control().strip.some((tab) => tab instanceof Object && "terminal" in tab));
  assert.equal(first.control().tab, undefined);
  first.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(first.control().tab, undefined);

  // Back on its task it stands as it was; closed, no tab stands.
  first.render({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(first.control().tab, CLOUD);
  act(() => first.control().onClose(CLOUD));
  assert.deepEqual(first.control().terminals, []);
  assert.equal(first.control().tab, undefined);
  act(() => first.control().onChoose(OTHER_CLOUD));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.deepEqual(second.control().terminals, []);
  assert.equal(second.control().tab, undefined);
});

test("a Changes tab pins to the sidebar, keeps its pin across a launch, and takes its pull request's name", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(AGENT)));
  act(() => first.control().onPin({ task: TASK }, changesTab(AGENT), "Pull request"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(
    second.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [{ task: TASK, tab: changesTab(AGENT), label: "Pull request" }],
  );
  // The panel's other choices read too, rather than the whole record being dropped.
  assert.deepEqual(second.control().tab, changesTab(AGENT));

  act(() => second.control().onRenamePins(TASK, { pullRequests: new Map() }));
  assert.equal(second.control().pins[0]?.label, "Pull request", "its pull request unread");
  const pullRequests = new Map([[AGENT, "#42 Expire invitations"]]);
  act(() => second.control().onRenamePins(TASK, { pullRequests }));
  assert.equal(second.control().pins[0]?.label, "#42 Expire invitations");

  // Shown from its pin on another task, it opens there, at the end of that task's strip.
  second.render({ task: OTHER_TASK, taskAgents: [OTHER_AGENT] });
  act(() => second.control().onShow(TASK, changesTab(AGENT)));
  second.render({ task: TASK, taskAgents: [AGENT] });
  assert.deepEqual(second.control().tab, changesTab(AGENT));
  assert.deepEqual(second.control().changes, [changesTab(AGENT)]);
});

test("a tab pinned on an agent's own page keeps its pin across a launch, under a key of its own an earlier version's record leaves alone", () => {
  const first = launch({ task: AGENT, taskAgents: [AGENT] });
  act(() => first.control().onPin({ agent: AGENT }, changesTab(AGENT), "#88 Quarantine"));
  act(() => first.control().onPin({ task: TASK }, changesTab(OTHER_AGENT), "#42 Invites"));
  first.quit();
  const { pins, agentPins } = JSON.parse(window.localStorage.getItem("app.sidePanel") ?? "{}");
  assert.deepEqual(
    [
      pins.map((pin: { task?: string }) => pin.task),
      agentPins.map((pin: { agent?: string }) => pin.agent),
    ],
    [[TASK], [AGENT]],
  );

  const second = launch({ task: TASK, taskAgents: [OTHER_AGENT] });
  assert.deepEqual(
    second.control().pins.map(({ tab, label, at: _at, ...holder }) => ({ ...holder, tab, label })),
    [
      { task: TASK, tab: changesTab(OTHER_AGENT), label: "#42 Invites" },
      { agent: AGENT, tab: changesTab(AGENT), label: "#88 Quarantine" },
    ],
  );
});

test("a file's pin opens its tab on the pin's task after a launch, which keeps no file's tab", () => {
  const file = "src/invites/accept.ts";
  const first = launch({ task: TASK, taskAgents: [] });
  act(() => first.control().onOpenFile({ path: file }));
  act(() => first.control().onPin({ task: TASK }, fileTab(file), "accept.ts"));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [] });
  act(() => second.control().onShow(TASK, fileTab(file)));
  assert.deepEqual(second.control().tab, fileTab(file));
  assert.deepEqual(second.control().strip.at(-1), fileTab(file));
});

test("a tab pinned to the sidebar keeps the place a drag gave it across a launch, on this Mac", () => {
  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(AGENT)));
  act(() => first.control().onPin({ task: TASK }, changesTab(AGENT), "Changes: Invite flow"));
  const at = first.control().pins[0]?.at ?? assert.fail("the tab is pinned");
  act(() => first.control().onPlacePins(new Map([[at, "a3"]])));
  first.quit();

  const second = launch({ task: TASK, taskAgents: [AGENT] });
  assert.equal(second.control().pins[0]?.position, "a3");
});

test("a file named alone, as ⌘K finds it, shows the tab it has as it stands, and another opens in a tab the plan draws", () => {
  const shown = "src/invites/accept.ts";
  const found = "src/invites/expire.ts";
  let control: SidePanelControl | undefined;
  function Probe() {
    control = useSidePanel(undefined, usedTask(TASK), [], [], [], []);
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

  act(() => now().onOpenFile({ path: shown }));
  assert.deepEqual(now().tab, fileTab(shown));
  assert.deepEqual(
    now().files.map(({ path, range }) => ({ path, range })),
    [{ path: shown, range: { startLine: 3, endLine: 5 } }],
    "the tab keeps the lines it had lit",
  );

  act(() => now().onOpenFile({ path: found }));
  assert.deepEqual(now().tab, fileTab(found));
  assert.deepEqual(
    now().files.map(({ path }) => path),
    [shown, found],
  );
});

test("the agent whose Terminal tab was shown last on a plan is the plan's own, which ⌘J goes to among several", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  assert.equal(panel.control().lastTerminal, undefined);
  act(() => panel.control().onChoose(CLOUD));
  act(() => panel.control().onChoose(OTHER_CLOUD));
  act(() => panel.control().onChoose(changesTab(AGENT)));
  assert.equal(panel.control().lastTerminal, OTHER_AGENT);
  panel.render({ task: OTHER_TASK, taskAgents: [] });
  assert.equal(panel.control().lastTerminal, undefined);
});

test('closing the last tab shuts the panel and leaves full screen, and the toggle with nothing to show asks for the "+" at the toggle, a pick opening the panel on it', () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => panel.control().onChoose(changesTab(AGENT)));
  act(() => panel.control().onToggleFullScreen());
  assert.equal(panel.control().fullScreen, true);

  act(() => panel.control().onClose(changesTab(AGENT)));
  assert.equal(panel.control().open, false);
  assert.equal(panel.control().fullScreen, false);

  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, false, "never shown with nothing in it");
  assert.equal(panel.control().toggleAsked, true, 'the "+" is asked for at the toggle');

  act(() => panel.control().onChoose(changesTab(AGENT)));
  assert.equal(panel.control().open, true);
  assert.equal(panel.control().fullScreen, false, "shown again beside the document");
  assert.deepEqual(panel.control().tab, changesTab(AGENT));
  assert.equal(panel.control().toggleAsked, false);
});

test("a new stop starts with the panel shut, whatever its strip holds, unless a tab was asked for there, as a pin or a link opens one, and a plan whose strip holds no tab draws none", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT] });
  // Note that the agent works on both tasks, so its Terminal tab stands on each.
  act(() => panel.control().onChoose(CLOUD));
  assert.equal(panel.control().open, true);

  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.deepEqual(panel.control().strip, [CLOUD]);
  assert.equal(
    panel.control().open,
    false,
    "another task starts shut though its strip holds a tab",
  );
  panel.render({ task: TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, false, "and coming back does not open it");

  act(() => panel.control().onShow(OTHER_TASK, CLOUD));
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, true, "a tab asked for on the stop arrived at stands");
  panel.render({ task: TASK, taskAgents: [AGENT] });
  panel.render({ task: OTHER_TASK, taskAgents: [AGENT] });
  assert.equal(panel.control().open, false, "once only");

  panel.render({ task: BARE_TASK, taskAgents: [], bare: true });
  assert.deepEqual(panel.control().strip, []);
  act(() => panel.control().onToggle());
  assert.equal(panel.control().open, false, "with nothing to show it is never drawn");
  assert.equal(panel.control().toggleAsked, true);
  act(() => panel.control().onToggle());
  assert.equal(panel.control().toggleAsked, false, "the toggle again takes the ask back");
  act(() => panel.control().onNewTab());
  assert.equal(panel.control().toggleAsked, true, "⌘T asks at the toggle too");
  panel.render({ task: TASK, taskAgents: [] });
  assert.equal(panel.control().toggleAsked, false, "an ask stands only on its plan");
});

test("each Inbox item is a stop of its own, so the panel a link opened beside one is shut beside the next, though both are one task's", () => {
  let control: SidePanelControl | undefined;
  function Probe({ item }: { item: string }) {
    control = useSidePanel(
      undefined,
      { id: TASK, holds: {}, bare: true, stop: item },
      [],
      [],
      [],
      [AGENT],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (item: string) => act(() => root.render(createElement(Probe, { item })));
  const panel = () => control ?? assert.fail("the panel is held");

  render("item-1");
  act(() => panel().onPreview(changesTab(AGENT)));
  assert.equal(panel().open, true);
  render("item-2");
  assert.deepEqual(panel().strip, [changesTab(AGENT)]);
  assert.equal(panel().open, false);
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
  act(() => panel().onChoose(changesTab(AGENT)));

  render(true);
  assert.deepEqual(panel().strip, [changesTab(AGENT)], "no fixed tab stands beside the Inbox");
  act(() => panel().onOpenFile({ path: "src/invites.ts", startLine: 3, endLine: 5 }, COMMIT));
  assert.deepEqual(panel().strip, [changesTab(AGENT), fileTab("src/invites.ts")]);
  assert.deepEqual(panel().tab, fileTab("src/invites.ts"));

  render(false);
  assert.deepEqual(panel().strip, [changesTab(AGENT), fileTab("src/invites.ts")]);
});

test("a panel kept open launches shown only where the task's strip holds a tab, whatever tab was chosen, and never empty", () => {
  // Note that the tab chosen as the window quit is kept nowhere here, as a Terminal's is not.
  const kept = { open: true, tabs: ["comments"], width: 400, pins: [] };
  window.localStorage.setItem("app.sidePanel", JSON.stringify({ ...kept, tasks: {} }));
  const bare = launch({ task: TASK, taskAgents: [], bare: true });
  assert.deepEqual(bare.control().strip, []);
  assert.equal(bare.control().open, false, "with nothing to draw it stands hidden, not empty");
  bare.quit();

  const first = launch({ task: TASK, taskAgents: [AGENT] });
  act(() => first.control().onChoose(changesTab(AGENT)));
  first.quit();
  const held = launch({ task: TASK, taskAgents: [AGENT] });
  assert.equal(held.control().open, true, "a tab the strip holds shows it");
  assert.deepEqual(held.control().tab, changesTab(AGENT));
});

test("a record kept while the Call and Code stood in the panel reads with their tabs let go from the strip, and the Call's pin let go too", () => {
  window.localStorage.setItem(
    "app.sidePanel",
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
    [],
    "neither the Call, Code, nor the Board stands in the strip",
  );
  assert.equal(panel.control().tab, undefined);
  assert.deepEqual(panel.control().pins, [], "a pin of the Call, which is gone, is let go");
});

test("an Inbox tab an earlier version pinned, a task's or an agent's, is let go, since threads open in the window's Inbox", () => {
  window.localStorage.setItem(
    "app.sidePanel",
    JSON.stringify({
      open: false,
      tabs: ["comments"],
      width: 400,
      pins: [{ task: TASK, tab: "inbox", label: "Inbox", at: 1 }],
      agentPins: [{ agent: AGENT, tab: "inbox", label: "Inbox", at: 2 }],
    }),
  );
  const panel = launch({ task: TASK, taskAgents: [] });
  assert.deepEqual(panel.control().pins, []);
});

test("a narrow room holds the open panel full screen alone, so the window's ways out of full screen shut it there, and a room widened again stands it beside the document", () => {
  let room: ShellRoom = SHELL_ROOM.NARROW;
  let control: SidePanelControl | undefined;
  function Probe({ at }: { at: ShellRoom }) {
    control = useSidePanel(undefined, usedTask(TASK), [AGENT], [], [], [AGENT], at);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = () => act(() => root.render(createElement(Probe, { at: room })));
  const now = () => control ?? assert.fail("the panel is held");
  // The panel opens on a tab chosen, which the narrow room holds full screen.
  render();
  act(() => now().onChoose(changesTab(AGENT)));
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
    control = useSidePanel(undefined, task, [AGENT], [], [], [AGENT], at);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const now = () => control ?? assert.fail("the panel is held");
  const render = (at: ShellRoom, task: OpenTask) =>
    act(() => root.render(createElement(Probe, { at, task })));
  // The panel stands open on a plan once a tab is chosen, and is kept open for the next launch.
  render(SHELL_ROOM.NARROW, usedTask(TASK));
  act(() => now().onChoose(changesTab(AGENT)));
  assert.equal(now().open, true);
  assert.equal(JSON.parse(window.localStorage.getItem("app.sidePanel") ?? "{}").open, true);

  for (const room of [SHELL_ROOM.NARROW, SHELL_ROOM.WIDE]) {
    render(room, { id: undefined, holds: {}, bare: true });
    assert.deepEqual(
      [now().open, now().fullScreen, now().fullScreenOnly],
      [false, false, false],
      `the ${room} room shows the Inbox with no panel over it`,
    );
  }
});

test("a link in the panel to an agent elsewhere carries the panel to the agent's task as it stands, where another move there starts it shut", () => {
  const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const AGENT_TASK = "6c8e0a2b-4d6f-4b8d-9f1a-3c5e7a9b1d2f";
  let control: SidePanelControl | undefined;
  function Probe({ on }: { on: string }) {
    control = useSidePanel(
      undefined,
      on === TASK
        ? { id: TASK, holds: {}, bare: true, pages: { taskId: TASK } }
        : { id: on, holds: {}, pages: { taskId: on } },
      [],
      [],
      [],
      [],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const render = (on: string) => act(() => root.render(createElement(Probe, { on })));
  const panel = () => {
    assert.ok(control);
    return control;
  };
  const pagesDrawn = () =>
    panel().strip.flatMap((tab) => (typeof tab === "object" && "page" in tab ? [tab.page] : []));

  render(TASK);
  act(() => panel().onPreview(pageTab(PAGE), { taskId: OTHER_TASK }));
  act(() => panel().onCarry());
  render(AGENT_TASK);
  assert.ok(panel().open, "the panel still open beside the agent's task");
  assert.deepEqual(panel().tab, pageTab(PAGE));
  assert.deepEqual(pagesDrawn(), [PAGE], "the page drawn there, read on its own task");
  assert.deepEqual(panel().pages[0]?.place, { taskId: OTHER_TASK });

  render(OTHER_AGENT);
  assert.equal(panel().open, false, "a move with nothing carried starts the next stop shut");
});

test("a page of another task opens beside the Inbox item, drawn there, and Open task lands on that task with the page still chosen and the panel open", () => {
  const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  let control: SidePanelControl | undefined;
  function Probe({ inbox }: { inbox: boolean }) {
    control = useSidePanel(
      undefined,
      inbox
        ? { id: TASK, holds: {}, bare: true, pages: { taskId: TASK } }
        : { ...usedTask(OTHER_TASK), pages: { taskId: OTHER_TASK } },
      [],
      [],
      inbox ? [] : [PAGE],
      [],
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

  render(true);
  act(() => panel().onPreview(pageTab(PAGE), { taskId: OTHER_TASK }));
  const pagesDrawn = () =>
    panel().strip.flatMap((tab) => (typeof tab === "object" && "page" in tab ? [tab.page] : []));
  assert.deepEqual(pagesDrawn(), [PAGE], "drawn beside the item it opened on");
  assert.deepEqual(panel().tab, pageTab(PAGE));
  assert.deepEqual(panel().pages[0]?.place, { taskId: OTHER_TASK }, "read on its own task");

  // Open task: the window goes to the page's task, showing the tab there (`onShowPanelTab`).
  act(() => panel().onShow(OTHER_TASK, pageTab(PAGE)));
  render(false);
  assert.deepEqual(panel().tab, pageTab(PAGE), "the page still chosen");
  assert.ok(panel().open, "the panel still open");
  assert.deepEqual(pagesDrawn(), [PAGE]);
});

test("a link opens its tab as the panel's preview, and the next link takes its place, so a run of links read leaves one tab", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview(changesTab(AGENT)));
  assert.deepEqual(panel.control().preview, changesTab(AGENT));
  assert.deepEqual(panel.control().tab, changesTab(AGENT));

  act(() => panel.control().onPreview(changesTab(OTHER_AGENT)));
  assert.deepEqual(panel.control().preview, changesTab(OTHER_AGENT));
  assert.deepEqual(panel.control().tab, changesTab(OTHER_AGENT));
  assert.deepEqual(
    panel.control().changes,
    [changesTab(OTHER_AGENT)],
    "the first preview gave way",
  );
});

test("a preview kept stands as a tab of its own, so the next link opens beside it rather than in its place", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview(changesTab(AGENT)));
  act(() => panel.control().onKeep(changesTab(AGENT)));
  assert.equal(panel.control().preview, undefined);

  act(() => panel.control().onPreview(changesTab(OTHER_AGENT)));
  assert.deepEqual(panel.control().changes, [changesTab(AGENT), changesTab(OTHER_AGENT)]);
  assert.deepEqual(panel.control().preview, changesTab(OTHER_AGENT));
});

test("a link to a tab standing as one of its own only chooses it, the preview standing", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onChoose(changesTab(AGENT)));
  act(() => panel.control().onPreview(changesTab(OTHER_AGENT)));
  act(() => panel.control().onPreview(changesTab(AGENT)));
  assert.deepEqual(panel.control().tab, changesTab(AGENT));
  assert.deepEqual(panel.control().preview, changesTab(OTHER_AGENT), "the preview still stands");
});

test("a preview closed lets its preview go, so the same tab opened again by a chosen door stands as a tab of its own", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreview(changesTab(AGENT)));
  act(() => panel.control().onClose(changesTab(AGENT)));
  act(() => panel.control().onChoose(changesTab(AGENT)));
  assert.equal(panel.control().preview, undefined);
});

test("a preview browsed on to another file stays the preview on that file, so the next link still takes its place", () => {
  const panel = launch({ task: TASK, taskAgents: [AGENT, OTHER_AGENT] });
  act(() => panel.control().onPreviewFile({ path: "src/a.ts" }));
  assert.deepEqual(panel.control().preview, fileTab("src/a.ts"));
  act(() => panel.control().onBrowseFile("src/a.ts", "src/b.ts", false));
  assert.deepEqual(panel.control().preview, fileTab("src/b.ts"));

  act(() => panel.control().onPreview(changesTab(AGENT)));
  assert.deepEqual(panel.control().preview, changesTab(AGENT));
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
  act(() => panel().onPreview(transcriptTab(AGENT)));
  assert.deepEqual(panel().strip, [transcriptTab(AGENT)]);
  assert.deepEqual(panel().preview, transcriptTab(AGENT));
  act(() => panel().onPreview(transcriptTab(OTHER_AGENT)));
  assert.deepEqual(panel().strip, [transcriptTab(OTHER_AGENT)], "the next link took its place");

  render(false);
  assert.ok(
    !panel().strip.some((tab) => typeof tab === "object" && "transcript" in tab),
    "a task's own page draws its agents in its column, never beside",
  );
});

test("an archived agent's Pull request tab is drawn as a live agent's, while its Terminal tab is not", () => {
  const drawn = { taskAgents: ["live"], heldAgents: ["live", "archived"] };
  assert.equal(drawsChanges(changesTab("archived"), drawn), true);
  assert.equal(drawsChanges(changesTab("other"), drawn), false);
  assert.equal(drawsTerminal({ ...CLOUD, terminal: "archived" }, drawn), false);
  // A place that names no held agents draws Pull request tabs by its live ones, as before.
  assert.equal(drawsChanges(changesTab("archived"), { taskAgents: ["live"] }), false);
});
