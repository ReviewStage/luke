// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_CALL_FAILURE,
  type AgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { INBOX_MESSAGE_AUTHOR, INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@repo/features/link-grammar";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@repo/features/page-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppInboxTasklessItem } from "@repo/host/app-state";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import { act } from "react";
import { beforeAll, test } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { chooseInboxTask } from "../tasks/use-inbox-task.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeActsAnswer,
} from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { composerEditor, editorBundleLanded, typeInComposer } from "../testing/composer.js";
import {
  ACME,
  AGENT,
  arrowNamed,
  BILLING,
  BUMP,
  backToList,
  chooseView,
  columnsShown,
  EXPIRY,
  hoveredCard,
  INVITES,
  item,
  itemPane,
  layOut,
  listEdge,
  listed,
  mount,
  noticeOf,
  ON_THRESHOLD,
  pagerOf,
  pressKey,
  pushAgain,
  QUARANTINE,
  READER,
  RETRY,
  ROW_TITLE,
  readTitle,
  rowNamed,
  STRAY_AGENT,
  SWEEP_AGENT,
  saying,
  settle,
  showScope,
  skillReads,
  standKeymap,
  TEAMMATE,
  THRESHOLD,
  waitingTaskless,
  wayBack,
  wearsAgentTile,
  wordsOf,
  world,
} from "../testing/desktop-inbox.js";
import { restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { tasksControl } from "../testing/tasks-control.js";

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

test("the Inbox left and come back to draws the rows the window holds at once, before anything is pushed again", async () => {
  const { page } = mount([], { drawnWhileOpen: true });
  await settle();
  const rows = listed(page);
  assert.ok(
    rows.some((row) => row.endsWith(THRESHOLD.title)),
    "the rows are pushed and drawn",
  );

  act(() => world.setInboxOpen(false));
  await settle();
  act(() => world.setInboxOpen(true));
  assert.deepEqual(
    listed(page),
    rows,
    "drawn from the account's feed in app state, nothing pushed anew",
  );
});

test("the Inbox draws each task held whole by the account's feed from it, following none on its own", async () => {
  const { page } = mount();
  await settle();
  const rows = listed(page);
  assert.ok(
    rows.some((row) => row.endsWith(THRESHOLD.title)),
    "the billing task's items are drawn",
  );
  assert.ok(
    rows.some((row) => row.endsWith(EXPIRY.title)),
    "the invites task's items are drawn",
  );
  for (const task of [BILLING, INVITES]) {
    assert.equal(
      world.main.isFollowed({ kind: INBOX_SCOPE_KIND.PLAN, id: task.id }),
      false,
      `${task.name} is drawn from the feed alone`,
    );
  }
});

test("an Inbox whose feed holds nothing of its tasks says so rather than reading for good", async () => {
  // The feed answers with no task, as it leaves out one whose items all settled past its bound.
  world.inboxes = new Map();
  const { page } = mount();
  await settle();
  const list = page.querySelector(".inbox-tasks");
  assert.ok(list, "the list is drawn");
  assert.equal(list.querySelector('[aria-busy="true"]'), null, "nothing is still being read");
});

test("a link to an item the account's feed leaves out waits for its task's own read, saying no Not found, and then shows it", async () => {
  // The feed leaves the invites task out, as it does one whose items all settled past its bound.
  world.inboxes = new Map([[BILLING.id, [THRESHOLD, RETRY]]]);
  let land: () => void = () => undefined;
  world.startRead = (taskId) =>
    taskId === INVITES.id
      ? new Promise((resolve) => {
          land = () =>
            resolve({ status: FAKE_ANSWER.DONE, value: { items: [EXPIRY], cursor: "1" } });
        })
      : undefined;
  const { page } = mount();
  await settle();
  act(() => world.chooseFromOutside({ taskId: INVITES.id, itemId: EXPIRY.id, opened: true }));
  await settle();
  const waiting = page.querySelector(".inbox-view-items")?.textContent ?? "";
  land();
  await settle();

  assert.doesNotMatch(waiting, /Not found/u);
  assert.match(
    page.querySelector(".inbox-view-items")?.textContent ?? "",
    /Expire after 7 days\?/u,
  );
});

test("an Inbox whose account feed refused before it ever answered reads it again on Retry", async () => {
  world.feedRefused = true;
  const { page } = mount();
  await settle();
  const retry = [...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks button")].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry, "the list offers to read again");

  world.feedRefused = false;
  act(() => retry.click());
  await settle();
  assert.ok(
    listed(page).some((row) => row.endsWith(THRESHOLD.title)),
    "the feed is read again and its items drawn",
  );
});

test("an item a link names before the account's task list is read says no Not found, and shows once the list lands", async () => {
  const { page } = mount([], { listUnread: true });
  await settle();
  act(() => world.chooseFromOutside({ taskId: INVITES.id, itemId: EXPIRY.id, opened: true }));
  await settle();
  assert.doesNotMatch(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);

  act(() => {
    world.setTasks([BILLING, INVITES]);
    world.setListRead(true);
  });
  await settle();
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .ui-list-row-title')?.textContent,
    "Expire after 7 days?",
  );
});

test("an Inbox too narrow for the list and the item side by side shows the chosen item alone, the whole Inbox wide, under a way back that Back's chord and Escape take as well, the keyboard landing on the item's row; a row pressed opens its item again, and from the list Escape does not leave the Inbox", async () => {
  const { page, asked } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Alert at 80%?");
  assert.equal(backToList(page).textContent, "Inbox");

  act(() => backToList(page).click());
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.equal(listEdge(page), null, "a list standing alone has no edge to drag");
  assert.ok(
    document.activeElement === rowNamed(page, "Alert at 80%?"),
    "the keyboard is on its row",
  );

  act(() => rowNamed(page, "Expire after 7 days?").click());
  assert.deepEqual(columnsShown(page), ["item"]);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Expire after 7 days?");
  assert.ok(document.activeElement === backToList(page), "the keyboard lands on the way back");
  act(() => runAppCommand(APP_COMMAND.BACK));
  assert.deepEqual(columnsShown(page), ["list"]);
  assert.ok(
    document.activeElement === rowNamed(page, "Expire after 7 days?"),
    "the keyboard is on its row",
  );

  act(() => rowNamed(page, "Expire after 7 days?").click());
  act(() => runAppCommand(APP_COMMAND.INBOX_LIST));
  assert.deepEqual([columnsShown(page), asked.closed], [["list"], 0]);
  act(() => {
    assert.equal(runAppCommand(APP_COMMAND.INBOX_LIST), false, "the list offers no Escape");
  });
  assert.deepEqual([columnsShown(page), asked.closed], [["list"], 0], "the Inbox stands");
});

test("the Inbox joins only once narrowed past the band, keeping the item it shows, and splits again only once widened past it; split again with nothing chosen, narrowed it lands on its list", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  layOut(page, 900);
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  layOut(page, 860);
  assert.deepEqual(columnsShown(page), ["list", "item"], "within the band it stays split");
  rowNamed(page, "Alert at 80%?").focus();
  layOut(page, 850);
  assert.deepEqual(columnsShown(page), ["item"], "narrowed, the item it shows stays");
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Alert at 80%?");
  assert.ok(
    document.activeElement === backToList(page),
    "the keyboard leaves the hidden row for the item's way back",
  );

  act(() => backToList(page).click());
  layOut(page, 880);
  assert.deepEqual(columnsShown(page), ["list"], "within the band it stays one column");
  layOut(page, 900);
  assert.deepEqual(columnsShown(page), ["list", "item"]);
  assert.equal(wayBack(page), undefined);
  layOut(page, 800);
  assert.deepEqual(columnsShown(page), ["list"]);
});

