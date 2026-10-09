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

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** Mounts the panel alone over the agents the plan has now, answering the control as it stands. */
function mount(agents: readonly string[] | undefined) {
  let control: SidePanelControl | undefined;
  let restand: ((next: readonly string[] | undefined) => void) | undefined;
  function Probe({ held }: { held: readonly string[] | undefined }) {
    control = useSidePanel(undefined, held);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (held: readonly string[] | undefined) =>
    act(() => root.render(createElement(Probe, { held })));
  restand = render;
  render(agents);
  return {
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: (next: readonly string[] | undefined) => restand?.(next),
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
