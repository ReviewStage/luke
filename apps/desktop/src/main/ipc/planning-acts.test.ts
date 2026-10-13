import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { highlightSnippet } from "@sidecar/host";
import { PLAN_FILE_REFUSAL } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningStartAnswer } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { planningActRows } from "./planning-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
/** The plan the host has open, as the fixture's main process reads it. */
interface OpenPlan {
  activePlanId: string | undefined;
}

/** What the host answers a start with, and whether voice could open a call now. */
interface StartScript {
  answer: PlanningStartAnswer;
  voiceReady: boolean;
  /** Whether a call is already in progress, about whichever plan. */
  callStanding: boolean;
}

function fixture() {
  const asked: string[] = [];
  const talked: string[] = [];
  const opened: string[] = [];
  const view: OpenPlan = { activePlanId: PLAN_ID };
  const start: StartScript = {
    answer: { failure: PLAN_CALL_FAILURE.UNANSWERED },
    voiceReady: true,
    callStanding: false,
  };
  const rows = planningActRows({
    host: {
      planningRefresh: () => Effect.sync(() => void asked.push("refresh")),
      planningWorkEarlier: () => Effect.sync(() => void asked.push("earlier")),
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
      planningPin: (params) =>
        Effect.sync(() => {
          asked.push(`pin:${params.planId}:${params.pinned}`);
          return true;
        }),
      planningPinRepository: (params) =>
        Effect.sync(() => {
          asked.push(`pin-repository:${params.repository}:${params.pinned}`);
          return true;
        }),
      planningArchive: (params) =>
        Effect.sync(() => {
          asked.push(`archive:${params.planId}:${params.archived}`);
          return false;
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
      planningEdit: (params) =>
        Effect.sync(() => {
          const value = "document" in params.edit ? params.edit.document.value : "";
          asked.push(`edit:${params.planId}:${value}`);
          return { saved: true } as const;
        }),
      planningBoardSave: (params) =>
        Effect.sync(() => void asked.push(`board:${params.planId}:${params.appliedDrawing}`)),
      planningFile: (params) =>
        Effect.sync(() => {
          asked.push(`file:${params.path}:${params.firstLine}-${params.lastLine}`);
          return { refusal: PLAN_FILE_REFUSAL.MISSING } as const;
        }),
      planningTree: (params) =>
        Effect.sync(() => {
          asked.push(`tree:${params.path}`);
          return { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE } as const;
        }),
      planningSkills: (params) =>
        Effect.sync(() => {
          asked.push(`skills:${params.planId}`);
          return { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY } as const;
        }),
      planningRevisions: (params) =>
        Effect.sync(() => {
          asked.push(`revisions:${params.planId}:${params.before}`);
          return { revisions: [] };
        }),
      planningRevision: (params) =>
        Effect.sync(() => {
          asked.push(`revision:${params.seq}`);
          return { failure: PLAN_CALL_FAILURE.UNANSWERED } as const;
        }),
      planningRestore: (params) =>
        Effect.sync(() => {
          asked.push(`restore:${params.seq}`);
          return true;
        }),
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
    callStanding: () => start.callStanding,
    colourCode: highlightSnippet,
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, opened, view, start };
}
it.effect(
  "the developer's edit of the text reaches the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const edit = {
        kind: ACT_KIND.PLANNING_EDIT,
        payload: {
          planId: PLAN_ID,
          edit: { document: { base: "", value: "Invites expire." } },
        },
      } as const;

      const saved = yield* f.router.performAct(edit, PANEL);
      const fromVoice = yield* f.router.performAct(edit, VOICE);

      assert.deepEqual(saved, { status: ACT_OUTCOME_STATUS.DONE, value: { saved: true } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`edit:${PLAN_ID}:Invites expire.`]);
    }),
);
it.effect(
  "a web link opens an http or https address in the browser, and no other scheme nor an address past the cap",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const refused = [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "luke://plan/7",
        "mailto:dean@example.com",
        "//example.com/docs",
        "https://",
        `https://example.com/docs?q=${"a".repeat(2_048)}`,
      ];

      const opened = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        PANEL,
      );
      const plain = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "http://localhost:3000/" } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        VOICE,
      );
      const outcomes = yield* Effect.forEach(refused, (url) =>
        f.router.performAct(
          // SAFETY: an address the schema refuses is sent as the shape it would arrive in.
          { kind: ACT_KIND.WEB_OPEN, payload: { url } } as never,
          PANEL,
        ),
      );

      assert.equal(opened.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(plain.status, ACT_OUTCOME_STATUS.DONE);
      assert.notEqual(fromVoice.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status === ACT_OUTCOME_STATUS.DONE),
        refused.map(() => false),
      );
      assert.deepEqual(f.opened, ["https://example.com/docs", "http://localhost:3000/"]);
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
