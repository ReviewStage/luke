import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SETTING_SIDE_EFFECT } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { AppSettings } from "@luke/settings/wire";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Context, Effect, Option } from "effect";
import { hostActRows } from "../act-router/host-act-rows.js";
import {
  type ActRouter,
  createHostActRouter,
  type HostActDependencies,
  type PlatformActRows,
  refusedRows,
} from "../act-router/index.js";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, type ActKind } from "../acts.js";
import type { AppStateSnapshot } from "../app-state.js";
import { isPortActKind } from "../contract/index.js";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, createInProcessBridge, initialAppState } from "./index.js";

/**
 * The bridge a shell installs when the host runs in its own page: an act
 * reaches the host's real rows and comes back, the document is read and
 * pushed from the store, a kind the shell cannot carry is refused in its own
 * words, and a subscription ended hears nothing more.
 */

const RUN = {
  launch: { profile: "web", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "web",
} as const;

const REPORTER = "reporter-1";

const AGENT_PLACE = { taskId: "task-1", agentId: "agent-1" };

// SAFETY: the acts these tests send reach the settings rows' host alone, or
// a refused row of the platform's, and building the rows reads none of these.
const UNREACHED = {
  account: {},
  settings: {},
  tasks: {},
  codingAgents: {},
  integrations: {},
  automations: {},
  issues: {},
  factory: {},
} as unknown as HostActDependencies<symbol>;

/** The settings the fake host holds, and every reporter a write reached it under. */
interface SettingsHost {
  readonly reporters: string[];
  readonly settings: HostActDependencies<symbol>["settings"];
}

/** The settings rows' dependencies over a host that holds one document and accepts every write. */
function settingsHost(reporterOf: (sender: symbol) => string): SettingsHost {
  let held: AppSettings = appSettingsWire(settingsView());
  const reporters: string[] = [];
  const accepted = () => ({ status: ACTION_RESULT_STATUS.ACCEPTED, settings: held });
  return {
    reporters,
    settings: {
      host: {
        settingsSnapshot: () => Effect.sync(() => Option.some(held)),
        updateSetting: (field, value, reporter) =>
          Effect.sync(() => {
            reporters.push(reporter);
            held = { ...held, stored: { ...held.stored, [field]: value } };
            return accepted();
          }),
        resetSettings: () => Effect.sync(accepted),
        setExperiment: () => Effect.sync(accepted),
      },
      reporterOf,
      lastSettings: () => held,
      sideEffects: {
        [SETTING_SIDE_EFFECT.NONE]: () => {},
        [SETTING_SIDE_EFFECT.LOGIN_ITEM]: () => {},
        [SETTING_SIDE_EFFECT.VOICE]: () => {},
        [SETTING_SIDE_EFFECT.TALK_HOTKEY]: () => {},
        [SETTING_SIDE_EFFECT.STOP_HOTKEY]: () => {},
        [SETTING_SIDE_EFFECT.MEDIA_DUCK]: () => {},
      },
      stopChordHolder: () => undefined,
    },
  };
}

/** Every kind the host's rows leave, refused: the table of a shell that carries none of them. */
function everyPlatformKindRefused(): PlatformActRows<symbol> {
  const hosts = new Set<string>(Object.keys(hostActRows(UNREACHED)));
  const kinds: readonly ActKind[] = Object.values(ACT_KIND).filter(
    (kind): kind is ActKind => !hosts.has(kind) && !isPortActKind(kind),
  );
  // SAFETY: the kinds are exactly those the host's rows leave, each once.
  return refusedRows(kinds) as unknown as PlatformActRows<symbol>;
}

/** A bridge over the real router and a fresh store, its acts run on the test's own services. */
const bridgeFixture = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
  let host: SettingsHost | undefined;
  const reported: string[] = [];
  const made = yield* createInProcessBridge({
    sender: Symbol("page"),
    routerFor: (reporterOf): ActRouter<symbol> => {
      host = settingsHost(reporterOf);
      return createHostActRouter(
        { ...UNREACHED, settings: host.settings },
        everyPlatformKindRefused(),
      );
    },
    run: (effect) => Effect.runPromiseWith(services)(effect),
    state,
    windowFacts: () => ({ fullScreen: false }),
    createId: () => REPORTER,
    reports: { notifyReady: () => {}, recordSurfaceEvent: () => {} },
    report: (message) => reported.push(message),
  });
  assert.ok(host !== undefined);
  // The push's first reading is of the document as it stood, before anything subscribed.
  yield* Effect.yieldNow;
  return { ...made, state, reporters: host.reporters, reported };
});

