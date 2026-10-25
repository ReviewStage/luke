// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentMessagesAnswerView,
  type CodingAgentPageAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BRIEF,
  CODING_AGENT_KIND,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  type CodingAgentPage,
  type CodingAgentPullRequestAnswer,
  type CodingAgentSummary,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/link-grammar";
import {
  MAC_TERMINAL_PORT_CHANNEL,
  MAC_TERMINAL_PORT_MESSAGE,
  type MacTerminalPortOutbound,
} from "@luke/features/mac-terminal-wire";
import { pageFrameUrl } from "@luke/features/page-frame";
import { PAGE_SHOWER, type PageLine } from "@luke/features/page-wire";
import type { Task } from "@luke/features/task-wire";
import { TASK_SKILL_SOURCE } from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActResult } from "@luke/host/contract";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { isMacTerminalTab, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { CALL_LABEL } from "@luke/ui/tasks-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { Clock, Context, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SIDE_BUNDLES } from "../bundle-loader.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import type { AgentCallPlace } from "../tasks/agent-call.js";
import { SIDE_PANEL_TAB, type SidePanelControl, useSidePanel } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  type AnyAct,
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActs,
  fakeAppBridge,
  fakeAppBridgeCalls,
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
  handState,
  stateWith,
} from "../testing/app-state.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { bundleLanded } from "../testing/side-bundles.js";
import { tasksControl } from "../testing/tasks-control.js";
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
/** The operator an ensure answers, wherever the account has Luke on. */
let ensured = AGENT_ID;
/** Every agent whose page was read, in order. */
let read: string[] = [];
/** Whether a read of the agent's page is held open until the test answers it with `answerHeld`. */
let holdPage = false;
/** Answers the read of the agent's page held open last. */
let answerHeld: () => void = () => undefined;
/** Every archive or Unarchive asked, as the act carried it. */
let archives: { agentId: string; archived: boolean }[] = [];
/** Whether an archive or Unarchive is refused, as an unanswered service refuses it. */
let archiveRefused = false;
/** Every agent a delete asked for, in order. */
let deletes: string[] = [];
/** Why a delete is refused, as the service answers it; none lets it land. */
let deleteRefused: CodingAgentCallFailure | undefined;
/** What the agent's workspace's members read answers; none refuses it. */
let members: readonly WorkspaceMember[] | undefined;
/** What the agent's transcript is pushed as once its tab follows it, and what a read of it answers once; none refuses it. */
let transcript: CodingAgentMessagesAnswerView | undefined;
/** The pages a transcript's stream pushes, then held open as a followed transcript stays. */
async function* streamOf(
  pages: readonly CodingAgentMessagesAnswerView[],
): AsyncGenerator<CodingAgentMessagesAnswerView> {
  yield* pages;
  await new Promise(() => undefined);
}
/** Every act the page told or asked, in order. */
let told: AnyAct[] = [];
/** What a read of what the agent published answers; none refuses it. */
let published: CodingAgentPullRequestAnswer | undefined;
/** How many of the pull request's conversation entries its read left on GitHub; none answers no read. */
let earlier = 0;
/** The owner of the fork the published pull request's head is pushed to; none for the base repository's own. */
let forkOwner: string | undefined;
/** What the window copied, in order. */
let copied: string[] = [];
/** What the workspace's list of agents answers, whatever it was asked. */
let workspace: readonly CodingAgentSummary[] = [];
/** The pull requests the workspace's GitHub App answers, by number; one it holds none for reads as none. */
let gitHub: ReadonlyMap<number, { title: string; url: string; state: PullRequestState }> =
  new Map();

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// Note that the terminal bundle is read here first, as the panel reads it once a
// terminal has opened, so the Mac terminal Run opens mounts within the test's own
// ticks rather than whenever a busy machine lets the import land.
beforeAll(() => Effect.runPromise(bundleLanded(SIDE_BUNDLES.terminal)));

/** What `standTerminalDocument` stood in, taken down once the page is gone. */
let takeDownTerminal: (() => void) | undefined;

