import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import type { PlanningStartAnswer } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { GITHUB_CONNECT_SIGNED_OUT, planningActRows } from "./planning-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, introduction: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const INTRODUCTION: ActSender = { ...PANEL, introduction: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const REQUEST = { name: "Teammate invitations", folderPath: "/Users/dev/relay" };

/** The plan the host has open, as the fixture's main process reads it. */
interface OpenPlan {
  activePlanId: string | undefined;
}

/** What the folder picker answers: the folder chosen, or null for a cancel. */
interface FolderPicker {
  chosen: string | null;
}

/** What the host answers a start with, and whether voice could open a call now. */
interface StartScript {
  answer: PlanningStartAnswer;
  voiceReady: boolean;
}

function fixture() {
  const asked: string[] = [];
  const talked: string[] = [];
  const view: OpenPlan = { activePlanId: PLAN_ID };
  const account = { signedIn: true };
  const picker: FolderPicker = { chosen: "/Users/dev/relay" };
  const start: StartScript = {
    answer: { failure: GITHUB_FAILURE.NOT_CONNECTED },
    voiceReady: true,
  };
  const rows = planningActRows({
    host: {
      planningRefresh: () => Effect.sync(() => void asked.push("refresh")),
      planningClose: () => Effect.sync(() => void asked.push("close")),
      planningOpen: (planId) =>
        Effect.sync(() => {
          asked.push(`open:${planId}`);
          return true;
        }),
      planningStart: (request) =>
        Effect.sync(() => {
          asked.push(`start:${request.folderPath}`);
          return start.answer;
        }),
      planningSetFolder: (params) =>
        Effect.sync(() => void asked.push(`folder:${params.planId}:${params.folderPath}`)),
      planningRepositories: () =>
        Effect.sync(() => {
          asked.push("repositories");
          return {
            repositories: [{ owner: "acme", name: "relay", private: true }],
            truncated: false,
          };
        }),
      planningConnectGitHub: () =>
        Effect.sync(() => {
          asked.push("connect");
          return account.signedIn;
        }),
    },
    chooseFolder: () =>
      Effect.sync(() => {
        asked.push("choose-folder");
        return picker.chosen;
      }),
    activePlanId: () => view.activePlanId,
    talkAboutPlan: (planId) => {
      talked.push(planId);
    },
    voiceReady: () => start.voiceReady,
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, view, account, start, picker };
}

it.effect("the Plans tab's asks reach the host and answer what the host answered", () =>
  Effect.gen(function* () {
    const f = fixture();

    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REFRESH }, PANEL);
    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
      PANEL,
    );
    const started = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_START, payload: REQUEST },
      PANEL,
    );
    const repositories = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_REPOSITORIES },
      PANEL,
    );
    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_CLOSE }, PANEL);

    assert.deepEqual(selected, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(started, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { failure: GITHUB_FAILURE.NOT_CONNECTED },
    });
    assert.deepEqual(repositories, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { repositories: [{ owner: "acme", name: "relay", private: true }], truncated: false },
    });
    assert.deepEqual(f.asked, [
      "refresh",
      `open:${PLAN_ID}`,
      "start:/Users/dev/relay",
      "repositories",
      "close",
    ]);
  }),
);

it.effect("Choose folder answers the folder picked, or null when the picker was cancelled", () =>
  Effect.gen(function* () {
    const f = fixture();

    const chosen = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_CHOOSE_FOLDER }, PANEL);
    f.picker.chosen = null;
    const cancelled = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_CHOOSE_FOLDER }, PANEL);

    assert.deepEqual(chosen, { status: ACT_OUTCOME_STATUS.DONE, value: "/Users/dev/relay" });
    assert.deepEqual(cancelled, { status: ACT_OUTCOME_STATUS.DONE, value: null });
  }),
);

it.effect("neither the voice window nor the takeover reaches the plans", () =>
  Effect.gen(function* () {
    const f = fixture();

    for (const sender of [VOICE, INTRODUCTION]) {
      const selected = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
        sender,
      );
      assert.deepEqual(selected, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_SELECT].refusal,
      });
    }
    assert.deepEqual(f.asked, []);
  }),
);

it.effect(
  "Connect GitHub opens the page through the host, and says to sign in when it opened nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const connected = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_CONNECT_GITHUB },
        PANEL,
      );
      f.account.signedIn = false;
      const signedOut = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_CONNECT_GITHUB },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_CONNECT_GITHUB },
        VOICE,
      );

      assert.equal(connected.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(signedOut, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: GITHUB_CONNECT_SIGNED_OUT,
      });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, ["connect", "connect"]);
    }),
);

it.effect(
  "the Plans tab's microphone tells the voice window about the plan the host has open, and is refused with none open or from any other window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const talked = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, PANEL);
      assert.equal(talked.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(f.talked, [PLAN_ID]);

      for (const sender of [VOICE, INTRODUCTION]) {
        const refused = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, sender);
        assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
      }
      f.view.activePlanId = undefined;
      const unopened = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, PANEL);
      assert.deepEqual(unopened, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.PLANNING_TALK].refusal,
      });
      assert.deepEqual(f.talked, [PLAN_ID]);
    }),
);

it.effect(
  "a started plan opens its call at once when voice could open one without asking, so Luke's greeting needs no second press",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const NEW_PLAN_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
      f.start.answer = { planId: NEW_PLAN_ID };

      const started = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_START, payload: REQUEST },
        PANEL,
      );

      assert.deepEqual(started, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { planId: NEW_PLAN_ID },
      });
      assert.deepEqual(f.talked, [NEW_PLAN_ID]);
    }),
);

it.effect(
  "a start that failed, or one where the microphone would first have to be asked for, opens no call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_START, payload: REQUEST }, PANEL);

      f.start.answer = { planId: PLAN_ID };
      f.start.voiceReady = false;
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_START, payload: REQUEST }, PANEL);

      assert.deepEqual(f.talked, []);
    }),
);