it.effect("an act round-trips through the host's rows, under the reporter the bridge minted", () =>
  Effect.gen(function* () {
    const { bridge, reporters } = yield* bridgeFixture;
    const outcome = yield* Effect.promise(() =>
      bridge.act({
        kind: ACT_KIND.SETTING_UPDATE,
        payload: { field: "stopHotkey", value: "Control+Alt+S" },
      }),
    );
    assert.ok(outcome.status === ACT_OUTCOME_STATUS.DONE);
    assert.deepEqual(reporters, [REPORTER]);
  }).pipe(Effect.scoped),
);

it.effect("the document is read on request and every change of it reaches a subscription", () =>
  Effect.gen(function* () {
    const { bridge, state } = yield* bridgeFixture;
    const read = yield* Effect.promise(() => bridge.requestAppState());
    assert.deepEqual(read, { ...state.snapshot(), window: { fullScreen: false } });

    const heard: AppStateSnapshot[] = [];
    bridge.onAppState((snapshot) => heard.push(snapshot));
    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    yield* Effect.yieldNow;
    assert.equal(heard.length, 1);
    assert.equal(heard[0]?.version, read.version + 1);
    assert.equal(heard[0]?.audio.microphoneStatus, MICROPHONE_STATUS.GRANTED);
  }).pipe(Effect.scoped),
);

it.effect(
  "a voice act is refused in its kind's own words, and a voice subscription ends cleanly",
  () =>
    Effect.gen(function* () {
      const { bridge } = yield* bridgeFixture;
      const outcome = yield* Effect.promise(() =>
        bridge.act({ kind: ACT_KIND.VOICE_STOP_SPEAKING }),
      );
      assert.deepEqual(outcome, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.VOICE_STOP_SPEAKING].refusal,
      });
      const unsubscribe = bridge.onVoiceHotkeyPress(() => assert.fail("no talk key in the page"));
      unsubscribe();
    }).pipe(Effect.scoped),
);

it.effect("an ended subscription hears neither the document nor an event again", () =>
  Effect.gen(function* () {
    const { bridge, events, state } = yield* bridgeFixture;
    const versions: number[] = [];
    const shown: unknown[] = [];
    const endState = bridge.onAppState((snapshot) => versions.push(snapshot.version));
    const endShow = bridge.onShowAgent((place) => shown.push(place));

    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    events.onShowAgent(AGENT_PLACE);
    yield* Effect.yieldNow;
    endState();
    endShow();
    state.update({ audio: { microphoneStatus: MICROPHONE_STATUS.DENIED } });
    events.onShowAgent(AGENT_PLACE);
    yield* Effect.yieldNow;

    assert.deepEqual(versions, [1]);
    assert.deepEqual(shown, [AGENT_PLACE]);
  }).pipe(Effect.scoped),
);

it.effect("a listener that throws is reported, and the others still hear the event", () =>
  Effect.gen(function* () {
    const { bridge, events, reported } = yield* bridgeFixture;
    const shown: unknown[] = [];
    bridge.onShowAgent(() => {
      throw new Error("the view went away");
    });
    bridge.onShowAgent((place) => shown.push(place));
    events.onShowAgent(AGENT_PLACE);
    assert.deepEqual(shown, [AGENT_PLACE]);
    assert.deepEqual(reported, ["a page's bridge listener failed: the view went away"]);
  }).pipe(Effect.scoped),
);

it.effect("a closed bridge tells its page nothing more, nor takes a new subscription", () =>
  Effect.gen(function* () {
    const shown: unknown[] = [];
    const { bridge, events } = yield* Effect.scoped(
      Effect.tap(bridgeFixture, ({ bridge }) =>
        Effect.sync(() => bridge.onShowAgent((place) => shown.push(place))),
      ),
    );
    bridge.onShowAgent((place) => shown.push(place));
    events.onShowAgent(AGENT_PLACE);
    assert.deepEqual(shown, []);
  }),
);
