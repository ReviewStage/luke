// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import type { Board } from "@luke/features/board-wire";
import { CHANNEL_KIND, MEMBER_KIND } from "@luke/features/chat-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentChatAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import {
  LINK_PLACE,
  PULL_REQUEST_THREAD_VIEW,
  type PullRequestThreadView,
} from "@luke/features/link-grammar";
import { MENTION_KIND } from "@luke/features/mention-link";
import { TASK_ISSUE_PROVIDER } from "@luke/features/task-issue-wire";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import { PLAN_ACTOR, TASK_PRIORITY, TASK_STATUS, type Task } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCode,
  type TaskCodeShowing,
  type TasksView,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  type AppInboxTask,
  type AppInboxTaskHolding,
  type AppStateDelivery,
  type AppStateSnapshot,
  RUN_PROFILE,
} from "@luke/host/app-state";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS } from "@luke/host/fixture-stage";
import { LIVE_STATUS } from "@luke/live";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { experimentsOn } from "@luke/settings/testing";
import { timeRuntime } from "@luke/ui";
import { CHAT_PLACE, FOR_YOU } from "@luke/ui/chat-model";
import { memoryHistory } from "@luke/ui/history-adapter";
import { PENDING_LIMIT } from "@luke/ui/pending-values";
import { DOCUMENT_REGION, SETTLED_STATUS, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF } from "@luke/voice/avatar";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "@luke/voice/voice-view";
import { AsyncIteratorClass } from "@orpc/client";
import { Clock, Context, Duration, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import * as AtomRegistryModule from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { type ActHandle, pressAct } from "../act.js";
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
import { rendererRegistry, rendererRuntime } from "../renderer-runtime.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import {
  FAKE_ANSWER,
  fakeActPort,
  fakeActs,
  fakeAppBridge,
  fakeAppBridgeCalls,
  refusedOnPort,
} from "../testing/app-bridge.js";
import {
  DESKTOP_CAPABILITIES,
  deliveryOf,
  handCapabilities,
  handState,
  stateWith,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { FIXTURE_AGENT_ID } from "./agent-fixture.js";
import { NEW_TASK_PURPOSE } from "./new-task-purpose.js";
import { ofPullRequestTab } from "./pull-request-number.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { loadTasksFixture } from "./tasks-fixture-loader.js";
import { PULL_REQUEST_VIEW, SIDE_PANEL_TAB } from "./use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type LeaveAsk,
  type TasksControl,
  useLeaveGuard,
  useTasksTab,
} from "./use-tasks-tab.js";
import { CHAT_READ_PAUSE } from "./use-workspace-chat.js";

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

/** A voice command's payload, read back as the act's own schema admits it. */
const readVoiceCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.Literals(Object.values(VOICE_COMMAND)) }),
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
  /** What the voice window was told to do, each time it was told. */
  const voiceCommands: VoiceCommand[] = [];
  /** Each asked act's payload, unread until a test reads it as the act's schema would. */
  const payloads: { readonly kind: PortActKind; readonly payload: unknown }[] = [];
  const links: SettingsLink[] = [];
  const record = (kind: PortActKind) => {
    if (!kind.startsWith("codingAgents.")) told.push(kind);
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
  if (standing.history) installWindowHistory(memoryHistory());
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
          if (kind === ACT_KIND.CODING_AGENTS_SHOWN && shown !== undefined) {
            shownAgents.push(shown.agentId);
          }
          const voiceCommand = Option.getOrUndefined(readVoiceCommand(args[0]));
          if (kind === ACT_KIND.VOICE_COMMAND && voiceCommand !== undefined) {
            voiceCommands.push(voiceCommand.command);
          }
        }) as ActHandle["tell"],
      },
      tasks: held.tasks,
      run: { fixtureMode: held.fixtureMode, profile: held.profile },
      signedIn: held.signedIn,
      account: held.signedIn ? held.account : undefined,
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: held.shown,
      unseenAgents: held.unseenAgents,
      inboxWaiting: held.inboxWaiting,
      inboxTasks: held.inboxTasks,
      inboxTaskless: [],
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
    voiceCommands,
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
    task: { ...TASK, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: true } },
  },
};

/** One revision as the history lists it, written by Luke on a call. */
function _revisionLine(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 10 * seq, duringCall: true },
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

test("a repository pin still waiting on the service is let go with a sign-out, so the next account never wears it", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    // The service never answers, as when the window signs out with the pin still out.
    { [ACT_KIND.TASKS_PIN_REPOSITORY]: () => new Promise<boolean>(() => undefined) },
  );

  act(() => tab.control().onPinRepository("acme/secret", true));
  const pending = tab.control().pinnedRepositories;
  tab.stand({ signedIn: false, tasks: IDLE_TASKS_VIEW });
  tab.stand({ signedIn: true, tasks: { ...OPEN, repositoryPins: [] } });

  assert.deepEqual(pending, ["acme/secret"]);
  assert.deepEqual(tab.control().pinnedRepositories, []);
});

test("a task's name, pin, and status still waiting on the service are let go with a sign-out, so the next account never wears them", async () => {
  // The service never answers, as when the window signs out with the presses still out.
  const never = () => new Promise<boolean>(() => undefined);
  const tab = mount(
    { shown: true, tasks: listRead([listed()]) },
    {
      [ACT_KIND.TASKS_RENAME]: never,
      [ACT_KIND.TASKS_PIN]: never,
      [ACT_KIND.TASKS_SET_STANDING]: never,
    },
  );
  const drawn = () => tab.control().listed.tasks.find((task) => task.id === TASK.id);

  await act(async () => {
    void tab.control().onRenameTask(TASK.id, "Secret launch");
    tab.control().onMarkTask(TASK.id, TASK_MARK.PIN);
    tab.control().onSettleTasks([TASK.id], TASK_STATUS.DONE);
  });
  const pending = drawn();
  // Note that the list still holds the task as the window signs out, before main's view empties.
  tab.stand({ signedIn: false });
  tab.stand({ signedIn: true });

  assert.equal(pending?.name, "Secret launch");
  assert.ok(pending?.pinnedAt !== undefined, "the pin was drawn");
  assert.equal(pending?.status, TASK_STATUS.DONE);
  assert.equal(drawn()?.name, TASK.name);
  assert.equal(drawn()?.pinnedAt, undefined);
  assert.equal(drawn()?.status, listed().status);
});

test("a task given a name or a status here is pending until the view carries it, so a list held still moves it at once", async () => {
  const never = () => new Promise<boolean>(() => undefined);
  const tab = mount(
    { shown: true, tasks: listRead([listed()]) },
    { [ACT_KIND.TASKS_RENAME]: never, [ACT_KIND.TASKS_SET_STANDING]: never },
  );
  const before = tab.control().pendingTasks;

  await act(async () => {
    void tab.control().onRenameTask(TASK.id, "Launch plan");
  });
  const renaming = tab.control().pendingTasks;
  tab.stand({ tasks: listRead([{ ...listed(), name: "Launch plan" }]) });
  const named = tab.control().pendingTasks;
  await act(async () => {
    tab.control().onSettleTasks([TASK.id], TASK_STATUS.DONE);
  });

  assert.deepEqual([...(before ?? [])], []);
  assert.deepEqual([...(renaming ?? [])], [TASK.id]);
  assert.deepEqual([...(named ?? [])], []);
  assert.deepEqual([...(tab.control().pendingTasks ?? [])], [TASK.id]);
});

test("a priority and an assignee sent from a chip or a drop are drawn at once, waiting on the view, and go back where the list stands the task once the service refuses them", async () => {
  let answer: (kept: boolean) => void = () => undefined;
  const tab = mount(
    { shown: true, tasks: listRead([listed()]) },
    {
      [ACT_KIND.TASKS_SET_STANDING]: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    },
  );
  const drawn = () => tab.control().listed.tasks.find((task) => task.id === TASK.id);
  let kept: Promise<boolean> = Promise.resolve(true);

  await act(async () => {
    kept = tab
      .control()
      .onSetTaskStanding(TASK.id, { priority: TASK_PRIORITY.URGENT, assigneeId: "user-charles" });
  });
  const sending = drawn();
  const waiting = [...(tab.control().pendingTasks ?? [])];
  await act(async () => {
    answer(false);
    await kept;
  });

  assert.equal(sending?.priority, TASK_PRIORITY.URGENT);
  assert.equal(sending?.assignee?.userId, "user-charles");
  assert.deepEqual(waiting, [TASK.id]);
  assert.equal(drawn()?.priority, undefined);
  assert.equal(drawn()?.assignee, undefined);
  assert.deepEqual([...(tab.control().pendingTasks ?? [])], []);
});

