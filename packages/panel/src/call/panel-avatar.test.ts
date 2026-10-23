// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, NO_EXPERIMENTS } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { AVATAR_STATUS } from "@luke/voice/avatar";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { afterEach, test } from "vitest";
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
import "./call-avatar.js";
import { panelAvatarAtom } from "./panel-avatar.js";

/**
 * panel-avatar.test.ts -- the avatar the panel's root mounts: run over the grant main hands only while the account has Video calls on, the grant handed before the avatar's code has landed included, and nothing at all while it is off.
 */

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar.example.test",
  participantToken: "participant-token-never-printed",
  agentIdentity: "keyframe-agent",
};

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
async function mountedRoot(experiments: Parameters<typeof handState>[0]) {
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
  unmount = AtomRegistry.make().mount(panelAvatarAtom);
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
