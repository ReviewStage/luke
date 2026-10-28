// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { INBOX_MESSAGE_AUTHOR, INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppInboxTask, AppInboxTasklessItem } from "@luke/host/app-state";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { Effect } from "effect";
import { act } from "react";
import { beforeAll, test } from "vitest";
import { appBridge } from "../app-bridge.js";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { chooseChannel, leaveChannel } from "../tasks/use-channels.js";
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
  GENERAL,
  headerNamed,
  headTitle,
  heardName,
  hoveredCard,
  INVITES,
  item,
  itemPane,
  layOut,
  listEdge,
  listed,
  menuItem,
  mount,
  noticeOf,
  ON_THRESHOLD,
  openings,
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
import { tasksControl, waitingOf } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// The parser an answer's note is drawn through, landed as the panel lands it.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

test("the Inbox left and come back to under the window's root draws the rows it held at once, before any follow pushes again", async () => {
  const { page } = mount([], { windowRoot: true });
  await settle();
  const rows = listed(page);
  assert.ok(
    rows.some((row) => row.endsWith(THRESHOLD.title)),
    "the rows are pushed and drawn",
  );

  act(() => world.setInboxOpen(false));
  await settle();
  act(() => world.setInboxOpen(true));
  assert.deepEqual(listed(page), rows, "drawn from what the window held, nothing pushed anew");
});

