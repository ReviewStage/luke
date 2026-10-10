// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  isAgentTab,
  SIDE_PANEL_TAB,
  SIDE_PANEL_TABS,
  type SidePanelControl,
  sameTab,
  shownTab,
  tabKey,
  useSidePanel,
} from "./use-side-panel";

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

/** The agents the plan has, and the subagents its work holds, each nothing while unread. */
type Stood = readonly (readonly string[] | undefined)[];

/** Mounts the panel alone over the agents and subagents the plan has now, answering the control as it stands. */
function mount(agents: readonly string[] | undefined, subagents?: readonly string[]) {
  let control: SidePanelControl | undefined;
  let restand: ((next: Stood) => void) | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useSidePanel(undefined, held[0], held[1]);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (held: Stood) => act(() => root.render(createElement(Probe, { held })));
  restand = render;
  render([agents, subagents]);
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: (next: readonly string[] | undefined, nextSubagents?: readonly string[]) =>
      restand?.([next, nextSubagents]),
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

test("a subagent's tab opens from its call once and is chosen, closes to its neighbour, is held to the plan's work, and is kept across no launch", () => {
  const first = mount([AGENT], [CALL, OTHER_CALL]);
  act(() => first.control().onChoose({ subagent: CALL }));
  assert.equal(first.control().open, true);
  assert.deepEqual(first.control().tab, { subagent: CALL });

  // Opened again, the one open is chosen rather than a second added.
  act(() => first.control().onChoose({ subagent: OTHER_CALL }));
  act(() => first.control().onChoose({ subagent: CALL }));
  assert.deepEqual(first.control().subagents, [CALL, OTHER_CALL]);
  assert.deepEqual(first.control().tab, { subagent: CALL });

  // Closing the chosen one chooses the subagent after it; closing the last, the plan's last agent.
  act(() => first.control().onClose({ subagent: CALL }));
  assert.deepEqual(first.control().subagents, [OTHER_CALL]);
  assert.deepEqual(first.control().tab, { subagent: OTHER_CALL });

  // Another plan, with no work read or no turn, shows the board; the call back shows the tab again.
  first.stand([AGENT]);
  assert.equal(first.control().tab, SIDE_PANEL_TAB.BOARD);
  first.stand([AGENT], [OTHER_CALL]);
  assert.deepEqual(first.control().tab, { subagent: OTHER_CALL });
  act(() => first.control().onClose({ subagent: OTHER_CALL }));
  assert.deepEqual(first.control().subagents, []);
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // A launch after a subagent's tab was chosen opens none, on the first tab.
  act(() => first.control().onChoose({ subagent: CALL }));
  const second = mount(undefined);
  assert.deepEqual(second.control().subagents, []);
  assert.equal(second.control().tab, SIDE_PANEL_TAB.BOARD);
});

test("with no agent, closing the last fixed tab chooses a subagent tab the plan draws, and a closed subagent's neighbour is one the plan's work holds, never another plan's", () => {
  const panel = mount([], [CALL]);
  act(() => panel.control().onChoose({ subagent: CALL }));
  // On another plan, its own subagent closed has the first plan's, not in the strip, for no neighbour.
  panel.stand([], [OTHER_CALL]);
  act(() => panel.control().onChoose({ subagent: OTHER_CALL }));
  act(() => panel.control().onClose({ subagent: OTHER_CALL }));
  assert.equal(panel.control().tab, SIDE_PANEL_TAB.WORK);

  panel.stand([], [CALL]);
  for (const tab of SIDE_PANEL_TABS) act(() => panel.control().onClose(tab));
  assert.deepEqual(panel.control().tab, { subagent: CALL });
  act(() => panel.control().onClose({ subagent: CALL }));
  assert.equal(panel.control().tab, undefined);
  assert.deepEqual(panel.control().subagents, []);
});
