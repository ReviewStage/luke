// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentPageAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BRIEF,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentPage,
  type CodingAgentPullRequestAnswer,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import type { Task } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge, fakeAppBridgeCalls } from "#testing/app-bridge";
import { copyingInto, DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { DESKTOP_CAPABILITIES, handCapabilities, handState, stateWith } from "#testing/app-state";
import { editorBundleLanded, installEditorLayout, typeInComposer } from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { codingAgentsControl, tasksControl } from "#testing/tasks-control";
import { newestToastSays } from "#testing/toast";
import { runAppCommand } from "../app-commands";
import { archiveWords } from "../tasks/coding-agent-model";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { ToastHost } from "../toast";
import { DesktopAgentPage } from "./desktop-agent-page";

/**
 * desktop-agent-page.test.ts -- one agent's page as the window draws it: the agent read by its id, titled as its tab would be, and a read that did not land said with a retry; an automation's agent opens on the automation's prompt alone, as a message the automation sent, which opens the automation's page where the window can, and names it plainly where it cannot, deleted or the experiment off, with the pull request its event named and who ran it now; a webhook's body stands inside the card alone.
 *
 * The service is a script at the act boundary; synthetic agents and words throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PAGE: CodingAgentPage = {
  id: AGENT_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sweep the flaky tests",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
  workspaceId: "workspace-1",
  repository: "acme/relay",
};

/** The automation whose run started the agent, as the workspace's automations list it. */
const SWEEP: AutomationSummary = {
  id: PAGE.automationId ?? "",
  planId: null,
  planName: null,
  workspaceId: PAGE.workspaceId,
  name: "Flaky-test sweep",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Sweep the flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

/** The prompt an automation's run handed its agent: the automation's own, then what Luke adds of the firing. */
const HANDED = `Sweep the flaky tests.

---

Luke started this run for the automation "Flaky-test sweep" because its schedule was due.`;

/** The agent an automation's run started, read as its page with the run. */
const RUN_PAGE: CodingAgentPage = {
  ...PAGE,
  title: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
  automationName: "Flaky-test sweep",
  origin: { prompt: "Sweep the flaky tests." },
};

/** The agent's workspace, as the account lists it. */
const ACME = {
  id: PAGE.workspaceId,
  name: "Acme",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  memberCount: 2,
};

let root: Root | undefined;

// A message is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));
/** Every address handed to GitHub, in order. */
let openedOnGitHub: string[] = [];
/** How the next reads of the agent's page answer, in order; the last stands for every read after it. */
let pages: CodingAgentPageAnswerView[] = [];
/** Every agent whose page was read, in order. */
let read: string[] = [];
/** Every archive or Unarchive asked, as the act carried it. */
let archives: { agentId: string; archived: boolean }[] = [];
/** Whether an archive or Unarchive is refused, as an unanswered service refuses it. */
let archiveRefused = false;
/** What the agent's workspace's members read answers; none refuses it. */
let members: readonly WorkspaceMember[] | undefined;
/** What the next read of the agent's transcript answers; none refuses it. */
let transcript: CodingAgentMessagesAnswerView | undefined;
/** Every act the page told or asked, in order. */
let told: Act[] = [];
/** What a read of what the agent published answers; none refuses it. */
let published: CodingAgentPullRequestAnswer | undefined;
/** How many of the pull request's conversation entries its read left on GitHub; none answers no read. */
let earlier = 0;
/** What the window copied, in order. */
let copied: string[] = [];
/** What the workspace's list of agents answers, whatever it was asked. */
let workspace: readonly CodingAgentSummary[] = [];
/** The pull requests the workspace's GitHub App answers, by number; one it holds none for reads as none. */
let gitHub: ReadonlyMap<number, { title: string; url: string; state: PullRequestState }> =
  new Map();

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  pages = [{ agent: PAGE }];
  read = [];
  archives = [];
  archiveRefused = false;
  members = undefined;
  transcript = undefined;
  told = [];
  published = undefined;
  earlier = 0;
  openedOnGitHub = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), ...DESKTOP_LINKS });
  workspace = [];
  gitHub = new Map();
  fakeAppBridge({
    act: (request: Act) => {
      told.push(request);
      if (request.kind === ACT_KIND.TASKS_SKILLS) {
        const value = {
          skills: {
            repository: "acme/relay",
            branch: "main",
            skills: [
              {
                name: "release",
                description: "Cut a release.",
                path: ".agents/skills/release/SKILL.md",
              },
            ],
          },
        };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_ARCHIVE) {
        archives.push(request.payload);
        // The agent answered is the one the page read, brought back, which names no archive.
        const shown = pages[0] !== undefined && "agent" in pages[0] ? pages[0].agent : PAGE;
        const { archivedAt: _archived, ...back } = shown;
        // Brought back, the agent is read so from then on.
        if (!archiveRefused) pages = [{ agent: back }];
        const value = archiveRefused
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : { agent: back };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ && members !== undefined) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: members });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_MESSAGES && transcript !== undefined) {
        // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
        const value = transcript;
        transcript = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION && earlier > 0) {
        const value = { pullRequest: { reviewers: [], conversation: [], earlier } };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST && published !== undefined) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: published });
      }
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: { automations: [SWEEP] },
        });
      }
      if (request.kind === ACT_KIND.GITHUB_OPEN) {
        openedOnGitHub.push(request.payload.url);
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.TASKS_PULL_REQUEST) {
        const { number } = request.payload;
        const held = gitHub.get(number);
        const value = held === undefined ? null : { number, author: "octo-dev", ...held };
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { agents: workspace } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        read.push(request.payload.agentId);
        const value = pages.length > 1 ? pages.shift() : pages[0];
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
      }
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." });
    },
  });
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The page of the agent, standing in the task's place, as the window's tasks control holds it. */
function mount(tasks: TasksControl = tasksControl({})): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(DesktopAgentPage, { tasks, agentId: AGENT_ID }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("the page reads the agent by its id and titles it as its tab would", async () => {
  const page = mount();
  await settle();

  assert.deepEqual(read, [AGENT_ID]);
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("the page draws the task column's agent pane, at its reading width, and ⌘F finds in the agent's transcript", async () => {
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: "The flaky retry is gone." }],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount();
  await settle();

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });

  assert.ok(page.querySelector(".desktop-agent [role='log']"), "the transcript is the pane's");
  assert.equal(offered, true);
  assert.ok(page.querySelector(".desktop-agent")?.closest(".find-scope"), "the pane finds");
  assert.ok(page.querySelector("search[aria-label='Find']"), "⌘F opens the find bar");
});