test("a task whose follow failed before the Inbox was left is followed again once the Inbox is come back to", async () => {
  const { page } = mount([], { windowRoot: true });
  await settle();
  world.main.push(
    { kind: INBOX_SCOPE_KIND.PLAN, id: INVITES.id },
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
  );
  act(() => world.setInboxOpen(false));
  await settle();

  act(() => world.setInboxOpen(true));
  await settle();
  assert.ok(
    world.main.isFollowed({ kind: INBOX_SCOPE_KIND.PLAN, id: INVITES.id }),
    "the failed task is followed anew",
  );
  assert.ok(
    listed(page).some((row) => row.endsWith(EXPIRY.title)),
    "its items are drawn again",
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
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
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

test("one column wide, the item's bar says where it stands in the list, and its arrows, K, and J step up and down the list in its order, a settled item among them, stopping at its ends", async () => {
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();
  const keys = standKeymap();
  layOut(page, 800);
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "2 of 3"]);

  act(() => arrowNamed(page, "Previous item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["How is a failed email retried?", "1 of 3"]);
  assert.equal(arrowNamed(page, "Previous item").disabled, true, "nothing above the first");
  pressKey("k");
  assert.equal(readTitle(page), "How is a failed email retried?");

  pressKey("j");
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Alert at 80%?", "2 of 3"]);
  act(() => arrowNamed(page, "Next item").click());
  assert.deepEqual([readTitle(page), pagerOf(page)], ["Expire after 7 days?", "3 of 3"]);
  assert.equal(arrowNamed(page, "Next item").disabled, true, "nothing below the last");
  pressKey("j");
  assert.equal(readTitle(page), "Expire after 7 days?");
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
  assert.deepEqual(listed(page), ["# Invites", "*Expire after 7 days?"]);
  assert.equal(page.querySelector(".inbox-view-items [data-inbox-title]"), null);
  assert.equal(page.querySelector(".inbox-view-items")?.textContent, "1 thread");
});

test("an item of an agent with no plan stands under the automation that started it, and opens on its agent's own read under the automation's crumb", async () => {
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

  assert.ok(
    world.agentReads.length > 0 && world.agentReads.every((agentId) => agentId === SWEEP_AGENT),
  );
  const rows = listed(page);
  assert.ok(rows.includes("# Nightly flake sweep"), rows.join(" | "));
  assert.equal(rows[rows.indexOf("# Nightly flake sweep") + 1], "*Quarantine the flaky test?");

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
  const [mine, theirs] = rows.map((row) => row.querySelector("button.luke-list-row-main"));
  assert.ok(mine && theirs);
  restOn(mine);
  await settle();
  const card = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.ok(card, "the agent's page hangs the page's own card");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "Flake ledger");
  assert.equal(
    card.querySelector(".luke-hover-card-sub")?.textContent,
    "Version 3 · Shown by Sweep the flaky tests",
  );
  assert.equal(
    card.querySelector(".luke-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ agentId: SWEEP_AGENT, pageId: ledger.id, version: 3 }),
  );
  act(() => {
    mine.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });

  restOn(theirs);
  await settle();
  const refused = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.deepEqual(
    [
      refused?.querySelector(".luke-hover-card-name")?.textContent,
      refused?.querySelector(".luke-hover-card-note")?.textContent,
    ],
    ["Their ledger", "Luke cannot read this page."],
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
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Sweep the flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

test("a task's group header hangs the task's card, as the automation's does its own", async () => {
  const { page } = mount();
  await settle();
  const header = headerNamed(page, "Invites");
  restOn(header);
  // Note that this window stands no chip cards, so the header hangs the card's fallback: the task's head.
  const name = document.querySelector(".luke-tooltip-card .luke-hover-card-name");
  assert.equal(name?.textContent, "Invites", "the header hangs a card named for its task");
});

const LUKE_AGENT = "8b9c0d1e-2f3a-4b4c-8d5e-6f7a8b9c0d1e";
const DOMAIN: InboxItem = {
  ...item("a1b2c3d4-0000-4000-8000-00000000000d", "Name a domain?", 1_200),
  agentId: LUKE_AGENT,
};

/** An item of the reader's operator, Luke, as main lists it: no task, no automation, and no repository. */
function lukeTaskless(asked: InboxItem): AppInboxTasklessItem {
  return {
    id: asked.id,
    agentId: asked.agentId,
    agentKind: CODING_AGENT_KIND.OPERATOR,
    title: asked.title,
    postedAt: asked.postedAt,
    updatedAt: asked.updatedAt,
    agentTitle: "Luke",
    agentModel: "anthropic/claude-opus-5.5",
    automationId: null,
    automationName: null,
    repository: null,
    ...(asked.channelId === undefined ? undefined : { channelId: asked.channelId }),
  };
}

test("an automation's group wears its clock tile and hangs its card, as its crumb does, the card's name opening its page since the header's press folds; its agent's row hangs a card naming the agent and the automation that started it; the agents no automation names stand under no actor; the member's operator stands under Luke, by his face", async () => {
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
    [LUKE_AGENT, [DOMAIN]],
  ]);
  const { page, asked } = mount([
    { ...waitingTaskless(QUARANTINE), agentTitle: "Sweep the flaky tests" },
    { ...waitingTaskless(BUMP), automationId: null, automationName: null },
    lukeTaskless(DOMAIN),
  ]);
  await settle();

  const sweep = headerNamed(page, "Nightly flake sweep");
  assert.ok(
    sweep.querySelector(':scope > [aria-hidden="true"] .actor-mark[data-kind="automation"]'),
    "the automation's group wears its clock tile",
  );
  assert.match(hoveredCard(sweep, '[data-actor-card="automation"]') ?? "", /Nightly flake sweep/u);
  assert.deepEqual(openings('[data-actor-card="automation"]'), [], "no Open automation");
  const name = document.querySelector<HTMLButtonElement>(
    '.luke-tooltip-card [data-actor-card="automation"] .luke-hover-card-name button',
  );
  assert.equal(name?.textContent, "Nightly flake sweep", "the card's name is a button");
  act(() => name?.click());
  assert.deepEqual(asked.shownAutomations, [SWEEP.id]);
  assert.equal(sweep.getAttribute("aria-expanded"), "true", "the header itself still only folds");

  const others = headerNamed(page, "Other agents");
  assert.ok(others.querySelector(".actor-mark") === null, "a group of agents names no actor");
  assert.ok(
    others.querySelector(':scope > [aria-hidden="true"] .lucide-zap'),
    "a group of agents wears the automation glyph, naming no one actor",
  );

  const mark = rowNamed(page, "Quarantine the flaky test?");
  assert.equal(
    wearsAgentTile(mark),
    false,
    "the planless agent's row wears no tile, its card naming the agent",
  );
  assert.match(
    hoveredCard(mark, "[data-inbox-row-card]") ?? "",
    /^Nightly flake sweep.*Sweep the flaky tests$/su,
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
    document.querySelector('.luke-tooltip-card [data-actor-card="automation"] button')?.textContent,
    undefined,
    "the crumb's card offers nothing to press, since the crumb opens the automation",
  );
  act(() => crumb.click());
  assert.deepEqual(asked.shownAutomations, [SWEEP.id, SWEEP.id]);

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

  const luke = headerNamed(page, "Luke");
  assert.ok(luke.querySelector(".luke-face"), "Luke's group wears his face");
  assert.ok(luke.querySelector(".lucide-zap") === null, "and no automation glyph");
  act(() => rowNamed(page, "Name a domain?").click());
  await settle();
  // Note that the title joins the path only once the heading scrolls away, so his own crumb stands alone.
  const path = [...page.querySelectorAll<HTMLElement>('nav[aria-label="Path"] li')];
  assert.equal(path.length, 1, "his path names him once, under no group");
  assert.ok(path[0]?.querySelector(".luke-face"), "his crumb wears his face");
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
      '.luke-tooltip-card [data-inbox-row-card] [data-holder-ref][data-kind="agent"]',
    ) ?? assert.fail("the card names the automation by its chip");
  restOn(chip);
  await settle();

  assert.match(
    wordsOf(document.querySelector('.luke-tooltip-card [data-actor-card="automation"]')) ?? "",
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
      '.luke-tooltip-card [data-inbox-row-card] [data-holder-ref][data-kind="agent"]',
    ) ?? assert.fail("the card names the automation by its chip"),
  );

  assert.match(
    wordsOf(document.querySelector('.luke-tooltip-card [data-actor-card="automation"]')) ?? "",
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

test("a read of an agent with no plan that fails is said with Retry, which reads it again though it was read before", async () => {
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK, THIRD_ASK]]]);
  const { page } = mount([QUARANTINE, SECOND_ASK, THIRD_ASK].map(waitingTaskless));
  await settle();

  world.agentReadFails = true;
  act(() => world.setTaskless([QUARANTINE, THIRD_ASK].map(waitingTaskless)));
  await settle();
  assert.match(
    page.querySelector(".inbox-tasks")?.textContent ?? "",
    /Some items could not be read\./u,
  );
  const before = world.agentReads.filter((agentId) => agentId === SECOND_AGENT).length;

  world.agentReadFails = false;
  act(() =>
    [...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks button")]
      .find((button) => button.textContent === "Retry")
      ?.click(),
  );
  await settle();

  assert.ok(world.agentReads.filter((agentId) => agentId === SECOND_AGENT).length > before);
  assert.doesNotMatch(page.querySelector(".inbox-tasks")?.textContent ?? "", /could not be read/u);
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
  assert.match(hoveredCard(row, "[data-inbox-row-card]") ?? "", /Nightly flake sweep$/u);
});

test("an item's row offers Copy link on a right-click, copying the item's link under the task that holds it", async () => {
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

  assert.deepEqual(world.copied, [
    `https://tryluke.dev/acme/plan/${BILLING.id}/inbox/${THRESHOLD.id}`,
  ]);
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
    /Not foundThis Inbox item doesn't exist, or you don't have access to it\./u,
  );
  assert.equal(page.querySelector('.inbox-tasks [aria-current="page"]'), null);
});

test("a link to a settled item of an agent with no plan, none of whose items waits any more, lists the agent by its own read and shows the item", async () => {
  const settled = { ...BUMP, status: INBOX_STATUS.ANSWERED };
  world.agentInboxes = new Map([[STRAY_AGENT, [settled]]]);
  world.pageAgents = new Map([
    [STRAY_AGENT, { ...AGENT, id: STRAY_AGENT, planId: null, title: "Bump" }],
  ]);
  const { page } = mount();
  await settle();
  act(() => world.chooseFromOutside({ agentId: STRAY_AGENT, itemId: BUMP.id, opened: true }));
  await settle();

  assert.doesNotMatch(page.textContent ?? "", /Not found/u);
  assert.equal(
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Bump the Node image?",
  );
});

test("an item a link names is not found though another task's read failed, and in a narrow Inbox the notice stands alone, not the list, with a way back to it", async () => {
  world.startRead = (taskId) =>
    taskId === BILLING.id
      ? Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
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
  world.pageAgents = new Map([
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
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Page on-call too?",
  );
});

test("an item a link names under a task whose own read fails is kept asked for, and no other task's item is chosen in its place", async () => {
  const quiet = { ...INVITES, id: "0f0e0d0c-0000-4000-8000-00000000a11f", name: "Quiet task" };
  world.startRead = (taskId) =>
    taskId === quiet.id
      ? Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
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
  world.pageAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
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
    page.querySelector('.inbox-tasks [aria-current="page"] .luke-list-row-title')?.textContent,
    "Retry the flaky job?",
  );
});

test("an item a link names under an agent nothing waits on any more, read before, is not found by that read though the agent's own read fails", async () => {
  world.agentInboxes = new Map([[SECOND_AGENT, [SECOND_ASK]]]);
  world.pageAgents = new Map([[SECOND_AGENT, { ...AGENT, id: SECOND_AGENT, planId: null }]]);
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

test("a teammate's open item of an agent with no plan is listed under the automation that started it, wearing the teammate's face with no attention mark; To do leaves it out, and Group by person lists it under the teammate, whose header hangs their card", async () => {
  world.agentInboxes = new Map([[SWEEP_AGENT, [{ ...QUARANTINE, startedBy: TEAMMATE }]]]);
  const { page } = mount([{ ...waitingTaskless(QUARANTINE), startedBy: TEAMMATE.userId }]);
  await settle();
  const rows = listed(page);
  assert.equal(
    rows[rows.indexOf("# Nightly flake sweep") + 1],
    "Quarantine the flaky test?",
    rows.join(" | "),
  );
  const meta = rowNamed(page, "Quarantine the flaky test?").querySelector(".luke-list-row-meta");
  assert.equal(meta?.querySelector(".attention-mark"), null);
  assert.equal(meta?.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
  assert.equal(meta?.querySelector(".luke-visually-hidden")?.textContent, "Waiting on Charles Pan");

  showScope(page, "For you");
  assert.equal(
    listed(page).includes("Quarantine the flaky test?"),
    false,
    listed(page).join(" | "),
  );

  showScope(page, "All");
  chooseView(page, "Group by", "Person");
  const byPerson = listed(page);
  assert.equal(
    byPerson[byPerson.indexOf("# Charles Pan") + 1],
    "Quarantine the flaky test?",
    byPerson.join(" | "),
  );
  const header = [
    ...page.querySelectorAll<HTMLButtonElement>(
      ".inbox-tasks .luke-group-header-head button[aria-expanded]:not([aria-haspopup])",
    ),
  ].find((each) => heardName(each) === "Charles Pan");
  assert.ok(header, "Charles Pan heads a group");
  restOn(header);
  assert.equal(
    document.querySelector(".luke-tooltip-card [data-actor-card='person'] .luke-hover-card-name")
      ?.textContent,
    "Charles Pan",
    "a person's group header hangs their card",
  );
});

test("on a phone the Inbox's list is headed by New task and one ⋯, its title centred between them, the ⋯ opening View options' own menu, and the search standing under the head", async () => {
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
    ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === name);
    assert.ok(item, `the ⋯ offers ${name}`);
    act(() => item.click());
  };
  act(() => more().click());
  assert.deepEqual(
    [...document.querySelectorAll('[role="menu"] .luke-menu-item-label')].map(
      (each) => each.textContent,
    ),
    ["View options"],
    "the ⋯ holds what the wide head draws as buttons",
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
function heldStarts(): CodingAgentInboxStartParams[] {
  const sent: CodingAgentInboxStartParams[] = [];
  const bridge = appBridge();
  const previous = fakeActsAnswer();
  fakeActs({
    ...bridge,
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_START) return previous(request);
      sent.push(request.payload);
      world.inboxes.set(BILLING.id, [STARTED, ...(world.inboxes.get(BILLING.id) ?? [])]);
      pushAgain();
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { item: STARTED } });
    },
  });
  return sent;
}

test("on a phone an item is headed by its way back's glyph, its task centred, which opens it as its crumb does, and one ⋯ that says where it stands and holds the pager, what the crumbs opened, the panel, and the item's own actions", async () => {
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
    head.querySelector(".luke-toolbar-heading")?.textContent,
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
  const labels = [...menu.querySelectorAll(".luke-menu-item-label")].map(
    (each) => each.textContent,
  );
  for (const offered of [
    "Previous inbox item",
    "Next inbox item",
    "Open task",
    "Open agent",
    "Show panel",
    "Copy link",
  ]) {
    assert.ok(labels.includes(offered), `the ⋯ offers ${offered}`);
  }
  const openTask = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === "Open task",
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

test("on a phone the panel open over an item heads itself: the way back to the item, what it shows centred, and one ⋯ listing its tabs, in place of its bar", async () => {
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
    [...document.querySelectorAll(".luke-menu-item-label")].some(
      (each) => each.textContent === "Tabs",
    ),
    "the ⋯ lists the panel's tabs",
  );
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]')?.click());
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.equal(shut, 1, "the way back shuts the panel");
});

/** #app, a second standing channel of the workspace. */
const APP_CHANNEL: Channel = {
  id: "c0ffee00-0000-4000-8000-000000000002",
  name: "app",
  purpose: "The desktop and web apps",
  project: false,
  createdAt: 2,
  waiting: 0,
};

/** A follow of the channels a test pushes on: each word pushed is handed to the window as the host hands it. */
function channelFollow() {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const stream: AsyncIterableIterator<unknown> = {
    [Symbol.asyncIterator]: () => stream,
    next: async () => {
      while (queue.length === 0 && !closed) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return closed ? { done: true, value: undefined } : { done: false, value: queue.shift() };
    },
    return: async () => {
      closed = true;
      wake?.();
      return { done: true, value: undefined };
    },
  };
  return {
    stream,
    push: (word: unknown) => {
      queue.push(word);
      wake?.();
    },
  };
}

/**
 * Answers the channels' acts as a test says, every other act as before:
 * the channels listed, a thread moved, and the follow where one is given.
 */
function answerChannels(answers: {
  channels?: () => readonly Channel[];
  follow?: AsyncIterableIterator<unknown>;
  /** A channel made, archived, or unarchived, or a thread moved, before the service answers it. */
  onWrite?: (write: AnyAct) => void;
  /** The workspace's archived channels, or why their read fails; the read is refused where none are given. */
  archived?: () => readonly ArchivedChannel[] | { readonly failure: string };
}): void {
  const previous = fakeActsAnswer();
  const done = (value: unknown): Promise<FakeActAnswer> =>
    Promise.resolve({ status: FAKE_ANSWER.DONE, value } as FakeActAnswer);
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.CHANNELS_LIST) {
        return done({ channels: answers.channels?.() ?? [GENERAL] });
      }
      if (
        request.kind === ACT_KIND.CHANNELS_LOOK ||
        request.kind === ACT_KIND.CHANNELS_CREATE ||
        request.kind === ACT_KIND.CHANNELS_ARCHIVE ||
        request.kind === ACT_KIND.CHANNELS_UNARCHIVE
      ) {
        answers.onWrite?.(request);
        return done({ channels: answers.channels?.() ?? [GENERAL] });
      }
      if (request.kind === ACT_KIND.CHANNELS_MOVE) {
        answers.onWrite?.(request);
        return done({ thread: { ...THRESHOLD, channelId: request.payload.channelId } });
      }
      if (request.kind === ACT_KIND.CHANNELS_ARCHIVED && answers.archived !== undefined) {
        const archived = answers.archived();
        return done("failure" in archived ? archived : { channels: archived });
      }
      if (request.kind === ACT_KIND.CHANNELS_FOLLOW && answers.follow !== undefined) {
        return done(answers.follow);
      }
      return previous(request);
    },
  });
}

