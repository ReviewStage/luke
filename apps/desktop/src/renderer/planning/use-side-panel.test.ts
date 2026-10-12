// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { usedPlan } from "#testing/plans-control";
import { sameTab } from "./tab-strip-model";
import {
  type OpenPlan,
  type PlanHolds,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  useSidePanel,
} from "./use-side-panel";

const PLAN = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
const CALL = "call-worker-1";
const OTHER_CALL = "call-worker-2";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** The agents whose tabs stand open in the plan's column, and the subagents its work holds, each nothing while unread. */
interface Stood {
  agents: readonly string[] | undefined;
  subagents: readonly string[] | undefined;
  /** The files Luke showed on the plan, by path. */
  files?: readonly string[] | undefined;
  /** The open plan and what it holds; one that has used every fixed tab where absent. */
  plan?: OpenPlan;
}

/** Mounts the panel alone over the plan, agents, subagents, and files the plan has now, answering the control as it stands. */
function mountStood(stood: Stood) {
  let control: SidePanelControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(
      undefined,
      held.plan ?? usedPlan(PLAN),
      held.agents,
      held.subagents,
      held.files,
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
  };
}

/** Mounts the panel alone over the agents, subagents, and files a plan that has used every fixed tab has now. */
function mount(
  agents: readonly string[] | undefined,
  subagents?: readonly string[],
  files?: readonly string[],
) {
  const { control, render } = mountStood({ agents, subagents, files });
  return {
    control,
    stand: (
      next: readonly string[] | undefined,
      nextSubagents?: readonly string[],
      nextFiles?: readonly string[],
    ) => render({ agents: next, subagents: nextSubagents, files: nextFiles }),
  };
}

/** Mounts the panel alone over a plan holding the kinds given and the agents, and stands it on another. */
function mountOn(holds: PlanHolds, agents: readonly string[] = [], id = PLAN) {
  const { control, render } = mountStood({ plan: { id, holds }, agents, subagents: [] });
  return {
    control,
    standOn: (next: PlanHolds, nextId = id) =>
      render({ plan: { id: nextId, holds: next }, agents, subagents: [] }),
  };
}

test("a subagent's tab opens from its call once and is chosen, closes to the tab viewed before it, is held to the plan's work, and is kept across no launch", () => {
  const first = mount([AGENT], [CALL, OTHER_CALL]);
  act(() => first.control().onChoose({ subagent: CALL }));
  assert.equal(first.control().open, true);
  assert.deepEqual(first.control().tab, { subagent: CALL });

  // Opened again, the one open is chosen rather than a second added.
  act(() => first.control().onChoose({ subagent: OTHER_CALL }));
  act(() => first.control().onChoose({ subagent: CALL }));
  assert.deepEqual(first.control().subagents, [{ subagent: CALL }, { subagent: OTHER_CALL }]);
  assert.deepEqual(first.control().tab, { subagent: CALL });

  // Closing the chosen one chooses the tab viewed before it.
  act(() => first.control().onClose({ subagent: CALL }));
  assert.deepEqual(first.control().subagents, [{ subagent: OTHER_CALL }]);
  assert.deepEqual(first.control().tab, { subagent: OTHER_CALL });

  // Another plan, with no work read or no turn, shows the board; the call back shows the tab again.
  first.stand([AGENT]);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);
  first.stand([AGENT], [OTHER_CALL]);
  assert.deepEqual(first.control().tab, { subagent: OTHER_CALL });
  act(() => first.control().onClose({ subagent: OTHER_CALL }));
  assert.deepEqual(first.control().subagents, []);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);

  // A launch after a subagent's tab was chosen opens none, on the first tab.
  act(() => first.control().onChoose({ subagent: CALL }));
  const second = mount(undefined);
  assert.deepEqual(second.control().subagents, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});

