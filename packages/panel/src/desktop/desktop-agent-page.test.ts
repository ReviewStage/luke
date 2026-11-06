// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentMessagesAnswerView,
  type AgentPageAnswerView,
  PULL_REQUEST_PART,
} from "@repo/features/agent-view";
import {
  AGENT_ARCHIVER,
  AGENT_BRIEF,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentPage,
  type AgentPullRequestAnswer,
  type AgentSummary,
  CHECK_SUMMARY,
  type ListedAgent,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { AUTOMATION_FOLLOW } from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { LINK_PLACE, type ReadLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@repo/features/page-wire";
import { READ_MARK } from "@repo/features/read-mark";
import type { Task } from "@repo/features/task-wire";
import { TASK_SKILL_SOURCE } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeAppBridge,
  fakeAppBridgeCalls,
  quietHold,
} from "../testing/app-bridge.js";
import {
  copyingInto,
  DESKTOP_LINKS,
  fakeAppPlatform,
  QUIET_PANEL,
} from "../testing/app-platform.js";
import {
  DESKTOP_CAPABILITIES,
  handCapabilities,
  handHostReads,
  handMembers,
  handState,
  holdAutomations,
  holdPages,
  holdPullRequestParts,
  stateWith,
} from "../testing/app-state.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { holdFrames, settleFrames } from "../testing/frames.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { pushedTranscripts, tasksControl } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
// Note that a Pull request tab is loaded as the side panel loads it, on first use
// (`pages-on-demand.ts`), so the module is read here first and its load settles
// within the test's own ticks.
import "../tasks/agent-pull-request-tab.js";
import { OpenLinkProvider } from "../tasks/use-open-link.js";
import { DesktopAgentPage } from "./desktop-agent-page.js";

/**
 * desktop-agent-page.test.ts -- one agent's page as the window draws it: the agent read by its id, titled as its tab would be, and a read that did not land said with a retry; an automation's agent opens on the automation's prompt alone, as a message the automation sent, which opens the automation's page where the window can, and names it plainly where it is deleted, with the pull request its event named and who ran it now; a webhook's body stands inside the card alone.
 *
 * The service is a script at the act boundary; synthetic agents and words throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** The task an agent on a task stands on, whose pages it shows. */
const PAGE_TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** The agent a Continue or a Fork on the page starts. */
const STARTED_ID = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const PAGE: AgentPage = {
  id: AGENT_ID,
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sweep the flaky tests",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
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
  action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Sweep the flaky tests." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
  scope: AUTOMATION_SCOPE.WORKSPACE,
};

/** The prompt an automation's run handed its agent: the automation's own, then what we add of the firing. */
const HANDED = `Sweep the flaky tests.

---

Vespin started this run for the automation "Flaky-test sweep" because its schedule was due.`;

/** The agent an automation's run started, read as its page with the run. */
const RUN_PAGE: AgentPage = {
  ...PAGE,
  title: null,
  brief: AGENT_BRIEF.PROMPT,
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

/** Where the task list's read stands, which the page draws the agent from. */
const LIST_STATUS = { READ: "read", READING: "reading", FAILED: "failed" } as const;

type ListStatus = (typeof LIST_STATUS)[keyof typeof LIST_STATUS];

/** The agent as the task list carries it: its own workspace and repository beside it, and no run, which the host holds apart. */
function listedOf(agent: AgentPage): ListedAgent {
  const { automationId, origin: _origin, ...row } = agent;
  return automationId === null ? row : { ...row, automationId };
}

// A message is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));
/** Every address handed to GitHub, in order. */
let openedOnGitHub: string[] = [];
/** The agent as the task list carries it, with the run that started it, which the host holds apart; none where the list carries it not. */
let listed: AgentPage | undefined;
/** Whether the task list carries the agent the service holds as `listed`, as it does once it caught up with it. */
let carried = true;
/** Where the task list's read stands: read, not read yet, or failed. */
let listStatus: ListStatus = LIST_STATUS.READ;
/** Reads the task list again, as its Retry asks. */
let retryList: () => void = () => undefined;
/** Every agent read fresh by its id, as the archive confirm reads it, in order. */
let read: string[] = [];
/** Every agent whose origin the page held, in order. */
let originHolds: string[] = [];
/** Every archive or Unarchive asked, as the act carried it. */
let archives: { agentId: string; archived: boolean }[] = [];
/** Whether an archive or Unarchive is refused, as an unanswered service refuses it. */
let archiveRefused = false;
/** Every agent a delete asked for, in order. */
let deletes: string[] = [];
/** Why a delete is refused, as the service answers it; none lets it land. */
let deleteRefused: AgentCallFailure | undefined;
/** What the agent's workspace's members read answers; none refuses it. */
let members: readonly WorkspaceMember[] | undefined;
/** What the host lays of the agent's transcript once its tab holds it, and what a read of it answers once; none refuses it. */
let transcript: AgentMessagesAnswerView | undefined;
/** Every act the page told or asked, in order. */
let told: AnyAct[] = [];
/** What a read of what the agent published answers; none refuses it. */
let published: AgentPullRequestAnswer | undefined;

/** What the agent published, as the task list carries it of the agent's row, where the host lays it; none where it published nothing. */
function listedPublished(): TasksControl["listedPullRequests"] {
  const opened = published?.pullRequest ?? undefined;
  return opened === undefined
    ? undefined
    : [{ agentId: AGENT_ID, taskId: null, pullRequest: opened }];
}
/** How many of the pull request's conversation entries its read left on GitHub; none answers no read. */
let earlier = 0;
/** What the window copied, in order. */
let copied: string[] = [];
/** What the workspace's list of agents answers, whatever it was asked. */
let workspace: readonly AgentSummary[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  listed = PAGE;
  carried = true;
  listStatus = LIST_STATUS.READ;
  retryList = () => undefined;
  read = [];
  originHolds = [];
  archives = [];
  archiveRefused = false;
  deletes = [];
  deleteRefused = undefined;
  members = undefined;
  transcript = undefined;
  told = [];
  published = undefined;
  earlier = 0;
  openedOnGitHub = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), ...DESKTOP_LINKS, pageFrameUrl });
  workspace = [];
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
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
                source: TASK_SKILL_SOURCE.REPOSITORY,
                path: ".agents/skills/release/SKILL.md",
              },
            ],
          },
        };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_ARCHIVE) {
        archives.push(request.payload);
        // The agent answered is the one the list carries, archived or brought back as asked.
        const { archivedAt: _archived, ...back } = listed ?? PAGE;
        const answered = request.payload.archived ? { ...back, archivedAt: 3 } : back;
        // Archived or brought back, the agent is read so from then on.
        if (!archiveRefused) listed = answered;
        const value = archiveRefused
          ? { failure: AGENT_CALL_FAILURE.UNANSWERED }
          : { agent: answered };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_DELETE) {
        deletes.push(request.payload.agentId);
        const value =
          deleteRefused === undefined ? { deleted: true as const } : { failure: deleteRefused };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_RENAME) {
        const value = { agent: { ...(listed ?? PAGE), title: request.payload.title } };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_MESSAGES && transcript !== undefined) {
        // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
        const value = transcript;
        transcript = { failure: AGENT_CALL_FAILURE.UNANSWERED };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.GITHUB_OPEN) {
        openedOnGitHub.push(request.payload.url);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.AGENTS_START) {
        const value = {
          agent: { ...PAGE, id: STARTED_ID, status: AGENT_STATUS.STARTING },
        };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_WORKSPACE_LIST) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agents: workspace } });
      }
      if (request.kind === ACT_KIND.AGENTS_PAGE) {
        read.push(request.payload.agentId);
        const value: AgentPageAnswerView =
          listed === undefined ? { failure: AGENT_CALL_FAILURE.NOT_FOUND } : { agent: listed };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.AGENTS_ORIGIN_FOLLOW) {
        originHolds.push(request.payload.agentId);
        return quietHold<typeof ACT_KIND.AGENTS_ORIGIN_FOLLOW>().then((value) => ({
          status: FAKE_ANSWER.DONE,
          value,
        }));
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  // Note that the agent's workspace's people are laid on the document as the page holds them, refused where the test names none.
  handMembers(() => (members === undefined ? { failed: true } : { rows: { members } }));
  handCapabilities(DESKTOP_CAPABILITIES);
  // The host holds a Pull request tab's parts, read from what the agent published, as the service reads both from one pull request; refused where the test names none.
  const unanswered = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
  holdPullRequestParts(handHostReads({}).deliverParts, {
    [PULL_REQUEST_PART.PULL_REQUEST]: () => {
      const pullRequest = published?.pullRequest;
      if (pullRequest == null) return Promise.resolve(unanswered);
      const { number, title, url, state } = pullRequest;
      return Promise.resolve({
        pullRequest: {
          number,
          title,
          url,
          state,
          html: "",
          base: "main",
          head: published?.branch ?? "main",
          createdAt: 1,
          mergedAt: null,
          merge: MERGE_STATE.CLEAN,
          requested: [],
        },
      });
    },
    [PULL_REQUEST_PART.CONVERSATION]: () =>
      Promise.resolve(
        earlier > 0 ? { pullRequest: { reviewers: [], conversation: [], earlier } } : unanswered,
      ),
    [PULL_REQUEST_PART.PUBLISHED]: () => Promise.resolve(published ?? unanswered),
  });
  // The host lays the agent's transcript once its tab holds it.
  pushedTranscripts(() => (transcript === undefined ? [] : [transcript]));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The window's tasks control with the task list carrying `listed`, where it carries it, as `listStatus` says. */
function withList(tasks: TasksControl): TasksControl {
  const read = listStatus === LIST_STATUS.READ;
  return {
    ...tasks,
    liveAgents: read ? (listed === undefined || !carried ? [] : [listedOf(listed)]) : undefined,
    listRead: read,
    listFailed: listStatus === LIST_STATUS.FAILED,
    onRetryList: () => retryList(),
  };
}

/** Hands the window main's document with the host holding the agent's origin as `listed` names it, where it names one, beside whatever else the bridge already holds. */
function handOrigin(): void {
  const origin = listed?.origin;
  if (origin === undefined) return;
  const calls = fakeAppBridgeCalls();
  const handed = calls.requestAppState ?? (() => Promise.resolve(stateWith({}, {})));
  fakeAppBridge({
    ...calls,
    requestAppState: async () => ({
      ...(await handed()),
      [LIVE_READ.AGENT_ORIGINS]: { [AGENT_ID]: { rows: origin } },
    }),
  });
}

/**
 * The page of the agent, standing in the task's place, as the window's
 * tasks control holds it, the task list carrying `listed` as `listStatus`
 * says and the host holding its origin, its atoms held by `registry`.
 * Answers the page's container, and `relist`, which draws it again as the
 * list now stands.
 */
function mount(
  tasks: TasksControl = tasksControl({}),
  openLink?: (link: ReadLink) => void,
  away?: { label: string; onPress: () => void },
  registry = AtomRegistry.make(),
): HTMLElement & { relist: () => void } {
  handOrigin();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const draw = () => {
    const page = createElement(DesktopAgentPage, {
      tasks: withList({
        ...tasks,
        listedPullRequests: tasks.listedPullRequests ?? listedPublished(),
      }),
      agentId: AGENT_ID,
      away,
    });
    root?.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          openLink === undefined
            ? page
            : createElement(OpenLinkProvider, { value: openLink, children: page }),
          createElement(ToastHost),
        ),
      ),
    );
  };
  act(draw);
  return Object.assign(container, { relist: () => act(draw) });
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("an agent the task list carries draws in the page's first frame, titled as its tab would be, reading nothing of it", async () => {
  const page = mount();
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
  await settle();

  assert.deepEqual(read, [], "the agent is not read by its id");
});