it.effect(
  "a name the service kept but the list never carries gives way to the list once its time runs out",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: listRead([listed()]) },
        { [ACT_KIND.TASKS_RENAME]: () => Promise.resolve(true) },
        registryOn(yield* Clock.Clock),
      );
      const name = () => tab.control().listed.tasks.find((task) => task.id === TASK.id)?.name;

      act(() => {
        void tab.control().onRenameTask(TASK.id, "Launch plan");
      });
      yield* landed;
      const drawn = name();
      yield* passing(Duration.seconds(10));
      const waiting = name();
      yield* passing(PENDING_LIMIT);

      assert.equal(drawn, "Launch plan");
      assert.equal(waiting, "Launch plan");
      assert.equal(name(), TASK.name);
    }),
);

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

/** A board holding Luke's drawing of one box, numbered as his `number`th. */
function _drawnBoard(number: number): Board {
  return {
    elements: [],
    appliedDrawing: number - 1,
    drawing: {
      number,
      elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }],
    },
  };
}

const CODE: TaskCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: ["export function accept() {}"],
};

/** The code shown on the open task: one snippet, then a second of the same file. */
const SHOWN: readonly TaskCodeShowing[] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];
const _SHOWN_AGAIN: readonly TaskCodeShowing[] = [
  ...SHOWN,
  { callId: "show-2", turnId: "turn-1", shownAt: 1, code: CODE },
];

/** The panel as the developer sees it: shown or not, and on which tab. */
function panelOf(tab: ReturnType<typeof mount>) {
  const { open, tab: shown } = tab.control().sidePanel;
  return { open, tab: shown };
}

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const RUNNING_AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Lets the pause a chat read waits on before it is told run out, and the read go. */
async function readPauseRunsOut(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(Duration.toMillis(CHAT_READ_PAUSE));
  });
  await settle();
}

test("⇧⌘T opens the tabs closed again, the latest first, each in its strip at its place and a file's on the lines it showed, until none is left", async () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, shownCode: SHOWN } },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();
  const panel = () => tab.control().sidePanel;
  const column = () => tab.control().mainTabs;
  const file = { file: CODE.ref.path };
  // The plan stands first, and the code shown on the task stands its Code tab after it.
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose(SIDE_PANEL_TAB.COMMENTS));
  act(() => panel().onOpenFile(CODE.ref));
  const strip = [
    SIDE_PANEL_TAB.PLAN,
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.COMMENTS,
    file,
  ];
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(column().tabs, [{ agent: AGENT_ID }]);
  assert.equal(tab.control().onReopenClosedTab, undefined, "nothing closed, nothing to reopen");

  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  act(() => column().onClose({ agent: AGENT_ID }));
  act(() => panel().onClose(file));
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  assert.deepEqual(panel().strip, [
    SIDE_PANEL_TAB.PLAN,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.COMMENTS,
  ]);
  // The column with no tab left opens a new agent's draft in their place.
  const draft = { draft: tab.control().agents.draft?.id ?? assert.fail("no draft opened") };
  assert.deepEqual(column().tabs, [draft]);

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, [
    SIDE_PANEL_TAB.PLAN,
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.COMMENTS,
    file,
  ]);
  assert.deepEqual(panel().tab, file);
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range]),
    [[CODE.ref.path, { startLine: 1, endLine: 1 }]],
    "the file's tab lights the lines it lit",
  );

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(column().tabs, [{ agent: AGENT_ID }, draft]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.equal(tab.control().onReopenClosedTab, undefined);
});

test("a task none of whose tabs was viewed shows its strip's last, keeps the tab chosen across a launch, and opens a new agent's draft once its last tab closes", async () => {
  const listed = {
    [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
  };
  const tab = mount({ shown: true, tasks: OPEN }, listed);
  await settle();
  const column = () => tab.control().mainTabs;
  const agent = { agent: AGENT_ID };
  assert.deepEqual(column().tabs, [agent]);
  assert.deepEqual(column().tab, agent, "a task never shown on an agent shows its last tab");
  assert.equal(tab.control().agents.draft, undefined, "and opens no draft beside it");
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.PLAN });

  act(() => column().onChoose(agent));
  assert.deepEqual(column().tab, agent);

  const launched = mount({ shown: true, tasks: OPEN }, listed);
  await settle();
  const again = () => launched.control().mainTabs;
  assert.deepEqual(again().tab, agent, "a launch opens the task on the agent it last showed");

  act(() => again().onClose(agent));
  await settle();
  const draft = { draft: launched.control().agents.draft?.id ?? assert.fail("no draft opened") };
  assert.deepEqual(again().tabs, [draft]);
  assert.deepEqual(again().tab, draft, "a column with no tab left shows a new agent's draft");
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
        status: CODING_AGENT_STATUS.COMPLETED,
      })),
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

test("a task whose row settles its tab shows that agent's before its agents are read, and one whose row cannot say shows none until they are", async () => {
  const OLDER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
  const UNNAMED = "2c3d4e5f-6071-4829-93a4-b5c6d7e8f9a0";
  // The list of agents never answers, so whatever the column shows, the row chose.
  const unread = { [ACT_KIND.CODING_AGENTS_LIST]: () => new Promise<never>(() => undefined) };
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
    const tab = mount(
      { shown: true, tasks: { ...OPEN, tasks: [namingRow(lines, total)] } },
      unread,
    );
    await settle();
    assert.equal(tab.control().agents.agents, undefined, "the agents are still being read");
    return tab.control().mainTabs.tab;
  };

  assert.deepEqual(
    await shownOn([AGENT_ID, OLDER, UNNAMED], 5, [OLDER]),
    { agent: OLDER },
    "the agent last viewed, which the row names",
  );
  assert.deepEqual(
    await shownOn([AGENT_ID], 1, undefined),
    { agent: AGENT_ID },
    "the task's one agent, where none was viewed",
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
    undefined,
    "of two agents none viewed, the row cannot say which started last, as two started together stand by id",
  );
});

test("a column kept while the plan, the Inbox, and the Call stood in it reads with each let go, its agents' order and the tab last viewed still standing", async () => {
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
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();
  const column = () => tab.control().mainTabs;
  assert.deepEqual(column().tabs, [{ agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });
});

test("a column whose last agent is archived shows a new agent's draft standing alone", async () => {
  let listed: readonly CodingAgentSummary[] = [RUNNING_AGENT];
  const archived = { ...RUNNING_AGENT, archivedAt: 5 };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: listed }),
      [ACT_KIND.CODING_AGENTS_ARCHIVE]: () => {
        listed = [archived];
        return Promise.resolve({ agent: archived });
      },
    },
  );
  await settle();
  const column = () => tab.control().mainTabs;
  act(() => column().onChoose({ agent: AGENT_ID }));
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  await act(() => tab.control().agents.onArchive(AGENT_ID, true));
  await settle();
  const draft = { draft: tab.control().agents.draft?.id ?? assert.fail("no draft opened") };
  assert.deepEqual(column().tabs, [draft]);
  assert.deepEqual(column().tab, draft);
});

test("a tab closed on another plan opens that plan again, and the tab on it once the host has it open", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.BOARD));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_SELECT);
  assert.equal(tab.control().boundFor, TASK.id);

  tab.stand({ tasks: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.BOARD]);
});

test("in a narrow room a task opened from a list lands on its plan, the side panel standing on the plan's tab whichever tab it last showed or shut, and on the desktop's width it opens as it was left", () => {
  for (const room of [SHELL_ROOM.NARROW, SHELL_ROOM.WIDE]) {
    window.localStorage.clear();
    const tab = mount(
      { shown: true, tasks: OPEN, room },
      { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
    );
    act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
    tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
    act(() => tab.control().sidePanel.onSetOpen(false));

    act(() => tab.control().onSelect(TASK.id));
    tab.stand({ tasks: OPEN });
    if (room === SHELL_ROOM.NARROW) {
      assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.PLAN }, "narrow");
    } else {
      assert.equal(tab.control().sidePanel.open, false, "wide leaves the panel shut");
    }
  }
});

