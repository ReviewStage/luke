import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { connectGitHubPending, GITHUB_CONNECTION_PENDING, planningActRows } from "./planning-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = {
  sender: SENDER,
  panel: true,
  voice: false,
  planning: false,
  introduction: false,
};
const PLANNING: ActSender = { ...PANEL, panel: false, planning: true };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const INTRODUCTION: ActSender = { ...PANEL, introduction: true };

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const REQUEST = { name: "Teammate invitations", repository: { owner: "acme", name: "relay" } };

function fixture() {
  const asked: string[] = [];
  let opened = 0;
  const rows = planningActRows({
    openWindow: () => {
      opened += 1;
    },
    host: {
      planningRefresh: () => Effect.sync(() => void asked.push("refresh")),
      planningOpen: (planId) =>
        Effect.sync(() => {
          asked.push(`open:${planId}`);
          return true;
        }),
      planningStart: (request) =>
        Effect.sync(() => {
          asked.push(`start:${request.repository.owner}/${request.repository.name}`);
          return { failure: GITHUB_FAILURE.NOT_CONNECTED };
        }),
      planningRepositories: () =>
        Effect.sync(() => {
          asked.push("repositories");
          return {
            repositories: [{ owner: "acme", name: "relay", private: true }],
            truncated: false,
          };
        }),
    },
    connectGitHub: connectGitHubPending,
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, opened: () => opened };
}

it.effect("the planning window's asks reach the host and answer what the host answered", () =>
  Effect.gen(function* () {
    const f = fixture();

    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REFRESH }, PLANNING);
    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_SELECT, payload: { planId: PLAN_ID } },
      PLANNING,
    );
    const started = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_START, payload: REQUEST },
      PLANNING,
    );
    const repositories = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_REPOSITORIES },
      PLANNING,
    );

    assert.deepEqual(selected, { status: ACT_OUTCOME_STATUS.DONE, value: true });
    assert.deepEqual(started, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { failure: GITHUB_FAILURE.NOT_CONNECTED },
    });
    assert.deepEqual(repositories, {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { repositories: [{ owner: "acme", name: "relay", private: true }], truncated: false },
    });
    assert.deepEqual(f.asked, ["refresh", `open:${PLAN_ID}`, "start:acme/relay", "repositories"]);
  }),
);

it.effect("no window but the planning window reaches the plans", () =>
  Effect.gen(function* () {
    const f = fixture();

    for (const sender of [PANEL, VOICE, INTRODUCTION]) {
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

it.effect("only a panel's entry opens the planning window", () =>
  Effect.gen(function* () {
    const f = fixture();

    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_OPEN_WINDOW }, PANEL);
    const fromVoice = yield* f.router.performAct({ kind: ACT_KIND.PLANNING_OPEN_WINDOW }, VOICE);
    const fromTakeover = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_OPEN_WINDOW },
      INTRODUCTION,
    );

    assert.equal(f.opened(), 1);
    assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
    assert.equal(fromTakeover.status, ACT_OUTCOME_STATUS.REFUSED);
  }),
);

it.effect("Connect GitHub says the connection is not available until its flow lands", () =>
  Effect.gen(function* () {
    const f = fixture();

    const connected = yield* f.router.performAct(
      { kind: ACT_KIND.PLANNING_CONNECT_GITHUB },
      PLANNING,
    );

    assert.deepEqual(connected, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: GITHUB_CONNECTION_PENDING,
    });
  }),
);