test("a delegated worker's tab is held to the plan's agents: it stands while they are unread or hold its agent, reads as the first tab on another plan's, and closes to the tab viewed before it", () => {
  const panel = mount([AGENT]);
  const delegated = { subagent: CALL, delegation: { agent: AGENT, task: "Count the routes." } };
  act(() => panel.control().onChoose(delegated));
  assert.deepEqual(panel.control().tab, delegated);
  // Chosen again it is the one tab open; the planning worker's call of the same name is another tab, as the service names the two apart.
  act(() => panel.control().onChoose({ ...delegated }));
  assert.deepEqual(panel.control().subagents, [delegated]);
  assert.equal(sameTab(delegated, { subagent: CALL }), false);

  panel.stand([OTHER]);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.BOARD);
  panel.stand(undefined);
  assert.deepEqual(panel.control().tab, delegated);
  panel.stand([AGENT]);
  act(() => panel.control().onClose(delegated));
  assert.deepEqual(panel.control().subagents, []);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.BOARD);
});

test("a closed tab is replaced by one the plan draws, never a tab viewed that another plan's work holds, and closing the last leaves none", () => {
  const panel = mount([], [CALL]);
  act(() => panel.control().onChoose({ subagent: CALL }));
  // On another plan, its own subagent closed passes over the first plan's, viewed later but not in the strip.
  panel.stand([], [OTHER_CALL]);
  act(() => panel.control().onChoose({ subagent: OTHER_CALL }));
  act(() => panel.control().onClose({ subagent: OTHER_CALL }));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.BOARD);

  panel.stand([], [CALL]);
  for (const tab of SIDE_PANEL_TABS) act(() => panel.control().onClose(tab));
  assert.deepEqual(panel.control().tab, { subagent: CALL });
  act(() => panel.control().onClose({ subagent: CALL }));
  assert.equal(panel.control().tab, undefined);
  assert.deepEqual(panel.control().subagents, []);
});

const INVITE = "src/invite.ts";
const ROLES = "src/roles.ts";

test("opening a file opens its tab at the strip's end and chooses it, its lines lit, and opening it again chooses the one tab and moves its lit lines", () => {
  const panel = mount([], [], [INVITE, ROLES]);

  act(() => panel.control().onOpenFile({ path: INVITE, startLine: 4, endLine: 6 }));
  assert.equal(panel.control().open, true);
  assert.deepEqual(panel.control().tab, { file: INVITE });
  act(() => panel.control().onOpenFile({ path: ROLES }));
  act(() => panel.control().onOpenFile({ path: INVITE, startLine: 40, endLine: 40 }));

  assert.deepEqual(panel.control().files, [
    { path: INVITE, range: { startLine: 40, endLine: 40 }, opened: 2 },
    { path: ROLES, range: undefined, opened: 1 },
  ]);
  assert.deepEqual(panel.control().tab, { file: INVITE });
});

test("a file's tab closes to the tab viewed before it, is held to the files shown on the open plan, and is kept across no launch", () => {
  const first = mount([], [], [INVITE, ROLES]);
  act(() => first.control().onOpenFile({ path: INVITE }));
  act(() => first.control().onOpenFile({ path: ROLES }));

  // Another plan, which showed neither file, draws neither tab.
  first.stand([], [], ["README.md"]);
  assert.equal(first.control().tab, first.control().tabs[0]);
  first.stand([], [], [INVITE, ROLES]);
  act(() => first.control().onChoose({ file: INVITE }));
  act(() => first.control().onClose({ file: INVITE }));
  assert.deepEqual(first.control().tab, { file: ROLES });
  act(() => first.control().onClose({ file: ROLES }));
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD, "the tab shown before either opened");

  act(() => first.control().onOpenFile({ path: INVITE }));
  const second = mount([], [], [INVITE, ROLES]);
  assert.deepEqual(second.control().files, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});