beforeEach(() => {
  pages = [{ agent: PAGE }];
  ensured = AGENT_ID;
  read = [];
  holdPage = false;
  answerHeld = () => undefined;
  archives = [];
  archiveRefused = false;
  deletes = [];
  deleteRefused = undefined;
  members = undefined;
  transcript = undefined;
  told = [];
  published = undefined;
  earlier = 0;
  forkOwner = undefined;
  openedOnGitHub = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied), ...DESKTOP_LINKS, pageFrameUrl });
  workspace = [];
  gitHub = new Map();
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind === ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { automations: [SWEEP] },
        });
      }
      if (request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ) {
        return Promise.resolve(
          members === undefined
            ? { status: FAKE_ANSWER.REFUSED, reason: "Not here." }
            : { status: FAKE_ANSWER.DONE, value: members },
        );
      }
      told.push(request);
      if (request.kind === ACT_KIND.CODING_AGENTS_TRANSCRIPT) {
        const pages = transcript === undefined ? [] : [transcript];
        // SAFETY: the window reads oRPC's stream as an async iterator alone, which a generator is.
        const value = streamOf(pages) as unknown as PortActResult<
          typeof ACT_KIND.CODING_AGENTS_TRANSCRIPT
        >;
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
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
      if (request.kind === ACT_KIND.CODING_AGENTS_ARCHIVE) {
        archives.push(request.payload);
        // The agent answered is the one the page read, archived or brought back as asked.
        const shown = pages[0] !== undefined && "agent" in pages[0] ? pages[0].agent : PAGE;
        const { archivedAt: _archived, ...back } = shown;
        const answered = request.payload.archived ? { ...back, archivedAt: 3 } : back;
        // Archived or brought back, the agent is read so from then on.
        if (!archiveRefused) pages = [{ agent: answered }];
        const value = archiveRefused
          ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }
          : { agent: answered };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_DELETE) {
        deletes.push(request.payload.agentId);
        const value =
          deleteRefused === undefined ? { deleted: true as const } : { failure: deleteRefused };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_RENAME) {
        const shown = pages[0] !== undefined && "agent" in pages[0] ? pages[0].agent : PAGE;
        const value = { agent: { ...shown, title: request.payload.title } };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_MESSAGES && transcript !== undefined) {
        // Note that only the first read answers, because a read past the cursor waits on the service, and one answered at once would be read again without end.
        const value = transcript;
        transcript = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION && earlier > 0) {
        const value = { pullRequest: { reviewers: [], conversation: [], earlier } };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (
        request.kind === ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST &&
        published?.pullRequest != null
      ) {
        // Note that the overview is read from what the agent published, as the service reads both from one pull request.
        const { number, title, url, state } = published.pullRequest;
        const value = {
          pullRequest: {
            number,
            title,
            url,
            state,
            html: "",
            base: "main",
            head: published.branch ?? "main",
            ...(forkOwner === undefined ? undefined : { headOwner: forkOwner }),
            createdAt: 1,
            mergedAt: null,
            merge: MERGE_STATE.CLEAN,
            requested: [],
          },
        };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST && published !== undefined) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: published });
      }
      // Note that main starts and ends a run of this Mac's without a word back.
      if (
        request.kind === ACT_KIND.MAC_TERMINAL_OPEN ||
        request.kind === ACT_KIND.MAC_TERMINAL_CLOSE
      ) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.GITHUB_OPEN) {
        openedOnGitHub.push(request.payload.url);
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: undefined });
      }
      if (request.kind === ACT_KIND.TASKS_PULL_REQUEST) {
        const { number } = request.payload;
        const held = gitHub.get(number);
        const value = held === undefined ? null : { number, author: "octo-dev", ...held };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_START) {
        const value = {
          agent: { ...PAGE, id: STARTED_ID, status: CODING_AGENT_STATUS.STARTING },
        };
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      // Note that the page's agent is the account's operator, Luke, wherever the account has him on.
      if (request.kind === ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agentId: ensured } });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_WORKSPACE_LIST) {
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { agents: workspace } });
      }
      // Only the task the agents here stand on holds a page; an agent's own pages hold none.
      if (request.kind === ACT_KIND.TASKS_PAGES) {
        const onTask = "taskId" in request.payload && request.payload.taskId === PAGE_TASK;
        return Promise.resolve({
          status: FAKE_ANSWER.DONE,
          value: { pages: onTask ? [FUNNEL] : [] },
        });
      }
      if (request.kind === ACT_KIND.CODING_AGENTS_PAGE) {
        read.push(request.payload.agentId);
        const value = pages.length > 1 ? pages.shift() : pages[0];
        if (holdPage) {
          return new Promise((resolve) => {
            answerHeld = () => resolve({ status: FAKE_ANSWER.DONE, value });
          });
        }
        return Promise.resolve({ status: FAKE_ANSWER.DONE, value });
      }
      return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
    },
  });
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  takeDownTerminal?.();
  takeDownTerminal = undefined;
});

