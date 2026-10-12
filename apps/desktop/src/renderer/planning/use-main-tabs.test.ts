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
const ITEM = "a1b2c3d4-0000-4000-8000-000000000001";
const OTHER_ITEM = "a1b2c3d4-0000-4000-8000-000000000002";
const THIRD_ITEM = "a1b2c3d4-0000-4000-8000-000000000003";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

/** The open plan, its agents, nothing while unread, its draft's key, and whether an inbox item waits on it. */
interface Stood {
  plan?: string;
  agents: readonly string[] | undefined;
  draft?: string | undefined;
  fixture?: boolean;
  waiting?: boolean;
}

/** Mounts the column's tabs alone over what the plan holds now, answering the control as it stands. */
function mount(stood: Stood) {
  let control: MainTabsControl | undefined;
  function Probe({ held }: { held: Stood }) {
    control = useMainTabs(
      held.fixture ?? false,
      held.plan ?? PLAN,
      held.agents,
      held.draft,
      held.waiting ?? false,
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

test("the plan's tab stands first and alone on a plan with no agent, and is shown, never closing", () => {
  const column = mount({ agents: [] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
  assert.equal(column.control().tab, MAIN_TAB.PLAN);
  act(() => column.control().onClose(MAIN_TAB.PLAN));
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
});

test("the plan's Inbox tab stands where an item waits on a plan whose agents this window has not read, and is shown where the sidebar's Inbox asks for it on another plan", () => {
  const column = mount({ agents: [], waiting: true });
  act(() => column.control().onShow(OTHER_PLAN, MAIN_TAB.INBOX));
  column.render({ plan: OTHER_PLAN, agents: undefined, waiting: true });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, MAIN_TAB.INBOX]);
  assert.equal(column.control().tab, MAIN_TAB.INBOX);

  // Answered, and with no agent read, the plan has nothing to keep the tab for.
  column.render({ plan: OTHER_PLAN, agents: [], waiting: false });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN]);
  assert.equal(column.control().tab, MAIN_TAB.PLAN);
});

test("the plan's Inbox tab stands nowhere until an item it has not seen waits, which opens it after every tab, chosen; it closes and stays closed until another such item", () => {
  const column = mount({ agents: [AGENT, OTHER] });
  const inboxStands = () => column.control().tabs.includes(MAIN_TAB.INBOX);
  act(() => column.control().onInboxRead(PLAN, []));
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: AGENT }, { agent: OTHER }]);

  act(() => column.control().onInboxRead(PLAN, [ITEM]));
  assert.deepEqual(column.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: AGENT },
    { agent: OTHER },
    MAIN_TAB.INBOX,
  ]);
  assert.equal(column.control().tab, MAIN_TAB.INBOX);

  // An item arriving while it stands open only counts on it: the tab shown stays shown.
  act(() => column.control().onChoose({ agent: AGENT }));
  act(() => column.control().onInboxRead(PLAN, [ITEM, OTHER_ITEM]));
  assert.deepEqual(column.control().tab, { agent: AGENT });

  act(() => column.control().onClose(MAIN_TAB.INBOX));
  assert.equal(inboxStands(), false);
  assert.deepEqual(column.control().tab, { agent: AGENT });

  // What already waited opens nothing, on this launch or the next, however its agent changed it.
  act(() => column.control().onInboxRead(PLAN, [ITEM, OTHER_ITEM]));
  assert.equal(inboxStands(), false);
  const next = mount({ agents: [AGENT, OTHER] });
  act(() => next.control().onInboxRead(PLAN, [OTHER_ITEM, ITEM]));
  assert.equal(next.control().tabs.includes(MAIN_TAB.INBOX), false);

  // One more item opens it, though posted the same moment as one that waited.
  act(() => next.control().onInboxRead(PLAN, [OTHER_ITEM, ITEM, THIRD_ITEM]));
  assert.equal(next.control().tab, MAIN_TAB.INBOX);
});

test("an item answered and then posted again under its agent's key opens the closed Inbox again", () => {
  const column = mount({ agents: [AGENT] });
  act(() => column.control().onInboxRead(PLAN, [ITEM]));
  act(() => column.control().onClose(MAIN_TAB.INBOX));
  act(() => column.control().onInboxRead(PLAN, []));
  assert.equal(column.control().tabs.includes(MAIN_TAB.INBOX), false, "answered");
  act(() => column.control().onInboxRead(PLAN, [ITEM]));
  assert.equal(column.control().tab, MAIN_TAB.INBOX);
});

test("the Inbox moves as an agent's tab does, opens again after every tab wherever it stood, and choosing it where it stands open moves it nowhere", () => {
  const column = mount({ agents: [AGENT, OTHER] });
  act(() => column.control().onChoose(MAIN_TAB.INBOX));
  act(() => column.control().onMove(MAIN_TAB.INBOX, 0));
  const moved = [MAIN_TAB.PLAN, MAIN_TAB.INBOX, { agent: AGENT }, { agent: OTHER }];
  assert.deepEqual(column.control().tabs, moved);
  act(() => column.control().onChoose({ agent: OTHER }));
  act(() => column.control().onChoose(MAIN_TAB.INBOX));
  assert.deepEqual(column.control().tabs, moved);
  assert.equal(mount({ agents: [AGENT, OTHER] }).control().tabs[1], MAIN_TAB.INBOX, "kept");

  act(() => column.control().onClose(MAIN_TAB.INBOX));
  act(() => column.control().onChoose(MAIN_TAB.INBOX));
  assert.deepEqual(column.control().tabs, [
    MAIN_TAB.PLAN,
    { agent: AGENT },
    { agent: OTHER },
    MAIN_TAB.INBOX,
  ]);
  // An agent started since stands after it, as any tab opened later does.
  column.render({ agents: [AGENT, OTHER, THIRD] });
  assert.deepEqual(column.control().tabs.at(-1), { agent: THIRD });
});

test("the Inbox is the posting plan's alone and stands only on a plan with an agent", () => {
  const column = mount({ agents: [AGENT] });
  act(() => column.control().onInboxRead(OTHER_PLAN, [ITEM]));
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: AGENT }]);
  column.render({ plan: OTHER_PLAN, agents: [] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN], "only an agent posts");
  column.render({ plan: OTHER_PLAN, agents: [OTHER] });
  assert.deepEqual(column.control().tabs, [MAIN_TAB.PLAN, { agent: OTHER }, MAIN_TAB.INBOX]);
  assert.equal(column.control().tab, MAIN_TAB.INBOX, "the plan opens on it");
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

test("choosing an agent's tab shows it and keeps it as the plan's across a launch, shown once the agents are read and hold it, the plan's meanwhile and once they hold none of it", () => {
  const first = mount({ agents: [AGENT] });
  act(() => first.control().onChoose({ agent: AGENT }));
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // Another plan opens on its own tab, and the first plan on its agent again.
  first.render({ plan: OTHER_PLAN, agents: [] });
  assert.equal(first.control().tab, MAIN_TAB.PLAN);
  first.render({ agents: [AGENT] });
  assert.deepEqual(first.control().tab, { agent: AGENT });

  // Another launch shows the plan's own while the list is read, its strip drawing no agent's
  // tab, and the agent once the list holds it.
  const second = mount({ agents: undefined });
  assert.equal(second.control().tab, MAIN_TAB.PLAN);
  assert.deepEqual(second.control().tabs, [MAIN_TAB.PLAN]);
  second.render({ agents: [AGENT] });
  assert.deepEqual(second.control().tab, { agent: AGENT });
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
  assert.equal(column.control().tab, MAIN_TAB.PLAN, "its own until the agents are read");
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
