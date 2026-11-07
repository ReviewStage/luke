import assert from "node:assert/strict";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  agentTab,
  changesTab,
  cloudBrowserTab,
  draftTab,
  fileTab,
  localTab,
  pageTab,
  subagentTab,
  terminalTab,
  transcriptTab,
} from "@repo/ui/tab-strip-model";
import { describe, it } from "vitest";
import {
  stripTabClosesIdle,
  stripTabDrawsAgain,
  stripTabEndsSession,
  stripTabKept,
  stripTabLink,
  stripTabLook,
  stripTabPin,
  stripTabReopens,
  stripTabStays,
  stripTabSurface,
  stripTabTakesFind,
  stripTabTitle,
  TAB_PIN,
  type TabKnown,
  type TabNames,
  type TaskDraws,
  untitledStripTab,
} from "./strip-tab-kinds.js";
import { MAIN_TAB } from "./use-main-tabs.js";
import { SIDE_PANEL_TAB } from "./use-side-panel.js";

/**
 * What each kind of strip tab is called, wears, shows, and links to, and how
 * it lives, as the panel answered it before the answers were declared per
 * kind. Synthetic ids.
 */

const TASK = "2c4e1f9a-0b7d-4e3a-8c51-6d2f9e0a7b13";
const AGENT = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const CALL = "call_0f3a";
const PAGE = "9e1d2c3b-4a5f-4e6d-8c7b-1a2b3c4d5e6f";

/** A place that names everything a tab shows. */
const NAMES: TabNames = {
  agent: () => "Ada",
  subagent: () => "Reader",
  file: (path) => path,
  pullRequest: () => "#7 Fix refresh",
  page: () => "Roadmap",
  browser: () => "Docs",
};

/** A place that knows the task, the agent, and nothing of a pull request. */
const KNOWN: TabKnown = {
  plan: { name: "Ship it", status: undefined },
  agent: { name: "Ada", agent: { model: "claude-opus-5-5" } },
};

const HOLDER = { taskId: TASK };

/**
 * A task whose agents, open agent tabs, and pages are read and name none of
 * the tabs below, so a kind that checks what the task draws answers no, and
 * one that draws again whatever the task draws answers yes.
 */
const DRAWS_NOTHING: TaskDraws = { openAgents: [], taskAgents: [], pages: [] };

/** A task none of whose agents, open agent tabs, or pages are read yet. */
const DRAWS_UNREAD: TaskDraws = {
  openAgents: undefined,
  taskAgents: undefined,
  pages: undefined,
};

/** Kept across a launch in neither strip. */
const NOWHERE = { column: false, sidePanel: false };