/** The page of the agent, standing in the task's place, as the window's tasks control holds it, its atoms held by `registry`. */
function mount(
  tasks: TasksControl = tasksControl({}),
  openLink?: (link: ReadLink) => void,
  away?: { label: string; onPress: () => void },
  registry = AtomRegistry.make(),
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const page = createElement(DesktopAgentPage, { tasks, agentId: AGENT_ID, away });
  act(() =>
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
    status: CODING_AGENT_STATUS.COMPLETED,
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

  const starts = told.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_START);
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
    status: CODING_AGENT_STATUS.COMPLETED,
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
  pages = [
    {
      agent: {
        ...PAGE,
        continuedBy: [
          { agentId: STARTED_ID, title: "Try the cron", forked: true, messageId: "answer" },
        ],
      },
    },
  ];
  transcript = {
    messages: [
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

/** The agent's page in a phone's room, over the window's own side panel, which stands only full screen. */
function PhonePanelPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(
    undefined,
    { id: AGENT_ID, holds: {} },
    agents,
    [],
    [],
    [],
    agents,
    SHELL_ROOM.NARROW,
  );
  drawnPanel = sidePanel;
  return createElement(
    ShellRoomContext.Provider,
    { value: SHELL_ROOM.NARROW },
    createElement(DesktopAgentPage, {
      tasks: { ...tasksControl({}), sidePanel },
      agentId: AGENT_ID,
      away: { label: "Inbox", onPress: () => undefined },
    }),
  );
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
    [],
    [FUNNEL.id],
    agents,
  );
  drawnPanel = sidePanel;
  const base = tasksControl({});
  return createElement(DesktopAgentPage, {
    tasks: {
      ...base,
      sidePanel,
      agentView: { ...base.agentView, agentId: AGENT_ID, pages: [FUNNEL] },
    },
    agentId: AGENT_ID,
  });
}

test("the panel beside an agent's page offers the pages the agent showed on itself under its +, and one picked opens in a page tab drawn from the agent's own address, as a task's opens beside its plan", async () => {
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PagesPage))));
  await settle();
  act(() => drawnPanel?.onToggle());
  await settle();

  const panel = container.querySelector("aside.side-panel") ?? assert.fail("the panel shows");
  const well = panel.querySelector(".side-panel-no-tabs") ?? assert.fail("the empty panel offers");
  assert.deepEqual(
    [...well.querySelectorAll("ul")].map((each) => each.getAttribute("aria-label")),
    ["Pages", "Terminal"],
  );
  const row =
    [...well.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      (each.textContent ?? "").includes(FUNNEL.title),
    ) ?? assert.fail("the empty panel offers the agent's page");
  act(() => row.click());
  await settle();

  assert.ok(
    [...panel.querySelectorAll("[role='tab']")].some((tab) =>
      (tab.textContent ?? "").includes(FUNNEL.title),
    ),
    "the page's tab stands in the panel",
  );
  assert.equal(
    panel.querySelector<HTMLIFrameElement>(".page-view iframe")?.getAttribute("src"),
    `luke-page://page/agent/${AGENT_ID}/${FUNNEL.id}/${FUNNEL.version}`,
  );
});

test("the row of a page the agent showed opens it in the panel beside the agent's page", async () => {
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const chosen: unknown[] = [];
  const tasks = tasksControl({});
  const page = mount({
    ...tasks,
    sidePanel: { ...tasks.sidePanel, onChoose: (tab) => chosen.push(tab) },
  });
  await settle();

  const row =
    [...page.querySelectorAll<HTMLButtonElement>(".desktop-agent button")].find((each) =>
      (each.textContent ?? "").includes(FUNNEL.title),
    ) ?? assert.fail("the call's row names the page it showed");
  act(() => row.click());

  assert.deepEqual(chosen, [{ page: FUNNEL.id }]);
});