/** The page over the window's own side panel, held by the agent as the window holds it while the page stands. */
/** The side panel the page last drew, whose toggle the shell's button presses. */
let drawnPanel: SidePanelControl | undefined;

function PanelPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(
    undefined,
    { id: AGENT_ID, holds: {} },
    agents,
    [],
    [],
    [],
    agents,
  );
  drawnPanel = sidePanel;
  return createElement(DesktopAgentPage, {
    tasks: { ...tasksControl({}), sidePanel },
    agentId: AGENT_ID,
  });
}

test("a delegation's row opens its worker in the side panel beside the agent's page, whose + offers none of a task's Board, Code, or Call", async () => {
  localStorage.clear();
  installScrollIntoView();
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "tool-delegate",
            toolCallId: "call-1",
            state: "output-available",
            input: { task: "Find the flakiest test." },
            output: "Started task delegate-7k2m9q.",
          },
        ],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PanelPage))));
  await settle();

  const row = container.querySelector<HTMLButtonElement>("button[data-subagent-row]");
  assert.ok(row, "the delegation's row opens its worker");
  act(() => row.click());
  await settle();
  const panel = container.querySelector("aside.side-panel");
  const opened = [...(panel?.querySelectorAll("[role='tab']") ?? [])].map((tab) => tab.textContent);
  const add = panel?.querySelector<HTMLButtonElement>("button[aria-label='Open a tab']");
  assert.ok(add, "the panel offers its +");
  act(() => add.click());
  await settle();
  const offered = [...document.querySelectorAll("[role='option']")].map((each) => each.textContent);

  assert.ok(
    opened.some((label) => label?.includes("Find the flakiest test.")),
    `the worker's tab stands in the panel: ${opened.join(", ")}`,
  );
  assert.deepEqual(
    offered.filter((label) => /^(Board|Code|Call)$/u.test(label ?? "")),
    [],
    "no task's kind is offered",
  );
});