/** The rows the list draws, by their titles, in its order. */
function rowTitles(page: HTMLElement): (string | null | undefined)[] {
  return [
    ...page.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main"),
  ].map((row) => row.querySelector(ROW_TITLE)?.textContent);
}

/** The words after the list's head's title: a channel's purpose, or when it was archived. */
function headDetail(page: HTMLElement): string | null | undefined {
  return page.querySelector(".inbox-tasks .luke-toolbar-detail")?.textContent;
}

/** The sidebar's channel rows under its Inbox row, as a reader meets them: each one's words, its count among them. */
function sidebarChannels(page: HTMLElement): (string | null)[] {
  const group =
    page.querySelector('.sidebar-places [role="group"][aria-label="Channels"]') ??
    assert.fail("the channels stand among the sidebar's places");
  return [...group.querySelectorAll(".luke-nav-item")].map((row) => row.textContent);
}

/** Types `words` into a field as a reader would. */
function typeInto(field: HTMLInputElement | null, words: string): void {
  if (field === null) assert.fail("the field stands");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The button standing anywhere in the window whose words are `words`. */
function buttonSaying(words: string): HTMLButtonElement {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === words,
    ) ?? assert.fail(`a button says ${words}`)
  );
}

test("a channel narrows the Inbox to its own threads, everyone's, under its name and purpose", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  answerChannels({ channels: () => [GENERAL, APP_CHANNEL] });
  world.inboxes = new Map([
    [
      BILLING.id,
      [
        { ...THRESHOLD, channelId: GENERAL.id, startedBy: TEAMMATE },
        { ...RETRY, channelId: APP_CHANNEL.id },
      ],
    ],
    [INVITES.id, [{ ...EXPIRY, channelId: GENERAL.id }]],
  ]);
  const { page } = mount([], { channels: true });
  await settle();

  assert.equal(headTitle(page), "#general");
  assert.equal(headDetail(page), GENERAL.purpose);
  assert.deepEqual(
    rowTitles(page),
    [EXPIRY.title, THRESHOLD.title],
    "#general's threads alone, a teammate's among them, the latest first",
  );
});

