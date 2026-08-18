import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_FORM_FACTOR, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/core";
import {
  armErrand,
  EMPTY_ERRAND_RUN,
  type ErrandHold,
  type ErrandRun,
  errandBorrowedPanel,
  errandRunIdle,
  errandWait,
  finishErrand,
  flushErrands,
  foldErrandHolds,
  landErrand,
  NOTHING_HELD,
  nextErrand,
  type PendingErrand,
  supersedeErrandSettings,
} from "../src/renderer/errand-queue";
import { ERRAND_TARGET, ERRAND_WAIT } from "../src/renderer/luke-errand";
import { APP_SETTING_ID } from "../src/renderer/luke-guide";
import { PANEL_TAB } from "../src/renderer/panel-tabs";
import { SESSION_FILTER, SESSION_SORT } from "../src/renderer/session-model";
import { SETTINGS_VIEW } from "../src/renderer/settings-views";
import type { AppSettings } from "../src/shared/contracts";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../src/shared/contracts";
import { CREDENTIAL_PROVIDER_ID } from "../src/shared/credential-providers";

/** A settings snapshot, told apart from the next only by the switch that moved. */
function settings(captions: boolean): AppSettings {
  return {
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.COPILOT]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.CURSOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.DEVIN]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.JULES]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
    },
    secretStorage: SECRET_STORAGE.UNKNOWN,
    showInDock: false,
    voice: REALTIME_VOICE.CEDAR,
    voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
    voiceCaptions: captions,
    duckOtherMedia: true,
    quietDuringMeetings: true,
    calendarSignInAvailable: false,
    calendarAccounts: [],
    showOnAllDisplays: false,
    formFactor: PANEL_FORM_FACTOR.BUBBLE,
  };
}

/** A settings change, as the carrier arms one. */
function settingAct(
  target: PendingErrand["targets"][number],
  page: PendingErrand["page"],
  hold: ErrandHold,
  opening = false,
): PendingErrand {
  return {
    targets: [target],
    tab: PANEL_TAB.SETTINGS,
    ...(page === undefined ? {} : { page }),
    opening,
    borrowsPanel: true,
    hold,
  };
}

/** Arms every act of one reply, in the order the calls were answered. */
function run(...acts: readonly PendingErrand[]): ErrandRun {
  return acts.reduce(armErrand, EMPTY_ERRAND_RUN);
}

const CAPTIONS_ON = settings(true);
const CAPTIONS_OFF = settings(false);

test("a second act waits its turn rather than taking the first out of the air", () => {
  const first = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, {
    settings: CAPTIONS_ON,
  });
  const second = settingAct(APP_SETTING_ID.SHOW_IN_DOCK, SETTINGS_VIEW.APPEARANCE, {
    settings: CAPTIONS_OFF,
  });

  const armed = nextErrand(run(first, second));
  assert.equal(armed.launch, first);
  assert.equal(armed.run.flying, first);

  // While one is out, nothing else is handed to the flight. A second errand
  // handed over here re-identifies the one in the air,
  // which ends it before it has left the strip.
  const overtaking = nextErrand(armed.run);
  assert.equal(overtaking.launch, undefined);
  assert.equal(overtaking.run.flying, first);
  assert.deepEqual(overtaking.run.waiting, [second]);
});

test("each act's change is drawn on its own tap, and never on another's", () => {
  const first = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, {
    settings: CAPTIONS_ON,
  });
  const second = settingAct(APP_SETTING_ID.SHOW_IN_DOCK, SETTINGS_VIEW.APPEARANCE, {
    settings: CAPTIONS_OFF,
  });

  const flying = nextErrand(run(first, second)).run;
  const landed = landErrand(flying);
  assert.deepEqual(landed.hold, { settings: CAPTIONS_ON });
  // The act still waiting is still holding: its switch does not move until
  // Luke reaches it either.
  assert.deepEqual(landed.run.waiting, [second]);

  // The tap released it, so the end of that same flight draws it no second
  // time — a hold drawn twice would re-apply a snapshot the next act's write
  // has already superseded.
  const finished = finishErrand(landed.run);
  assert.deepEqual(finished.hold, NOTHING_HELD);
  assert.equal(finished.run.flying, undefined);

  const next = nextErrand(finished.run);
  assert.equal(next.launch, second);
  assert.deepEqual(landErrand(next.run).hold, { settings: CAPTIONS_OFF });
});

test("a flight that never reached its control still draws what it was holding", () => {
  // No tap landed, so nothing was released — and a hold nobody releases leaves
  // a switch showing the wrong state for as long as the panel is open.
  const only = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, {
    settings: CAPTIONS_ON,
  });
  const finished = finishErrand(nextErrand(run(only)).run);
  assert.deepEqual(finished.hold, { settings: CAPTIONS_ON });
  assert.ok(errandRunIdle(finished.run));
});

