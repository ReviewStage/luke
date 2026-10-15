// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import type { Board } from "@luke/features/board-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { PLAN_ACTOR, type Plan } from "@luke/features/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLAN_WORK_STATE,
  PLANNING_READ,
  type PlanCode,
  type PlanCodeShowing,
  type PlanningView,
  type PlanWorkTurn,
} from "@luke/features/planning-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT, ACT_KIND, type ActKind, type ActResultFor } from "@luke/host/acts";
import { type AppInboxPlan, type AppInboxPlanHolding, RUN_PROFILE } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { PLANS_PAGE } from "@luke/ui/planning-model";
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
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { MAIN_TAB } from "./use-main-tabs";
import { type PlansControl, usePlansTab } from "./use-plans-tab";
import { SIDE_PANEL_TAB } from "./use-side-panel";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OPEN: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.READY,
  workspaces: [],
  activePlanId: PLAN.id,
  document: { status: PLANNING_READ.READY, plan: PLAN },
};

/** The shown act's payload, read back as the act's own schema admits it. */
const readShown = Schema.decodeUnknownOption(
  Schema.Struct({
    agentId: Schema.NullOr(Schema.String),
    inboxPlanId: Schema.NullOr(Schema.String),
  }),
);

/** A voice command's payload, read back as the act's own schema admits it. */
const readVoiceCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.Literals(Object.values(VOICE_COMMAND)) }),
);

interface Standing {
  shown: boolean;
  planning: PlanningView;
  profile: string;
  fixtureMode: boolean;
  voice: VoiceView;
  unseenAgents: readonly string[];
  inboxWaiting: readonly AppInboxPlan[];
  inboxPlans: readonly AppInboxPlanHolding[];
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
  let control: PlansControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  let standing: Standing = {
    shown: false,
    planning: IDLE_PLANNING_VIEW,
    profile: RUN_PROFILE.IDLE,
    fixtureMode: false,
    voice: IDLE_VOICE_VIEW,
    unseenAgents: [],
    inboxWaiting: [],
    inboxPlans: [],
    signedIn: true,
    account: "dev@example.com",
    ...initial,
  };
  function Probe() {
    const [held, setHeld] = useState(standing);
    restand = setHeld;
    control = usePlansTab({
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
            shownInboxes.push(shown.inboxPlanId);
          }
          const voiceCommand = Option.getOrUndefined(readVoiceCommand(args[0]));
          if (kind === ACT_KIND.VOICE_COMMAND && voiceCommand !== undefined) {
            voiceCommands.push(voiceCommand.command);
          }
        },
      },
      planning: held.planning,
      run: { fixtureMode: held.fixtureMode, profile: held.profile },
      signedIn: held.signedIn,
      account: held.signedIn ? held.account : undefined,
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: held.shown,
      unseenAgents: held.unseenAgents,
      inboxWaiting: held.inboxWaiting,
      inboxPlans: held.inboxPlans,
      inboxPlanless: [],
      voice: { view: held.voice, listening: false, requestMicrophoneAccess: () => undefined },
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onOpenSettings: (link) => links.push(link),
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
const _EDITED: PlanningView = {
  ...OPEN,
  document: {
    status: PLANNING_READ.READY,
    plan: { ...PLAN, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: true } },
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
const OTHER_PLAN_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

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
const TWO_WORKSPACES: PlanningView = {
  ...IDLE_PLANNING_VIEW,
  listStatus: PLANNING_READ.READY,
  workspaces: [PERSONAL, ACME],
  plans: [
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
  namedIn(payloads, ACT_KIND.PLANNING_START);

const UNSTARTED = {
  [ACT_KIND.PLANNING_START]: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
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
    { shown: true, planning: OPEN },
    // The service never answers, as when the window signs out with the pin still out.
    { [ACT_KIND.PLANNING_PIN_REPOSITORY]: () => new Promise<boolean>(() => undefined) },
  );

  act(() => tab.control().onPinRepository("acme/secret", true));
  const pending = tab.control().pinnedRepositories;
  tab.stand({ signedIn: false, planning: IDLE_PLANNING_VIEW });
  tab.stand({ signedIn: true, planning: { ...OPEN, repositoryPins: [] } });

  assert.deepEqual(pending, ["acme/secret"]);
  assert.deepEqual(tab.control().pinnedRepositories, []);
});

test("New plan opens its dialog over the open plan, which stays open; a second press leaves it as it stands, only a plan that starts closes it, and leaving the tab puts it away", async () => {
  const answers = [
    { failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE },
    { planId: OTHER_PLAN_ID },
  ] as const;
  let start = 0;
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_START]: () => Promise.resolve(answers[start++] ?? answers[1]) },
  );

