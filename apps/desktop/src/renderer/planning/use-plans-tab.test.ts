// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import type { Board } from "@sidecar/hosted/board-wire";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { PLAN_ACTOR, type Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLAN_CALL_FAILURE,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  PLANNING_READ,
  type PlanCode,
  type PlanCodeShowing,
  type PlanningView,
  type PlanWorkTurn,
} from "@sidecar/hosted/planning-view";
import { LIVE_STATUS } from "@sidecar/live";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { Duration, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, type ActKind, type ActResultFor } from "#shared/messages/acts";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import {
  IDLE_VOICE_VIEW,
  VOICE_COMMAND,
  type VoiceCommand,
  type VoiceView,
} from "#shared/messages/voice-view";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { DOCUMENT_REGION, PLAN_MARK, PLANS_PAGE } from "./planning-model";
import { messageText, TRANSCRIPT_REGION, type TranscriptRegion } from "./transcript-model";
import { MAIN_TAB } from "./use-main-tabs";
import { type PlansControl, usePlansTab } from "./use-plans-tab";
import { SIDE_PANEL_TAB, SIDE_PANEL_TABS } from "./use-side-panel";

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
  Schema.Struct({ agentId: Schema.NullOr(Schema.String) }),
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
  /** What the voice window was told to do, each time it was told. */
  const voiceCommands: VoiceCommand[] = [];
  /** Each start's payload as it was asked, unread until a test reads it as the act's schema would. */
  const starts: unknown[] = [];
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
          ...args: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          record(kind);
          if (kind === ACT_KIND.PLANNING_START) starts.push(args[0]);
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
      voice: { view: held.voice, listening: false, requestMicrophoneAccess: () => undefined },
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
    voiceCommands,
    starts,
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

/** Lets the clipboard's answer, and the redraw it causes, land with no time passing. */
const landed = Effect.promise(settle);

/** Advances the clock the toast's hold waits on, then lets what fell due land. */
const advance = (millis: number) =>
  Effect.andThen(TestClock.adjust(Duration.millis(millis)), landed);

/** What the newest toast says, while one stands. */
function toast(): string | undefined {
  return newestToastSays();
}

/** The newest toast's Undo. */
function undoButton(): HTMLButtonElement {
  const undo = newestToastAction();
  assert.ok(undo, "no Undo on the toast");
  assert.equal(undo.textContent, "Undo");
  return undo;
}

it.effect(
  "Copy plan puts the plan drawn on the clipboard as Markdown and says so in a toast that leaves on its own, and a refused copy says so instead",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      const reviewed = {
        body: "# Teammate invitations\n\n## Open questions\n\n- Who can withdraw an invite?",
        assumptions: [
          { text: "Members and admins can both invite." },
          { text: "An invite expires after 7 days." },
        ],
      };
      const planning = {
        ...OPEN,
        document: { ...OPEN.document, plan: { ...PLAN, document: reviewed } },
      };
      const tab = mount({ shown: true, planning }, {}, yield* registryOnTestClock);

      act(() => tab.control().copy.onPress());
      yield* landed;
      assert.deepEqual(clipboard.copied, [
        `${reviewed.body}

## Assumptions

- Members and admins can both invite.
- An invite expires after 7 days.
`,
      ]);
      assert.equal(toast(), "Plan copied");
      yield* advance(1_499);
      assert.equal(toast(), "Plan copied");
      // It fades out over the exit before it is gone.
      yield* advance(1 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);

      // An earlier copy's refusal landing after a later copy's says nothing.
      clipboard.refuseNextLate();
      act(() => tab.control().copy.onPress());
      act(() => tab.control().copy.onPress());
      yield* landed;
      yield* landed;
      assert.equal(toast(), "Plan copied");
      yield* advance(1_500 + MOTION_DURATION_MS.EXIT);

      clipboard.refuse(true);
      act(() => tab.control().copy.onPress());
      yield* landed;
      assert.equal(toast(), "Could not copy to the clipboard. Try again.");
    }),
);

/** A plan with a history: Luke wrote it on a call, over a first version. */
const EDITED: PlanningView = {
  ...OPEN,
  document: {
    status: PLANNING_READ.READY,
    plan: { ...PLAN, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: true } },
  },
};

/** One revision as the history lists it, written by Luke on a call. */
function revisionLine(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 10 * seq, duringCall: true },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const FIRST_VERSION = { body: "# Teammate invitations\n\n## Goal", assumptions: [] };

/** A plan other than the open one, which the host opens in its place. */
const OTHER_PLAN_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";

it.effect(
  "Version history opens over the open plan on the plan as it stands with its side panel as it was, opens again on the newest, and a restore offers its Undo",
  () =>
    Effect.gen(function* () {
      const restoredAnswer = { value: false };
      const tab = mount(
        { shown: true, planning: EDITED },
        {
          [ACT_KIND.PLANNING_REVISIONS]: () =>
            Promise.resolve({ revisions: [revisionLine(2), revisionLine(1)] }),
          [ACT_KIND.PLANNING_REVISION]: () =>
            Promise.resolve({ revision: { seq: 1, document: FIRST_VERSION, previous: null } }),
          [ACT_KIND.PLANNING_RESTORE]: () => Promise.resolve(restoredAnswer.value),
        },
        yield* registryOnTestClock,
      );
      act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.WORK));
      assert.equal(tab.control().history.open, false);
      assert.ok(!tab.told.includes(ACT_KIND.PLANNING_REVISIONS), "read only once it opens");

      act(() => tab.control().history.onOpen(PLAN.id));
      yield* landed;
      assert.equal(tab.control().history.open, true);
      const { list } = tab.control().history;
      assert.deepEqual(
        list.kind === "ready" ? list.revisions.map(({ seq }) => seq) : list.kind,
        [2, 1],
      );
      assert.equal(tab.control().history.viewing?.line.seq, 2, "the plan as it stands first");
      assert.equal(tab.control().history.viewing?.current, true);
      assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT);
      assert.equal(tab.control().sidePanel.open, true);
      assert.equal(tab.control().sidePanel.tab, SIDE_PANEL_TAB.WORK);

      act(() => tab.control().history.onSelect(1));
      yield* landed;
      const viewing = tab.control().history.viewing;
      assert.equal(viewing?.line.seq, 1);
      assert.equal(viewing?.current, false);
      assert.deepEqual(
        viewing?.read.kind === "ready" ? viewing.read.document : viewing?.read.kind,
        FIRST_VERSION,
      );

      act(() => tab.control().history.onClose());
      assert.equal(tab.control().history.open, false);
      assert.equal(tab.control().sidePanel.tab, SIDE_PANEL_TAB.WORK, "the panel as it was");
      act(() => tab.control().history.onOpen(PLAN.id));
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 2, "it opens again on the newest");

      act(() => tab.control().history.onSelect(1));
      yield* landed;
      let refused: ActionResult | undefined;
      act(() => {
        tab
          .control()
          .history.onRestore()
          .then((result) => {
            refused = result;
          });
      });
      yield* landed;
      assert.equal(refused?.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(
        tab.control().history.viewing?.line.seq,
        1,
        "a refused restore stays on the version",
      );

      restoredAnswer.value = true;
      let restored: ActionResult | undefined;
      act(() => {
        tab
          .control()
          .history.onRestore()
          .then((result) => {
            restored = result;
          });
      });
      yield* landed;
      assert.equal(restored?.status, ACTION_RESULT_STATUS.ACCEPTED);
      const undo = undoButton();
      assert.equal(toast()?.replace("Undo", ""), "Version restored");

      // The Undo is itself a restore, and one the service refuses says so.
      restoredAnswer.value = false;
      act(() => undo.click());
      yield* landed;
      assert.equal(toast(), "The restore could not be undone. Try again.");
    }),
);