/** The page drawn over the window's own side panel, held by the agent. */
async function mountPanelPage(): Promise<HTMLElement> {
  localStorage.clear();
  installScrollIntoView();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PanelPage))));
  await settle();
  return container;
}

test("its last tab closed shuts the panel, and shown again it offers in place every row its + offers, under the + menu's headings, each opening what it names", async () => {
  published = {
    repository: "acme/relay",
    branch: "luke/flaky-sweep",
    pullRequest: {
      number: 2911,
      title: "Await the payment mock",
      url: "https://github.com/acme/relay/pull/2911",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 3,
      deletions: 1,
      changedFiles: 1,
    },
  };
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "tool-delegate",
            toolCallId: "call-1",
            state: "output-available",
            input: { task: "Find the flakiest test." },
            output: "Started task delegate-7k2m9q.",
          },
        ],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = await mountPanelPage();
  const row = container.querySelector<HTMLButtonElement>("button[data-subagent-row]");
  assert.ok(row, "the delegation's row opens its worker");
  act(() => row.click());
  await settle();
  const panel = container.querySelector("aside.side-panel") ?? assert.fail("the panel opens");
  const add = panel.querySelector<HTMLButtonElement>("button[aria-label='Open a tab']");
  assert.ok(add, "the panel offers its +");
  act(() => add.click());
  await settle();
  const offered = [...document.querySelectorAll(".tab-add-menu [role='option']")].map(
    (each) => each.textContent,
  );
  const headings = [...document.querySelectorAll(".tab-add-menu [role='group']")].map((each) =>
    each.getAttribute("aria-label"),
  );
  act(() => add.click());
  await settle();
  const close = panel.querySelector<HTMLButtonElement>(".tab-close");
  assert.ok(close, "the worker's tab closes");
  act(() => close.click());
  await settle();
  assert.equal(container.querySelector("aside.side-panel"), null, "the panel shuts");

  act(() => drawnPanel?.onToggle());
  await settle();
  const shown = container.querySelector("aside.side-panel") ?? assert.fail("the toggle shows it");
  const well = shown.querySelector(".side-panel-no-tabs") ?? assert.fail("the empty panel offers");
  const rows = [...well.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(
    rows.map((each) => each.textContent),
    offered,
  );
  assert.deepEqual(
    [...well.querySelectorAll("section")].map((each) => each.getAttribute("aria-label")),
    headings,
  );
  assert.deepEqual(headings, ["Pull requests", "Terminal"]);
  const changes = rows.find((each) => (each.textContent ?? "").includes("#2911"));
  assert.ok(changes, "the empty panel offers the agent's pull request");
  act(() => changes.click());
  await settle();
  assert.ok(
    [...shown.querySelectorAll("[role='tab']")].some((tab) =>
      (tab.textContent ?? "").includes("#2911 Await the payment mock"),
    ),
    "the Pull request tab stands in the panel, named by its number and title",
  );
});

test("an archived agent's pull request, picked from the panel's +, opens in a Pull request tab standing beside its page", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  published = {
    repository: "acme/relay",
    branch: "luke/flaky-sweep",
    pullRequest: {
      number: 2911,
      title: "Await the payment mock",
      url: "https://github.com/acme/relay/pull/2911",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 3,
      deletions: 1,
      changedFiles: 1,
    },
  };
  const container = await mountPanelPage();

  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  await settle();
  const offer = [...document.querySelectorAll<HTMLElement>("[role='option']")].find((each) =>
    (each.textContent ?? "").includes("#2911"),
  );
  assert.ok(offer, "the + offers the agent's pull request");
  act(() => offer.click());
  await settle();
  const tabs = [...container.querySelectorAll("aside.side-panel [role='tab']")].map(
    (tab) => tab.textContent ?? "",
  );

  assert.ok(
    tabs.some((label) => label.includes("#2911 Await the payment mock")),
    `the Pull request tab stands in the panel: ${tabs.join(", ")}`,
  );
});