test("a channel left on another scope opens on All of everyone's again", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  answerChannels({ channels: () => [GENERAL, APP_CHANNEL] });
  world.inboxes = new Map([
    [BILLING.id, [{ ...THRESHOLD, channelId: GENERAL.id, startedBy: TEAMMATE }]],
  ]);
  const { page } = mount([], { channels: true });
  await settle();
  showScope(page, "For you");
  await settle();
  assert.deepEqual(rowTitles(page), [], "For you leaves out the teammate's thread");

  act(() => leaveChannel());
  await settle();
  act(() => chooseChannel(GENERAL.id));
  await settle();
  assert.equal(headTitle(page), "#general");
  assert.deepEqual(rowTitles(page), [THRESHOLD.title]);
});

test("a channel chosen while the workspace's channels could not be read says so with Retry", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  // Note that the window holds each workspace's channels across reads, a failed one keeping them, so this workspace is one no test read before.
  world.listedWorkspace = { ...ACME, id: "workspace-channels-unread" };
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      request.kind === ACT_KIND.CHANNELS_LIST
        ? Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { failure: "unanswered" },
          } as FakeActAnswer)
        : previous(request),
  });
  const { page } = mount([], { channels: true });
  await settle();
  const notRead =
    page.querySelector<HTMLElement>('section[aria-label="Channels not read"]') ??
    assert.fail("the failed read is said");
  assert.match(notRead.textContent ?? "", /Could not read this workspace's channels\./u);
});