it.effect(
  "Version history opened at a section's save opens on the revision that made it, and from the plan's line again on the newest",
  () =>
    Effect.gen(function* () {
      const tab = mount(
        { shown: true, planning: EDITED },
        {
          [ACT_KIND.PLANNING_REVISIONS]: () =>
            Promise.resolve({ revisions: [revisionLine(2), revisionLine(1)] }),
          [ACT_KIND.PLANNING_REVISION]: () =>
            Promise.resolve({ revision: { seq: 1, document: FIRST_VERSION, previous: null } }),
        },
        yield* registryOnTestClock,
      );

      act(() => tab.control().history.onOpen(PLAN.id, revisionLine(1).lastEdit.at));
      yield* landed;
      assert.equal(tab.control().history.open, true);
      assert.equal(tab.control().history.viewing?.line.seq, 1);
      assert.equal(tab.control().history.viewing?.current, false);

      act(() => tab.control().history.onClose());
      act(() => tab.control().history.onOpen(PLAN.id));
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 2);
    }),
);

it.effect(
  "a section's save made while the version history was away, and saved over since, is sought in the history read again, not the list kept from before",
  () =>
    Effect.gen(function* () {
      const head = { seq: 2 };
      const editedAt = (at: number): PlanningView => ({
        ...EDITED,
        document: {
          status: PLANNING_READ.READY,
          plan: { ...PLAN, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at, duringCall: true } },
        },
      });
      const tab = mount(
        { shown: true, planning: editedAt(20) },
        {
          [ACT_KIND.PLANNING_REVISIONS]: () =>
            Promise.resolve({
              revisions: Array.from({ length: head.seq }, (_, at) => revisionLine(head.seq - at)),
            }),
          [ACT_KIND.PLANNING_REVISION]: () =>
            Promise.resolve({ revision: { seq: 1, document: FIRST_VERSION, previous: null } }),
        },
        yield* registryOnTestClock,
      );
      act(() => tab.control().history.onOpen(PLAN.id));
      yield* landed;
      act(() => tab.control().history.onClose());

      // The section's save made the third revision, and another writer the fourth.
      head.seq = 4;
      tab.stand({ planning: editedAt(40) });
      yield* landed;
      act(() => tab.control().history.onOpen(PLAN.id, revisionLine(3).lastEdit.at - 1));
      process.stderr.write(
        `DBG ${JSON.stringify(tab.control().history.list)} sel=${tab.control().history.selected}\n`,
      );
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 3);
    }),
);

it.effect(
  "a save landing while the version history stands moves the view on to it from the newest, and leaves an older version chosen where it is",
  () =>
    Effect.gen(function* () {
      const head = { seq: 2 };
      const editedAt = (at: number): PlanningView => ({
        ...EDITED,
        document: {
          status: PLANNING_READ.READY,
          plan: { ...PLAN, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at, duringCall: true } },
        },
      });
      const tab = mount(
        { shown: true, planning: editedAt(20) },
        {
          [ACT_KIND.PLANNING_REVISIONS]: () =>
            Promise.resolve({
              revisions: Array.from({ length: head.seq }, (_, at) => revisionLine(head.seq - at)),
            }),
          [ACT_KIND.PLANNING_REVISION]: () =>
            Promise.resolve({ revision: { seq: 1, document: FIRST_VERSION, previous: null } }),
        },
        yield* registryOnTestClock,
      );
      act(() => tab.control().history.onOpen(PLAN.id));
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 2);

      head.seq = 3;
      tab.stand({ planning: editedAt(30) });
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 3, "the newest followed");
      assert.equal(tab.control().history.viewing?.current, true);

      act(() => tab.control().history.onSelect(2));
      yield* landed;
      head.seq = 4;
      tab.stand({ planning: editedAt(40) });
      yield* landed;
      assert.equal(tab.control().history.viewing?.line.seq, 2, "an older version stays chosen");
      assert.equal(tab.control().history.viewing?.current, false);
    }),
);