test("⌘T on an agent's page opens the panel beside it on its +, the page's one", async () => {
  const container = await mountPanelPage();

  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  await settle();

  assert.ok(container.querySelector("aside.side-panel"), "the panel opens");
  assert.ok(
    document.querySelector("input[placeholder='Search tabs']"),
    "its + opens on the tabs it offers",
  );
});

test("a chip in the agent's words naming the pull request it opened opens its Pull request tab beside its page, and another pull request's opens on GitHub, as does the tab's own way to its earlier comments", async () => {
  const url = "https://github.com/acme/relay/pull/2911";
  earlier = 3;
  published = {
    repository: "acme/relay",
    branch: "luke/flaky-sweep",
    pullRequest: {
      number: 2911,
      title: "Await the payment mock",
      url,
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 3,
      deletions: 1,
      changedFiles: 1,
    },
  };
  const other = "https://github.com/acme/relay/pull/7";
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "text",
            text: `Opened [@relay#2911](${url}#issuecomment-1), beside [@relay#7](${other}).`,
          },
        ],
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = await mountPanelPage();
  await settle();
  const chip = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".agent-page .mention-chip")].find((each) =>
      each.querySelector(".mention-chip-label")?.textContent?.includes(name),
    );

  const own = chip("relay#2911");
  assert.ok(own, "the agent's pull request is its chip");
  act(() => own.click());
  await settle();
  // Note that the tab is known by its conversation rather than its name, which is its agent's until the pull request's read lands and the pull request's after.
  assert.ok(
    container.querySelector('aside.side-panel [aria-label="Conversation"]'),
    "the Pull request tab stands in the panel, on its conversation",
  );
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");

  act(() => chip("relay#7")?.click());
  assert.deepEqual(openedOnGitHub, [other]);

  // A link in the pull request's own tab, to what its read left on GitHub, still leaves for GitHub.
  const more = container.querySelector<HTMLButtonElement>("aside.side-panel .pull-request-earlier");
  assert.ok(more, "the tab counts the earlier comments");
  act(() => more.click());
  assert.deepEqual(openedOnGitHub, [other, url]);
});

test("a skill a message names is its chip, which opens the skill's SKILL.md on GitHub, there being no File tab for a repository no plan names", async () => {
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "line",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Then run /release now." }],
        sentBy: { userId: "user-dean", name: "Dean Stratakos", kind: CODING_AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount();
  await settle();

  // The skills are read once a sent message first asks for them, a settle after the transcript lands.
  await settle();
  const chip = page.querySelector<HTMLButtonElement>("button.skill-chip");
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());

  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.GITHUB_OPEN).map((each) => each.payload),
    [{ url: "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md" }],
  );
});

test("a read that did not land says so, and Retry reads the agent again and draws it", async () => {
  pages = [{ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }, { agent: PAGE }];
  const page = mount();
  await settle();

  assert.match(page.textContent ?? "", /This agent could not be read\./u);
  const retry = [...page.querySelectorAll("button")].find((each) =>
    /Retry/u.test(each.textContent ?? ""),
  );
  assert.ok(retry, "the failure offers Retry");
  act(() => retry.click());
  await settle();

  assert.deepEqual(read, [AGENT_ID, AGENT_ID]);
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("an agent the service will not hand the reader, as a link to another workspace's may name, is not found, and nothing of it is drawn", async () => {
  pages = [{ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }];
  const page = mount();
  await settle();

  assert.match(
    page.textContent ?? "",
    /Not foundThis agent doesn't exist, or you don't have access to it\./u,
  );
  assert.equal(page.querySelector("h1"), null);
  assert.equal(
    [...page.querySelectorAll("button")].some((each) => /Retry/u.test(each.textContent ?? "")),
    false,
  );
});

test("an archived agent's page offers Unarchive in its composer's place, which brings the agent back", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  const page = mount();
  await settle();

  const unarchive = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Unarchive",
  );
  assert.ok(unarchive, "the archived agent offers Unarchive");
  act(() => unarchive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: false }]);
});