test("one column wide, the item's bar says where it stands in the list, and its arrows, K, and J step up and down the list in its order, a settled item among them, stopping at its ends with the arrows still in the tab order", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const keys = standKeymap();
  layOut(page, 800);
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "3 of 3"]);
  assert.equal(
    arrowNamed(page, "Next item").getAttribute("aria-disabled"),
    "true",
    "nothing below the last, the arrow keeping the keyboard",
  );
  pressKey("j");
  assert.equal(readTitle(page), "Alert at 80%?");

  act(() => arrowNamed(page, "Previous item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Expire after 7 days?", "2 of 3"]);
  pressKey("k");
  assert.deepEqual([readTitle(page), pagerOf(page)], ["How is a failed email retried?", "1 of 3"]);
  assert.equal(
    arrowNamed(page, "Previous item").getAttribute("aria-disabled"),
    "true",
    "nothing above the first, the arrow keeping the keyboard",
  );
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");

  pressKey("j");
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Expire after 7 days?", "2 of 3"]);
  act(() => keys.unmount());
});

test("with nothing chosen, J chooses the list's first row, as the empty pane beside it says", async () => {
  const { page } = mount();
  await settle();
  const keys = standKeymap();
  layOut(page, 900);
  assert.equal(page.querySelector("[data-inbox-title]"), null, "nothing is chosen");
  pressKey("j");
  assert.equal(readTitle(page), "How is a failed email retried?");
  act(() => keys.unmount());
});

test("a chosen item whose plan leaves the account's list, deleted on another Mac, leaves the pane beside the list empty rather than choosing another", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  assert.deepEqual(
    listed(page).filter((row) => row.startsWith("▸")),
    ["▸ *Alert at 80%?"],
  );
  act(() => {
    world.setTasks([INVITES]);
    world.setHolding([{ taskId: INVITES.id, items: 1, updatedAt: 4_000 }]);
  });
  await settle();
  assert.deepEqual(listed(page), ["*Expire after 7 days?"]);
  assert.equal(page.querySelector(".inbox-view-items [data-inbox-title]"), null);
  assert.equal(
    page.querySelector(".inbox-view-items")?.textContent,
    "Choose an item, or step with J K",
  );
});

test("an item of an agent with no plan is listed, and opens on its agent's own read under the crumb of the automation that started it", async () => {
  world.agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page, asked } = mount([
    {
      id: QUARANTINE.id,
      agentId: SWEEP_AGENT,
      title: QUARANTINE.title,
      postedAt: QUARANTINE.postedAt,
      updatedAt: QUARANTINE.updatedAt,
      agentTitle: "Sweep the flaky tests",
      agentModel: "anthropic/claude-opus-5.5",
      automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
      automationName: "Nightly flake sweep",
      repository: "acme/relay",
    },
  ]);
  await settle();

  const rows = listed(page);
  assert.ok(rows.includes("*Quarantine the flaky test?"), rows.join(" | "));

  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();

  const crumbs = page.querySelector(".inbox-crumbs")?.textContent ?? "";
  assert.match(crumbs, /Nightly flake sweep/u);
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Quarantine the flaky test?");
  assert.deepEqual(asked.shownTasks, [], "the automation's crumb opens no plan");
});