test("the row of a page an agent on a task showed hangs the page's card, read from the task the page stands on", async () => {
  pages = [{ agent: { ...PAGE, planId: PAGE_TASK } }];
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount();
  await settle();

  const row =
    [...page.querySelectorAll<HTMLButtonElement>(".desktop-agent button")].find((each) =>
      (each.textContent ?? "").includes(FUNNEL.title),
    ) ?? assert.fail("the call's row names the page it showed");
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(row);
  await settle();

  const card = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, FUNNEL.title);
  assert.equal(
    card?.querySelector(".luke-page-thumb-frame")?.getAttribute("src"),
    pageFrameUrl({ taskId: PAGE_TASK, pageId: FUNNEL.id, version: 2 }),
    "the preview is the task's page",
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
  const offered = [...document.querySelectorAll(".luke-searchable-menu [role='option']")].map(
    (each) => each.textContent,
  );
  const headings = [...document.querySelectorAll(".luke-searchable-menu [role='group']")].map(
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
  const shown = container.querySelector("aside.side-panel") ?? assert.fail("the toggle shows it");
  const well = shown.querySelector(".side-panel-no-tabs") ?? assert.fail("the empty panel offers");
  const rows = [...well.querySelectorAll<HTMLButtonElement>("button")];
  assert.deepEqual(
    rows.map((each) => each.textContent),
    offered,
  );
  assert.deepEqual(
    [...well.querySelectorAll("ul")].map((each) => each.getAttribute("aria-label")),
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const container = await mountPanelPage();
  await settle();
  const chip = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".agent-page [data-mention-ref]")].find(
      (each) => each.querySelector(".luke-inline-ref-label")?.textContent?.includes(name),
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
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
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
    status: CODING_AGENT_STATUS.RUNNING,
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
  const chip = page.querySelector<HTMLButtonElement>("button[data-skill-ref]");
  assert.ok(chip, "the skill is its chip");
  act(() => chip.click());

  assert.deepEqual(
    told.filter((each) => each.kind === ACT_KIND.GITHUB_OPEN).map((each) => each.payload),
    [{ url: "https://github.com/acme/relay/blob/HEAD/.agents/skills/release/SKILL.md" }],
  );
});

test("until the agent is read, the page stands in an agent tab's own shape saying Reading, and gives way to the agent once read", async () => {
  holdPage = true;
  const page = mount();
  await settle();

  const wait = page.querySelector('.agent-page [role="status"]');
  assert.equal(wait?.textContent, "Reading the agent");
  assert.ok(wait.closest(".agent-tab"), "the wait stands in the tab's own frame");
  assert.ok(
    page.querySelector(".agent-page .agent-tab-foot .luke-skeleton"),
    "the composer's card stands under the log",
  );
  assert.equal(page.querySelector(".agent-page .luke-spinner-region"), null);
  assert.equal(page.querySelector("h1"), null);
  answerHeld();
  await settle();
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the flaky tests");
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

test("on a phone an agent that is not found still leads with its way back", async () => {
  pages = [{ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }];
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

  const sender = page.querySelector(
    ".is-user:not(.agent-origin) .luke-message-line-sender [data-actor-ref]",
  );
  assert.equal(sender?.querySelector(".luke-inline-ref-label")?.textContent, "Charles Pan");
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
  return { card, sender: card.querySelector<HTMLElement>(".luke-message-line-sender") };
}

test("an automation's agent opens on the automation's prompt alone, sent by the automation, whose name opens its page", async () => {
  pages = [{ agent: RUN_PAGE }];
  transcript = handedTranscript();
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
  assert.doesNotMatch(card.textContent ?? "", /Luke started this run/u);
  act(() => automation?.click());

  assert.deepEqual(opened, [{ kind: "edit", automationId: SWEEP.id }]);
});

test("a deleted automation's agent still names it, plainly, with nothing to open", async () => {
  pages = [{ agent: { ...RUN_PAGE, automationId: null } }];
  transcript = handedTranscript();
  const page = mount(tasksControl({ workspaces: [ACME] }));
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep (deleted)");
  assert.equal(sender?.querySelector("button"), null, "nothing opens it");
});

test("a GitHub event's run names its pull request beside the automation, which opens in a Pull request tab beside the page by its number, and a run now names who ran it", async () => {
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
  const chosen: unknown[] = [];
  const base = tasksControl({ me: "user-dean" });
  const page = mount({
    ...base,
    sidePanel: { ...base.sidePanel, onPreview: (tab) => chosen.push(tab) },
  });
  await settle();

  const { sender } = origin(page);
  assert.equal(words(sender), "Flaky-test sweep · pull request #2905 View commands · Run by you");
  act(() => sender?.querySelector<HTMLElement>("[data-mention-ref]")?.click());
  await settle();
  assert.deepEqual(openedOnGitHub, [], "nothing opened on GitHub");
  assert.deepEqual(chosen, [{ changes: AGENT_ID, number: 2905 }]);
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

  const chip = origin(page).sender?.querySelector<HTMLElement>("[data-mention-ref]");
  assert.deepEqual(
    [
      chip?.querySelector(".luke-inline-ref-label")?.textContent,
      chip?.querySelector(".luke-inline-ref-state")?.textContent,
      chip?.querySelector<SVGElement>("[data-pull-request-mark]")?.dataset.pullRequestState,
    ],
    ["#2905 View commands", "Open", PULL_REQUEST_STATE.OPEN],
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

/** Opens the page's ⋯ and answers the item under `label`, or fails saying it is not offered. */
function pageMenuItem(page: HTMLElement, label: string): HTMLButtonElement {
  const more =
    page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]') ??
    assert.fail("the page's toolbar has a ⋯");
  act(() => more.click());
  return (
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`the ⋯ offers ${label}`)
  );
}

test("the page's ⋯ offers what a task's agent's tab ⋯ does: Rename, Show terminal, Copy link, the transcript's two copies, Archive, and Permanently delete last, and no Run, which its Pull request tab offers", async () => {
  const page = mount();
  await settle();
  const more = page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]');
  assert.ok(more);
  act(() => more.click());

  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.deepEqual(offered, [
    "Rename",
    "Show terminal⌘J",
    "Copy link",
    "Copy concise transcript",
    "Copy full transcript",
    "Archive",
    "Permanently delete",
  ]);
});

test("Luke's page is titled Luke, and its ⋯ offers neither Rename, Archive, nor Permanently delete", async () => {
  handState(experimentsOn(EXPERIMENT.OPERATOR), {
    run: { ...stateWith({}, {}).run, capabilities: DESKTOP_CAPABILITIES },
  });
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const more = page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]');
  assert.ok(more);
  act(() => more.click());

  assert.equal(page.querySelector("h1")?.textContent, "Luke");
  assert.deepEqual(
    [...document.querySelectorAll('[role="menuitem"]')].map((each) => each.textContent),
    ["Show terminal⌘J", "Copy link", "Copy concise transcript", "Copy full transcript"],
  );
});

test("a Luke a Reset retired is still known by his kind: titled Luke, offering neither Rename, Unarchive, nor Permanently delete", async () => {
  pages = [{ agent: { ...PAGE, kind: CODING_AGENT_KIND.OPERATOR, archivedAt: 2 } }];
  ensured = "0e9d8c7b-0000-4000-8000-0000000000ff";
  handState(experimentsOn(EXPERIMENT.OPERATOR), {
    run: { ...stateWith({}, {}).run, capabilities: DESKTOP_CAPABILITIES },
  });
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const more = page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]');
  assert.ok(more);
  act(() => more.click());

  assert.equal(page.querySelector("h1")?.textContent, "Luke");
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (each) => each.textContent,
  );
  assert.ok(!offered.includes("Rename"));
  assert.ok(!offered.includes("Unarchive"));
  assert.ok(!offered.includes("Permanently delete"));
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
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
  const { page, chosen } = mountHearingPanel();
  await settle();
  const more =
    page.querySelector<HTMLButtonElement>('[aria-label="Agent actions"]') ??
    assert.fail("the page's toolbar has a ⋯");
  act(() => more.click());
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

/**
 * Stands in what a Mac terminal tab's surface reads from the window and jsdom
 * has not, constructed sheets and media queries (as `mac-terminal-tab.test.ts`
 * does), so the terminal Run opens mounts; answers the way to take them down
 * again, which waits for the page to go.
 */
function standTerminalDocument(): () => void {
  const sheets = Object.getOwnPropertyDescriptor(document, "adoptedStyleSheets");
  const media = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [],
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  return () => {
    if (sheets === undefined) Reflect.deleteProperty(document, "adoptedStyleSheets");
    else Object.defineProperty(document, "adoptedStyleSheets", sheets);
    if (media === undefined) Reflect.deleteProperty(window, "matchMedia");
    else Object.defineProperty(window, "matchMedia", media);
  };
}

test("Run in the header of the agent's Pull request tab runs its branch on this Mac in the side panel, from its own repository", async () => {
  takeDownTerminal = standTerminalDocument();
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
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
  await settle();
  const row =
    container.querySelector<HTMLButtonElement>(
      '.agent-tab-foot [aria-label="Pull request"] li > button',
    ) ?? assert.fail("the pull request's row stands over the box");
  act(() => row.click());
  await settle();

  const run =
    container.querySelector<HTMLButtonElement>(
      'aside.side-panel .pull-request-title-actions button[aria-label="Run on this Mac"]',
    ) ?? assert.fail("the Pull request tab's header offers Run");
  assert.equal(run.textContent, "Run");
  act(() => run.click());
  await settle();

  const tab = drawnPanel?.tab;
  assert.ok(tab !== undefined && isMacTerminalTab(tab), "Run shows a Mac terminal");
  assert.equal(tab.macTerminal, AGENT_ID);
  assert.equal(tab.repository, PAGE.repository);
});

test("Run in the header of a Pull request tab opened by its number runs that pull request's branch, not the agent's own", async () => {
  takeDownTerminal = standTerminalDocument();
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
  published = {
    repository: "acme/relay",
    branch: "luke/view-commands",
    pullRequest: {
      number: 2905,
      title: "View commands",
      url: "https://github.com/acme/relay/pull/2905",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 5,
      deletions: 2,
      changedFiles: 2,
    },
  };
  await mountPanelPage();
  // Note that a link to another pull request opens its tab by number, as the Inbox's and a mention's do.
  act(() => drawnPanel?.onChoose({ changes: AGENT_ID, number: 2905 }));
  await settle();

  const run =
    document.querySelector<HTMLButtonElement>(
      'aside.side-panel .pull-request-title-actions button[aria-label="Run on this Mac"]',
    ) ?? assert.fail("the numbered Pull request tab's header offers Run");
  act(() => run.click());
  await settle();

  const tab = drawnPanel?.tab;
  assert.ok(tab !== undefined && isMacTerminalTab(tab), "Run shows a Mac terminal");
  assert.equal(tab.macTerminal, AGENT_ID);
  assert.equal(tab.number, 2905);
});

/** Runs the agent's pushed branch on this Mac from the Pull request tab's header, which shows the run's Mac terminal tab. */
/** The agent has pushed a branch, which its pull request tab reads. */
function pushBranch(): void {
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
}

async function runOnThisMac(): Promise<void> {
  takeDownTerminal = standTerminalDocument();
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
  pushBranch();
  const container = await mountPanelPage();
  await settle();
  const row =
    container.querySelector<HTMLButtonElement>(
      '.agent-tab-foot [aria-label="Pull request"] li > button',
    ) ?? assert.fail("the pull request's row stands over the box");
  act(() => row.click());
  await settle();
  const run =
    container.querySelector<HTMLButtonElement>(
      'aside.side-panel .pull-request-title-actions button[aria-label="Run on this Mac"]',
    ) ?? assert.fail("the Pull request tab's header offers Run");
  act(() => run.click());
  await settle();
}

/** Hands the run's tab a port, as main does after an open, and answers what it can say on it. */
async function postRunPort(): Promise<(message: MacTerminalPortOutbound) => void> {
  const { port1: port } = new MessageChannel();
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: MAC_TERMINAL_PORT_CHANNEL, ticket: { agentId: AGENT_ID } },
        source: window,
        ports: [port],
      }),
    );
  });
  await settle();
  return (message) => act(() => port.onmessage?.(new MessageEvent("message", { data: message })));
}

