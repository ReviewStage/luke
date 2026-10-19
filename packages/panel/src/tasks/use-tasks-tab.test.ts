// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import type { Board } from "@luke/features/board-wire";
import { CHANNEL_KIND, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { ISSUE_PRIORITY, ISSUE_STATUS } from "@luke/features/issue-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { MENTION_KIND } from "@luke/features/mention-link";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
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
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { experimentsOn } from "@luke/settings/testing";
import { CHAT_PLACE, FOR_YOU } from "@luke/ui/chat-model";
import { SECTION_WRITE_FAILED_NOTE } from "@luke/ui/task-sections-model";
import { DOCUMENT_REGION, PIN_MOVE_FAILED_NOTE, TASKS_PAGE } from "@luke/ui/tasks-model";
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
import * as AtomRegistryModule from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip.js";
import { MAIN_TAB } from "./use-main-tabs.js";
import { SIDE_PANEL_TAB } from "./use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  ISSUES_PAGE,
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
    inboxTaskId: Schema.NullOr(Schema.String),
    chatShown: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({ workspaceId: Schema.String, taskId: Schema.NullOr(Schema.String) }),
      ),
    ),
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
  /** The room the panel's stage gives. */
  room: ShellRoom;
}

/** Mounts the hook alone over what the panel would hand it, keeping every act it told, in order; `answers` answers the acts it names. */
function mount(
  initial: Partial<Standing> = {},
  answers: { [Kind in ActKind]?: (...args: unknown[]) => Promise<ActResultFor<Kind>> } = {},
  registry?: AtomRegistry,
) {
  const told: ActKind[] = [];
  /** The coding-agent acts, kept apart: they are the agents' own and no task press tells them. */
  const agentActs: ActKind[] = [];
  /** Which agent's tab main was told is shown, each time it was told. */
  const shownAgents: (string | null)[] = [];
  /** Which task's Inbox main was told is shown, each time it was told. */
  const shownInboxes: (string | null)[] = [];
  /** Which Chat main was told is on screen, each time it was told. */
  const shownChats: ({ workspaceId: string; taskId: string | null } | null)[] = [];
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
    room: SHELL_ROOM.WIDE,
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
            shownChats.push(shown.chatShown ?? null);
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
      room: held.room,
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
    shownChats,
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

/** A task's row of the list, started at `createdAt`, with whatever pin or archive it is given. */
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

/** A task's row of the list, started at `createdAt`, with whatever pin or archive it is given. */
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

/** The account's tasks across its two workspaces: two of its own, one of the team's, and one of each archived. */
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

test("a task started opens with the side panel shown on its plan, a refused start hides it again where it stood hidden, and a panel hidden before the start answers stays hidden", async () => {
  const answers: Array<(answer: ActResultFor<typeof ACT_KIND.TASKS_START>) => void> = [];
  const tab = mount(
    { shown: true, tasks: OPEN },
    { [ACT_KIND.TASKS_START]: () => new Promise((resolve) => answers.push(resolve)) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onToggle());
  assert.equal(panel().open, false);

  const send = () => {
    let note: Promise<string | undefined> = Promise.resolve(undefined);
    act(() => {
      note = tab
        .control()
        .newTask.start("Dark mode", null, tab.control().newTask.workspaceId, true);
    });
    return note;
  };
  act(() => tab.control().onNewTask());
  const refused = send();
  assert.deepEqual(
    panelOf(tab),
    { open: true, tab: SIDE_PANEL_TAB.PLAN },
    "the panel shows as the start is sent",
  );
  await act(async () => {
    answers[0]?.({ failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
    await refused;
  });
  assert.equal(panel().open, false, "a refusal hides it again");

  const started = send();
  assert.equal(panel().open, true);
  // The host turns to the new plan before the start answers, and the developer hides its panel.
  act(() => panel().onToggle());
  await act(async () => {
    answers[1]?.({ planId: OTHER_TASK_ID });
    await started;
  });
  assert.equal(panel().open, false, "the late answer leaves the panel the developer hid");
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

/** The code shown on the open task: one snippet, then a second of the same file. */
const SHOWN: readonly TaskCodeShowing[] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];
const _SHOWN_AGAIN: readonly TaskCodeShowing[] = [
  ...SHOWN,
  { callId: "show-2", turnId: "turn-1", shownAt: 1, code: CODE },
];

/** A call in progress about the open task, which is what puts code on screen. */
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

/** One turn of Luke's brain on the open task. */
const TURN: TaskWorkTurn = {
  turnId: "turn-1",
  startedAt: 1,
  state: TASK_WORK_STATE.DONE,
  earlierOmitted: false,
  journal: [],
  workers: [],
};

/** The open task's calls read back: none, and one with a line said on it. */
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

/** The open task read with nothing on it yet: an empty board, no code, no call, no work. */
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

/** Luke's start of a coding agent in the open task's work, as its call stands: still running, or answered. */
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

/** How many times the task's agents were read. */
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
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL, { agent: AGENT_ID }]);
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
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL]);

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
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL, { agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().strip, strip);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.equal(tab.control().onReopenClosedTab, undefined);
});

