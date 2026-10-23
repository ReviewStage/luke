// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, NO_EXPERIMENTS } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { AVATAR_END_REASON, AVATAR_STATUS } from "@luke/voice/avatar";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, test } from "vitest";
import { rendererRuntime } from "../renderer-runtime.js";
import {
  fakeActPortAnswering,
  fakeAppBridge,
  fakeAppBridgeCalls,
  type SentPortAct,
} from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
// Note that the avatar's session is loaded as the panel loads it, once Video
// calls is on (`bundle-loader.ts`), so the module is read here first and its
// load settles within the test's own ticks.
import { callAvatarAtom } from "./call-avatar.js";
import { panelAvatarAtom, panelAvatarOf } from "./panel-avatar.js";

/**
 * panel-avatar.test.ts -- the avatar the panel's root mounts: run over the grant main hands only while the account has Video calls on, the grant handed before the avatar's code has landed included, and nothing at all while it is off; where its code cannot be read, each grant is reported ended in error and reads it again.
 */

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.example.test",
  participantToken: "participant-token-never-printed",
  agentIdentity: "keyframe-agent",
};

const SECOND_GRANT: AvatarGrant = { ...GRANT, participantToken: "second-token-never-printed" };

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 24; tick += 1) await Promise.resolve();
}

/** The panel's root as the desktop's entry mounts it, on a window whose account has `experiments` on; answers how main is handed a grant and what the panel told main of its avatar. */
async function mountedRoot(
  experiments: Parameters<typeof handState>[0],
  avatar: typeof panelAvatarAtom = panelAvatarAtom,
) {
  const grants: Array<(grant: AvatarGrant | undefined) => void> = [];
  const reports: SentPortAct[] = [];
  handState(experiments);
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAvatarSession: (deliver) => {
      grants.push(deliver);
      return () => grants.splice(grants.indexOf(deliver), 1);
    },
    onAvatarFeed: () => () => undefined,
  });
  fakeActPortAnswering((request) => {
    if (request.kind === ACT_KIND.AVATAR_REPORT) reports.push(request);
    return Promise.resolve(undefined);
  });
  unmount = AtomRegistry.make().mount(avatar);
  const hand = async (grant: AvatarGrant | undefined) => {
    for (const deliver of grants) deliver(grant);
    await settle();
  };
  return { hand, reports };
}

test("with Video calls off the grant is held but no avatar runs, so main is told nothing", async () => {
  const root = await mountedRoot(NO_EXPERIMENTS);
  await root.hand(GRANT);
  assert.deepEqual(root.reports, []);
});

test("with Video calls on the grant main hands as the page first draws starts the avatar once its code lands", async () => {
  const root = await mountedRoot(experimentsOn(EXPERIMENT.VIDEO_CALLS));
  await root.hand(GRANT);
  assert.deepEqual(root.reports[0], {
    kind: ACT_KIND.AVATAR_REPORT,
    payload: { status: AVATAR_STATUS.STARTING },
  });
});

test("where the avatar's code cannot be read each grant is reported ended in error, and the next grant reads it again", async () => {
  let loads = false;
  const reread = () =>
    loads ? Promise.resolve(callAvatarAtom) : Promise.reject(new Error("Not landed."));
  const bundle = rendererRuntime.atom(
    Effect.tryPromise({ try: reread, catch: () => new Error("Not landed.") }),
  );
  const root = await mountedRoot(
    experimentsOn(EXPERIMENT.VIDEO_CALLS),
    panelAvatarOf(bundle, reread),
  );
  await root.hand(GRANT);
  assert.deepEqual(root.reports, [
    {
      kind: ACT_KIND.AVATAR_REPORT,
      payload: { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
    },
  ]);
  loads = true;
  await root.hand(SECOND_GRANT);
  assert.deepEqual(root.reports[1], {
    kind: ACT_KIND.AVATAR_REPORT,
    payload: { status: AVATAR_STATUS.STARTING },
  });
});
