import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type CodingAgentTranscriptChanged,
  type CodingAgentTranscriptKey,
  TRANSCRIPT_KIND,
} from "@luke/features/coding-agent-view";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Context, Effect } from "effect";
import { hostActRows } from "../act-router/host-act-rows.js";
import {
  type ActRouter,
  createHostActRouter,
  type HostActDependencies,
  type PlatformActRows,
  refusedRows,
  transcriptFollowActRows,
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

// SAFETY: the acts these tests send reach a row of the platform's alone, and
// building the host's rows reads none of these.
const UNREACHED = {
  tasks: {},
  codingAgents: {},
} as unknown as HostActDependencies;

/**
 * Every kind the host's rows leave, refused, but the copy, which records the
 * reporter its window is named by: the table of a shell that carries one.
 */
function platformRows(
  reporterOf: (sender: symbol) => string,
  reporters: string[],
): PlatformActRows<symbol> {
  const hosts = new Set<string>(Object.keys(hostActRows(UNREACHED)));
  const kinds: readonly ActKind[] = Object.values(ACT_KIND).filter(
    (kind): kind is ActKind => !hosts.has(kind) && !isPortActKind(kind),
  );
  // SAFETY: the kinds are exactly those the host's rows leave, each once.
  const refused = refusedRows(kinds) as unknown as PlatformActRows<symbol>;
  return {
    ...refused,
    [ACT_KIND.WINDOW_COPY_TEXT]: (_payload, { sender }) => {
      reporters.push(reporterOf(sender));
    },
  };
}

/** A bridge over the real router and a fresh store, its acts run on the test's own services. */
const bridgeFixture = Effect.gen(function* () {
  const services = yield* Effect.context<never>();
  const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
  const reporters: string[] = [];
  const reported: string[] = [];
  const made = yield* createInProcessBridge({
    sender: Symbol("page"),
    routerFor: (reporterOf): ActRouter<symbol> =>
      createHostActRouter(UNREACHED, platformRows(reporterOf, reporters)),
    run: (effect) => Effect.runPromiseWith(services)(effect),
    state,
    windowFacts: () => ({ fullScreen: false }),
    createId: () => REPORTER,
    reports: { notifyReady: () => {}, recordSurfaceEvent: () => {} },
    report: (message) => reported.push(message),
  });
  // The push's first reading is of the document as it stood, before anything subscribed.
  yield* Effect.yieldNow;
  return { ...made, state, reporters, reported };
});

it.effect("an act round-trips through the router, under the reporter the bridge minted", () =>
  Effect.gen(function* () {
    const { bridge, reporters } = yield* bridgeFixture;
    const outcome = yield* Effect.promise(() =>
      bridge.act({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "copied" } }),
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
  "a microphone act is refused in its kind's own words, and a voice subscription ends cleanly",
  () =>
    Effect.gen(function* () {
      const { bridge } = yield* bridgeFixture;
      const outcome = yield* Effect.promise(() =>
        bridge.act({ kind: ACT_KIND.MICROPHONE_REQUEST }),
      );
      assert.deepEqual(outcome, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.MICROPHONE_REQUEST].refusal,
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

it.effect(
  "a page follows a transcript through the shell's follow rows and hears each page the host tells pushed to it",
  () =>
    Effect.gen(function* () {
      const services = yield* Effect.context<never>();
      const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
      const followed: CodingAgentTranscriptKey[] = [];
      let told: ((changed: CodingAgentTranscriptChanged) => void) | undefined;
      let events: Effect.Success<ReturnType<typeof createInProcessBridge>>["events"] | undefined;
      const follows = transcriptFollowActRows<symbol>({
        host: {
          transcriptFollow: (transcript) => Effect.sync(() => void followed.push(transcript)),
          transcriptUnfollow: () => Effect.void,
          onTranscriptChanged: (listener) => {
            told = listener;
            return () => undefined;
          },
        },
        deliver: (_page, changed) => events?.onTranscript(changed),
        whenGone: () => undefined,
        run: (effect) => Effect.runPromiseWith(services)(effect),
      });
      const made = yield* createInProcessBridge({
        sender: Symbol("page"),
        routerFor: (reporterOf): ActRouter<symbol> =>
          createHostActRouter(UNREACHED, { ...platformRows(reporterOf, []), ...follows }),
        run: (effect) => Effect.runPromiseWith(services)(effect),
        state,
        windowFacts: () => ({ fullScreen: false }),
        createId: () => REPORTER,
        reports: { notifyReady: () => {}, recordSurfaceEvent: () => {} },
        report: () => undefined,
      });
      events = made.events;
      const heard: CodingAgentTranscriptChanged[] = [];
      made.bridge.onTranscript((changed) => heard.push(changed));
      const transcript: CodingAgentTranscriptKey = {
        kind: TRANSCRIPT_KIND.AGENT,
        agentId: AGENT_PLACE.agentId,
      };

      const outcome = yield* Effect.promise(() =>
        made.bridge.act({ kind: ACT_KIND.CODING_AGENTS_TRANSCRIPT_FOLLOW, payload: transcript }),
      );
      assert.ok(outcome.status === ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(followed, [transcript]);
      const page: CodingAgentTranscriptChanged = {
        transcript,
        page: { messages: [], cursor: "1:0", status: CODING_AGENT_STATUS.RUNNING, title: null },
      };
      told?.(page);
      assert.deepEqual(heard, [page]);
    }).pipe(Effect.scoped),
);