test("in a narrow room Back to a task opens it as it stood, its plan's tab closed there staying closed, where a task opened from a list lands on its plan", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN, room: SHELL_ROOM.NARROW, history: true },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.PLAN));
  assert.deepEqual(panel().tabs, [SIDE_PANEL_TAB.BOARD]);

  act(() => tab.control().onSelect(OTHER_TASK_ID));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();
  assert.equal(panel().tab, SIDE_PANEL_TAB.PLAN, "the task opened from a list lands on its plan");

  act(() => tab.history().onBack());
  assert.equal(tab.control().boundFor, TASK.id);
  tab.stand({ tasks: OPEN });
  await settle();
  assert.deepEqual(panel().tabs, [SIDE_PANEL_TAB.BOARD], "the plan's tab stays closed");
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("in a narrow room a Luke link to another task's panel item opens that item, not the plan a task opened from a list lands on", async () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID }, room: SHELL_ROOM.NARROW },
    {
      [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
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

test("Show panel on a plan whose strip holds no tab opens the tab last closed there, else the kind last closed on it, and a plan's own tab stands from a first launch, the panel shown on it", () => {
  const tab = mount({ shown: true, tasks: OPEN });
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose(SIDE_PANEL_TAB.CODE));
  act(() => panel().onClose(SIDE_PANEL_TAB.PLAN));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  assert.deepEqual(panelOf(tab), { open: false, tab: undefined });

  act(() => panel().onToggle());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE }, "as ⇧⌘T opens it");
  assert.deepEqual(panel().strip, [SIDE_PANEL_TAB.CODE]);
  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));

  // A launch keeps no tab closed to open again, but keeps the kinds closed on the plan.
  const launched = mount({ shown: true, tasks: OPEN });
  assert.equal(launched.control().onReopenClosedTab, undefined);
  assert.equal(launched.control().sidePanel.open, false);
  act(() => launched.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(launched), { open: true, tab: SIDE_PANEL_TAB.CODE });

  window.localStorage.clear();
  const fresh = mount({ shown: true, tasks: OPEN });
  assert.deepEqual(fresh.control().sidePanel.strip, [SIDE_PANEL_TAB.PLAN]);
  assert.deepEqual(panelOf(fresh), { open: true, tab: SIDE_PANEL_TAB.PLAN });
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

test("a Luke link to an agent with no task opens its page, and one under a task opens its tab on that task", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();

  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, agentId: AGENT_ID },
    }),
  );
  const page = tab.control().agentView.agentId;
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, planId: TASK.id, agentId: AGENT_ID },
    }),
  );

  assert.equal(page, AGENT_ID);
  assert.equal(tab.control().agentView.agentId, undefined);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
});

test("a Luke link to a page an agent on no task showed opens that agent's page, its panel on the page's tab, the agent's own pages read and held for it", async () => {
  const page = { id: "page-1", title: "Flaky funnel", version: 1, at: 1 };
  const asked: unknown[] = [];
  // Note that a panel's pages are read through the window's act port, as its hooks read them.
  fakeActs({
    act: (request) => {
      if (request.kind !== ACT_KIND.TASKS_PAGES) {
        return Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." });
      }
      asked.push(request.payload);
      return Promise.resolve({ status: FAKE_ANSWER.DONE, value: { pages: [page] } });
    },
  });
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
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
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
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
    repository: "acme/relay",
    branch: "luke/invites",
    pullRequest: {
      number: 41,
      title: "Teammate invitations",
      url: "https://github.com/acme/relay/pull/41",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
    },
  };
  let listed: readonly CodingAgentSummary[] = [EARLIER, RUNNING_AGENT];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: listed }),
      [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: () => Promise.resolve(shared),
      [ACT_KIND.CODING_AGENTS_ARCHIVE]: () => {
        const archived = { ...EARLIER, archivedAt: 5 };
        listed = [archived, RUNNING_AGENT];
        return Promise.resolve({ agent: archived });
      },
    },
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
  await act(() => tab.control().agents.onArchive(EARLIER.id, true));
  await settle();
  open(AGENT_ID);
  assert.deepEqual(panelOf(tab), { open: true, tab: { changes: AGENT_ID } });
});

test("a Luke link to an agent's message opens the agent and asks its tab to bring the message into view, each ask its own, let go once answered", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
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

test("a Luke link to a review thread opens its agent's Pull request tab on the view it names and asks the tab to bring the thread into view, each ask its own, let go once taken", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
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

test("a Luke link to an Inbox item opens it in its task's workspace, and one to an automation in the workspace its slug names", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const alerts = "alerts";
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
  const automationId = "6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7";

  act(() =>
    tab.control().onOpenLink({
      workspace: "renamed-since",
      place: { kind: LINK_PLACE.INBOX_ITEM, planId: alerts, itemId },
    }),
  );
  const inbox = { open: tab.control().inboxView.open, chosen: tab.control().inboxView.chosen };
  const listed = tab.control().workspace?.id;
  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.AUTOMATION, automationId },
    }),
  );

  assert.deepEqual(inbox, { open: true, chosen: { taskId: alerts, itemId, opened: true } });
  assert.equal(listed, ACME.id);
  assert.equal(tab.control().inboxView.open, false);
  assert.deepEqual(tab.control().automationsView.place, {
    kind: AUTOMATIONS_PAGE.EDIT,
    automationId,
  });
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
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

test("a Luke link to the Admin place opens it on its list, and one to a view opens that view alone, in the place of the Inbox, listing no other workspace", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const listed = tab.control().workspace?.id;
  act(() => tab.control().inboxView.onOpen());

  act(() => tab.control().onOpenLink({ workspace: "personal", place: { kind: LINK_PLACE.ADMIN } }));
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.control().adminView.open, true);
  assert.deepEqual(tab.control().adminView.view, { kind: "dashboard" });
  assert.equal(tab.control().adminView.listed, true);

  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.ADMIN, userId: "user-charles" },
    }),
  );
  assert.deepEqual(tab.control().adminView.view, { kind: "account", id: "user-charles" });
  assert.equal(tab.control().adminView.listed, false);

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

test("a Luke link to a channel opens Chat on it in the workspace its slug names, and one to Chat opens it on For you, as its sidebar row does", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const channelId = "7f3a4b5c-6d7e-4f8a-9b02-a3b4c5d6e7f8";
  assert.equal(tab.control().workspace?.id, PERSONAL.id);

  act(() =>
    tab.control().onOpenLink({ workspace: "acme", place: { kind: LINK_PLACE.CHAT, channelId } }),
  );
  const onChannel = {
    workspace: tab.control().workspace?.id,
    open: tab.control().chatView.open,
    place: tab.control().chatView.place,
    listed: tab.control().chatView.listed,
  };
  act(() => tab.control().onOpenLink({ workspace: "acme", place: { kind: LINK_PLACE.CHAT } }));

  assert.deepEqual(onChannel, {
    workspace: ACME.id,
    open: true,
    place: { kind: CHAT_PLACE.CHANNEL, channelId },
    listed: false,
  });
  assert.deepEqual(tab.control().chatView.place, FOR_YOU);
  assert.equal(tab.control().chatView.listed, true);
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

test("a Luke link to a task's version opens its version history on that version, and one to a turn of Luke's work opens its plan", () => {
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
      place: { kind: LINK_PLACE.TURN, planId: TASK.id, at: 7 },
    }),
  );

  assert.deepEqual(history, { open: true, spot: { revision: 3, opened: undefined } });
  assert.equal(tab.control().history.open, false);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.PLAN });
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
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  for (let close = 0; close < 20; close += 1) {
    act(() => panel().onChoose(SIDE_PANEL_TAB.CODE));
    act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  }

  let reopened = 0;
  for (let reopen = tab.control().onReopenClosedTab; reopen !== undefined; ) {
    act(() => reopen?.());
    assert.equal(panel().tab, SIDE_PANEL_TAB.CODE);
    reopened += 1;
    reopen = tab.control().onReopenClosedTab;
  }
  assert.equal(reopened, 20);
  assert.deepEqual(
    panel().tabs,
    [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.CODE],
    "the Board, closed first, is not kept",
  );
});

