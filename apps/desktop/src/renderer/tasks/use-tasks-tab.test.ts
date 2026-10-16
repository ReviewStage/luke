// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import type { Board } from "@luke/features/board-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { MENTION_KIND } from "@luke/features/mention-link";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASK_WORK_STATE,
  TASKS_READ,
  type TaskCode,
  type TaskCodeShowing,
  type TasksView,
  type TaskWorkTurn,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT, ACT_KIND, type ActKind, type ActResultFor } from "@luke/host/acts";
import { type AppInboxTask, type AppInboxTaskHolding, RUN_PROFILE } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import {
  messageText,
  TRANSCRIPT_REGION,
  type TranscriptRegion,
} from "@luke/voice/transcript-model";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "@luke/voice/voice-view";
import { Duration, Effect, Option, Schema } from "effect";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip";
import { MAIN_TAB } from "./use-main-tabs";
import { SIDE_PANEL_TAB } from "./use-side-panel";
import {
  AUTOMATIONS_PAGE,
  type LeaveAsk,
  type TasksControl,
  useLeaveGuard,
  useTasksTab,
} from "./use-tasks-tab";

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
    inboxTaskId: Schema.NullOr(Schema.String),
  }),
);

/** A start's planning, read back where it names one. */
const readPlanningNamed = Schema.decodeUnknownOption(
  Schema.Struct({ planning: Schema.optionalKey(Schema.Boolean) }),
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
  voice: VoiceView;
  unseenAgents: readonly string[];
  inboxWaiting: readonly AppInboxTask[];
  inboxTasks: readonly AppInboxTaskHolding[];
  /** Whether an account is signed in to the window. */
  signedIn: boolean;
  /** The signed-in account's email. */
  account: string;
}