test("a link alone on its line to a page an agent with no plan showed stands as the page's row, hanging the card a plan's page hangs, its title, version and the agent that showed it, read as it is first hung; one of an agent the reader cannot reach says it can't be read", async () => {
  const ledger: PageLine = {
    id: "4a5b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d",
    title: "Flake ledger",
    version: 3,
    at: 1_000,
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId: SWEEP_AGENT },
  };
  world.agentPages = new Map([[SWEEP_AGENT, [ledger]]]);
  const shown = linkOf({ kind: LINK_PLACE.PAGE, agentId: SWEEP_AGENT, pageId: ledger.id }, "acme");
  const hidden = linkOf({ kind: LINK_PLACE.PAGE, agentId: STRAY_AGENT, pageId: ledger.id }, "acme");
  const words = [shown, `[@Their ledger](${hidden})`].join("\n\n");
  world.agentInboxes = new Map([[SWEEP_AGENT, [saying(QUARANTINE, words)]]]);
  const waiting: AppInboxTasklessItem = {
    id: QUARANTINE.id,
    agentId: SWEEP_AGENT,
    title: QUARANTINE.title,
    postedAt: QUARANTINE.postedAt,
    updatedAt: QUARANTINE.updatedAt,
    agentTitle: "Sweep the flaky tests",
    agentModel: "anthropic/claude-opus-5.5",
    automationId: null,
    automationName: null,
    repository: "acme/relay",
  };
  // Main's document names the agent by what waits on it, as the window's names are read.
  const held = stateWith({}, {});
  handState({}, { inbox: { ...held.inbox, taskless: [waiting] } });
  const { page } = mount([waiting]);
  await settle();
  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();

  const rows = [...page.querySelectorAll('[data-inbox-message-text] [data-lone-link="page"]')];
  assert.equal(rows.length, 2, "each link alone on its line stands as a page's row");
  const [mine, theirs] = rows.map((row) => row.querySelector("button.ui-list-row-main"));
  assert.ok(mine && theirs);
  restOn(mine);
  await settle();
  const card = document.querySelector(".ui-tooltip-card [data-page-card]");
  assert.ok(card, "the agent's page hangs the page's own card");
  assert.equal(card.querySelector(".ui-hover-card-name")?.textContent, "Flake ledger");
  assert.deepEqual(
    [
      card.querySelector(".ui-hover-card-sub")?.textContent,
      card.querySelector(".ui-hover-card-row")?.textContent,
    ],
    ["Version 3", "Shown by Sweep the flaky tests"],
  );
  assert.equal(
    card.querySelector(".ui-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ agentId: SWEEP_AGENT, pageId: ledger.id, version: 3 }),
  );
  act(() => {
    mine.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });

  restOn(theirs);
  await settle();
  const refused = document.querySelector(".ui-tooltip-card [data-page-card]");
  assert.deepEqual(
    [
      refused?.querySelector(".ui-hover-card-name")?.textContent,
      refused?.querySelector(".ui-hover-card-note")?.textContent,
    ],
    ["Their ledger", "Can't read this page."],
  );
});

/** The automation that started the agent with no task, as its workspace's list reads it. */
const SWEEP: AutomationSummary = {
  id: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  planId: null,
  planName: null,
  workspaceId: "workspace-acme",
  name: "Nightly flake sweep",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 3 * * *", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Sweep the flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

const TASKLESS_AGENT = "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e";
const DOMAIN: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000d", "Name a domain?", 1_200),
  agentId: TASKLESS_AGENT,
};

/** An item of an agent of the reader's with no task, as main lists it: no automation, and no repository. */
function tasklessItem(asked: InboxItem): AppInboxTasklessItem {
  return {
    id: asked.id,
    agentId: asked.agentId,
    title: asked.title,
    postedAt: asked.postedAt,
    updatedAt: asked.updatedAt,
    agentTitle: "Domain setup",
    agentModel: "anthropic/claude-opus-5.5",
    automationId: null,
    automationName: null,
    repository: null,
  };
}

test("an agent's row hangs a card naming the agent and the automation that started it; its crumb wears the automation's clock tile and hangs its card, opening its page; the agents no automation names stand under no actor", async () => {
  handState({});
  world.listedWorkspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  world.automations = [SWEEP];
  world.agentInboxes = new Map([
    [SWEEP_AGENT, [QUARANTINE]],
    [STRAY_AGENT, [BUMP]],
    [TASKLESS_AGENT, [DOMAIN]],
  ]);
  const { page, asked } = mount([
    { ...waitingTaskless(QUARANTINE), agentTitle: "Sweep the flaky tests" },
    { ...waitingTaskless(BUMP), automationId: null, automationName: null },
    tasklessItem(DOMAIN),
  ]);
  await settle();

  const mark = rowNamed(page, "Quarantine the flaky test?");
  assert.equal(
    wearsAgentTile(mark),
    false,
    "the planless agent's row wears no tile, its card naming the agent",
  );
  assert.match(
    hoveredCard(mark, "[data-inbox-item-card]") ?? "",
    /^Quarantine the flaky test\?.*Nightly flake sweep.*Sweep the flaky tests$/su,
  );

  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();
  const crumb = page.querySelector<HTMLButtonElement>('nav[aria-label="Path"] button');
  assert.ok(crumb, "the automation's crumb is drawn");
  assert.ok(
    crumb.querySelector('.actor-mark[data-kind="automation"]'),
    "the automation's crumb wears its clock tile, as its group does",
  );
  assert.match(hoveredCard(crumb, '[data-actor-card="automation"]') ?? "", /Nightly flake sweep/u);
  assert.equal(
    document.querySelector('.ui-tooltip-card [data-actor-card="automation"] button')?.textContent,
    undefined,
    "the crumb's card offers nothing to press, since the crumb opens the automation",
  );
  act(() => crumb.click());
  assert.deepEqual(asked.shownAutomations, [SWEEP.id]);

  act(() => rowNamed(page, "Bump the Node image?").click());
  await settle();
  // Note that no automation stands behind its crumb, so the crumb is words, opening nothing.
  const stray = page.querySelector<HTMLElement>('nav[aria-label="Path"] li');
  assert.equal(stray?.textContent, "Other agents");
  assert.equal(stray?.querySelector("button"), null);
  assert.ok(
    stray?.querySelector(".lucide-clock") === null,
    "the crumb of the agents no automation names wears no automation's clock",
  );
  assert.ok(
    stray?.querySelector(".lucide-zap"),
    "it wears the automation glyph, as its group does",
  );
});