/** The × on the Mac terminal's tab in the strip. */
function macTerminalClose(): HTMLButtonElement {
  return (
    document.querySelector<HTMLButtonElement>(
      `aside.side-panel button[aria-label="Close ${TAB_WORDS.MAC_TERMINAL}"]`,
    ) ?? assert.fail("the Mac terminal's tab has a ×")
  );
}

/** The question standing over the window, as its words and its answer buttons. */
function questionStanding() {
  const dialog = document.querySelector('[role="alertdialog"]');
  return {
    words: dialog?.textContent ?? "",
    press: async (verb: string) => {
      const button = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (each) => each.textContent === verb,
      );
      assert.ok(button, `the question offers ${verb}`);
      await act(async () => button.click());
      await settle();
    },
  };
}

test("closing a Mac terminal's tab while its run is going asks first, and Cancel leaves it open", async () => {
  await runOnThisMac();
  await postRunPort();
  assert.ok(isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "Run shows a Mac terminal");

  act(() => macTerminalClose().click());
  await settle();

  const question = questionStanding();
  assert.match(question.words, /Close this terminal\?.*What's running in it ends\./u);
  assert.ok(
    isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN),
    "nothing is closed before the answer",
  );
  await question.press("Cancel");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.ok(isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "Cancel leaves it open");

  act(() => macTerminalClose().click());
  await settle();
  await questionStanding().press("Close");
  assert.ok(!isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "the answer closes the tab");
});