  act(() => tab.control().onNewPlan());
  act(() => tab.control().newPlan.onClose());
  assert.equal(tab.control().newPlan.open, false, "Cancel puts the dialog away");
  act(() => tab.control().onNewPlanIn("acme/web"));
  assert.equal(tab.control().newPlan.open, true);
  assert.deepEqual(tab.control().newPlan.preset, { repository: "acme/web" });
  assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT, "the plan behind the dialog stays open");
  assert.ok(!tab.told.includes(ACT_KIND.PLANNING_CLOSE), "nothing left the plan");
  act(() => tab.control().onNewPlan());
  assert.deepEqual(
    tab.control().newPlan.preset,
    { repository: "acme/web" },
    "a press while the dialog stands leaves it as it is",
  );

  let note: string | undefined;
  await act(async () => {
    note = await tab
      .control()
      .newPlan.start("Dark mode", "acme/web", tab.control().newPlan.workspaceId);
  });
  assert.ok(note, "a refusal says why");
  assert.equal(tab.control().newPlan.open, true, "a refusal keeps the dialog");
  await act(async () => {
    note = await tab
      .control()
      .newPlan.start("Dark mode", "acme/web", tab.control().newPlan.workspaceId);
  });
  assert.equal(note, undefined);
  assert.equal(tab.control().newPlan.open, false, "a plan started closes the dialog");

  act(() => tab.control().onNewPlan());
  tab.stand({ shown: false });
  tab.stand({ shown: true });
  assert.equal(tab.control().newPlan.open, false, "Settings taking the window put the dialog away");
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
    { shown: true, planning: OPEN },
    {
      [ACT_KIND.PLANNING_MESSAGES]: (payload) => {
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

  assert.deepEqual(asked, [{ planId: "plan-1", after: "0:0", callId: "call-0-0" }]);
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

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

/** The code shown on the open plan: one snippet, then a second of the same file. */
const SHOWN: readonly PlanCodeShowing[] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];
const _SHOWN_AGAIN: readonly PlanCodeShowing[] = [
  ...SHOWN,
  { callId: "show-2", turnId: "turn-1", shownAt: 1, code: CODE },
];

/** A call in progress about the open plan, which is what puts code on screen. */
const _ON_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  callPlanId: PLAN.id,
  voiceStatus: LIVE_STATUS.LISTENING,
};

/** The panel as the developer sees it: shown or not, and on which tab. */
function panelOf(tab: ReturnType<typeof mount>) {
  const { open, tab: shown } = tab.control().sidePanel;
  return { open, tab: shown };
}

/** One turn of Luke's planning model on the open plan. */
const TURN: PlanWorkTurn = {
  turnId: "turn-1",
  startedAt: 1,
  state: PLAN_WORK_STATE.DONE,
  earlierOmitted: false,
  journal: [],
  workers: [],
};