test("an item's card names the automation that holds it by a chip that hangs the automation's card, read as it is hung where the Inbox has read no automations", async () => {
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [
          { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null },
        ],
      },
    },
  );
  world.automations = [SWEEP];
  world.agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount([{ ...waitingTaskless(QUARANTINE), workspaceId: "workspace-acme" }]);
  await settle();

  restOn(rowNamed(page, "Quarantine the flaky test?"));
  const chip =
    document.querySelector<HTMLElement>(
      '.ui-tooltip-card [data-inbox-item-card] [data-holder-ref][data-kind="agent"]',
    ) ?? assert.fail("the card names the automation by its chip");
  restOn(chip);
  await settle();

  assert.match(
    wordsOf(document.querySelector('.ui-tooltip-card [data-actor-card="automation"]')) ?? "",
    /Nightly flake sweep/u,
  );
});

test("an item from a service that names no workspace for it still names its automation by a chip hanging the card the Inbox's own directory holds", async () => {
  handState({});
  world.listedWorkspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  world.automations = [SWEEP];
  world.agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount([waitingTaskless(QUARANTINE)]);
  await settle();

  restOn(rowNamed(page, "Quarantine the flaky test?"));
  restOn(
    document.querySelector<HTMLElement>(
      '.ui-tooltip-card [data-inbox-item-card] [data-holder-ref][data-kind="agent"]',
    ) ?? assert.fail("the card names the automation by its chip"),
  );

  assert.match(
    wordsOf(document.querySelector('.ui-tooltip-card [data-actor-card="automation"]')) ?? "",
    /Nightly flake sweep/u,
  );
});

/** Another agent with no task the same automation started, whose two questions wait. */
const SECOND_AGENT = "6f708192-a3b4-4c5d-8e6f-708192a3b4c5";
const SECOND_ASK: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000a", "Skip the slow suite?", 2_000),
  agentId: SECOND_AGENT,
};
const THIRD_ASK: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000b", "Retry the flaky job?", 2_500),
  agentId: SECOND_AGENT,
};

test("an agent with no plan whose waiting items move, one answered on another Mac, is read again, the answered item no longer needing you", async () => {
  world.agentInboxes = new Map([
    [SWEEP_AGENT, [QUARANTINE]],
    [SECOND_AGENT, [SECOND_ASK, THIRD_ASK]],
  ]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();
  assert.ok(listed(page).includes("*Skip the slow suite?"));

  world.agentInboxes.set(SECOND_AGENT, [
    { ...SECOND_ASK, status: INBOX_STATUS.ANSWERED },
    THIRD_ASK,
  ]);
  act(() => world.setTaskless([QUARANTINE, THIRD_ASK].map(waitingTaskless)));
  await settle();

  assert.ok(listed(page).includes("Skip the slow suite?"), listed(page).join(" | "));
});

test("an agent with no plan whose items are all settled stays listed, as main lists it holding them", async () => {
  const settled = { ...SECOND_ASK, status: INBOX_STATUS.ANSWERED };
  world.agentInboxes = new Map([[SECOND_AGENT, [settled]]]);
  const { id: _id, title: _title, postedAt: _postedAt, ...agent } = waitingTaskless(settled);
  const { page } = mount([], { agents: [{ ...agent, items: 1, toDo: 0 }] });
  await settle();

  const rows = listed(page);
  assert.ok(rows.includes("Skip the slow suite?"), rows.join(" | "));
});

test("an item chosen by a notification's click, in an Inbox showing its list alone, is shown itself, and Back stands on the list again, the notification's ask taken once", async () => {
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless), {
    chosen: ON_THRESHOLD,
  });
  await settle();
  layOut(page, 700);
  await settle();
  act(() => backToList(page).click());
  assert.equal(page.querySelector(".inbox-view")?.getAttribute("data-columns"), "list");

  act(() =>
    world.chooseFromOutside({ agentId: SECOND_AGENT, itemId: SECOND_ASK.id, opened: true }),
  );
  await settle();

  assert.equal(page.querySelector(".inbox-view")?.getAttribute("data-columns"), "item");
  assert.equal(page.querySelector("[data-inbox-title]")?.textContent, "Skip the slow suite?");

  act(() => backToList(page).click());
  await settle();
  assert.equal(
    page.querySelector(".inbox-view")?.getAttribute("data-columns"),
    "list",
    "Back stands on the list, the notification's ask taken once",
  );
});