test("on a phone, Close in the panel header asks first while the run is going, as the strip's × does", async () => {
  takeDownTerminal = standTerminalDocument();
  pushBranch();
  localStorage.clear();
  installScrollIntoView();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(PhonePanelPage))));
  await settle();
  act(() => drawnPanel?.onChoose({ macTerminal: AGENT_ID, repository: "acme/relay", asked: 1 }));
  await settle();
  await postRunPort();
  assert.ok(isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "the Mac terminal is shown");

  const more =
    container.querySelector<HTMLButtonElement>('[aria-label="Panel actions"]') ??
    assert.fail("the panel's header has a ⋯");
  act(() => more.click());
  const close = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
    each.textContent?.startsWith("Close"),
  );
  assert.ok(close, "the ⋯ offers Close");
  act(() => close.click());
  await settle();

  assert.match(questionStanding().words, /Close this terminal\?/u);
  assert.ok(isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "nothing is closed unasked");
});

test("closing a Mac terminal's tab once its run has ended asks nothing", async () => {
  await runOnThisMac();
  const say = await postRunPort();
  say({ type: MAC_TERMINAL_PORT_MESSAGE.EXIT, code: 0 });

  act(() => macTerminalClose().click());
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "no question stands");
  assert.ok(!isMacTerminalTab(drawnPanel?.tab ?? SIDE_PANEL_TAB.PLAN), "the tab closed at once");
});