/** Mounts the hook alone over what the panel would hand it, keeping every act it told, in order; `answers` answers the acts it names. */
function mount(
  initial: Partial<Standing> = {},
  answers: { [Kind in ActKind]?: (...args: unknown[]) => Promise<ActResultFor<Kind>> } = {},
  registry?: AtomRegistry,
) {
  const told: ActKind[] = [];
  /** The coding-agent acts, kept apart: they are the agents' own and no planning press tells them. */
  const agentActs: ActKind[] = [];
  /** Which agent's tab main was told is shown, each time it was told. */
  const shownAgents: (string | null)[] = [];
  /** Which plan's Inbox main was told is shown, each time it was told. */
  const shownInboxes: (string | null)[] = [];
  /** What the voice window was told to do, each time it was told. */
  const voiceCommands: VoiceCommand[] = [];
  /** Each asked act's payload, unread until a test reads it as the act's schema would. */
  const payloads: { readonly kind: ActKind; readonly payload: unknown }[] = [];
  const links: SettingsLink[] = [];
  const record = (kind: ActKind) => {
    (kind.startsWith("codingAgents.") ? agentActs : told).push(kind);
  };
  let control: TasksControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  let standing: Standing = {
    shown: false,
    tasks: IDLE_TASKS_VIEW,
    profile: RUN_PROFILE.IDLE,
    fixtureMode: false,
    voice: IDLE_VOICE_VIEW,
    unseenAgents: [],
    inboxWaiting: [],
    inboxTasks: [],
    signedIn: true,
    account: "dev@example.com",
    ...initial,
  };
  function Probe() {
    const [held, setHeld] = useState(standing);
    restand = setHeld;
    control = useTasksTab({
      acts: {
        // An act the test does not answer is recorded and refused.
        act: <Kind extends ActKind>(
          kind: Kind,
          ...args: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          record(kind);
          payloads.push({ kind, payload: args[0] });
          const answer = answers[kind];
          if (answer !== undefined) return answer(...args);
          return Promise.reject(new Error("Not answered in this test."));
        },
        tell: (kind: ActKind, ...args: unknown[]) => {
          record(kind);
          // The one told payload the tests read, parsed as the boundary would.
          const shown = Option.getOrUndefined(readShown(args[0]));
          if (kind === ACT_KIND.CODING_AGENTS_SHOWN && shown !== undefined) {
            shownAgents.push(shown.agentId);
            shownInboxes.push(shown.inboxTaskId);
          }
          const voiceCommand = Option.getOrUndefined(readVoiceCommand(args[0]));
          if (kind === ACT_KIND.VOICE_COMMAND && voiceCommand !== undefined) {
            voiceCommands.push(voiceCommand.command);
          }
        },
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
      voice: { view: held.voice, listening: false, requestMicrophoneAccess: () => undefined },
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onOpenSettings: (link) => links.push(link),
      leaveGuard: useLeaveGuard(),
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  // The window's toast stands beside the tab, as the app draws it.
  const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
  act(() => {
    createRoot(container).render(registry === undefined ? surface : onRegistry(registry, surface));
  });
  return {
    told,
    agentActs,
    shownAgents,
    shownInboxes,
    voiceCommands,
    payloads,
    /** Every Settings link the tab followed, in order. */
    links,
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: (patch: Partial<Standing>) => {
      standing = { ...standing, ...patch };
      act(() => restand?.(standing));
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** Lets the clipboard's answer, and the redraw it causes, land with no time passing. */
const landed = Effect.promise(settle);

/** Advances the clock the toast's hold waits on, then lets what fell due land. */
const _advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), landed);

/** What the newest toast says, while one stands. */
function _toast(): string | undefined {
  return newestToastSays();
}

/** The newest toast's Undo. */
function _undoButton(): HTMLButtonElement {
  const undo = newestToastAction();
  assert.ok(undo, "no Undo on the toast");
  assert.equal(undo.textContent, "Undo");
  return undo;
}

/** A plan with a history: Luke wrote it on a call, over a first version. */
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

/** A plan other than the open one, which the host opens in its place. */
const OTHER_TASK_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

/** A plan's row of the list, started at `createdAt`, with whatever pin or archive it is given. */
function _row(
  id: string,
  createdAt: number,
  marks: { pinnedAt?: number; archivedAt?: number } = {},
) {
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

/** A plan's row of the list, started at `createdAt`, with whatever pin or archive it is given. */
function row(
  id: string,
  createdAt: number,
  marks: { pinnedAt?: number; archivedAt?: number } = {},
) {
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

/** The account's plans across its two workspaces: two of its own, one of the team's, and one of each archived. */
const TWO_WORKSPACES: TasksView = {
  ...IDLE_TASKS_VIEW,
  listStatus: TASKS_READ.READY,
  workspaces: [PERSONAL, ACME],
  tasks: [
    row("notes", 4),
    { ...row("alerts", 3), workspaceId: ACME.id },
    row("billing", 2),
    { ...row("old-launch", 1, { archivedAt: 9 }), workspaceId: ACME.id },
    row("old-notes", 1, { archivedAt: 8 }),
  ],
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
  payloads: readonly { readonly kind: ActKind; readonly payload: unknown }[],
  kind: ActKind,
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

  let note: string | undefined;
  await act(async () => {
    note = await tab
      .control()
      .newTask.start("Dark mode", "acme/web", tab.control().newTask.workspaceId, true);
  });
  assert.ok(note, "a refusal says why");
  assert.equal(tab.control().newTask.open, true, "a refusal keeps the dialog");
  await act(async () => {
    note = await tab
      .control()
      .newTask.start("Dark mode", "acme/web", tab.control().newTask.workspaceId, true);
  });
  assert.equal(note, undefined);
  assert.equal(tab.control().newTask.open, false, "a plan started closes the dialog");

  act(() => tab.control().onNewTask());
  tab.stand({ shown: false });
  tab.stand({ shown: true });
  assert.equal(tab.control().newTask.open, false, "Settings taking the window put the dialog away");
});

test("a task started opens with the side panel hidden, however the task before it left the panel, and a refused start leaves it as it stood", async () => {
  const answers = [
    { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE },
    { planId: OTHER_TASK_ID },
  ] as const;
  let start = 0;
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => Promise.resolve(answers[start++] ?? answers[1]) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onToggleFullScreen());
  assert.equal(panel().fullScreen, true);

  const startTask = () =>
    act(async () => {
      await tab.control().newTask.start("Dark mode", null, tab.control().newTask.workspaceId, true);
    });
  act(() => tab.control().onNewTask());
  await startTask();
  assert.equal(panel().open, true, "a refused start leaves the panel shown");
  await startTask();
  assert.equal(panel().open, false, "the task started opens with the panel hidden");
  assert.equal(panel().fullScreen, false);

  act(() => panel().onToggle());
  assert.equal(panel().fullScreen, false, "shown again, the panel stands beside the document");
  assert.equal(panel().tab, SIDE_PANEL_TAB.BOARD, "it keeps the tab it had");
});

test("a planning worker's tab reads its session as an agent's worker's tab reads its own, under the plan and the call that started it", async () => {
  const asked: unknown[] = [];
  const page = {
    messages: [],
    cursor: "3:1",
    status: CODING_AGENT_STATUS.RUNNING,
    title: null,
  };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_MESSAGES]: (payload) => {
        asked.push(payload);
        return Promise.resolve(page);
      },
    },
  );

  const read = await tab.control().work.readWorker({
    agentId: "plan-1",
    after: "0:0",
    callId: "call-0-0",
  });

  assert.deepEqual(asked, [{ taskId: "plan-1", after: "0:0", callId: "call-0-0" }]);
  assert.deepEqual(read, page);
});

/** The words of every call the transcript draws, in order, with whether each call stands now. */
function _callsDrawn(region: TranscriptRegion): (readonly [boolean, string[]])[] {
  if (region.kind !== TRANSCRIPT_REGION.READY) return [];
  return region.calls.map((call) => [call.live, call.messages.map(messageText)] as const);
}

const EMPTY_BOARD: Board = { elements: [], appliedDrawing: 0 };

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
  lines: [[{ text: "export function accept() {}" }]],
};

/** The code shown on the open plan: one snippet, then a second of the same file. */
const SHOWN: readonly TaskCodeShowing[] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];
const _SHOWN_AGAIN: readonly TaskCodeShowing[] = [
  ...SHOWN,
  { callId: "show-2", turnId: "turn-1", shownAt: 1, code: CODE },
];