test("a panel that has gone draws everything the run was still holding", () => {
  const flying = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, {
    settings: CAPTIONS_ON,
  });
  const waiting = settingAct(APP_SETTING_ID.SHOW_IN_DOCK, SETTINGS_VIEW.APPEARANCE, {
    settings: CAPTIONS_OFF,
  });
  const flushed = flushErrands(nextErrand(run(flying, waiting)).run);

  // The snapshots are cumulative, so the newest is the only true one.
  assert.deepEqual(flushed.hold, { settings: CAPTIONS_OFF });
  assert.ok(errandRunIdle(flushed.run));
});

test("holds folded together keep the last snapshot and every part of the view", () => {
  assert.deepEqual(
    foldErrandHolds([
      { settings: CAPTIONS_ON, view: { filter: SESSION_FILTER.CLOUD } },
      { view: { sort: SESSION_SORT.RECENCY } },
      { settings: CAPTIONS_OFF },
    ]),
    {
      settings: CAPTIONS_OFF,
      view: { filter: SESSION_FILTER.CLOUD, sort: SESSION_SORT.RECENCY },
    },
  );
  assert.deepEqual(foldErrandHolds([]), NOTHING_HELD);
  assert.deepEqual(foldErrandHolds([NOTHING_HELD, NOTHING_HELD]), NOTHING_HELD);
});

test("a settings push takes every held snapshot with it and leaves the held view", () => {
  const flying = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, {
    settings: CAPTIONS_ON,
  });
  const narrowing: PendingErrand = {
    targets: [ERRAND_TARGET.LIST_OPTIONS, ERRAND_TARGET.SESSIONS_TAB],
    tab: PANEL_TAB.SESSIONS,
    opening: false,
    borrowsPanel: false,
    hold: { view: { filter: SESSION_FILTER.CLOUD } },
  };
  const waiting = settingAct(APP_SETTING_ID.SHOW_IN_DOCK, SETTINGS_VIEW.APPEARANCE, {
    settings: CAPTIONS_OFF,
  });

  const superseded = supersedeErrandSettings(nextErrand(run(flying, narrowing, waiting)).run);

  // Another window's push is newer than anything caught before it arrived.
  assert.deepEqual(landErrand(superseded).hold, NOTHING_HELD);
  // The list is this window's own choice, and no other window said anything
  // about it.
  assert.deepEqual(
    superseded.waiting.map((pending) => pending.hold),
    [{ view: { filter: SESSION_FILTER.CLOUD } }, NOTHING_HELD],
  );
});

test("an act with nowhere to land leaves the run to the next one", () => {
  // The guide's ids travel as plain text, so an act can name a control this
  // build does not draw. It is over the moment it is taken up.
  const nowhere: PendingErrand = {
    targets: [],
    tab: PANEL_TAB.SETTINGS,
    opening: false,
    borrowsPanel: true,
    hold: { settings: CAPTIONS_ON },
  };
  const second = settingAct(APP_SETTING_ID.SHOW_IN_DOCK, SETTINGS_VIEW.APPEARANCE, {
    settings: CAPTIONS_OFF,
  });

  const taken = nextErrand(run(nowhere, second));
  assert.deepEqual(taken.launch?.targets, []);
  const finished = finishErrand(taken.run);
  assert.deepEqual(finished.hold, { settings: CAPTIONS_ON });
  assert.equal(nextErrand(finished.run).launch, second);
});

test("the run is idle only once there is nothing in the air and nothing waiting", () => {
  const only = settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, NOTHING_HELD);
  assert.equal(errandRunIdle(EMPTY_ERRAND_RUN), true);
  assert.equal(errandRunIdle(run(only)), false);
  const flying = nextErrand(run(only)).run;
  assert.equal(errandRunIdle(flying), false);
  assert.equal(errandRunIdle(finishErrand(flying).run), true);
});

test("a panel asked for out loud is nobody's to take away afterwards", () => {
  const shows = (opening: boolean): PendingErrand => ({
    targets: [ERRAND_TARGET.SESSIONS_TAB],
    tab: PANEL_TAB.SESSIONS,
    opening,
    borrowsPanel: false,
    hold: NOTHING_HELD,
  });
  const changes = (opening: boolean): PendingErrand =>
    settingAct(APP_SETTING_ID.VOICE_CAPTIONS, SETTINGS_VIEW.VOICE, NOTHING_HELD, opening);

  // A switch has to be seen moving, so a settings change borrows the panel and
  // gives it back — but only the one it stood up itself.
  assert.equal(errandBorrowedPanel(false, changes(true)), true);
  assert.equal(errandBorrowedPanel(false, changes(false)), false);

  // A second settings act finds the panel already open, so its own opening is
  // false. It must not answer "no" on the first act's behalf: the close the
  // first one is owed still has to happen, and only once the run is done.
  assert.equal(errandBorrowedPanel(true, changes(false)), true);

  // The panel someone asked for out loud is the answer itself, so it stays —
  // and it stays even when an earlier settings act is what stood it up, which
  // is the whole of this rule.
  assert.equal(errandBorrowedPanel(true, shows(false)), false);
  assert.equal(errandBorrowedPanel(false, shows(true)), false);
});

test("a flight waits only when it had to open the panel", () => {
  assert.equal(errandWait(true), ERRAND_WAIT.CONTENT);
  assert.equal(errandWait(false), ERRAND_WAIT.AT_ONCE);
});
