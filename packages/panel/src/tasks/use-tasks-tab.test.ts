// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_CALL_FAILURE } from "@luke/features/agent-view";
import {
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import {
  LINK_PLACE,
  type LinkPlace,
  PULL_REQUEST_THREAD_VIEW,
  type PullRequestThreadView,
} from "@luke/features/link-grammar";
import { MENTION_KIND } from "@luke/features/mention-link";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import { PLAN_ACTOR, TASK_PRIORITY, TASK_STATUS, type Task } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksView,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { type AppInboxTask, type AppInboxTaskHolding, RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { timeRuntime } from "@luke/ui";
import { memoryHistory } from "@luke/ui/history-adapter";
import { DOCUMENT_REGION, SETTLED_STATUS, TASKS_PAGE } from "@luke/ui/tasks-model";
import { Clock, Context, Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as AtomRegistryModule from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { type ActHandle, KEPT, type Kept } from "../act.js";
import {
  installWindowHistory,
  useWindowHistory,
  type WindowHistoryLists,
} from "../navigation-history.js";
import {
  installPanelSpanRecorder,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
  type PanelSpan,
} from "../panel-spans.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { FAKE_ANSWER, fakeActPort, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handHostReads, handState, holdPages } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { FIXTURE_AGENT_ID } from "./agent-fixture.js";
import { NEW_TASK_PURPOSE } from "./new-task-purpose.js";
import { ofPullRequestTab } from "./pull-request-number.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { loadTasksFixture } from "./tasks-fixture-loader.js";
import { type ChannelPlaceControl, useChannelPlace, useInboxTask } from "./use-channels.js";
import { MAIN_TAB } from "./use-main-tabs.js";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB } from "./use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type LeaveAsk,
  type TasksControl,
  useLeaveGuard,
  useTasksTab,
} from "./use-tasks-tab.js";

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OPEN: TasksView = {
  tasks: [],
  listStatus: TASKS_READ.READY,
  workspaces: [],
  activeTaskId: TASK.id,
  document: { status: TASKS_READ.READY, task: TASK },
};
/** The shown act's payload, read back as the act's own schema admits it. */
const readShown = Schema.decodeUnknownOption(
  Schema.Struct({
    agentId: Schema.NullOr(Schema.String),
  }),
);

interface Standing {
  shown: boolean;
  tasks: TasksView;
  profile: string;
  fixtureMode: boolean;
  unseenAgents: readonly string[];
  inboxWaiting: readonly AppInboxTask[];
  inboxTasks: readonly AppInboxTaskHolding[];
  /** Whether an account is signed in to the window. */
  signedIn: boolean;
  /** The signed-in account's email. */
  account: string;
  /** The room the panel's stage gives. */
  room: ShellRoom;
  /** Whether the window's history stands over the tab, as the panel's root keeps it. */
  history: boolean;
}

/**
 * Mounts the hook alone over what the panel would hand it, keeping every act
 * it told, in order; `answers` answers the acts it names, an act-port kind
 * among them. A press is answered and kept as an asked act is, and stays
 * quiet, unless `press` hands the window's own press door, which goes out on
 * the act port the test installed.
 */
function mount(
  initial: Partial<Standing> = {},
  answers: { [Kind in PortActKind]?: (...args: unknown[]) => Promise<PortActResult<Kind>> } = {},
  registry?: AtomRegistry,
  press?: ActHandle["press"],
) {
  const told: PortActKind[] = [];
  /** The coding-agent acts, kept apart: they are the agents' own and no task press tells them. */
  const agentActs: PortActKind[] = [];
  /** Which agent's tab main was told is shown, each time it was told. */
  const shownAgents: (string | null)[] = [];
  /** Each asked act's payload, unread until a test reads it as the act's schema would. */
  const payloads: { readonly kind: PortActKind; readonly payload: unknown }[] = [];
  const links: SettingsLink[] = [];
  const record = (kind: PortActKind) => {
    if (!kind.startsWith("agents.")) told.push(kind);
    else agentActs.push(kind);
  };
  let control: TasksControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  let standing: Standing = {
    shown: false,
    tasks: IDLE_TASKS_VIEW,
    profile: RUN_PROFILE.IDLE,
    fixtureMode: false,
    unseenAgents: [],
    inboxWaiting: [],
    inboxTasks: [],
    signedIn: true,
    account: "dev@example.com",
    room: SHELL_ROOM.WIDE,
    history: false,
    ...initial,
  };
  let windowHistory: WindowHistoryLists | undefined;
  if (standing.history) {
    fakeAppPlatform(QUIET_PANEL);
    installWindowHistory(memoryHistory());
  }
  /** The window's history over the tab, as the panel's root keeps it, on the room the tab stands in. */
  function WindowHistoryProbe({ tasks, room }: { tasks: TasksControl; room: ShellRoom }) {
    windowHistory = useWindowHistory({
      known: true,
      link: undefined,
      tab: PANEL_TAB.TASKS,
      onTabChange: () => undefined,
      settingsView: SETTINGS_VIEW.ACCOUNT,
      onSettingsViewChange: () => undefined,
      settingsListed: true,
      onSettingsList: () => undefined,
      room,
      tasks,
    });
    return null;
  }
  /** An act-port kind's answer as the test gives it, recorded, or a rejection where it gives none. */
  function portAnswer<Kind extends PortActKind>(
    kind: Kind,
    ...args: unknown[]
  ): Promise<PortActResult<Kind>> {
    record(kind);
    payloads.push({ kind, payload: args[0] });
    const answer = answers[kind];
    if (answer !== undefined) return answer(...args);
    return Promise.reject(new Error("Not answered in this test."));
  }
  function Probe() {
    const [held, setHeld] = useState(standing);
    restand = setHeld;
    control = useTasksTab({
      acts: {
        // A kind the test does not answer is recorded and refused.
        // SAFETY: each kind is answered by its own procedure's answer, the dispatch on the kind the one erasure.
        act: (<Kind extends PortActKind>(kind: Kind, ...args: unknown[]) =>
          portAnswer(kind, ...args)) as ActHandle["act"],
        // SAFETY: a pressed kind is recorded as an asked one is, the dispatch on the kind the one erasure.
        press:
          press ??
          (((kind: PortActKind, ...args: unknown[]) =>
            portAnswer(kind, ...args).then(
              () => undefined,
              () => undefined,
            )) as ActHandle["press"]),
        // A told port kind is answered as an asked one is, recorded there, its answer or refusal read by no one, as `tell` reads none.
        // SAFETY: a told kind is recorded as an asked one is, the dispatch on the kind the one erasure.
        tell: ((kind: PortActKind, ...args: unknown[]) => {
          void portAnswer(kind, ...args).catch(() => undefined);
          // The one told payload the tests read, parsed as the boundary would.
          const shown = Option.getOrUndefined(readShown(args[0]));
          if (kind === ACT_KIND.AGENTS_SHOWN && shown !== undefined) {
            shownAgents.push(shown.agentId);
          }
        }) as ActHandle["tell"],
      },
      tasks: held.tasks,
      run: { fixtureMode: held.fixtureMode, profile: held.profile },
      signedIn: held.signedIn,
      account: held.signedIn ? held.account : undefined,
      shown: held.shown,
      unseenAgents: held.unseenAgents,
      inboxWaiting: held.inboxWaiting,
      inboxTasks: held.inboxTasks,
      inboxTaskless: [],
      inboxAgents: [],
      failedRuns: [],
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onOpenSettings: (link) => links.push(link),
      leaveGuard: useLeaveGuard(),
      room: held.room,
    });
    return held.history
      ? createElement(WindowHistoryProbe, { tasks: control, room: held.room })
      : null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  // The window's toast stands beside the tab, as the app draws it.
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(registry === undefined ? surface : onRegistry(registry, surface));
  });
  return {
    told,
    agentActs,
    shownAgents,
    payloads,
    /** Every Settings link the tab followed, in order. */
    links,
    control: () => {
      assert.ok(control);
      return control;
    },
    /** The window's history, where the tab was mounted with one. */
    history: () => windowHistory ?? assert.fail("the window's history stands"),
    stand: (patch: Partial<Standing>) => {
      standing = { ...standing, ...patch };
      act(() => restand?.(standing));
    },
  };
}

/**
 * Every root a test mounted. Note that each is unmounted inside `act` before
 * its page is cleared, because a root left standing keeps React's scheduler
 * working after the file ends, and its next tick, landing after the
 * environment is torn down, throws `window is not defined` outside any test.
 */
const roots: Root[] = [];

/** Takes down every tab mounted so far and clears the page: the window closed, as a quit or the test's end leaves it. */
function closeWindow(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

afterEach(() => {
  closeWindow();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lets the clipboard's answer, and the redraw it causes, land with no time passing. */
const landed = Effect.promise(settle);

/** Advances the clock the toast's hold waits on, then lets what fell due land. */
const _advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), landed);

/** The newest toast's Undo. */
function _undoButton(): HTMLButtonElement {
  const undo = newestToastAction();
  assert.ok(undo, "no Undo on the toast");
  assert.equal(undo.textContent, "Undo");
  return undo;
}

/** A task with a history: Luke wrote it on a call, over a first version. */
const _EDITED: TasksView = {
  ...OPEN,
  document: {
    status: TASKS_READ.READY,
    task: { ...TASK, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: false } },
  },
};

/** One revision as the history lists it, written by Luke on a call. */
function _revisionLine(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 10 * seq, duringCall: false },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const _FIRST_VERSION = { body: "# Teammate invitations\n\n## Goal", assumptions: [] };

/** A task other than the open one, which the host opens in its place. */
const OTHER_TASK_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

/** A task's row of the list, started at `createdAt`, with whatever pin it is given. */
function _row(id: string, createdAt: number, marks: { pinnedAt?: number } = {}) {
  return {
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt,
    updatedAt: createdAt,
    repository: null,
    ...marks,
  };
}

/** A task's row of the list, started at `createdAt`, with whatever pin it is given. */
function row(id: string, createdAt: number, marks: { pinnedAt?: number } = {}) {
  return {
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt,
    updatedAt: createdAt,
    repository: null,
    ...marks,
  };
}

const PERSONAL = {
  id: "workspace-personal",
  name: "Personal",
  slug: "personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const ACME = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** The account's tasks across its two workspaces: two of its own, and one of the team's. */
const TWO_WORKSPACES: TasksView = {
  ...IDLE_TASKS_VIEW,
  listStatus: TASKS_READ.READY,
  workspaces: [PERSONAL, ACME],
  tasks: [row("notes", 4), { ...row("alerts", 3), workspaceId: ACME.id }, row("billing", 2)],
};

/** A start's or a repository read's payload, read back as the acts' own schemas admit it. */
const readWorkspaceNamed = Schema.decodeUnknownOption(
  Schema.Struct({ workspaceId: Schema.optionalKey(Schema.String) }),
);

/** A pin's payload, read back as the act's own schema admits it. */
const readPin = Schema.decodeUnknownOption(Schema.Struct({ pinned: Schema.Boolean }));

/** A create's payload, read back as the act's own schema admits it. */
const readCreate = Schema.decodeUnknownOption(Schema.Struct({ name: Schema.String }));

/** The workspace each act of `kind` the tab asked named, none where it named none. */
function namedIn(
  payloads: readonly { readonly kind: PortActKind; readonly payload: unknown }[],
  kind: PortActKind,
): (string | undefined)[] {
  return payloads
    .filter((asked) => asked.kind === kind)
    .map((asked) => Option.getOrUndefined(readWorkspaceNamed(asked.payload))?.workspaceId);
}

/** The workspace each start the tab asked for named. */
const startedIn = (payloads: Parameters<typeof namedIn>[0]) =>
  namedIn(payloads, ACT_KIND.TASKS_START);

const UNSTARTED = {
  [ACT_KIND.TASKS_START]: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }),
};

const PLATFORM = {
  id: "workspace-platform",
  name: "Platform",
  slug: "platform",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

test("a member assigned from a chip goes to main with the name the reader knows them by, and a refusal answers so", async () => {
  const tab = mount(
    { shown: true, tasks: listRead([listed()]) },
    { [ACT_KIND.TASKS_SET_STANDING]: () => Promise.resolve(false) },
  );
  let kept: Promise<Kept> = Promise.resolve(KEPT);

  await act(async () => {
    kept = tab
      .control()
      .onSetTaskStanding(
        TASK.id,
        { priority: TASK_PRIORITY.URGENT, assigneeId: "user-charles" },
        "Charles",
      );
  });

  assert.deepEqual(
    tab.payloads.filter((each) => each.kind === ACT_KIND.TASKS_SET_STANDING),
    [
      {
        kind: ACT_KIND.TASKS_SET_STANDING,
        payload: {
          taskId: TASK.id,
          priority: TASK_PRIORITY.URGENT,
          assigneeId: "user-charles",
          assigneeName: "Charles",
        },
      },
    ],
  );
  assert.equal((await kept).kept, false);
});

test("New plan opens its dialog over the open plan, which stays open; a second press leaves it as it stands, only a plan that starts closes it, and leaving the tab puts it away", async () => {
  const answers = [
    { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE },
    { planId: OTHER_TASK_ID },
  ] as const;
  let start = 0;
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => Promise.resolve(answers[start++] ?? answers[1]) },
  );

  act(() => tab.control().onNewTask());
  act(() => tab.control().newTask.onClose());
  assert.equal(tab.control().newTask.open, false, "Cancel puts the dialog away");
  act(() => tab.control().onNewTaskIn("acme/web"));
  assert.equal(tab.control().newTask.open, true);
  assert.deepEqual(tab.control().newTask.preset, { repository: "acme/web" });
  assert.equal(tab.control().page, TASKS_PAGE.DOCUMENT, "the plan behind the dialog stays open");
  assert.ok(!tab.told.includes(ACT_KIND.TASKS_CLOSE), "nothing left the plan");
  act(() => tab.control().onNewTask());
  assert.deepEqual(
    tab.control().newTask.preset,
    { repository: "acme/web" },
    "a press while the dialog stands leaves it as it is",
  );

  let note: Failure | undefined;
  await act(async () => {
    note = await tab
      .control()
      .newTask.start("Dark mode", "acme/web", tab.control().newTask.workspaceId);
  });
  assert.ok(note, "a refusal says why");
  assert.equal(tab.control().newTask.open, true, "a refusal keeps the dialog");
  await act(async () => {
    note = await tab
      .control()
      .newTask.start("Dark mode", "acme/web", tab.control().newTask.workspaceId);
  });
  assert.equal(note, undefined);
  assert.equal(tab.control().newTask.open, false, "a plan started closes the dialog");

  act(() => tab.control().onNewTask());
  tab.stand({ shown: false });
  tab.stand({ shown: true });
  assert.equal(tab.control().newTask.open, false, "Settings taking the window put the dialog away");
});

/** A start's payload, read back for whether it asked to open nothing. */
const readQuiet = Schema.decodeUnknownOption(
  Schema.Struct({ quiet: Schema.optionalKey(Schema.Boolean) }),
);

test("with Open a task once it starts off, New task starts the task and its agent without opening them, and its toast's Open opens the agent's tab, asking first while a page stands unsaved work", async () => {
  handState({}, { settings: appSettingsWire(settingsView({ openNewTask: false })) });
  const agent = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN, room: SHELL_ROOM.NARROW },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent } }),
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
    },
    AtomRegistryModule.make(),
  );
  await settle();

  act(() => tab.control().onNewTask());
  await act(async () => {
    await tab.control().newTask.start("", null, tab.control().newTask.workspaceId, {
      handed: {
        idempotencyKey: "start-1",
        prompt: "Dark mode",
        attachments: [],
        choice: undefined,
      },
    });
  });
  const started = {
    quiet: tab.payloads
      .filter((asked) => asked.kind === ACT_KIND.TASKS_START)
      .map((asked) => Option.getOrUndefined(readQuiet(asked.payload))?.quiet),
    dialog: tab.control().newTask.open,
    says: newestToastSays(),
  };
  const asked: (() => void)[] = [];
  act(() => {
    tab.control().leaveGuard.stand((leave) => asked.push(leave));
  });
  act(() => (newestToastAction() ?? assert.fail("the toast offers Open")).click());
  await settle();
  const whileAsked = opensAsked(tab.payloads);
  act(() => asked[0]?.());
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();

  assert.deepEqual(started, { quiet: [true], dialog: false, says: "Task startedOpen" });
  assert.deepEqual(whileAsked, [], "Open asks first while a page stands unsaved work");
  assert.deepEqual(opensAsked(tab.payloads), [OTHER_TASK_ID]);
  assert.deepEqual(
    { tab: tab.control().mainTabs.tab, panel: panelOf(tab).open },
    { tab: { agent: AGENT_ID }, panel: false },
    "the task opens on its agent alone, no plan laid over it in a narrow room",
  );
  handState({});
});