/** The open plan's calls read back: none, and one with a line said on it. */
const NO_CALLS: PlanningView["transcript"] = {
  status: PLANNING_READ.READY,
  transcript: { calls: [], earlierOmitted: false },
};
const _ONE_CALL: PlanningView["transcript"] = {
  status: PLANNING_READ.READY,
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
const _NOTHING_YET: PlanningView = {
  ...OPEN,
  board: EMPTY_BOARD,
  shownCode: [],
  transcript: NO_CALLS,
  work: [],
};

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const RUNNING_AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: PLAN.id,
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
  state: typeof PLAN_WORK_STATE.RUNNING | typeof PLAN_WORK_STATE.DONE,
): PlanWorkTurn {
  return {
    ...TURN,
    journal: [
      {
        type: "tool-start_coding_agent",
        toolCallId: "call-start-1",
        state: state === PLAN_WORK_STATE.DONE ? "output-available" : "input-available",
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
    { shown: true, planning: { ...OPEN, shownCode: SHOWN } },
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
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.BOARD));
  tab.stand({ planning: { ...OPEN, activePlanId: OTHER_PLAN_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SELECT);
  assert.equal(tab.control().boundFor, PLAN.id);

  tab.stand({ planning: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.BOARD]);
});

test("a Luke link to another plan's section opens that plan and asks its page to show the section, each ask its own", () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  const section = { kind: MENTION_KIND.SECTION, planId: OTHER_PLAN_ID, anchor: "rollout" } as const;

  act(() => tab.control().onShowMention(section));
  const first = tab.control().sectionReveal;
  act(() => tab.control().onShowMention(section));

  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SELECT);
  assert.deepEqual(first, { planId: OTHER_PLAN_ID, reveal: { anchor: "rollout", ask: 1 } });
  assert.deepEqual(tab.control().sectionReveal, {
    planId: OTHER_PLAN_ID,
    reveal: { anchor: "rollout", ask: 2 },
  });
});

test("a section shown is let go, so the plan opened again later opens where it would, while a newer ask stands", () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  const section = { kind: MENTION_KIND.SECTION, planId: OTHER_PLAN_ID, anchor: "rollout" } as const;

  act(() => tab.control().onShowMention(section));
  act(() => tab.control().onShowMention(section));
  act(() => tab.control().onSectionRevealed(1));
  const afterStale = tab.control().sectionReveal;
  act(() => tab.control().onSectionRevealed(2));
  const afterShown = tab.control().sectionReveal;
  act(() => tab.control().onShowMention(section));

  assert.deepEqual(afterStale, { planId: OTHER_PLAN_ID, reveal: { anchor: "rollout", ask: 2 } });
  assert.equal(afterShown, undefined);
  assert.deepEqual(tab.control().sectionReveal?.reveal, { anchor: "rollout", ask: 3 });
});

test("the closed tabs kept are the latest twenty, the oldest let go past them", () => {
  const tab = mount({ shown: true, planning: OPEN });
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
    { shown: true, planning: { ...OPEN, shownCode: SHOWN } },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onOpenFile(CODE.ref));
  act(() => panel().onClose({ file: CODE.ref.path }));

  tab.stand({ planning: { ...OPEN, activePlanId: OTHER_PLAN_ID, shownCode: SHOWN } });
  act(() => panel().onOpenFile({ ...CODE.ref, startLine: 5, endLine: 9 }, "b2c3d4e"));
  tab.stand({ planning: { ...OPEN, shownCode: SHOWN } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panel().tab, { file: CODE.ref.path });
  assert.deepEqual(
    panel().files.map((each) => [each.path, each.range, each.commit]),
    [[CODE.ref.path, { startLine: 1, endLine: 1 }, undefined]],
  );
});

