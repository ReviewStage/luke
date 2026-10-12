// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { MAIN_TAB, type MainTabsControl, useMainTabs } from "./use-main-tabs";

const PLAN = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";
const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
const THIRD = "3b8f4e5d-7c6a-4b9f-9eaf-4a5b6c7d8e9f";
const DRAFT = "draft-key-1";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** The open plan, its agents, nothing while unread, and its draft's key. */
interface Stood {
  plan?: string;
  agents: readonly string[] | undefined;
  draft?: string | undefined;
  fixture?: boolean;
}

/** Mounts the column's tabs alone over what the plan holds now, answering the control as it stands. */
function mount(stood: Stood) {
  let control: MainTabsControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useMainTabs(held.fixture ?? false, held.plan ?? PLAN, held.agents, held.draft);
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

test("the plan's tab stands first and alone on a plan with no agent, and is shown, never closing", () => {
  const column = mount({ agents: [] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
  assert.equal(column.control().tab, MAIN_TAB.PLAN);
  act(() => column.control().onClose(MAIN_TAB.PLAN));
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
});

test("the agents' tabs follow the plan's in the order started, and the draft's after them while the plan holds it", () => {
  const column = mount({ agents: [AGENT, OTHER], draft: DRAFT });
  assert.deepEqual(column.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: AGENT },
    { agent: OTHER },
    { draft: DRAFT },
  ]);
  column.render({ agents: [AGENT, OTHER] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: AGENT }, { agent: OTHER }]);
});

test("choosing an agent's tab shows it and keeps it as the plan's across a launch, standing while the agents are unread and giving way to the plan's once they hold none of it", () => {
  const first = mount({ agents: [AGENT] });
  act(() => first.control().onChoose({ agent: AGENT }));
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // Another plan opens on its own tab, and the first plan on its agent again.
  first.render({ plan: OTHER_PLAN, agents: [] });
  assert.equal(first.control().tab, MAIN_TAB.PLAN);
  first.render({ agents: [AGENT] });
  assert.deepEqual(first.control().tab, { agent: AGENT });

  const second = mount({ agents: undefined });
  assert.deepEqual(second.control().tab, { agent: AGENT }, "standing while the list is read");
  second.render({ agents: [OTHER] });
  assert.equal(second.control().tab, MAIN_TAB.PLAN);
});

test("closing the tab shown returns to the one viewed before it, and only where none stands to its neighbour, the plan's last", () => {
  const column = mount({ agents: [AGENT, OTHER, THIRD] });
  for (const agent of [THIRD, AGENT, OTHER]) act(() => column.control().onChoose({ agent }));

  act(() => column.control().onClose({ agent: OTHER }));
  assert.deepEqual(column.control().tab, { agent: AGENT });
  act(() => column.control().onClose({ agent: AGENT }));
  assert.deepEqual(
    column.control().tab,
    { agent: THIRD },
    "the one viewed before it, not beside it",
  );
  act(() => column.control().onClose({ agent: THIRD }));
  assert.equal(column.control().tab, MAIN_TAB.PLAN);
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
});

test("with no tab viewed still standing, closing the one shown chooses the tab after it, else the one before", () => {
  window.localStorage.setItem(
    "luke.mainTabs",
    JSON.stringify({ closedAgents: [], plans: { [PLAN]: { recent: [{ agent: OTHER }] } } }),
  );
  const column = mount({ agents: [AGENT, OTHER, THIRD] });
  assert.deepEqual(column.control().tab, { agent: OTHER });
  act(() => column.control().onClose({ agent: OTHER }));
  assert.deepEqual(column.control().tab, { agent: THIRD });
});

test("an agent's tab closed stays closed across a launch, an agent started since opens its own, and choosing it opens it again in its place", () => {
  const first = mount({ agents: [AGENT, OTHER] });
  act(() => first.control().onClose({ agent: AGENT }));
  assert.deepEqual(first.control().tabs, [MAIN_TAB.PLAN, { agent: OTHER }]);
  assert.deepEqual(first.control().openAgents, [OTHER]);

  const second = mount({ agents: [AGENT, OTHER, THIRD] });
  assert.deepEqual(second.control().tabs, [MAIN_TAB.PLAN, { agent: OTHER }, { agent: THIRD }]);
  act(() => second.control().onChoose({ agent: AGENT }));
  assert.deepEqual(second.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: AGENT },
    { agent: OTHER },
    { agent: THIRD },
  ]);
  assert.deepEqual(second.control().tab, { agent: AGENT });
});