test("a file's tab opens again on the record it closed with, though another plan opened the same path since", () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, shownCode: SHOWN } },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onOpenFile(CODE.ref));
  act(() => panel().onClose({ file: CODE.ref.path }));

  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID, shownCode: SHOWN } });
  act(() => panel().onOpenFile({ ...CODE.ref, startLine: 5, endLine: 9 }, "b2c3d4e"));
  tab.stand({ tasks: { ...OPEN, shownCode: SHOWN } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().tab, { file: CODE.ref.path });
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range, each.commit]),
    [[CODE.ref.path, { startLine: 1, endLine: 1 }, undefined]],
  );
});

test("a press while a reopen waits on its plan takes no tab of another plan, which opens in its turn", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  act(() => panel().onChoose(SIDE_PANEL_TAB.CODE));
  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  tab.stand({ tasks: { ...OPEN, activeTaskId: THIRD_TASK_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, OTHER_TASK_ID);
  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, TASK.id);
  tab.stand({ tasks: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
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
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose({ page: page.id }));
  act(() => panel().onClose({ page: page.id }));
  tab.stand({ tasks: { ...OPEN, pages: [] } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
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

test("the Inbox opened on its list, as a phone's places bar opens it, stands its list over the item last chosen, from elsewhere and from the item alike", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().inboxView.onOpenList());
  assert.equal(tab.control().inboxView.open, true);
  assert.equal(tab.control().inboxView.listed, true);
  assert.deepEqual(tab.control().inboxView.chosen, { taskId: "notes", itemId: "notes-item-0" });

  act(() => tab.control().inboxView.onListed(false));
  act(() => tab.control().inboxView.onOpenList());
  assert.equal(tab.control().inboxView.listed, true, "from the item it goes back to the list");
});

test("the Inbox opened again stands on the item last chosen in it, as a row's choice, and on none once another workspace is listed", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().inboxView.onOpen());
  const chosen = tab.control().inboxView.chosen;
  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.INBOX_ITEM, planId: "notes", itemId },
    }),
  );
  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().inboxView.onOpen());
  const linked = tab.control().inboxView.chosen;
  act(() => tab.control().onChooseWorkspace(ACME.id));
  act(() => tab.control().inboxView.onClose());
  act(() => tab.control().inboxView.onOpen());

  assert.deepEqual(chosen, { taskId: "notes", itemId: "notes-item-0" });
  assert.deepEqual(linked, { taskId: "notes", itemId });
  assert.equal(tab.control().inboxView.chosen, undefined);
});

test("a link to the Inbox stands on the item last chosen in the workspace it lists, as the sidebar's row does", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  act(() => tab.control().boardView.onOpen());
  act(() => tab.control().onOpenLink({ workspace: "personal", place: { kind: LINK_PLACE.INBOX } }));

  assert.equal(tab.control().inboxView.open, true);
  assert.deepEqual(tab.control().inboxView.chosen, { taskId: "notes", itemId: "notes-item-0" });
});

test("the Inbox chosen by one account is not stood on by the next to sign in on this Mac", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  act(() => tab.control().inboxView.onClose());
  tab.stand({ signedIn: false });
  tab.stand({ signedIn: true, account: "teammate@example.com" });
  act(() => tab.control().inboxView.onOpen());

  assert.equal(tab.control().inboxView.open, true);
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

test("a task started hands on its issue and starts with no planning", async () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  await tab.control().newTask.start("", null, "workspace-acme", {
    issues: [{ provider: TASK_ISSUE_PROVIDER.LINEAR, id: "issue-1" }],
  });
  await tab.control().newTask.start("", null, "workspace-acme");

  assert.deepEqual(
    tab.payloads
      .filter((asked) => asked.kind === ACT_KIND.TASKS_START)
      .map((asked) => asked.payload),
    [
      {
        workspaceId: "workspace-acme",
        issues: [{ provider: TASK_ISSUE_PROVIDER.LINEAR, id: "issue-1" }],
        planning: false,
      },
      { workspaceId: "workspace-acme", planning: false },
    ],
  );
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

  assert.equal(tasks.control().agents.agents, undefined);
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

test("leaving an open plan rests on the Inbox, on the item last chosen there", () => {
  const tab = mount(
    { shown: true, tasks: { ...OPEN, tasks: [listed()] } },
    { [ACT_KIND.TASKS_CLOSE]: () => Promise.resolve() },
  );
  assert.equal(tab.control().inboxView.open, false, "an open plan stands with nothing over it");
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: TASK.id, itemId: "item-1" }));
  act(() => tab.control().onSelect(TASK.id));

  act(() => tab.control().onLeaveTask());
  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_CLOSE);
  assert.equal(tab.control().boundFor, undefined);
  assert.equal(tab.control().inboxView.open, true);
  assert.deepEqual(tab.control().inboxView.chosen, { taskId: TASK.id, itemId: "item-1" });
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

test("under the inbox-first sidebar the window rests on the newest item waiting, and on the Tasks page where nothing waits", async () => {
  handState(experimentsOn(EXPERIMENT.INBOX_FIRST));
  const older = { id: "older", agentId: "agent-1", title: "Older", postedAt: 1 };
  const newer = { id: "newer", agentId: "agent-1", title: "Newer", postedAt: 2 };
  const waiting = mount(
    {
      shown: true,
      tasks: listRead([listed()]),
      inboxWaiting: [{ taskId: TASK.id, items: [older, newer] }],
    },
    {},
    AtomRegistryModule.make(),
  );
  await settle();
  assert.equal(waiting.control().inboxView.open, true);
  assert.deepEqual(waiting.control().inboxView.chosen, { taskId: TASK.id, itemId: "newer" });

  const none = mount({ shown: true, tasks: listRead([listed()]) }, {}, AtomRegistryModule.make());
  await settle();
  assert.equal(none.control().boardView.open, true);
  assert.equal(none.control().inboxView.open, false);
  handState({});
});

test("one agent's pins are asked one after another, so the service hears an Unpin pressed before a Pin landed after it", async () => {
  const answers: ((answer: PortActResult<typeof ACT_KIND.CODING_AGENTS_PIN>) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_PIN]: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    },
  );
  /** Each pin the tab asked of main, in order, as `pinned`. */
  const asked = () =>
    tab.payloads
      .filter((each) => each.kind === ACT_KIND.CODING_AGENTS_PIN)
      .map((each) => Option.getOrUndefined(readPin(each.payload))?.pinned);

  await act(async () => {
    tab.control().onPinAgent("agent-1", true);
    tab.control().onPinAgent("agent-1", false);
  });
  const first = asked();
  // The first is answered as refused, which is no matter to the order the second is asked in.
  await act(async () => answers[0]?.({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.deepEqual(first, [true]);
  assert.deepEqual(asked(), [true, false]);
});

test("an agent with no task is renamed and archived in the sidebar's list at once, and put back where the service refuses", async () => {
  const taskless = {
    id: "agent-9",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Nightly triage",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-1",
    repository: null,
    activityAt: 1,
  };
  const renamed = Promise.withResolvers<PortActResult<typeof ACT_KIND.CODING_AGENTS_RENAME>>();
  const archived = Promise.withResolvers<PortActResult<typeof ACT_KIND.CODING_AGENTS_ARCHIVE>>();
  const tab = mount(
    { shown: true, tasks: { ...listRead([]), tasklessAgents: [taskless] } },
    {
      [ACT_KIND.CODING_AGENTS_RENAME]: () => renamed.promise,
      [ACT_KIND.CODING_AGENTS_ARCHIVE]: () => archived.promise,
    },
  );
  await settle();
  const listed = () => {
    const { standing, archived: gone } = tab.control().listedAgents;
    return {
      standing: standing.map((agent) => agent.title),
      archived: gone.map((agent) => agent.title),
    };
  };

  await act(async () => {
    void tab.control().agents.onRename(taskless.id, "Morning triage");
    void tab.control().agents.onArchive(taskless.id, true);
  });
  assert.deepEqual(listed(), { standing: [], archived: ["Morning triage"] });

  await act(async () => {
    renamed.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    archived.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
  });
  await settle();
  assert.deepEqual(listed(), { standing: ["Nightly triage"], archived: [] });
});

test("an agent's pin still waiting its turn when the account changes is never asked, so it lands on no one else's pins", async () => {
  const answers: ((answer: PortActResult<typeof ACT_KIND.CODING_AGENTS_PIN>) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_PIN]: () =>
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
  await act(async () => answers[0]?.({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }));

  assert.equal(tab.payloads.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_PIN).length, 1);
});