test("an untitled agent an automation started goes by its automation's name in the Inbox, as on its own page", async () => {
  world.agentInboxes = new Map([[SWEEP_AGENT, [QUARANTINE]]]);
  const { page } = mount([waitingTaskless(QUARANTINE)]);
  await settle();

  const row = rowNamed(page, "Quarantine the flaky test?");
  assert.match(hoveredCard(row, "[data-inbox-item-card]") ?? "", /Nightly flake sweep$/u);
});

test("an item's row offers Copy link on a right-click, copying the item's link by its id alone, whichever agent posted it and task holds it", async () => {
  world.listedWorkspace = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const { page } = mount();
  await settle();
  act(() => {
    rowNamed(page, "Alert at 80%?").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the row's menu offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(world.copied, [`https://vespin.dev/acme/inbox/${THRESHOLD.id}`]);
});

test("an item a link names that no read holds, of a task the reader cannot read, is not found in its pane, and no other item is chosen in its place", async () => {
  const { page } = mount();
  await settle();
  act(() =>
    world.chooseFromOutside({
      taskId: "0f0e0d0c-0000-4000-8000-00000000dead",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(
    page.querySelector(".inbox-view-items")?.textContent ?? "",
    /Not foundThis inbox item doesn't exist, or you don't have access to it\./u,
  );
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to a settled item of an agent with no plan, none of whose items waits any more, lists the agent by its own read and shows the item", async () => {
  const settled = { ...BUMP, status: INBOX_STATUS.ANSWERED };
  world.agentInboxes = new Map([[STRAY_AGENT, [settled]]]);
  world.tasklessAgents = new Map([
    [STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }],
  ]);
  const { page } = mount();
  await settle();
  act(() => world.chooseFromOutside({ agentId: STRAY_AGENT, itemId: BUMP.id, opened: true }));
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .ui-list-row-title')?.textContent,
    "Bump the Node image?",
  );
});

test("an item a link names is not found though another task's read failed, and in a narrow Inbox the notice stands alone, not the list, with a way back to it", async () => {
  world.startRead = (taskId) =>
    taskId === BILLING.id
      ? Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { failure: AGENT_CALL_FAILURE.UNANSWERED },
        })
      : undefined;
  const { page } = mount();
  await settle();
  layOut(page, 600);
  act(() =>
    world.chooseFromOutside({
      taskId: "0f0e0d0c-0000-4000-8000-00000000dead",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();
  const pane = page.querySelector<HTMLElement>(".inbox-view-items");

  assert.match(pane?.textContent ?? "", /Not found/u);
  assert.equal(pane?.hidden, false);
  const back = [...(pane?.querySelectorAll("button") ?? [])].find(
    (each) => each.textContent === "Back to inbox",
  );
  assert.ok(back, "the notice leads back to the list");
  act(() => back.click());
  assert.equal(page.querySelector<HTMLElement>(".inbox-view-items")?.hidden, true);
  assert.ok(
    document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".inbox-tasks") !== null,
    "the keyboard lands on the list, not the hidden notice",
  );
});

test("an item a link names under an agent that is not there, deleted or another's, is not found once its page's read says so, and no other item is chosen", async () => {
  const { page } = mount();
  await settle();
  act(() =>
    world.chooseFromOutside({
      agentId: "0f0e0d0c-0000-4000-8000-0000000a9e47",
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("an item a link names under an agent with no task that its own read does not hold is not found, though the account's task list is not read yet", async () => {
  world.agentInboxes = new Map([[STRAY_AGENT, []]]);
  world.tasklessAgents = new Map([
    [STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }],
  ]);
  const { page } = mount([], { listUnread: true });
  await settle();
  act(() =>
    world.chooseFromOutside({
      agentId: STRAY_AGENT,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
});

test("an item a link names under a task with no agent and nothing in its Inbox is not found, and no other task's item is chosen", async () => {
  const quiet = { ...INVITES, id: "0f0e0d0c-0000-4000-8000-00000000a11e", name: "Quiet task" };
  world.listedAgents = [];
  const { page } = mount();
  await settle();
  act(() => world.setTasks([BILLING, INVITES, quiet]));
  act(() =>
    world.chooseFromOutside({
      taskId: quiet.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("an item a link names that its task's Inbox read does not hold is not found, though the task's agents are still being read", async () => {
  world.agentListHeld = true;
  const { page } = mount();
  await settle();
  act(() =>
    world.chooseFromOutside({
      taskId: BILLING.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to an item newer than its task's last read waits for the read of it, saying no Not found, and then shows it", async () => {
  const { page } = mount();
  await settle();
  const posted = item("a1b2c3d4-0000-4000-8000-000000000005", "Page on-call too?", 7_000);
  let land: () => void = () => undefined;
  world.startRead = (taskId) =>
    taskId === INVITES.id
      ? new Promise((resolve) => {
          land = () =>
            resolve({
              status: FAKE_ANSWER.DONE,
              value: { items: [EXPIRY, posted], cursor: "2" },
            });
        })
      : undefined;
  act(() =>
    world.setHolding([
      { taskId: BILLING.id, items: 2, updatedAt: 5_000 },
      { taskId: INVITES.id, items: 2, updatedAt: 7_000 },
    ]),
  );
  act(() => world.chooseFromOutside({ taskId: INVITES.id, itemId: posted.id, opened: true }));
  await settle();
  const waiting = page.querySelector(".inbox-view-items")?.textContent ?? "";
  land();
  await settle();

  assert.doesNotMatch(waiting, /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .ui-list-row-title')?.textContent,
    "Page on-call too?",
  );
});

test("an item a link names under a task whose own read fails is kept asked for, and no other task's item is chosen in its place", async () => {
  const quiet = { ...INVITES, id: "0f0e0d0c-0000-4000-8000-00000000a11f", name: "Quiet task" };
  world.startRead = (taskId) =>
    taskId === quiet.id
      ? Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { failure: AGENT_CALL_FAILURE.UNANSWERED },
        })
      : undefined;
  const { page } = mount();
  await settle();
  act(() => world.setTasks([BILLING, INVITES, quiet]));
  act(() =>
    world.chooseFromOutside({
      taskId: quiet.id,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to an agent's item newer than the agent's last read waits for the read of it, saying no Not found, and then shows it", async () => {
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK]]]);
  world.tasklessAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
  const { page } = mount([SECOND_ASK].map(waitingTaskless));
  await settle();
  const held: (() => void)[] = [];
  world.holdAgentRead = (respond) => {
    held.push(respond);
  };
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  act(() => world.setTaskless([SECOND_ASK, THIRD_ASK].map(waitingTaskless)));
  act(() => world.chooseFromOutside({ agentId: SECOND_AGENT, itemId: THIRD_ASK.id, opened: true }));
  await settle();
  const waiting = page.querySelector(".inbox-view-items")?.textContent ?? "";
  world.holdAgentRead = undefined;
  for (const respond of held) respond();
  await settle();

  assert.doesNotMatch(waiting, /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .ui-list-row-title')?.textContent,
    "Retry the flaky job?",
  );
});

test("an item a link names under an agent nothing waits on any more, read before, is not found by that read though the agent's own read fails", async () => {
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK]]]);
  world.tasklessAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
  const { page } = mount([SECOND_ASK].map(waitingTaskless));
  await settle();
  world.agentReadFails = true;
  act(() => world.setTaskless([]));
  act(() =>
    world.chooseFromOutside({
      agentId: SECOND_AGENT,
      itemId: "0f0e0d0c-0000-4000-8000-00000000beef",
      opened: true,
    }),
  );
  await settle();

  assert.match(page.querySelector(".inbox-view-items")?.textContent ?? "", /Not found/u);
});

test("a teammate's open item of an agent with no plan is listed, wearing the teammate's face with no attention mark; Needs you leaves it out", async () => {
  world.agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, startedBy: TEAMMATE }]]]);
  const { page } = mount([{ ...waitingTaskless(QUARANTINE), startedBy: TEAMMATE.userId }]);
  await settle();
  const rows = listed(page);
  assert.ok(rows.includes("Quarantine the flaky test?"), rows.join(" | "));
  const meta = rowNamed(page, "Quarantine the flaky test?").querySelector(".ui-list-row-meta");
  assert.equal(meta?.querySelector(".attention-mark"), null);
  assert.equal(meta?.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
  assert.equal(meta?.querySelector(".ui-visually-hidden")?.textContent, "Waiting on Charles Pan");

  showScope(page, "Open");
  chooseView(page, "Addressed to", "Me");
  assert.equal(
    listed(page).includes("Quarantine the flaky test?"),
    false,
    listed(page).join(" | "),
  );
});

test("on a phone the Inbox's list is headed by New task and one ⋯, its title centered between them, the ⋯ opening View options' own menu and offering Mark all as read, and the search standing under the head", async () => {
  const { page, asked } = mount([], { room: SHELL_ROOM.NARROW });
  await settle();
  const head = page.querySelector<HTMLElement>(".inbox-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map((each) => each.getAttribute("aria-label")),
    ["New task", "Inbox actions"],
  );
  assert.match(head.querySelector("h1")?.textContent ?? "", /^Inbox/);
  const field = page.querySelector<HTMLInputElement>(
    '.inbox-tasks input[aria-label="Search inbox"]',
  );
  assert.ok(field, "the search stands under the head");
  assert.equal(head.contains(field), false, "outside the head, which keeps its title");

  const more = () =>
    head.querySelector<HTMLButtonElement>('[aria-label="Inbox actions"]') ??
    assert.fail("the ⋯ stands");
  const pick = (name: string) => {
    act(() => more().click());
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    ].find((each) => each.querySelector(".ui-menu-item-label")?.textContent === name);
    assert.ok(item, `the ⋯ offers ${name}`);
    act(() => item.click());
  };
  act(() => more().click());
  assert.deepEqual(
    [...document.querySelectorAll('[role="menu"] .ui-menu-item-label')].map(
      (each) => each.textContent,
    ),
    ["View options", "Find", "Mark all as read"],
    "the ⋯ holds what the wide head draws as buttons, ⌘F's Find, and what a right-click offers",
  );
  act(() => more().click());
  pick("View options");
  assert.ok(
    document.querySelector('[role="menu"][aria-label="View options"]:not([data-leaving])'),
    "View options' own menu stands",
  );
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="New task"]')?.click());
  assert.equal(asked.newTasks, 1);
});

/** The thread a box's checkbox starts, as the service hands it back: the reader's words its first message, settled on their own nod. */
const STARTED: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-0000000000f1", "Annual plan copy", 9_000),
  key: "annual-plan-copy",
  needsReply: false,
  status: INBOX_STATUS.ANSWERED,
  settledAt: 9_000,
  thread: [
    {
      id: "e1b2c3d4-0000-4000-8000-0000000000f2",
      author: INBOX_MESSAGE_AUTHOR.MEMBER,
      member: READER,
      text: "Draft the annual plan's line too.",
      createdAt: 9_000,
    },
  ],
};

/** Every thread the box starts, written down and answered as the service starts it, the task's inbox then holding it. */
function heldStarts(): AgentInboxStartParams[] {
  const sent: AgentInboxStartParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.AGENTS_INBOX_START) return previous(request);
      sent.push(request.payload);
      world.inboxes.set(BILLING.id, [STARTED, ...(world.inboxes.get(BILLING.id) ?? [])]);
      pushAgain();
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { item: STARTED } });
    },
  });
  return sent;
}