test("a draft's tab shows while the plan holds the draft, closes to the tab viewed before it, and is kept across no launch", () => {
  const first = mount({ agents: [AGENT], draft: DRAFT });
  act(() => first.control().onChoose({ agent: AGENT }));
  act(() => first.control().onChoose({ draft: DRAFT }));
  assert.deepEqual(first.control().tab, { draft: DRAFT });

  const second = mount({ agents: [AGENT], draft: DRAFT });
  assert.deepEqual(second.control().tab, { agent: AGENT }, "a draft chosen is kept as no tab");

  act(() => first.control().onClose({ draft: DRAFT }));
  assert.deepEqual(first.control().tab, { agent: AGENT });
});

test("the agents' tabs move among themselves and the draft's after the plan's, and the plan keeps their order across a launch", () => {
  const first = mount({ agents: [AGENT, OTHER], draft: DRAFT });
  act(() => first.control().onMove({ draft: DRAFT }, 0));
  act(() => first.control().onMove({ agent: OTHER }, 0));
  assert.deepEqual(first.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: OTHER },
    { draft: DRAFT },
    { agent: AGENT },
  ]);

  // Another plan keeps its own order; a launch drops the draft from this one's.
  first.render({ plan: OTHER_PLAN, agents: [THIRD, AGENT] });
  assert.deepEqual(first.control().tabs, [MAIN_TAB.PLAN, { agent: THIRD }, { agent: AGENT }]);
  const second = mount({ agents: [AGENT, OTHER, THIRD] });
  assert.deepEqual(second.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: OTHER },
    { agent: AGENT },
    { agent: THIRD },
  ]);
});

test("an agent shown on another plan, as a notification or a pin asks, is that plan's tab once it opens, its closed tab opened again", () => {
  const column = mount({ plan: OTHER_PLAN, agents: [THIRD] });
  act(() => column.control().onShow(PLAN, { agent: AGENT }));
  assert.equal(column.control().tab, MAIN_TAB.PLAN, "the open plan's own stands meanwhile");

  column.render({ agents: undefined });
  assert.deepEqual(column.control().tab, { agent: AGENT });
  column.render({ agents: [AGENT] });
  assert.deepEqual(column.control().tab, { agent: AGENT });

  act(() => column.control().onClose({ agent: AGENT }));
  act(() => column.control().onShow(PLAN, { agent: AGENT }));
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: AGENT }]);
  assert.deepEqual(column.control().tab, { agent: AGENT });
});

test("the agents' tabs the side panel kept read into the column once: their closes, order, and views move, each plan still opening on its own tab", () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["board", "code", "transcript", "work"],
      tab: { agent: AGENT },
      width: 400,
      closedAgents: [THIRD],
      plans: {
        [PLAN]: {
          opened: [],
          closed: [],
          recent: ["code", { agent: AGENT }, { agent: OTHER }],
          order: [{ agent: OTHER }, "work", { agent: AGENT }],
        },
      },
    }),
  );
  const column = mount({ agents: [AGENT, OTHER, THIRD] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: OTHER }, { agent: AGENT }]);
  assert.equal(column.control().tab, MAIN_TAB.PLAN);

  // The views moved too: the plan's tab gone, the agent viewed last before it is shown.
  act(() => column.control().onChoose({ agent: AGENT }));
  act(() => column.control().onClose({ agent: AGENT }));
  assert.equal(column.control().tab, MAIN_TAB.PLAN);
  act(() => column.control().onChoose({ agent: OTHER }));
  act(() => column.control().onClose({ agent: OTHER }));
  assert.equal(column.control().tab, MAIN_TAB.PLAN);

  // The column keeps its own record from then on, and reads the panel's no more.
  window.localStorage.removeItem("luke.sidePanel");
  assert.deepEqual(mount({ agents: [AGENT, OTHER, THIRD] }).control().openAgents, []);
});

test("a fixture run neither reads nor writes the column's record", () => {
  window.localStorage.setItem(
    "luke.mainTabs",
    JSON.stringify({ closedAgents: [AGENT], plans: {} }),
  );
  const column = mount({ agents: [AGENT], fixture: true });
  assert.deepEqual(column.control().openAgents, [AGENT]);
  act(() => column.control().onClose({ agent: AGENT }));
  assert.equal(
    window.localStorage.getItem("luke.mainTabs"),
    JSON.stringify({ closedAgents: [AGENT], plans: {} }),
  );
});