test("the Call's tab closes beside another, stays closed across a launch until chosen again, and stands again, never closing, once nothing else does", async () => {
  const listed = {
    [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }),
  };
  const tab = mount({ shown: true, tasks: OPEN }, listed);
  await settle();
  const column = () => tab.control().mainTabs;
  const agent = { agent: AGENT_ID };
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL, agent]);

  act(() => column().onClose(MAIN_TAB.CALL));
  assert.deepEqual(column().tabs, [agent]);
  assert.deepEqual(column().tab, agent, "the column shows the tab beside it");
  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL, agent], "⇧⌘T opens it first again");
  assert.equal(column().tab, MAIN_TAB.CALL);
  act(() => column().onClose(MAIN_TAB.CALL));

  const launched = mount({ shown: true, tasks: OPEN }, listed);
  await settle();
  const again = () => launched.control().mainTabs;
  assert.deepEqual(again().tabs, [agent], "a launch keeps it closed");

  act(() => again().onClose(agent));
  assert.deepEqual(again().tabs, [MAIN_TAB.CALL]);
  assert.equal(again().tab, MAIN_TAB.CALL, "a column with no other tab is back on the Call");
  act(() => again().onClose(MAIN_TAB.CALL));
  assert.deepEqual(again().tabs, [MAIN_TAB.CALL], "alone, it does not close");
  act(() => again().onChoose(agent));
  assert.deepEqual(again().tabs, [MAIN_TAB.CALL, agent], "it stays open beside a tab opened since");
});

test("a column kept while the plan and the Inbox stood in it reads with both let go, its agents' order and the tab last viewed still standing", async () => {
  window.localStorage.setItem(
    "luke.mainTabs",
    JSON.stringify({
      closedAgents: [],
      tasks: {
        [TASK.id]: {
          recent: ["plan", { agent: AGENT_ID }, "inbox"],
          order: [{ agent: AGENT_ID }, "inbox"],
          inboxOpen: true,
          inboxSeen: ["item-1"],
          planClosed: true,
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
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL, { agent: AGENT_ID }]);
  assert.deepEqual(column().tab, { agent: AGENT_ID });
});

test("a closed Call's tab that stands again because its last agent was archived stays open beside the next tab opened", async () => {
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
  act(() => column().onClose(MAIN_TAB.CALL));
  assert.deepEqual(column().tabs, [{ agent: AGENT_ID }]);

  await act(() => tab.control().agents.onArchive(AGENT_ID, true));
  await settle();
  assert.deepEqual(column().tabs, [MAIN_TAB.CALL]);
  act(() => column().onChoose({ draft: tab.control().agents.onNewDraft() }));
  assert.equal(column().tabs[0], MAIN_TAB.CALL, "the Call's tab stands beside the draft's");
  assert.equal(column().tabs.length, 2);
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

test("a peek opened beside the Issues list shows the panel, though the plan open behind it holds no tab", () => {
  window.localStorage.clear();
  const tab = mount({ shown: true, tasks: { ...TWO_WORKSPACES, activeTaskId: "billing" } });
  act(() => tab.control().issuesView.onOpen());
  act(() => tab.control().issuesView.onPeek("issue-1"));
  act(() => tab.control().sidePanel.onSetOpen(true));

  assert.deepEqual(tab.control().sidePanel.strip, [], "no tab of the plan's");
  assert.equal(tab.control().sidePanel.open, true);
  assert.equal(tab.control().issuesView.peeked, "issue-1");
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

test("a Luke link to an issue opens its page in the workspace its slug names, in the place of the Inbox", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const issueId = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
  act(() => tab.control().inboxView.onOpen());

  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.ISSUE, issueId },
    }),
  );

  assert.equal(tab.control().workspace?.id, PERSONAL.id);
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.control().issuesView.open, true);
  assert.deepEqual(tab.control().issuesView.place, { kind: ISSUES_PAGE.ISSUE, issueId });
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
  assert.equal(tab.control().mainTabs.tab, MAIN_TAB.CALL);
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

test("the Inbox opened again stands on the item last chosen in it, as a row's choice, and on none once another workspace is listed", () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES });
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ taskId: "notes", itemId: "notes-item-0" }));
  act(() => tab.control().factoryView.onOpen());
  act(() => tab.control().inboxView.onOpen());
  const chosen = tab.control().inboxView.chosen;
  act(() =>
    tab.control().onOpenLink({
      workspace: "personal",
      place: { kind: LINK_PLACE.INBOX_ITEM, planId: "notes", itemId },
    }),
  );
  act(() => tab.control().onGoHome());
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
  act(() => tab.control().factoryView.onOpen());
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
      tasks,
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