/** The task open beneath the page. */
const OPEN_TASK = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";

test("an agent of the open task brought back on its page has the task's agents read again, so its tab and ⌘K stand where it does, and one of another task's has none", async () => {
  /** How many times the open task's agents are read again around an Unarchive on the page of an agent of `planId`. */
  const readsAround = async (planId: string): Promise<number> => {
    let reads = 0;
    pages = [{ agent: { ...PAGE, planId, archivedAt: 2 } }];
    const page = mount(
      tasksControl({
        activeTaskId: OPEN_TASK,
        agents: codingAgentsControl({ onRetryList: () => (reads += 1) }),
      }),
    );
    await settle();
    const drawn = reads;
    const unarchive = [...page.querySelectorAll("button")].find(
      (each) => each.textContent === "Unarchive",
    );
    assert.ok(unarchive, "the archived agent offers Unarchive");
    act(() => unarchive.click());
    await settle();
    act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    assert.equal(drawn, 0, "drawing the page reads nothing of the task");
    return reads;
  };

  assert.equal(await readsAround(OPEN_TASK), 1);
  assert.equal(await readsAround("6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e"), 0);
});

test("an agent another agent archived says on its page who archived it, for which member, and why, over its Unarchive", async () => {
  pages = [
    {
      agent: {
        ...PAGE,
        archivedAt: 2,
        archivedBy: {
          by: CODING_AGENT_ARCHIVER.AGENT,
          member: { userId: "user-dean", name: "Dean Stratakos" },
          agent: { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "Bill by seat" },
          reason: "Its pull request merged.",
        },
      },
    },
  ];
  const page = mount();
  await settle();

  assert.ok(
    [...page.querySelectorAll("p")].some(
      (each) =>
        each.textContent ===
        "Archived by Bill by seat for Dean Stratakos: Its pull request merged.",
    ),
  );
  assert.ok([...page.querySelectorAll("button")].some((each) => each.textContent === "Unarchive"));
});

test("an Unarchive the service refuses says why, and the agent stays archived", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  archiveRefused = true;
  const page = mount();
  await settle();

  const unarchive = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Unarchive",
  );
  assert.ok(unarchive);
  act(() => unarchive.click());
  await settle();

  assert.match(document.body.textContent ?? "", new RegExp(archiveWords(false).refused, "u"));
  assert.ok(
    [...page.querySelectorAll("button")].some((each) => each.textContent === "Unarchive"),
    "the agent stays archived, Unarchive still offered",
  );
});

test("a teammate's message to an agent on its own page carries their sign-in picture, read from the agent's workspace's members", async () => {
  const picture = "https://lh3.googleusercontent.com/a/charles=s96-c";
  const charles = { userId: "user-charles", name: "Charles Pan" };
  members = [
    {
      userId: "user-dean",
      name: "Dean Stratakos",
      email: "dean@example.com",
      role: WORKSPACE_ROLE.OWNER,
    },
    { ...charles, email: "charles@example.com", role: WORKSPACE_ROLE.MEMBER, pictureUrl: picture },
  ];
  transcript = {
    messages: [
      // The first of the developer's messages is what the agent was handed, drawn as its card.
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "line",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Skip the flaky retry." }],
        sentBy: { ...charles, kind: CODING_AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(
    tasksControl({
      me: "user-dean",
      workspaces: [
        {
          id: PAGE.workspaceId,
          name: "Acme",
          role: WORKSPACE_ROLE.OWNER,
          github: null,
          memberCount: 2,
        },
      ],
    }),
  );
  await settle();

  const sender = page.querySelector(".is-user:not(.agent-origin) .message-sender .actor-ref");
  assert.equal(sender?.querySelector(".actor-ref-name")?.textContent, "Charles Pan");
  assert.equal(sender?.querySelector("img")?.getAttribute("src"), picture);
});

/** The transcript of an automation's agent: the prompt its run handed it, and its answer. */
function handedTranscript(): CodingAgentMessagesAnswerView {
  return {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: HANDED }] },
      { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "Done." }] },
    ],
    cursor: "1:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
}