test("ticking the box's checkbox sends its words as a new thread to the item's agent in the item's channel, which the Inbox then opens, the box a reply again", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const moves: unknown[] = [];
  answerChannels({
    channels: () => [GENERAL, APP_CHANNEL],
    onWrite: (write) => {
      if (write.kind === ACT_KIND.CHANNELS_MOVE) moves.push(write.payload);
    },
  });
  // Note that the item asks nothing, since a question's controls standing in the box leave no checkbox under it.
  world.inboxes = new Map([[BILLING.id, [{ ...noticeOf(THRESHOLD), channelId: APP_CHANNEL.id }]]]);
  const starts = heldStarts();
  const { page } = mount([], { chosen: ON_THRESHOLD });
  await settle();

  const box = () =>
    itemPane(page).querySelector<HTMLElement>('[role="checkbox"]') ??
    assert.fail("the box offers a new thread");
  assert.equal(
    box().closest("label")?.textContent,
    "Send as a new thread to Alerts in app",
    "it names the item's agent and channel",
  );
  act(() => box().click());
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
  assert.deepEqual(moves, [{ threadId: STARTED.id, channelId: APP_CHANNEL.id }]);
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
      request.kind === ACT_KIND.CODING_AGENTS_INBOX_START ? answer.promise : previous(request),
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

test("a thread started from an item of an archived channel lands in #general, and the Inbox turns to #general to open it", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const old: ArchivedChannel = {
    id: "c0ffee00-0000-4000-8000-0000000000aa",
    name: "old-app",
    purpose: "The apps, before the split",
    project: false,
    createdAt: 1,
    archivedAt: 2,
  };
  answerChannels({ archived: () => [old] });
  world.inboxes = new Map([[BILLING.id, [{ ...noticeOf(THRESHOLD), channelId: old.id }]]]);
  heldStarts();
  const { page } = mount([], { channels: true, chosen: ON_THRESHOLD });
  await settle();
  act(() => chooseChannel(old.id));
  await settle();

  const box =
    itemPane(page).querySelector<HTMLElement>('[role="checkbox"]') ??
    assert.fail("the box offers a new thread");
  assert.equal(box.closest("label")?.textContent, "Send as a new thread to Alerts in general");
  act(() => box.click());
  const pane = itemPane(page);
  typeInComposer(pane, "Draft the annual plan's line too.");
  act(() =>
    (
      pane.querySelector<HTMLButtonElement>("form.inbox-answer button[type='submit']") ??
      assert.fail("the box has a Send")
    ).click(),
  );
  await settle();

  assert.equal(headTitle(page), "#general");
  assert.equal(itemPane(page).getAttribute("aria-label"), STARTED.title);
});