test("another plan opening leaves the version history, and so does a notification's click onto an agent's tab", () => {
  const tab = mount({ shown: true, planning: EDITED });
  act(() => tab.control().history.onOpen(PLAN.id));
  assert.equal(tab.control().history.open, true);

  tab.stand({ planning: { ...EDITED, activePlanId: OTHER_PLAN_ID } });
  assert.equal(tab.control().history.open, false);
  tab.stand({ planning: EDITED });
  assert.equal(tab.control().history.open, false, "coming back opens the plan, not its history");

  act(() => tab.control().history.onOpen(PLAN.id));
  act(() => tab.control().onShowAgent(PLAN.id, "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"));
  assert.equal(tab.control().history.open, false);
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

test("the tab is bound for the plan a press asked for until the host answers, and a select or a leave that fails falls back to the open plan", async () => {
  const OTHER = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
  let refuse: ((reason: Error) => void) | undefined;
  const tab = mount(
    { shown: true, planning: OPEN },
    {
      [ACT_KIND.PLANNING_SELECT]: () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    },
  );
  assert.equal(tab.control().boundFor, PLAN.id);

  act(() => tab.control().onSelect(OTHER));
  assert.equal(tab.control().boundFor, OTHER, "said at once");
  assert.equal(tab.control().activePlanId, PLAN.id, "while the host still has the old one open");
  await act(async () => refuse?.(new Error("refused")));
  assert.equal(tab.control().boundFor, PLAN.id);

  // The harness refuses the leave, which it does not answer.
  await act(async () => tab.control().onLeavePlan());
  assert.equal(tab.control().boundFor, PLAN.id, "a refused leave stays on the plan");

  act(() => tab.control().onLeavePlan());
  assert.equal(tab.control().boundFor, undefined, "the new-plan page, asked for");
  tab.stand({ planning: { ...OPEN, activePlanId: OTHER } });
  assert.equal(tab.control().boundFor, OTHER, "the host's own move answers whatever was asked");
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

test("the repository chip offers the repositories the account's plans are about, the newest started first, and reads the list from the host", async () => {
  const second = {
    ...PLAN,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    name: "Billing export",
    repository: "acme/billing",
  };
  const listed = {
    repositories: {
      installed: true,
      repositories: [],
      installationUrl: "https://github.com/apps/luke/installations/new",
    },
  };
  const tab = mount(
    { planning: { ...IDLE_PLANNING_VIEW, plans: [second, { ...PLAN, repository: "acme/relay" }] } },
    { [ACT_KIND.PLANNING_REPOSITORIES]: () => Promise.resolve(listed) },
  );

  assert.deepEqual(tab.control().repositories.recent, ["acme/billing", "acme/relay"]);
  assert.deepEqual(await tab.control().repositories.read(), listed);
  tab.control().repositories.openGitHub("https://github.com/apps/luke/installations/new");
  assert.deepEqual(tab.told, [ACT_KIND.PLANNING_REPOSITORIES, ACT_KIND.GITHUB_OPEN]);
});

test("a start the host refuses answers the reason the new-plan page shows, and a repository the service refused says why", async () => {
  const tab = mount(
    { shown: true },
    {
      [ACT_KIND.PLANNING_START]: () =>
        Promise.resolve({ failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE }),
    },
  );

  assert.match(
    (await tab.control().newPlan.start("Invites", "acme/relay")) ?? "",
    /can't see that repository/u,
  );
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_START);
});

test("a plan's repository is set through the host, and a refusal is answered as the page's words", async () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    {
      [ACT_KIND.PLANNING_SET_REPOSITORY]: () =>
        Promise.resolve({ failure: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED }),
    },
  );

  assert.match(
    (await tab.control().onSetRepository(PLAN.id, "acme/relay")) ?? "",
    /Sign in with GitHub/u,
  );
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SET_REPOSITORY);
});