/** What a line says, its actors' faces left out, as a reader reads it. */
function words(line: Element | null | undefined): string {
  if (line == null) return "";
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let said = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest(".actor-mark") == null) said += node.textContent ?? "";
  }
  return said;
}

/** The card a page opens on, and the line naming who sent it. */
interface OpenedOrigin {
  readonly card: HTMLElement;
  readonly sender: HTMLElement | null;
}

/** The card the page opens on, opened, and the line naming who sent it. */
function origin(page: HTMLElement): OpenedOrigin {
  const card =
    page.querySelector<HTMLElement>(".agent-origin") ?? assert.fail("the page opens on its card");
  const head = card.querySelector<HTMLElement>("[data-task-card] > summary");
  act(() => head?.click());
  return { card, sender: card.querySelector<HTMLElement>(".message-sender") };
}

test("an automation's agent opens on the automation's prompt alone, sent by the automation, whose name opens its page", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  pages = [{ agent: RUN_PAGE }];
  transcript = handedTranscript();
  const opened: unknown[] = [];
  const plans = tasksControl({ workspaces: [ACME] });
  const page = mount({
    ...plans,
    automationsView: { ...plans.automationsView, onOpen: (place) => opened.push(place) },
  });
  await settle();

  const { card, sender } = origin(page);
  const automation = sender?.querySelector<HTMLButtonElement>("button.actor-ref");
  assert.equal(words(automation), "Flaky-test sweep");
  assert.match(card.textContent ?? "", /Sweep the flaky tests\./u);
  assert.doesNotMatch(card.textContent ?? "", /Luke started this run/u);
  act(() => automation?.click());

  assert.deepEqual(opened, [{ kind: "edit", automationId: SWEEP.id }]);
});

test("a deleted automation's agent still names it, plainly, with nothing to open", async () => {
  handState(experimentsOn(EXPERIMENT.AUTOMATIONS));
  pages = [{ agent: { ...RUN_PAGE, automationId: null } }];
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [ACME] }));
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep (deleted)");
  assert.equal(sender?.querySelector("button"), null, "nothing opens it");
});

test("with the Automations experiment off, an automation's agent names it plainly, with nothing to open", async () => {
  pages = [{ agent: RUN_PAGE }];
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [ACME] }));
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep");
  assert.equal(sender?.querySelector("button"), null, "nothing opens it");
});

test("a GitHub event's run names its pull request beside the automation, which opens on GitHub, and a run now names who ran it", async () => {
  const url = "https://github.com/acme/relay/pull/2905";
  pages = [
    {
      agent: {
        ...RUN_PAGE,
        origin: {
          prompt: "Review it.",
          subject: { number: 2905, title: "View commands", url },
          runBy: { userId: "user-dean", name: "Dean Stratakos" },
        },
      },
    },
  ];
  transcript = handedTranscript();
  const page = mount(tasksControl({ me: "user-dean" }));
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep · #2905 View commands · Run by you");
  act(() => sender?.querySelector<HTMLElement>(".mention-chip")?.click());
  assert.deepEqual(openedOnGitHub, [url]);
});

test("a GitHub event's pull request is its chip, saying where it stands and wearing GitHub's mark for it, where the workspace's GitHub App reads it, a workspace with no slug among them", async () => {
  const url = "https://github.com/acme/relay/pull/2905";
  const acme = { ...ACME, github: { login: "acme", active: true } };
  gitHub = new Map([[2905, { title: "View commands", url, state: PULL_REQUEST_STATE.OPEN }]]);
  const state = stateWith({}, { tasks: { ...IDLE_TASKS_VIEW, workspaces: [acme] } });
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  pages = [
    {
      agent: {
        ...RUN_PAGE,
        origin: { prompt: "Review it.", subject: { number: 2905, title: "View commands", url } },
      },
    },
  ];
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [acme] }));
  await settle();

  const chip = origin(page).sender?.querySelector<HTMLElement>(".mention-chip");
  assert.deepEqual(
    [
      chip?.querySelector(".mention-chip-label")?.textContent,
      chip?.querySelector(".mention-chip-state")?.textContent,
      chip?.querySelector<SVGElement>("[data-pull-request-mark]")?.dataset.pullRequestState,
    ],
    ["#2905 View commands", "Open", PULL_REQUEST_STATE.OPEN],
  );
});