test("an agent no automation started draws no run and holds none, and an automation's agent holds its run once", async () => {
  listed = { ...PAGE, automationId: null };
  transcript = handedTranscript();
  const page = mount();
  await settle();
  assert.doesNotMatch(page.textContent ?? "", /Flaky-test sweep/u, "no run is drawn");
  assert.deepEqual(originHolds, []);
  act(() => root?.unmount());

  listed = RUN_PAGE;
  transcript = handedTranscript();
  mount(tasksControl({ workspaces: [ACME] }));
  await settle();
  assert.deepEqual(originHolds, [AGENT_ID]);
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
    status: AGENT_STATUS.COMPLETED,
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
  assert.ok(page.querySelector("[role='search'][aria-label='Find']"), "⌘F opens the find bar");
});

test("Fork to new agent on the page's agent opens the page's draft in its place, which starts the fork where that agent is, naming no task, and the new agent opens on its own page", async () => {
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
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const opened: string[] = [];
  const agentView = {
    agentId: AGENT_ID,
    onOpen: (id: string) => opened.push(id),
    onClose: () => undefined,
  };
  const page = mount(tasksControl({ agentView }));
  await settle();

  const fork =
    page.querySelector<HTMLButtonElement>('button[aria-label="Fork to new agent"]') ??
    assert.fail("the agent's message offers Fork to new agent");
  act(() => fork.click());
  await settle();
  const draft =
    page.querySelector<HTMLElement>(
      `.desktop-agent section[aria-label="${TAB_WORDS.NEW_AGENT}"]`,
    ) ?? assert.fail("the draft stands in the agent's place");
  pressInComposer(draft, "Enter");
  await settle();

  const starts = told.filter((each) => each.kind === ACT_KIND.AGENTS_START);
  assert.equal(starts.length, 1);
  const payload = starts[0]?.payload;
  assert.ok(payload !== undefined && !("taskId" in payload), "the Start names no task");
  assert.deepEqual(payload.from, { agentId: AGENT_ID, messageId: "answer" });
  assert.deepEqual(opened, [STARTED_ID]);
});

