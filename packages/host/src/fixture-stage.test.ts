import assert from "node:assert/strict";
import { AVATAR_STATUS, avatarStanding } from "@luke/voice/avatar";
import { callInProgress } from "@luke/voice/voice-view";
import { it } from "vitest";
import { RUN_PROFILE } from "./app-state.js";
import { initialAppState } from "./client/app-state-store.js";
import { callStaged, FIXTURE_IDS, FIXTURE_PAGE, fixturePage } from "./fixture-stage.js";
import { runModeFor } from "./run-mode.js";

/**
 * fixture-stage.test.ts -- a call profile's fixture run opens on a call into
 * the fixture's agent, its avatar down or standing, which every window draws
 * and the floating call window stands for, and a fixture run's page frames
 * read the fixture's page; a live run, and any other profile, stage nothing.
 */

/** A launch's own facts under `profile`, a fixture run or a live one. */
function launched(profile: string, fixtureMode: boolean) {
  return initialAppState(
    {
      launch: { profile, captureMode: false, fixtureMode },
      runMode: runModeFor({ capture: false, fixture: fixtureMode }),
      appVersion: "1.2.3",
      packaged: true,
      platform: "darwin",
    },
    true,
    [],
  );
}

it("a call profile's fixture run opens on a call into the fixture's agent, video off or on", () => {
  const off = launched(RUN_PROFILE.AGENT_CALL, true);
  const on = launched(RUN_PROFILE.AGENT_CALL_VIDEO, true);
  const view = off.voice.view;

  assert.ok(view !== undefined && callInProgress(view));
  assert.deepEqual(view.call, { agentId: FIXTURE_IDS.AGENT, taskId: FIXTURE_IDS.TASK });
  assert.equal(avatarStanding(off.voice.avatar), false);
  assert.equal(on.voice.avatar.status, AVATAR_STATUS.LIVE);
  assert.ok((off.callTranscript?.lines.length ?? 0) > 0, "what was said on the call stands");
  assert.equal(callStaged({ profile: RUN_PROFILE.AGENT_CALL_VIDEO, fixtureMode: true }), true);
});

it("a live run, and a fixture run under any other profile, opens on no call", () => {
  assert.equal(launched(RUN_PROFILE.AGENT_CALL, false).voice.view, undefined);
  assert.equal(launched(RUN_PROFILE.AGENT_PULL_REQUEST, true).voice.view, undefined);
  assert.equal(launched(RUN_PROFILE.AGENT_PULL_REQUEST, true).callTranscript, undefined);
  assert.equal(callStaged({ profile: RUN_PROFILE.AGENT_CALL, fixtureMode: false }), false);
});

it("a fixture run's page frame reads the fixture's page by its id and version, and nothing else", () => {
  const read = fixturePage({
    taskId: FIXTURE_IDS.TASK,
    pageId: FIXTURE_PAGE.id,
    version: FIXTURE_PAGE.version,
  });
  const older = fixturePage({ taskId: FIXTURE_IDS.TASK, pageId: FIXTURE_PAGE.id, version: 1 });

  assert.ok("page" in read && read.page.html.includes("<h1>Invite funnel</h1>"));
  assert.ok("failure" in older);
});
