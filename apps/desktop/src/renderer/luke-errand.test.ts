import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  type AppGuideSetting,
  SESSION_LIST_SORT,
} from "@sidecar/guide";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED, SESSION_LIST_ALL } from "@sidecar/realtime";
import { PANEL_FORM_FACTOR } from "@sidecar/surface";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "#shared/wire/account";
import type { AppSettingsView } from "#shared/wire/settings";
import { APP_SETTING_DEFAULTS, VOICE_SOURCE } from "#shared/wire/settings";
import { UPDATE_STATUS } from "#shared/wire/update";
import {
  captionRoom,
  ERRAND_TARGET,
  ERRAND_WAIT,
  type ErrandJourney,
  type ErrandTokens,
  errandBeats,
  errandBound,
  errandDrift,
  errandFlies,
  errandJourney,
  errandScrollTop,
  errandSettledBound,
  errandTargets,
  tabErrandTarget,
} from "./luke-errand";
import { APP_SETTING_ID, buildLukeGuide, isAppSettingId, type LukeGuideInput } from "./luke-guide";
import { SETTING_PAGE, SETTINGS_PAGE_LABEL } from "./settings-views";

function settings(): AppSettingsView {
  return {
    ...APP_SETTING_DEFAULTS,
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
    },
    secretStorage: SECRET_STORAGE.UNKNOWN,
    showInDock: false,
    voice: REALTIME_VOICE.CEDAR,
    voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
    voiceCaptions: false,
    duckOtherMedia: true,
    quietDuringMeetings: true,
    announceSessions: true,
    calendarSignInAvailable: false,
    linearSignInAvailable: false,
    appleCalendarAvailable: false,
    voiceAvailable: false,
    voiceSource: VOICE_SOURCE.ACCOUNT,
    preferBuiltInMicrophone: false,
    calendarAccounts: [],
    showOnAllDisplays: false,
    formFactor: PANEL_FORM_FACTOR.BUBBLE,
  };
}

const guideInput: LukeGuideInput = {
  settings: settings(),
  update: {
    status: UPDATE_STATUS.IDLE,
    currentVersion: "0.3.8",
    installSupported: true,
    upToDate: false,
  },
  voiceAvailable: true,
  microphoneStatus: "granted",
  hotkey: { hotkey: "⌥Space", held: true },
  askKey: "⌥L",
};

function guideSetting(id: string): AppGuideSetting {
  const setting = buildLukeGuide(guideInput).settings.find((candidate) => candidate.id === id);
  assert.ok(setting, `the guide lists ${id}`);
  return setting;
}

test("a settings change is signed on the control that setting names", () => {
  assert.deepEqual(
    errandTargets({
      kind: "setting",
      setting: guideSetting(APP_SETTING_ID.VOICE_CAPTIONS),
      value: "on",
    }),
    [APP_SETTING_ID.VOICE_CAPTIONS],
  );
});

test("every setting a spoken ask may change has somewhere to be signed", () => {
  for (const setting of buildLukeGuide(guideInput).settings) {
    if (!setting.adjustable) continue;
    assert.deepEqual(
      errandTargets({ kind: "setting", setting, value: setting.value }),
      [setting.id],
      `${setting.id} has a landing place`,
    );
  }
});

test("a setting the guide never listed is signed nowhere", () => {
  const setting: AppGuideSetting = {
    id: "invented",
    label: "Invented",
    description: "",
    kind: APP_SETTING_KIND.TOGGLE,
    value: "on",
    adjustable: true,
    manual: "nowhere",
  };
  assert.deepEqual(errandTargets({ kind: "setting", setting, value: "on" }), []);
});

test("showing a tab is signed on that tab", () => {
  assert.deepEqual(errandTargets({ kind: "panel", tab: APP_PANEL_TAB.SESSIONS }), [
    ERRAND_TARGET.SESSIONS_TAB,
  ]);
  assert.deepEqual(errandTargets({ kind: "panel", tab: APP_PANEL_TAB.HISTORY }), [
    ERRAND_TARGET.HISTORY_TAB,
  ]);
  assert.deepEqual(errandTargets({ kind: "panel", tab: APP_PANEL_TAB.SETTINGS }), [
    ERRAND_TARGET.SETTINGS_TAB,
  ]);
  // The record behind it is exhaustive over the tabs a spoken ask can name.
  assert.equal(tabErrandTarget(APP_PANEL_TAB.SETTINGS), ERRAND_TARGET.SETTINGS_TAB);
});

