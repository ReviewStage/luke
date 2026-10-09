// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { Board } from "@sidecar/hosted/board-wire";
import type { Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLANNING_READ,
  type PlanCode,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, type ActKind, type ActResultFor } from "#shared/messages/acts";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW, type VoiceView } from "#shared/messages/voice-view";
import { DOCUMENT_REGION, PLANS_PAGE } from "./planning-model";
import { messageText, TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";
import { type PlansControl, usePlansTab } from "./use-plans-tab";
import { SIDE_PANEL_TAB } from "./use-side-panel";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OPEN: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.READY,
  activePlanId: PLAN.id,
  document: { status: PLANNING_READ.READY, plan: PLAN },
  folders: {},
};

interface Standing {
  shown: boolean;
  planning: PlanningView;
  profile: string;
  fixtureMode: boolean;
  voice: VoiceView;
}

/** Mounts the hook alone over what the panel would hand it, keeping every act it told, in order; `answers` answers the acts it names. */
function mount(
  initial: Partial<Standing> = {},
  answers: { [Kind in ActKind]?: () => Promise<ActResultFor<Kind>> } = {},
) {
  const told: ActKind[] = [];
  let control: PlansControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  let standing: Standing = {
    shown: false,
    planning: IDLE_PLANNING_VIEW,
    profile: RUN_PROFILE.IDLE,
    fixtureMode: false,
    voice: IDLE_VOICE_VIEW,
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
          told.push(kind);
          const answer = answers[kind];
          if (answer !== undefined) return answer();
          return Promise.reject(new Error("Not answered in this test."));
        },
        tell: (kind: ActKind, ..._args: unknown[]) => {
          told.push(kind);
        },
      },
      planning: held.planning,
      run: { fixtureMode: held.fixtureMode, profile: held.profile },
      signedIn: true,
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: held.shown,
      voice: { view: held.voice, listening: false, requestMicrophoneAccess: () => undefined },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    createRoot(container).render(createElement(Probe));
  });
  return {
    told,
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
});

test("each time the tab shows it reads the plans again, and the tab going away leaves the open plan alone", () => {
  const tab = mount({ planning: OPEN });
  assert.deepEqual(tab.told, []);

  tab.stand({ shown: true });
  tab.stand({ shown: true });
  tab.stand({ shown: false });
  tab.stand({ shown: true });

  assert.deepEqual(tab.told, [ACT_KIND.PLANNING_REFRESH, ACT_KIND.PLANNING_REFRESH]);
  assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT);
});

test("stepping back from a side panel filling the window brings it back beside the plan, which stays open", () => {
  const tab = mount({ shown: true, planning: OPEN });
  act(() => tab.control().sidePanel.onToggle());
  act(() => tab.control().sidePanel.onToggleFullScreen());
  assert.equal(tab.control().sidePanel.fullScreen, true);

  act(() => {
    assert.equal(tab.control().back(), true);
  });
  assert.equal(tab.control().sidePanel.fullScreen, false);
  assert.equal(tab.control().sidePanel.open, true);
  assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT);
  assert.equal(tab.told.includes(ACT_KIND.PLANNING_CLOSE), false);

  act(() => {
    assert.equal(tab.control().back(), true);
  });
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_CLOSE);
});

test("stepping back leaves an open plan for the new-plan page, which has nothing to step back from", () => {
  const tab = mount({ shown: true, planning: OPEN });

  act(() => {
    assert.equal(tab.control().back(), true);
  });
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_CLOSE);

  tab.stand({ planning: IDLE_PLANNING_VIEW });
  assert.equal(tab.control().page, PLANS_PAGE.NEW);
  act(() => {
    assert.equal(tab.control().back(), false);
  });
  assert.equal(tab.told.filter((kind) => kind === ACT_KIND.PLANNING_CLOSE).length, 1);
});

test("New plan leaves an open plan and asks the new-plan page for its name field on every press", () => {
  const tab = mount({ shown: true, planning: OPEN });
  const before = tab.control().newPlan.presses;

  act(() => tab.control().onNewPlan());
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_CLOSE);

  tab.stand({ planning: IDLE_PLANNING_VIEW });
  act(() => tab.control().onNewPlan());
  assert.equal(tab.told.filter((kind) => kind === ACT_KIND.PLANNING_CLOSE).length, 1);
  assert.equal(tab.control().newPlan.presses, before + 2);
});