test("a fork's Pull request tab offers no Run, since its head's branch name would be read from the base repository", async () => {
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
  published = {
    repository: "acme/relay",
    branch: "main",
    pullRequest: {
      number: 2907,
      title: "Contributed fix",
      url: "https://github.com/acme/relay/pull/2907",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 1,
      deletions: 1,
      changedFiles: 1,
    },
  };
  forkOwner = "contributor";
  await mountPanelPage();
  act(() => drawnPanel?.onChoose({ changes: AGENT_ID, number: 2907 }));
  await settle();

  assert.ok(
    document.querySelector("aside.side-panel .pull-request-title-actions"),
    "the fork's Pull request tab draws its header",
  );
  assert.equal(
    document.querySelector('aside.side-panel button[aria-label="Run on this Mac"]'),
    null,
    "no Run on a fork's pull request",
  );
});

test("Archive on the page's ⋯ reads an agent at rest again and archives it unasked, its composer giving way to Unarchive", async () => {
  const page = mount();
  await settle();
  const archive = pageMenuItem(page, "Archive");
  await act(async () => archive.click());
  await settle();

  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing was asked");
  assert.ok(
    [...page.querySelectorAll("button")].some((each) => each.textContent === "Unarchive"),
    "the archived agent offers Unarchive",
  );
});

test("Archive on the page's ⋯ archives the reader's own agent at once while it works, asking nothing", async () => {
  pages = [{ agent: { ...PAGE, status: CODING_AGENT_STATUS.RUNNING } }];
  const page = mount();
  await settle();
  const archive = pageMenuItem(page, "Archive");
  await act(async () => archive.click());
  await settle();

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing was asked");
  assert.deepEqual(archives, [{ agentId: AGENT_ID, archived: true }]);
});

test("an archived agent's ⋯ offers Unarchive in Archive's place, and no Rename", async () => {
  pages = [{ agent: { ...PAGE, archivedAt: 2 } }];
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
  pages = [{ agent: RUN_PAGE }];
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
    told.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_RENAME).map((each) => each.payload),
    [{ agentId: AGENT_ID, title: "Sweep the slow tests" }],
  );
  assert.equal(page.querySelector("h1")?.textContent, "Sweep the slow tests");
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
          status: CODING_AGENT_STATUS.COMPLETED,
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
          row.querySelector(".luke-combobox-option-label")?.textContent,
          row.querySelector(".luke-combobox-option-detail")?.textContent,
        ]),
        [["Bill by seat", "Billing · Archived"]],
      );
    }),
);