test("with Channels on, a row's ⋯ moves its thread to the channel picked", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const moves: unknown[] = [];
  answerChannels({
    channels: () => [GENERAL, APP_CHANNEL],
    onWrite: (write) => {
      if (write.kind === ACT_KIND.CHANNELS_MOVE) moves.push(write.payload);
    },
  });
  world.inboxes = new Map([[BILLING.id, [{ ...THRESHOLD, channelId: GENERAL.id }]]]);
  const { page } = mount();
  await settle();

  act(() => {
    rowNamed(page, THRESHOLD.title).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  act(() => menuItem("Move to channel…").click());
  await settle();
  act(() => buttonSaying("Move to #app").click());
  await settle();

  assert.deepEqual(moves, [{ threadId: THRESHOLD.id, channelId: APP_CHANNEL.id }]);
});

test("the sidebar lists the channels under the Inbox's row, each with what waits on the reader, and a press narrows the Inbox to one", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const project: Channel = {
    ...APP_CHANNEL,
    id: "c0ffee00-0000-4000-8000-000000000003",
    name: "launch",
    project: true,
  };
  answerChannels({ channels: () => [project, GENERAL, APP_CHANNEL] });
  // Note that a row counts the questions main lists in its channel, as the Inbox's row counts them.
  const waiting: readonly AppInboxTask[] = [
    { taskId: BILLING.id, items: [waitingOf({ ...THRESHOLD, channelId: GENERAL.id })] },
    { taskId: INVITES.id, items: [waitingOf({ ...EXPIRY, channelId: GENERAL.id })] },
  ];
  const { page } = mount([], { withSidebar: true, waiting });
  await settle();

  assert.deepEqual(sidebarChannels(page), ["general2 need you", "app", "launch", "Add channel"]);
  act(() =>
    (
      [...page.querySelectorAll<HTMLButtonElement>('[aria-label="Channels"] .luke-nav-item')].find(
        (row) => row.textContent === "app",
      ) ?? assert.fail("#app's row stands")
    ).click(),
  );
  await settle();
  assert.equal(headTitle(page), "#app");
});