test("a narrowing or a re-ordering is signed on the control that carries it", () => {
  // The options control says how the list is being shown, so it comes first —
  // and it is only drawn beside a list with something to choose between, which
  // is why the tab stands behind it rather than instead of it.
  assert.deepEqual(
    errandTargets({ kind: "panel", tab: APP_PANEL_TAB.SESSIONS, filters: ["cloud"] }),
    [ERRAND_TARGET.LIST_OPTIONS, ERRAND_TARGET.SESSIONS_TAB],
  );
  assert.deepEqual(
    errandTargets({
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      sort: SESSION_LIST_SORT.RECENCY,
    }),
    [ERRAND_TARGET.LIST_OPTIONS, ERRAND_TARGET.SESSIONS_TAB],
  );
});

test("asking for the whole list back is signed on the X that clears it by hand", () => {
  // The X is only drawn while a selection stands — asking for everything when
  // everything is already shown leaves nothing to clear — so the options
  // control and the tab stand behind it rather than nowhere.
  assert.deepEqual(
    errandTargets({ kind: "panel", tab: APP_PANEL_TAB.SESSIONS, filters: [SESSION_LIST_ALL] }),
    [ERRAND_TARGET.LIST_CLEAR, ERRAND_TARGET.LIST_OPTIONS, ERRAND_TARGET.SESSIONS_TAB],
  );
});

test("a search is signed on the magnifier, ahead of whatever else the ask changed", () => {
  assert.deepEqual(errandTargets({ kind: "panel", tab: APP_PANEL_TAB.SESSIONS, query: "parser" }), [
    ERRAND_TARGET.LIST_SEARCH,
    ERRAND_TARGET.SESSIONS_TAB,
  ]);
  // One ask can search and narrow at once; one flight signs it, on the control
  // whose change is loudest, with the others standing behind in case the
  // magnifier is not drawn.
  assert.deepEqual(
    errandTargets({
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["cloud"],
      query: "parser",
    }),
    [ERRAND_TARGET.LIST_SEARCH, ERRAND_TARGET.LIST_OPTIONS, ERRAND_TARGET.SESSIONS_TAB],
  );
});

test("a rejected act is signed nowhere", () => {
  assert.deepEqual(errandTargets({ status: "rejected", reason: "No such tool exists." }), []);
});

test("the flight starts on the face and lands centred on the control", () => {
  const journey = errandJourney(
    { left: 0, top: 0, width: 1000, height: 600 },
    { left: 480, top: 8, width: 18, height: 18 },
    { left: 300, top: 200, width: 34, height: 20 },
  );

  assert.deepEqual(journey.from, { x: 480, y: 8 });
  assert.deepEqual(journey.to, { x: 308, y: 201 });
  assert.deepEqual(journey.size, { width: 18, height: 18 });
});

test("a stage offset from the viewport is subtracted out of every reading", () => {
  const journey = errandJourney(
    { left: 40, top: 12, width: 1000, height: 600 },
    { left: 480, top: 20, width: 18, height: 18 },
    { left: 300, top: 200, width: 18, height: 18 },
  );

  assert.deepEqual(journey.from, { x: 440, y: 8 });
  assert.deepEqual(journey.to, { x: 260, y: 188 });
});

const TOKENS: ErrandTokens = {
  surfaceMs: 460,
  quick: 140,
  exit: 90,
  expand: 200,
  stagger: 32,
  fanLimit: 5,
};

test("the flight is out, a beat, and back, all measured off the tokens", () => {
  const beats = errandBeats(TOKENS, ERRAND_WAIT.AT_ONCE);

  assert.equal(beats.duration, 460 * 2 + 140);
  // He reaches the control after one shape's travel and leaves after the beat.
  assert.equal(beats.arrival * beats.duration, 460);
  assert.equal(beats.departure * beats.duration, 600);
  // He is back on the face's own box an exit's worth before the end, which is
  // the window the face fades back in under him: the handover needs a stretch
  // where both are drawn in the same place rather than an instant where the
  // one is swapped for the other.
  assert.equal(Math.round((1 - beats.home) * beats.duration), 90);
  assert.ok(beats.home > beats.departure);
  // A panel already open owes the errand no wait beyond a beat.
  assert.equal(beats.delay, TOKENS.quick);
});

