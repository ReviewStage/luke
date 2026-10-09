import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PLAN_CALL_FAILURE, type PlanningStartAnswer } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { planningActRows } from "./planning-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const REQUEST = { name: "Teammate invitations", repository: "acme/relay" };

/** The plan the host has open, as the fixture's main process reads it. */
interface OpenPlan {
  activePlanId: string | undefined;
}

/** What the host answers a start with, and whether voice could open a call now. */
interface StartScript {
  answer: PlanningStartAnswer;
  voiceReady: boolean;
}

function fixture() {
  const asked: string[] = [];
  const talked: string[] = [];
  const opened: string[] = [];
  const view: OpenPlan = { activePlanId: PLAN_ID };
  const start: StartScript = {
    answer: { failure: PLAN_CALL_FAILURE.UNANSWERED },
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
      planningDelete: (planId) =>
        Effect.sync(() => {
          asked.push(`delete:${planId}`);
          return true;
        }),
      planningRename: (params) =>
        Effect.sync(() => {
          asked.push(`rename:${params.planId}:${params.name}`);
          return true;
        }),
      planningStart: (request) =>
        Effect.sync(() => {
          asked.push(`start:${request.repository}`);
          return start.answer;
        }),
      planningRepositories: () =>
        Effect.sync(() => {
          asked.push("repositories");
          return { failure: PLAN_CALL_FAILURE.UNANSWERED } as const;
        }),
      planningSetRepository: (params) =>
        Effect.sync(() => {
          asked.push(`repository:${params.planId}:${params.repository}`);
          return { repository: params.repository };
        }),
      planningBoardSave: (params) =>
        Effect.sync(() => void asked.push(`board:${params.planId}:${params.appliedDrawing}`)),
    },
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    activePlanId: () => view.activePlanId,
    talkAboutPlan: (planId) => {
      talked.push(planId);
    },
    voiceReady: () => start.voiceReady,
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, opened, view, start };
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
    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_CLOSE }, PANEL);
    const renamed = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_RENAME, payload: { planId: PLAN_ID, name: " Team invites " } },
      PANEL,
    );
    const deleted = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_DELETE, payload: { planId: PLAN_ID } },
      PANEL,
    );

    assert.deepEqual(renamed, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(deleted, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(selected, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(started, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
    });
    assert.deepEqual(f.asked, [
      "refresh",
      `open:${PLAN_ID}`,
      "start:acme/relay",
      "close",
      `rename:${PLAN_ID}:Team invites`,
      `delete:${PLAN_ID}`,
    ]);
  }),
);

it.effect(
  "the repository chip's read and a plan's repository reach the host, and answer what it answered",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const listed = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REPOSITORIES }, PANEL);
      const changed = yield* f.router.performAct(
        { kind: ACT_KIND.PLANNING_SET_REPOSITORY, payload: { planId: PLAN_ID, repository: null } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REPOSITORIES }, VOICE);

      assert.deepEqual(listed, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: PLAN_CALL_FAILURE.UNANSWERED },
      });
      assert.deepEqual(changed, { status: ACT_OUTCOME_STATUS.DONE, value: { repository: null } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, ["repositories", `repository:${PLAN_ID}:null`]);
    }),
);

it.effect("Open on GitHub opens a GitHub address in the browser, and no other address at all", () =>
  Effect.gen(function* () {
    const f = fixture();

    const opened = yield* f.router.performAct(
      { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay" } },
      PANEL,
    );
    const elsewhere = yield* f.router.performAct(
      // SAFETY: an address off GitHub is what the schema refuses, so it is sent as the shape it would arrive in.
      { kind: ACT_KIND.GITHUB_OPEN, payload: { url: "https://example.com/acme/relay" } } as never,
      PANEL,
    );

    assert.equal(opened.status, ACT_OUTCOME_STATUS.DONE);
    assert.notEqual(elsewhere.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(f.opened, ["https://github.com/acme/relay"]);
  }),
);

it.effect("the voice window does not reach the plans", () =>
  Effect.gen(function* () {
    const f = fixture();
    const board = { planId: PLAN_ID, elements: [], appliedDrawing: 0 };

    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
      VOICE,
    );
    const saved = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_BOARD_SAVE, payload: board },
      VOICE,
    );
    assert.deepEqual(selected, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PLANNING_SELECT].refusal,
    });
    assert.deepEqual(saved, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.PLANNING_BOARD_SAVE].refusal,
    });
    assert.deepEqual(f.asked, []);
  }),
);

it.effect("the panel's board save reaches the host with the drawing its scene holds", () =>
  Effect.gen(function* () {
    const f = fixture();

    const saved = yield* f.router.performAct(
      {
        kind: ACT_KIND.PLANNING_BOARD_SAVE,
        payload: { planId: PLAN_ID, elements: [], appliedDrawing: 3 },
      },
      PANEL,
    );

    assert.equal(saved.status, ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(f.asked, [`board:${PLAN_ID}:3`]);
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

      const refused = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_TALK }, VOICE);
      assert.equal(refused.status, ACT_OUTCOME_STATUS.REFUSED);
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