test("Change repository… asks the open plan's chip to open, opening another plan first; Open on GitHub opens the plan's page", () => {
  const other = {
    ...PLAN,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    name: "Billing export",
    repository: "acme/billing",
  };
  const tab = mount({ shown: true, planning: { ...OPEN, plans: [PLAN, other] } });

  act(() => tab.control().onChangeRepository(PLAN.id));
  assert.deepEqual(tab.control().repositoryMenu, { planId: PLAN.id, request: 1 });
  act(() => tab.control().onChangeRepository(other.id));
  assert.deepEqual(tab.control().repositoryMenu, { planId: other.id, request: 2 });
  tab.control().onOpenOnGitHub(other.id);
  tab.control().onOpenOnGitHub(PLAN.id);

  // The tab showing read the plans first; a plan with no repository opens no page.
  assert.deepEqual(tab.told, [
    ACT_KIND.PLANNING_REFRESH,
    ACT_KIND.PLANNING_SELECT,
    ACT_KIND.GITHUB_OPEN,
  ]);
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

it.effect(
  "a delete that lands says so in a toast, a refusal is left to the dialog that asked, and one landing after the tab went away says so in a toast instead",
  () =>
    Effect.gen(function* () {
      const answers: boolean[] = [true, false];
      const tab = mount(
        { shown: true, planning: OPEN },
        { [ACT_KIND.PLANNING_DELETE]: () => Promise.resolve(answers.shift() ?? false) },
        yield* registryOnTestClock,
      );

      yield* Effect.promise(() => act(() => tab.control().onDeletePlan(PLAN.id)));
      yield* landed;
      assert.equal(toast(), "Plan deleted");
      yield* advance(3_000 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);

      const refused = yield* Effect.promise(() => act(() => tab.control().onDeletePlan(PLAN.id)));
      yield* landed;
      assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(toast(), undefined, "the dialog says it");

      answers.push(false);
      const asked = tab.control().onDeletePlan(PLAN.id);
      tab.stand({ shown: false });
      yield* Effect.promise(() => act(() => asked));
      yield* landed;
      assert.equal(toast(), "The plan could not be deleted. Try again.");
    }),
);

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

test("the sidebar lists the pinned plans first, newest pinned first, then the rest as the service lists them, and the archived apart, newest archived first", () => {
  const tab = mount({
    shown: true,
    planning: {
      ...OPEN,
      plans: [
        row("e", 5),
        row("d", 4, { pinnedAt: 10 }),
        row("c", 3, { archivedAt: 20 }),
        row("b", 2, { pinnedAt: 30, archivedAt: 15 }),
        row("a", 1, { pinnedAt: 40 }),
      ],
    },
  });

  assert.deepEqual(
    tab.control().plans.map((plan) => plan.id),
    ["a", "d", "e"],
  );
  assert.deepEqual(
    tab.control().archived.map((plan) => plan.id),
    ["c", "b"],
  );
});

it.effect(
  "a pin draws at once, stands until the view carries it, and goes back with a toast saying so when refused, a pin that lands saying nothing",
  () =>
    Effect.gen(function* () {
      const answers: boolean[] = [false, true];
      const plans = [row("b", 2), row("a", 1)];
      const tab = mount(
        { shown: true, planning: { ...OPEN, plans } },
        { [ACT_KIND.PLANNING_PIN]: () => Promise.resolve(answers.shift() ?? false) },
        yield* registryOnTestClock,
      );
      const order = () => tab.control().plans.map((plan) => [plan.id, plan.pinnedAt !== undefined]);

      act(() => tab.control().onMarkPlan("a", PLAN_MARK.PIN));
      yield* landed;
      assert.deepEqual(order(), [
        ["b", false],
        ["a", false],
      ]);
      assert.equal(toast(), "The plan could not be pinned. Try again.");
      yield* advance(6_000 + MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined);

      act(() => tab.control().onMarkPlan("a", PLAN_MARK.PIN));
      assert.deepEqual(order(), [
        ["a", true],
        ["b", false],
      ]);
      yield* landed;
      assert.equal(toast(), undefined, "the row moving is answer enough");
      tab.stand({ planning: { ...OPEN, plans: [row("b", 2), row("a", 1, { pinnedAt: 3 })] } });
      // Carried by the view, the pin is the view's again: an unpin drawn there is drawn here.
      tab.stand({ planning: { ...OPEN, plans } });
      assert.deepEqual(order(), [
        ["b", false],
        ["a", false],
      ]);
    }),
);

test("archiving the open plan leaves it for the new-plan page once the service keeps it, and archiving another leaves the open one", async () => {
  const listed: PlanningView = { ...OPEN, plans: [row(PLAN.id, 1), row("other", 2)] };
  const tab = mount(
    { shown: true, planning: listed },
    {
      [ACT_KIND.PLANNING_CLOSE]: () => Promise.resolve(undefined),
      [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(true),
    },
  );

  await act(async () => tab.control().onMarkPlan("other", PLAN_MARK.ARCHIVE));
  assert.equal(tab.control().boundFor, PLAN.id);
  await act(async () => tab.control().onMarkPlan(PLAN.id, PLAN_MARK.ARCHIVE));

  assert.equal(tab.control().boundFor, undefined);
  assert.deepEqual(
    tab.control().archived.map((plan) => plan.id),
    [PLAN.id, "other"],
  );
  assert.deepEqual(tab.told.slice(-3), [
    ACT_KIND.PLANNING_ARCHIVE,
    ACT_KIND.PLANNING_ARCHIVE,
    ACT_KIND.PLANNING_CLOSE,
  ]);
});

it.effect(
  "an archive of the open plan the service refused leaves the plan open and its call standing, and says so in a toast",
  () =>
    Effect.gen(function* () {
      const listed: PlanningView = { ...OPEN, plans: [row(PLAN.id, 1)] };
      const tab = mount(
        { shown: true, planning: listed },
        { [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(false) },
        yield* registryOnTestClock,
      );

      act(() => tab.control().onMarkPlan(PLAN.id, PLAN_MARK.ARCHIVE));
      yield* landed;

      assert.equal(tab.control().boundFor, PLAN.id);
      assert.equal(tab.told.includes(ACT_KIND.PLANNING_CLOSE), false);
      assert.deepEqual(
        tab.control().plans.map((plan) => plan.id),
        [PLAN.id],
      );
      assert.equal(toast(), "The plan could not be archived. Try again.");
      assert.equal(document.querySelector(".toast button"), null, "nothing to undo");
    }),
);

it.effect(
  "an archive that lands says so with an Undo, which brings the plan back and opens it again where the archive left it, saying nothing more",
  () =>
    Effect.gen(function* () {
      const listed: PlanningView = { ...OPEN, plans: [row(PLAN.id, 1)] };
      const tab = mount(
        { shown: true, planning: listed },
        {
          [ACT_KIND.PLANNING_CLOSE]: () => Promise.resolve(undefined),
          [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(true),
          [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true),
        },
        yield* registryOnTestClock,
      );

      act(() => tab.control().onMarkPlan(PLAN.id, PLAN_MARK.ARCHIVE));
      yield* landed;
      assert.equal(tab.control().boundFor, undefined);
      assert.equal(toast(), "Plan archivedUndo");

      act(() => undoButton().click());
      assert.deepEqual(
        tab.control().plans.map((plan) => plan.id),
        [PLAN.id],
        "back among the plans at once",
      );
      yield* landed;
      assert.deepEqual(tab.told.slice(-3), [
        ACT_KIND.PLANNING_CLOSE,
        ACT_KIND.PLANNING_ARCHIVE,
        ACT_KIND.PLANNING_SELECT,
      ]);
      yield* advance(MOTION_DURATION_MS.EXIT);
      assert.equal(toast(), undefined, "an undoing says nothing of its own");
    }),
);

it.effect(
  "an unarchive says so with an Undo, and an Undo the service refuses puts the plan back where the Undo found it and says so",
  () =>
    Effect.gen(function* () {
      const answers: boolean[] = [true, false];
      const listed: PlanningView = {
        ...OPEN,
        plans: [row(PLAN.id, 1), row("old", 2, { archivedAt: 3 })],
      };
      const tab = mount(
        { shown: true, planning: listed },
        { [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(answers.shift() ?? false) },
        yield* registryOnTestClock,
      );

      act(() => tab.control().onMarkPlan("old", PLAN_MARK.UNARCHIVE));
      yield* landed;
      assert.equal(toast(), "Plan unarchivedUndo");
      tab.stand({ planning: { ...OPEN, plans: [row(PLAN.id, 1), row("old", 2)] } });
      act(() => undoButton().click());
      yield* landed;

      assert.equal(toast(), "The plan could not be archived. Try again.");
      assert.deepEqual(
        tab.control().plans.map((plan) => plan.id),
        [PLAN.id, "old"],
        "still unarchived, as the refused Undo found it",
      );
      assert.equal(tab.control().boundFor, PLAN.id, "the open plan stays open");
    }),
);

it.effect(
  "a repository's plans archived together say so in one toast, whose Undo brings back every one and opens again the open plan the archive left",
  () =>
    Effect.gen(function* () {
      const listed: PlanningView = {
        ...OPEN,
        plans: [row(PLAN.id, 1), row("other", 2), row("third", 3)],
      };
      const tab = mount(
        { shown: true, planning: listed },
        {
          [ACT_KIND.PLANNING_CLOSE]: () => Promise.resolve(undefined),
          [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(true),
          [ACT_KIND.PLANNING_SELECT]: () => Promise.resolve(true),
        },
        yield* registryOnTestClock,
      );

      act(() => tab.control().onArchivePlans([PLAN.id, "other"]));
      const drawn = tab.control().archived.map((plan) => plan.id);
      yield* landed;
      assert.equal(tab.control().boundFor, undefined, "the open plan among them is left");
      assert.equal(toast(), "2 plans archivedUndo");

      act(() => undoButton().click());
      yield* landed;

      assert.deepEqual(drawn, [PLAN.id, "other"], "drawn archived at once");
      assert.deepEqual(
        tab.control().plans.map((plan) => plan.id),
        [PLAN.id, "other", "third"],
      );
      assert.equal(tab.told.filter((kind) => kind === ACT_KIND.PLANNING_ARCHIVE).length, 4);
      assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SELECT, "the left plan opens again");
    }),
);

it.effect(
  "a repository's plans the service refused go back where they were, and the toast counts them",
  () =>
    Effect.gen(function* () {
      const answers = [true, false, false, false];
      const listed: PlanningView = {
        ...OPEN,
        plans: [row(PLAN.id, 1), row("other", 2), row("third", 3)],
      };
      const tab = mount(
        { shown: true, planning: listed },
        { [ACT_KIND.PLANNING_ARCHIVE]: () => Promise.resolve(answers.shift() ?? false) },
        yield* registryOnTestClock,
      );

      act(() => tab.control().onArchivePlans(["other", "third"]));
      yield* landed;
      const partly = toast();
      const afterPartly = tab.control().plans.map((plan) => plan.id);
      act(() => tab.control().onArchivePlans([PLAN.id, "third"]));
      yield* landed;

      assert.equal(partly, "Plan archived, 1 could not beUndo");
      assert.deepEqual(afterPartly, [PLAN.id, "third"]);
      assert.equal(toast(), "The plans could not be archived. Try again.");
      assert.deepEqual(
        tab.control().plans.map((plan) => plan.id),
        [PLAN.id, "third"],
      );
      assert.equal(tab.control().boundFor, PLAN.id, "the open plan stays open");
    }),
);

test("a repository pinned or unpinned is drawn so at once, newest pinned first, and stands as main's view carries it", async () => {
  const listed: PlanningView = {
    ...OPEN,
    repositoryPins: [{ repository: "acme/relay", pinnedAt: 1 }],
  };
  const tab = mount(
    { shown: true, planning: listed },
    { [ACT_KIND.PLANNING_PIN_REPOSITORY]: () => Promise.resolve(true) },
  );

  const read = tab.control().pinnedRepositories;
  await act(async () => tab.control().onPinRepository("acme/ledger", true));
  const pinned = tab.control().pinnedRepositories;
  await act(async () => tab.control().onPinRepository("acme/relay", false));
  const unpinned = tab.control().pinnedRepositories;
  tab.stand({
    planning: { ...listed, repositoryPins: [{ repository: "acme/ledger", pinnedAt: 5 }] },
  });

  assert.deepEqual(read, ["acme/relay"]);
  assert.deepEqual(pinned, ["acme/ledger", "acme/relay"]);
  assert.deepEqual(unpinned, ["acme/ledger"]);
  assert.deepEqual(tab.control().pinnedRepositories, ["acme/ledger"]);
  assert.deepEqual(
    tab.told.filter((kind) => kind === ACT_KIND.PLANNING_PIN_REPOSITORY),
    [ACT_KIND.PLANNING_PIN_REPOSITORY, ACT_KIND.PLANNING_PIN_REPOSITORY],
  );
});

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

it.effect("a repository pin the service refused puts the group back and says so in a toast", () =>
  Effect.gen(function* () {
    const tab = mount(
      { shown: true, planning: OPEN },
      { [ACT_KIND.PLANNING_PIN_REPOSITORY]: () => Promise.resolve(false) },
      yield* registryOnTestClock,
    );

    act(() => tab.control().onPinRepository("acme/ledger", true));
    const drawn = tab.control().pinnedRepositories;
    yield* landed;

    assert.deepEqual(drawn, ["acme/ledger"]);
    assert.deepEqual(tab.control().pinnedRepositories, []);
    assert.equal(toast(), "The repository could not be pinned. Try again.");
  }),
);

test("New plan in a repository leaves the open plan for the new-plan page with that repository chosen, and plain New plan chooses none", async () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.PLANNING_CLOSE]: () => Promise.resolve(undefined) },
  );

  await act(async () => tab.control().onNewPlanIn("acme/ledger"));
  const chosen = tab.control().newPlan;
  act(() => tab.control().onNewPlan());

  assert.equal(tab.control().boundFor, undefined);
  assert.deepEqual(chosen.preset, { repository: "acme/ledger" });
  assert.equal(chosen.presses, 1);
  assert.equal(tab.control().newPlan.preset, undefined);
  assert.ok(tab.told.includes(ACT_KIND.PLANNING_CLOSE));
});

test("a repository chosen by New plan is let go once a plan opens, so a later visit starts on the composer's own choice", async () => {
  const home: PlanningView = { ...IDLE_PLANNING_VIEW, listStatus: PLANNING_READ.READY };
  const tab = mount({ shown: true, planning: home });

  act(() => tab.control().onNewPlanIn("acme/ledger"));
  const chosen = tab.control().newPlan.preset;
  tab.stand({ planning: OPEN });

  assert.deepEqual(chosen, { repository: "acme/ledger" });
  assert.equal(tab.control().newPlan.preset, undefined);
});

const PERSONAL = { id: "workspace-personal", name: "Personal", personal: true };
const ACME = { id: "workspace-acme", name: "Acme", personal: false };

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

/** A start's payload, read back as the act's own schema admits it. */
const readStart = Schema.decodeUnknownOption(
  Schema.Struct({ workspaceId: Schema.optionalKey(Schema.String) }),
);

/** The workspace each start the tab asked for named, none where it named none. */
function startedIn(starts: readonly unknown[]): (string | undefined)[] {
  return starts.map((payload) => Option.getOrUndefined(readStart(payload))?.workspaceId);
}

const UNSTARTED = {
  [ACT_KIND.PLANNING_START]: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
};

test("the sidebar lists the personal workspace's plans first, a workspace chosen lists its own alone, and New plan starts in the one chosen", async () => {
  const tab = mount({ shown: true, planning: TWO_WORKSPACES }, UNSTARTED);

  const personal = {
    workspace: tab.control().workspace?.id,
    plans: tab.control().plans.map((plan) => plan.id),
    archived: tab.control().archived.map((plan) => plan.id),
  };
  await tab.control().newPlan.start("Invites", null);
  act(() => tab.control().onChooseWorkspace(ACME.id));
  await tab.control().newPlan.start("Usage", "acme/relay");

  assert.deepEqual(personal, {
    workspace: PERSONAL.id,
    plans: ["notes", "billing"],
    archived: ["old-notes"],
  });
  assert.equal(tab.control().workspace?.id, ACME.id);
  assert.deepEqual(
    tab.control().plans.map((plan) => plan.id),
    ["alerts"],
  );
  assert.deepEqual(
    tab.control().archived.map((plan) => plan.id),
    ["old-launch"],
  );
  assert.deepEqual(startedIn(tab.starts), [PERSONAL.id, ACME.id]);
});

test("a workspace chosen is chosen again on the next launch, and one the account is no longer in gives way to the personal one", () => {
  const first = mount({ shown: true, planning: TWO_WORKSPACES });
  act(() => first.control().onChooseWorkspace(ACME.id));
  document.body.innerHTML = "";

  const relaunched = mount({ shown: true, planning: TWO_WORKSPACES });
  const kept = relaunched.control().workspace?.id;
  relaunched.stand({ planning: { ...TWO_WORKSPACES, workspaces: [PERSONAL] } });

  assert.equal(kept, ACME.id);
  assert.equal(relaunched.control().workspace?.id, PERSONAL.id);
  assert.deepEqual(
    relaunched.control().plans.map((plan) => plan.id),
    ["notes", "billing"],
  );
});

test("before the workspaces are read every plan is listed and New plan names no workspace, so the service starts it in the personal one", async () => {
  const tab = mount({ shown: true, planning: { ...TWO_WORKSPACES, workspaces: [] } }, UNSTARTED);

  await tab.control().newPlan.start("Invites", null);

  assert.equal(tab.control().workspace, undefined);
  assert.deepEqual(
    tab.control().plans.map((plan) => plan.id),
    ["notes", "alerts", "billing"],
  );
  assert.deepEqual(startedIn(tab.starts), [undefined]);
});

test("Manage workspaces asks main to open the Workspaces page, and a fixture's opens nothing", () => {
  const tab = mount({ shown: true, planning: TWO_WORKSPACES });
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.IDLE });

  act(() => tab.control().onManageWorkspaces());
  act(() => fixture.control().onManageWorkspaces());

  assert.equal(tab.told.at(-1), ACT_KIND.WORKSPACES_MANAGE);
  assert.deepEqual(fixture.told, []);
});