test("a file browsed to from a File tab takes that tab's place, opens a tab of its own where ⌘ asks, and chooses the tab a file already has", () => {
  const panel = mount([], [], [INVITE, ROLES]);
  const README = "README.md";
  const STYLE = "docs/STYLE.md";
  act(() => panel.control().onOpenFile({ path: INVITE, startLine: 4, endLine: 6 }));
  act(() => panel.control().onOpenFile({ path: ROLES }));
  act(() => panel.control().onChoose({ file: INVITE }));

  act(() => panel.control().onBrowseFile(INVITE, README, false));
  assert.deepEqual(panel.control().tab, { file: README });
  assert.deepEqual(
    panel.control().files.map((file) => file.path),
    [README, ROLES],
    "in the place of the tab it was chosen from",
  );
  assert.equal(panel.control().files[0]?.range, undefined, "its lines lit nowhere");

  act(() => panel.control().onBrowseFile(README, STYLE, true));
  assert.deepEqual(panel.control().tab, { file: STYLE });
  assert.deepEqual(
    panel.control().files.map((file) => file.path),
    [README, ROLES, STYLE],
  );

  act(() => panel.control().onBrowseFile(STYLE, ROLES, false));
  assert.deepEqual(panel.control().tab, { file: ROLES });
  assert.deepEqual(
    panel.control().files.map((file) => file.path),
    [README, ROLES, STYLE],
    "one tab per file",
  );
  act(() => panel.control().onClose({ file: ROLES }));
  assert.deepEqual(
    panel.control().tab,
    { file: STYLE },
    "closing returns to the tab viewed before",
  );
});

test("a file browsed to stands on the plan it was browsed on, though Luke never showed it, and on no other", () => {
  const panel = mountStood({ agents: [], subagents: [], files: [INVITE] });
  act(() => panel.control().onOpenFile({ path: INVITE }));
  act(() => panel.control().onBrowseFile(INVITE, "README.md", true));
  assert.deepEqual(panel.control().tab, { file: "README.md" });

  panel.render({ plan: usedPlan(OTHER), agents: [], subagents: [], files: [INVITE] });
  assert.equal(panel.control().tab, panel.control().tabs[0], "another plan draws no tab of it");
  panel.render({ agents: [], subagents: [], files: [INVITE] });
  act(() => panel.control().onChoose({ file: "README.md" }));
  assert.deepEqual(panel.control().tab, { file: "README.md" });
});

test("what an earlier version kept loads as the order alone: the tabs it held open open none a plan has not used, and its chosen tab shows where a plan has it", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({ open: true, tabs: SIDE_PANEL_TABS, tab: SIDE_PANEL_TAB.CODE, width: 420 }),
  );
  const nothing = mountOn({});
  assert.equal(nothing.control().open, true);
  assert.equal(nothing.control().width, 420);
  assert.deepEqual(nothing.control().tabs, []);
  assert.equal(nothing.control().tab, undefined);
  nothing.standOn({ [SIDE_PANEL_TAB.BOARD]: true, [SIDE_PANEL_TAB.CODE]: true });
  assert.deepEqual(nothing.control().tabs, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE]);
  assert.equal(nothing.control().tab, SIDE_PANEL_TAB.CODE);

  // The fixed tabs it had closed stand last in the order, closed on no plan.
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: [SIDE_PANEL_TAB.WORK, SIDE_PANEL_TAB.CODE],
      tab: SIDE_PANEL_TAB.WORK,
      width: 400,
    }),
  );
  const closed = mountOn(usedPlan(PLAN).holds);
  assert.deepEqual(closed.control().tabs, [
    SIDE_PANEL_TAB.WORK,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.TRANSCRIPT,
  ]);
  assert.deepEqual(closed.control().closedTabs, []);

  // Before the tabs could close, the version kept no tabs at all.
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({ open: true, tab: SIDE_PANEL_TAB.CODE, width: 500 }),
  );
  assert.deepEqual(mountOn({ [SIDE_PANEL_TAB.WORK]: true }).control().tabs, [SIDE_PANEL_TAB.WORK]);
});

test("what a version with the History tab kept loads whole without it, wherever it named the tab", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["history", SIDE_PANEL_TAB.WORK, SIDE_PANEL_TAB.BOARD],
      tab: "history",
      width: 460,
      closedAgents: [AGENT],
      plans: {
        [PLAN]: {
          opened: ["history", SIDE_PANEL_TAB.CODE],
          closed: ["history"],
          pinned: ["history"],
          recent: ["history", SIDE_PANEL_TAB.WORK],
        },
      },
    }),
  );
  const panel = mountOn({ [SIDE_PANEL_TAB.WORK]: true }, [AGENT]);

  assert.equal(panel.control().open, true);
  assert.equal(panel.control().width, 460);
  assert.deepEqual(panel.control().tabs, [SIDE_PANEL_TAB.WORK, SIDE_PANEL_TAB.CODE]);
  assert.equal(
    panel.control().tab,
    SIDE_PANEL_TAB.WORK,
    "the History tab chosen reads as the first",
  );
  assert.deepEqual(panel.control().closedTabs, []);
  assert.deepEqual(panel.control().pins, [], "its History pin is let go");
  act(() => panel.control().onClose(SIDE_PANEL_TAB.WORK));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.CODE, "the tabs viewed read without it too");
});