test("on a phone an item is headed by its way back's glyph, its task centered, which opens it as its crumb does, and one ⋯ that says where it stands and holds the pager, what the crumbs opened, the panel, and the item's own actions", async () => {
  const { page, asked } = mount([], { room: SHELL_ROOM.NARROW });
  await settle();
  layOut(page, 390);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const head = page.querySelector<HTMLElement>(".inbox-item-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Inbox", INVITES.name, "Inbox item actions"],
    "one control a corner, the item's task between them",
  );
  assert.equal(
    head.querySelector(".ui-toolbar-heading")?.textContent,
    INVITES.name,
    "the bar names the item's task, not the title its thread is headed by under it",
  );
  assert.deepEqual(
    [...page.querySelectorAll("h1")]
      .filter((each) => each.closest("[hidden]") === null)
      .map((each) => each.textContent),
    ["Expire after 7 days?"],
    "the thread's title is the page's one top heading",
  );

  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Inbox item actions"]')?.click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.ok(menu, "the ⋯ opens");
  assert.match(menu.textContent ?? "", /\d of \d/, "it says where the item stands");
  const labels = [...menu.querySelectorAll(".ui-menu-item-label")].map((each) => each.textContent);
  for (const offered of [
    "Previous inbox item",
    "Next inbox item",
    "Open task",
    "Open agent",
    "Show panel",
    "Find",
    "Copy link",
  ]) {
    assert.ok(labels.includes(offered), `the ⋯ offers ${offered}`);
  }
  const openTask = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.querySelector(".ui-menu-item-label")?.textContent === "Open task",
  );
  act(() => openTask?.click());
  assert.deepEqual(
    asked.shownTasks,
    [INVITES.id],
    "Open task opens the item's task, as its crumb did",
  );
  const task = [...head.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === INVITES.name,
  );
  act(() => task?.click());
  assert.deepEqual(asked.shownTasks, [INVITES.id, INVITES.id], "the task's name opens it too");

  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(columnsShown(page), ["list"], "the way back stands the list");
});