test("the new-plan page offers the folders of the plans this Mac holds, the newest started first", () => {
  const second = { ...PLAN, id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", name: "Billing export" };
  const tab = mount({
    planning: {
      ...IDLE_PLANNING_VIEW,
      plans: [second, PLAN],
      folders: { [PLAN.id]: "/Users/dev/relay", [second.id]: "/Users/dev/billing" },
    },
  });

  assert.deepEqual(tab.control().newPlan.recentFolders, ["/Users/dev/billing", "/Users/dev/relay"]);
});

test("a start the host refuses answers the reason the new-plan page shows", async () => {
  const tab = mount({ shown: true });

  assert.equal(
    await tab.control().newPlan.start("Invites", "/Users/dev/relay"),
    "Not answered in this test.",
  );
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_START);
});

test("deleting asks for the named plan's delete and answers a refusal, and a fixture's plan is deleted nowhere", async () => {
  const live = mount({ shown: true, planning: OPEN });
  const refused = await live.control().onDeletePlan(PLAN.id);
  assert.equal(live.told.at(-1), ACT_KIND.PLANNING_DELETE);
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);

  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  await fixture.control().onDeletePlan(PLAN.id);
  assert.deepEqual(fixture.told, []);
});

test("a rename draws the new name at once, keeps it until the view carries it, and puts the old one back when refused", async () => {
  const { document: _document, ...summary } = PLAN;
  const listed: PlanningView = { ...OPEN, plans: [summary] };
  const answers: boolean[] = [false, true];
  const tab = mount(
    { shown: true, planning: listed },
    { [ACT_KIND.PLANNING_RENAME]: () => Promise.resolve(answers.shift() ?? false) },
  );
  const names = () => {
    const { region } = tab.control();
    return [
      tab.control().plans.map((plan) => plan.name),
      region.kind === DOCUMENT_REGION.READY ? region.plan.name : undefined,
    ];
  };

  let refused: Promise<boolean> = Promise.resolve(true);
  act(() => {
    refused = tab.control().onRenamePlan(PLAN.id, "Team invites");
  });
  assert.deepEqual(names(), [["Team invites"], "Team invites"]);
  await act(async () => {
    assert.equal(await refused, false);
  });
  assert.deepEqual(names(), [["Teammate invitations"], "Teammate invitations"]);

  await act(async () => {
    assert.equal(await tab.control().onRenamePlan(PLAN.id, "Team invites"), true);
  });
  assert.deepEqual(names(), [["Team invites"], "Team invites"]);
  const renamed = { ...PLAN, name: "Team invites" };
  tab.stand({
    planning: {
      ...listed,
      plans: [{ ...summary, name: renamed.name }],
      document: { status: PLANNING_READ.READY, plan: renamed },
    },
  });
  // Carried by the view, the name is the view's again: a later name drawn there is drawn here.
  tab.stand({ planning: { ...listed, plans: [{ ...summary, name: "Invites v2" }] } });
  assert.deepEqual(names(), [["Invites v2"], "Teammate invitations"]);
  assert.deepEqual(
    tab.told.filter((kind) => kind === ACT_KIND.PLANNING_RENAME),
    [ACT_KIND.PLANNING_RENAME, ACT_KIND.PLANNING_RENAME],
  );
});

test("a fixture's plan is renamed nowhere", async () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.equal(await fixture.control().onRenamePlan(PLAN.id, "Team invites"), false);
  assert.deepEqual(fixture.told, []);
});

test("the microphone asks for the open plan's call, and the planning profile's fixture reads and leaves nothing", () => {
  const live = mount({ shown: true, planning: OPEN });
  act(() => live.control().microphone.onPress());
  assert.equal(live.told.at(-1), ACT_KIND.PLANNING_TALK);
  act(() => live.control().stop.onPress());
  assert.equal(live.told.at(-1), ACT_KIND.VOICE_COMMAND);

  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.equal(fixture.control().page, PLANS_PAGE.DOCUMENT);
  act(() => {
    fixture.control().back();
  });
  assert.deepEqual(fixture.told, []);
});