test("a channel made from the sidebar's Add channel narrows the Inbox to it once the service has made it", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  let standing: readonly Channel[] = [GENERAL];
  answerChannels({
    channels: () => standing,
    onWrite: (write) => {
      if (write.kind === ACT_KIND.CHANNELS_CREATE) standing = [GENERAL, APP_CHANNEL];
    },
  });
  const { page } = mount([], { withSidebar: true });
  await settle();
  act(() => buttonSaying("Add channel").click());
  act(() => menuItem("New channel").click());
  const dialog = document.querySelector('[role="dialog"]') ?? assert.fail("the dialog stands");
  const [name, purpose] = dialog.querySelectorAll<HTMLInputElement>("input");
  typeInto(name ?? null, "app");
  typeInto(purpose ?? null, "The desktop and web apps");
  act(() => buttonSaying("Create channel").click());
  await settle();
  assert.equal(headTitle(page), "#app");
});

test("a channel archived or unknown says so in the list's place, with the way to #general", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  answerChannels({});
  const { page } = mount([], { channels: true });
  await settle();
  act(() => chooseChannel("c0ffee00-0000-4000-8000-0000000000ff"));
  await settle();
  const missing =
    page.querySelector<HTMLElement>('section[aria-label="Channel not found"]') ??
    assert.fail("the channel's absence is said");

  act(() =>
    [...missing.querySelectorAll("button")]
      .find((button) => button.textContent === "Go to #general")
      ?.click(),
  );
  await settle();
  assert.equal(headTitle(page), "#general");
});

test("an archived channel narrows the Inbox under its name and when it was archived, and Unarchive opens it again", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const old: ArchivedChannel = {
    id: "c0ffee00-0000-4000-8000-0000000000aa",
    name: "old-app",
    purpose: "The apps, before the split",
    project: false,
    createdAt: 1,
    archivedAt: 2,
  };
  const unarchived: string[] = [];
  answerChannels({
    archived: () => [old],
    onWrite: (write) => {
      if (write.kind === ACT_KIND.CHANNELS_UNARCHIVE) unarchived.push(write.payload.channelId);
    },
  });
  world.inboxes = new Map([[BILLING.id, [{ ...THRESHOLD, channelId: old.id }]]]);
  const { page } = mount([], { channels: true });
  await settle();
  act(() => chooseChannel(old.id));
  await settle();

  assert.equal(headTitle(page), "#old-app");
  assert.match(headDetail(page) ?? "", /^Archived /u);
  assert.deepEqual(rowTitles(page), [THRESHOLD.title]);
  act(() => buttonSaying("Unarchive").click());
  await settle();
  assert.deepEqual(unarchived, [old.id]);
});

test("an archived channel shown stays shown when a later read of the archived channels fails", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const old: ArchivedChannel = {
    id: "c0ffee00-0000-4000-8000-0000000000ac",
    name: "old-app",
    purpose: "The apps, before the split",
    project: false,
    createdAt: 1,
    archivedAt: 2,
  };
  let archivedReads = 0;
  const follow = channelFollow();
  answerChannels({
    follow: follow.stream,
    archived: () => {
      archivedReads += 1;
      return archivedReads === 1 ? [old] : { failure: "unanswered" };
    },
  });
  const { page } = mount([], { channels: true });
  await settle();
  act(() => chooseChannel(old.id));
  await settle();
  assert.equal(headTitle(page), "#old-app");

  act(() => follow.push({ moved: [GENERAL.id] }));
  await settle();
  assert.ok(archivedReads > 1, "the archived channels were read again");
  assert.equal(headTitle(page), "#old-app", "a failed read kept it shown");
});