test("on a phone the panel open over an item heads itself: the way back to the item, what it shows centered, and one ⋯ listing its tabs, in place of its bar", async () => {
  let shut = 0;
  const panel: SidePanelControl = {
    ...tasksControl().sidePanel,
    open: true,
    fullScreen: true,
    fullScreenOnly: true,
    onToggle: () => {
      shut += 1;
    },
  };
  const { page } = mount([], { room: SHELL_ROOM.NARROW, panel });
  await settle();
  layOut(page, 390);
  act(() => rowNamed(page, "Expire after 7 days?").click());
  await settle();
  const head = page.querySelector<HTMLElement>(".side-panel .panel-head");
  assert.ok(head, "the panel heads itself");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Expire after 7 days?", "Panel actions"],
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]')?.click());
  assert.ok(
    [...document.querySelectorAll(".ui-menu-item-label")].some(
      (each) => each.textContent === "Tabs",
    ),
    "the ⋯ lists the panel's tabs",
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]')?.click());
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.equal(shut, 1, "the way back shuts the panel");
});

/** The button standing anywhere in the window whose words are `words`. */
function buttonSaying(words: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === words,
    ) ?? assert.fail(`a button says ${words}`)
  );
}

/** The rows the list draws, by their titles, in its order. */
function rowTitles(page: HTMLElement): (string | null | undefined)[] {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.ui-list-row-main"),
  ].map((row) => row.querySelector(ROW_TITLE)?.textContent);
}

test("a task chosen narrows the Inbox to every item of its own, open and settled, addressed to anyone, under a chip naming it and no view's menu, whose × lists every task's items under the view kept", async () => {
  world.inboxes = new Map([
    [BILLING.id, [{ ...THRESHOLD, startedBy: TEAMMATE }, RETRY]],
    [INVITES.id, [EXPIRY]],
  ]);
  const { page } = mount();
  await settle();
  showScope(page, "Open");
  chooseView(page, "Addressed to", "Me");
  await settle();

  act(() => chooseInboxTask(BILLING.id));
  await settle();
  const narrowed = rowTitles(page).toSorted();
  const menu = page.querySelector('button[aria-label="View options"]');
  const chip = page.querySelector<HTMLElement>('[aria-label="Show every task\'s items"]');
  const named = chip?.closest(".inbox-tasks-chips")?.textContent;
  await act(async () => chip?.click());
  await settle();

  assert.deepEqual(
    narrowed,
    [RETRY.title, THRESHOLD.title].toSorted(),
    "Billing's items, the settled one and the teammate's among them",
  );
  assert.equal(menu, null, "a task's items are listed whole, with no view's menu");
  assert.ok(named?.includes(BILLING.name), `the chip names the task: ${named}`);
  assert.deepEqual(
    rowTitles(page),
    [EXPIRY.title],
    "the × lists every task's items, Open and mine",
  );
});