test("a tab opened on a plan that holds nothing of it stands there across a launch, and on that plan alone", () => {
  const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
  const first = mountOn({});
  act(() => first.control().onChoose(SIDE_PANEL_TAB.BOARD));
  assert.deepEqual(first.control().tabs, [SIDE_PANEL_TAB.BOARD]);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);
  first.standOn({}, OTHER_PLAN);
  assert.deepEqual(first.control().tabs, []);
  assert.equal(first.control().tab, undefined);

  const second = mountOn({});
  assert.deepEqual(second.control().tabs, [SIDE_PANEL_TAB.BOARD]);
});

test("a fixed tab dragged among a plan's few keeps its place on a plan that has them all", () => {
  const panel = mountOn({ [SIDE_PANEL_TAB.BOARD]: true, [SIDE_PANEL_TAB.WORK]: true });
  act(() => panel.control().onMove(SIDE_PANEL_TAB.WORK, 0));
  assert.deepEqual(panel.control().tabs, [SIDE_PANEL_TAB.WORK, SIDE_PANEL_TAB.BOARD]);

  panel.standOn(usedPlan(PLAN).holds);
  assert.deepEqual(panel.control().tabs, [
    SIDE_PANEL_TAB.WORK,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.TRANSCRIPT,
  ]);
});

test("a chosen tab the plan does not have reads as the first of the strip, a subagent's moved ahead of the fixed tabs among them", () => {
  const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
  const onPlan = {
    plan: { id: PLAN, holds: { [SIDE_PANEL_TAB.CODE]: true } },
    agents: [],
    subagents: [CALL],
  };
  const panel = mountStood(onPlan);
  act(() => panel.control().onChoose({ subagent: CALL }));
  act(() => panel.control().onMove({ subagent: CALL }, 0));
  act(() => panel.control().onChoose(SIDE_PANEL_TAB.CODE));

  panel.render({
    plan: { id: OTHER_PLAN, holds: { [SIDE_PANEL_TAB.BOARD]: true } },
    agents: [],
    subagents: [],
  });
  act(() => panel.control().onChoose(SIDE_PANEL_TAB.BOARD));
  panel.render(onPlan);
  assert.deepEqual(panel.control().tab, { subagent: CALL });
});
test("tabs of every kind moved on one plan stand in that order on that plan alone", () => {
  const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
  const holds = usedPlan(PLAN).holds;
  const panel = mountStood({ plan: { id: PLAN, holds }, agents: [], subagents: [CALL] });
  act(() => panel.control().onChoose({ subagent: CALL }));
  act(() => panel.control().onMove({ subagent: CALL }, 0));
  act(() => panel.control().onMove(SIDE_PANEL_TAB.TRANSCRIPT, 0));
  assert.deepEqual(panel.control().order, [
    SIDE_PANEL_TAB.TRANSCRIPT,
    { subagent: CALL },
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.WORK,
  ]);
  assert.deepEqual(panel.control().tabs, [
    SIDE_PANEL_TAB.TRANSCRIPT,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.WORK,
  ]);

  panel.render({ plan: { id: OTHER_PLAN, holds }, agents: [], subagents: [] });
  assert.deepEqual(panel.control().order, []);
  assert.deepEqual(panel.control().tabs, [
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.TRANSCRIPT,
    SIDE_PANEL_TAB.WORK,
  ]);
});
test("a tab pinned to the sidebar is kept across a launch with its plan and name, newest first, outlives its tab's close, and goes with an unpin", () => {
  const first = mount([AGENT], [], [ROLES]);
  act(() => first.control().onPin(SIDE_PANEL_TAB.WORK, "Work"));
  act(() => first.control().onOpenFile({ path: ROLES }));
  act(() => first.control().onPin({ file: ROLES }, "roles.ts"));
  act(() => first.control().onPin({ file: ROLES }, "roles.ts"));
  act(() => first.control().onClose({ file: ROLES }));

  const second = mount([AGENT], [], [ROLES]);
  const pinned = second.control().pins.map(({ plan, tab, label }) => ({ plan, tab, label }));
  assert.deepEqual(pinned, [
    { plan: PLAN, tab: { file: ROLES }, label: "roles.ts" },
    { plan: PLAN, tab: SIDE_PANEL_TAB.WORK, label: "Work" },
  ]);
  assert.deepEqual(second.control().files, [], "the closed tab stays closed, its pin standing");

  act(() => second.control().onUnpin(PLAN, SIDE_PANEL_TAB.WORK));
  assert.deepEqual(
    second.control().pins.map((pin) => pin.tab),
    [{ file: ROLES }],
  );
  assert.ok(second.control().tabs.includes(SIDE_PANEL_TAB.WORK), "unpinned, its tab stays open");
});

