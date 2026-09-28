import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
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
const REQUEST = { name: "Teammate invitations", repository: { owner: "acme", name: "relay" } };

/** The plan the host has open, as the fixture's main process reads it. */
interface OpenPlan {
  activePlanId: string | undefined;
}

function fixture() {
  const asked: string[] = [];
  const talked: string[] = [];
  const gones = new Map<WebContents, Effect.Effect<void>>();
  const view: OpenPlan = { activePlanId: PLAN_ID };
  const account = { signedIn: true };
  const rows = planningActRows({
    host: {
      planningRefresh: () => Effect.sync(() => void asked.push("refresh")),
      planningPause: () => Effect.sync(() => void asked.push("pause")),
      planningClose: () => Effect.sync(() => void asked.push("close")),
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
      planningConnectGitHub: () =>
        Effect.sync(() => {
          asked.push("connect");
          return account.signedIn;
        }),
    },
    activePlanId: () => view.activePlanId,
    talkAboutPlan: (planId) => {
      talked.push(planId);
    },
    whenGone: (sender, gone) => {
      gones.set(sender, gone);
    },
  });
  // SAFETY: only the planning rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, view, account, gones };
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
    yield* f.router.performAct({ kind: ACT_KIND.PLANNING_PAUSE }, PANEL);

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
      "start:acme/relay",
      "repositories",
      "close",
      "pause",
    ]);
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
  "the follow pauses only once no panel shows the Plans tab, a destroyed panel included",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      // SAFETY: a second inert object, so the rows read two panels on two displays.
      const other: ActSender = { ...PANEL, sender: {} as WebContents };

      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REFRESH }, PANEL);
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_REFRESH }, other);
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_PAUSE }, PANEL);
      assert.deepEqual(f.asked, ["refresh", "refresh"]);

      // The other display's panel goes away while it still shows the tab.
      const gone = f.gones.get(other.sender);
      assert.ok(gone);
      yield* gone;
      assert.deepEqual(f.asked, ["refresh", "refresh", "pause"]);
      // A pause from a panel that no longer counts asks for nothing more.
      yield* f.router.performAct({ kind: ACT_KIND.PLANNING_PAUSE }, PANEL);
      assert.deepEqual(f.asked, ["refresh", "refresh", "pause"]);
    }),
);