test("ticking the box's checkbox under an open question sets its options aside and sends its words as a new thread to the item's agent, which the Inbox then opens, the box a reply again", async () => {
  world.listedWorkspace = ACME;
  world.inboxes = new Map([[BILLING.id, [THRESHOLD]]]);
  const starts = heldStarts();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();

  const box = () =>
    itemPane(page).querySelector<HTMLElement>('[role="checkbox"]') ??
    assert.fail("the box offers a new thread");
  assert.equal(
    box().closest("label")?.textContent,
    "Send as a new thread to Alerts",
    "it names the item's agent",
  );
  const options = () => itemPane(page).querySelectorAll('[role="radio"]').length;
  assert.equal(options(), 2, "the question's options stand over the box");
  act(() => box().click());
  assert.equal(options(), 0, "ticked, the box sets the question's options aside");
  const pane = itemPane(page);
  typeInComposer(pane, "Draft the annual plan's line too.");
  const send =
    pane.querySelector<HTMLButtonElement>("form.inbox-answer button[type='submit']") ??
    assert.fail("the box has a Send");
  assert.equal(send.textContent, "Start thread");
  act(() => send.click());
  await settle();

  assert.deepEqual(
    starts.map(({ agentId, title, text }) => ({ agentId, title, text })),
    [{ agentId: AGENT.id, title: undefined, text: "Draft the annual plan's line too." }],
  );
  assert.equal(
    itemPane(page).getAttribute("aria-label"),
    STARTED.title,
    "the thread it started opens",
  );
  assert.equal(box().getAttribute("aria-checked"), "false", "its box is a reply again");
});

test("words written in the box while its new thread starts stay in it once the thread has started", async () => {
  world.listedWorkspace = ACME;
  world.inboxes = new Map([[BILLING.id, [noticeOf(THRESHOLD)]]]);
  const answer = Promise.withResolvers<FakeActAnswer>();
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      request.kind === ACT_KIND.AGENTS_INBOX_START ? answer.promise : previous(request),
  });
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();

  const pane = itemPane(page);
  act(() =>
    (
      pane.querySelector<HTMLElement>('[role="checkbox"]') ??
      assert.fail("the box offers a new thread")
    ).click(),
  );
  typeInComposer(pane, "Draft the annual plan's line too.");
  act(() =>
    (
      pane.querySelector<HTMLButtonElement>("form.inbox-answer button[type='submit']") ??
      assert.fail("the box has a Send")
    ).click(),
  );
  typeInComposer(pane, "And the footer.");
  world.inboxes.set(BILLING.id, [STARTED, noticeOf(THRESHOLD)]);
  pushAgain();
  await act(async () => answer.resolve({ status: FAKE_ANSWER.DONE, value: { item: STARTED } }));
  await settle();
  act(() => rowNamed(page, THRESHOLD.title).click());
  await settle();

  assert.equal(composerEditor(itemPane(page)).textContent, "And the footer.");
});

test("an item opened whose agent's inbox could not be read says so in the pane, and Retry reads it there", async () => {
  world.listedWorkspace = ACME;
  // Note that no holding names the billing task, nor the feed its agent, so its item is opened by its agent, whose own read fails.
  world.tasklessAgents = new Map([[AGENT.id, AGENT]]);
  world.agentInboxes = new Map([[AGENT.id, [THRESHOLD]]]);
  world.feedLeavesOut = new Set([AGENT.id]);
  world.agentReadFails = true;
  const { page } = mount([], { holding: [] });
  await settle();
  act(() => world.chooseFromOutside({ agentId: AGENT.id, itemId: THRESHOLD.id, opened: true }));
  await settle();
  assert.match(page.textContent ?? "", /This item could not be read\./u);

  world.agentReadFails = false;
  act(() => buttonSaying("Retry").click());
  await settle();
  assert.equal(
    itemPane(page).getAttribute("aria-label"),
    THRESHOLD.title,
    "the item is read again",
  );
});

test("an item of an agent with no task reads the lines its code names through the agent's workspace and repository, and a file its words name opens beside the Inbox rather than on GitHub", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const words = [
    `https://github.com/acme/relay/blob/${commit}/src/flaky.test.ts#L3-L5`,
    "The retry is in [@flaky.test.ts](https://github.com/acme/relay/blob/HEAD/src/flaky.test.ts).",
  ].join("\n\n");
  world.agentInboxes = new Map([[SWEEP_AGENT, [saying(QUARANTINE, words)]]]);
  const openedOnGitHub = skillReads();
  const previewed: string[] = [];
  const panel: SidePanelControl = {
    ...tasksControl().sidePanel,
    onPreviewFile: (ref, at) => previewed.push(`${JSON.stringify(ref)} ${at}`),
  };
  const { page } = mount([{ ...waitingTaskless(QUARANTINE), workspaceId: "workspace-acme" }], {
    panel,
  });
  await settle();
  act(() => rowNamed(page, "Quarantine the flaky test?").click());
  await settle();

  assert.deepEqual(
    world.fileReads.map(({ firstLine: _first, lastLine: _last, ...place }) => place),
    [
      {
        path: "src/flaky.test.ts",
        workspaceId: "workspace-acme",
        repository: "acme/relay",
        ref: commit,
      },
    ],
    "the code reads its lines by the agent's workspace and repository, naming no task",
  );

  const chip = [
    ...page.querySelectorAll<HTMLElement>("[data-inbox-message-text] [data-mention-ref]"),
  ].find((each) => each.querySelector(".ui-inline-ref-label")?.textContent === "flaky.test.ts");
  assert.ok(chip, "the file is its chip");
  act(() => chip.click());
  assert.deepEqual(previewed, [`${JSON.stringify({ path: "src/flaky.test.ts" })} undefined`]);
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
});