test("a pinned agent takes the name its tab has now on its own plan, and keeps the one it has elsewhere", () => {
  const panel = mount([AGENT]);
  act(() => panel.control().onPin({ agent: AGENT }, "GPT-5.5"));
  act(() => panel.control().onRenamePins(OTHER, new Map([[AGENT, "Elsewhere"]])));
  assert.equal(panel.control().pins[0]?.label, "GPT-5.5");

  act(() => panel.control().onRenamePins(PLAN, new Map([[AGENT, "Invite flow"]])));
  assert.equal(panel.control().pins[0]?.label, "Invite flow");
});

test("a file shown from its pin before the plan's code is read is chosen once it is, though other tabs arrive first", () => {
  const { TRANSCRIPT, BOARD, CODE } = SIDE_PANEL_TAB;
  const panel = mountStood({
    plan: { id: PLAN, holds: { [TRANSCRIPT]: true } },
    agents: [],
    subagents: [],
  });
  act(() => panel.control().onShow(PLAN, { file: ROLES }));
  assert.equal(panel.control().tab, TRANSCRIPT, "standing in while the file is unread");

  panel.render({
    plan: { id: PLAN, holds: { [TRANSCRIPT]: true, [BOARD]: true } },
    agents: [],
    subagents: [],
  });
  panel.render({
    plan: { id: PLAN, holds: { [TRANSCRIPT]: true, [BOARD]: true, [CODE]: true } },
    agents: [],
    subagents: [],
    files: [ROLES],
  });
  assert.deepEqual(panel.control().tab, { file: ROLES });
});

test("the tabs an earlier version pinned in each plan's strip read as pinned to the sidebar, older than any pinned since, a subagent's let go", () => {
  const OTHER_PLAN = "6f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: SIDE_PANEL_TABS,
      width: 400,
      plans: {
        [PLAN]: {
          opened: [SIDE_PANEL_TAB.CODE],
          closed: [],
          pinned: [SIDE_PANEL_TAB.CODE, { agent: AGENT }, { subagent: CALL }],
        },
        [OTHER_PLAN]: { opened: [], closed: [], pinned: [{ file: "src/team/roles.ts" }] },
      },
    }),
  );
  const panel = mount([AGENT]);
  act(() => panel.control().onPin(SIDE_PANEL_TAB.WORK, "Work"));

  const pinned = panel.control().pins.map(({ plan, tab, label }) => ({ plan, tab, label }));
  assert.deepEqual(pinned, [
    { plan: PLAN, tab: SIDE_PANEL_TAB.WORK, label: "Work" },
    { plan: PLAN, tab: SIDE_PANEL_TAB.CODE, label: "Code" },
    { plan: PLAN, tab: { agent: AGENT }, label: "Coding agent" },
    { plan: OTHER_PLAN, tab: { file: "src/team/roles.ts" }, label: "roles.ts" },
  ]);

  // The strip's own pins are read once: the record now holds the sidebar's alone.
  const kept = window.localStorage.getItem("luke.sidePanel") ?? "";
  assert.equal(kept.includes('"pinned"'), false);
  assert.equal(mount([AGENT]).control().pins.length, 4);
});

