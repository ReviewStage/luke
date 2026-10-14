import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { runModeFor } from "@sidecar/host";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Context, Effect } from "effect";
import type { WebContents } from "electron";
import { ACT_KIND } from "#shared/messages/acts";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS } from "#shared/messages/avatar";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { AppStateStore, initialAppState } from "../app-state";
import { avatarActRows } from "./avatar-acts";

/** What the document is composed from; the avatar row reads none of it. */
const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0",
  packaged: false,
  platform: "darwin",
} as const;

const ROLE = { PANEL: "panel", VOICE: "voice", CALL: "call" } as const;

type Role = (typeof ROLE)[keyof typeof ROLE];

function fixture() {
  const state = new AppStateStore(initialAppState(RUN, false), Context.empty());
  // SAFETY: only the avatar row is under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(avatarActRows({ state }) as ActRows);
  const senderOf = (role: Role): ActSender => ({
    // SAFETY: the row reads the sender's standing, never the contents itself.
    sender: {} as WebContents,
    panel: role === ROLE.PANEL,
    voice: role === ROLE.VOICE,
    call: role === ROLE.CALL,
  });
  const report = (role: Role, payload: UnparsedWireValue) => {
    // SAFETY: a window's act crosses as a structured-clone value, which the router reads again.
    const act = { kind: ACT_KIND.AVATAR_REPORT, payload } as Parameters<
      typeof router.performAct
    >[0];
    return router.performAct(act, senderOf(role));
  };
  return { state, report };
}

it.effect("the call window's report is the avatar every window reads", () =>
  Effect.gen(function* () {
    const f = fixture();
    const live = yield* f.report(ROLE.CALL, { status: AVATAR_STATUS.LIVE });
    assert.equal(live.status, "done");
    assert.deepEqual(f.state.snapshot().voice.avatar, { status: AVATAR_STATUS.LIVE });
    yield* f.report(ROLE.CALL, {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.SERVER_CLOSED,
    });
    assert.deepEqual(f.state.snapshot().voice.avatar, {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.SERVER_CLOSED,
    });
  }),
);

it.effect("a panel's or the voice window's report is refused and writes nothing", () =>
  Effect.gen(function* () {
    const f = fixture();
    for (const role of [ROLE.PANEL, ROLE.VOICE]) {
      const outcome = yield* f.report(role, { status: AVATAR_STATUS.LIVE });
      assert.equal(outcome.status, "refused");
    }
    assert.deepEqual(f.state.snapshot().voice.avatar, AVATAR_OFF);
  }),
);

it.effect("a reason beside any status but ENDED, or ENDED without one, is refused", () =>
  Effect.gen(function* () {
    const f = fixture();
    const cases = [
      { status: AVATAR_STATUS.LIVE, endReason: AVATAR_END_REASON.ERROR },
      { status: AVATAR_STATUS.ENDED },
      { status: AVATAR_STATUS.ENDED, endReason: "bored" },
      { status: "paused" },
    ];
    for (const payload of cases) {
      assert.equal((yield* f.report(ROLE.CALL, payload)).status, "refused");
    }
    assert.deepEqual(f.state.snapshot().voice.avatar, AVATAR_OFF);
  }),
);