test("a fork's draft on the page names its source's message, whose press opens it and leaves the draft for the agent's transcript", async () => {
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
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const links: ReadLink[] = [];
  const page = mount(tasksControl({}), (link) => links.push(link));
  await settle();
  const fork =
    page.querySelector<HTMLButtonElement>('button[aria-label="Fork to new agent"]') ??
    assert.fail("the agent's message offers Fork to new agent");
  act(() => fork.click());
  await settle();

  const quote =
    page.querySelector<HTMLButtonElement>(".draft-fork-quote button") ??
    assert.fail("the draft names the message it forks, which opens");
  act(() => quote.click());
  await settle();

  assert.deepEqual(
    links.map((link) => link.place),
    [{ kind: LINK_PLACE.MESSAGE, agentId: AGENT_ID, messageId: "answer" }],
  );
  assert.equal(
    page.querySelector(`.desktop-agent section[aria-label="${TAB_WORDS.NEW_AGENT}"]`),
    null,
    "the draft gives way to the agent",
  );
});

test("an agent forked at one of its messages names the fork under it, which opens the fork's own page", async () => {
  listed = {
    ...PAGE,
    continuedBy: [
      { agentId: STARTED_ID, title: "Try the cron", forked: true, messageId: "answer" },
    ],
  };
  transcript = {
    messages: [
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: "The flaky retry is gone." }],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const opened: string[] = [];
  const agentView = {
    agentId: AGENT_ID,
    onOpen: (id: string) => opened.push(id),
    onClose: () => undefined,
  };
  const page = mount(tasksControl({ agentView }));
  await settle();

  const chip =
    page.querySelector<HTMLElement>("[data-forked-to] [data-actor-ref]") ??
    assert.fail("the message names its fork");
  assert.match(chip.textContent ?? "", /Try the cron/u);
  act(() => chip.click());
  assert.deepEqual(opened, [STARTED_ID]);
});

/** The page over the window's own side panel, held by the agent as the window holds it while the page stands. */
/** The side panel the page last drew, whose toggle the shell's button presses. */
let drawnPanel: SidePanelControl | undefined;

function PanelPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(undefined, { id: AGENT_ID, holds: {} }, agents, [], [], agents);
  drawnPanel = sidePanel;
  return createElement(DesktopAgentPage, {
    tasks: withList({ ...tasksControl({}), sidePanel, listedPullRequests: listedPublished() }),
    agentId: AGENT_ID,
  });
}

test("a delegation's row opens its worker in the side panel beside the agent's page, whose + offers no Inbox, its threads opening in the window's Inbox, and none of a task's Plan or Comments", async () => {
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
    status: AGENT_STATUS.COMPLETED,
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
    offered.filter((label) => /^(Plan|Comments|Inbox)/u.test(label ?? "")),
    [],
    "no task's kind nor an Inbox is offered",
  );
});

/** A page the agent showed on itself, working on no task. */
const FUNNEL: PageLine = {
  id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  title: "Flaky funnel",
  version: 2,
  at: 5,
  shownBy: { kind: PAGE_SHOWER.AGENT, agentId: AGENT_ID },
};

/** The page over the window's own side panel, holding the pages the agent showed on itself as the window does. */
function PagesPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(
    undefined,
    { id: AGENT_ID, holds: {} },
    agents,
    [],
    [FUNNEL.id],
    agents,
  );
  drawnPanel = sidePanel;
  const base = tasksControl({});
  return createElement(DesktopAgentPage, {
    tasks: withList({
      ...base,
      sidePanel,
      agentView: { ...base.agentView, agentId: AGENT_ID, pages: [FUNNEL] },
    }),
    agentId: AGENT_ID,
  });
}