test("New plan hands Luke the brief it was given beside its issue, and a blank brief is not sent", async () => {
  const tab = mount({ shown: true, tasks: TWO_WORKSPACES }, UNSTARTED);

  await tab.control().newTask.start("", null, "workspace-acme", true, {
    linearIssueId: "issue-1",
    brief: "Keep the queue order stable.",
  });
  await tab.control().newTask.start("", null, "workspace-acme", true, { brief: " \n " });

  assert.deepEqual(
    tab.payloads
      .filter((asked) => asked.kind === ACT_KIND.TASKS_START)
      .map((asked) => asked.payload),
    [
      {
        workspaceId: "workspace-acme",
        linearIssueId: "issue-1",
        brief: "Keep the queue order stable.",
      },
      { workspaceId: "workspace-acme" },
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

/** The task as the list names it, archived where `archivedAt` is given. */
function listed(archivedAt?: number): TasksView["tasks"][number] {
  const { document: _document, ...summary } = TASK;
  return archivedAt === undefined ? summary : { ...summary, archivedAt };
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
  assert.equal(newestToastSays(), PIN_MOVE_FAILED_NOTE);
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
  assert.equal(newestToastSays(), SECTION_WRITE_FAILED_NOTE);
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
  assert.equal(fixture.control().chatView.chat?.answer.channels.length, 8);
  const live = mount({ shown: true });
  await settle();
  assert.equal(live.control().chatView.open, false);
  assert.equal(live.control().chatView.chat, undefined);
});

test("opening Chat on a place, as a chat notice's Open in Chat does, asks first while a page stands its ask, as every other way out does", () => {
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

test("New task reads a workspace's own issues, each by its key, only while the account has Issues on", async () => {
  const listed = {
    id: "3f0e6f5c-7d1a-4f6e-9a55-000000000007",
    workspaceId: ACME.id,
    number: 7,
    title: "Invites expire",
    description: "",
    status: ISSUE_STATUS.TODO,
    priority: ISSUE_PRIORITY.NONE,
    creator: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const answers = { [ACT_KIND.ISSUES_LIST]: () => Promise.resolve({ issues: [listed] }) };
  handState({});
  const off = mount({ shown: true, tasks: TWO_WORKSPACES }, answers, AtomRegistryModule.make());
  const offRead = off.control().newTask.issuesIn(ACME.id);

  handState(experimentsOn(EXPERIMENT.ISSUES));
  const on = mount({ shown: true, tasks: TWO_WORKSPACES }, answers, AtomRegistryModule.make());
  await settle();
  const read = on.control().newTask.issuesIn(ACME.id);

  assert.equal(offRead, undefined, "Issues off reads none");
  assert.deepEqual(await read?.(), [
    { id: listed.id, workspaceId: ACME.id, identifier: "ACME-7", title: "Invites expire" },
  ]);
});

test("a live run reads the listed workspace's chat only while the account has Chat on", async () => {
  handState({});
  const off = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await settle();
  assert.ok(!off.agentActs.includes(ACT_KIND.CODING_AGENTS_CHAT), "Chat off reads no chat");
  assert.equal(off.control().chatView.available, false);

  handState(experimentsOn(EXPERIMENT.CHAT));
  const on = mount({ shown: true, tasks: TWO_WORKSPACES }, {}, AtomRegistryModule.make());
  await vi.waitFor(async () => {
    await settle();
    assert.ok(on.agentActs.includes(ACT_KIND.CODING_AGENTS_CHAT), "Chat on reads its chat");
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
  assert.deepEqual(tab.control().chatShown, { workspaceId: ACME.id, taskId: null });
});

test("the task's Chat tab, opened from ⌘K's Chat row, stands on its strip only while the account has Chat on", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const on = mount({ shown: true, tasks: OPEN }, {}, AtomRegistryModule.make());
  await settle();
  act(() => on.control().onShowChat(TASK.id));
  assert.ok(on.control().mainTabs.tabs.includes(MAIN_TAB.CHAT));

  handState({});
  const off = mount({ shown: true, tasks: OPEN }, {}, AtomRegistryModule.make());
  await settle();
  act(() => off.control().onShowChat(TASK.id));
  assert.ok(!off.control().mainTabs.tabs.includes(MAIN_TAB.CHAT));
});

test("main is told a task's Chat tab on screen shows only its plan's channel, where the window's Chat shows the whole workspace's", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] } },
    {},
    AtomRegistryModule.make(),
  );
  await settle();
  act(() => tab.control().onShowChat(TASK.id));
  const onTab = tab.shownChats.at(-1);
  act(() => tab.control().chatView.onOpen());

  assert.deepEqual(onTab, { workspaceId: PERSONAL.id, taskId: TASK.id });
  assert.deepEqual(tab.shownChats.at(-1), { workspaceId: PERSONAL.id, taskId: null });
  assert.deepEqual(tab.control().chatShown, tab.shownChats.at(-1));
});

test("the task's Chat tab on screen marks the task's plan channel read, as the window's Chat on that channel does", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const me = "b1c2d3e4-0000-4000-8000-000000000001";
  const channelId = "c0ffee00-0000-4000-8000-000000000002";
  const answer = {
    self: me,
    readSeq: 0,
    members: [{ id: me, kind: MEMBER_KIND.HUMAN, handle: "dean", left: false }],
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
    cursor: "4",
  };
  let reads = 0;
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] } },
    {
      [ACT_KIND.CODING_AGENTS_CHAT]: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve(answer) : new Promise(() => undefined);
      },
      [ACT_KIND.CODING_AGENTS_CHAT_POST]: () => Promise.resolve({ readSeq: 0 }),
    },
    AtomRegistryModule.make(),
  );
  await settle();
  act(() => tab.control().onShowChat(TASK.id));
  await vi.waitFor(async () => {
    await settle();
    const wrote = tab.payloads.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_CHAT_POST);
    assert.deepEqual(
      wrote.map((each) => each.payload),
      [{ workspaceId: PERSONAL.id, write: { readTo: 4, channelId } }],
    );
  });
});