test("an errand that opened the panel trails the whole opening", () => {
  // The shape's travel plus the delay and stagger its content arrives on: an
  // errand setting off inside that would cross a surface still growing.
  assert.equal(errandBeats(TOKENS, ERRAND_WAIT.CONTENT).delay, 200 + 32 * 5 + 460);
});

test("an errand crossing an instant page swap waits for the black surface", () => {
  assert.equal(errandBeats(TOKENS, ERRAND_WAIT.SURFACE).delay, TOKENS.surfaceMs);
});

/** The window, and the black drawn in the middle of it: a 620-wide open panel. */
const STAGE = { left: 0, top: 0, width: 1512, height: 600 };
const SURFACE = { left: 446, top: 0, width: 620, height: 520 };

/** The way home for a control below and to the right of the strip's face. */
function homeward(target = { left: 960, top: 300, width: 34, height: 20 }) {
  const beats = errandBeats(TOKENS, ERRAND_WAIT.AT_ONCE);
  const journey = errandJourney(STAGE, { left: 747, top: 9, width: 18, height: 18 }, target);
  return { journey, beats, drift: errandDrift(journey, beats, errandBound(STAGE, SURFACE)) };
}

/** How far off the straight run back a point of the drift sits. */
function swayAt(journey: ErrandJourney, point: { x: number; y: number }): number {
  const run = { x: journey.from.x - journey.to.x, y: journey.from.y - journey.to.y };
  const distance = Math.hypot(run.x, run.y);
  return Math.abs(run.x * (point.y - journey.to.y) - run.y * (point.x - journey.to.x)) / distance;
}

/** Whether a point of the flight is drawn entirely on the black. */
function onTheBlack(point: { x: number; y: number }, size: { width: number; height: number }) {
  return (
    point.x >= SURFACE.left &&
    point.x + size.width <= SURFACE.left + SURFACE.width &&
    point.y >= SURFACE.top &&
    point.y + size.height <= SURFACE.top + SURFACE.height
  );
}

test("the float leaves the control and reaches the strip on the line itself", () => {
  const { journey, beats, drift } = homeward();
  const first = drift.at(0);
  const last = drift.at(-1);
  assert.ok(first && last);

  // The sway is zero at both ends, so the drift joins the straight run without
  // a corner at either — he leaves the control on the line and arrives on it.
  assert.deepEqual(first.point, journey.to);
  assert.ok(Math.abs(last.point.x - journey.from.x) < 1e-9);
  assert.ok(Math.abs(last.point.y - journey.from.y) < 1e-9);

  // The steps span exactly the way home, in order.
  assert.equal(first.offset, beats.departure);
  assert.equal(last.offset, beats.home);
  for (let index = 1; index < drift.length; index += 1) {
    const step = drift[index];
    const previous = drift[index - 1];
    assert.ok(step && previous && step.offset > previous.offset, "offsets only ever rise");
  }
});

test("the float is a gentle bow, never a manoeuvre", () => {
  const { journey, drift } = homeward();
  const sways = drift.map((step) => swayAt(journey, step.point));
  const widest = Math.max(...sways);

  // Wide enough not to be a ruled line, and nothing like the excursion a loop
  // would make: this is a drift out of the way, not a shape worth watching.
  assert.ok(widest > journey.size.width / 2, "the way home is not a ruled line");
  assert.ok(widest < journey.size.width * 3, "and it is not a manoeuvre either");

  // It never doubles back on itself: every step is further along the run than
  // the one before, which is what separates a drift from a loop.
  const run = { x: journey.from.x - journey.to.x, y: journey.from.y - journey.to.y };
  const distance = Math.hypot(run.x, run.y);
  const alongRun = drift.map(
    (step) =>
      ((step.point.x - journey.to.x) * run.x + (step.point.y - journey.to.y) * run.y) / distance,
  );
  for (let index = 1; index < alongRun.length; index += 1) {
    assert.ok((alongRun[index] ?? 0) > (alongRun[index - 1] ?? 0), "he only ever heads home");
  }

  // And he eases off the control and onto the strip rather than crossing at one
  // speed: the first and last steps cover less ground than the middle ones.
  const strides = alongRun.slice(1).map((reach, index) => reach - (alongRun[index] ?? 0));
  const middle = strides[Math.floor(strides.length / 2)] ?? 0;
  assert.ok((strides.at(0) ?? 0) < middle, "he lifts off rather than snapping away");
  assert.ok((strides.at(-1) ?? 0) < middle, "and settles rather than arriving at speed");
});