/** A line of a file of the task's repository, as a place names it to open. */
const FILE_REF = { path: "src/invite.ts", startLine: 1, endLine: 1 };

/** The panel as the developer sees it: shown or not, and on which tab. */
function panelOf(tab: ReturnType<typeof mount>) {
  const { open, tab: shown } = tab.control().sidePanel;
  return { open, tab: shown };
}

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const RUNNING_AGENT: AgentSummary = {
  id: AGENT_ID,
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 3,
  status: AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("⇧⌘T opens the tabs closed again, the latest first, each in its strip at its place and a file's on the lines it showed, until none is left", async () => {
  const tab = mount({ shown: true, tasks: withAgents([RUNNING_AGENT]) });
  await settle();
  const panel = () => tab.control().sidePanel;
  const column = () => tab.control().mainTabs;
  const file = { file: FILE_REF.path };
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onOpenFile(FILE_REF));
  const strip = [SIDE_PANEL_TAB.COMMENTS, file];
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, { agent: AGENT_ID }]);
  assert.equal(tab.control().onReopenClosedTab, undefined, "nothing closed, nothing to reopen");

  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  act(() => column().onClose({ agent: AGENT_ID }));
  act(() => panel().onClose(file));
  assert.deepEqual(panel().strip, []);
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW], "no draft opens in the agent's place");

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, [file]);
  assert.deepEqual(panel().tab, file);
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range]),
    [[FILE_REF.path, { startLine: 1, endLine: 1 }]],
    "the file's tab lights the lines it lit",
  );

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, { agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
  assert.equal(tab.control().onReopenClosedTab, undefined);
});

test("a task none of whose tabs was viewed shows its Overview, keeps the tab chosen across a launch, and shows Overview alone once its last agent's tab closes", async () => {
  const listed = withAgents([RUNNING_AGENT]);
  const tab = mount({ shown: true, tasks: listed });
  await settle();
  const column = () => tab.control().mainTabs;
  const agent = { agent: AGENT_ID };
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, agent], "Overview leads the strip");
  assert.equal(column().tab, MAIN_TAB.OVERVIEW, "a task never shown on a tab shows its Overview");
  assert.equal(tab.control().agents.draft, undefined, "and opens no draft beside it");
  assert.equal(panelOf(tab).open, false, "the plan opens no side panel beside it");

  act(() => column().onClose(MAIN_TAB.OVERVIEW));
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, agent], "Overview never closes");

  act(() => column().onChoose(agent));
  assert.deepEqual(column().tab, agent);

  const launched = mount({ shown: true, tasks: listed });
  await settle();
  const again = () => launched.control().mainTabs;
  assert.deepEqual(again().tab, agent, "a launch opens the task on the agent it last showed");

  act(() => again().onClose(agent));
  await settle();
  assert.deepEqual(again().tabs, [MAIN_TAB.OVERVIEW]);
  assert.equal(again().tab, MAIN_TAB.OVERVIEW, "the tab viewed before it is shown");
});

/** The open task's row as the sidebar lists it, naming the agents given, and how many it has in all. */
function namingRow(lines: readonly string[], total: number) {
  return {
    ...row(TASK.id, 1),
    agents: {
      total,
      working: 0,
      agents: lines.map((id) => ({
        id,
        title: null,
        model: RUNNING_AGENT.model,
        effort: RUNNING_AGENT.effort,
        status: AGENT_STATUS.COMPLETED,
      })),
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

test("a task whose row settles its tab shows that agent's before its agents are read, one with none viewed its Overview, and one whose row cannot say shows none until they are", async () => {
  const OLDER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
  const UNNAMED = "2c3d4e5f-6071-4829-93a4-b5c6d7e8f9a0";
  // The list carries none of the task's agents yet, so whatever the column shows, the row chose.
  const shownOn = async (
    lines: readonly string[],
    total: number,
    recent: readonly string[] | undefined,
  ) => {
    window.localStorage.setItem(
      "luke.mainTabs",
      JSON.stringify({
        closedAgents: [],
        tasks:
          recent === undefined ? {} : { [TASK.id]: { recent: recent.map((agent) => ({ agent })) } },
      }),
    );
    const tab = mount({ shown: true, tasks: { ...OPEN, tasks: [namingRow(lines, total)] } });
    await settle();
    assert.equal(tab.control().agents.agents, undefined, "the agents are still being read");
    return tab.control().mainTabs.tab;
  };

  assert.deepEqual(
    await shownOn([AGENT_ID, OLDER, UNNAMED], 5, [OLDER]),
    { agent: OLDER },
    "the agent last viewed, which the row names",
  );
  assert.equal(
    await shownOn([AGENT_ID], 1, undefined),
    MAIN_TAB.OVERVIEW,
    "its Overview, where none was viewed",
  );
  assert.deepEqual(
    await shownOn([AGENT_ID, OLDER], 2, [OLDER, UNNAMED]),
    { agent: OLDER },
    "past one viewed since that the row shows is gone",
  );
  assert.equal(
    await shownOn([AGENT_ID, OLDER], 4, [OLDER, UNNAMED]),
    undefined,
    "one viewed last that the row does not name may stand among those it leaves out",
  );
  assert.equal(
    await shownOn([AGENT_ID, OLDER], 2, undefined),
    MAIN_TAB.OVERVIEW,
    "of two agents none viewed, its Overview too",
  );
});

test("a column kept while the plan, the Inbox, and the Call stood in it, and a side panel kept on its Plan tab, read with each let go, the agents' order, the tab last viewed, and the panel's other tabs still standing", async () => {
  window.localStorage.setItem(
    "luke.sidePanel",
    JSON.stringify({
      open: true,
      tabs: ["plan", "inbox", "comments"],
      tab: "plan",
      width: 400,
      tasks: {
        [TASK.id]: {
          opened: ["plan", "comments"],
          closed: [],
          recent: ["comments", "plan"],
          order: ["plan", "comments"],
        },
      },
    }),
  );
  window.localStorage.setItem(
    "luke.mainTabs",
    JSON.stringify({
      closedAgents: [],
      tasks: {
        [TASK.id]: {
          recent: ["plan", { agent: AGENT_ID }, "inbox", "call"],
          order: ["call", { agent: AGENT_ID }, "inbox"],
          inboxOpen: true,
          inboxSeen: ["item-1"],
          planClosed: true,
          callClosed: true,
        },
      },
    }),
  );
  const tab = mount({ shown: true, tasks: withAgents([RUNNING_AGENT]) });
  await settle();
  const column = () => tab.control().mainTabs;
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, { agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });
  assert.deepEqual(tab.control().sidePanel.strip, [SIDE_PANEL_TAB.COMMENTS], "no Plan tab stands");
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
});

test("a column whose last agent is archived shows its Overview alone", async () => {
  const archived = { ...RUNNING_AGENT, archivedAt: 5 };
  const tab = mount(
    { shown: true, tasks: withAgents([RUNNING_AGENT]) },
    { [ACT_KIND.AGENTS_ARCHIVE]: () => Promise.resolve({ agent: archived }) },
  );
  await settle();
  const column = () => tab.control().mainTabs;
  act(() => column().onChoose({ agent: AGENT_ID }));
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  // The host draws the archive on the list as it is asked.
  tab.stand({ tasks: withAgents([archived]) });
  await act(() => tab.control().agents.onArchive(AGENT_ID, true));
  await settle();
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW]);
  assert.equal(column().tab, MAIN_TAB.OVERVIEW);
});

test("a tab closed on another plan opens that plan again, and the tab on it once the host has it open", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.COMMENTS));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_SELECT);
  assert.equal(tab.control().boundFor, TASK.id);

  tab.stand({ tasks: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.COMMENTS]);
});

test("in a narrow room a task opened from a list lands on its plan, its Overview with the side panel shut over it whichever tab it last showed, and on the desktop's width it stands shut once a plan with no tab was passed through", () => {
  for (const room of [SHELL_ROOM.NARROW, SHELL_ROOM.WIDE]) {
    window.localStorage.clear();
    const tab = mount(
      { shown: true, tasks: OPEN, room },
      { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
    );
    act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
    tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });

    act(() => tab.control().onSelect(TASK.id));
    tab.stand({ tasks: OPEN });
    if (room === SHELL_ROOM.NARROW) {
      assert.equal(tab.control().sidePanel.open, false, "narrow shuts the panel");
      assert.equal(tab.control().mainTabs.tab, MAIN_TAB.OVERVIEW, "over the task's Overview");
    } else {
      assert.equal(
        tab.control().sidePanel.open,
        false,
        "a plan with no tab passed through shuts it",
      );
    }
  }
});

test("in a narrow room Back to a task opens it as it stood, its panel open on the tab it showed, where a task opened from a list lands on its plan", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN, room: SHELL_ROOM.NARROW, history: true },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  assert.deepEqual(panel().tabs, [SIDE_PANEL_TAB.COMMENTS]);

  act(() => tab.control().onSelect(OTHER_TASK_ID));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();
  assert.equal(panel().open, false, "the task opened from a list lands on its plan");
  assert.equal(tab.control().mainTabs.tab, MAIN_TAB.OVERVIEW);

  act(() => tab.history().onBack());
  assert.equal(tab.control().boundFor, TASK.id);
  tab.stand({ tasks: OPEN });
  await settle();
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
});

test("in a narrow room a Luke link to another task's panel item opens that item, not the plan a task opened from a list lands on", async () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID }, room: SHELL_ROOM.NARROW },
    {
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
    },
  );
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.CHANGES, planId: TASK.id, agentId: AGENT_ID },
    }),
  );
  tab.stand({ tasks: OPEN });
  await settle();
  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: AGENT_ID } });
});

test("Show panel on a plan whose strip holds no tab opens the tab last closed there, else the kind last closed on it, else shows the panel empty, as a first launch does with no tab standing", () => {
  const tab = mount({ shown: true, tasks: OPEN });
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  assert.deepEqual(panelOf(tab), { open: false, tab: undefined });

  act(() => panel().onToggle());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS }, "as ⇧⌘T opens it");
  assert.deepEqual(panel().strip, [SIDE_PANEL_TAB.COMMENTS]);
  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));

  // A launch keeps no tab closed to open again, but keeps the kinds closed on the plan.
  const launched = mount({ shown: true, tasks: OPEN });
  assert.equal(launched.control().onReopenClosedTab, undefined);
  assert.equal(launched.control().sidePanel.open, false);
  act(() => launched.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(launched), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });

  window.localStorage.clear();
  const fresh = mount({ shown: true, tasks: OPEN });
  assert.deepEqual(fresh.control().sidePanel.strip, [], "the plan stands in the column");
  assert.equal(fresh.control().sidePanel.open, false);
  act(() => fresh.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(fresh), { open: true, tab: undefined });
});

test("Show panel beside the Inbox, its item's plan's strip holding no tab, shows the panel empty, though another plan stands open behind it", () => {
  const tab = mount({ shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } });
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  assert.deepEqual(tab.control().sidePanel.strip, []);

  act(() => tab.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(tab), { open: true, tab: undefined });
});

test("a Luke link to another plan's section opens that plan and asks its page to show the section, each ask its own", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const section = { kind: MENTION_KIND.SECTION, taskId: OTHER_TASK_ID, anchor: "rollout" } as const;

  act(() => tab.control().onShowMention(section));
  const first = tab.control().sectionReveal;
  act(() => tab.control().onShowMention(section));

  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_SELECT);
  assert.deepEqual(first, { taskId: OTHER_TASK_ID, reveal: { anchor: "rollout", ask: 1 } });
  assert.deepEqual(tab.control().sectionReveal, {
    taskId: OTHER_TASK_ID,
    reveal: { anchor: "rollout", ask: 2 },
  });
});

test("a Luke link keyed by the agent alone opens on the agent's task where it has one, else on the agent's page", async () => {
  const ELSEWHERE = "5e3b6f1d-2a10-4c7a-9a55-7b0f5f3e2c1d";
  const TASKLESS = "2b7c9e4d-1f3a-4b6e-8d2c-9a1e5f7b3c40";
  const UNREAD = "6d4e2c1b-9a8f-4e7d-b6c5-3a2f1e0d9c8b";
  const SLOW = "1a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";
  let answerSlow: () => void = () => undefined;
  const read = (agentId: unknown) => ({
    agent: {
      ...RUNNING_AGENT,
      id: String(agentId),
      planId: agentId === ELSEWHERE ? OTHER_TASK_ID : null,
      automationId: null,
      workspaceId: "acme",
      repository: null,
    },
  });
  const tab = mount(
    { shown: true, tasks: withAgents([RUNNING_AGENT]) },
    {
      [ACT_KIND.AGENTS_PAGE]: (payload) => {
        const { agentId } = payload as { agentId: string };
        if (agentId === SLOW) {
          return new Promise((resolve) => {
            answerSlow = () => resolve(read(ELSEWHERE));
          });
        }
        return agentId === UNREAD
          ? Promise.reject(new Error("Unread."))
          : Promise.resolve(read(agentId));
      },
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
    },
  );
  await settle();
  const open = (place: LinkPlace) =>
    act(() => tab.control().onOpenLink({ workspace: "acme", place }));

  open({ kind: LINK_PLACE.AGENT, agentId: AGENT_ID });
  assert.equal(tab.control().agentView.agentId, undefined, "the open task's agent opens on it");
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });

  open({ kind: LINK_PLACE.CHANGES, agentId: UNREAD });
  await settle();
  assert.equal(tab.control().agentView.agentId, UNREAD, "an agent not read stands on its page");
  assert.notDeepEqual(
    panelOf(tab).tab,
    { changes: UNREAD },
    "and opens no tab of a panel it may not hold",
  );

  open({ kind: LINK_PLACE.CHANGES, agentId: TASKLESS });
  await settle();
  assert.equal(tab.control().agentView.agentId, TASKLESS, "an agent on no task opens on its page");
  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: TASKLESS } });

  open({ kind: LINK_PLACE.AGENT, agentId: ELSEWHERE });
  await settle();
  assert.equal(tab.control().agentView.agentId, undefined);
  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_SELECT, "an agent on another task opens that task");

  // A link opened at once, to the open task's own agent, wins over an earlier read answering late.
  open({ kind: LINK_PLACE.AGENT, agentId: SLOW });
  open({ kind: LINK_PLACE.AGENT, agentId: AGENT_ID });
  const told = tab.told.length;
  answerSlow();
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.told.length, told, "the late read opens no other task");
});

test("a Luke link to a page an agent on no task showed opens that agent's page, its panel on the page's tab, the agent's own pages held for it", async () => {
  const page = { id: "page-1", title: "Flaky funnel", version: 1, at: 1 };
  fakeActs({
    act: () => Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." }),
  });
  // Note that a panel's pages are held through the window's act port and laid on the document, as the host lays them.
  const asked = holdPages(handHostReads({}).deliverPages, () => [page]);
  // A fresh registry reads the document handed here, rather than one an earlier test handed.
  const tab = mount(
    { shown: true, tasks: withAgents([RUNNING_AGENT]) },
    {},
    AtomRegistryModule.make(),
  );
  await settle();

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.PAGE, agentId: AGENT_ID, pageId: page.id },
    }),
  );
  await settle();

  assert.equal(tab.control().agentView.agentId, AGENT_ID);
  assert.deepEqual(asked, [{ agentId: AGENT_ID }]);
  assert.deepEqual(tab.control().agentView.pages, [page]);
  assert.deepEqual(panelOf(tab), { open: true, tab: { page: page.id } });
});