test("a fixture run lists its personal workspace's plans under the switcher, and a choice there is kept nowhere", () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.IDLE });
  const staged = fixture.control().plans.map((plan) => plan.name);
  act(() => fixture.control().onChooseWorkspace("workspace-acme"));

  assert.deepEqual(staged, ["Teammate invitations", "Billing export"]);
  assert.deepEqual(
    fixture.control().plans.map((plan) => plan.name),
    ["Usage alerts"],
  );
  assert.equal(fixture.control().workspaces.length, 2);
  assert.equal(window.localStorage.length, 0);
});

test("a fixture's plan is pinned and archived nowhere", () => {
  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  act(() => fixture.control().onMarkPlan(PLAN.id, PLAN_MARK.ARCHIVE));
  act(() => fixture.control().onArchivePlans([PLAN.id]));
  act(() => fixture.control().onPinRepository("acme/relay", true));
  assert.deepEqual(fixture.told, []);
  assert.deepEqual(fixture.control().pinnedRepositories, []);
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

test("the speaker silences Luke through the voice window and plays him again once he is silenced", () => {
  const call: VoiceView = {
    ...IDLE_VOICE_VIEW,
    voiceStatus: LIVE_STATUS.LISTENING,
    callPlanId: PLAN.id,
  };
  const tab = mount({ shown: true, planning: OPEN, voice: call });
  assert.equal(tab.control().speaker.muted, false);
  act(() => tab.control().speaker.onPress());
  tab.stand({ voice: { ...call, speakerMuted: true } });
  assert.equal(tab.control().speaker.muted, true);
  act(() => tab.control().speaker.onPress());
  assert.deepEqual(tab.voiceCommands, [VOICE_COMMAND.MUTE_SPEAKER, VOICE_COMMAND.UNMUTE_SPEAKER]);
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

test("the Work tab reads the turns before its oldest through the host, while the view says older ones stand", async () => {
  const tab = mount(
    { shown: true, planning: { ...OPEN, workEarlier: "turn-2" } },
    { [ACT_KIND.PLANNING_WORK_EARLIER]: () => Promise.resolve() },
  );
  assert.equal(tab.control().work.earlier, "turn-2");

  await act(() => tab.control().work.onLoadEarlier());
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_WORK_EARLIER);
  tab.stand({ planning: OPEN });
  assert.equal(tab.control().work.earlier, undefined);
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
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

/** The code shown on the open plan: one snippet, then a second of the same file. */
const SHOWN: readonly PlanCodeShowing[] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];
const SHOWN_AGAIN: readonly PlanCodeShowing[] = [
  ...SHOWN,
  { callId: "show-2", turnId: "turn-1", shownAt: 1, code: CODE },
];

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

/** One turn of Luke's planning model on the open plan. */
const TURN: PlanWorkTurn = {
  turnId: "turn-1",
  startedAt: 1,
  state: PLAN_WORK_STATE.DONE,
  earlierOmitted: false,
  parts: [],
};

/** The open plan's calls read back: none, and one with a line said on it. */
const NO_CALLS: PlanningView["transcript"] = {
  status: PLANNING_READ.READY,
  transcript: { calls: [], earlierOmitted: false },
};
const ONE_CALL: PlanningView["transcript"] = {
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
const NOTHING_YET: PlanningView = {
  ...OPEN,
  board: EMPTY_BOARD,
  shownCode: [],
  transcript: NO_CALLS,
  work: [],
};

test("a new plan has no tab, and each kind's first content adds its tab in its place, Luke's drawing showing its own", () => {
  const tab = mount({ shown: true, planning: OPEN });
  assert.deepEqual(tab.control().sidePanel.tabs, [], "nothing read draws nothing");
  tab.stand({ planning: NOTHING_YET });
  act(() => tab.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(tab), { open: true, tab: undefined });
  assert.deepEqual(tab.control().sidePanel.tabs, []);

  tab.stand({ planning: { ...NOTHING_YET, transcript: ONE_CALL } });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.TRANSCRIPT]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT });
  tab.stand({ planning: { ...NOTHING_YET, transcript: ONE_CALL, work: [TURN] } });
  tab.stand({ planning: { ...NOTHING_YET, transcript: ONE_CALL, work: [TURN], shownCode: SHOWN } });
  tab.stand({
    planning: {
      ...NOTHING_YET,
      transcript: ONE_CALL,
      work: [TURN],
      shownCode: SHOWN,
      board: drawnBoard(1),
      document: {
        status: PLANNING_READ.READY,
        plan: { ...PLAN, lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 1, duringCall: true } },
      },
    },
  });
  assert.deepEqual(tab.control().sidePanel.tabs, SIDE_PANEL_TABS);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("a first snippet, its read having left the code absent, is added ahead of the Transcript tab shown and takes its place", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, transcript: ONE_CALL } });
  act(() => tab.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT });
  tab.stand({ voice: ON_CALL });

  tab.stand({ planning: { ...OPEN, transcript: ONE_CALL, shownCode: SHOWN } });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.CODE, SIDE_PANEL_TAB.TRANSCRIPT]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("a call's line heard live adds the Transcript tab before the record holds it", () => {
  const tab = mount({ shown: true, planning: NOTHING_YET });
  tab.stand({
    voice: {
      ...IDLE_VOICE_VIEW,
      callPlanId: PLAN.id,
      callTranscript: {
        voiceSessionId: "9e4b1a2c-6d3f-4e8a-b7c5-1f2a3b4c5d6e",
        lines: [{ rowId: "row-1", speaker: "user", words: "Invites should expire." }],
      },
    },
  });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.TRANSCRIPT]);
});