test("the float leans toward the strip rather than out over the desktop", () => {
  // A control right of the face sends him home leftward, so the bow leans left
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // as well: leaning right would carry it toward the panel's edge.
  const rightward = homeward();
  assert.ok(rightward.journey.from.x < rightward.journey.to.x);
  const widest = rightward.drift.reduce((furthest, step) =>
    swayAt(rightward.journey, step.point) > swayAt(rightward.journey, furthest.point)
      ? step
      : furthest,
  );
  assert.ok(widest.point.x < rightward.journey.to.x);

  // And the mirror image leans the other way.
  const leftward = homeward({ left: 500, top: 300, width: 34, height: 20 });
  const mirrored = leftward.drift.reduce((furthest, step) =>
    swayAt(leftward.journey, step.point) > swayAt(leftward.journey, furthest.point)
      ? step
      : furthest,
  );
  assert.ok(mirrored.point.x > leftward.journey.to.x);
});

test("no point of the float is ever drawn past the edge of the black", () => {
  // Every corner the panel has, including the ones with no room to lean into:
  // the shape is what bounds the sway, so a control tucked against an edge
  // gets whatever drift fits rather than one drawn onto the desktop.
  const corners = [
    { left: 456, top: 60, width: 34, height: 20 },
    { left: 1022, top: 60, width: 34, height: 20 },
    { left: 456, top: 490, width: 34, height: 20 },
    { left: 1022, top: 490, width: 34, height: 20 },
    { left: 960, top: 300, width: 34, height: 20 },
    { left: 500, top: 120, width: 34, height: 20 },
  ];
  for (const corner of corners) {
    const { journey, drift } = homeward(corner);
    assert.ok(drift.length > 0, `a control at ${corner.left},${corner.top} still has a way home`);
    for (const step of drift) {
      assert.ok(
        onTheBlack(step.point, journey.size),
        `a step at ${step.point.x.toFixed(1)},${step.point.y.toFixed(1)} stays on the black`,
      );
    }
  }
});

test("a control drawn where the face already is has no way home to float", () => {
  const face = { left: 747, top: 9, width: 18, height: 18 };
  const journey = errandJourney(STAGE, face, face);
  assert.deepEqual(
    errandDrift(journey, errandBeats(TOKENS, ERRAND_WAIT.AT_ONCE), errandBound(STAGE, SURFACE)),
    [],
  );
});

test("tokens held still leave no flight to run", () => {
  assert.equal(errandFlies(TOKENS), true);
  // What a capture run zeroes, so every PNG lands on the same frame.
  assert.equal(errandFlies({ ...TOKENS, surfaceMs: 0, quick: 0, exit: 0, expand: 0 }), false);
  // What reduced motion collapses to. The three durations still sum past the
  // stillness floor, which is exactly why the flight is decided on the shape
  // token rather than on the total: someone who asked for no motion must not
  // get a face crossing the panel in three milliseconds.
  assert.equal(errandFlies({ ...TOKENS, surfaceMs: 1, quick: 1, exit: 1 }), false);
});

test("every setting is signed on the page it is actually drawn on", () => {
  // A page that is not open is not rendered, so a flight to a control on the
  // wrong page finds nothing and quietly goes nowhere. The page each setting
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // lives on is stated twice — once as the page an errand opens, and once as
  // the by-hand path the guide offers — and the two have to be the same
  // answer, which a `Record` cannot enforce because one of them is a sentence.
  for (const setting of buildLukeGuide(guideInput).settings) {
    assert.ok(isAppSettingId(setting.id), `${setting.id} is one of Luke's own settings`);
    const page = SETTING_PAGE[setting.id];
    assert.ok(
      setting.manual.includes(SETTINGS_PAGE_LABEL[page]),
      `${setting.id} is opened on the ${page} page and the guide sends a hand to ${setting.manual}`,
    );
  }
});