test("a Luke link to an agent's worker opens the worker's own tab in the task's side panel beside its agent's, and one to its Changes their tab", async () => {
  const tab = mount({ shown: true, tasks: withAgents([RUNNING_AGENT]) });
  await settle();

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.WORKER, planId: TASK.id, agentId: AGENT_ID, callId: "toolu_1" },
    }),
  );
  const worker = panelOf(tab);
  const column = tab.control().mainTabs.tab;
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.CHANGES, planId: TASK.id, agentId: AGENT_ID },
    }),
  );

  assert.deepEqual(worker, {
    open: true,
    tab: { subagent: "toolu_1", delegation: { agent: AGENT_ID, task: "" } },
  });
  assert.deepEqual(
    column,
    { agent: AGENT_ID },
    "the worker's agent's tab opens with it, which draws the worker",
  );
  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: AGENT_ID } });
});

test("a link to an agent's Pull request tab, on a pull request another of the task's agents shares whose tab is open, opens that tab rather than a second, unless that agent was archived", async () => {
  const EARLIER = { ...RUNNING_AGENT, id: "5e3b6f1d-2a10-4c7a-9a55-7b0f5f3e2c1d", createdAt: 2 };
  const shared = {
    number: 41,
    title: "Teammate invitations",
    url: "https://github.com/acme/relay/pull/41",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
  };
  const archived = { ...EARLIER, archivedAt: 5 };
  // Both agents' rows keep the pull request they share, which the list carries beside them.
  const sharing = (agents: readonly AgentSummary[]): TasksView => ({
    ...withAgents(agents),
    agentPullRequests: agents.map((agent) => ({
      agentId: agent.id,
      taskId: TASK.id,
      pullRequest: shared,
    })),
  });
  const tab = mount(
    { shown: true, tasks: sharing([EARLIER, RUNNING_AGENT]) },
    { [ACT_KIND.AGENTS_ARCHIVE]: () => Promise.resolve({ agent: archived }) },
  );
  await settle();
  const open = (agentId: string) =>
    act(() =>
      tab.control().onOpenLink({
        workspace: "acme",
        place: { kind: LINK_PLACE.CHANGES, planId: TASK.id, agentId },
      }),
    );

  open(EARLIER.id);
  open(AGENT_ID);

  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: EARLIER.id } });
  assert.deepEqual(tab.control().sidePanel.changes, [{ changes: EARLIER.id }]);

  // Archived, the earlier agent's tab is no longer drawn, so the link opens the later agent's own.
  tab.stand({ tasks: sharing([archived, RUNNING_AGENT]) });
  await act(() => tab.control().agents.onArchive(EARLIER.id, true));
  await settle();
  open(AGENT_ID);
  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: AGENT_ID } });
});

test("a Luke link to an agent's message opens the agent and asks its tab to bring the message into view, each ask its own, let go once answered", async () => {
  const tab = mount({ shown: true, tasks: withAgents([RUNNING_AGENT]) });
  await settle();
  const link = {
    workspace: "acme",
    place: { kind: LINK_PLACE.MESSAGE, planId: TASK.id, agentId: AGENT_ID, messageId: "msg-7" },
  } as const;

  act(() => tab.control().onOpenLink(link));
  const first = tab.control().messageReveal;
  act(() => tab.control().onOpenLink(link));
  act(() => tab.control().onMessageRevealed(2));

  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.deepEqual(first, { agentId: AGENT_ID, messageId: "msg-7", ask: 1 });
  assert.equal(tab.control().messageReveal, undefined);
});

test("a Luke link to a comment thread asks its task's page for the thread, each ask its own, let go once taken, so a later visit opens nothing", () => {
  const tab = mount({ shown: true, tasks: OPEN });
  const link = (threadId: string) =>
    ({
      workspace: "acme",
      place: { kind: LINK_PLACE.COMMENT, planId: TASK.id, threadId },
    }) as const;

  act(() => tab.control().onOpenLink(link("thread-1")));
  const first = tab.control().commentReveal;
  act(() => tab.control().onOpenLink(link("thread-2")));
  act(() => tab.control().onCommentRevealed(1));
  const stale = tab.control().commentReveal;
  act(() => tab.control().onCommentRevealed(2));

  assert.deepEqual(first, { planId: TASK.id, thread: "thread-1", ask: 1 });
  assert.equal(stale?.ask, 2, "letting go an older ask leaves the newer one standing");
  assert.equal(tab.control().commentReveal, undefined);
});

test("a Luke link to a review thread opens its agent's Pull request tab on the view it names and asks the tab to bring the thread into view, each ask its own, let go once taken", async () => {
  const tab = mount({ shown: true, tasks: withAgents([RUNNING_AGENT]) });
  await settle();
  const link = (view: PullRequestThreadView) =>
    ({
      workspace: "acme",
      place: {
        kind: LINK_PLACE.PULL_REQUEST_THREAD,
        planId: TASK.id,
        agentId: AGENT_ID,
        threadId: "PRRT_1",
        view,
      },
    }) as const;

  act(() => tab.control().onOpenLink(link(PULL_REQUEST_THREAD_VIEW.FILES)));
  const first = tab.control().threadReveal;
  const files = ofPullRequestTab(tab.control().sidePanel.pullRequestViews, { changes: AGENT_ID });
  act(() => tab.control().onOpenLink(link(PULL_REQUEST_THREAD_VIEW.CONVERSATION)));
  const second = tab.control().threadReveal;
  const conversation = ofPullRequestTab(tab.control().sidePanel.pullRequestViews, {
    changes: AGENT_ID,
  });
  act(() => tab.control().onThreadRevealed(1));
  const stale = tab.control().threadReveal;
  act(() => tab.control().onThreadRevealed(2));

  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: AGENT_ID } });
  assert.deepEqual(first, {
    agentId: AGENT_ID,
    threadId: "PRRT_1",
    view: PULL_REQUEST_THREAD_VIEW.FILES,
    ask: 1,
  });
  assert.equal(files, PULL_REQUEST_VIEW.FILES);
  assert.equal(second?.ask, 2);
  assert.equal(conversation, PULL_REQUEST_VIEW.CONVERSATION);
  assert.equal(stale?.ask, 2, "letting go an older ask leaves the newer one standing");
  assert.equal(tab.control().threadReveal, undefined);
});

test("a Luke link to an Inbox item opens it in the window's Inbox narrowed to its task, in the task's workspace, under the task or under its agent, whose task is read, never in the side panel, and one to an automation in the workspace its slug names", async () => {
  const alerts = "alerts";
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
  const agentItemId = "7f3a4b5c-6d7e-4f80-9a12-a3b4c5d6e7f8";
  const automationId = "6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7";
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "notes" } },
    {
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
      [ACT_KIND.AGENTS_PAGE]: () =>
        Promise.resolve({
          agent: {
            ...RUNNING_AGENT,
            planId: alerts,
            automationId: null,
            workspaceId: ACME.id,
            repository: null,
          },
        }),
    },
  );
  const place = channelPlaceNow();
  const opened = () => ({
    open: tab.control().inboxView.open,
    chosen: tab.control().inboxView.chosen,
    taskId: place().taskId,
    panel: tab.control().sidePanel.tab,
  });

  act(() =>
    tab.control().onOpenLink({
      workspace: "renamed-since",
      place: { kind: LINK_PLACE.INBOX_ITEM, planId: alerts, itemId },
    }),
  );
  const underTask = opened();
  const listed = tab.control().workspace?.id;
  act(() =>
    tab.control().onOpenLink({
      workspace: "renamed-since",
      place: { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT_ID, itemId: agentItemId },
    }),
  );
  await settle();
  const underAgent = opened();
  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.AUTOMATION, automationId },
    }),
  );

  assert.deepEqual(underTask, {
    open: true,
    chosen: { taskId: alerts, itemId, opened: true },
    taskId: alerts,
    panel: undefined,
  });
  assert.equal(listed, ACME.id);
  assert.deepEqual(underAgent, {
    open: true,
    chosen: { taskId: alerts, itemAgentId: AGENT_ID, itemId: agentItemId, opened: true },
    taskId: alerts,
    panel: undefined,
  });
  assert.equal(tab.control().inboxView.open, false);
  assert.deepEqual(tab.control().automationsView.place, {
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId,
  });
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
});

/** The window's channel place, and the task the Inbox is narrowed to, as a surface drawing them reads them now. */
function channelPlaceNow(): () => ChannelPlaceControl & { readonly taskId: string | undefined } {
  let seen: (ChannelPlaceControl & { readonly taskId: string | undefined }) | undefined;
  const Reader = () => {
    seen = { ...useChannelPlace(), taskId: useInboxTask() };
    return null;
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Reader)));
  return () => seen ?? assert.fail("the channel place is read");
}

test("with Channels on, a channel's link opens the Inbox narrowed to it, which a thread's link of an agent with no task keeps until its item is read, and an item opened from another surface narrows it to the item's channel", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await settle();
  const place = channelPlaceNow();
  const app = "a1000001-6d9f-4ab7-92df-000000000002";
  const design = "a1000001-6d9f-4ab7-92df-000000000003";
  const linked = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
  const opened = "6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7";

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.CHANNEL, channelId: app },
    }),
  );
  const channel = {
    open: tab.control().inboxView.open,
    chosen: tab.control().inboxView.chosen,
    channelId: place().channelId,
  };
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.INBOX_ITEM, agentId: AGENT_ID, itemId: linked },
    }),
  );
  const thread = place().channelId;
  act(() => tab.control().inboxView.onOpenItem({ taskId: "alerts", itemId: opened }, design));

  assert.deepEqual(channel, { open: true, chosen: undefined, channelId: app });
  assert.equal(thread, app);
  assert.deepEqual(tab.control().inboxView.chosen, { taskId: "alerts", itemId: opened });
  assert.equal(place().channelId, design);
  handState({});
});

test("a task's Inbox door and its link narrow the Inbox to the task in place of a channel, a channel chosen after takes the task's place, and the Inbox's own row lists everything", async () => {
  handState(experimentsOn(EXPERIMENT.CHANNELS));
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await settle();
  const place = channelPlaceNow();
  const app = "a1000001-6d9f-4ab7-92df-000000000002";
  const narrowedTo = () => ({
    open: tab.control().inboxView.open,
    chosen: tab.control().inboxView.chosen,
    channelId: place().channelId,
    taskId: place().taskId,
  });
  const channelLink = { workspace: "acme", place: { kind: LINK_PLACE.CHANNEL, channelId: app } };

  act(() => tab.control().onOpenLink(channelLink));
  act(() => tab.control().onShowInbox({ taskId: "notes" }));
  const door = narrowedTo();
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.INBOX, planId: "alerts" },
    }),
  );
  const linked = narrowedTo();
  act(() => tab.control().onOpenLink(channelLink));
  const channel = narrowedTo();
  act(() => tab.control().onShowInbox({ taskId: "notes" }));
  act(() => tab.control().inboxView.onOpen());

  assert.deepEqual(door, { open: true, chosen: undefined, channelId: undefined, taskId: "notes" });
  assert.deepEqual(linked, {
    open: true,
    chosen: undefined,
    channelId: undefined,
    taskId: "alerts",
  });
  assert.deepEqual(channel, { open: true, chosen: undefined, channelId: app, taskId: undefined });
  assert.deepEqual(narrowedTo(), {
    open: true,
    chosen: undefined,
    channelId: undefined,
    taskId: undefined,
  });
  handState({});
});

test("a Luke link to an automation's run opens its editor naming the run, which its runs mark", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.AUTOMATION_RUN, automationId: "a1", runId: "r1" },
    }),
  );

  assert.deepEqual(tab.control().automationsView.place, {
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId: "a1",
    runId: "r1",
  });
});

test("a Luke link to a person opens their page in the workspace its slug names, in the place of the Inbox", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => tab.control().inboxView.onOpen());

  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.PERSON, userId: "user-charles" },
    }),
  );

  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.control().personView.userId, "user-charles");
  assert.equal(tab.control().personView.workspaceId, PERSONAL.id);
});

test("a Luke link to the Admin place opens it on its Overview, and one to a view opens that view, in the place of the Inbox, listing no other workspace", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const listed = tab.control().workspace?.id;
  act(() => tab.control().inboxView.onOpen());

  act(() => tab.control().onOpenLink({ workspace: "personal", place: { kind: LINK_PLACE.ADMIN } }));
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.control().adminView.open, true);
  assert.deepEqual(tab.control().adminView.view, { kind: "dashboard" });

  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.ADMIN, userId: "user-charles" },
    }),
  );
  assert.deepEqual(tab.control().adminView.view, { kind: "account", id: "user-charles" });

  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.ADMIN, section: "workspaces" },
    }),
  );
  assert.deepEqual(tab.control().adminView.view, { kind: "workspaces" });
  // The place reads every workspace's accounts, so its link's workspace lists none.
  assert.equal(tab.control().workspace?.id, listed);
});

test("a Luke link whose slug names no workspace of the account's leaves the listed one, and opens its place all the same, whose read decides", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const listed = tab.control().workspace?.id;

  act(() =>
    tab.control().onOpenLink({
      workspace: "someone-elses",
      place: { kind: LINK_PLACE.AUTOMATION, automationId: OTHER_TASK_ID },
    }),
  );

  assert.equal(tab.control().workspace?.id, listed);
  assert.equal(tab.control().automationsView.open, true);
});

test("a Luke link to a task's version opens its version history on that version, and one to the task opens its plan", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.VERSION, planId: TASK.id, revision: 3 },
    }),
  );
  const history = { open: tab.control().history.open, spot: tab.control().history.spot };
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.TASK, planId: TASK.id },
    }),
  );

  assert.deepEqual(history, { open: true, spot: { revision: 3, opened: undefined } });
  assert.equal(tab.control().history.open, false);
  assert.equal(tab.control().mainTabs.tab, MAIN_TAB.OVERVIEW, "its plan, in its Overview");
});

test("a Luke link to a version of a task the service will not hand the reader leaves no version history standing over the task's Not found", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );

  act(() =>
    tab.control().onOpenLink({
      workspace: "someone-elses",
      place: { kind: LINK_PLACE.VERSION, planId: OTHER_TASK_ID, revision: 3 },
    }),
  );
  tab.stand({
    tasks: {
      ...OPEN,
      activeTaskId: OTHER_TASK_ID,
      document: { status: TASKS_READ.MISSING },
    },
  });

  assert.equal(tab.control().history.open, false);
  assert.equal(tab.control().region.kind, DOCUMENT_REGION.MISSING);
});

test("a section shown is let go, so the plan opened again later opens where it would, while a newer ask stands", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const section = { kind: MENTION_KIND.SECTION, taskId: OTHER_TASK_ID, anchor: "rollout" } as const;

  act(() => tab.control().onShowMention(section));
  act(() => tab.control().onShowMention(section));
  act(() => tab.control().onSectionRevealed(1));
  const afterStale = tab.control().sectionReveal;
  act(() => tab.control().onSectionRevealed(2));
  const afterShown = tab.control().sectionReveal;
  act(() => tab.control().onShowMention(section));

  assert.deepEqual(afterStale, { taskId: OTHER_TASK_ID, reveal: { anchor: "rollout", ask: 2 } });
  assert.equal(afterShown, undefined);
  assert.deepEqual(tab.control().sectionReveal?.reveal, { anchor: "rollout", ask: 3 });
});

test("the closed tabs kept are the latest twenty, the oldest let go past them", () => {
  const tab = mount({ shown: true, tasks: OPEN });
  const panel = () => tab.control().sidePanel;
  act(() => panel().onClose(SIDE_PANEL_TAB.PLAN));
  for (let close = 0; close < 20; close += 1) {
    act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
    act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  }

  let reopened = 0;
  for (let reopen = tab.control().onReopenClosedTab; reopen !== undefined; ) {
    act(() => reopen?.());
    assert.equal(panel().tab, SIDE_PANEL_TAB.COMMENTS);
    reopened += 1;
    reopen = tab.control().onReopenClosedTab;
  }
  assert.equal(reopened, 20);
  assert.deepEqual(
    panel().tabs,
    [SIDE_PANEL_TAB.COMMENTS],
    "the plan's tab, closed first, is not kept",
  );
});