test("each plan draws its own tabs, a tab closed on one stays open on another, and a tab chosen on one reads as the first another has", () => {
  const OTHER = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
  const first: PlanningView = { ...NOTHING_YET, transcript: ONE_CALL, work: [TURN] };
  const second: PlanningView = { ...NOTHING_YET, activePlanId: OTHER, work: [TURN] };
  const tab = mount({ shown: true, planning: first });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.WORK));
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.TRANSCRIPT]);

  tab.stand({ planning: second });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.WORK]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.WORK });

  tab.stand({ planning: first });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.TRANSCRIPT]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT });
});

test("each drawing Luke puts on the open plan's board opens the panel on the board, the panel hidden between them or not", () => {
  const tab = mount({ shown: true, planning: OPEN });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ planning: { ...OPEN, board: EMPTY_BOARD } });
  assert.deepEqual(panelOf(tab), { open: false, tab: SIDE_PANEL_TAB.TRANSCRIPT });

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.equal(tab.control().sidePanel.fullScreen, false);

  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.equal(tab.control().sidePanel.open, false, "the same drawing read again is not a new one");
  tab.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("each snippet Luke shows on the open plan's call opens the panel on the code, the panel hidden between them or not", () => {
  const tab = mount({ shown: true, planning: OPEN });
  tab.stand({ voice: ON_CALL });
  assert.equal(tab.control().sidePanel.open, false);

  tab.stand({ planning: { ...OPEN, shownCode: SHOWN } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });

  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ planning: { ...OPEN, shownCode: SHOWN_AGAIN } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });

  act(() => tab.control().sidePanel.onToggle());
  tab.stand({ voice: IDLE_VOICE_VIEW, planning: OPEN });
  tab.stand({ voice: ON_CALL });
  tab.stand({ planning: { ...OPEN, shownCode: SHOWN } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
});