test("a pin dragged to a new place stands there at once, and goes back with what the drop placed on this Mac and a toast when the service refuses it", async () => {
  const answers: ((changed: boolean) => void)[] = [];
  const pinned = { ...listed(), pinnedAt: 5 };
  const tab = mount(
    { shown: true, tasks: listRead([pinned]) },
    {
      [ACT_KIND.TASKS_PIN]: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    },
  );
  const position = () =>
    tab.control().listed.tasks.find((task) => task.id === TASK.id)?.pinPosition;

  let putBack = 0;
  await act(async () =>
    tab.control().onMovePins([{ agent: false, id: TASK.id, position: "a1" }], () => {
      putBack += 1;
    }),
  );
  const drawn = position();
  await act(async () => answers[0]?.(false));

  assert.equal(drawn, "a1");
  assert.equal(position(), undefined);
  assert.equal(putBack, 1);
  assert.equal(newestToastSays(), "The pin could not be moved. Try again.");
});

test("a change to the sections is drawn at once, sent after the one before it, and a refused one goes back with a toast", async () => {
  const answers: ((changed: boolean) => void)[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_WRITE_SECTION]: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    },
  );
  const sent = () => tab.payloads.filter((each) => each.kind === ACT_KIND.TASKS_WRITE_SECTION);
  const titles = () => tab.control().taskSections.sections.map((section) => section.title);
  const make = (id: string, title: string) => ({
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId: "workspace-1",
    title,
  });

  await act(async () =>
    tab
      .control()
      .onWriteSections([
        make("0a1b2c3d-0000-4000-8000-000000000001", "Launch"),
        make("0a1b2c3d-0000-4000-8000-000000000002", "Later"),
      ]),
  );
  const drawn = titles();
  const sentFirst = sent().length;
  await act(async () => answers[0]?.(true));
  const sentSecond = sent().length;
  await act(async () => answers[1]?.(false));

  assert.deepEqual(drawn, ["Launch", "Later"]);
  assert.deepEqual([sentFirst, sentSecond], [1, 2]);
  // Main's view never carried either, as this test stands no answer in it, so both go once settled.
  assert.deepEqual(titles(), []);
  assert.equal(newestToastSays(), "Your sections could not be changed. Try again.");
});

test("a pin's place the service took follows the next list, even one a drag on another Mac has moved since", async () => {
  const pinned = { ...listed(), pinnedAt: 5, pinPosition: "a0" };
  const tab = mount(
    { shown: true, tasks: listRead([pinned]) },
    { [ACT_KIND.TASKS_PIN]: () => Promise.resolve(true) },
  );
  const position = () =>
    tab.control().listed.tasks.find((task) => task.id === TASK.id)?.pinPosition;

  await act(async () => tab.control().onMovePins([{ agent: false, id: TASK.id, position: "a1" }]));
  tab.stand({ tasks: listRead([{ ...pinned, pinPosition: "a2" }]) });

  assert.equal(position(), "a2");
});

test("a fixture run on the chat profile opens Chat at once and its staged chat lands there; a live run stages none", async () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.CHAT });
  assert.equal(fixture.control().chatView.open, true);
  await vi.waitFor(async () => {
    await settle();
    assert.ok(fixture.control().chatView.chat, "the staged chat landed");
  });
  const live = mount({ shown: true });
  await settle();
  assert.equal(live.control().chatView.open, false);
  assert.equal(live.control().chatView.chat, undefined);
});

test("opening Chat on a place, as a chat notice's Open in chat does, asks first while a page stands its ask, as every other way out does", () => {
  const tab = mount({ shown: true, tasks: listRead([listed()]) });
  const asked: (() => void)[] = [];
  act(() => {
    tab.control().leaveGuard.stand((leave) => asked.push(leave));
  });
  act(() => tab.control().chatView.onShow(FOR_YOU));
  assert.equal(tab.control().chatView.open, false, "nothing is left before Leave");
  assert.equal(asked.length, 1);
  act(() => asked[0]?.());
  assert.equal(tab.control().chatView.open, true);
});

/** A chat's stream as the host opens one: each chat pushed is handed to the reader in turn. */
function chatStream() {
  const queued: CodingAgentChatAnswerView[] = [];
  const waiting: ((read: IteratorResult<CodingAgentChatAnswerView, void>) => void)[] = [];
  const iterator = new AsyncIteratorClass<CodingAgentChatAnswerView, void>(
    () => {
      const chat = queued.shift();
      if (chat !== undefined) return Promise.resolve({ done: false, value: chat });
      return new Promise((resolve) => waiting.push(resolve));
    },
    () => Promise.resolve(),
  );
  return {
    /** The act's answer: the stream, opened. */
    open: () => Promise.resolve(iterator),
    push: (chat: CodingAgentChatAnswerView) => {
      const reader = waiting.shift();
      if (reader === undefined) queued.push(chat);
      else reader({ done: false, value: chat });
    },
  };
}

test("a live run follows the listed workspace's chat only while the account has Chat on", async () => {
  handState({});
  const off = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await settle();
  assert.ok(
    !off.agentActs.includes(ACT_KIND.CODING_AGENTS_CHAT_FOLLOW),
    "Chat off follows no chat",
  );
  assert.equal(off.control().chatView.available, false);

  handState(experimentsOn(EXPERIMENT.CHAT));
  const on = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await vi.waitFor(async () => {
    await settle();
    assert.ok(
      on.agentActs.includes(ACT_KIND.CODING_AGENTS_CHAT_FOLLOW),
      "Chat on follows its chat",
    );
  });
});

test("a channel chosen in Chat is the listed workspace's, so another workspace listed puts Chat back on For you", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => tab.control().onChooseWorkspace(PERSONAL.id));
  act(() => tab.control().chatView.onOpen());
  const channel = { kind: CHAT_PLACE.CHANNEL, channelId: "c0ffee00-0000-4000-8000-000000000001" };
  act(() => tab.control().chatView.onChoose(channel));
  assert.deepEqual(tab.control().chatView.place, channel);
  act(() => tab.control().onChooseWorkspace(ACME.id));
  assert.equal(tab.control().chatView.open, true, "Chat stays open");
  assert.deepEqual(tab.control().chatView.place, FOR_YOU);
});

test("Chat opened stands on its rail, a place chosen or shown from elsewhere stands on that place, and the way back returns to the rail", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const standing = () => [tab.control().chatView.place, tab.control().chatView.listed];
  act(() => tab.control().chatView.onOpen());
  assert.deepEqual(standing(), [FOR_YOU, true]);
  const channel = { kind: CHAT_PLACE.CHANNEL, channelId: "c0ffee00-0000-4000-8000-000000000001" };
  act(() => tab.control().chatView.onChoose(channel));
  assert.deepEqual(standing(), [channel, false]);
  act(() => tab.control().chatView.onList());
  assert.deepEqual(standing(), [channel, true], "the rail stands with the place still chosen");
  act(() => tab.control().chatView.onClose());
  act(() => tab.control().chatView.onShow(channel));
  assert.deepEqual(standing(), [channel, false]);
});

test("a chat notification's click, listing the workspace its message waits in and opening Chat in one press, stands on that workspace's Chat", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => tab.control().onChooseWorkspace(PERSONAL.id));
  act(() => {
    tab.control().onChooseWorkspace(ACME.id);
    tab.control().chatView.onOpen();
  });
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.equal(tab.control().chatView.open, true);
});

test("the task's Chat, opened from ⌘K's Chat row, stands in the side panel and never in the column", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const on = mount({ shown: true, tasks: OPEN }, {}, AtomRegistryModule.make());
  await settle();
  act(() => on.control().onShowChat(TASK.id));
  assert.equal(on.control().sidePanel.tab, SIDE_PANEL_TAB.CHAT);
  assert.equal(on.control().sidePanel.open, true);
  assert.deepEqual(on.control().mainTabs.tabs, []);
});

