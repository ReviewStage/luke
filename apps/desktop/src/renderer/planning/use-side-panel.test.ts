// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { usedPlan } from "#testing/plans-control";
import {
  isAgentTab,
  type OpenPlan,
  type PlanHolds,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  sameTab,
  shownTab,
  tabKey,
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

/** The agents the plan has, and the subagents its work holds, each nothing while unread, and its draft agent's key. */
interface Stood {
  agents: readonly string[] | undefined;
  subagents: readonly string[] | undefined;
  draft?: string | undefined;
  /** The files Luke showed on the plan, by path. */
  files?: readonly string[] | undefined;
  /** The open plan and what it holds; one that has used every fixed tab where absent. */
  plan?: OpenPlan;
}

/** Mounts the panel alone over the plan, agents, subagents, draft, and files the plan has now, answering the control as it stands. */
function mountStood(stood: Stood) {
  let control: SidePanelControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(
      undefined,
      held.plan ?? usedPlan(PLAN),
      held.agents,
      held.subagents,
      held.draft,
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

/** Mounts the panel alone over the agents, subagents, draft, and files a plan that has used every fixed tab has now. */
function mount(
  agents: readonly string[] | undefined,
  subagents?: readonly string[],
  draft?: string,
  files?: readonly string[],
) {
  const { control, render } = mountStood({ agents, subagents, draft, files });
  return {
    control,
    stand: (
      next: readonly string[] | undefined,
      nextSubagents?: readonly string[],
      nextDraft?: string,
      nextFiles?: readonly string[],
    ) => render({ agents: next, subagents: nextSubagents, draft: nextDraft, files: nextFiles }),
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

test("a tab is a fixed word or one agent's, told apart and keyed without a joined string", () => {
  assert.equal(isAgentTab(SIDE_PANEL_TAB.BOARD), false);
  assert.equal(isAgentTab({ agent: AGENT }), true);
  assert.equal(sameTab({ agent: AGENT }, { agent: AGENT }), true);
  assert.equal(sameTab({ agent: AGENT }, { agent: OTHER }), false);
  assert.equal(sameTab(SIDE_PANEL_TAB.CODE, { agent: AGENT }), false);
  assert.equal(tabKey({ agent: AGENT }), AGENT);
  assert.equal(tabKey(SIDE_PANEL_TAB.CODE), SIDE_PANEL_TAB.CODE);
});

test("a kept agent tab stands while the agents are unread, shows while its agent is among them, and reads as the first open tab once it is not", () => {
  assert.deepEqual(shownTab({ agent: AGENT }, SIDE_PANEL_TABS, undefined), { agent: AGENT });
  assert.deepEqual(shownTab({ agent: AGENT }, SIDE_PANEL_TABS, [OTHER, AGENT]), { agent: AGENT });
  assert.equal(shownTab({ agent: AGENT }, SIDE_PANEL_TABS, [OTHER]), SIDE_PANEL_TAB.BOARD);
  assert.equal(shownTab({ agent: AGENT }, [SIDE_PANEL_TAB.CODE], [OTHER]), SIDE_PANEL_TAB.CODE);
  assert.equal(shownTab({ agent: AGENT }, [], [OTHER]), undefined);
  assert.equal(shownTab(SIDE_PANEL_TAB.TRANSCRIPT, SIDE_PANEL_TABS, []), SIDE_PANEL_TAB.TRANSCRIPT);
});

test("choosing an agent's tab opens the panel on it and keeps it across a launch, where the plan's agents decide whether it shows", () => {
  const first = mount([AGENT]);
  act(() => first.control().onChoose({ agent: AGENT }));
  assert.equal(first.control().open, true);
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // The agents come and go: without this one the board shows, and with it back the tab is still the kept one.
  first.stand([OTHER]);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);
  first.stand([OTHER, AGENT]);
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // Another launch reads the kept tab back, and holds it to the plan's agents the same way.
  const kept = window.localStorage.getItem("luke.sidePanel");
  assert.ok(kept?.includes(AGENT));
  const second = mount(undefined);
  assert.deepEqual(second.control().tab, { agent: AGENT });
  second.stand([]);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});

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
  act(() => panel.control().onChoose({ agent: AGENT }));
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
  assert.deepEqual(panel.control().tab, { agent: AGENT });
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

test("an agent's tab closes to the tab viewed before it, stays closed across a launch while an agent started since opens, and opens again when chosen", () => {
  const THIRD = "3b8f4e5d-7c6a-4b9f-9eaf-4a5b6c7d8e9f";
  const first = mount([AGENT, OTHER, THIRD]);
  for (const agent of [THIRD, AGENT, OTHER]) act(() => first.control().onChoose({ agent }));

  act(() => first.control().onClose({ agent: OTHER }));
  assert.deepEqual(first.control().closedAgents, [OTHER]);
  assert.deepEqual(first.control().tab, { agent: AGENT });
  act(() => first.control().onClose({ agent: AGENT }));
  assert.deepEqual(
    first.control().tab,
    { agent: THIRD },
    "the one viewed before it, not beside it",
  );
  act(() => first.control().onClose({ agent: THIRD }));
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD, "the tab shown before any was chosen");
  assert.equal(first.control().open, true, "closing tabs leaves the panel open");

  // Closing a tab that is not chosen leaves the chosen one.
  act(() => first.control().onChoose({ agent: AGENT }));
  act(() => first.control().onChoose({ agent: THIRD }));
  assert.deepEqual(first.control().closedAgents, [OTHER]);
  act(() => first.control().onClose({ agent: AGENT }));
  assert.deepEqual(first.control().tab, { agent: THIRD });

  // Another launch keeps the tabs closed, and an agent the plan started since stands open.
  const NEWER = "4c9a5f6e-8d7b-4cae-afb0-5b6c7d8e9fa0";
  const second = mount([AGENT, OTHER, THIRD, NEWER]);
  assert.deepEqual(second.control().closedAgents, [OTHER, AGENT]);
  assert.deepEqual(second.control().tab, { agent: THIRD });

  // Choosing a closed agent's tab, from the "+", opens it again.
  act(() => second.control().onChoose({ agent: OTHER }));
  assert.deepEqual(second.control().closedAgents, [AGENT]);
  assert.deepEqual(second.control().tab, { agent: OTHER });
});

test("a draft agent's tab shows while the plan holds the draft, closes to the tab viewed before it, and is kept across no launch", () => {
  const DRAFT = "draft-key-1";
  const first = mount([AGENT], [], DRAFT);
  act(() => first.control().onChoose({ draft: DRAFT }));
  assert.deepEqual(first.control().tab, { draft: DRAFT });
  assert.equal(tabKey({ draft: DRAFT }), DRAFT);
  assert.equal(sameTab({ draft: DRAFT }, { draft: DRAFT }), true);
  assert.equal(sameTab({ draft: DRAFT }, { agent: DRAFT }), false);

  // Another plan holds no such draft: the first open tab shows, and the draft's again once back.
  first.stand([OTHER], []);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);
  first.stand([AGENT], [], DRAFT);
  assert.deepEqual(first.control().tab, { draft: DRAFT });

  // A draft's tab chosen is kept as no tab, which a launch reads as the first open one.
  const second = mount([AGENT], [], DRAFT);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);

  act(() => first.control().onChoose({ agent: AGENT }));
  act(() => first.control().onChoose({ draft: DRAFT }));
  act(() => first.control().onClose({ draft: DRAFT }));
  assert.deepEqual(first.control().tab, { agent: AGENT });
});

const INVITE = "src/invite.ts";
const ROLES = "src/roles.ts";

test("opening a file opens its tab at the strip's end and chooses it, its lines lit, and opening it again chooses the one tab and moves its lit lines", () => {
  const panel = mount([], [], undefined, [INVITE, ROLES]);

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
  const first = mount([], [], undefined, [INVITE, ROLES]);
  act(() => first.control().onOpenFile({ path: INVITE }));
  act(() => first.control().onOpenFile({ path: ROLES }));

  // Another plan, which showed neither file, draws neither tab.
  first.stand([], [], undefined, ["README.md"]);
  assert.equal(first.control().tab, first.control().tabs[0]);
  first.stand([], [], undefined, [INVITE, ROLES]);
  act(() => first.control().onChoose({ file: INVITE }));
  act(() => first.control().onClose({ file: INVITE }));
  assert.deepEqual(first.control().tab, { file: ROLES });
  act(() => first.control().onClose({ file: ROLES }));
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD, "the tab shown before either opened");

  act(() => first.control().onOpenFile({ path: INVITE }));
  const second = mount([], [], undefined, [INVITE, ROLES]);
  assert.deepEqual(second.control().files, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
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

test("a plan with no fixed tab shows its first open agent's, and its fixed tab once one arrives is added beside it", () => {
  const panel = mountOn({ [SIDE_PANEL_TAB.WORK]: false }, [AGENT, OTHER]);
  assert.deepEqual(panel.control().tabs, []);
  assert.deepEqual(panel.control().tab, { agent: AGENT });

  panel.standOn({ [SIDE_PANEL_TAB.WORK]: true });
  assert.deepEqual(panel.control().tabs, [SIDE_PANEL_TAB.WORK]);
  assert.deepEqual(panel.control().tab, { agent: AGENT }, "the arrival takes no tab's place");
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

test("a subagent's and a file's tab pinned on a plan are open on it at the next launch, a draft's pin is kept nowhere, and closing a pinned tab unpins it", () => {
  const DRAFT = "draft-key-1";
  const delegated = { subagent: CALL, delegation: { agent: AGENT, task: "Find the sweep." } };
  const first = mount([AGENT], [], DRAFT, [INVITE, ROLES]);
  act(() => first.control().onOpenFile({ path: ROLES, startLine: 2, endLine: 2 }));
  act(() => first.control().onChoose(delegated));
  act(() => first.control().onChoose({ draft: DRAFT }));
  for (const tab of [{ file: ROLES }, delegated, { draft: DRAFT }, SIDE_PANEL_TAB.WORK]) {
    act(() => first.control().onPin(tab));
  }
  assert.deepEqual(first.control().pinned, [
    { file: ROLES },
    delegated,
    { draft: DRAFT },
    SIDE_PANEL_TAB.WORK,
  ]);

  const second = mount([AGENT], [], undefined, [INVITE, ROLES]);
  assert.deepEqual(second.control().pinned, [{ file: ROLES }, delegated, SIDE_PANEL_TAB.WORK]);
  assert.deepEqual(second.control().files, [{ path: ROLES, range: undefined, opened: 0 }]);
  assert.deepEqual(second.control().subagents, [delegated]);

  act(() => second.control().onClose({ file: ROLES }));
  act(() => second.control().onUnpin(SIDE_PANEL_TAB.WORK));
  assert.deepEqual(second.control().pinned, [delegated]);
  assert.deepEqual(second.control().files, []);
  assert.ok(second.control().tabs.includes(SIDE_PANEL_TAB.WORK), "unpinned, it stays open");

  act(() => second.control().onOpenFile({ path: ROLES }));
  act(() => second.control().onPin({ file: ROLES }));
  act(() => second.control().onClose(SIDE_PANEL_TAB.WORK));
  // Another plan showing the same file has no tab of it, and the plan whose only tab is now a pinned file shows it.
  const other = mountStood({
    plan: { id: "6f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f", holds: {} },
    agents: [],
    subagents: [],
    files: [ROLES],
  });
  assert.deepEqual(other.control().files, []);
  const alone = mountStood({
    plan: { id: PLAN, holds: {} },
    agents: [],
    subagents: [],
    files: [ROLES],
  });
  assert.deepEqual(alone.control().tab, { file: ROLES });
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
  const first = mount([AGENT], [], undefined, [INVITE]);
  act(() => first.control().onChoose({ agent: AGENT }));
  act(() => first.control().onOpenFile({ path: INVITE }));
  act(() => first.control().onChoose(SIDE_PANEL_TAB.CODE));

  const second = mount([AGENT], [], undefined, [INVITE]);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.CODE);
  act(() => second.control().onClose(SIDE_PANEL_TAB.CODE));
  assert.deepEqual(second.control().tab, { agent: AGENT });
  act(() => second.control().onClose({ agent: AGENT }));
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});