test("the planning profile's fixture shows the planning model's command and the notetaker on its open plan, and a live run's idle call shows nothing", () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.equal(fixture.control().status?.voiceWord, "Listening");
  assert.notEqual(fixture.control().status?.backend.planner?.action, undefined);
  assert.equal(fixture.control().status?.backend.notes, true);

  const live = mount({
    shown: true,
    planning: { ...OPEN, activity: { planner: {}, notes: true } },
  });
  assert.equal(live.control().status, undefined);
});

/** The words of every call the transcript draws, in order, with whether each call stands now. */
function callsDrawn(region: TranscriptRegion): (readonly [boolean, string[]])[] {
  if (region.kind !== TRANSCRIPT_REGION.READY) return [];
  return region.calls.map((call) => [call.live, call.messages.map(messageText)] as const);
}

test("the open plan's call grows the transcript as it is said, and hanging up keeps its words until the record holds them", () => {
  const CALL = "9e4b1a2c-6d3f-4e8a-b7c5-1f2a3b4c5d6e";
  const onCall = (words: string): VoiceView => ({
    ...IDLE_VOICE_VIEW,
    callPlanId: PLAN.id,
    callTranscript: {
      voiceSessionId: CALL,
      lines: [{ rowId: "row-1", speaker: "user", words }],
    },
  });
  const empty = { calls: [], earlierOmitted: false };
  const tab = mount({
    shown: true,
    planning: { ...OPEN, transcript: { status: PLANNING_READ.READY, transcript: empty } },
  });
  assert.equal(tab.control().transcript.region.kind, TRANSCRIPT_REGION.EMPTY);

  tab.stand({ voice: onCall("Invites should") });
  tab.stand({ voice: onCall("Invites should expire.") });
  assert.deepEqual(callsDrawn(tab.control().transcript.region), [
    [true, ["Invites should expire."]],
  ]);

  tab.stand({ voice: IDLE_VOICE_VIEW });
  assert.deepEqual(callsDrawn(tab.control().transcript.region), [
    [false, ["Invites should expire."]],
  ]);

  const recorded = {
    calls: [
      {
        id: CALL,
        startedAt: 1_000,
        messages: [
          {
            id: "0",
            role: "user" as const,
            parts: [{ type: "text" as const, text: "Invites should expire after a week." }],
          },
        ],
      },
    ],
    earlierOmitted: false,
  };
  tab.stand({
    planning: { ...OPEN, transcript: { status: PLANNING_READ.READY, transcript: recorded } },
  });
  assert.deepEqual(callsDrawn(tab.control().transcript.region), [
    [false, ["Invites should expire after a week."]],
  ]);

  act(() => tab.control().transcript.onRetry());
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_REFRESH);
});

const EMPTY_BOARD: Board = { elements: [], appliedDrawing: 0 };

/** A board holding Luke's drawing of one box, numbered as his `number`th. */
function drawnBoard(number: number): Board {
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
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

/** A call in progress about the open plan, which is what puts code on screen. */
const ON_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  callPlanId: PLAN.id,
  voiceStatus: LIVE_STATUS.LISTENING,
};

/** The panel as the developer sees it: shown or not, and on which tab. */
function panelOf(tab: ReturnType<typeof mount>) {
  const { open, tab: shown } = tab.control().sidePanel;
  return { open, tab: shown };
}

test("Luke's first drawing on the open plan's board opens the panel on the board, and none after it does once closed", () => {
  const tab = mount({ shown: true, planning: OPEN });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ planning: { ...OPEN, board: EMPTY_BOARD } });
  assert.deepEqual(panelOf(tab), { open: false, tab: SIDE_PANEL_TAB.TRANSCRIPT });

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.equal(tab.control().sidePanel.fullScreen, false);

  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.equal(tab.control().sidePanel.open, false);
});