test("the captions' room is reserved only while there are words or words coming", () => {
  const block = { size: 28, max: 70 };
  // Nothing is drawn and nobody is talking, so nothing is coming either.
  assert.equal(captionRoom({ ...block, drawn: false, speaking: false }), 0);
  // Drawn: what is left of the block is what it can still take.
  assert.equal(captionRoom({ ...block, drawn: true, speaking: false }), 42);
  // A muted Mac captions whatever the preference says, so a reply under way
  // with nothing measured yet may still take the whole block.
  assert.equal(captionRoom({ size: 0, max: 70, drawn: false, speaking: true }), 70);
  // Already at its limit: it has nothing left to take.
  assert.equal(captionRoom({ size: 70, max: 70, drawn: true, speaking: true }), 0);
});

test("a landing is scrolled clear of the room the captions may still take", () => {
  const view = { top: 100, bottom: 400 };
  // Comfortably inside, with the room to spare: left exactly where it is.
  assert.equal(
    errandScrollTop({ scrollTop: 0, view, target: { top: 150, bottom: 170 }, room: 70 }),
    0,
  );
  // Inside now, but inside the band the captions are about to take: scrolled
  // up by just enough to clear it, which is what a muted reply would have
  // clipped out of view by the time he landed.
  assert.equal(
    errandScrollTop({ scrollTop: 40, view, target: { top: 350, bottom: 370 }, room: 70 }),
    80,
  );
  // The same control with no captions coming needs no scrolling at all.
  assert.equal(
    errandScrollTop({ scrollTop: 40, view, target: { top: 350, bottom: 370 }, room: 0 }),
    40,
  );
  // Above the view: brought down to its top, room or no room.
  assert.equal(
    errandScrollTop({ scrollTop: 90, view, target: { top: 60, bottom: 80 }, room: 70 }),
    50,
  );
});

test("a control taller than what is left keeps its own top on screen", () => {
  // Clearing the whole band would push the control's head out of the view.
  // Its top is where its name and its switch are, so that is what is kept: a
  // switch sitting a little low still reads, one scrolled past does not.
  assert.equal(
    errandScrollTop({
      scrollTop: 0,
      view: { top: 100, bottom: 400 },
      target: { top: 120, bottom: 390 },
      room: 70,
    }),
    20,
  );
});

test("the drift is bounded by the shape that will still be there at the end", () => {
  // The captions borrow their room from the panel and give all of it back the
  // moment the reply ends, which can easily happen mid-flight. Bounded by the
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // shape as drawn, a drift could be left on the desktop by that shrink; the
  // room comes off the foot, so the settled shape is the drawn one less the
  // block.
  const drawn = { left: 446, top: 0, width: 620, height: 520 };
  assert.deepEqual(errandSettledBound(drawn, 70), { ...drawn, height: 450 });
  // No captions, nothing borrowed, nothing to take back.
  assert.deepEqual(errandSettledBound(drawn, 0), drawn);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // An unreadable token reads as zero rather than as a negative reservation,
  // and a block somehow taller than the shape leaves no room rather than a
  // shape inside out.
  assert.deepEqual(errandSettledBound(drawn, -20), drawn);
  assert.equal(errandSettledBound(drawn, 900).height, 0);
});

test("a shape that shrinks to nothing leaves a drift with nowhere to lean", () => {
  // The bound is what decides the sway, so a settled shape with no height
  // collapses the drift onto the straight run home — the one path already
  // known to be over black — rather than bowing off it.
  const journey = errandJourney(
    STAGE,
    { left: 747, top: 9, width: 18, height: 18 },
    { left: 960, top: 300, width: 34, height: 20 },
  );
  const beats = errandBeats(TOKENS, ERRAND_WAIT.AT_ONCE);
  const flattened = errandSettledBound(errandBound(STAGE, SURFACE), SURFACE.height);
  const drift = errandDrift(journey, beats, flattened);
  for (const step of drift) {
    assert.ok(swayAt(journey, step.point) < 1e-9, "every step is on the run itself");
  }
});