/** A call in progress about the open plan, which is what puts code on screen. */
const _ON_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  callTaskId: TASK.id,
  voiceStatus: LIVE_STATUS.LISTENING,
};

/** The panel as the developer sees it: shown or not, and on which tab. */
function panelOf(tab: ReturnType<typeof mount>) {
  const { open, tab: shown } = tab.control().sidePanel;
  return { open, tab: shown };
}

/** One turn of Luke's planning model on the open plan. */
const TURN: TaskWorkTurn = {
  turnId: "turn-1",
  startedAt: 1,
  state: TASK_WORK_STATE.DONE,
  earlierOmitted: false,
  journal: [],
  workers: [],
};

/** The open plan's calls read back: none, and one with a line said on it. */
const NO_CALLS: TasksView["transcript"] = {
  status: TASKS_READ.READY,
  transcript: { calls: [], earlierOmitted: false },
};
const _ONE_CALL: TasksView["transcript"] = {
  status: TASKS_READ.READY,
  transcript: {
    calls: [
      {
        id: "5d7f9b1c-3e5a-4c7e-9a1b-3c5e7f9b1d3f",
        startedAt: 1,
        messages: [
          { id: "0", role: "user", parts: [{ type: "text", text: "Invites should expire." }] },
        ],
      },
    ],
    earlierOmitted: false,
  },
};

