// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { Board } from "@sidecar/hosted/board-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_WORK_STATE,
  PLANNING_READ,
  type PlanCode,
  type PlanCodeShowing,
  type PlanningView,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { Duration, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { ACT_KIND, type ActKind, type ActResultFor } from "#shared/messages/acts";
import {
  type AppInboxPlan,
  type AppInboxPlanHolding,
  RUN_PROFILE,
} from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "#shared/messages/voice-view";
import { onRegistry } from "#testing/copy-feedback";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { messageText, TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";
import { type PlansControl, usePlansTab } from "./use-plans-tab";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OPEN: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.READY,
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
}

/** Mounts the hook alone over what the panel would hand it, keeping every act it told, in order; `answers` answers the acts it names. */
function mount(
  initial: Partial<Standing> = {},
  answers: { [Kind in ActKind]?: () => Promise<ActResultFor<Kind>> } = {},
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
          ..._args: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          record(kind);
          const answer = answers[kind];
          if (answer !== undefined) return answer();
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
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: held.shown,
      unseenAgents: held.unseenAgents,
      inboxWaiting: held.inboxWaiting,
      inboxPlans: held.inboxPlans,
      voice: { view: held.voice, listening: false, requestMicrophoneAccess: () => undefined },
      onOpenIntegrations: () => undefined,
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
const _OTHER_PLAN_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

/** A plan's row of the list, started at `createdAt`, with whatever pin or archive it is given. */
function _row(
  id: string,
  createdAt: number,
  marks: { pinnedAt?: number; archivedAt?: number } = {},
) {
  return { id, name: id, createdAt, updatedAt: createdAt, repository: null, ...marks };
}

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
function _panelOf(tab: ReturnType<typeof mount>) {
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

const _RUNNING_AGENT: CodingAgentSummary = {
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