test("the task's Chat tab on screen marks the task's plan channel read, as the window's Chat on that channel does", async () => {
  vi.useFakeTimers();
  handState(experimentsOn(EXPERIMENT.CHAT));
  const me = "b1c2d3e4-0000-4000-8000-000000000001";
  const channelId = "c0ffee00-0000-4000-8000-000000000002";
  const answer = {
    self: me,
    readSeq: 0,
    members: [{ id: me, kind: MEMBER_KIND.HUMAN, name: "Dean", left: false }],
    channels: [
      { id: channelId, kind: CHANNEL_KIND.TASK, name: "invites", archived: false, planId: TASK.id },
    ],
    messages: [
      {
        id: "d0d0d0d0-0000-4000-8000-000000000003",
        seq: 4,
        touchedSeq: 4,
        channelId,
        authorId: "a0a0a0a0-0000-4000-8000-000000000004",
        blocks: [],
        mentions: [],
        postedAt: 1,
      },
    ],
    cursor: "",
  };
  const stream = chatStream();
  stream.push(answer);
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] } },
    {
      [ACT_KIND.CODING_AGENTS_CHAT_FOLLOW]: stream.open,
      [ACT_KIND.CODING_AGENTS_CHAT_POST]: () => Promise.resolve({ readSeq: 0 }),
    },
    AtomRegistryModule.make(),
  );
  await settle();
  act(() => tab.control().onShowChat(TASK.id));
  await vi.waitFor(async () => {
    await readPauseRunsOut();
    const wrote = tab.payloads.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_CHAT_POST);
    assert.deepEqual(
      wrote.map((each) => each.payload),
      [{ workspaceId: PERSONAL.id, write: { readTo: 4, channelId } }],
    );
  });
});

test("a channel hidden behind a narrow room's Chat rail is not marked read until it stands on screen again", async () => {
  vi.useFakeTimers();
  handState(experimentsOn(EXPERIMENT.CHAT));
  const me = "b1c2d3e4-0000-4000-8000-000000000001";
  const channelId = "c0ffee00-0000-4000-8000-000000000002";
  /** The chat as one read answers it: the channel, holding one message at `seq`. */
  const answerAt = (seq: number) => ({
    self: me,
    readSeq: 0,
    members: [{ id: me, kind: MEMBER_KIND.HUMAN, name: "Dean", left: false }],
    channels: [{ id: channelId, kind: CHANNEL_KIND.GENERAL, name: "general", archived: false }],
    messages: [
      {
        id: `d0d0d0d0-0000-4000-8000-00000000000${seq}`,
        seq,
        touchedSeq: seq,
        channelId,
        authorId: "a0a0a0a0-0000-4000-8000-000000000004",
        blocks: [],
        mentions: [],
        postedAt: seq,
      },
    ],
    cursor: "",
  });
  // The next push waits for the test to post a message, as the host pushes one when it lands.
  const stream = chatStream();
  stream.push(answerAt(4));
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] }, room: SHELL_ROOM.NARROW },
    {
      [ACT_KIND.CODING_AGENTS_CHAT_FOLLOW]: stream.open,
      [ACT_KIND.CODING_AGENTS_CHAT_POST]: () => Promise.resolve({ readSeq: 0 }),
    },
    AtomRegistryModule.make(),
  );
  const place = { kind: CHAT_PLACE.CHANNEL, channelId };
  const readTo = () =>
    tab.payloads.flatMap((each) =>
      each.kind === ACT_KIND.CODING_AGENTS_CHAT_POST ? [each.payload] : [],
    );
  const mark = (seq: number) => ({ workspaceId: PERSONAL.id, write: { readTo: seq, channelId } });
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().chatView.chat, "the chat landed");
  });
  act(() => tab.control().chatView.onShow(place));
  await readPauseRunsOut();
  assert.deepEqual(readTo(), [mark(4)], "the channel on screen is read");

  act(() => tab.control().chatView.onList());
  stream.push(answerAt(5));
  await readPauseRunsOut();
  assert.deepEqual(readTo(), [mark(4)], "a message landing behind the rail stays unread");

  act(() => tab.control().chatView.onChoose(place));
  await readPauseRunsOut();
  assert.deepEqual(readTo(), [mark(4), mark(5)]);
});

test("a channel link the chat held before it was opened does not hold stands until a later read: kept where that read holds it, back on For you where it does not", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const me = "b1c2d3e4-0000-4000-8000-000000000001";
  const [held, fresh, gone] = [
    "c0ffee00-0000-4000-8000-000000000001",
    "c0ffee00-0000-4000-8000-000000000002",
    "c0ffee00-0000-4000-8000-000000000003",
  ];
  /** The chat as one read answers it, holding `ids` as its channels. */
  const answerOf = (cursor: number, ids: readonly string[]) => ({
    self: me,
    readSeq: 0,
    members: [{ id: me, kind: MEMBER_KIND.HUMAN, name: "Dean", left: false }],
    channels: ids.map((id) => ({ id, kind: CHANNEL_KIND.TOPIC, name: id, archived: false })),
    messages: [],
    cursor: String(cursor),
  });
  // Each later push waits for the test, as the host pushes one when the chat changes.
  const stream = chatStream();
  stream.push(answerOf(1, [held]));
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] } },
    { [ACT_KIND.CODING_AGENTS_CHAT_FOLLOW]: stream.open },
    AtomRegistryModule.make(),
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().chatView.chat, "the chat landed");
  });
  const linkTo = (channelId: string) =>
    act(() =>
      tab
        .control()
        .onOpenLink({ workspace: "personal", place: { kind: LINK_PLACE.CHAT, channelId } }),
    );
  const place = () => tab.control().chatView.place;

  linkTo(fresh);
  await settle();
  assert.deepEqual(place(), { kind: CHAT_PLACE.CHANNEL, channelId: fresh }, "made since the read");
  stream.push(answerOf(2, [held, fresh]));
  await settle();
  assert.deepEqual(place(), { kind: CHAT_PLACE.CHANNEL, channelId: fresh }, "and held by the next");

  linkTo(gone);
  await settle();
  assert.deepEqual(place(), { kind: CHAT_PLACE.CHANNEL, channelId: gone });
  stream.push(answerOf(3, [held, fresh]));
  await vi.waitFor(async () => {
    await settle();
    assert.deepEqual(place(), FOR_YOU, "a read since that holds it not puts Chat on For you");
  });
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

test("New task's Agent mode sends one start carrying the agent, its words and model, and opens the task on the agent it started", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [started] }),
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
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.CODING_AGENTS_START),
    [],
    "no second call starts the agent",
  );
  assert.equal(tab.control().agents.draft, undefined, "no draft stands in its place");
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID }, "the task opens on its tab");
});

test("archiving a task's last agent opens no draft while the archive is out, so a refused one brings the agent back alone", async () => {
  const archived = Promise.withResolvers<PortActResult<typeof ACT_KIND.CODING_AGENTS_ARCHIVE>>();
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
      [ACT_KIND.CODING_AGENTS_ARCHIVE]: () => archived.promise,
    },
  );
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });

  await act(async () => {
    void tab.control().agents.onArchive(AGENT_ID, true);
  });
  assert.deepEqual(tab.control().mainTabs.tabs, [], "the agent leaves at once");
  assert.equal(tab.control().agents.draft, undefined, "no draft opens while the archive is out");

  await act(async () => archived.resolve({ failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }));
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().agents.draft, undefined);
});

test("a task started, with an agent or without, leaves a hidden side panel hidden", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [started] }),
    },
  );
  act(() => tab.control().sidePanel.onToggle());
  assert.equal(tab.control().sidePanel.open, false);

  await act(async () => {
    await tab.control().newTask.start("Dark mode", null, undefined);
  });
  assert.equal(tab.control().sidePanel.open, false, "a bare task opens no plan beside it");

  await startAgentTask(tab);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().sidePanel.open, false, "the plan does not open beside the agent");
});

test("New task's agent stands on its task with the words it started on as its first line before the task's agents or its transcript are read", async () => {
  const started = { ...RUNNING_AGENT, planId: OTHER_TASK_ID };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({ planId: OTHER_TASK_ID, agentStart: { agent: started } }),
      // The task's agents are still being read.
      [ACT_KIND.CODING_AGENTS_LIST]: () => new Promise(() => undefined),
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
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [started] }),
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