test("the panel beside an agent's page offers the pages the agent showed on itself under its +, asked at the toggle with nothing to show, and one picked opens in a page tab drawn from the agent's own address, as a task's opens beside its plan", async () => {
  localStorage.clear();
  installScrollIntoView();
  transcript = {
    messages: [
      {
        id: "brief",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Chart the flakes." }],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PagesPage))));
  await settle();
  act(() => drawnPanel?.onToggle());
  await settle();

  assert.equal(container.querySelector("aside.side-panel"), null, "never shown with nothing in it");
  assert.deepEqual(
    [...document.querySelectorAll(".ui-searchable-menu [role='group']")].map((each) =>
      each.getAttribute("aria-label"),
    ),
    ["Pages", "Terminal", "Browser"],
  );
  const row =
    [...document.querySelectorAll<HTMLElement>(".ui-searchable-menu [role='option']")].find(
      (each) => (each.textContent ?? "").includes(FUNNEL.title),
    ) ?? assert.fail("the + offers the agent's page");
  act(() => row.click());
  await settle();

  const panel = container.querySelector("aside.side-panel") ?? assert.fail("the pick shows it");
  assert.ok(
    [...panel.querySelectorAll("[role='tab']")].some((tab) =>
      (tab.textContent ?? "").includes(FUNNEL.title),
    ),
    "the page's tab stands in the panel",
  );
  assert.equal(
    panel.querySelector<HTMLIFrameElement>(".page-view iframe")?.getAttribute("src"),
    `app-page://page/agent/${AGENT_ID}/${FUNNEL.id}/${FUNNEL.version}`,
  );
});

test("the chip of a page an agent on a task showed hangs the page's card, read from the task the page stands on", async () => {
  listed = { ...PAGE, planId: PAGE_TASK };
  transcript = {
    messages: [
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "tool-show_page",
            toolCallId: "call-1",
            state: "output-available",
            input: { title: FUNNEL.title, path: "funnel.html" },
            output: { status: "accepted", page: { id: FUNNEL.id, version: 2 } },
          },
        ],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  // Note that only the task the agent stands on holds a page, laid on the document as the host lays the pages a card holds.
  holdPages(handHostReads({}).deliverPages, (place) => ({
    rows: "taskId" in place && place.taskId === PAGE_TASK ? [FUNNEL] : [],
  }));
  const page = mount();
  await settle();

  const chip =
    page.querySelector<HTMLElement>('.desktop-agent [data-call-id="call-1"] [data-mention-ref]') ??
    assert.fail("the call's row names the page it showed by its chip");
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(chip);
  await settle();

  const card = document.querySelector(".ui-tooltip-card [data-page-card]");
  assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, FUNNEL.title);
  assert.equal(
    card?.querySelector(".ui-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ taskId: PAGE_TASK, pageId: FUNNEL.id, version: 2 }),
    "the preview is the task's page",
  );
});

test("an agent on a task, an archived one's page among them, opens on its plan sent by the task, whose name opens the task's plan", async () => {
  const task: Task = {
    id: PAGE_TASK,
    workspaceId: PAGE.workspaceId,
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
    document: { body: "", assumptions: [] },
  };
  listed = { ...PAGE, planId: PAGE_TASK, automationId: null, brief: AGENT_BRIEF.PLAN };
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Invitations" }] },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const links: ReadLink[] = [];
  const page = mount(tasksControl({ tasks: [task] }), (link) => links.push(link));
  await settle();

  const named =
    page.querySelector<HTMLElement>(".agent-origin [data-task-ref]") ??
    assert.fail("the card is sent by the task");
  assert.equal(named.textContent, task.name);
  act(() => named.click());
  assert.deepEqual(
    links.map((link) => link.place),
    [{ kind: LINK_PLACE.TASK, planId: PAGE_TASK }],
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

test("its last tab closed shuts the panel, and its toggle then asks for its + at the toggle, every row and heading as the panel's own +, each opening what it names", async () => {
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
    status: AGENT_STATUS.COMPLETED,
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
  const offered = [...document.querySelectorAll(".ui-searchable-menu [role='option']")].map(
    (each) => each.textContent,
  );
  const headings = [...document.querySelectorAll(".ui-searchable-menu [role='group']")].map(
    (each) => each.getAttribute("aria-label"),
  );
  act(() => add.click());
  await settle();
  const close = panel.querySelector<HTMLButtonElement>('button[aria-label^="Close "]');
  assert.ok(close, "the worker's tab closes");
  act(() => close.click());
  await settle();
  assert.equal(container.querySelector("aside.side-panel"), null, "the panel shuts");

  act(() => drawnPanel?.onToggle());
  await settle();
  assert.equal(container.querySelector("aside.side-panel"), null, "never shown with nothing in it");
  const rows = [...document.querySelectorAll<HTMLElement>(".ui-searchable-menu [role='option']")];
  assert.deepEqual(
    rows.map((each) => each.textContent),
    offered,
  );
  // Note that an agent's page offers no fixed kind, so the menu heads only its own sections.
  assert.deepEqual(
    [...document.querySelectorAll(".ui-searchable-menu [role='group']")].map((each) =>
      each.getAttribute("aria-label"),
    ),
    headings,
  );
  assert.deepEqual(headings, ["Pull requests", "Terminal", "Browser"]);
  const changes = rows.find((each) => (each.textContent ?? "").includes("#2911"));
  assert.ok(changes, "the + offers the agent's pull request");
  act(() => changes.click());
  await settle();
  const shown = container.querySelector("aside.side-panel") ?? assert.fail("the pick shows it");
  assert.ok(
    [...shown.querySelectorAll("[role='tab']")].some((tab) =>
      (tab.textContent ?? "").includes("#2911 Await the payment mock"),
    ),
    "the Pull request tab stands in the panel, named by its number and title",
  );
});

test("an archived agent's pull request, picked from the panel's +, opens in a Pull request tab standing beside its page", async () => {
  listed = { ...PAGE, archivedAt: 2 };
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

test("⌘T on an agent's page with nothing in its panel asks for its + at the toggle, the page's one, rather than showing the panel empty", async () => {
  const container = await mountPanelPage();

  act(() => {
    runAppCommand(APP_COMMAND.NEW_TAB);
  });
  await settle();

  assert.equal(container.querySelector("aside.side-panel"), null, "never shown with nothing in it");
  assert.ok(
    document.querySelector("input[placeholder='Search tabs']"),
    "its + opens on the tabs it offers",
  );
});

test("a chip in the agent's words naming the pull request it opened opens its Pull request tab beside its page, and another repository's pull request opens on GitHub, as does the tab's own way to its earlier comments", async () => {
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
  const other = "https://github.com/acme/billing/pull/7";
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [
          {
            type: "text",
            text: `Opened [@relay#2911](${url}#issuecomment-1), beside [@billing#7](${other}).`,
          },
        ],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = await mountPanelPage();
  await settle();
  const chip = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".agent-page [data-mention-ref]")].find(
      (each) => each.querySelector(".ui-inline-ref-label")?.textContent?.includes(name),
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

  act(() => chip("billing#7")?.click());
  assert.deepEqual(openedOnGitHub, [other]);

  // A link in the pull request's own tab, to what its read left on GitHub, still leaves for GitHub.
  const more = container.querySelector<HTMLAnchorElement>(
    "aside.side-panel .pull-request-earlier a",
  );
  assert.ok(more, "the tab counts the earlier comments");
  act(() => more.click());
  assert.deepEqual(openedOnGitHub, [other, url]);
});

test("the agent's pull request is a row pinned over its box while it still works, never in its transcript nor a chip in the box's foot, and a press opens its Pull request tab beside the page", async () => {
  listed = { ...PAGE, status: AGENT_STATUS.RUNNING };
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
        parts: [{ type: "text", text: "Opened the pull request." }],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.RUNNING,
    title: null,
  };
  const container = await mountPanelPage();
  await settle();

  const row =
    container.querySelector<HTMLButtonElement>(
      '.agent-tab-foot [aria-label="Pull request"] li > button',
    ) ?? assert.fail("the pull request's row stands over the box");
  assert.ok(
    row.compareDocumentPosition(
      container.querySelector(".agent-composer") ?? assert.fail("the box stands"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the row stands above the box",
  );
  assert.equal(container.querySelector("[role='log'] [aria-label='Pull request']"), null);
  assert.ok(
    !(container.querySelector(".agent-composer")?.textContent ?? "").includes("#2911"),
    "the box's foot names no pull request",
  );

  act(() => row.click());
  await settle();
  assert.ok(
    container.querySelector('aside.side-panel [aria-label="Conversation"]'),
    "the Pull request tab stands in the panel, on its conversation",
  );
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
});

test("a skill a message names is its chip, which opens the skill's SKILL.md in a File tab beside the page, read through the agent's workspace and repository, there being no task", async () => {
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "line",
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: "Then run /release now." }],
        sentBy: { userId: "user-dean", name: "Dean Stratakos", kind: AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  handState(experimentsOn(EXPERIMENT.SKILLS));
  pushedTranscripts(() => (transcript === undefined ? [] : [transcript]));
  localStorage.clear();
  installScrollIntoView();
  // Note that the skills are read once the frame that asked for them has painted.
  holdFrames();
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PanelPage))));
  await settle();

  // The skills are read once a sent message first asks for them, a settle after the transcript lands.
  await settleFrames();
  const chip = page.querySelector<HTMLButtonElement>("button[data-skill-ref]");
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());
  await settle();

  const reads = told.flatMap((each) => (each.kind === ACT_KIND.TASKS_FILE ? [each.payload] : []));
  assert.ok(reads.length > 0, "the File tab reads the skill's file");
  for (const payload of reads) {
    assert.ok(!("taskId" in payload), "the read names no task");
    assert.equal(payload.path, ".agents/skills/release/SKILL.md");
    assert.ok("workspaceId" in payload && payload.workspaceId === "workspace-1");
    assert.ok("repository" in payload && payload.repository === "acme/relay");
  }
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
});

test("until the task list is read, the page stands in an agent tab's own shape saying Reading, and gives way to the agent once the list carries it", async () => {
  listStatus = LIST_STATUS.READING;
  const page = mount();
  await settle();

  const wait = page.querySelector('.agent-page [role="status"]');
  assert.equal(wait?.textContent, "Reading the agent");
  assert.ok(wait.closest(".agent-tab"), "the wait stands in the tab's own frame");
  assert.ok(
    page.querySelector(".agent-page .agent-tab-foot .ui-skeleton"),
    "the composer's card stands under the log",
  );
  assert.equal(page.querySelector(".agent-page .ui-spinner-region"), null);
  assert.equal(page.querySelector("h1"), null);
  listStatus = LIST_STATUS.READ;
  page.relist();
  await settle();
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("a task list whose read did not land says so, and Retry reads the list again, the agent drawn once it carries it", async () => {
  listStatus = LIST_STATUS.FAILED;
  const page = mount();
  retryList = () => {
    listStatus = LIST_STATUS.READ;
    page.relist();
  };
  await settle();

  assert.match(page.textContent ?? "", /This agent could not be read\./u);
  const retry = [...page.querySelectorAll("button")].find((each) =>
    /Retry/u.test(each.textContent ?? ""),
  );
  assert.ok(retry, "the failure offers Retry");
  act(() => retry.click());
  await settle();

  assert.deepEqual(read, [], "the agent is not read by its id");
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
});

test("an agent the task list does not carry, as a link to another workspace's may name, or one it dropped, is not found, and nothing of it is drawn", async () => {
  listed = undefined;
  const page = mount();
  await settle();

  assert.match(
    page.textContent ?? "",
    /Not foundThis agent doesn't exist, or you don't have access to it\./u,
  );
  assert.equal(page.querySelector("h1"), null);
  // The window's bar stands over the words saying so, as it stands over every page.
  assert.equal(
    page.querySelector("section[aria-label='Not found']")?.firstElementChild?.tagName,
    "HEADER",
  );
  assert.equal(
    [...page.querySelectorAll("button")].some((each) => /Retry/u.test(each.textContent ?? "")),
    false,
  );
});

test("an agent the task list does not carry yet, as a teammate's just started, is looked up once by its id and reads as Reading, then as the agent once the list carries it", async () => {
  carried = false;
  const page = mount();
  await settle();

  assert.equal(page.querySelector('.agent-page [role="status"]')?.textContent, "Reading the agent");
  assert.equal(page.querySelector("h1"), null);
  carried = true;
  page.relist();
  await settle();
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
  assert.deepEqual(read, [AGENT_ID], "the agent is looked up once");
});

test("on a phone an agent that is not found still leads with its way back", async () => {
  listed = undefined;
  const left: string[] = [];
  const page = mount(tasksControl({}), undefined, {
    label: "Inbox",
    onPress: () => left.push("away"),
  });
  await settle();

  assert.match(page.textContent ?? "", /Not found/u);
  const head = page.querySelector<HTMLElement>(".agent-head") ?? assert.fail("the phone's bar");
  const back = head.querySelector<HTMLButtonElement>("button") ?? assert.fail("its way back");
  assert.equal(back.textContent?.trim(), "Inbox");
  act(() => back.click());
  assert.deepEqual(left, ["away"]);
});

test("an archived agent's page offers Unarchive in its composer's place, which brings the agent back", async () => {
  listed = { ...PAGE, archivedAt: 2 };
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

test("an agent another agent archived says on its page who archived it, for which member, and why, over its Unarchive", async () => {
  listed = {
    ...PAGE,
    archivedAt: 2,
    archivedBy: {
      by: AGENT_ARCHIVER.AGENT,
      member: { userId: "user-dean", name: "Dean Stratakos" },
      agent: { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "Bill by seat" },
      reason: "Its pull request merged.",
    },
  };
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
  listed = { ...PAGE, archivedAt: 2 };
  archiveRefused = true;
  const page = mount();
  await settle();

  const unarchive = [...page.querySelectorAll("button")].find(
    (each) => each.textContent === "Unarchive",
  );
  assert.ok(unarchive);
  act(() => unarchive.click());
  await settle();

  assert.match(document.body.textContent ?? "", /The agent could not be unarchived\. Try again\./u);
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
        sentBy: { ...charles, kind: AGENT_SENDER.MEMBER },
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  // Note that the workspace's people stand on the document from the first frame, as the host holds them for a page drawn again.
  handHostReads({ members: { [PAGE.workspaceId]: { rows: { members } } } });
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

  const sender = page.querySelector(
    ".is-received:not(.agent-origin) .ui-message-head-sender [data-actor-ref]",
  );
  assert.equal(sender?.querySelector(".ui-inline-ref-label")?.textContent, "Charles Pan");
  assert.equal(sender?.querySelector("img")?.getAttribute("src"), picture);
});

/** The transcript of an automation's agent: the prompt its run handed it, and its answer. */
function handedTranscript(): AgentMessagesAnswerView {
  return {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: HANDED }] },
      { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "Done." }] },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
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
  const head = card.querySelector<HTMLElement>("[data-origin-plan] > summary");
  act(() => head?.click());
  return { card, sender: card.querySelector<HTMLElement>(".ui-message-line-sender") };
}

test("an automation's agent opens on the automation's prompt alone, sent by the automation, whose name opens its page", async () => {
  listed = RUN_PAGE;
  transcript = handedTranscript();
  holdAutomations(handHostReads({}).deliverAutomations, {
    [AUTOMATION_FOLLOW.WORKSPACE]: () => ({ rows: [SWEEP] }),
  });
  const opened: unknown[] = [];
  const tasks = tasksControl({ workspaces: [ACME] });
  const page = mount({
    ...tasks,
    automationsView: { ...tasks.automationsView, onOpen: (place) => opened.push(place) },
  });
  await settle();

  const { card, sender } = origin(page);
  const automation = sender?.querySelector<HTMLButtonElement>("button[data-actor-ref]");
  assert.equal(words(automation), "Flaky-test sweep");
  assert.match(card.textContent ?? "", /Sweep the flaky tests\./u);
  assert.doesNotMatch(card.textContent ?? "", /Vespin started this run/u);
  act(() => automation?.click());

  assert.deepEqual(opened, [{ kind: "edit", automationId: SWEEP.id }]);
});

test("a deleted automation's agent still names it, plainly, with nothing to open", async () => {
  listed = { ...RUN_PAGE, automationId: null };
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [ACME] }));
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep (deleted)");
  assert.equal(sender?.querySelector("button"), null, "nothing opens it");
});