test("a snippet Luke shows after the developer closed the Code tab opens it again, over the tab the panel showed", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, work: [TURN] }, voice: ON_CALL });
  tab.stand({ planning: { ...OPEN, work: [TURN], shownCode: SHOWN } });
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.CODE));
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.WORK));
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.WORK]);

  tab.stand({ planning: { ...OPEN, work: [TURN], shownCode: SHOWN } });
  assert.deepEqual(
    panelOf(tab),
    { open: true, tab: SIDE_PANEL_TAB.WORK },
    "the same snippet redrawn is not a new one",
  );

  tab.stand({ planning: { ...OPEN, work: [TURN], shownCode: SHOWN_AGAIN } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.deepEqual(tab.control().sidePanel.closedTabs, []);
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("the code shown on the open plan is drawn with no call standing, as after a restart, and a call that starts with it opens no panel", () => {
  const tab = mount({ shown: true, planning: OPEN });
  tab.stand({ planning: { ...OPEN, shownCode: SHOWN } });
  assert.deepEqual(tab.control().shownCode, SHOWN);
  assert.equal(tab.control().sidePanel.open, false);

  tab.stand({ voice: ON_CALL });
  assert.deepEqual(tab.control().shownCode, SHOWN);
  assert.equal(tab.control().sidePanel.open, false);
});

test("a plan opened with its board already drawn opens no panel, and Luke's next drawing on it does", () => {
  const tab = mount({ shown: true, planning: OPEN });
  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.equal(tab.control().sidePanel.open, false);

  tab.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
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

test("a plan relaunched with its board drawn opens no panel until Luke draws again", () => {
  const other = { ...OPEN, activePlanId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" };
  const first = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  first.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.equal(first.control().sidePanel.open, true);
  act(() => first.control().sidePanel.onToggle());
  document.body.innerHTML = "";

  const relaunched = mount({ shown: true, planning: other });
  relaunched.stand({ planning: OPEN });
  relaunched.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.equal(relaunched.control().sidePanel.open, false);
  relaunched.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.deepEqual(panelOf(relaunched), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("a drawing while the panel shows another tab takes its place, full screen and all", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.TRANSCRIPT));
  act(() => tab.control().sidePanel.onToggleFullScreen());

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.equal(tab.control().sidePanel.fullScreen, true);
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("Luke's first drawing adds the Board tab in its place, and shows it", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD, work: [TURN] } });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.WORK));

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1), work: [TURN] } });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.WORK]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
});

test("a Board tab the developer closed on a plan opens again on Luke's next drawing", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: drawnBoard(1) } });
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onToggle());
  assert.deepEqual(panelOf(tab), { open: false, tab: undefined });
  assert.deepEqual(tab.control().sidePanel.closedTabs, [SIDE_PANEL_TAB.BOARD]);

  tab.stand({ planning: { ...OPEN, board: drawnBoard(2) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().sidePanel.closedTabs, []);
});

test("an arrival on an open panel with every tab closed shows the arrival's tab, with no dot", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD } });
  act(() => tab.control().sidePanel.onToggle());
  for (const closed of SIDE_PANEL_TABS) {
    act(() => tab.control().sidePanel.onClose(closed));
  }
  assert.deepEqual(panelOf(tab), { open: true, tab: undefined });

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1) } });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });
  assert.deepEqual(tab.control().unreadTabs, []);
});

test("the board and the code arriving on one read of an open panel with every tab closed show the code and dot the board", () => {
  const tab = mount({ shown: true, planning: { ...OPEN, board: EMPTY_BOARD }, voice: ON_CALL });
  act(() => tab.control().sidePanel.onToggle());
  for (const closed of SIDE_PANEL_TABS) {
    act(() => tab.control().sidePanel.onClose(closed));
  }

  tab.stand({ planning: { ...OPEN, board: drawnBoard(1), shownCode: SHOWN } });
  assert.deepEqual(tab.control().sidePanel.tabs, [SIDE_PANEL_TAB.BOARD, SIDE_PANEL_TAB.CODE]);
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.CODE });
  assert.deepEqual(tab.control().unreadTabs, [SIDE_PANEL_TAB.BOARD]);
});

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

test("main is told which agent's tab is shown, and none once the column moves off it, the side panel fills the window over it, the version history covers it, or the tab goes away", async () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  await settle();
  assert.deepEqual(tab.shownAgents, [null]);

  act(() => tab.control().mainTabs.onChoose({ agent: AGENT_ID }));
  assert.deepEqual(tab.shownAgents, [null, AGENT_ID]);

  act(() => tab.control().mainTabs.onChoose(MAIN_TAB.PLAN));
  act(() => tab.control().mainTabs.onChoose({ agent: AGENT_ID }));
  act(() => tab.control().sidePanel.onChoose(SIDE_PANEL_TAB.BOARD));
  act(() => tab.control().sidePanel.onToggleFullScreen());
  act(() => tab.control().sidePanel.onToggleFullScreen());
  act(() => tab.control().history.onOpen(PLAN.id));
  act(() => tab.control().history.onClose());
  tab.stand({ shown: false });
  assert.deepEqual(tab.shownAgents, [
    null,
    AGENT_ID,
    null,
    AGENT_ID,
    null,
    AGENT_ID,
    null,
    AGENT_ID,
    null,
  ]);
});