test("a file's tab opens again on the record it closed with, though another plan opened the same path since", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onOpenFile(FILE_REF));
  act(() => panel().onClose({ file: FILE_REF.path }));

  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  act(() => panel().onOpenFile({ ...FILE_REF, startLine: 5, endLine: 9 }, "b2c3d4e"));
  tab.stand({ tasks: OPEN });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().tab, { file: FILE_REF.path });
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range, each.commit]),
    [[FILE_REF.path, { startLine: 1, endLine: 1 }, undefined]],
  );
});

test("a press while a reopen waits on its plan takes no tab of another plan, which opens in its turn", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  tab.stand({ tasks: { ...OPEN, activeTaskId: THIRD_TASK_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, OTHER_TASK_ID);
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, TASK.id);
  tab.stand({ tasks: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
  assert.equal(tab.control().onReopenClosedTab, undefined);
});

/** A third task, which neither tab was closed on. */
const THIRD_TASK_ID = "4e6a8c0e-2a4c-4e6a-8c0e-2a4c6e8a0c2e";

test("a tab its strip no longer draws, its page gone since, is passed over for the tab closed before it", () => {
  const page = {
    id: "6c8e0a2c-4e6a-4c8e-8a2c-4e6a8c0e2a4c",
    title: "Invite flow",
    version: 1,
    at: 1,
  };
  const tab = mount({ shown: true, tasks: { ...OPEN, pages: [page] } });
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onClose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onChoose({ page: page.id }));
  act(() => panel().onClose({ page: page.id }));
  tab.stand({ tasks: { ...OPEN, pages: [] } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });
  assert.equal(tab.control().onReopenClosedTab, undefined, "the page's tab is not kept to reopen");
});

test("a render that hands the same plans keeps the lists the tab hands out, and a new list of plans hands out new ones", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const lists = () => {
    const control = tab.control();
    return [control.tasks, control.listed.tasks, control.taskSections, control.newTask.tasks];
  };
  const before = lists();

  tab.stand({ unseenAgents: ["agent-1"] });
  const after = lists();
  tab.stand({ tasks: { ...TWO_WORKSPACES, tasks: [row("launch", 5), ...TWO_WORKSPACES.tasks] } });

  for (const [index, list] of after.entries())
    assert.equal(list, before[index], `list ${index} kept`);
  assert.notEqual(tab.control().tasks, before[0]);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["launch", "notes", "billing"],
  );
});

test("the sidebar lists the first workspace's plans first, a workspace chosen lists its own alone while every plan stays findable, and New plan starts in the one chosen", async () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  const personal = {
    workspace: tab.control().workspace?.id,
    tasks: tab.control().listed.tasks.map((task) => task.id),
  };
  await tab.control().newTask.start("Invites", null, tab.control().newTask.workspaceId);
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().newTask.start("Usage", "acme/relay", tab.control().newTask.workspaceId);

  assert.deepEqual(personal, {
    workspace: PERSONAL.id,
    tasks: ["notes", "billing"],
  });
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["alerts"],
  );
  assert.deepEqual(startedIn(tab.payloads), [PERSONAL.id, ACME.id]);
  assert.deepEqual(
    tab.control().tasks.map((task) => task.id),
    ["notes", "alerts", "billing"],
    "the palette, the inbox, and the history find every workspace's plans",
  );
});

test("opening a plan of another workspace lists that workspace once it opened, one of the workspace listed changes nothing, and one that would not open changes nothing", async () => {
  let opens = true;
  const tab = mount(
    { shown: true, tasks: TWO_WORKSPACES },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(opens) },
  );

  opens = false;
  act(() => tab.control().onSelect("alerts"));
  await settle();
  const refused = tab.control().workspace?.id;
  const keptAfterRefusal = window.localStorage.getItem("luke.chosenWorkspace");
  opens = true;
  act(() => tab.control().onSelect("billing"));
  await settle();
  const stayed = tab.control().workspace?.id;
  act(() => tab.control().onSelect("alerts"));
  await settle();

  assert.equal(refused, PERSONAL.id, "a plan that would not open leaves the workspace");
  assert.equal(keptAfterRefusal, null, "and keeps nothing for the next launch");
  assert.equal(stayed, PERSONAL.id);
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["alerts"],
  );
});