it.effect(
  "an agent working in no repository, as Luke does, still takes an @ in its box, which offers the workspace's agents",
  () =>
    Effect.gen(function* () {
      installEditorLayout();
      installScrollIntoView();
      pages = [{ agent: { ...PAGE, repository: null } }];
      workspace = [
        {
          id: "3c3c3c3c-0000-4000-8000-000000000000",
          planId: null,
          model: PAGE.model,
          effort: PAGE.effort,
          title: "Bill by seat",
          createdAt: 1,
          status: CODING_AGENT_STATUS.COMPLETED,
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
        rows.map((row) => row.querySelector(".luke-combobox-option-label")?.textContent),
        ["Bill by seat"],
      );
    }),
);

test("on the page of an agent working in no repository, a GitHub page of a file or a folder in its words is that file's or folder's chip, of the repository its address names, and opens on GitHub", async () => {
  pages = [{ agent: { ...PAGE, repository: null } }];
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const chips = [...page.querySelectorAll<HTMLElement>(".agent-page [data-mention-ref]")];

  assert.deepEqual(
    chips.map((chip) => [
      chip.dataset.kind,
      chip.querySelector(".luke-inline-ref-label")?.textContent,
    ]),
    [
      ["file", "store.ts"],
      ["folder", "src"],
    ],
  );
  const [fileChip, folderChip] = chips;
  assert.ok(fileChip && folderChip);
  restOn(fileChip);
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".luke-hover-card-name")?.textContent,
      card?.querySelector(".luke-hover-card-sub")?.textContent,
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
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  };
  const page = mount(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();
  const chips = [...page.querySelectorAll(".agent-page [data-mention-ref]")];
  assert.equal(chips.length, 2, "the pull request and its files are chips");

  for (const chip of chips) {
    restOn(chip);
    const card = [...document.querySelectorAll(".luke-tooltip-card .luke-hover-card")].at(-1);
    assert.equal(card?.hasAttribute("data-tab-card"), true, "the card is its tab's");
    assert.equal(
      card?.querySelector(".luke-hover-card-name")?.textContent,
      "Await the payment mock",
    );
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

  const remove = pageMenuItem(page, "Permanently delete");
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

  await act(async () => dialogAnswer("Permanently delete").click());
  await settle();

  assert.deepEqual(deletes, [AGENT_ID]);
  assert.equal(newestToastSays(), "Agent deleted");
  assert.equal(closed, 1, "the page is left");
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a delete the service refused for an agent still starting says why in the dialog, which stays, and leaves the page standing", async () => {
  deleteRefused = CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY;
  let closed = 0;
  const agentView = { agentId: AGENT_ID, onOpen: () => undefined, onClose: () => (closed += 1) };
  const page = mount(tasksControl({ agentView }));
  await settle();

  const remove = pageMenuItem(page, "Permanently delete");
  act(() => remove.click());
  await act(async () => dialogAnswer("Permanently delete").click());
  await settle();

  assert.deepEqual(deletes, [AGENT_ID]);
  const reason = document.querySelector(
    '[role="alertdialog"] [data-slot="field-error"]:not(:empty)',
  );
  assert.equal(reason?.textContent, "The agent is still starting its turn. Try again in a moment.");
  assert.equal(closed, 0);
});

test("the page offers Call in its agent's composer, whose press asks for a call into that agent on no task, and an agent on a task on its own", async () => {
  handState({}, { settings: appSettingsWire(settingsView({ voiceAvailable: true })) });
  const pressed: { agentId: string; place: AgentCallPlace }[] = [];
  const calls = {
    onPress: (agentId: string, place: AgentCallPlace) => pressed.push({ agentId, place }),
  };
  const page = mount(tasksControl({ calls }));
  await settle();

  const call = page.querySelector<HTMLButtonElement>(`button[aria-label="${CALL_LABEL}"]`);
  assert.ok(call, "the composer offers Call");
  act(() => call.click());
  assert.deepEqual(pressed, [{ agentId: AGENT_ID, place: { taskId: undefined, archived: false } }]);

  act(() => root?.unmount());
  pages = [{ agent: { ...PAGE, planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" } }];
  const onTask = mount(tasksControl({ calls }));
  await settle();
  act(() => onTask.querySelector<HTMLButtonElement>(`button[aria-label="${CALL_LABEL}"]`)?.click());
  assert.deepEqual(pressed.at(-1), {
    agentId: AGENT_ID,
    place: { taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", archived: false },
  });
});

test("a window with no voice hands the page no Call", async () => {
  handState({}, { settings: appSettingsWire(settingsView({ voiceAvailable: true })) });
  const page = mount(tasksControl({ calls: undefined }));
  await settle();
  assert.equal(page.querySelector(`button[aria-label="${CALL_LABEL}"]`), null);
});

/** The page of an agent a call into, with no task, showed code on, over the window's own side panel. */
function CodePanelPage(): React.JSX.Element {
  const agents = [AGENT_ID];
  const sidePanel = useSidePanel(
    undefined,
    { id: AGENT_ID, holds: { [SIDE_PANEL_TAB.CODE]: true } },
    agents,
    [],
    [],
    [],
    agents,
  );
  drawnPanel = sidePanel;
  const showing = {
    callId: "call-1",
    turnId: "turn-1",
    shownAt: 10,
    agentId: AGENT_ID,
    code: {
      ref: { path: "src/relay.ts", startLine: 1, endLine: 1 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 1,
      lines: ["const retries = 3;"],
    },
  };
  return createElement(DesktopAgentPage, {
    tasks: {
      ...tasksControl({
        agentCallCode: { agentId: AGENT_ID, shownCode: [showing] },
      }),
      sidePanel,
    },
    agentId: AGENT_ID,
  });
}

test("code Luke showed on a call into the agent with no task stands in its page's side panel, in its Code tab", async () => {
  localStorage.clear();
  installScrollIntoView();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(CodePanelPage))));
  await settle();
  act(() => drawnPanel?.onChoose(SIDE_PANEL_TAB.CODE));
  await settle();

  const panel = container.querySelector("aside.side-panel");
  assert.ok(panel, "the panel stands beside the page");
  assert.match(panel.textContent ?? "", /src\/relay\.ts/u);
  // No File tab reads a repository no task names, so the card offers no way into one.
  assert.ok(panel.querySelector(".luke-code-card"), "the code's card stands");
  assert.equal(panel.querySelector(".luke-code-card [aria-label^='Open ']"), null);
});

test("on a phone the page is headed by its way back's glyph, the agent's name centred, and its one ⋯, which offers the panel the title bar's toggle offered", async () => {
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
  assert.ok(pageMenuItem(page, "Show panel"), "the ⋯ offers the panel");
  act(() => head.querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(left, ["away"], "the way back goes where the shell says");
});