/** The open plan read with nothing on it yet: an empty board, no code, no call, no work. */
const _NOTHING_YET: TasksView = {
  ...OPEN,
  board: EMPTY_BOARD,
  shownCode: [],
  transcript: NO_CALLS,
  work: [],
};

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

/** Luke's start of a coding agent in the open plan's work, as its call stands: still running, or answered. */
function _startedAgent(
  state: typeof TASK_WORK_STATE.RUNNING | typeof TASK_WORK_STATE.DONE,
): TaskWorkTurn {
  return {
    ...TURN,
    journal: [
      {
        type: "tool-start_coding_agent",
        toolCallId: "call-start-1",
        state: state === TASK_WORK_STATE.DONE ? "output-available" : "input-available",
        input: {},
      },
    ],
  };
}

/** How many times the plan's agents were read. */
function _listReads(tab: ReturnType<typeof mount>): number {
  return tab.agentActs.filter((kind) => kind === ACT_KIND.CODING_AGENTS_LIST).length;
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
  // The code shown on the plan stands its Code tab first.
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose(SIDE_PANEL_TAB.CALL));
  act(() => panel().onOpenFile(CODE.ref));
  const strip = [SIDE_PANEL_TAB.CODE, SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CALL, file];
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(column().tabs, [MAIN_TAB.PLAN, { agent: AGENT_ID }]);
  assert.equal(tab.control().onReopenClosedTab, undefined, "nothing closed, nothing to reopen");

  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  act(() => column().onClose({ agent: AGENT_ID }));
  act(() => panel().onClose(file));
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  assert.deepEqual(panel().strip, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CALL]);
  assert.deepEqual(column().tabs, [MAIN_TAB.PLAN]);

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CALL, file]);
  assert.deepEqual(panel().tab, file);
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range]),
    [[CODE.ref.path, { startLine: 1, endLine: 1 }]],
    "the file's tab lights the lines it lit",
  );

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(column().tabs, [MAIN_TAB.PLAN, { agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.equal(tab.control().onReopenClosedTab, undefined);
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
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.BOARD]);
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

test("a Luke link to a task's version opens its version history on that version, and one to its call opens its Call tab", () => {
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
      place: { kind: LINK_PLACE.CALL, planId: TASK.id },
    }),
  );

  assert.deepEqual(history, { open: true, spot: { revision: 3, opened: undefined } });
  assert.equal(tab.control().history.open, false);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CALL });
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
  assert.deepEqual(panel().tabs, [SIDE_PANEL_TAB.CODE], "the Board, closed first, is not kept");
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

/** A third plan, which neither tab was closed on. */
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