/** A task's inbox waiting on the developer: `count` open items, each asked by one agent. */
function waitingIn(taskId: string, count: number): AppInboxTask {
  return {
    taskId,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${taskId}-item-${index}`,
      agentId: `${taskId}-agent`,
      title: "Which retry budget?",
      postedAt: index,
    })),
  };
}

test("the Inbox lists the chosen workspace's share of what waits, and a plan the list has not read yet is in neither share", () => {
  const tab = mount({
    shown: true,
    tasks: TWO_WORKSPACES,
    inboxWaiting: [waitingIn("notes", 1), waitingIn("alerts", 2), waitingIn("unread", 3)],
    inboxTasks: [
      { taskId: "notes", items: 1, updatedAt: 3 },
      { taskId: "alerts", items: 2, updatedAt: 2 },
      { taskId: "unread", items: 3, updatedAt: 1 },
    ],
  });
  const share = () => ({
    inbox: tab.control().listed.inbox.map((task) => task.taskId),
    inboxTasks: tab.control().listed.inboxTasks.map((holding) => holding.taskId),
  });

  const personal = share();
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(personal, { inbox: ["notes"], inboxTasks: ["notes"] });
  assert.deepEqual(share(), { inbox: ["alerts"], inboxTasks: ["alerts"] });
});

test("an Inbox item chosen in one workspace gives way as another is listed, so its plan's Inbox no longer stands on screen", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  const chosen = tab.control().inboxView.chosen;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(chosen, { taskId: "notes", itemId: "notes-item-0" });
  assert.equal(tab.control().inboxView.chosen, undefined);
  assert.equal(tab.control().inboxShown, null);
});

test("the Inbox opens on nothing chosen, from its row, from a link, and as the window rests on it, whatever was chosen in it before", () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, tasks: [listed()] } },
    { [ACT_KIND.TASKS_CLOSE]: () => Promise.resolve() },
  );
  const choose = () => {
    act(() => tab.control().inboxView.onOpenItem({ taskId: TASK.id, itemId: "item-1" }));
    act(() => tab.control().boardView.onOpen());
  };

  choose();
  act(() => tab.control().inboxView.onOpen());
  const fromRow = tab.control().inboxView.chosen;
  choose();
  act(() => tab.control().onOpenLink({ workspace: "acme", place: { kind: LINK_PLACE.INBOX } }));
  const fromLink = tab.control().inboxView.chosen;
  choose();
  act(() => tab.control().onSelect(TASK.id));
  act(() => tab.control().onLeaveTask());

  assert.equal(fromRow, undefined);
  assert.equal(fromLink, undefined);
  assert.equal(tab.control().inboxView.open, true, "leaving the plan rests on the Inbox");
  assert.equal(tab.control().inboxView.chosen, undefined);
});

test("a person's page is theirs in the workspace it opened in: another listed in its place closes it, and one opened from another workspace lists that one first", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().personView.onOpen("user-charles", "Charles Pan"));
  const opened = tab.control().personView.userId;
  act(() => tab.control().onChooseWorkspace(ACME.id));
  const afterSwitch = tab.control().personView.userId;
  act(() => tab.control().personView.onOpen("user-maya", "Maya Okafor", PERSONAL.id));

  assert.equal(opened, "user-charles");
  assert.equal(afterSwitch, undefined);
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.equal(tab.control().personView.userId, "user-maya");
});

test("a person's page opened in another workspace lists it without reopening its last plan, so no refused reopen takes the page with it", async () => {
  const tab = mount(
    {
      shown: true,
      tasks: {
        ...TWO_WORKSPACES,
        workspaces: [PERSONAL, ACME, PLATFORM],
        activeTaskId: "alerts",
      },
    },
    OPENS,
  );
  tab.stand({
    tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM], activeTaskId: "notes" },
  });
  const opensBefore = opensAsked(tab.payloads).length;

  act(() => tab.control().personView.onOpen("user-maya", "Maya Okafor", ACME.id));
  await settle();

  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.equal(opensAsked(tab.payloads).length, opensBefore);
  assert.equal(tab.control().personView.userId, "user-maya");
});

/** The tasks each open the tab asked of main named, in order. */
function opensAsked(
  payloads: readonly { readonly kind: PortActKind; readonly payload: unknown }[],
) {
  return payloads
    .filter((asked) => asked.kind === ACT_KIND.TASKS_SELECT)
    .map((asked) => Option.getOrUndefined(readOpened(asked.payload))?.taskId);
}

const readOpened = Schema.decodeUnknownOption(Schema.Struct({ taskId: Schema.String }));

/** Main's answers: every open lands, and every leave. */
const OPENS = {
  [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
  [ACT_KIND.TASKS_CLOSE]: () => Promise.resolve(undefined),
};

test("a person's page opened while a plan's open is still out stands when the open answers late, listing nothing over it", async () => {
  let answer: (opened: boolean) => void = () => undefined;
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "notes" } },
    {
      [ACT_KIND.TASKS_SELECT]: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
      [ACT_KIND.TASKS_CLOSE]: () => Promise.resolve(undefined),
    },
  );

  act(() => tab.control().onSelect("alerts"));
  act(() => tab.control().personView.onOpen("user-maya", "Maya Okafor", PERSONAL.id));
  await act(async () => answer(true));
  await settle();

  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.equal(tab.control().personView.userId, "user-maya");
});

test("a plan opened from another workspace says the window switched, and Back lists the workspace left with the plan that stood open there", async () => {
  const tab = mount({ shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "notes" } }, OPENS);

  act(() => tab.control().onSelect("alerts"));
  await settle();
  const switched = { workspace: tab.control().workspace?.id, says: newestToastSays() };
  tab.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "alerts" } });
  const back = newestToastAction() ?? assert.fail("the toast offers a way back");
  const backSays = back.textContent;
  act(() => back.click());
  await settle();

  assert.deepEqual(switched, { workspace: ACME.id, says: "Switched to acmeBack to Personal" });
  assert.equal(backSays, "Back to Personal");
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.deepEqual(opensAsked(tab.payloads), ["alerts", "notes"]);
});

test("Back from a switch made on the home page lists the workspace left and its home page again", async () => {
  const fromHome = mount({ shown: true, tasks: TWO_WORKSPACES }, OPENS);
  act(() => fromHome.control().onSelect("alerts"));
  await settle();
  fromHome.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "alerts" } });
  act(() => newestToastAction()?.click());
  await settle();

  assert.equal(fromHome.control().workspace?.id, PERSONAL.id);
  assert.ok(fromHome.told.includes(ACT_KIND.TASKS_CLOSE), "Back from home returns home");
});

test("a workspace chosen while a plan is open opens the plan last open there, or the home page where none was", async () => {
  const tab = mount(
    {
      shown: true,
      tasks: {
        ...TWO_WORKSPACES,
        workspaces: [PERSONAL, ACME, PLATFORM],
        activeTaskId: "alerts",
      },
    },
    OPENS,
  );
  tab.stand({
    tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM], activeTaskId: "notes" },
  });

  act(() => tab.control().onChooseWorkspace(ACME.id));
  await settle();
  const reopened = opensAsked(tab.payloads);
  tab.stand({
    tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM], activeTaskId: "alerts" },
  });
  act(() => tab.control().onChooseWorkspace(PLATFORM.id));
  await settle();

  assert.deepEqual(reopened, ["alerts"]);
  assert.equal(tab.control().workspace?.id, PLATFORM.id);
  assert.ok(tab.told.includes(ACT_KIND.TASKS_CLOSE), "a workspace with no plan opened shows home");
});

test("a remembered plan that moved to another workspace since, or would not open, gives way to the home page of the workspace chosen", async () => {
  const three = [PERSONAL, ACME, PLATFORM];
  const moved = {
    ...TWO_WORKSPACES,
    workspaces: three,
    tasks: TWO_WORKSPACES.tasks.map((task) =>
      task.id === "alerts" ? { ...task, workspaceId: PLATFORM.id } : task,
    ),
  };
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "alerts" } },
    OPENS,
  );
  tab.stand({ tasks: { ...moved, activeTaskId: "notes" } });
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await settle();

  assert.deepEqual(opensAsked(tab.payloads), []);
  assert.ok(tab.told.includes(ACT_KIND.TASKS_CLOSE));
  assert.equal(tab.control().workspace?.id, ACME.id);

  window.localStorage.clear();
  const refused = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "alerts" } },
    { ...OPENS, [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(false) },
  );
  refused.stand({ tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "notes" } });
  act(() => refused.control().onChooseWorkspace(ACME.id));
  await settle();

  assert.deepEqual(opensAsked(refused.payloads), ["alerts"]);
  assert.ok(refused.told.includes(ACT_KIND.TASKS_CLOSE), "the home page stands in for it");
  assert.equal(refused.control().workspace?.id, ACME.id);
});

test("a workspace chosen is listed at once, and a reopen answered after another was chosen leaves the newer choice standing", async () => {
  const three = [PERSONAL, ACME, PLATFORM];
  // The first reopen waits on main until the test answers it.
  const answers: ((opened: boolean) => void)[] = [];
  const held = new Promise<boolean>((answer) => answers.push(answer));
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "alerts" } },
    { ...OPENS, [ACT_KIND.TASKS_SELECT]: () => held },
  );
  tab.stand({ tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "notes" } });

  act(() => tab.control().onChooseWorkspace(ACME.id));
  const listedAtOnce = tab.control().workspace?.id;
  act(() => tab.control().onChooseWorkspace(PLATFORM.id));
  await settle();
  const leaves = tab.told.filter((kind) => kind === ACT_KIND.TASKS_CLOSE).length;
  for (const answer of answers) answer(false);
  await settle();

  assert.equal(listedAtOnce, ACME.id);
  assert.equal(tab.control().workspace?.id, PLATFORM.id);
  assert.equal(
    tab.told.filter((kind) => kind === ACT_KIND.TASKS_CLOSE).length,
    leaves,
    "the refused reopen leaves nothing the newer choice opened",
  );
});

test("a switch toast's Back does nothing once the window has moved on from the switch it reports", async () => {
  const three = [PERSONAL, ACME, PLATFORM];
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "notes" } },
    OPENS,
  );
  act(() => tab.control().onSelect("alerts"));
  await settle();
  tab.stand({ tasks: { ...TWO_WORKSPACES, workspaces: three, activeTaskId: "alerts" } });
  const back = newestToastAction() ?? assert.fail("the toast offers a way back");
  act(() => tab.control().onChooseWorkspace(PLATFORM.id));
  await settle();
  tab.stand({ tasks: { ...TWO_WORKSPACES, workspaces: three } });

  act(() => back.click());
  await settle();

  assert.equal(tab.control().workspace?.id, PLATFORM.id);
  assert.deepEqual(opensAsked(tab.payloads), ["alerts"]);
});

test("a workspace chosen from the home page lists it and opens nothing", async () => {
  const home = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM] } },
    OPENS,
  );
  act(() => home.control().onChooseWorkspace(ACME.id));
  await settle();

  assert.equal(home.control().workspace?.id, ACME.id);
  assert.deepEqual(
    [opensAsked(home.payloads), home.told.includes(ACT_KIND.TASKS_CLOSE)],
    [[], false],
  );
});

test("the new-plan page's recent repositories are the chosen workspace's own, and the chip names its workspace", () => {
  const tab = mount({
    shown: true,
    tasks: {
      ...TWO_WORKSPACES,
      workspaces: [
        { ...PERSONAL, github: { login: "alice", active: true } },
        { ...ACME, github: { login: "acme", active: true } },
      ],
      tasks: [
        { ...row("notes", 4), repository: "alice/private" },
        { ...row("alerts", 3), workspaceId: ACME.id, repository: "acme/relay" },
      ],
    },
  });

  const personal = tab.control().repositories;
  act(() => tab.control().onChooseWorkspace(ACME.id));
  const acme = tab.control().repositories;

  assert.deepEqual([personal.recent, personal.scope], [["alice/private"], PERSONAL.id]);
  assert.deepEqual([acme.recent, acme.scope], [["acme/relay"], ACME.id]);
});

test("a workspace's recent repositories are only those its GitHub reaches, so a plan stranded there by #2524 offers its repository to none", () => {
  const tab = mount({
    shown: true,
    tasks: {
      ...TWO_WORKSPACES,
      workspaces: [PERSONAL, { ...ACME, github: { login: "ReviewStage", active: true } }],
      tasks: [
        { ...row("stranded", 5), repository: "ReviewStage/luke" },
        { ...row("alerts", 4), workspaceId: ACME.id, repository: "reviewstage/luke" },
        { ...row("elsewhere", 3), workspaceId: ACME.id, repository: "octo/site" },
      ],
    },
  });

  const personal = tab.control().repositories.recent;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(personal, [], "a workspace with no GitHub connected reaches none");
  assert.deepEqual(tab.control().repositories.recent, ["reviewstage/luke"]);
});

test("newer plans on repositories a workspace does not reach crowd out none it does, and a suspended GitHub reaches nothing", () => {
  const stranded = [5, 6, 7, 8, 9].map((at) => ({
    ...row(`stranded-${at}`, at),
    workspaceId: ACME.id,
    repository: `octo/site-${at}`,
  }));
  const tasks = [
    ...stranded,
    { ...row("relay", 1), workspaceId: ACME.id, repository: "acme/relay" },
  ];
  const active = mount({
    shown: true,
    tasks: {
      ...TWO_WORKSPACES,
      workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: true } }],
      tasks,
    },
  });
  act(() => active.control().onChooseWorkspace(ACME.id));
  const reached = active.control().repositories.recent;
  closeWindow();

  const suspended = mount({
    shown: true,
    tasks: {
      ...TWO_WORKSPACES,
      workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: false } }],
      tasks,
    },
  });
  act(() => suspended.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(reached, ["acme/relay"]);
  assert.deepEqual(suspended.control().repositories.recent, []);
});

test("a workspace chosen is chosen again on the next launch, and one the account is no longer in gives way to the first one", () => {
  const first = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => first.control().onChooseWorkspace(ACME.id));
  closeWindow();

  const relaunched = mount({ shown: true, tasks: TWO_WORKSPACES });
  const kept = relaunched.control().workspace?.id;
  relaunched.stand({ tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL] } });

  assert.equal(kept, ACME.id);
  assert.equal(relaunched.control().workspace?.id, PERSONAL.id);
  assert.deepEqual(
    relaunched.control().listed.tasks.map((task) => task.id),
    ["notes", "billing"],
  );
});

test("before the workspaces are read every plan is listed and New plan names no workspace, so the service starts it in the first one", async () => {
  const tab = mount({ shown: true, tasks: { ...TWO_WORKSPACES, workspaces: [] } }, UNSTARTED);

  await tab.control().newTask.start("Invites", null, tab.control().newTask.workspaceId);

  assert.equal(tab.control().workspace, undefined);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["notes", "alerts", "billing"],
  );
  assert.deepEqual(startedIn(tab.payloads), [undefined]);
});

test("Settings' GitHub row is the connection main's view holds, its Connect and Disconnect ask main, and a refused Disconnect says why", async () => {
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, github: { connected: true, login: null } } },
    { [ACT_KIND.GITHUB_CONNECT]: () => Promise.resolve(undefined) },
  );

  act(() => {
    void tab.control().onConnectAccountGitHub();
  });
  act(() => {
    void tab.control().onDisconnectAccountGitHub();
  });
  await settle();

  assert.deepEqual(tab.control().github, { connected: true, login: null });
  assert.deepEqual(tab.told.slice(-2), [ACT_KIND.GITHUB_CONNECT, ACT_KIND.GITHUB_DISCONNECT]);
  // The test leaves Disconnect unanswered, which the bridge refuses.
  assert.equal(newestToastSays(), "Not answered in this test.");
});

test("the repository chooser says the account manages the workspace it owns, and not one it is a member of", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  const personal = tab.control().repositories.manages;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.equal(personal, true);
  assert.equal(tab.control().repositories.manages, false);
});

test("a Disconnect whose page did not open says why in a toast", async () => {
  const refusal = "Could not disconnect GitHub on this system.";
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, github: { connected: true, login: null } } },
    { [ACT_KIND.GITHUB_DISCONNECT]: () => Promise.reject(new Error(refusal)) },
  );

  act(() => {
    void tab.control().onDisconnectAccountGitHub();
  });
  await settle();

  assert.equal(newestToastSays(), refusal);
});

test("the repository chip reads the chosen workspace's repositories on the new-plan page, and the open plan's on its page", async () => {
  const listed = {
    repositories: {
      installed: true,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  };
  const tab = mount(
    { shown: true, tasks: TWO_WORKSPACES },
    { [ACT_KIND.TASKS_REPOSITORIES]: () => Promise.resolve(listed) },
  );

  await tab.control().repositories.read();
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().repositories.read();
  tab.stand({ tasks: { ...OPEN, workspaces: [PERSONAL, ACME] } });
  await tab.control().repositories.read();

  assert.deepEqual(namedIn(tab.payloads, ACT_KIND.TASKS_REPOSITORIES), [
    PERSONAL.id,
    ACME.id,
    TASK.workspaceId,
  ]);
});

test("the repository chip's list for a workspace with GitHub connected is its repositories alone, under no heading", async () => {
  const listed = {
    repositories: {
      installed: true,
      repositories: [
        {
          owner: "acme",
          name: "relay",
          fullName: "acme/relay",
          defaultBranch: "main",
          private: true,
          updatedAt: 1,
        },
      ],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  };
  const tab = mount(
    {
      shown: true,
      tasks: {
        ...TWO_WORKSPACES,
        workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: true } }],
      },
    },
    { [ACT_KIND.TASKS_REPOSITORIES]: () => Promise.resolve(listed) },
  );
  installScrollIntoView();
  const chip = document.body.appendChild(document.createElement("div"));
  const chipRoot = createRoot(chip);
  roots.push(chipRoot);
  act(() =>
    chipRoot.render(
      createElement(RepositoryChip, {
        value: null,
        chooser: tab.control().newTask.repositoriesIn(ACME.id),
        onChoose: () => undefined,
        place: CHIP_PLACE.FIELD,
      }),
    ),
  );
  await settle();
  act(() => chip.querySelector<HTMLButtonElement>(".luke-chip")?.click());
  await settle();

  const menu = chip.querySelector('[aria-label="Repository"]') ?? assert.fail("the menu opens");
  assert.deepEqual(
    [
      // A row names the repository, then its owner after it.
      [...menu.querySelectorAll('[role="option"]')].map((row) =>
        [".luke-combobox-option-detail", ".luke-combobox-option-label"]
          .map((part) => row.querySelector(part)?.textContent)
          .join("/"),
      ),
      [...menu.querySelectorAll('[role="group"]')].map((group) => group.getAttribute("aria-label")),
    ],
    [["acme/relay"], []],
  );
});

test("a workspace made is asked for by its name and listed at once, and a refusal answers why", async () => {
  let refuse = false;
  const tab = mount(
    { shown: true, tasks: TWO_WORKSPACES },
    {
      [ACT_KIND.WORKSPACE_CREATE]: () =>
        refuse
          ? Promise.reject(new Error("Could not make that workspace on this system."))
          : Promise.resolve(PLATFORM),
    },
  );

  const made = await tab.control().onCreateWorkspace("Platform");
  await settle();
  tab.stand({ tasks: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM] } });
  refuse = true;
  const refused = await tab.control().onCreateWorkspace("Platform");

  assert.equal(made, undefined);
  assert.equal(refused, "Could not make that workspace on this system.");
  assert.deepEqual(
    tab.payloads
      .filter((asked) => asked.kind === ACT_KIND.WORKSPACE_CREATE)
      .map((asked) => Option.getOrUndefined(readCreate(asked.payload))?.name),
    ["Platform", "Platform"],
  );
  assert.equal(tab.control().workspace?.id, PLATFORM.id);
});

test("Workspace settings opens Settings on the listed workspace's page", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().onChooseWorkspace(ACME.id));
  act(() => tab.control().onOpenWorkspaceSettings());

  assert.deepEqual(tab.links, [{ page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id }]);
});

test("Connect GitHub under a plan opens Settings on the plan's workspace's GitHub, read off the open document where the list did not land", () => {
  const tab = mount({
    shown: true,
    tasks: {
      ...OPEN,
      listStatus: TASKS_READ.FAILED,
      workspaces: [PERSONAL, ACME],
      document: { status: TASKS_READ.READY, task: { ...TASK, workspaceId: ACME.id } },
    },
  });

  act(() => tab.control().onOpenWorkspaceGitHub(TASK.id));

  assert.deepEqual(tab.links, [
    {
      page: SETTINGS_VIEW.WORKSPACE,
      section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
      workspaceId: ACME.id,
    },
  ]);
});

test("a plan moved lists the workspace it moved to while it is still open, and a move answered after another plan opened leaves the sidebar where it is", async () => {
  const answers: ((answer: { workspaceId: string }) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } },
    { [ACT_KIND.TASKS_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const staying = tab.control().onMoveTask("billing", ACME.id);
  tab.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "notes" } });
  answers[0]?.({ workspaceId: ACME.id });
  await settle();
  const late = tab.control().workspace?.id;
  tab.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } });
  const moved = tab.control().onMoveTask("billing", ACME.id);
  answers[1]?.({ workspaceId: ACME.id });
  await settle();

  assert.equal(await staying, true);
  assert.equal(
    late,
    PERSONAL.id,
    "the plan open when the move landed is another than the one moved",
  );
  assert.equal(await moved, true);
  assert.equal(tab.control().workspace?.id, ACME.id);
});

test("a refused move says so in a toast, unless its caller says it itself", async () => {
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } },
    { [ACT_KIND.TASKS_MOVE]: () => Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED }) },
  );

  const quiet = await tab.control().onMoveTask("billing", ACME.id, { quiet: true });
  await settle();
  const saidQuietly = newestToastSays();
  const told = await tab.control().onMoveTask("billing", ACME.id);
  await settle();

  const refused = "The task could not be moved. Try again.";
  assert.deepEqual([quiet, told], [false, false]);
  assert.notEqual(saidQuietly, refused, "the caller says the refusal, so no toast does");
  assert.equal(newestToastSays(), refused);
});

test("a move pressed before the workspaces were read still lists the workspace it moved to once they land", async () => {
  const answers: ((answer: { workspaceId: string }) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: [], activeTaskId: "billing" } },
    { [ACT_KIND.TASKS_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const moved = tab.control().onMoveTask("billing", ACME.id);
  tab.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } });
  answers[0]?.({ workspaceId: ACME.id });
  await settle();

  assert.equal(await moved, true);
  assert.equal(tab.control().workspace?.id, ACME.id);
});

test("a workspace chosen while a move is out, even the first chosen after the workspaces land, stays listed when the move lands", async () => {
  const answers: ((answer: { workspaceId: string }) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: { ...TWO_WORKSPACES, workspaces: [], activeTaskId: "billing" } },
    { [ACT_KIND.TASKS_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const moved = tab.control().onMoveTask("billing", ACME.id);
  tab.stand({ tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } });
  act(() => tab.control().onChooseWorkspace(PERSONAL.id));
  answers[0]?.({ workspaceId: ACME.id });
  await settle();

  assert.equal(await moved, true);
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
});

test("a workspace left lists the account's own workspace, whichever was listed, and turns to the home page", () => {
  const own = { ...PERSONAL, personal: true as const };
  const tab = mount({
    shown: true,
    tasks: { ...TWO_WORKSPACES, workspaces: [ACME, own], activeTaskId: "billing" },
  });
  act(() => tab.control().onChooseWorkspace(ACME.id));
  const chosen = tab.control().workspace?.id;

  act(() => tab.control().onLeftWorkspace(ACME.id));
  const afterListed = tab.control().workspace?.id;
  act(() => tab.control().onChooseWorkspace(ACME.id));
  act(() => tab.control().onLeftWorkspace("workspace-elsewhere"));

  assert.equal(chosen, ACME.id);
  assert.equal(afterListed, PERSONAL.id);
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.equal(
    tab.told.includes(ACT_KIND.TASKS_CLOSE),
    true,
    "the open plan is left for the home page",
  );
});

test("a fixture run lists its first workspace's plans under the switcher, and a choice there is kept nowhere", async () => {
  // The window is drawn once the synthetic tasks have landed (`App`).
  await loadTasksFixture();
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.IDLE });
  const staged = fixture.control().listed.tasks.map((task) => task.name);
  act(() => fixture.control().onChooseWorkspace("workspace-acme"));

  assert.deepEqual(staged, ["Teammate invitations", "Billing export"]);
  assert.deepEqual(
    fixture.control().listed.tasks.map((task) => task.name),
    ["Usage alerts"],
  );
  assert.equal(fixture.control().workspaces.length, 2);
  assert.equal(window.localStorage.length, 0);
});

test("an agent profile opens its task on the agent it stages, beside the agent's tab it names, where the tasks profile's task holds no agent", async () => {
  // The window is drawn once the synthetic tasks have landed (`App`).
  await loadTasksFixture();
  const run = { shown: true, fixtureMode: true };
  const tasks = mount({ ...run, profile: RUN_PROFILE.TASKS });
  const checks = mount({ ...run, profile: RUN_PROFILE.AGENT_CHECKS });
  const file = mount({ ...run, profile: RUN_PROFILE.AGENT_FILE });
  const terminal = mount({ ...run, profile: RUN_PROFILE.AGENT_TERMINAL });
  const page = mount({ ...run, profile: RUN_PROFILE.AGENT_PAGE });

  assert.deepEqual(tasks.control().agents.agents, []);
  assert.deepEqual(
    checks.control().agents.agents?.map((agent) => agent.title),
    ["Add teammate invitations"],
  );
  assert.deepEqual(checks.control().sidePanel.tab, { changes: FIXTURE_AGENT_ID });
  assert.equal(
    checks.control().sidePanel.pullRequestViews.get(FIXTURE_AGENT_ID)?.get(undefined),
    PULL_REQUEST_VIEW.CHECKS,
  );
  assert.deepEqual(file.control().sidePanel.tab, { file: "src/members/invite.ts" });
  assert.deepEqual(terminal.control().sidePanel.tab, { terminal: FIXTURE_AGENT_ID });
  assert.deepEqual(page.control().sidePanel.tab, { page: FIXTURE_IDS.PAGE });
});

/** The task as the list names it. */
function listed(): TasksView["tasks"][number] {
  const { document: _document, ...summary } = TASK;
  return summary;
}

/** The task listed and open, its agents as the list followed live carries them. */
function withAgents(agents: readonly AgentSummary[]): TasksView {
  return { ...OPEN, tasks: [listed()], taskAgents: agents };
}

/** The view a launch starts on: nothing open, and the list not yet read. */
const LAUNCHING: TasksView = { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READING };

/** The view once the list is read with nothing open, holding `plans`. */
function listRead(tasks: TasksView["tasks"]): TasksView {
  return { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READY, tasks };
}

/** A select's payload, read back as the act's own schema admits it. */
const readSelect = Schema.decodeUnknownOption(Schema.Struct({ taskId: Schema.String }));

/** The tasks the launch asked the host to open, in order. */
function selected(tab: ReturnType<typeof mount>): string[] {
  return tab.payloads
    .filter((each) => each.kind === ACT_KIND.TASKS_SELECT)
    .flatMap((each) => Option.toArray(readSelect(each.payload)).map((read) => read.taskId));
}

/** A run that had the task open when it quit. */
function quitWithTaskOpen(account = "dev@example.com") {
  mount({ shown: true, account, tasks: { ...OPEN, tasks: [listed()] } });
}

test("a launch opens the plan the account had open at quit, drawing no home page until the host has it open", () => {
  quitWithTaskOpen();
  const tab = mount(
    { shown: true, tasks: LAUNCHING },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  assert.equal(tab.control().page, TASKS_PAGE.HOME);
  assert.equal(tab.control().restoring, true, "the list is still being read");

  tab.stand({ tasks: listRead([listed()]) });
  assert.deepEqual(selected(tab), [TASK.id]);
  assert.equal(tab.control().restoring, true, "the host has not opened it yet");

  tab.stand({ tasks: { ...OPEN, tasks: [listed()] } });
  assert.equal(tab.control().page, TASKS_PAGE.DOCUMENT);
  assert.equal(tab.control().restoring, false);
});

test("a plan deleted since the quit, or kept by another account, leaves the launch on the home page", () => {
  for (const [why, account, tasks] of [
    ["deleted", "dev@example.com", []],
    ["another account", "other@example.com", [listed()]],
  ] as const) {
    quitWithTaskOpen();
    const tab = mount({ shown: true, account, tasks: LAUNCHING });
    tab.stand({ tasks: listRead(tasks) });
    assert.deepEqual(selected(tab), [], why);
    assert.equal(tab.control().restoring, false, why);
    closeWindow();
    window.localStorage.clear();
  }
});

test("a plan the list no longer holds is let go, so it is not opened when it comes back", () => {
  quitWithTaskOpen();
  mount({ shown: true, tasks: LAUNCHING }).stand({ tasks: listRead([]) });
  const tab = mount({ shown: true, tasks: LAUNCHING });
  tab.stand({ tasks: listRead([listed()]) });
  assert.deepEqual(selected(tab), []);
});

test("leaving the plan for the home page lets it go, so the next launch rests on the home page", () => {
  const before = mount({ shown: true, tasks: { ...OPEN, tasks: [listed()] } });
  before.stand({ tasks: listRead([listed()]) });

  const tab = mount({ shown: true, tasks: LAUNCHING });
  assert.equal(tab.control().restoring, false);
  tab.stand({ tasks: listRead([listed()]) });
  assert.deepEqual(selected(tab), []);
});

test("a window reloaded over a plan the host still holds asks for nothing", () => {
  quitWithTaskOpen();
  const tab = mount({ shown: true, tasks: { ...OPEN, tasks: [listed()] } });
  assert.deepEqual(selected(tab), []);
  assert.equal(tab.control().restoring, false);
});

test("a refused reopen takes its ask back and rests on the home page", async () => {
  quitWithTaskOpen();
  const tab = mount(
    { shown: true, tasks: LAUNCHING },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(false) },
  );
  tab.stand({ tasks: listRead([listed()]) });
  await act(settle);
  assert.deepEqual(selected(tab), [TASK.id]);
  assert.equal(tab.control().restoring, false);
});

test("a launch whose list read failed rests on the home page, and opens the plan once Try again reads it", () => {
  quitWithTaskOpen();
  const tab = mount(
    { shown: true, tasks: LAUNCHING },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  tab.stand({ tasks: { ...LAUNCHING, listStatus: TASKS_READ.FAILED } });
  assert.deepEqual(selected(tab), []);
  assert.equal(tab.control().restoring, false);

  tab.stand({ tasks: listRead([listed()]) });
  assert.deepEqual(selected(tab), [TASK.id]);
});

test("another account signing in after a sign-out keeps its own plan, and has it opened", () => {
  quitWithTaskOpen("other@example.com");
  closeWindow();
  const tab = mount(
    { shown: true, tasks: { ...OPEN, tasks: [listed()] } },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  tab.stand({ signedIn: false, tasks: IDLE_TASKS_VIEW });
  tab.stand({ signedIn: true, account: "other@example.com", tasks: LAUNCHING });
  tab.stand({ tasks: listRead([listed()]) });
  assert.deepEqual(selected(tab), [TASK.id]);
});

test("while a page stands its ask, a way out asks instead of going, Leave goes where was asked, and once the ask is down the doors go at once", () => {
  const tab = mount({ shown: true, tasks: listRead([listed()]) });
  act(() => tab.control().inboxView.onOpen());
  const asked: (() => void)[] = [];
  const ask: LeaveAsk = (leave) => asked.push(leave);
  let down: () => void = () => undefined;
  act(() => {
    down = tab.control().leaveGuard.stand(ask);
  });

  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().automationsView.onOpen());
  act(() => tab.control().onChooseWorkspace("workspace-other"));
  assert.equal(tab.control().inboxView.open, true, "the page stands while it is asked about");
  assert.equal(asked.length, 3, "the workspace switcher asks as the other doors do");

  act(() => asked[0]?.());
  assert.equal(tab.control().boardView.open, true, "Leave goes where the first way out went");

  act(() => down());
  act(() => tab.control().inboxView.onOpen());
  assert.equal(tab.control().inboxView.open, true);
  assert.equal(asked.length, 3, "nothing is asked once the ask is down");
});

test("the Board and the Inbox stand in the plan's place in turn: opening one puts the other away, and a plan's press puts the Board away", () => {
  const tab = mount({ shown: true, tasks: listRead([listed()]) });
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().boardView.onOpen());
  assert.equal(tab.control().boardView.open, true);
  assert.equal(tab.control().inboxView.open, false);

  act(() => tab.control().inboxView.onOpen());
  assert.equal(tab.control().boardView.open, false);
  assert.equal(tab.control().inboxView.open, true);

  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().onSelect(TASK.id));
  assert.equal(tab.control().boardView.open, false);
});

test("with no plan open the window rests on the Inbox: it stands once the list lands, and closing it or any page over it lands on it again", () => {
  const tab = mount({ shown: true, tasks: listRead([listed()]) });
  assert.equal(tab.control().inboxView.open, true, "the window opens on the Inbox");

  act(() => tab.control().inboxView.onClose());
  assert.equal(tab.control().inboxView.open, true, "the Inbox has nothing under it to close to");

  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().boardView.onClose());
  assert.equal(tab.control().inboxView.open, true, "the Tasks page put away lands on the Inbox");
  assert.equal(tab.control().resting, true, "the Inbox stands as the page rested on");

  act(() => tab.control().inboxView.onChoose({ taskId: TASK.id, itemId: "item-1" }));
  assert.equal(tab.control().resting, true, "an item chosen in it keeps it the page rested on");

  act(() => tab.control().inboxView.onOpenItem({ taskId: TASK.id, itemId: "item-2" }));
  assert.equal(tab.control().resting, false, "an item opened by a press is a place of its own");
});

test("another workspace listed with no plan open rests the window again, on that workspace's Inbox rather than the item chosen in the last", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => tab.control().onChooseWorkspace(PERSONAL.id));
  act(() =>
    tab.control().inboxView.onChoose({ agentId: "agent-personal", itemId: "item-personal" }),
  );
  assert.deepEqual(tab.control().inboxView.chosen, {
    agentId: "agent-personal",
    itemId: "item-personal",
  });

  act(() => tab.control().onChooseWorkspace(ACME.id));
  assert.equal(tab.control().inboxView.open, true, "the other workspace rests on its Inbox");
  assert.equal(tab.control().inboxView.chosen, undefined, "on none of the last workspace's items");
});

test("an account with nothing yet rests on no page, its welcome standing, and neither does a window whose list is still read", () => {
  const fresh = mount({ shown: true, tasks: listRead([]) });
  assert.equal(fresh.control().page, TASKS_PAGE.HOME);
  assert.equal(fresh.control().inboxView.open, false);
  assert.equal(fresh.control().boardView.open, false);

  const reading = mount({
    shown: true,
    tasks: { ...listRead([listed()]), listStatus: TASKS_READ.READING },
  });
  assert.equal(reading.control().inboxView.open, false);
});

test("one agent's pins are asked one after another, so the service hears an Unpin pressed before a Pin landed after it", async () => {
  const answers: ((answer: PortActResult<typeof ACT_KIND.AGENTS_PIN>) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.AGENTS_PIN]: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    },
  );
  /** Each pin the tab asked of main, in order, as `pinned`. */
  const asked = () =>
    tab.payloads
      .filter((each) => each.kind === ACT_KIND.AGENTS_PIN)
      .map((each) => Option.getOrUndefined(readPin(each.payload))?.pinned);

  await act(async () => {
    tab.control().onPinAgent("agent-1", true);
    tab.control().onPinAgent("agent-1", false);
  });
  const first = asked();
  // The first is answered as refused, which is no matter to the order the second is asked in.
  await act(async () => answers[0]?.({ failure: AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.deepEqual(first, [true]);
  assert.deepEqual(asked(), [true, false]);
});

test("an agent's pin still waiting its turn when the account changes is never asked, so it lands on no one else's pins", async () => {
  const answers: ((answer: PortActResult<typeof ACT_KIND.AGENTS_PIN>) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.AGENTS_PIN]: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    },
  );
  await act(async () => {
    tab.control().onPinAgent("agent-1", true);
    tab.control().onPinAgent("agent-1", false);
  });

  tab.stand({ signedIn: false });
  tab.stand({ signedIn: true, account: "teammate@example.com" });
  await act(async () => answers[0]?.({ failure: AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.equal(tab.payloads.filter((each) => each.kind === ACT_KIND.AGENTS_PIN).length, 1);
});

test("a pin dragged to a new place the service refuses puts back what the drop placed on this Mac, with a toast", async () => {
  const pinned = { ...listed(), pinnedAt: 5 };
  const tab = mount(
    { shown: true, tasks: listRead([pinned]) },
    { [ACT_KIND.TASKS_PIN]: () => Promise.resolve(false) },
  );

  let putBack = 0;
  await act(async () =>
    tab.control().onMovePins([{ agent: false, id: TASK.id, position: "a1" }], () => {
      putBack += 1;
    }),
  );

  assert.equal(putBack, 1);
  assert.equal(newestToastSays(), "The pin could not be moved. Try again.");
});

test("a drag's changes to the sections go to main as one ask, and a refused one says so in a toast", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_WRITE_SECTION]: () => Promise.resolve(false) },
  );
  const make = (id: string, title: string) => ({
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId: "workspace-1",
    title,
  });
  const writes = [
    make("0a1b2c3d-0000-4000-8000-000000000001", "Launch"),
    make("0a1b2c3d-0000-4000-8000-000000000002", "Later"),
  ];

  await act(async () => tab.control().onWriteSections(writes));

  assert.deepEqual(
    tab.payloads.filter((each) => each.kind === ACT_KIND.TASKS_WRITE_SECTION),
    [{ kind: ACT_KIND.TASKS_WRITE_SECTION, payload: { writes } }],
  );
  assert.equal(newestToastSays(), "Your sections could not be changed. Try again.");
});

/** A pin's payload, read back as the act's own schema admits it. */
const readTaskPin = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, pinned: Schema.Boolean }),
);

test("a Plan tab an earlier version pinned to the sidebar becomes the task's own pin once the list names the task, and leaves this Mac's pins once that pin landed; a task already pinned only lets the tab's pin go, and a refused pin keeps the tab's for the next launch", async () => {
  const pin = (task: string, at: number) => ({ task, tab: "plan", label: "Plan", at });
  const kept = () =>
    window.localStorage.setItem(
      "luke.sidePanel",
      JSON.stringify({
        open: true,
        tabs: ["plan"],
        width: 320,
        pins: [pin(TASK.id, 1), pin(OTHER_TASK_ID, 2)],
      }),
    );
  const pinnedAlready = { ...listed(), id: OTHER_TASK_ID, pinnedAt: 5 };
  const asked = (tab: ReturnType<typeof mount>) =>
    tab.payloads
      .filter((each) => each.kind === ACT_KIND.TASKS_PIN)
      .map((each) => Option.getOrUndefined(readTaskPin(each.payload)));

  kept();
  const landed = mount(
    { shown: true, tasks: listRead([listed(), pinnedAlready]) },
    { [ACT_KIND.TASKS_PIN]: () => Promise.resolve(true) },
  );
  await act(async () => undefined);
  assert.deepEqual(asked(landed), [{ taskId: TASK.id, pinned: true }]);
  assert.deepEqual(landed.control().sidePanel.pins, [], "neither tab stays pinned on this Mac");
  closeWindow();

  kept();
  const refused = mount(
    { shown: true, tasks: listRead([listed(), pinnedAlready]) },
    { [ACT_KIND.TASKS_PIN]: () => Promise.resolve(false) },
  );
  await act(async () => undefined);
  // The list read again asks no second time: the tab's pin waits for the next launch.
  refused.stand({ tasks: listRead([{ ...listed(), updatedAt: 9 }, pinnedAlready]) });
  await act(async () => undefined);
  assert.deepEqual(asked(refused), [{ taskId: TASK.id, pinned: true }]);
  assert.deepEqual(
    refused.control().sidePanel.pins.map((pin) => ("task" in pin ? pin.task : pin.agent)),
    [TASK.id],
    "the refused task's tab stays pinned, the pinned task's goes",
  );
});

/** An agent pin's payload, read back as the act's own schema admits it. */
const readAgentPin = Schema.decodeUnknownOption(
  Schema.Struct({
    agentId: Schema.String,
    pinned: Schema.Boolean,
    position: Schema.optionalKey(Schema.String),
  }),
);

test("an agent's tab an earlier version pinned on this Mac becomes the agent's own pin on the account, where it was dragged, once the list followed live names its task, and leaves this Mac only once that pin landed or the account already pinned it", async () => {
  const kept = () =>
    window.localStorage.setItem(
      "luke.sidePanel",
      JSON.stringify({
        open: true,
        tabs: ["plan"],
        width: 320,
        pins: [{ task: TASK.id, tab: { agent: AGENT_ID }, label: "Agent", at: 1, position: "a3" }],
      }),
    );
  const storedPins = () =>
    JSON.parse(window.localStorage.getItem("luke.sidePanel") ?? "{}").pins as unknown[];
  const asked = (tab: ReturnType<typeof mount>) =>
    tab.payloads
      .filter((each) => each.kind === ACT_KIND.AGENTS_PIN)
      .map((each) => Option.getOrUndefined(readAgentPin(each.payload)));
  const live = { ...listRead([listed()]), taskAgents: [RUNNING_AGENT] };
  const carriedPin = [{ agent: AGENT_ID, task: TASK.id, position: "a3" }];
  /** A launch over the kept pin, the service answering its pin as `answer` does. */
  const launch = async (
    tasks: TasksView,
    answer: () => Promise<PortActResult<typeof ACT_KIND.AGENTS_PIN>>,
  ) => {
    kept();
    const tab = mount({ shown: true, tasks }, { [ACT_KIND.AGENTS_PIN]: answer });
    await settle();
    return tab;
  };

  const pending = Promise.withResolvers<PortActResult<typeof ACT_KIND.AGENTS_PIN>>();
  const landed = await launch(listRead([listed()]), () => pending.promise);
  assert.deepEqual(asked(landed), [], "nothing is asked before the list is followed live");
  landed.stand({ tasks: live });
  await settle();
  assert.deepEqual(asked(landed), [{ agentId: AGENT_ID, pinned: true, position: "a3" }]);
  assert.deepEqual(landed.control().sidePanel.carried, carriedPin, "kept while its pin is out");
  assert.equal(storedPins().length, 1);
  await act(async () => pending.resolve({ agent: RUNNING_AGENT }));
  assert.deepEqual(landed.control().sidePanel.carried, []);
  assert.deepEqual(storedPins(), [], "nor does it stay on this Mac");
  closeWindow();

  // The service answers so as well for an agent the account cannot see just now.
  const refused = await launch(live, () =>
    Promise.resolve({ failure: AGENT_CALL_FAILURE.NOT_FOUND }),
  );
  assert.equal(asked(refused).length, 1);
  assert.deepEqual(
    refused.control().sidePanel.carried,
    carriedPin,
    "a refused pin keeps the tab's for the next launch",
  );
  closeWindow();

  const already = await launch(
    { ...live, taskAgentPins: [{ agentId: AGENT_ID, taskId: TASK.id, pinnedAt: 5 }] },
    () => Promise.resolve({ agent: RUNNING_AGENT }),
  );
  assert.deepEqual(asked(already), [], "an agent already pinned is asked nothing");
  assert.deepEqual(already.control().sidePanel.carried, []);
  assert.deepEqual(storedPins(), []);
});

/** A start's agent, read back where it names one. */
const readAgentNamed = Schema.decodeUnknownOption(
  Schema.Struct({
    planning: Schema.optionalKey(Schema.Boolean),
    agent: Schema.optionalKey(
      Schema.Struct({
        idempotencyKey: Schema.String,
        prompt: Schema.optionalKey(Schema.String),
        model: Schema.optionalKey(Schema.String),
        effort: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
);

/** The task New task's Agent mode starts, as the host opens it once started. */
const AGENT_TASK: TasksView = {
  ...OPEN,
  activeTaskId: OTHER_TASK_ID,
  document: {
    status: TASKS_READ.READY,
    task: { ...TASK, id: OTHER_TASK_ID, name: "Untitled", repository: "acme/web" },
  },
};

/** The key New task's card minted for its agent's start. */
const AGENT_KEY = "5b7e2c1a-9d4f-4a3b-8e6c-2f1d0a9b8c7e";

/** Agent mode's start pressed with the words and the chip's model, answering why the card holds it, then the task standing open. */
async function startAgentTask(tab: ReturnType<typeof mount>) {
  const choice = { model: "anthropic/claude-opus-5.5", effort: "high" };
  const prompt = "Make the sidebar keep its folds.";
  act(() => tab.control().onNewTask());
  let note: Failure | undefined = { reason: FAILURE_REASON.OTHER, text: "unanswered" };
  await act(async () => {
    note = await tab.control().newTask.start("", "acme/web", undefined, {
      handed: { idempotencyKey: AGENT_KEY, prompt, attachments: [], choice },
    });
  });
  tab.stand({ tasks: AGENT_TASK });
  await settle();
  const starts = tab.payloads
    .filter(({ kind }) => kind === ACT_KIND.TASKS_START)
    .map(({ payload }) => Option.getOrUndefined(readAgentNamed(payload)));
  return { choice, prompt, note, starts };
}

test("New sub-task on the open task the list has not read opens New task under that task", () => {
  const tab = mount({ shown: true, tasks: OPEN });

  act(() => tab.control().onNewChildTask(TASK.id));

  assert.equal(tab.control().newTask.open, true);
  assert.deepEqual(tab.control().newTask.preset, {
    parent: {
      taskId: TASK.id,
      name: "Teammate invitations",
      workspaceId: "workspace-personal",
      repository: null,
    },
  });
});

test("a group's quick add sends one quiet start with the group's standing and no agent, asking no one assigned as nothing", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => Promise.resolve({ planId: OTHER_TASK_ID }) },
  );
  let refused: Failure | undefined = { reason: FAILURE_REASON.OTHER, text: "unanswered" };
  await act(async () => {
    refused = await tab.control().onQuickAdd("Export invoices as CSV", {
      standing: { status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.HIGH, assigneeId: null },
    });
  });

  assert.equal(refused, undefined);
  assert.deepEqual(
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.TASKS_START).map(({ payload }) => payload),
    [
      {
        name: "Export invoices as CSV",
        status: TASK_STATUS.BACKLOG,
        priority: TASK_PRIORITY.HIGH,
        planning: false,
        quiet: true,
      },
    ],
  );
});

test("New task's Agent mode sends one start carrying the agent, its words and model, and opens the task on the agent it started", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: withAgents([started]) },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
    },
  );
  const { choice, prompt, note, starts } = await startAgentTask(tab);

  assert.equal(note, undefined);
  assert.equal(tab.control().newTask.open, false, "the dialog closes");
  assert.equal(starts.length, 1);
  const { idempotencyKey, ...agent } = starts[0]?.agent ?? { idempotencyKey: "" };
  assert.equal(starts[0]?.planning, false);
  assert.deepEqual(
    agent,
    { prompt, ...choice },
    "the agent carries the words and the chip's model",
  );
  assert.equal(idempotencyKey, AGENT_KEY, "the agent carries the card's key");
  assert.deepEqual(
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.AGENTS_START),
    [],
    "no second call starts the agent",
  );
  assert.equal(tab.control().agents.draft, undefined, "no draft stands in its place");
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID }, "the task opens on its tab");
});

test("archiving a task's last agent takes its tab at once, and a refused archive brings it back", async () => {
  const archived = Promise.withResolvers<PortActResult<typeof ACT_KIND.AGENTS_ARCHIVE>>();
  const tab = mount(
    { shown: true, tasks: withAgents([RUNNING_AGENT]) },
    {
      [ACT_KIND.AGENTS_ARCHIVE]: () => archived.promise,
    },
  );
  await settle();
  act(() => tab.control().mainTabs.onChoose({ agent: AGENT_ID }));
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });

  // The host draws the archive on the list as it is asked, and takes it back as the service refuses it.
  await act(async () => {
    void tab.control().agents.onArchive(AGENT_ID, true);
  });
  tab.stand({ tasks: withAgents([{ ...RUNNING_AGENT, archivedAt: 5 }]) });
  await settle();
  assert.deepEqual(tab.control().mainTabs.tabs, [MAIN_TAB.OVERVIEW], "the agent leaves at once");

  tab.stand({ tasks: withAgents([RUNNING_AGENT]) });
  await act(async () => archived.resolve({ failure: AGENT_CALL_FAILURE.NOT_FOUND }));
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
});

test("a task started, with an agent or without, leaves a hidden side panel hidden", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: withAgents([started]) },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
    },
  );
  act(() => tab.control().sidePanel.onSetOpen(false));
  assert.equal(tab.control().sidePanel.open, false);

  await act(async () => {
    await tab.control().newTask.start("Dark mode", null, undefined);
  });
  assert.equal(tab.control().sidePanel.open, false, "a bare task opens no plan beside it");

  await startAgentTask(tab);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().sidePanel.open, false, "the plan does not open beside the agent");
});

test("New task's agent opens alone, no plan beside it, and the task left draws no panel until asked, since a tab standing opens none", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: withAgents([started]) },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
    },
  );
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });

  await startAgentTask(tab);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().sidePanel.open, false, "the plan does not open beside the agent");

  tab.stand({ tasks: OPEN });
  await settle();
  assert.deepEqual(
    panelOf(tab),
    { open: false, tab: SIDE_PANEL_TAB.COMMENTS },
    "the task left keeps its tab, shut",
  );
});

test("New task's agent stands on its task with the words it started on as its first line before the task's agents or its transcript are read", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
    },
  );
  const { prompt } = await startAgentTask(tab);

  const agents = tab.control().agents;
  assert.deepEqual(
    agents.agents?.map((agent) => agent.id),
    [AGENT_ID],
    "the agent stands as the task's list",
  );
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID }, "the task opens on its tab");
  assert.equal(agents.opening?.agentId, AGENT_ID);
  assert.equal(agents.opening?.line.text, prompt, "its first line is the words it started on");
});

test("New task's agent start opens its page at once on the words as its agent's first line, before the service answers, which opens the agent's own tab in its place", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const answers: Array<(answer: PortActResult<typeof ACT_KIND.TASKS_START>) => void> = [];
  const tab = mount(
    { shown: true, tasks: withAgents([started]) },
    {
      [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)),
    },
  );
  const prompt = "Make the sidebar keep its folds.";
  act(() => tab.control().onNewTask());
  let note: Promise<Failure | undefined> = Promise.resolve(undefined);
  act(() => {
    note = tab.control().newTask.start("", "acme/web", undefined, {
      handed: { idempotencyKey: AGENT_KEY, prompt, attachments: [], choice: undefined },
    });
  });

  assert.equal(tab.control().newTask.open, false, "the dialog closes as Start is pressed");
  assert.equal(tab.control().starting?.text, prompt, "the page stands on the words at once");

  await act(async () => {
    answers[0]?.({ planId: OTHER_TASK_ID, agentStart: { agent: started } });
    await note;
  });
  tab.stand({ tasks: AGENT_TASK });
  await settle();
  assert.equal(tab.control().starting, undefined, "the task's own page takes its place");
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().agents.opening?.line.text, prompt);
});

test("what the developer opened while New task's agent start was out, a page and New task again, still stands as the start lands", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const answers: Array<(answer: PortActResult<typeof ACT_KIND.TASKS_START>) => void> = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)) },
  );
  act(() => tab.control().onNewTask());
  let note: Promise<Failure | undefined> = Promise.resolve(undefined);
  act(() => {
    note = tab.control().newTask.start("", "acme/web", undefined, {
      handed: { idempotencyKey: AGENT_KEY, prompt: "Fix it.", attachments: [], choice: undefined },
    });
  });
  act(() => tab.control().automationsView.onOpen());
  act(() => tab.control().onNewTask());

  await act(async () => {
    answers[0]?.({ planId: OTHER_TASK_ID, agentStart: { agent: started } });
    await note;
  });
  assert.equal(tab.control().automationsView.open, true, "the page stands");
  assert.equal(tab.control().newTask.open, true, "New task stands");
  assert.equal(tab.control().starting, undefined);
});

test("New task's agent start refused after its page opened opens the card again on the repository, model, and press it held, saying why, over the version history it was asked from", async () => {
  const answers: Array<(answer: PortActResult<typeof ACT_KIND.TASKS_START>) => void> = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)),
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
    },
  );
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.VERSION, planId: TASK.id, revision: 3 },
    }),
  );
  assert.equal(tab.control().history.open, true);
  const handed = {
    idempotencyKey: AGENT_KEY,
    prompt: "Make the sidebar keep its folds.",
    attachments: [],
    choice: undefined,
  };
  const card = {
    repository: "acme/web",
    choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
    press: {
      key: AGENT_KEY,
      ask: { repository: "acme/web", workspaceId: undefined, agent: handed },
    },
    words: handed.prompt,
  };
  act(() => tab.control().onNewTask());
  let note: Promise<Failure | undefined> = Promise.resolve(undefined);
  act(() => {
    note = tab.control().newTask.start("", "acme/web", undefined, { handed, card });
  });
  assert.equal(tab.control().newTask.open, false);

  let refused: Failure | undefined;
  await act(async () => {
    answers[0]?.({ failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
    refused = await note;
  });
  assert.ok(refused !== undefined);
  assert.equal(tab.control().starting, undefined, "the page gives way");
  assert.equal(tab.control().newTask.open, true, "the card opens again");
  assert.deepEqual(tab.control().newTask.preset?.refused, { card, note: refused });
  assert.equal(tab.control().history.open, true, "the version history stands behind it again");
});

test("Create with an agent opens New task's card for an automation's agent over the Automations page, and a start refused after it closed opens the same card again, the page behind it", async () => {
  const answers: Array<(answer: PortActResult<typeof ACT_KIND.TASKS_START>) => void> = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)) },
  );
  act(() => tab.control().automationsView.onOpen());
  act(() => tab.control().onNewAutomationAgent());
  assert.equal(tab.control().newTask.open, true);
  assert.deepEqual(tab.control().newTask.preset, { purpose: NEW_TASK_PURPOSE.AUTOMATION });
  assert.equal(tab.control().automationsView.open, true, "the page stands behind the card");

  const handed = {
    idempotencyKey: AGENT_KEY,
    prompt: "# Create an automation",
    attachments: [],
    choice: undefined,
  };
  const card = {
    purpose: NEW_TASK_PURPOSE.AUTOMATION,
    repository: "acme/web",
    choice: undefined,
    press: {
      key: AGENT_KEY,
      ask: { repository: "acme/web", workspaceId: undefined, agent: handed },
    },
    words: handed.prompt,
  };
  let note: Promise<Failure | undefined> = Promise.resolve(undefined);
  act(() => {
    note = tab.control().newTask.start("", "acme/web", undefined, { handed, card });
  });
  assert.equal(tab.control().newTask.open, false);
  await act(async () => {
    answers[0]?.({ failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
    await note;
  });
  assert.equal(tab.control().newTask.open, true, "the card opens again");
  assert.equal(
    tab.control().newTask.preset?.purpose,
    NEW_TASK_PURPOSE.AUTOMATION,
    "for an automation's agent",
  );
  assert.equal(tab.control().automationsView.open, true, "the page stands behind it again");
});

test("an agent refused as New task's Agent mode started its task opens the task on a draft holding the words, model, and why, whose Retry starts the agent on that task under the start's key", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({
          planId: OTHER_TASK_ID,
          agentStart: { failure: AGENT_CALL_FAILURE.UNANSWERED },
        }),
      // The host answers a Start once the list carries the agent its own Start made.
      [ACT_KIND.AGENTS_START]: () => {
        tab.stand({
          tasks: {
            ...AGENT_TASK,
            tasks: [{ ...listed(), id: OTHER_TASK_ID }],
            taskAgents: [started],
          },
        });
        return Promise.resolve({ agent: started });
      },
    },
  );
  const { choice, prompt, note, starts } = await startAgentTask(tab);
  const draft = tab.control().agents.draft;

  assert.equal(note, undefined, "the task started, so the card says nothing");
  assert.equal(tab.control().newTask.open, false, "the dialog closes");
  assert.ok(draft, "the new task holds a draft agent");
  assert.deepEqual(
    { prompt: draft.prompt, choice: draft.choice },
    { prompt, choice },
    "the draft holds the words and the model",
  );
  assert.match(draft.refused?.text ?? "", /could not be started/u);
  assert.deepEqual(tab.control().mainTabs.tab, { draft: draft.id }, "the task opens on its tab");
  assert.equal(draft.id, AGENT_KEY, "the draft holds the start's key");
  assert.deepEqual(
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.AGENTS_START),
    [],
    "nothing is sent again by itself",
  );

  // The draft tab's Retry sends what the draft holds.
  await act(async () => {
    await tab.control().agents.startPrompt(draft.id, draft.prompt, draft.choice, draft.attachments);
  });
  await settle();
  const retries = tab.payloads.filter(({ kind }) => kind === ACT_KIND.AGENTS_START);
  assert.equal(retries.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(retries[0]?.payload)), {
    taskId: OTHER_TASK_ID,
    idempotencyKey: draft.id,
    prompt,
    ...choice,
  });
  assert.equal(starts.length, 1, "the task's start is never sent again");
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
});

test("an agent's title first landing on a task still Untitled reads the tasks again, so the name it took shows; a titled task asks nothing", async () => {
  const viewOf = (name: string, title: string | null): TasksView => ({
    ...withAgents([{ ...RUNNING_AGENT, title }]),
    tasks: [{ ...listed(), name }],
    document: { status: TASKS_READ.READY, task: { ...TASK, name } },
  });
  const refreshes = (tab: ReturnType<typeof mount>) =>
    tab.told.filter((kind) => kind === ACT_KIND.TASKS_REFRESH).length;
  const tab = mount({ shown: true, tasks: viewOf("Untitled", null) });
  await settle();
  const before = refreshes(tab);
  tab.stand({ tasks: viewOf("Untitled", "Fix token refresh") });
  await settle();
  const landed = refreshes(tab) - before;
  closeWindow();

  const named = mount({ shown: true, tasks: viewOf(TASK.name, null) });
  await settle();
  const namedBefore = refreshes(named);
  named.stand({ tasks: viewOf(TASK.name, "Fix token refresh") });
  await settle();

  assert.equal(landed, 1);
  assert.equal(refreshes(named) - namedBefore, 0);
});

/** The payload of every act of `kind` the tab asked, in order. */
function payloadsOf(tab: ReturnType<typeof mount>, kind: PortActKind): unknown[] {
  return tab.payloads.filter((asked) => asked.kind === kind).map((asked) => asked.payload);
}

/** Opens a new agent's draft on the open task as the column's "+" does, and answers it. */
function openDraft(tab: ReturnType<typeof mount>) {
  act(() => {
    const control = tab.control();
    control.mainTabs.onChoose({ draft: control.agents.onNewDraft() });
  });
  return tab.control().agents.draft ?? assert.fail("no draft opened");
}

test('a task with no agent shows its Overview alone, and a draft the "+" opens closes once left holding nothing, while one holding words stays', async () => {
  const tab = mount({ shown: true, tasks: withAgents([]) });
  await settle();
  const column = () => tab.control().mainTabs;
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW], "no draft opens by itself");
  assert.equal(column().tab, MAIN_TAB.OVERVIEW);

  const empty = openDraft(tab);
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, { draft: empty.id }]);
  assert.deepEqual(column().tab, { draft: empty.id });
  act(() => column().onChoose(MAIN_TAB.OVERVIEW));
  await settle();
  assert.equal(tab.control().agents.draft, undefined, "the empty draft left is let go");
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW]);

  // One left for another task is let go too, so coming back finds Overview alone.
  openDraft(tab);
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();
  tab.stand({ tasks: withAgents([]) });
  await settle();
  assert.equal(tab.control().agents.draft, undefined, "the draft left with its task is let go");
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW]);

  // And one left for another place, as Settings hides the tasks.
  openDraft(tab);
  tab.stand({ shown: false });
  await settle();
  tab.stand({ shown: true });
  await settle();
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW], "the draft left for Settings is let go");

  const written = openDraft(tab);
  act(() => tab.control().agents.onDraftChange({ prompt: "Fix login." }));
  act(() => column().onChoose(MAIN_TAB.OVERVIEW));
  await settle();
  assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, { draft: written.id }], "words keep it");
  assert.deepEqual(payloadsOf(tab, ACT_KIND.AGENTS_START), [], "nothing is started");
});

test("closing a draft holding words lets it go at once, and its toast's Undo opens its tab again with the same words, files, and chips", async () => {
  const tab = mount({ shown: true, tasks: withAgents([]) });
  await settle();
  const draft = openDraft(tab);
  const prompt = "Rename the invite email's subject.";
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  const choice = { model: "openai/gpt-6.1-sol", effort: "xhigh" } as const;
  act(() => tab.control().agents.onDraftChange({ prompt, choice }));
  act(() => tab.control().agents.onDraftAttachments((held) => [...held, notes]));

  act(() => {
    tab.control().mainTabs.onClose({ draft: draft.id });
    tab.control().agents.onDiscardDraft(draft.id);
  });
  await settle();
  assert.notEqual(tab.control().agents.draft?.id, draft.id, "the draft closed is let go at once");
  assert.equal(newestToastSays(), "Draft closedUndo");

  act(() => _undoButton().click());
  await settle();
  assert.deepEqual(tab.control().agents.draft, {
    id: draft.id,
    prompt,
    attachments: [notes],
    choice,
    disabledServers: [],
  });
  assert.deepEqual(tab.control().mainTabs.tab, { draft: draft.id }, "and its tab is shown again");
  assert.deepEqual(payloadsOf(tab, ACT_KIND.AGENTS_START), [], "nothing is started");
});

test("a draft closed with words whose place a fork has taken since is laid into that fork by Undo, the fork kept", async () => {
  const tab = mount({ shown: true, tasks: withAgents([]) });
  await settle();
  const closed = openDraft(tab);
  act(() => tab.control().agents.onDraftChange({ prompt: "Fix login." }));
  act(() => {
    tab.control().mainTabs.onClose({ draft: closed.id });
    tab.control().agents.onDiscardDraft(closed.id);
  });
  await settle();
  const fork = { agentId: AGENT_ID, opening: "Ship the invite email." };
  act(() => {
    tab.control().agents.onForkDraft(fork);
  });
  act(() => tab.control().agents.onDraftChange({ prompt: "Keep its tests." }));

  act(() => _undoButton().click());
  await settle();
  const draft = tab.control().agents.draft;
  assert.equal(draft?.prompt, "Keep its tests.\n\nFix login.");
  assert.deepEqual(draft?.fork, fork, "the fork written since is kept");
  assert.deepEqual(tab.control().mainTabs.tab, { draft: draft?.id }, "and its tab is shown");
});

test("a closed draft's Undo is withdrawn as its task is left", async () => {
  const tab = mount({ shown: true, tasks: withAgents([]) });
  await settle();
  const closed = openDraft(tab);
  act(() => tab.control().agents.onDraftChange({ prompt: "Fix login." }));
  act(() => tab.control().agents.onDiscardDraft(closed.id));
  await settle();
  assert.equal(newestToastSays(), "Draft closedUndo");

  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();
  assert.notEqual(newestToastSays(), "Draft closedUndo");
});

test("a task opened is timed from the press to its document drawn ready, and one refused is timed by no span", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(2_000_000);
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  let opens = true;
  const tab = mount(
    { shown: true, tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(opens) },
  );

  act(() => tab.control().onSelect(TASK.id));
  vi.setSystemTime(2_000_650);
  tab.stand({ tasks: OPEN });

  // The task open already is no wait; another refused is no span.
  act(() => tab.control().onSelect(TASK.id));
  opens = false;
  act(() => tab.control().onSelect(OTHER_TASK_ID));
  await act(async () => undefined);
  tab.stand({
    tasks: {
      ...OPEN,
      activeTaskId: OTHER_TASK_ID,
      document: { status: TASKS_READ.READY, task: { ...TASK, id: OTHER_TASK_ID } },
    },
  });
  uninstall();
  vi.useRealTimers();

  assert.deepEqual(
    spans.map((span) => ({
      name: span.name,
      waited: span.endedAt - span.startedAt,
      attributes: span.attributes(),
    })),
    [
      {
        name: PANEL_SPAN.TASK_OPEN,
        waited: 650,
        attributes: { [PANEL_SPAN_ATTRIBUTE.PLAN_CHARS]: TASK.document.body.length },
      },
    ],
  );
});

/** A status write's payload, read back as the act's own schema admits it. */
const readStanding = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, status: Schema.optionalKey(Schema.String) }),
);

test("Mark done's Undo leaves a status chosen since alone, though that choice is still unanswered", async () => {
  const view: TasksView = {
    ...IDLE_TASKS_VIEW,
    listStatus: TASKS_READ.READY,
    workspaces: [PERSONAL],
    tasks: [{ ...row("notes", 4), status: TASK_STATUS.TODO }],
  };
  let answered = 0;
  const tab = mount({ tasks: view }, {
    // The Mark done is kept, and the status chosen after it waits on the service.
    [ACT_KIND.TASKS_SET_STANDING]: () => {
      answered += 1;
      return answered === 1 ? Promise.resolve(true) : new Promise(() => undefined);
    },
  } as Parameters<typeof mount>[1]);

  act(() => tab.control().onSettleTasks(["notes"], SETTLED_STATUS.DONE));
  await settle();
  void tab.control().onSetTaskStanding("notes", { status: TASK_STATUS.IN_PROGRESS });
  act(() => _undoButton().click());
  await settle();

  const written = tab.payloads
    .filter(({ kind }) => kind === ACT_KIND.TASKS_SET_STANDING)
    .map(({ payload }) => Option.getOrUndefined(readStanding(payload))?.status);
  assert.deepEqual(written, [TASK_STATUS.DONE, TASK_STATUS.IN_PROGRESS]);
});

/** A follow the host holds open and never tells a change on. */
const heldFollow = {
  next: () => new Promise<never>(() => undefined),
  return: async () => ({ done: true, value: undefined }) as const,
  [Symbol.asyncIterator]() {
    return heldFollow;
  },
  [Symbol.asyncDispose]: async () => undefined,
};

/**
 * A registry whose atoms count on this clock, as the window's count on its
 * own. Note that the task's cloud Browser tabs are answered as none and
 * followed quietly, because a read refused is tried again on its beat, and a
 * day passed on this clock would run every one of those beats.
 */
function registryOn(clock: Clock.Clock): AtomRegistry {
  fakeActPort({
    [ACT_KIND.TASKS_BROWSER_TABS]: () => Promise.resolve({ tabs: [] }),
    [ACT_KIND.TASKS_BROWSER_TABS_FOLLOW]: () => Promise.resolve(heldFollow as never),
  });
  return AtomRegistryModule.make({
    initialValues: [
      [rendererRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))],
      [timeRuntime, AsyncResult.success(Context.make(Clock.Clock, clock))],
    ],
  });
}

/** Lets `span` pass on the test's clock, then lets what fell due land. */
const passing = (span: Duration.Input) => Effect.andThen(TestClock.adjust(span), landed);

const FINISHED_ID = "4f6e2a1b-7c3d-4e5f-8a9b-0c1d2e3f4a5b";
const UNSEEN_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";

/** Two agents beside the running one: one whose turn ended and was seen, and one whose turn ended unseen. */
const IDLE_AGENTS: readonly AgentSummary[] = [
  RUNNING_AGENT,
  { ...RUNNING_AGENT, id: FINISHED_ID, createdAt: 4, status: AGENT_STATUS.COMPLETED },
  { ...RUNNING_AGENT, id: UNSEEN_ID, createdAt: 5, status: AGENT_STATUS.COMPLETED },
];

/** An item waiting in the open task's Inbox, posted by the agent given. */
function waitingFrom(agentId: string): AppInboxTask {
  return {
    taskId: TASK.id,
    items: [{ id: `item-${agentId}`, agentId, title: "A question", postedAt: 1 }],
  };
}

it.effect(
  "a side panel tab not viewed for a day closes itself onto ⇧⌘T's stack, while the tab shown, a fixed tab, and a pinned one stay",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: withAgents([RUNNING_AGENT]) },
        {},
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const panel = () => tab.control().sidePanel;
      const file = { file: FILE_REF.path };
      const pulls = { changes: AGENT_ID };
      act(() => panel().onOpenFile(FILE_REF));
      act(() => panel().onChoose(pulls));
      act(() => panel().onPin({ task: TASK.id }, pulls, "Pull request"));
      act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
      yield* landed;
      const strip = panel().strip;
      assert.deepEqual(strip, [file, pulls, SIDE_PANEL_TAB.COMMENTS]);

      yield* passing(Duration.hours(23));
      assert.deepEqual(panel().strip, strip, "a tab viewed within the day stays");

      yield* passing(Duration.hours(1));
      assert.deepEqual(
        panel().strip,
        [pulls, SIDE_PANEL_TAB.COMMENTS],
        "the file's tab closed; the pinned Pull request and the tab shown stay",
      );
      assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.COMMENTS });

      act(() => tab.control().onReopenClosedTab?.());
      assert.deepEqual(panel().strip, strip, "⇧⌘T stands it back where it stood");
      assert.deepEqual(panel().tab, file);
    }),
);

it.effect(
  "an agent's tab not viewed for a day closes unless the agent works, waits on the developer, or ended unseen, and opens again as an Inbox item of its wakes it, where one closed by hand stays closed",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: withAgents(IDLE_AGENTS), unseenAgents: [UNSEEN_ID] },
        {},
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      const running = { agent: AGENT_ID };
      const finished = { agent: FINISHED_ID };
      const unseen = { agent: UNSEEN_ID };
      act(() => column().onChoose(finished));
      act(() => column().onChoose(running));
      yield* landed;
      assert.deepEqual(column().tabs, [MAIN_TAB.OVERVIEW, running, finished, unseen]);

      yield* passing(Duration.days(1));
      assert.deepEqual(
        column().tabs,
        [MAIN_TAB.OVERVIEW, running, unseen],
        "the finished agent's tab closed",
      );
      assert.deepEqual(column().tab, running);
      assert.ok(tab.control().onReopenClosedTab, "and stands on ⇧⌘T's stack");

      act(() => column().onClose(unseen));
      tab.stand({ inboxWaiting: [waitingFrom(FINISHED_ID), waitingFrom(UNSEEN_ID)] });
      yield* landed;
      assert.deepEqual(
        column().tabs,
        [MAIN_TAB.OVERVIEW, running, finished],
        "the agent closed for being idle is back with its item, the one closed by hand is not",
      );
      assert.deepEqual(
        column().tab,
        running,
        "and comes back without taking the shown tab's place",
      );
    }),
);

it.effect(
  "when a tab was last viewed is kept across a launch, so a Pull request tab left a day before the window opens again closes as its task opens",
  () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock;
      const listed = {};
      const pulls = { changes: AGENT_ID };
      const first = mount({ shown: true, tasks: OPEN }, listed, registryOn(clock));
      yield* landed;
      act(() => first.control().sidePanel.onChoose(pulls));
      act(() => first.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
      yield* landed;
      assert.deepEqual(first.control().sidePanel.strip, [pulls, SIDE_PANEL_TAB.COMMENTS]);
      closeWindow();

      yield* TestClock.adjust(Duration.hours(25));
      const again = mount({ shown: true, tasks: OPEN }, listed, registryOn(clock));
      yield* landed;
      assert.deepEqual(again.control().sidePanel.strip, [SIDE_PANEL_TAB.COMMENTS]);
      assert.ok(again.control().onReopenClosedTab, "and stands on ⇧⌘T's stack");
    }),
);

it.effect(
  "a tab kept before the window counted when tabs were viewed counts as viewed now, so nothing closes the moment it is first counted",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Duration.toMillis(Duration.days(30)));
      window.localStorage.setItem(
        "luke.mainTabs",
        JSON.stringify({
          closedAgents: [],
          tasks: { [TASK.id]: { recent: [{ agent: FINISHED_ID }, { agent: AGENT_ID }] } },
        }),
      );
      const tab = mount(
        { shown: true, tasks: withAgents(IDLE_AGENTS), unseenAgents: [UNSEEN_ID] },
        {},
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      const running = { agent: AGENT_ID };
      const finished = { agent: FINISHED_ID };
      const unseen = { agent: UNSEEN_ID };
      yield* passing(Duration.minutes(1));
      assert.deepEqual(
        column().tabs,
        [MAIN_TAB.OVERVIEW, running, finished, unseen],
        "its first count leaves it open",
      );

      yield* passing(Duration.days(1));
      assert.deepEqual(
        column().tabs,
        [MAIN_TAB.OVERVIEW, running, unseen],
        "a day unviewed after it closes it",
      );
    }),
);

it.effect(
  "an agent's tab left chosen under the side panel filling the window is no longer viewed, so a day of it closes the tab",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: withAgents(IDLE_AGENTS), unseenAgents: [UNSEEN_ID] },
        {},
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      act(() => column().onChoose({ agent: FINISHED_ID }));
      act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
      act(() => tab.control().sidePanel.onToggleFullScreen());
      yield* landed;
      assert.equal(tab.control().sidePanel.fullScreen, true);

      yield* passing(Duration.days(1));
      assert.deepEqual(column().tabs, [
        MAIN_TAB.OVERVIEW,
        { agent: AGENT_ID },
        { agent: UNSEEN_ID },
      ]);
    }),
);

it.effect(
  "a tab shown as its task is left for one whose agents are still unread is stamped as it was left, not when it was last stamped",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: withAgents(IDLE_AGENTS), unseenAgents: [UNSEEN_ID] },
        { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      act(() => column().onChoose({ agent: FINISHED_ID }));
      act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
      yield* passing(Duration.minutes(50));
      tab.stand({ tasks: { ...withAgents(IDLE_AGENTS), activeTaskId: OTHER_TASK_ID } });
      yield* landed;
      // The panel filling the window over the column keeps the tab from being viewed again on return.
      act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.COMMENTS));
      act(() => tab.control().sidePanel.onToggleFullScreen());

      yield* passing(Duration.hours(23));
      tab.stand({ tasks: withAgents(IDLE_AGENTS) });
      yield* passing(Duration.minutes(30));
      assert.deepEqual(
        column().tabs,
        [MAIN_TAB.OVERVIEW, { agent: AGENT_ID }, { agent: FINISHED_ID }, { agent: UNSEEN_ID }],
        "a day has not passed since it was left",
      );

      yield* passing(Duration.hours(1));
      assert.deepEqual(column().tabs, [
        MAIN_TAB.OVERVIEW,
        { agent: AGENT_ID },
        { agent: UNSEEN_ID },
      ]);
    }),
);