test("a channel hidden behind a narrow room's Chat rail is not marked read until it stands on screen again", async () => {
  handState(experimentsOn(EXPERIMENT.CHAT));
  const me = "b1c2d3e4-0000-4000-8000-000000000001";
  const channelId = "c0ffee00-0000-4000-8000-000000000002";
  /** The chat as one read answers it: the channel, holding one message at `seq`. */
  const answerAt = (seq: number) => ({
    self: me,
    readSeq: 0,
    members: [{ id: me, kind: MEMBER_KIND.HUMAN, handle: "dean", left: false }],
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
    cursor: String(seq),
  });
  // The second read waits for the test to post a message, as the service's long read waits for one.
  const later = Promise.withResolvers<ReturnType<typeof answerAt>>();
  let reads = 0;
  const tab = mount(
    { shown: true, tasks: { ...OPEN, workspaces: [PERSONAL] }, room: SHELL_ROOM.NARROW },
    {
      [ACT_KIND.CODING_AGENTS_CHAT]: () => {
        reads += 1;
        if (reads === 1) return Promise.resolve(answerAt(4));
        return reads === 2 ? later.promise : new Promise(() => undefined);
      },
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
  await settle();
  assert.deepEqual(readTo(), [mark(4)], "the channel on screen is read");

  act(() => tab.control().chatView.onList());
  later.resolve(answerAt(5));
  await settle();
  assert.deepEqual(readTo(), [mark(4)], "a message landing behind the rail stays unread");

  act(() => tab.control().chatView.onChoose(place));
  await settle();
  assert.deepEqual(readTo(), [mark(4), mark(5)]);
});

test("a task started from an issue's Start agent… presses its Start once it stands open, with no planning, linked to the issue, and the agent's tab opens; an agent that did not start says why beside the Start", async () => {
  let agents = 0;
  let listed: CodingAgentSummary[] = [];
  const started: Task = { ...TASK, id: OTHER_TASK_ID, name: "Invites", repository: "acme/web" };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () => Promise.resolve({ planId: OTHER_TASK_ID }),
      // The service lists the agent once it started, as it does.
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: listed }),
      [ACT_KIND.CODING_AGENTS_START]: () => {
        if (agents++ > 0) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
        listed = [{ ...RUNNING_AGENT, id: AGENT_ID }];
        return Promise.resolve({ agent: { ...RUNNING_AGENT, id: AGENT_ID } });
      },
    },
  );
  await settle();
  const issue = {
    id: "issue-1",
    workspaceId: "workspace-acme",
    identifier: "ACME-7",
    title: "Invites",
  };
  const agentStarts = () =>
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.CODING_AGENTS_START);
  /** Start agent… pressed and its card's Start answered, then the task standing open as the host opens it. */
  const startFrom = async () => {
    act(() => tab.control().onNewTaskFrom(issue, true));
    await act(async () => {
      await tab.control().newTask.start("Invites", "acme/web", "workspace-acme", false, {
        issueId: issue.id,
        agent: true,
      });
    });
    await settle();
    tab.stand({
      tasks: {
        ...OPEN,
        activeTaskId: OTHER_TASK_ID,
        document: { status: TASKS_READ.READY, task: started },
      },
    });
    await settle();
  };

  act(() => tab.control().onNewTaskFrom(issue, true));
  assert.deepEqual(tab.control().newTask.preset, { issue, agent: true });
  act(() => tab.control().newTask.onClose());
  act(() => tab.control().onNewTaskFrom(issue, true));
  await act(async () => {
    await tab.control().newTask.start("Invites", "acme/web", "workspace-acme", false, {
      issueId: issue.id,
      agent: true,
    });
  });
  await settle();
  assert.deepEqual(agentStarts(), [], "no agent starts before its task stands open");
  assert.deepEqual(tab.payloads.find(({ kind }) => kind === ACT_KIND.TASKS_START)?.payload, {
    name: "Invites",
    repository: "acme/web",
    workspaceId: "workspace-acme",
    issueId: issue.id,
    planning: false,
  });
  tab.stand({
    tasks: {
      ...OPEN,
      activeTaskId: OTHER_TASK_ID,
      document: { status: TASKS_READ.READY, task: started },
    },
  });
  await settle();

  assert.equal(agentStarts().length, 1);
  assert.equal(JSON.parse(JSON.stringify(agentStarts()[0]?.payload)).taskId, OTHER_TASK_ID);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });

  tab.stand({ tasks: OPEN });
  await settle();
  await startFrom();
  assert.equal(agentStarts().length, 2);
  assert.ok(tab.control().agents.start.note, "why the agent did not start stands beside the Start");
});