test("the sidebar lists the first workspace's plans first, a workspace chosen lists its own alone while every plan stays findable, and New plan starts in the one chosen", async () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  const personal = {
    workspace: tab.control().workspace?.id,
    tasks: tab.control().listed.tasks.map((task) => task.id),
    archived: tab.control().listed.archived.map((task) => task.id),
  };
  await tab.control().newTask.start("Invites", null, tab.control().newTask.workspaceId, true);
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().newTask.start("Usage", "acme/relay", tab.control().newTask.workspaceId, true);

  assert.deepEqual(personal, {
    workspace: PERSONAL.id,
    tasks: ["notes", "billing"],
    archived: ["old-notes"],
  });
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["alerts"],
  );
  assert.deepEqual(
    tab.control().listed.archived.map((task) => task.id),
    ["old-launch"],
  );
  assert.deepEqual(startedIn(tab.payloads), [PERSONAL.id, ACME.id]);
  assert.deepEqual(
    tab.control().tasks.map((task) => task.id),
    ["notes", "alerts", "billing"],
    "the palette, the inbox, and the history find every workspace's plans",
  );
  assert.deepEqual(
    tab.control().archived.map((task) => task.id),
    ["old-launch", "old-notes"],
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

/** A plan's inbox waiting on the developer: `count` open items, each asked by one agent. */
function waitingIn(taskId: string, count: number): AppInboxTask {
  return {
    taskId: taskId,
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

test("an Inbox item chosen in one workspace gives way as another is listed, so main is not told its plan's Inbox still shows", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  const chosen = tab.control().inboxView.chosen;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(chosen, { taskId: "notes", itemId: "notes-item-0" });
  assert.equal(tab.control().inboxView.chosen, undefined);
  assert.equal(tab.shownInboxes.at(-1), null);
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

/** The plans each open the tab asked of main named, in order. */
function opensAsked(payloads: readonly { readonly kind: ActKind; readonly payload: unknown }[]) {
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
      tasks: tasks,
    },
  });
  act(() => active.control().onChooseWorkspace(ACME.id));
  const reached = active.control().repositories.recent;
  document.body.innerHTML = "";

  const suspended = mount({
    shown: true,
    tasks: {
      ...TWO_WORKSPACES,
      workspaces: [PERSONAL, { ...ACME, github: { login: "acme", active: false } }],
      tasks: tasks,
    },
  });
  act(() => suspended.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(reached, ["acme/relay"]);
  assert.deepEqual(suspended.control().repositories.recent, []);
});

test("a workspace chosen is chosen again on the next launch, and one the account is no longer in gives way to the first one", () => {
  const first = mount({ shown: true, tasks: TWO_WORKSPACES });
  act(() => first.control().onChooseWorkspace(ACME.id));
  document.body.innerHTML = "";

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

  await tab.control().newTask.start("Invites", null, tab.control().newTask.workspaceId, true);

  assert.equal(tab.control().workspace, undefined);
  assert.deepEqual(
    tab.control().listed.tasks.map((task) => task.id),
    ["notes", "alerts", "billing"],
  );
  assert.deepEqual(startedIn(tab.payloads), [undefined]);
});

test("New plan with Plan off asks for a task without planning, and with it on names no planning, as every start did before", async () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  await tab.control().newTask.start("Typo", null, tab.control().newTask.workspaceId, false);
  await tab.control().newTask.start("Invites", null, tab.control().newTask.workspaceId, true);

  assert.deepEqual(
    tab.payloads
      .filter((asked) => asked.kind === ACT_KIND.TASKS_START)
      .map((asked) => Option.getOrUndefined(readPlanningNamed(asked.payload))?.planning),
    [false, undefined],
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
  const refusal = ACT[ACT_KIND.GITHUB_DISCONNECT].refusal;
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
  act(() =>
    createRoot(chip).render(
      createElement(RepositoryChip, {
        value: null,
        chooser: tab.control().newTask.repositoriesIn(ACME.id),
        onChoose: () => undefined,
        place: CHIP_PLACE.FIELD,
      }),
    ),
  );
  await settle();
  act(() => chip.querySelector<HTMLButtonElement>(".chip")?.click());
  await settle();

  const menu = chip.querySelector('[aria-label="Repository"]') ?? assert.fail("the menu opens");
  assert.deepEqual(
    [
      // A row names the repository, then its owner after it.
      [...menu.querySelectorAll('[role="option"]')].map((row) =>
        [".task-compose-menu-detail", ".task-compose-menu-name"]
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

test("a fixture run lists its first workspace's plans under the switcher, and a choice there is kept nowhere", () => {
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

/** The plan as the list names it, archived where `archivedAt` is given. */
function listed(archivedAt?: number): TasksView["tasks"][number] {
  const { document: _document, ...summary } = TASK;
  return archivedAt === undefined ? summary : { ...summary, archivedAt };
}

/** The view a launch starts on: nothing open, and the list not yet read. */
const LAUNCHING: TasksView = { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READING };

/** The view once the list is read with nothing open, holding `plans`. */
function listRead(tasks: TasksView["tasks"]): TasksView {
  return { ...IDLE_TASKS_VIEW, listStatus: TASKS_READ.READY, tasks: tasks };
}

/** A select's payload, read back as the act's own schema admits it. */
const readSelect = Schema.decodeUnknownOption(Schema.Struct({ taskId: Schema.String }));

/** The plans the launch asked the host to open, in order. */
function selected(tab: ReturnType<typeof mount>): string[] {
  return tab.payloads
    .filter((each) => each.kind === ACT_KIND.TASKS_SELECT)
    .flatMap((each) => Option.toArray(readSelect(each.payload)).map((read) => read.taskId));
}

/** A run that had the plan open when it quit. */
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

test("a plan archived or deleted since the quit, or kept by another account, leaves the launch on the home page", () => {
  for (const [why, account, tasks] of [
    ["archived", "dev@example.com", [listed(3)]],
    ["deleted", "dev@example.com", []],
    ["another account", "other@example.com", [listed()]],
  ] as const) {
    quitWithTaskOpen();
    const tab = mount({ shown: true, account, tasks: LAUNCHING });
    tab.stand({ tasks: listRead(tasks) });
    assert.deepEqual(selected(tab), [], why);
    assert.equal(tab.control().restoring, false, why);
    document.body.innerHTML = "";
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
  document.body.innerHTML = "";
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

  act(() => tab.control().factoryView.onOpen());
  act(() => tab.control().onGoHome());
  act(() => tab.control().onChooseWorkspace("workspace-other"));
  assert.equal(tab.control().inboxView.open, true, "the page stands while it is asked about");
  assert.equal(asked.length, 3, "the workspace switcher asks as the other doors do");

  act(() => asked[0]?.());
  assert.equal(tab.control().factoryView.open, true, "Leave goes where the first way out went");

  act(() => down());
  act(() => tab.control().inboxView.onOpen());
  assert.equal(tab.control().inboxView.open, true);
  assert.equal(asked.length, 3, "nothing is asked once the ask is down");
});

test("Factory and the Inbox stand in the plan's place in turn: opening one puts the other away, and Home or a plan's press puts Factory away", () => {
  const tab = mount({ shown: true, tasks: listRead([listed()]) });
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().factoryView.onOpen());
  assert.equal(tab.control().factoryView.open, true);
  assert.equal(tab.control().inboxView.open, false);

  act(() => tab.control().inboxView.onOpen());
  assert.equal(tab.control().factoryView.open, false);
  assert.equal(tab.control().inboxView.open, true);

  act(() => tab.control().factoryView.onOpen());
  act(() => tab.control().onGoHome());
  assert.equal(tab.control().factoryView.open, false);

  act(() => tab.control().factoryView.onOpen());
  act(() => tab.control().onSelect(TASK.id));
  assert.equal(tab.control().factoryView.open, false);
});

test("Home from an open plan leaves it, and from the home page only puts the Inbox away, asking the host nothing", () => {
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_CLOSE]: () => Promise.resolve() },
  );
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().onGoHome());
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.told.at(-1), ACT_KIND.TASKS_CLOSE);
  assert.equal(tab.control().boundFor, undefined);

  const home = mount({ shown: true, tasks: listRead([]) });
  act(() => home.control().inboxView.onOpen());
  act(() => home.control().onGoHome());
  assert.equal(home.control().inboxView.open, false);
  assert.ok(!home.told.includes(ACT_KIND.TASKS_CLOSE));
});

test("one agent's pins are asked one after another, so the service hears an Unpin pressed before a Pin landed after it", async () => {
  const answers: ((answer: ActResultFor<typeof ACT_KIND.CODING_AGENTS_PIN>) => void)[] = [];
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

test("an agent's pin still waiting its turn when the account changes is never asked, so it lands on no one else's pins", async () => {
  const answers: ((answer: ActResultFor<typeof ACT_KIND.CODING_AGENTS_PIN>) => void)[] = [];
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