test("New task's agent start refused after its page opened opens the card again on the issues, model, and press it held, saying why, over the version history it was asked from", async () => {
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
    links: [],
    choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
    press: {
      key: AGENT_KEY,
      ask: { name: "", repository: "acme/web", workspaceId: undefined, issues: [], agent: handed },
    },
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
    links: [],
    choice: undefined,
    press: {
      key: AGENT_KEY,
      ask: { name: "", repository: "acme/web", workspaceId: undefined, issues: [], agent: handed },
    },
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
  // The service holds the agent once its own Start made it.
  let agents: CodingAgentSummary[] = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () =>
        Promise.resolve({
          planId: OTHER_TASK_ID,
          agentStart: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
        }),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents }),
      [ACT_KIND.CODING_AGENTS_START]: () => {
        agents = [started];
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
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.CODING_AGENTS_START),
    [],
    "nothing is sent again by itself",
  );

  // The draft tab's Retry sends what the draft holds.
  await act(async () => {
    await tab.control().agents.startPrompt(draft.id, draft.prompt, draft.choice, draft.attachments);
  });
  await settle();
  const retries = tab.payloads.filter(({ kind }) => kind === ACT_KIND.CODING_AGENTS_START);
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
  const untitled: TasksView = {
    ...OPEN,
    document: { status: TASKS_READ.READY, task: { ...TASK, name: "Untitled" } },
  };
  const refreshes = (tab: ReturnType<typeof mount>) =>
    tab.told.filter((kind) => kind === ACT_KIND.TASKS_REFRESH).length;
  const tab = mount(
    { shown: true, tasks: untitled },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();
  const before = refreshes(tab);
  act(() => tab.control().agents.onTitle(AGENT_ID, "Fix token refresh"));
  await settle();
  const landed = refreshes(tab) - before;
  closeWindow();

  const named = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();
  const namedBefore = refreshes(named);
  act(() => named.control().agents.onTitle(AGENT_ID, "Fix token refresh"));
  await settle();

  assert.equal(landed, 1);
  assert.equal(refreshes(named) - namedBefore, 0);
});

/** An agent of the open task's another's call speaks into. */
const VOICE_CHAT_AGENT: CodingAgentSummary = {
  ...RUNNING_AGENT,
  id: "2f4a6c8e-0b1d-4e3f-a5c7-9e1b3d5f7a90",
  status: CODING_AGENT_STATUS.STARTING,
};

/** The payload of every act of `kind` the tab asked, in order. */
function payloadsOf(tab: ReturnType<typeof mount>, kind: PortActKind): unknown[] {
  return tab.payloads.filter((asked) => asked.kind === kind).map((asked) => asked.payload);
}

test("a task with no agent opens on a new agent's draft once its agents are read, asking the service nothing, and closing it opens a fresh one", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().agents.draft, "the task holds a draft");
  });
  const draft = tab.control().agents.draft;
  assert.ok(draft);
  assert.deepEqual(tab.control().mainTabs.tab, { draft: draft.id }, "and its column shows it");
  assert.deepEqual(payloadsOf(tab, ACT_KIND.CODING_AGENTS_START), [], "nothing is started");

  act(() => {
    tab.control().mainTabs.onClose({ draft: draft.id });
    tab.control().agents.onDiscardDraft(draft.id);
  });
  await settle();
  const fresh = tab.control().agents.draft;
  assert.ok(fresh);
  assert.notEqual(fresh.id, draft.id, "the draft closed is let go");
  assert.deepEqual(tab.control().mainTabs.tab, { draft: fresh.id });
  assert.deepEqual(payloadsOf(tab, ACT_KIND.CODING_AGENTS_START), []);
});

test("closing a draft holding words lets it go at once, and its toast's Undo opens its tab again with the same words, files, and chips", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().agents.draft, "the task holds a draft");
  });
  const draft = tab.control().agents.draft;
  assert.ok(draft);
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
  assert.deepEqual(payloadsOf(tab, ACT_KIND.CODING_AGENTS_START), [], "nothing is started");
});

test("a draft closed with words whose place a fork has taken since is laid into that fork by Undo, the fork kept", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().agents.draft, "the task holds a draft");
  });
  const closed = tab.control().agents.draft;
  assert.ok(closed);
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
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().agents.draft, "the task holds a draft");
  });
  const closed = tab.control().agents.draft;
  assert.ok(closed);
  act(() => tab.control().agents.onDraftChange({ prompt: "Fix login." }));
  act(() => tab.control().agents.onDiscardDraft(closed.id));
  await settle();
  assert.equal(newestToastSays(), "Draft closedUndo");

  tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
  await settle();
  assert.notEqual(newestToastSays(), "Draft closedUndo");
});

test("a task with no agent opens its new agent's draft with a hidden side panel left hidden", async () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  if (tab.control().sidePanel.open) act(() => tab.control().sidePanel.onToggle());
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().agents.draft, "the task holds a draft");
  });
  assert.equal(tab.control().sidePanel.open, false, "the plan does not open beside the draft");
});

test("a platform with no voice takes no calls", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.VOICE));
  const web = mount({ shown: true, tasks: OPEN }, {}, AtomRegistryModule.make());
  await settle();
  assert.equal(web.control().calls, undefined);
});

/** The voice as main delivers it, whose call a test stands by hand: a call into another agent landing after a first press. */
function voiceDelivered(): { stand: (view: VoiceView) => Promise<void> } {
  const listeners = new Set<(snapshot: AppStateSnapshot) => void>();
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(stateWith({}, {})),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    stand: async (view) => {
      act(() => {
        for (const listener of listeners) {
          listener(stateWith({}, { version: 2, voice: { avatar: AVATAR_OFF, view } }));
        }
      });
      await settle();
    },
  };
}

/** A call standing into another agent, of the open task. */
const OTHER_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  call: { taskId: TASK.id, agentId: VOICE_CHAT_AGENT.id },
};

test("an agent's Call press opens a call into it at once, and over another agent's call ends that one at once, its toast's Undo calling it again", async () => {
  const voice = voiceDelivered();
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
      [ACT_KIND.TASKS_TALK]: () => Promise.resolve(undefined),
    },
    AtomRegistryModule.make(),
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().calls, "a desktop's agents take calls");
  });
  const onTask = { taskId: TASK.id, archived: false };
  act(() => tab.control().calls?.onPress(AGENT_ID, onTask));
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK), [{ agentId: AGENT_ID, taskId: TASK.id }]);

  await voice.stand(OTHER_CALL);
  act(() => tab.control().calls?.onPress(AGENT_ID, onTask));
  await settle();
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK), [
    { agentId: AGENT_ID, taskId: TASK.id },
    { agentId: AGENT_ID, taskId: TASK.id },
  ]);
  assert.equal(newestToastSays(), `Call on ${TASK.name} endedUndo`);

  act(() => _undoButton().click());
  await settle();
  assert.deepEqual(
    payloadsOf(tab, ACT_KIND.TASKS_TALK).at(-1),
    { agentId: VOICE_CHAT_AGENT.id, taskId: TASK.id },
    "Undo calls the earlier agent on its task again",
  );
});

test("a Call press and each Retry main refuses say why in a toast", async () => {
  voiceDelivered();
  // Each refresh is refused in words of its own, so each Retry's toast is told from the one before.
  let refreshes = 0;
  fakeActPort({
    [ACT_KIND.TASKS_TALK]: () => Promise.reject(refusedOnPort("The voice window is not standing.")),
    [ACT_KIND.TASKS_REFRESH]: () =>
      Promise.reject(refusedOnPort(`Refresh ${++refreshes} could not read the tasks.`)),
  });
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
    AtomRegistryModule.make(),
    pressAct,
  );
  // A press's toast is raised on the window's own registry, so its toasts stand beside the tab's.
  const windowToasts = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(windowToasts);
  act(() => windowToasts.render(onRegistry(rendererRegistry, createElement(ToastHost))));
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().calls, "a desktop's agents take calls");
  });

  act(() => tab.control().calls?.onPress(AGENT_ID, { taskId: TASK.id, archived: false }));
  await settle();
  const called = newestToastSays();
  const retried: (string | undefined)[] = [];
  for (const retry of ["onRetryList", "onRetryWorkspaces", "onRetryCode"] as const) {
    await act(async () => tab.control()[retry]());
    retried.push(newestToastSays());
  }

  assert.equal(called, "The voice window is not standing.");
  assert.deepEqual(retried, [
    "Refresh 1 could not read the tasks.",
    "Refresh 2 could not read the tasks.",
    "Refresh 3 could not read the tasks.",
  ]);
});