test("closing the tab shown returns to the one viewed before it, wherever it stands in the strip, and closing another leaves the one shown", () => {
  const panel = mount([]);
  const { BOARD, CODE, TRANSCRIPT, WORK } = SIDE_PANEL_TAB;
  for (const tab of [CODE, TRANSCRIPT, WORK]) act(() => panel.control().onChoose(tab));
  act(() => panel.control().onClose(WORK));
  assert.equal(panel.control().tab, TRANSCRIPT);

  // Board stands two tabs from Work, so the neighbour would be Transcript.
  act(() => panel.control().onChoose(BOARD));
  act(() => panel.control().onChoose(WORK));
  act(() => panel.control().onClose(WORK));
  assert.equal(panel.control().tab, BOARD);

  act(() => panel.control().onClose(CODE));
  assert.equal(panel.control().tab, BOARD, "a tab not shown closes alone");
});

test("each plan returns to the tabs viewed on it, not those viewed on another", () => {
  const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
  const { BOARD, CODE, TRANSCRIPT, WORK } = SIDE_PANEL_TAB;
  const used = usedPlan(PLAN).holds;
  const panel = mountOn(used);
  act(() => panel.control().onChoose(BOARD));
  act(() => panel.control().onChoose(WORK));

  panel.standOn(used, OTHER_PLAN);
  act(() => panel.control().onChoose(TRANSCRIPT));
  act(() => panel.control().onChoose(CODE));

  // Code, chosen last on the other plan, is the tab this one shows; closing it returns to this plan's own.
  panel.standOn(used, PLAN);
  assert.equal(panel.control().tab, CODE);
  act(() => panel.control().onClose(CODE));
  assert.equal(panel.control().tab, WORK);
});

test("with every tab viewed closed, closing the one shown chooses the tab after it, else the one before", () => {
  const panel = mount([]);
  const { BOARD, CODE, TRANSCRIPT, WORK } = SIDE_PANEL_TAB;
  act(() => panel.control().onChoose(TRANSCRIPT));
  act(() => panel.control().onClose(BOARD));
  act(() => panel.control().onClose(TRANSCRIPT));
  assert.equal(panel.control().tab, WORK);
  act(() => panel.control().onClose(WORK));
  assert.equal(panel.control().tab, CODE);
});

test("the tabs viewed on a plan are kept across a launch, a file's dropping out as its tab does", () => {
  const first = mount([AGENT], [], [INVITE]);
  act(() => first.control().onChoose(SIDE_PANEL_TAB.WORK));
  act(() => first.control().onOpenFile({ path: INVITE }));
  act(() => first.control().onChoose(SIDE_PANEL_TAB.CODE));

  const second = mount([AGENT], [], [INVITE]);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.CODE);
  act(() => second.control().onClose(SIDE_PANEL_TAB.CODE));
  assert.equal(second.control().tab, SIDE_PANEL_TAB.WORK);
  act(() => second.control().onClose(SIDE_PANEL_TAB.WORK));
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});

test("an agent's tab an earlier version kept in the panel is let go: chosen, it reads as the first tab, and it leaves the order and the tabs viewed", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: SIDE_PANEL_TABS,
      tab: { agent: AGENT },
      width: 400,
      closedAgents: [OTHER],
      plans: {
        [PLAN]: {
          opened: [],
          closed: [],
          recent: [SIDE_PANEL_TAB.CODE, { agent: AGENT }],
          order: [{ agent: AGENT }, SIDE_PANEL_TAB.WORK],
        },
      },
    }),
  );
  const panel = mount([AGENT]);
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.WORK, "the first of the strip, as moved");
  assert.deepEqual(panel.control().order, [SIDE_PANEL_TAB.WORK]);
  act(() => panel.control().onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => panel.control().onClose(SIDE_PANEL_TAB.TRANSCRIPT));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.WORK, "the tab shown before it, not an agent's");

  const kept = window.localStorage.getItem("luke.sidePanel") ?? "";
  assert.equal(kept.includes(AGENT), false);
  assert.equal(kept.includes(OTHER), false);
});