test("a press while a reopen waits on its plan takes no tab of another plan, which opens in its turn", () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  tab.stand({ planning: { ...OPEN, activePlanId: OTHER_PLAN_ID } });
  act(() => panel().onChoose(SIDE_PANEL_TAB.CODE));
  act(() => panel().onClose(SIDE_PANEL_TAB.CODE));
  tab.stand({ planning: { ...OPEN, activePlanId: THIRD_PLAN_ID } });

  act(() => tab.control().onReopenClosedTab?.());
  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, OTHER_PLAN_ID);
  tab.stand({ planning: { ...OPEN, activePlanId: OTHER_PLAN_ID } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });

  act(() => tab.control().onReopenClosedTab?.());
  assert.equal(tab.control().boundFor, PLAN.id);
  tab.stand({ planning: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.equal(tab.control().onReopenClosedTab, undefined);
});

/** A third plan, which neither tab was closed on. */
const THIRD_PLAN_ID = "4e6a8c0e-2a4c-4e6a-8c0e-2a4c6e8a0c2e";

test("a tab its strip no longer draws, its page gone since, is passed over for the tab closed before it", () => {
  const page = {
    id: "6c8e0a2c-4e6a-4c8e-8a2c-4e6a8c0e2a4c",
    title: "Invite flow",
    version: 1,
    at: 1,
  };
  const tab = mount({ shown: true, planning: { ...OPEN, pages: [page] } });
  const panel = () => tab.control().sidePanel;
  act(() => panel().onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onClose(SIDE_PANEL_TAB.BOARD));
  act(() => panel().onChoose({ page: page.id }));
  act(() => panel().onClose({ page: page.id }));
  tab.stand({ planning: { ...OPEN, pages: [] } });

  act(() => tab.control().onReopenClosedTab?.());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.equal(tab.control().onReopenClosedTab, undefined, "the page's tab is not kept to reopen");
});

test("the sidebar lists the first workspace's plans first, a workspace chosen lists its own alone while every plan stays findable, and New plan starts in the one chosen", async () => {
  const tab = mount({ shown: true, planning: TWO_WORKSPACES }, UNSTARTED);

  const personal = {
    workspace: tab.control().workspace?.id,
    plans: tab.control().listed.plans.map((plan) => plan.id),
    archived: tab.control().listed.archived.map((plan) => plan.id),
  };
  await tab.control().newPlan.start("Invites", null, tab.control().newPlan.workspaceId);
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().newPlan.start("Usage", "acme/relay", tab.control().newPlan.workspaceId);

  assert.deepEqual(personal, {
    workspace: PERSONAL.id,
    plans: ["notes", "billing"],
    archived: ["old-notes"],
  });
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.deepEqual(
    tab.control().listed.plans.map((plan) => plan.id),
    ["alerts"],
  );
  assert.deepEqual(
    tab.control().listed.archived.map((plan) => plan.id),
    ["old-launch"],
  );
  assert.deepEqual(startedIn(tab.payloads), [PERSONAL.id, ACME.id]);
  assert.deepEqual(
    tab.control().plans.map((plan) => plan.id),
    ["notes", "alerts", "billing"],
    "the palette, the inbox, and the history find every workspace's plans",
  );
  assert.deepEqual(
    tab.control().archived.map((plan) => plan.id),
    ["old-launch", "old-notes"],
  );
});

test("opening a plan of another workspace lists that workspace once it opened, one of the workspace listed changes nothing, and one that would not open changes nothing", async () => {
  let opens = true;
  const tab = mount(
    { shown: true, planning: TWO_WORKSPACES },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(opens) },
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
    tab.control().listed.plans.map((plan) => plan.id),
    ["alerts"],
  );
});