/** The list as OPEN holds it, with no task open. */
const { activeTaskId: _open, ...NO_TASK_OPEN } = OPEN;

test("an agent's page takes a call into its agent with no task open, naming no task, ends another call at once with Undo, and an archived agent takes none", async () => {
  const voice = voiceDelivered();
  const tab = mount(
    { shown: true, tasks: NO_TASK_OPEN },
    { [ACT_KIND.TASKS_TALK]: () => Promise.resolve(undefined) },
    AtomRegistryModule.make(),
  );
  await vi.waitFor(async () => {
    await settle();
    assert.ok(tab.control().calls, "a desktop's agents take calls");
  });
  act(() =>
    tab.control().onOpenLink({
      workspace: "acme",
      place: { kind: LINK_PLACE.AGENT, agentId: AGENT_ID },
    }),
  );
  assert.equal(tab.control().agentView.agentId, AGENT_ID);
  const tasklessPlace = { taskId: undefined, archived: false };

  act(() => tab.control().calls?.onPress(AGENT_ID, { ...tasklessPlace, archived: true }));
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK), [], "an archived agent takes no call");
  act(() => tab.control().calls?.onPress(AGENT_ID, tasklessPlace));
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK), [{ agentId: AGENT_ID }]);

  await voice.stand(OTHER_CALL);
  act(() => tab.control().calls?.onPress(AGENT_ID, tasklessPlace));
  await settle();
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK), [
    { agentId: AGENT_ID },
    { agentId: AGENT_ID },
  ]);
  assert.equal(newestToastSays(), `Call on ${TASK.name} endedUndo`);

  act(() => _undoButton().click());
  await settle();
  assert.deepEqual(payloadsOf(tab, ACT_KIND.TASKS_TALK).at(-1), {
    agentId: VOICE_CHAT_AGENT.id,
    taskId: TASK.id,
  });
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

/** A registry whose atoms count on this clock, as the window's count on its own. */
function registryOn(clock: Clock.Clock): AtomRegistry {
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
const IDLE_AGENTS: readonly CodingAgentSummary[] = [
  RUNNING_AGENT,
  { ...RUNNING_AGENT, id: FINISHED_ID, createdAt: 4, status: CODING_AGENT_STATUS.COMPLETED },
  { ...RUNNING_AGENT, id: UNSEEN_ID, createdAt: 5, status: CODING_AGENT_STATUS.COMPLETED },
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
        { shown: true, tasks: { ...OPEN, shownCode: SHOWN } },
        { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const panel = () => tab.control().sidePanel;
      const file = { file: CODE.ref.path };
      const pulls = { changes: AGENT_ID };
      act(() => panel().onOpenFile(CODE.ref));
      act(() => panel().onChoose(pulls));
      act(() => panel().onPin(pulls, "Pull request"));
      act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
      yield* landed;
      const strip = panel().strip;
      assert.deepEqual(strip, [
        SIDE_PANEL_TAB.PLAN,
        SIDE_PANEL_TAB.CODE,
        file,
        pulls,
        SIDE_PANEL_TAB.BOARD,
      ]);

      yield* passing(Duration.hours(23));
      assert.deepEqual(panel().strip, strip, "a tab viewed within the day stays");

      yield* passing(Duration.hours(1));
      assert.deepEqual(
        panel().strip,
        [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.CODE, pulls, SIDE_PANEL_TAB.BOARD],
        "the file's tab closed; the fixed tabs, the pinned Pull request, and the tab shown stay",
      );
      assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });

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
        { shown: true, tasks: OPEN, unseenAgents: [UNSEEN_ID] },
        { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: IDLE_AGENTS }) },
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
      assert.deepEqual(column().tabs, [running, finished, unseen]);

      yield* passing(Duration.days(1));
      assert.deepEqual(column().tabs, [running, unseen], "the finished agent's tab closed");
      assert.deepEqual(column().tab, running);
      assert.ok(tab.control().onReopenClosedTab, "and stands on ⇧⌘T's stack");

      act(() => column().onClose(unseen));
      tab.stand({ inboxWaiting: [waitingFrom(FINISHED_ID), waitingFrom(UNSEEN_ID)] });
      yield* landed;
      assert.deepEqual(
        column().tabs,
        [running, finished],
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
      const listed = {
        [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
      };
      const pulls = { changes: AGENT_ID };
      const first = mount({ shown: true, tasks: OPEN }, listed, registryOn(clock));
      yield* landed;
      act(() => first.control().sidePanel.onChoose(pulls));
      act(() => first.control().sidePanel.onChoose(SIDE_PANEL_TAB.PLAN));
      yield* landed;
      assert.deepEqual(first.control().sidePanel.strip, [SIDE_PANEL_TAB.PLAN, pulls]);
      closeWindow();

      yield* TestClock.adjust(Duration.hours(25));
      const again = mount({ shown: true, tasks: OPEN }, listed, registryOn(clock));
      yield* landed;
      assert.deepEqual(again.control().sidePanel.strip, [SIDE_PANEL_TAB.PLAN]);
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
        { shown: true, tasks: OPEN, unseenAgents: [UNSEEN_ID] },
        { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: IDLE_AGENTS }) },
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
        [running, finished, unseen],
        "its first count leaves it open",
      );

      yield* passing(Duration.days(1));
      assert.deepEqual(column().tabs, [running, unseen], "a day unviewed after it closes it");
    }),
);

it.effect(
  "an agent's tab left chosen under the side panel filling the window is no longer viewed, so a day of it closes the tab",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, tasks: OPEN, unseenAgents: [UNSEEN_ID] },
        { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: IDLE_AGENTS }) },
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      act(() => column().onChoose({ agent: FINISHED_ID }));
      act(() => tab.control().sidePanel.onToggleFullScreen());
      yield* landed;
      assert.equal(tab.control().sidePanel.fullScreen, true);

      yield* passing(Duration.days(1));
      assert.deepEqual(column().tabs, [{ agent: AGENT_ID }, { agent: UNSEEN_ID }]);
    }),
);

it.effect(
  "a tab shown as its task is left for one whose agents are still unread is stamped as it was left, not when it was last stamped",
  () =>
    Effect.gen(function* () {
      const unread = Promise.withResolvers<never>();
      const tab = mount(
        { shown: true, tasks: OPEN, unseenAgents: [UNSEEN_ID] },
        {
          [ACT_KIND.CODING_AGENTS_LIST]: (params) =>
            Option.getOrUndefined(readListed(params))?.taskId === TASK.id
              ? Promise.resolve({ agents: IDLE_AGENTS })
              : unread.promise,
          [ACT_KIND.TASKS_SELECT]: () => Promise.resolve(true),
        },
        registryOn(yield* Clock.Clock),
      );
      yield* landed;
      const column = () => tab.control().mainTabs;
      act(() => column().onChoose({ agent: FINISHED_ID }));
      yield* passing(Duration.minutes(50));
      tab.stand({ tasks: { ...OPEN, activeTaskId: OTHER_TASK_ID } });
      yield* landed;
      // The panel filling the window over the column keeps the tab from being viewed again on return.
      act(() => tab.control().sidePanel.onToggleFullScreen());

      yield* passing(Duration.hours(23));
      tab.stand({ tasks: OPEN });
      yield* passing(Duration.minutes(30));
      assert.deepEqual(
        column().tabs,
        [{ agent: AGENT_ID }, { agent: FINISHED_ID }, { agent: UNSEEN_ID }],
        "a day has not passed since it was left",
      );

      yield* passing(Duration.hours(1));
      assert.deepEqual(column().tabs, [{ agent: AGENT_ID }, { agent: UNSEEN_ID }]);
    }),
);

/** A list's payload, read back as the act's own schema admits it. */
const readListed = Schema.decodeUnknownOption(Schema.Struct({ taskId: Schema.String }));