test("an agent asked of Start agent… whose task was left before it could start starts nothing when the task is opened again", async () => {
  const started: Task = { ...TASK, id: OTHER_TASK_ID, name: "Invites", repository: "acme/web" };
  const tab = mount(
    { shown: true, tasks: OPEN },
    {
      [ACT_KIND.TASKS_START]: () => Promise.resolve({ planId: OTHER_TASK_ID }),
      [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }),
      [ACT_KIND.CODING_AGENTS_START]: () =>
        Promise.resolve({ agent: { ...RUNNING_AGENT, id: AGENT_ID } }),
    },
  );
  await settle();
  const standOn = (task: Task) =>
    tab.stand({
      tasks: { ...OPEN, activeTaskId: task.id, document: { status: TASKS_READ.READY, task } },
    });

  act(() =>
    tab
      .control()
      .onNewTaskFrom(
        { id: "issue-1", workspaceId: "workspace-acme", identifier: "ACME-7", title: "Invites" },
        true,
      ),
  );
  await act(async () => {
    await tab.control().newTask.start("Invites", "acme/web", "workspace-acme", false, {
      issueId: "issue-1",
      agent: true,
    });
  });
  // The new task opens while its repository is still unread, and the developer leaves it for another.
  standOn({ ...started, repository: null });
  await settle();
  standOn(TASK);
  await settle();
  standOn(started);
  await settle();

  assert.deepEqual(
    tab.payloads.filter(({ kind }) => kind === ACT_KIND.CODING_AGENTS_START),
    [],
  );
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
  let note: string | undefined = "unanswered";
  await act(async () => {
    note = await tab.control().newTask.start("", "acme/web", undefined, false, {
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
  document.body.innerHTML = "";

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