/** A plan's inbox waiting on the developer: `count` open items, each asked by one agent. */
function waitingIn(planId: string, count: number): AppInboxPlan {
  return {
    planId,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${planId}-item-${index}`,
      agentId: `${planId}-agent`,
      title: "Which retry budget?",
      postedAt: index,
    })),
  };
}

test("the Inbox lists the chosen workspace's share of what waits, and every workspace counts its own", () => {
  const tab = mount({
    shown: true,
    planning: TWO_WORKSPACES,
    inboxWaiting: [waitingIn("notes", 1), waitingIn("alerts", 2), waitingIn("unread", 3)],
    inboxPlans: [
      { planId: "notes", items: 1, updatedAt: 3 },
      { planId: "alerts", items: 2, updatedAt: 2 },
      { planId: "unread", items: 3, updatedAt: 1 },
    ],
  });
  const share = () => ({
    inbox: tab.control().listed.inbox.map((plan) => plan.planId),
    inboxPlans: tab.control().listed.inboxPlans.map((holding) => holding.planId),
  });

  const personal = share();
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.deepEqual(personal, { inbox: ["notes"], inboxPlans: ["notes"] });
  assert.deepEqual(share(), { inbox: ["alerts"], inboxPlans: ["alerts"] });
  assert.deepEqual(
    [...tab.control().waitingIn],
    [
      [PERSONAL.id, 1],
      [ACME.id, 2],
    ],
    "a plan the list has not read yet counts in no workspace",
  );
});

test("an Inbox item chosen in one workspace gives way as another is listed, so main is not told its plan's Inbox still shows", () => {
  const tab = mount({ shown: true, planning: TWO_WORKSPACES });

  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().inboxView.onChoose({ planId: "notes", itemId: "notes-item-0" }));
  const chosen = tab.control().inboxView.chosen?.planId;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.equal(chosen, "notes");
  assert.equal(tab.control().inboxView.chosen, undefined);
  assert.equal(tab.shownInboxes.at(-1), null);
});

test("the new-plan page's recent repositories are the chosen workspace's own, and the chip names its workspace", () => {
  const tab = mount({
    shown: true,
    planning: {
      ...TWO_WORKSPACES,
      plans: [
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

test("a workspace chosen is chosen again on the next launch, and one the account is no longer in gives way to the first one", () => {
  const first = mount({ shown: true, planning: TWO_WORKSPACES });
  act(() => first.control().onChooseWorkspace(ACME.id));
  document.body.innerHTML = "";

  const relaunched = mount({ shown: true, planning: TWO_WORKSPACES });
  const kept = relaunched.control().workspace?.id;
  relaunched.stand({ planning: { ...TWO_WORKSPACES, workspaces: [PERSONAL] } });

  assert.equal(kept, ACME.id);
  assert.equal(relaunched.control().workspace?.id, PERSONAL.id);
  assert.deepEqual(
    relaunched.control().listed.plans.map((plan) => plan.id),
    ["notes", "billing"],
  );
});

test("before the workspaces are read every plan is listed and New plan names no workspace, so the service starts it in the first one", async () => {
  const tab = mount({ shown: true, planning: { ...TWO_WORKSPACES, workspaces: [] } }, UNSTARTED);

  await tab.control().newPlan.start("Invites", null, tab.control().newPlan.workspaceId);

  assert.equal(tab.control().workspace, undefined);
  assert.deepEqual(
    tab.control().listed.plans.map((plan) => plan.id),
    ["notes", "alerts", "billing"],
  );
  assert.deepEqual(startedIn(tab.payloads), [undefined]);
});

test("Settings' GitHub row is the connection main's view holds, its Connect and Disconnect ask main, and a refused Disconnect says why", async () => {
  const tab = mount(
    { shown: true, planning: { ...TWO_WORKSPACES, github: { connected: true, login: null } } },
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
  const tab = mount({ shown: true, planning: TWO_WORKSPACES }, UNSTARTED);

  const personal = tab.control().repositories.manages;
  act(() => tab.control().onChooseWorkspace(ACME.id));

  assert.equal(personal, true);
  assert.equal(tab.control().repositories.manages, false);
});

test("a Disconnect whose page did not open says why in a toast", async () => {
  const refusal = ACT[ACT_KIND.GITHUB_DISCONNECT].refusal;
  const tab = mount(
    { shown: true, planning: { ...TWO_WORKSPACES, github: { connected: true, login: null } } },
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
    { shown: true, planning: TWO_WORKSPACES },
    { [ACT_KIND.PLANNING_REPOSITORIES]: () => Promise.resolve(listed) },
  );

  await tab.control().repositories.read();
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().repositories.read();
  tab.stand({ planning: { ...OPEN, workspaces: [PERSONAL, ACME] } });
  await tab.control().repositories.read();

  assert.deepEqual(namedIn(tab.payloads, ACT_KIND.PLANNING_REPOSITORIES), [
    PERSONAL.id,
    ACME.id,
    PLAN.workspaceId,
  ]);
});

test("a workspace made is asked for by its name and listed at once, and a refusal answers why", async () => {
  let refuse = false;
  const tab = mount(
    { shown: true, planning: TWO_WORKSPACES },
    {
      [ACT_KIND.WORKSPACE_CREATE]: () =>
        refuse
          ? Promise.reject(new Error("Could not make that workspace on this system."))
          : Promise.resolve(PLATFORM),
    },
  );

  const made = await tab.control().onCreateWorkspace("Platform");
  await settle();
  tab.stand({ planning: { ...TWO_WORKSPACES, workspaces: [PERSONAL, ACME, PLATFORM] } });
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
  const tab = mount({ shown: true, planning: TWO_WORKSPACES });

  act(() => tab.control().onChooseWorkspace(ACME.id));
  act(() => tab.control().onOpenWorkspaceSettings());

  assert.deepEqual(tab.links, [{ page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id }]);
});

test("Connect GitHub under a plan opens Settings on the plan's workspace's GitHub, read off the open document where the list did not land", () => {
  const tab = mount({
    shown: true,
    planning: {
      ...OPEN,
      listStatus: PLANNING_READ.FAILED,
      workspaces: [PERSONAL, ACME],
      document: { status: PLANNING_READ.READY, plan: { ...PLAN, workspaceId: ACME.id } },
    },
  });

  act(() => tab.control().onOpenWorkspaceGitHub(PLAN.id));

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
    { shown: true, planning: { ...TWO_WORKSPACES, activePlanId: "billing" } },
    { [ACT_KIND.PLANNING_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const staying = tab.control().onMovePlan("billing", ACME.id);
  tab.stand({ planning: { ...TWO_WORKSPACES, activePlanId: "notes" } });
  answers[0]?.({ workspaceId: ACME.id });
  await settle();
  const late = tab.control().workspace?.id;
  tab.stand({ planning: { ...TWO_WORKSPACES, activePlanId: "billing" } });
  const moved = tab.control().onMovePlan("billing", ACME.id);
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

test("a move pressed before the workspaces were read still lists the workspace it moved to once they land", async () => {
  const answers: ((answer: { workspaceId: string }) => void)[] = [];
  const tab = mount(
    { shown: true, planning: { ...TWO_WORKSPACES, workspaces: [], activePlanId: "billing" } },
    { [ACT_KIND.PLANNING_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const moved = tab.control().onMovePlan("billing", ACME.id);
  tab.stand({ planning: { ...TWO_WORKSPACES, activePlanId: "billing" } });
  answers[0]?.({ workspaceId: ACME.id });
  await settle();

  assert.equal(await moved, true);
  assert.equal(tab.control().workspace?.id, ACME.id);
});

test("a workspace chosen while a move is out, even the first chosen after the workspaces land, stays listed when the move lands", async () => {
  const answers: ((answer: { workspaceId: string }) => void)[] = [];
  const tab = mount(
    { shown: true, planning: { ...TWO_WORKSPACES, workspaces: [], activePlanId: "billing" } },
    { [ACT_KIND.PLANNING_MOVE]: () => new Promise((resolve) => answers.push(resolve)) },
  );

  const moved = tab.control().onMovePlan("billing", ACME.id);
  tab.stand({ planning: { ...TWO_WORKSPACES, activePlanId: "billing" } });
  act(() => tab.control().onChooseWorkspace(PERSONAL.id));
  answers[0]?.({ workspaceId: ACME.id });
  await settle();

  assert.equal(await moved, true);
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
});

test("the listed workspace left lists the first one again, and another workspace left keeps the one listed", () => {
  const tab = mount({ shown: true, planning: TWO_WORKSPACES });
  act(() => tab.control().onChooseWorkspace(ACME.id));
  const chosen = tab.control().workspace?.id;

  act(() => tab.control().onLeftWorkspace("workspace-elsewhere"));
  const keptOnAnother = tab.control().workspace?.id;
  act(() => tab.control().onLeftWorkspace(ACME.id));

  assert.equal(chosen, ACME.id);
  assert.equal(keptOnAnother, ACME.id);
  assert.equal(tab.control().workspace?.id, PERSONAL.id);
});

test("a fixture run lists its first workspace's plans under the switcher, and a choice there is kept nowhere", () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.IDLE });
  const staged = fixture.control().listed.plans.map((plan) => plan.name);
  act(() => fixture.control().onChooseWorkspace("workspace-acme"));

  assert.deepEqual(staged, ["Teammate invitations", "Billing export"]);
  assert.deepEqual(
    fixture.control().listed.plans.map((plan) => plan.name),
    ["Usage alerts"],
  );
  assert.equal(fixture.control().workspaces.length, 2);
  assert.equal(window.localStorage.length, 0);
});

/** The plan as the list names it, archived where `archivedAt` is given. */
function listed(archivedAt?: number): PlanningView["plans"][number] {
  const { document: _document, ...summary } = PLAN;
  return archivedAt === undefined ? summary : { ...summary, archivedAt };
}

/** The view a launch starts on: nothing open, and the list not yet read. */
const LAUNCHING: PlanningView = { ...IDLE_PLANNING_VIEW, listStatus: PLANNING_READ.READING };

/** The view once the list is read with nothing open, holding `plans`. */
function listRead(plans: PlanningView["plans"]): PlanningView {
  return { ...IDLE_PLANNING_VIEW, listStatus: PLANNING_READ.READY, plans };
}

/** A select's payload, read back as the act's own schema admits it. */
const readSelect = Schema.decodeUnknownOption(Schema.Struct({ planId: Schema.String }));

/** The plans the launch asked the host to open, in order. */
function selected(tab: ReturnType<typeof mount>): string[] {
  return tab.payloads
    .filter((each) => each.kind === ACT_KIND.PLANNING_SELECT)
    .flatMap((each) => Option.toArray(readSelect(each.payload)).map((read) => read.planId));
}

/** A run that had the plan open when it quit. */
function quitWithPlanOpen(account = "dev@example.com") {
  mount({ shown: true, account, planning: { ...OPEN, plans: [listed()] } });
}

test("a launch opens the plan the account had open at quit, drawing no home page until the host has it open", () => {
  quitWithPlanOpen();
  const tab = mount(
    { shown: true, planning: LAUNCHING },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  assert.equal(tab.control().page, PLANS_PAGE.HOME);
  assert.equal(tab.control().restoring, true, "the list is still being read");

  tab.stand({ planning: listRead([listed()]) });
  assert.deepEqual(selected(tab), [PLAN.id]);
  assert.equal(tab.control().restoring, true, "the host has not opened it yet");

  tab.stand({ planning: { ...OPEN, plans: [listed()] } });
  assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT);
  assert.equal(tab.control().restoring, false);
});

test("a plan archived or deleted since the quit, or kept by another account, leaves the launch on the home page", () => {
  for (const [why, account, plans] of [
    ["archived", "dev@example.com", [listed(3)]],
    ["deleted", "dev@example.com", []],
    ["another account", "other@example.com", [listed()]],
  ] as const) {
    quitWithPlanOpen();
    const tab = mount({ shown: true, account, planning: LAUNCHING });
    tab.stand({ planning: listRead(plans) });
    assert.deepEqual(selected(tab), [], why);
    assert.equal(tab.control().restoring, false, why);
    document.body.innerHTML = "";
    window.localStorage.clear();
  }
});

test("a plan the list no longer holds is let go, so it is not opened when it comes back", () => {
  quitWithPlanOpen();
  mount({ shown: true, planning: LAUNCHING }).stand({ planning: listRead([]) });
  const tab = mount({ shown: true, planning: LAUNCHING });
  tab.stand({ planning: listRead([listed()]) });
  assert.deepEqual(selected(tab), []);
});

test("leaving the plan for the home page lets it go, so the next launch rests on the home page", () => {
  const before = mount({ shown: true, planning: { ...OPEN, plans: [listed()] } });
  before.stand({ planning: listRead([listed()]) });

  const tab = mount({ shown: true, planning: LAUNCHING });
  assert.equal(tab.control().restoring, false);
  tab.stand({ planning: listRead([listed()]) });
  assert.deepEqual(selected(tab), []);
});

test("a window reloaded over a plan the host still holds asks for nothing", () => {
  quitWithPlanOpen();
  const tab = mount({ shown: true, planning: { ...OPEN, plans: [listed()] } });
  assert.deepEqual(selected(tab), []);
  assert.equal(tab.control().restoring, false);
});

test("a refused reopen takes its ask back and rests on the home page", async () => {
  quitWithPlanOpen();
  const tab = mount(
    { shown: true, planning: LAUNCHING },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(false) },
  );
  tab.stand({ planning: listRead([listed()]) });
  await act(settle);
  assert.deepEqual(selected(tab), [PLAN.id]);
  assert.equal(tab.control().restoring, false);
});

test("a launch whose list read failed rests on the home page, and opens the plan once Try again reads it", () => {
  quitWithPlanOpen();
  const tab = mount(
    { shown: true, planning: LAUNCHING },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  tab.stand({ planning: { ...LAUNCHING, listStatus: PLANNING_READ.FAILED } });
  assert.deepEqual(selected(tab), []);
  assert.equal(tab.control().restoring, false);

  tab.stand({ planning: listRead([listed()]) });
  assert.deepEqual(selected(tab), [PLAN.id]);
});

test("another account signing in after a sign-out keeps its own plan, and has it opened", () => {
  quitWithPlanOpen("other@example.com");
  document.body.innerHTML = "";
  const tab = mount(
    { shown: true, planning: { ...OPEN, plans: [listed()] } },
    { [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true) },
  );
  tab.stand({ signedIn: false, planning: IDLE_PLANNING_VIEW });
  tab.stand({ signedIn: true, account: "other@example.com", planning: LAUNCHING });
  tab.stand({ planning: listRead([listed()]) });
  assert.deepEqual(selected(tab), [PLAN.id]);
});

test("Factory and the Inbox stand in the plan's place in turn: opening one puts the other away, and Home or a plan's press puts Factory away", () => {
  const tab = mount({ shown: true, planning: listRead([listed()]) });
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
  act(() => tab.control().onSelect(PLAN.id));
  assert.equal(tab.control().factoryView.open, false);
});

test("Home from an open plan leaves it, and from the home page only puts the Inbox away, asking the host nothing", () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_CLOSE]: () => Promise.resolve() },
  );
  act(() => tab.control().inboxView.onOpen());
  act(() => tab.control().onGoHome());
  assert.equal(tab.control().inboxView.open, false);
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_CLOSE);
  assert.equal(tab.control().boundFor, undefined);

  const home = mount({ shown: true, planning: listRead([]) });
  act(() => home.control().inboxView.onOpen());
  act(() => home.control().onGoHome());
  assert.equal(home.control().inboxView.open, false);
  assert.ok(!home.told.includes(ACT_KIND.PLANNING_CLOSE));
});