test("a GitHub event's run names its pull request beside the automation, which opens in a Pull request tab beside the page by its number, and a run now names who ran it", async () => {
  const url = "https://github.com/acme/relay/pull/2905";
  listed = {
    ...RUN_PAGE,
    origin: {
      prompt: "Review it.",
      subject: { number: 2905, title: "View commands", url },
      runBy: { userId: "user-dean", name: "Dean Stratakos" },
    },
  };
  transcript = handedTranscript();
  const chosen: unknown[] = [];
  const base = tasksControl({ me: "user-dean" });
  const page = mount({
    ...base,
    sidePanel: { ...base.sidePanel, onPreview: (tab) => chosen.push(tab) },
  });
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep · pull request #2905 · Run by you");
  act(() => sender?.querySelector<HTMLElement>("[data-mention-ref]")?.click());
  await settle();
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
  assert.deepEqual(chosen, [{ changes: AGENT_ID, number: 2905 }]);
});

test("a GitHub event's pull request is its chip, saying where it stands and wearing GitHub's mark for it, where the workspace's GitHub App reads it, a workspace with no slug among them", async () => {
  const url = "https://github.com/acme/relay/pull/2905";
  const acme = { ...ACME, github: { login: "acme", active: true } };
  const pullRequest = { number: 2905, title: "View commands", url, state: PULL_REQUEST_STATE.OPEN };
  // The host holds the pull request's standing as the workspace's GitHub App reads it.
  const state = {
    ...stateWith({}, { tasks: { ...IDLE_TASKS_VIEW, workspaces: [acme] } }),
    [LIVE_READ.LINK_STANDINGS]: { [acme.id]: { [url]: { rows: { pullRequest } } } },
  };
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  pushedTranscripts(() => (transcript === undefined ? [] : [transcript]));
  listed = {
    ...RUN_PAGE,
    origin: { prompt: "Review it.", subject: { number: 2905, title: "View commands", url } },
  };
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [acme] }));
  await settle();

  const chip = origin(page).sender?.querySelector<HTMLElement>("[data-mention-ref]");
  assert.deepEqual(
    [
      chip?.querySelector(".ui-inline-ref-label")?.textContent,
      chip?.querySelector(".ui-inline-ref-state")?.textContent,
      chip?.querySelector<SVGElement>("[data-pull-request-mark]")?.dataset.pullRequestState,
    ],
    ["#2905", "Open", PULL_REQUEST_STATE.OPEN],
  );
});