test("the line naming who sent it names the automation, the pull request, and who ran it, each its own part", async () => {
  pages = [
    {
      agent: {
        ...RUN_PAGE,
        origin: {
          prompt: "Review it.",
          subject: { number: 2905, title: "View commands" },
          runBy: { userId: "user-dean", name: "Dean Stratakos" },
        },
      },
    },
  ];
  transcript = handedTranscript();
  const page = mount(tasksControl({ me: "user-dean" }));
  await settle();

  const line = origin(page).sender?.firstElementChild ?? assert.fail("the line stands");
  assert.deepEqual(
    [...line.children].map((part) => words(part)),
    ["Flaky-test sweep", " · #2905 View commands", " · Run by you"],
  );
});

test("a webhook's body stands folded inside the card under the prompt, and nowhere in the line naming who sent it", async () => {
  const body = '{"release":"v2.4.0"}';
  pages = [{ agent: { ...RUN_PAGE, origin: { prompt: "Write the notes.", body } } }];
  transcript = handedTranscript();
  const page = mount();
  await settle();

  const { card, sender } = origin(page);
  assert.doesNotMatch(sender?.textContent ?? "", /release/u);
  const fold = [...card.querySelectorAll<HTMLElement>("summary")].find(
    (each) => each.textContent === "Webhook body",
  );
  assert.ok(fold, "the body folds under its own line");
  act(() => fold.click());
  assert.equal(card.querySelector("pre")?.textContent, body);
});

test("an automation's agent the model has not named yet is titled by its automation, not its model", async () => {
  pages = [{ agent: RUN_PAGE }];
  const page = mount();
  await settle();

  assert.equal(page.querySelector("h1")?.textContent, "Flaky-test sweep");
});

test("the page's ⋯ copies the agent's link, under its workspace, and says Link copied", async () => {
  const page = mount(
    tasksControl({
      workspaces: [
        {
          id: "workspace-1",
          name: "Acme",
          slug: "acme",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
        },
      ],
    }),
  );
  await settle();
  const more = page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]');
  assert.ok(more, "the page's toolbar has a ⋯");
  act(() => more.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the ⋯ offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`https://tryluke.dev/acme/agent/${AGENT_ID}`]);
  assert.equal(newestToastSays(), "Link copied");
});

test("an @ in the agent's box names an archived agent of an archived task by that task's name, read from the window's archived tasks", async () => {
  installEditorLayout();
  installScrollIntoView();
  const billing: Task = {
    id: "2b2b2b2b-0000-4000-8000-000000000000",
    workspaceId: PAGE.workspaceId,
    name: "Billing",
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
    document: { body: "", assumptions: [] },
  };
  workspace = [
    {
      id: "3c3c3c3c-0000-4000-8000-000000000000",
      planId: billing.id,
      model: PAGE.model,
      effort: PAGE.effort,
      title: "Bill by seat",
      createdAt: 1,
      status: CODING_AGENT_STATUS.COMPLETED,
      turnId: null,
      archivedAt: 3,
    },
  ];
  const page = mount(tasksControl({ archived: [billing] }));
  await settle();

  typeInComposer(page, "Ask @billing");
  await settle();

  const rows = [...page.querySelectorAll('.mention-menu [aria-label="Agents"] [role="option"]')];
  assert.deepEqual(
    rows.map((row) => [
      row.querySelector(".luke-combobox-option-label")?.textContent,
      row.querySelector(".luke-combobox-option-detail")?.textContent,
    ]),
    [["Bill by seat", "Billing · Archived"]],
  );
});