/** Luke's start of a coding agent in the open plan's work, as its call stands: still running, or answered. */
function startedAgent(
  state: typeof PLAN_WORK_STATE.RUNNING | typeof PLAN_WORK_STATE.DONE,
): PlanWorkTurn {
  return {
    ...TURN,
    parts: [
      {
        type: PLAN_WORK_PART.TOOL,
        id: "call-start-1",
        name: "start_coding_agent",
        tool: PLAN_WORK_TOOL.START_AGENT,
        state,
        input: "{}",
      },
    ],
  };
}

/** How many times the plan's agents were read. */
function listReads(tab: ReturnType<typeof mount>): number {
  return tab.agentActs.filter((kind) => kind === ACT_KIND.CODING_AGENTS_LIST).length;
}

test("an agent Luke starts in the call is read into the list as its start answers, once, and a start already in the work as the plan opens is read with the plan", async () => {
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await settle();
  assert.equal(listReads(tab), 1);

  tab.stand({ planning: { ...OPEN, work: [startedAgent(PLAN_WORK_STATE.RUNNING)] } });
  await settle();
  assert.equal(listReads(tab), 1, "a start still running is nothing to read");

  tab.stand({ planning: { ...OPEN, work: [startedAgent(PLAN_WORK_STATE.DONE)] } });
  await settle();
  assert.equal(listReads(tab), 2);
  tab.stand({ planning: { ...OPEN, work: [startedAgent(PLAN_WORK_STATE.DONE)], shownCode: [] } });
  await settle();
  assert.equal(listReads(tab), 2, "the same start seen again reads nothing more");

  const reopened = mount(
    { shown: true, planning: { ...OPEN, work: [startedAgent(PLAN_WORK_STATE.DONE)] } },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [] }) },
  );
  await settle();
  assert.equal(listReads(reopened), 1);
});

test("a notification's click opens its plan on the agent's tab in the plan's column once its agents are read, out from under a side panel filling the window, which it leaves shut", async () => {
  const other: Plan = { ...PLAN, id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32", name: "Billing" };
  const tab = mount(
    {
      shown: true,
      planning: {
        ...OPEN,
        activePlanId: other.id,
        document: { status: PLANNING_READ.READY, plan: other },
      },
    },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );

  act(() => tab.control().onShowAgent(PLAN.id, AGENT_ID));
  assert.deepEqual(tab.told, [ACT_KIND.PLANNING_REFRESH, ACT_KIND.PLANNING_SELECT]);
  assert.equal(tab.control().mainTabs.tab, MAIN_TAB.PLAN, "the plan open until then shows its own");
  tab.stand({ planning: OPEN });
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(panelOf(tab).open, false);

  // The open plan is not opened again, and a panel filling the window gives way.
  act(() => tab.control().mainTabs.onChoose(MAIN_TAB.PLAN));
  act(() => tab.control().sidePanel.onToggle());
  act(() => tab.control().sidePanel.onToggleFullScreen());
  act(() => tab.control().onShowAgent(PLAN.id, AGENT_ID));
  assert.deepEqual(tab.told, [ACT_KIND.PLANNING_REFRESH, ACT_KIND.PLANNING_SELECT]);
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(tab.control().sidePanel.fullScreen, false);
});

test("an agent pinned to the sidebar opens its plan on the agent's tab in the plan's column, its closed tab opened again, and leaves the side panel shut", async () => {
  const other: Plan = { ...PLAN, id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32", name: "Billing" };
  const tab = mount(
    { shown: true, planning: OPEN },
    { [ACT_KIND.CODING_AGENTS_LIST]: () => Promise.resolve({ agents: [RUNNING_AGENT] }) },
  );
  act(() => tab.control().sidePanel.onPin({ agent: AGENT_ID }, "Invite flow"));
  act(() => tab.control().mainTabs.onClose({ agent: AGENT_ID }));
  const [pin] = tab.control().sidePanel.pins;
  assert.ok(pin);

  tab.stand({
    planning: {
      ...OPEN,
      activePlanId: other.id,
      document: { status: PLANNING_READ.READY, plan: other },
    },
  });
  act(() => tab.control().onOpenPinnedTab(pin));
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SELECT);
  tab.stand({ planning: OPEN });
  await settle();
  assert.deepEqual(tab.control().mainTabs.tab, { agent: AGENT_ID });
  assert.equal(panelOf(tab).open, false);
});

test("a tab pinned to the sidebar opens its plan and the panel on that tab from another plan, and its tab closed leaves the pin", () => {
  const other: Plan = { ...PLAN, id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32", name: "Billing" };
  const tab = mount({ shown: true, planning: OPEN });
  act(() => tab.control().sidePanel.onPin(SIDE_PANEL_TAB.BOARD, "Board"));
  const [pin] = tab.control().sidePanel.pins;
  assert.ok(pin);
  assert.equal(pin.plan, PLAN.id);

  tab.stand({
    planning: {
      ...OPEN,
      activePlanId: other.id,
      document: { status: PLANNING_READ.READY, plan: other },
    },
  });
  assert.deepEqual(panelOf(tab), { open: false, tab: undefined });
  act(() => tab.control().onOpenPinnedTab(pin));
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_SELECT);

  // The host opens the plan, and the panel stands open on the board, which the plan holds nothing of.
  tab.stand({ planning: OPEN });
  assert.deepEqual(panelOf(tab), { open: true, tab: SIDE_PANEL_TAB.BOARD });

  act(() => tab.control().sidePanel.onClose(SIDE_PANEL_TAB.BOARD));
  assert.deepEqual(panelOf(tab), { open: true, tab: undefined });
  assert.deepEqual(tab.control().sidePanel.pins, [pin]);
});

test("an agent main says ended unseen dots its tab beside the arrivals", () => {
  const tab = mount({ shown: true, planning: OPEN, unseenAgents: [AGENT_ID] });
  assert.deepEqual(tab.control().unreadTabs, [{ agent: AGENT_ID }]);

  tab.stand({ unseenAgents: [] });
  assert.deepEqual(tab.control().unreadTabs, []);
});
