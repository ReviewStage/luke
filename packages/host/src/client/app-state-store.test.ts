import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { MICROPHONE_STATUS } from "@luke/settings/microphone";
import { Context, Effect, Fiber, Stream } from "effect";
import { type AppState, sessionReplayBootstrap } from "../app-state.js";
import type { HostBootstrap } from "../host-operator.js";
import { runModeFor } from "../run-mode.js";
import { recordingReporter } from "../testing/recording-reporter.js";
import {
  AppStateStore,
  bootstrapPatch,
  initialAppState,
  publishAppStateChanges,
} from "./app-state-store.js";

/**
 * The document and the one path out of it. What is proven here is what the
 * rest of the client leans on: a patch that says nothing changes nothing, a
 * slice is replaced whole, the version only ever climbs, and `changes`
 * carries exactly one document per applied patch.
 */

/** Two pages of a plan and the agent that showed them, as the store's identity test holds them. */
const PAGE_ONE = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d01";
const PAGE_TWO = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d02";
const AGENT = "0b0e7c64-1d1f-4a9a-9c55-7c1e2f6a9d03";

const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "darwin",
} as const;

function store(): AppStateStore {
  return new AppStateStore(initialAppState(RUN, true, []), Context.empty());
}

/**
 * The `count` documents `changes` carries once `act` has run, starting with
 * the one standing before it: `SubscriptionRef.changes` is the current value
 * concatenated with every value set after, so this always opens with the
 * document as it stood before `act`'s own writes. The collector is forked and
 * given one turn to reach its own subscription — a `SubscriptionRef`'s
 * `changes` only delivers a write to a subscriber already reading when it
 * happens — before `act`'s synchronous writes run.
 */
function watchChanges(
  app: AppStateStore,
  count: number,
  act: () => void,
): Effect.Effect<AppState[]> {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(app.changes, count)));
    yield* Effect.yieldNow;
    act();
    return yield* Fiber.join(fiber);
  });
}

/**
 * A payload the document only ever carries whole. The store never reads
 * inside one — it compares and holds — so what stands in for a settings
 * snapshot, a roster entry, or a run record is an empty record, and the one
 * assertion that says so is here rather than at each of them.
 */
function inert<Value>(): Value {
  // SAFETY: nothing under test reads a field of these payloads; only their identity and equality are exercised.
  return {} as Value;
}

const SETTINGS = inert<NonNullable<AppState["settings"]>>();

it.effect("one slice patched bumps the version once and announces once on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.version, 1);
    assert.equal(seen[1]?.audio.microphoneStatus, MICROPHONE_STATUS.GRANTED);
  }),
);

it.effect("a patch that says nothing new announces nothing on `changes`", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 2, () => {
      app.update({});
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED } });
      app.update({ network: { online: true } });
      // The one real patch is the second document `changes` ever carries; the
      // three no-ops before it wrote nothing for a collector to see.
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.version, 0);
    assert.equal(seen[1]?.version, 1);
  }),
);

it.effect("a subscriber that patches the document as it is announced lands its patch next", () =>
  Effect.gen(function* () {
    const app = store();
    // The subscriber is parked on `changes` when the first patch lands, so it is
    // resumed on the writer's own stack, and answers it with a patch of its own.
    const answering = yield* Effect.forkChild(
      Stream.runForEach(Stream.take(app.changes, 2), (state) =>
        Effect.sync(() => {
          if (state.audio.microphoneStatus === MICROPHONE_STATUS.GRANTED) {
            app.update({ network: { online: false } });
          }
        }),
      ),
    );
    const seen = yield* watchChanges(app, 3, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
    });
    yield* Fiber.join(answering);
    assert.deepEqual(
      seen.map((state) => [state.version, state.network.online]),
      [
        [0, true],
        [1, true],
        [2, false],
      ],
    );
  }),
);

it("two slices in one patch are one version", () => {
  const app = store();
  app.update({
    audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED },
    network: { online: false },
  });
  assert.equal(app.snapshot().version, 1);
  assert.equal(app.snapshot().network.online, false);
});