test("a webhook's body stands folded inside the card under the prompt, and nowhere in the line naming who sent it", async () => {
  const body = '{"release":"v2.4.0"}';
  listed = { ...RUN_PAGE, origin: { prompt: "Write the notes.", body } };
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
  listed = RUN_PAGE;
  const page = mount();
  await settle();

  // Note that its bar leads with its automation's path, so its title is the trail's last crumb, the page it stands on.
  assert.equal(page.querySelector('[aria-current="page"]')?.textContent, "Flaky-test sweep");
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
  openPageMenu(page);
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Copy link",
  );
  assert.ok(item, "the ⋯ offers Copy link");
  await act(async () => item.click());

  assert.deepEqual(copied, [`https://vespin.dev/acme/agent/${AGENT_ID}`]);
  assert.equal(newestToastSays(), "Link copied");
});

/** Opens the page's menu as a reader does: a right-click on the agent's name in its toolbar. */
function openPageMenu(page: HTMLElement): void {
  const name =
    page.querySelector(".ui-toolbar-title-menu") ?? assert.fail("the toolbar names the agent");
  act(() => {
    name.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

/** Opens the page's menu and answers the item under `label`, or fails saying it is not offered. */
function pageMenuItem(page: HTMLElement, label: string): HTMLButtonElement {
  openPageMenu(page);
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the ⋯ offers ${label}`)
  );
}

test("the page's ⋯ offers what a task's agent's tab ⋯ does, in the one order: Copy link and the transcript's two copies, Rename, Show terminal, Archive, and Permanently delete last, and no Run, which its Pull request tab offers", async () => {
  const page = mount();
  await settle();
  openPageMenu(page);

  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.deepEqual(offered, [
    "Copy link",
    "Copy transcript",
    "Rename",
    "Show terminal⌘J",
    "Archive",
    "Permanently delete⌘⌫",
  ]);
});

test("a taskless agent the sidebar lists gains its row's own items on its page's ⋯: Mark as unread beside Rename, then Pin and Move to section, and Pin pins it", async () => {
  const pins: { agentId: string; pinned: boolean }[] = [];
  const row = {
    ...PAGE,
    automationName: "Flaky sweep",
    activityAt: 2,
  };
  const page = mount(
    tasksControl({
      listedAgents: { standing: [row], archived: [] },
      onPinAgent: (agentId, pinned) => {
        pins.push({ agentId, pinned });
      },
    }),
  );
  await settle();
  const offered = () =>
    [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent);
  const pin = pageMenuItem(page, "PinP");
  act(() => pin.click());
  assert.deepEqual(pins, [{ agentId: AGENT_ID, pinned: true }]);

  assert.deepEqual(offered(), [], "the menu closed on the pin");
  openPageMenu(page);
  assert.deepEqual(offered(), [
    "Copy link",
    "Copy transcript",
    "Rename",
    "Mark as unreadU",
    "PinP",
    "Move to section",
    "Show terminal⌘J",
    "Archive",
    "Permanently delete⌘⌫",
  ]);

  act(() => pageMenuItem(page, "Mark as unreadU").click());
  assert.deepEqual(offered(), [], "the menu closed on the mark");
  await settle();
  assert.deepEqual(
    told.filter((asked) => asked.kind === ACT_KIND.AGENTS_MARK_READ).map((asked) => asked.payload),
    [{ agentId: AGENT_ID, readMark: READ_MARK.UNREAD }],
  );
});

/** What a side panel is asked to show. */
type SidePanelChoice = Parameters<SidePanelControl["onChoose"]>[0];

/** The page over a side panel that hears what it is asked to show, and shows nothing, so no terminal mounts. */
function mountHearingPanel() {
  const chosen: SidePanelChoice[] = [];
  const tasks = tasksControl({});
  const page = mount({
    ...tasks,
    sidePanel: { ...tasks.sidePanel, onChoose: (tab) => chosen.push(tab) },
  });
  return { page, chosen };
}

test("Show terminal on the page's ⋯, and ⌘J, show the agent's own Terminal tab in the side panel beside its page, as on a task", async () => {
  const { page, chosen } = mountHearingPanel();
  await settle();
  const open = pageMenuItem(page, "Show terminal⌘J");
  act(() => open.click());
  await settle();
  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.SHOW_TERMINAL);
  });
  await settle();

  assert.equal(offered, true, "⌘J is offered on the page");
  assert.deepEqual(chosen, [{ terminal: AGENT_ID }, { terminal: AGENT_ID }]);
});

test("an archived agent's page offers no terminal, from its ⋯ or ⌘J, its sandbox taking no shell", async () => {
  listed = { ...PAGE, archivedAt: 2 };
  const { page, chosen } = mountHearingPanel();
  await settle();
  openPageMenu(page);
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  let ran = true;
  act(() => {
    ran = runAppCommand(APP_COMMAND.SHOW_TERMINAL);
  });
  await settle();

  assert.ok(!offered.includes("Show terminal⌘J"), `no Show terminal: ${offered.join(", ")}`);
  assert.equal(ran, false, "⌘J is not offered");
  assert.deepEqual(chosen, []);
});

test("Archive on the page's ⋯ reads an agent at rest again and archives it unasked", async () => {
  const page = mount();
  await settle();
  const archive = pageMenuItem(page, "Archive");
  await act(async () => archive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing was asked");
});

test("Archive on the page's ⋯ archives the reader's own agent at once while it works, asking nothing", async () => {
  listed = { ...PAGE, status: AGENT_STATUS.RUNNING };
  const page = mount();
  await settle();
  const archive = pageMenuItem(page, "Archive");
  await act(async () => archive.click());
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing was asked");
  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
});

test("an archived agent's ⋯ offers Unarchive in Archive's place, and no Rename", async () => {
  listed = { ...PAGE, archivedAt: 2 };
  const page = mount();
  await settle();
  const unarchive = pageMenuItem(page, "Unarchive");
  assert.ok(
    ![...document.querySelectorAll('[role="menuitem"]')].some(
      (each) => each.textContent === "Rename",
    ),
  );
  await act(async () => unarchive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: false }]);
});

test("an archive the service refuses says why and leaves the automation's prompt standing over the agent's transcript", async () => {
  listed = RUN_PAGE;
  transcript = handedTranscript();
  archiveRefused = true;
  const page = mount(tasksControl({ workspaces: [ACME] }));
  await settle();
  const archive = pageMenuItem(page, "Archive");
  await act(async () => archive.click());
  await settle();

  assert.match(document.body.textContent ?? "", /The agent could not be archived\. Try again\./u);
  const { card } = origin(page);
  assert.match(card.textContent ?? "", /Sweep the flaky tests\./u);
});

test("Rename on the page's ⋯ turns the title into its name's field, and the name typed renames the agent", async () => {
  const page = mount();
  await settle();
  const rename = pageMenuItem(page, "Rename");
  act(() => rename.click());
  const field =
    page.querySelector<HTMLInputElement>('h1 input[aria-label="Agent name"]') ??
    assert.fail("the title is its name's field");
  act(() => {
    field.value = "Sweep the slow tests";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();

  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.AGENTS_RENAME).map((each) => each.payload),
    [{ agentId: AGENT_ID, title: "Sweep the slow tests" }],
  );
});

/** A registry whose atoms wait on this clock, as the window's wait on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))]],
  });
}

/** The clock moved past the pause the typing rests before agents are searched for, and what the search answered drawn. */
const pastSearchPause = Effect.gen(function* () {
  yield* TestClock.adjust("300 millis");
  yield* Effect.promise(settle);
});

it.effect(
  "an @ in the agent's box names an archived agent by its task's name, read from the window's tasks",
  () =>
    Effect.gen(function* () {
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
          status: AGENT_STATUS.COMPLETED,
          turnId: null,
          archivedAt: 3,
        },
      ];
      const page = mount(
        tasksControl({ tasks: [billing] }),
        undefined,
        undefined,
        registryOn(yield* Clock.Clock),
      );
      yield* Effect.promise(settle);

      typeInComposer(page, "Ask @billing");
      yield* pastSearchPause;

      const rows = [
        ...page.querySelectorAll('.mention-menu [aria-label="Agents"] [role="option"]'),
      ];
      assert.deepEqual(
        rows.map((row) => [
          row.querySelector(".ui-combobox-option-label")?.textContent,
          row.querySelector(".ui-combobox-option-detail")?.textContent,
        ]),
        [["Bill by seat", "Billing · Archived"]],
      );
    }),
);

it.effect(
  "an agent working in no repository, as Vespin does, still takes an @ in its box, which offers the workspace's agents",
  () =>
    Effect.gen(function* () {
      installEditorLayout();
      installScrollIntoView();
      listed = { ...PAGE, repository: null };
      workspace = [
        {
          id: "3c3c3c3c-0000-4000-8000-000000000000",
          planId: null,
          model: PAGE.model,
          effort: PAGE.effort,
          title: "Bill by seat",
          createdAt: 1,
          status: AGENT_STATUS.COMPLETED,
          turnId: null,
        },
      ];
      const page = mount(
        tasksControl({ workspace: ACME, workspaces: [ACME] }),
        undefined,
        undefined,
        registryOn(yield* Clock.Clock),
      );
      yield* Effect.promise(settle);

      typeInComposer(page, "Ask @bill");
      yield* pastSearchPause;

      const rows = [
        ...page.querySelectorAll('.mention-menu [aria-label="Agents"] [role="option"]'),
      ];
      assert.deepEqual(
        rows.map((row) => row.querySelector(".ui-combobox-option-label")?.textContent),
        ["Bill by seat"],
      );
    }),
);

test("on the page of an agent working in no repository, a GitHub page of a file or a folder in its words is that file's or folder's chip, of the repository its address names, and opens on GitHub", async () => {
  listed = { ...PAGE, repository: null };
  const file = "https://github.com/acme/relay/blob/HEAD/src/store.ts";
  const folder = "https://github.com/acme/relay/tree/HEAD/src";
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Where is it?" }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: `In [@store.ts](${file}), under [@src](${folder}).` }],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const chips = [...page.querySelectorAll<HTMLElement>(".agent-page [data-mention-ref]")];

  assert.deepEqual(
    chips.map((chip) => [
      chip.dataset.kind,
      chip.querySelector(".ui-inline-ref-label")?.textContent,
    ]),
    [
      ["file", "store.ts"],
      ["folder", "src"],
    ],
  );
  const [fileChip, folderChip] = chips;
  assert.ok(fileChip && folderChip);
  restOn(fileChip);
  const card = document.querySelector(".ui-tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".ui-hover-card-name")?.textContent,
      card?.querySelector(".ui-hover-card-sub")?.textContent,
    ],
    ["src/store.ts", "acme/relay"],
  );
  act(() => fileChip.click());
  act(() => folderChip.click());
  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.GITHUB_OPEN).map((each) => each.payload),
    [{ url: file }, { url: folder }],
  );
});

test("a chip in the agent's words naming the pull request it opened, or a page under it, hangs its Pull request tab's card, as on a task", async () => {
  const url = "https://github.com/acme/relay/pull/2911";
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
  transcript = {
    messages: [
      { id: "brief", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Sweep the tests." }] },
      {
        id: "answer",
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "text", text: `Opened [@#2911](${url}), its [@files](${url}/files).` }],
      },
    ],
    cursor: "1:0",
    status: AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const chips = [...page.querySelectorAll(".agent-page [data-mention-ref]")];
  assert.equal(chips.length, 2, "the pull request and its files are chips");

  for (const chip of chips) {
    restOn(chip);
    const card = [...document.querySelectorAll(".ui-tooltip-card .ui-hover-card")].at(-1);
    assert.equal(card?.hasAttribute("data-pull-request-card"), true, "the card is its tab's");
    assert.equal(card?.querySelector(".ui-hover-card-name")?.textContent, "Await the payment mock");
    act(() => {
      chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
  }
});

/** The page's dialog's button with these words, or a failure saying the dialog offers none. */
function dialogAnswer(words: string): HTMLButtonElement {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("a dialog asks");
  return (
    [...question.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === words,
    ) ?? assert.fail(`the dialog offers ${words}`)
  );
}

test("Permanently delete on the page's ⋯ asks first, naming the agent, and once answered deletes it, says so, and leaves the page", async () => {
  let closed = 0;
  const agentView = { agentId: AGENT_ID, onOpen: () => undefined, onClose: () => (closed += 1) };
  const page = mount(tasksControl({ agentView }));
  await settle();

  const remove = pageMenuItem(page, "Permanently delete⌘⌫");
  act(() => remove.click());
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("it asks first");
  const title = document.getElementById(question.getAttribute("aria-labelledby") ?? "");
  const body = document.getElementById(question.getAttribute("aria-describedby") ?? "");
  assert.equal(title?.textContent, "Permanently delete agent?");
  assert.match(
    body?.textContent ?? "",
    /and its transcript will be deleted\. This cannot be undone\. To keep it out of the way instead, archive it\.$/u,
  );
  assert.equal(
    document.activeElement,
    dialogAnswer("Cancel"),
    "a key already pressed changes nothing",
  );
  assert.deepEqual(deletes, []);

  await act(async () => dialogAnswer("Permanently delete agent").click());
  await settle();

  assert.deepEqual(deletes, [AGENT_ID]);
  assert.equal(closed, 1, "the page is left");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a delete the service refused for an agent still starting says why in the dialog, which stays, and leaves the page standing", async () => {
  deleteRefused = AGENT_CALL_FAILURE.AGENT_NOT_READY;
  let closed = 0;
  const agentView = { agentId: AGENT_ID, onOpen: () => undefined, onClose: () => (closed += 1) };
  const page = mount(tasksControl({ agentView }));
  await settle();

  const remove = pageMenuItem(page, "Permanently delete⌘⌫");
  act(() => remove.click());
  await act(async () => dialogAnswer("Permanently delete agent").click());
  await settle();

  assert.deepEqual(deletes, [AGENT_ID]);
  const reason = document.querySelector(
    '[role="alertdialog"] [data-slot="field-error"]:not(:empty)',
  );
  assert.equal(reason?.textContent, "The agent is still starting its turn. Try again in a moment.");
  assert.equal(closed, 0);
});

test("on a phone the page is headed by its way back's glyph, the agent's name centered, and its one ⋯, which offers the panel the title bar's toggle offered", async () => {
  const left: string[] = [];
  const page = mount(tasksControl({}), undefined, {
    label: "Inbox",
    onPress: () => left.push("away"),
  });
  await settle();
  const head = page.querySelector<HTMLElement>(".agent-head");
  assert.ok(head, "the phone's head stands");
  assert.deepEqual(
    [...head.querySelectorAll("button")].map(
      (each) => each.textContent?.trim() || each.getAttribute("aria-label"),
    ),
    ["Inbox", "Agent actions"],
    "one control a corner",
  );
  assert.ok(head.querySelector("h1")?.textContent, "the agent's name is the title");
  act(() => head.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]')?.click());
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.ok(offered.includes("Show panel"), "the ⋯ offers the panel");
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(left, ["away"], "the way back goes where the shell says");
});