test("the first code Luke shows on the open plan's call opens the panel on the code, and a later call's code does not once closed", () => {
  const tab = mount({ shown: true, planning: OPEN });
  tab.stand({ voice: ON_CALL });
  assert.equal(tab.control().sidePanel.open, false);

  tab.stand({ planning: { ...OPEN, code: CODE } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });

  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ voice: IDLE_VOICE_VIEW, planning: OPEN });
  tab.stand({ voice: ON_CALL });
  tab.stand({ planning: { ...OPEN, code: CODE } });
  assert.equal(tab.control().sidePanel.open, false);
});

test("a plan opened with its board already drawn opens no panel, and nothing Luke draws on it later does", () => {
  const tab = mount({ shown: true, planning: OPEN });
  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  tab.stand({ planning: { ...OPEN, board: drawnBoard(2) } });

  assert.equal(tab.control().sidePanel.open, false);
});

test("a plan left and opened again reads its board afresh, so a drawing made while it was away opens nothing", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  tab.stand({ planning: IDLE_PLANNING_VIEW });
  tab.stand({ planning: OPEN });
  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });

  assert.equal(tab.control().sidePanel.open, false);
});

test("the developer's own strokes on the board open nothing, and Luke's first drawing after them still does", () => {
  const stroke = {
    id: "box",
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
  };
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  tab.stand({ planning: { ...OPEN, board: { elements: [stroke], appliedDrawing: 0 } } });
  assert.equal(tab.control().sidePanel.open, false);

  tab.stand({ planning: { ...OPEN, board: { ...drawnBoard(1), elements: [stroke] } } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("a plan's first board opens the panel once across a relaunch and a trip to another plan", () => {
  const other = { ...OPEN, activePlanId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" };
  const first = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  first.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.equal(first.control().sidePanel.open, true);
  act(() => first.control().sidePanel.onToggle());
  document.body.innerHTML = "";

  const relaunched = mount({ shown: true, planning: other });
  relaunched.stand({ planning: OPEN });
  relaunched.stand({ planning: { ...OPEN, board: EMPTY_BOARD } });
  relaunched.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.equal(relaunched.control().sidePanel.open, false);
});

test("an arrival while the panel shows another tab leaves it there and dots the arrival's tab until it is shown", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onToggleFullScreen());

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT });
  assert.equal(tab.control().sidePanel.fullScreen, true);
  assert.deepEqual(tab.control().unreadTabs, [SIDE_PANEL_TAB.BOARD]);

  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("Luke's first drawing opens a closed Board tab again at the strip's end, dotted while the panel shows another", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.BOARD));

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(tab.control().sidePanel.tabs, [
    SIDE_PANEL_TAB.CODE,
    SIDE_PANEL_TAB.TRANSCRIPT,
    SIDE_PANEL_TAB.BOARD,
  ]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT });
  assert.deepEqual(tab.control().unreadTabs, [SIDE_PANEL_TAB.BOARD]);
});

test("Luke's first code opens a shut panel on a Code tab the developer had closed", () => {
  const tab = mount({ shown: true, planning: OPEN });
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.CODE));
  tab.stand({ voice: ON_CALL });

  tab.stand({ planning: { ...OPEN, code: CODE } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.deepEqual(tab.control().sidePanel.tabs, [
    SIDE_PANEL_TAB.BOARD,
    SIDE_PANEL_TAB.TRANSCRIPT,
    SIDE_PANEL_TAB.CODE,
  ]);
});

test("an arrival on an open panel with every tab closed shows the arrival's tab, with no dot", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  act(() => tab.control().sidePanel.onToggle());
  for (const closed of [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE, SIDE_PANEL_TAB.TRANSCRIPT]) {
    act(() => tab.control().sidePanel.onClose(closed));
  }
  assert.deepEqual(panelOf(tab), { open: true, tab: undefined });

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("the board and the code arriving on one read of an open panel with every tab closed show the board and dot the code", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD }, voice: ON_CALL });
  act(() => tab.control().sidePanel.onToggle());
  for (const closed of [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE, SIDE_PANEL_TAB.TRANSCRIPT]) {
    act(() => tab.control().sidePanel.onClose(closed));
  }

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1), code: CODE } });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().unreadTabs, [SIDE_PANEL_TAB.CODE]);
});