it("a slice that moved keeps every part of it that did not, so what a reader held of it is the object it still holds", () => {
  const app = store();
  const page = (id: string, title: string, agentId: string) => ({
    id,
    title,
    version: 1,
    at: 0,
    shownBy: { kind: PAGE_SHOWER.AGENT, agentId },
  });
  app.update({
    tasks: {
      ...app.snapshot().tasks,
      activeTaskId: "plan-1",
      pages: [page(PAGE_ONE, "Invites", AGENT), page(PAGE_TWO, "Billing", AGENT)],
    },
  });
  const held = app.snapshot().tasks;

  // The host's next view: the same data, every object of it new, and the second page retitled.
  const next = {
    ...structuredClone(held),
    pages: [page(PAGE_ONE, "Invites", AGENT), page(PAGE_TWO, "Billing and plans", AGENT)],
  };
  app.update({ tasks: next });
  const now = app.snapshot().tasks;

  assert.equal(app.snapshot().version, 2);
  assert.deepEqual(now, next);
  assert.equal(now.document, held.document);
  assert.equal(now.pages?.[0], held.pages?.[0]);
  assert.notEqual(now.pages?.[1], held.pages?.[1]);
  assert.equal(now.pages?.[1]?.shownBy, held.pages?.[1]?.shownBy);
});

it.effect("a touch re-announces the document without numbering it again", () =>
  Effect.gen(function* () {
    const app = store();
    const seen = yield* watchChanges(app, 4, () => {
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      app.touch();
      app.touch();
    });
    assert.deepEqual(
      seen.map((state) => state.version),
      [0, 1, 1, 1],
    );
  }),
);

const BOOT: HostBootstrap = {
  settings: SETTINGS,
  account: inert(),
  sessionReplay: { permitted: true, accountId: "person" },
  access: { admin: true },
};

it("a host bootstrap lands in the document as the host answered it", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  const held = app.snapshot();
  assert.deepEqual(held.sessionReplay, { permitted: true, accountId: "person", halted: false });
  assert.deepEqual(held.access, { admin: true });
});

it("a halt outlives every host read until the host's own event stands it down", () => {
  const app = store();
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  // The account is going and the host still answers `permitted` until its
  // store has caught up; a window bootstrapping in that window must not
  // restart a recording that was stood down.
  app.update(bootstrapPatch(app.snapshot(), BOOT));
  assert.equal(app.snapshot().sessionReplay.halted, true);
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("recording is what the host permitted less what an account's end stood down", () => {
  const app = store();
  app.update({ sessionReplay: { permitted: true, accountId: "person", halted: false } });
  assert.deepEqual(sessionReplayBootstrap(app.snapshot()), {
    permitted: true,
    appVersion: "1.2.3",
    packaged: true,
    accountId: "person",
  });
  app.update({ sessionReplay: { ...app.snapshot().sessionReplay, halted: true } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it("an unpackaged run never records, whatever the host permitted", () => {
  const app = new AppStateStore(
    initialAppState({ ...RUN, packaged: false }, true, []),
    Context.empty(),
  );
  app.update({ sessionReplay: { permitted: true, accountId: "person", halted: false } });
  assert.equal(sessionReplayBootstrap(app.snapshot()).permitted, false);
});

it.effect(
  "a push that dies is reported, to Sentry as well, and the next change is still pushed",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const app = store();
      const reported: string[] = [];
      let pushes = 0;
      const publish = () =>
        Effect.suspend(() => {
          pushes += 1;
          return pushes === 1 ? Effect.die(new Error("the window went away")) : Effect.void;
        });
      yield* publishAppStateChanges(app, publish, (message) => reported.push(message));
      yield* Effect.yieldNow;
      app.update({ audio: { microphoneStatus: MICROPHONE_STATUS.GRANTED } });
      yield* Effect.yieldNow;
      assert.equal(pushes, 2);
      assert.deepEqual(reported, ["the app-state push to windows failed: the window went away"]);
      assert.deepEqual(sentry.reported, ["the window went away"]);
    }).pipe(Effect.scoped, Effect.provide(sentry.layer));
  },
);