test("archiving the channel shown moves the window to #general and says so", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  let standing: readonly Channel[] = [GENERAL, APP_CHANNEL];
  answerChannels({
    channels: () => standing,
    onWrite: (write) => {
      if (write.kind === ACT_KIND.CHANNELS_ARCHIVE) standing = [GENERAL];
    },
  });
  const { page } = mount([], { channels: true, withSidebar: true, toasts: true });
  await settle();
  act(() => chooseChannel(APP_CHANNEL.id));
  await settle();
  const row =
    [...page.querySelectorAll<HTMLElement>('[aria-label="Channels"] .luke-nav-item')].find(
      (each) => each.textContent === "app",
    ) ?? assert.fail("#app's row stands");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  act(() => menuItem("Archive").click());
  act(() => buttonSaying("Archive channel").click());
  await settle();
  assert.equal(headTitle(page), "#general");
  assert.match(newestToastSays() ?? "", /#app is archived\. You're in #general now\./u);
});

test("an item opened whose agent's inbox could not be read says so in the pane, and Retry reads it there", async () => {
  world.listedWorkspace = ACME;
  // Note that no holding names the billing task, so its item is opened by its agent, whose own read fails.
  world.pageAgents = new Map([[AGENT.id, AGENT]]);
  world.agentInboxes = new Map([[AGENT.id, [THRESHOLD]]]);
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

/** The count a sidebar row wears, by the row's name; none where it wears none. */
function sidebarRowCount(page: HTMLElement, name: string): number | undefined {
  const row =
    [...page.querySelectorAll<HTMLElement>(".luke-nav-item")].find(
      (each) => each.querySelector(".luke-nav-item-name")?.textContent === name,
    ) ?? assert.fail(`the sidebar draws the row ${name}`);
  const count = row.textContent?.match(/\d+/u)?.[0];
  return count === undefined ? undefined : Number(count);
}

test("the channels' counts add up to the Inbox's, Luke's question among them, but for one in an archived channel, which has no row, and neither counts another workspace's", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  world.listedWorkspace = ACME;
  const previous = fakeActsAnswer();
  fakeActs({
    ...appBridge(),
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      request.kind === ACT_KIND.CHANNELS_LIST
        ? // Note that the service's own tally of each channel is not what a row counts, so it is set wrong here.
          Promise.resolve({
            status: FAKE_ANSWER.DONE,
            value: { channels: [GENERAL, APP_CHANNEL].map((each) => ({ ...each, waiting: 5 })) },
          } as FakeActAnswer)
        : previous(request),
  });
  world.agentInboxes = new Map([[LUKE_AGENT, [DOMAIN]]]);
  const waiting: readonly AppInboxTask[] = [
    { taskId: BILLING.id, items: [waitingOf({ ...THRESHOLD, channelId: GENERAL.id })] },
    { taskId: INVITES.id, items: [waitingOf({ ...EXPIRY, channelId: APP_CHANNEL.id })] },
  ];
  const archived = "c0ffee00-0000-4000-8000-000000000009";
  const { page } = mount(
    [
      { ...lukeTaskless({ ...DOMAIN, channelId: APP_CHANNEL.id }), workspaceId: ACME.id },
      {
        ...lukeTaskless({ ...BUMP, agentId: LUKE_AGENT, channelId: archived }),
        workspaceId: ACME.id,
      },
      // Note that another workspace's question is set in #general's place, so it would show on that row were it counted.
      {
        ...lukeTaskless({
          ...item("a1b2c3d4-0000-4000-8000-00000000000e", "Rotate the beta key?", 1_100),
          agentId: LUKE_AGENT,
          channelId: GENERAL.id,
        }),
        workspaceId: "workspace-beta",
      },
    ],
    { withSidebar: true, waiting },
  );
  await settle();
  assert.equal(sidebarRowCount(page, "Inbox"), 4, "both tasks' questions and Luke's two");
  assert.deepEqual(
    [sidebarRowCount(page, "general"), sidebarRowCount(page, "app")],
    [1, 2],
    "the channels count three of them, Luke's in #app among them, the archived channel's on no row",
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
  ].find((each) => each.querySelector(".luke-inline-ref-label")?.textContent === "flaky.test.ts");
  assert.ok(chip, "the file is its chip");
  act(() => chip.click());
  assert.deepEqual(previewed, [`${JSON.stringify({ path: "src/flaky.test.ts" })} undefined`]);
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
});