describe("a strip tab's kind answers", () => {
  it.each([
    {
      kind: "a word: the column's Overview",
      tab: MAIN_TAB.OVERVIEW,
      title: "Overview",
      untitled: "Overview",
      look: { kind: "overview" },
      surface: PRODUCT_SURFACE.TASK,
      of: TASK,
      link: undefined,
      drawsAgain: true,
      reopens: true,
      endsSession: false,
      closesIdle: false,
      pin: TAB_PIN.NONE,
      kept: { column: true, sidePanel: true },
      takesFind: true,
      stays: true,
    },
    {
      kind: "a word: the side panel's Inbox",
      tab: SIDE_PANEL_TAB.INBOX,
      title: "Inbox",
      untitled: "Inbox",
      look: { kind: "panel", tab: SIDE_PANEL_TAB.INBOX, plan: KNOWN.plan },
      surface: PRODUCT_SURFACE.INBOX,
      of: TASK,
      link: undefined,
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: false,
      pin: TAB_PIN.SIDEBAR,
      kept: { column: true, sidePanel: true },
      takesFind: true,
      stays: false,
    },
    {
      kind: "agent",
      tab: agentTab(AGENT),
      title: "Ada",
      untitled: "Agent",
      look: { kind: "agent", name: "Ada", agent: { model: "claude-opus-5-5" } },
      surface: PRODUCT_SURFACE.AGENT,
      of: AGENT,
      link: undefined,
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.ACCOUNT,
      kept: { column: true, sidePanel: false },
      takesFind: true,
      stays: false,
    },
    {
      kind: "transcript",
      tab: transcriptTab(AGENT),
      title: "Ada",
      untitled: "Agent",
      look: { kind: "draft" },
      surface: PRODUCT_SURFACE.AGENT,
      of: undefined,
      link: undefined,
      drawsAgain: true,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "draft",
      tab: draftTab("draft-1"),
      title: "New agent",
      untitled: "New agent",
      look: { kind: "draft" },
      surface: PRODUCT_SURFACE.AGENT,
      of: "draft-1",
      link: undefined,
      drawsAgain: true,
      reopens: false,
      endsSession: false,
      closesIdle: false,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "subagent",
      tab: subagentTab(CALL, { agent: AGENT, task: "Read the logs" }),
      title: "Reader",
      untitled: "Worker",
      look: { kind: "subagent", name: "Subagent", model: undefined, state: "rest" },
      surface: PRODUCT_SURFACE.SUBAGENT,
      of: CALL,
      link: { kind: LINK_PLACE.WORKER, agentId: AGENT, callId: CALL },
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "file",
      tab: fileTab("src/app/main.ts"),
      title: "src/app/main.ts",
      untitled: "main.ts",
      look: { kind: "file", path: "src/app/main.ts" },
      surface: PRODUCT_SURFACE.FILES,
      of: "src/app/main.ts",
      link: undefined,
      drawsAgain: true,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.SIDEBAR,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "changes",
      tab: changesTab(AGENT),
      title: "#7 Fix refresh",
      untitled: "Pull request",
      look: { kind: "changes", pullRequest: undefined },
      surface: PRODUCT_SURFACE.PULL_REQUEST,
      of: AGENT,
      link: { kind: LINK_PLACE.CHANGES, agentId: AGENT },
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.SIDEBAR,
      kept: { column: false, sidePanel: true },
      takesFind: true,
      stays: false,
    },
    {
      kind: "changes on another pull request, by its number",
      tab: changesTab(AGENT, 34),
      title: "#7 Fix refresh",
      untitled: "Pull request",
      look: { kind: "changes", pullRequest: undefined },
      surface: PRODUCT_SURFACE.PULL_REQUEST,
      of: undefined,
      link: undefined,
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.SIDEBAR,
      kept: { column: false, sidePanel: true },
      takesFind: true,
      stays: false,
    },
    {
      kind: "terminal",
      tab: terminalTab(AGENT, "shell-1", "Cloud 1"),
      title: "Cloud 1",
      untitled: "Cloud 1",
      look: { kind: "terminal", title: "Cloud 1" },
      surface: PRODUCT_SURFACE.TERMINAL,
      of: "shell-1",
      link: undefined,
      drawsAgain: true,
      reopens: false,
      endsSession: true,
      closesIdle: false,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "local",
      tab: localTab(AGENT, "shell-2", "Local 1"),
      title: "Local 1",
      untitled: "Local 1",
      look: { kind: "local", title: "Local 1" },
      surface: PRODUCT_SURFACE.TERMINAL,
      of: "shell-2",
      link: undefined,
      drawsAgain: true,
      reopens: false,
      endsSession: true,
      closesIdle: false,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: true,
      stays: false,
    },
    {
      kind: "page",
      tab: pageTab(PAGE),
      title: "Roadmap",
      untitled: "Page",
      look: { kind: "page", title: "Page" },
      surface: PRODUCT_SURFACE.PAGE,
      of: PAGE,
      link: { kind: LINK_PLACE.PAGE, planId: TASK, pageId: PAGE },
      drawsAgain: false,
      reopens: true,
      endsSession: false,
      closesIdle: true,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: false,
      stays: false,
    },
    {
      kind: "cloud browser",
      tab: cloudBrowserTab("browser-1"),
      title: "Docs",
      untitled: "Browser",
      look: { kind: "browser", title: undefined },
      surface: PRODUCT_SURFACE.BROWSER,
      of: "browser-1",
      link: undefined,
      drawsAgain: true,
      reopens: true,
      endsSession: false,
      closesIdle: false,
      pin: TAB_PIN.NONE,
      kept: NOWHERE,
      takesFind: false,
      stays: false,
    },
  ])(
    "$kind: its title, look, surface, link, and how it lives",
    ({ kind: _kind, tab, title, untitled, look, surface, of, link, ...lives }) => {
      assert.equal(stripTabTitle(tab, NAMES), title);
      assert.equal(untitledStripTab(tab), untitled);
      assert.deepEqual(stripTabLook(tab, KNOWN), look);
      const shown = stripTabSurface(tab, TASK);
      assert.equal(shown.surface, surface);
      // Note that a transcript's and a numbered Changes tab's key is minted on first ask, so no row can name it.
      if (of !== undefined) assert.equal(shown.of, of);
      assert.deepEqual(stripTabLink(tab, HOLDER), link);
      assert.deepEqual(
        {
          drawsAgain: stripTabDrawsAgain(tab, DRAWS_NOTHING),
          reopens: stripTabReopens(tab),
          endsSession: stripTabEndsSession(tab),
          closesIdle: stripTabClosesIdle(tab),
          pin: stripTabPin(tab),
          kept: stripTabKept(tab),
          takesFind: stripTabTakesFind(tab),
          stays: stripTabStays(tab),
        },
        lives,
      );
    },
  );

  // Note that each row names its tab in its own list alone, so a kind that reads another list draws nothing.
  it.each([
    { kind: "agent", tab: agentTab(AGENT), draws: { ...DRAWS_NOTHING, taskAgents: [AGENT] } },
    {
      kind: "subagent",
      tab: subagentTab(CALL, { agent: AGENT, task: "Read the logs" }),
      draws: { ...DRAWS_NOTHING, openAgents: [AGENT] },
    },
    { kind: "changes", tab: changesTab(AGENT), draws: { ...DRAWS_NOTHING, taskAgents: [AGENT] } },
    { kind: "page", tab: pageTab(PAGE), draws: { ...DRAWS_NOTHING, pages: [PAGE] } },
  ])(
    "$kind: drawn again where the task names it, and before the task is read",
    ({ tab, draws }) => {
      assert.equal(stripTabDrawsAgain(tab, draws), true);
      assert.equal(stripTabDrawsAgain(tab, DRAWS_UNREAD), true);
    },
  );
});
