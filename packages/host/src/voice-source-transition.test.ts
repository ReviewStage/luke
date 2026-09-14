import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BrainAgent,
  BrainStateStore,
  detachOn,
  hostedBrainToolCatalog,
  LOOK_SUBJECT,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import { fakeActionPerformer, fakeBrainStateRepository } from "@sidecar/brain/testing";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
  hostedBrainBounds,
} from "@sidecar/hosted";
import { LIVE_VOICE, type LiveVoice } from "@sidecar/live";
import { MAIN_SESSION_KEY, REASONING_EFFORT } from "@sidecar/runtime/vocabulary";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { VoiceCapabilityAssembler, type VoiceSettings } from "@sidecar/voice";
import { scriptedOpenSocket } from "@sidecar/voice/testing";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Context, Effect } from "effect";
import { test } from "vitest";
import { BrainHost } from "./brain/host.js";
import { transitionVoiceSource } from "./voice-source-transition.js";

/** The transitions and their settling run under the same services the host detaches its drains under. */
const onDefault = <Value>(effect: Effect.Effect<Value>): Promise<Value> =>
  Effect.runPromise(effect);

/** Waits for a real condition to become true, ticking Effect's own scheduler rather than a fixed drain. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow;
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

const HELD_READ = {
  PREFERENCE: "preference",
} as const;

type HeldRead = (typeof HELD_READ)[keyof typeof HELD_READ];

/**
 * A settings store whose reads a test can hold: the next read of the named
 * kind waits on a gate the test releases, in whatever order the interleaving
 * under test needs. Each read answers the value as it stands when released.
 * The voice preference is the one read the assembler makes, so it is what a
 * transition can be caught on; the account gate itself is a synchronous
 * callback the assembler snapshots before its first suspension.
 */
class HeldSettings implements VoiceSettings {
  /** The stored voice, which distinguishes two published live sources from each other. */
  voice: LiveVoice = LIVE_VOICE.MARIN;
  holdNext: HeldRead | undefined;
  readonly #gates: (() => void)[] = [];

  #maybeHold<Value>(kind: HeldRead, read: () => Value): Promise<Value> {
    if (this.holdNext !== kind) return Promise.resolve(read());
    this.holdNext = undefined;
    return new Promise((resolve) => {
      this.#gates.push(() => resolve(read()));
    });
  }

  get<Field extends keyof typeof APP_SETTING_SCHEMA>(field: Field) {
    // SAFETY: the voice field answers the stored voice; every other field its schema default.
    return Effect.promise(() =>
      this.#maybeHold(
        HELD_READ.PREFERENCE,
        () =>
          (field === APP_SETTING_SCHEMA.voice.field
            ? this.voice
            : APP_SETTING_SCHEMA[field].default) as never,
      ),
    );
  }

  /** How many reads are currently held open, waiting for `release()`. */
  pendingReads(): number {
    return this.#gates.length;
  }

  readAccount(): Effect.Effect<{ accessToken: string } | undefined, never> {
    return Effect.succeed({ accessToken: "account-token" });
  }

  /** Releases the oldest held read. */
  release(): void {
    const gate = this.#gates.shift();
    assert.ok(gate, "no read is held");
    gate();
  }
}

/**
 * The real assembler, host, and agent builds, composed as main composes them.
 * The hosted HTTP client holds every brain turn until the test releases it, so a
 * run can be left outstanding on an installed agent while other work drains.
 */
function composition() {
  const settings = new HeldSettings();
  const warms: string[] = [];
  const reports: string[] = [];
  const gate = { credentialsUsable: true, accountSignedIn: true };
  const heldTurns: (() => void)[] = [];
  let onReport: ((count: number) => void) | undefined;
  const assembler = new VoiceCapabilityAssembler({
    settings,
    credentialsUsable: () => gate.credentialsUsable,
    fixtureRun: () => false,
    accountSignedIn: () => gate.accountSignedIn,
    hostedServiceBaseUrl: "https://luke.test",
    // A transition builds the live source and opens nothing on it; the seam
    // is scripted to answer no opening at all.
    openSocket: scriptedOpenSocket([]).openSocket,
    refreshAccount: () => Effect.void,
    httpClient: fakeHttpClientLayer(async (url) => {
      // The hosted adapter speaks the brain contract: it reads the
      // capabilities and then posts each turn, which this fake holds.
      if (url.endsWith(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES)) {
        return Response.json({
          contract: HOSTED_BRAIN_CONTRACT_VERSION,
          model: "gpt-hosted",
          operations: Object.values(HOSTED_BRAIN_OPERATION),
          tools: [...hostedBrainToolCatalog().keys()],
          bounds: hostedBrainBounds(),
          reasoningEfforts: Object.values(REASONING_EFFORT),
        });
      }
      if (url.endsWith(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2)) {
        await new Promise<void>((resolve) => heldTurns.push(resolve));
        return Response.json({ status: "completed", output: [] });
      }
      warms.push(url);
      return new Response(null, { status: 204 });
    }),
    report: (message) => {
      reports.push(message);
      onReport?.(reports.length);
    },
  });
  const host = new BrainHost({
    detach: detachOn(Context.empty()),
    follow: () => Effect.succeed(Effect.void),
    publishEmpty: () => undefined,
  });
  const store = new BrainStateStore({
    repository: fakeBrainStateRepository(),
    createGenerationId: () => "gen-1",
  });
  const builds: string[] = [];
  let runs = 0;
  const rebuild = () =>
    host.replace(() =>
      Effect.suspend(() => {
        const model = assembler.brainModel;
        if (!model) return Effect.succeed(undefined);
        builds.push(model.model ?? "hosted");
        return BrainAgent.make({
          conversationId: MAIN_SESSION_KEY,
          runtime: toolLoopRuntimeOver(model),
          observes: { kind: LOOK_SUBJECT.NONE },
          prepareTurn: () => ({ prompt: "instructions", layers: {} }),
          actions: fakeActionPerformer().actions,
          roster: () => ({ text: "none", identities: [] }),
          standingContext: () => "",
          readTranscriptSince: () => Effect.succeed({ status: "unsupported", reason: "no" }),
          readTranscript: () => Effect.succeed({ status: "unsupported", reason: "no" }),
          deliver: () => undefined,
          store,
          createRunId: () => `run-${runs++}`,
          report: () => undefined,
        });
      }),
    );
  const transition = () =>
    Effect.runPromise(
      transitionVoiceSource({
        retire: () => Effect.sync(() => host.retire()),
        apply: () => assembler.apply(),
        rebuild,
      }),
    );
  /** Runs `hook` once, at the assembler's next report: the boundary after publication and before the caller's continuation. */
  const atNextReport = (hook: () => void) => {
    onReport = () => {
      onReport = undefined;
      hook();
    };
  };
  const releaseTurn = () => {
    const held = heldTurns.shift();
    assert.ok(held, "no turn is held");
    held();
  };
  return {
    settings,
    gate,
    assembler,
    host,
    transition,
    builds,
    warms,
    reports,
    atNextReport,
    releaseTurn,
  };
}

function assertHostedSet(c: ReturnType<typeof composition>, voice: LiveVoice) {
  assert.ok(c.assembler.brainModel);
  // The hosted adapter knows no model until the service names one on its
  // first turn; nothing of the developer's own is ever what it runs on.
  assert.ok([undefined, "gpt-hosted"].includes(c.assembler.brainModel.model));
  assert.ok(c.assembler.liveSessions);
  assert.equal(c.assembler.liveSessions.diagnostics().voice, voice);
}

function assertAbsentSet(c: ReturnType<typeof composition>) {
  assert.equal(c.assembler.brainModel, undefined);
  assert.equal(c.assembler.liveSessions, undefined);
  assert.equal(c.host.current(), undefined);
}

test("a newer transition begun between publication and the caller's continuation wins: the older builds nothing", async () => {
  const c = composition();
  let newer: Promise<boolean> | undefined;
  // At the boundary between A's publication and its caller resuming, another
  // settings continuation changes the voice and begins B, whose preference
  // read is held: exactly the moment a copied "latest" would be wrong.
  c.atNextReport(() => {
    c.settings.voice = LIVE_VOICE.CEDAR;
    c.settings.holdNext = HELD_READ.PREFERENCE;
    newer = c.transition();
  });
  const olderInstalled = await c.transition();
  await onDefault(c.host.settled());
  assert.equal(olderInstalled, false);
  assert.deepEqual(c.builds, []);
  assert.equal(c.host.current(), undefined);
  assert.ok(newer);

  c.settings.release();
  assert.equal(await newer, true);
  assertHostedSet(c, LIVE_VOICE.CEDAR);
  assert.deepEqual(c.builds, ["hosted"]);
  const standing = c.host.current();
  assert.ok(standing);
  await onDefault(standing.stop());
});

test("a newer transition that removes every capability at that boundary leaves nothing standing", async () => {
  const c = composition();
  let newer: Promise<boolean> | undefined;
  c.atNextReport(() => {
    c.gate.accountSignedIn = false;
    c.settings.holdNext = HELD_READ.PREFERENCE;
    newer = c.transition();
  });
  const olderInstalled = await c.transition();
  await onDefault(c.host.settled());
  assert.equal(olderInstalled, false);
  assert.deepEqual(c.builds, []);
  assert.equal(c.host.current(), undefined);
  const reportsBefore = c.reports.length;
  const warmsBefore = c.warms.length;

  assert.ok(newer);
  c.settings.release();
  assert.equal(await newer, true);
  await onDefault(c.host.settled());
  assertAbsentSet(c);
  assert.deepEqual(c.builds, []);
  assert.equal(c.warms.length, warmsBefore);
  // The newer one reported once, a voice line and a brain line; the older
  // one, overtaken, added nothing.
  assert.equal(c.reports.length, reportsBefore + 2);
});

it.effect(
  "an older transition whose preference read finishes late publishes nothing over the set the newer one chose, and the newer agent's run is not interrupted",
  () =>
    Effect.gen(function* () {
      const c = composition();
      c.settings.holdNext = HELD_READ.PREFERENCE;
      const older = c.transition();
      yield* waitFor(() => c.settings.pendingReads() > 0);
      c.settings.voice = LIVE_VOICE.CEDAR;
      assert.equal(yield* Effect.promise(() => c.transition()), true);
      assertHostedSet(c, LIVE_VOICE.CEDAR);
      const hostedAgent = c.host.current();
      assert.ok(hostedAgent);
      const reportsAfterNewer = c.reports.length;
      const warmsAfterNewer = c.warms.length;
      const live = c.assembler.liveSessions;

      // A run stands on the correct successor, its model turn outstanding.
      const accepted = yield* hostedAgent.submitAsk({
        submissionId: "s-1",
        question: "still there?",
        origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      });
      assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
      const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
      yield* waitFor(() => hostedAgent.request(runId)?.status === BRAIN_REQUEST_STATUS.RUNNING);
      assert.equal(hostedAgent.request(runId)?.status, BRAIN_REQUEST_STATUS.RUNNING);

      // The older read answers now, with the voice it was started under.
      c.settings.voice = LIVE_VOICE.MARIN;
      c.settings.release();
      assert.equal(yield* Effect.promise(() => older), false);
      yield* Effect.promise(() => onDefault(c.host.settled()));
      // Nothing of the older set was published, not even in part.
      assertHostedSet(c, LIVE_VOICE.CEDAR);
      assert.equal(c.assembler.liveSessions, live);
      assert.equal(c.host.current(), hostedAgent);
      assert.equal(c.reports.length, reportsAfterNewer);
      assert.equal(c.warms.length, warmsAfterNewer);
      assert.deepEqual(c.builds, ["hosted"]);
      assert.equal(hostedAgent.request(runId)?.status, BRAIN_REQUEST_STATUS.RUNNING);

      c.releaseTurn();
      const record = yield* hostedAgent.waitAsk(runId, 10_000);
      assert.notEqual(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
      assert.ok(record && record.status !== BRAIN_REQUEST_STATUS.RUNNING);
      yield* hostedAgent.stop();
    }),
);

it.effect(
  "the reverse order holds too: a late signed-out read never overrides a newer sign-in",
  () =>
    Effect.gen(function* () {
      const c = composition();
      c.gate.accountSignedIn = false;
      c.settings.holdNext = HELD_READ.PREFERENCE;
      const older = c.transition();
      yield* waitFor(() => c.settings.pendingReads() > 0);
      c.gate.accountSignedIn = true;
      assert.equal(yield* Effect.promise(() => c.transition()), true);
      assertHostedSet(c, LIVE_VOICE.MARIN);
      const hostedAgent = c.host.current();
      assert.ok(hostedAgent);

      c.settings.release();
      assert.equal(yield* Effect.promise(() => older), false);
      yield* Effect.promise(() => onDefault(c.host.settled()));
      assertHostedSet(c, LIVE_VOICE.MARIN);
      assert.equal(c.host.current(), hostedAgent);
      assert.deepEqual(c.builds, ["hosted"]);
      yield* hostedAgent.stop();
    }),
);

it.effect("a late read cannot resurrect a capability the newer transition removed", () =>
  Effect.gen(function* () {
    const c = composition();
    assert.equal(yield* Effect.promise(() => c.transition()), true);
    assert.ok(c.host.current());
    c.settings.holdNext = HELD_READ.PREFERENCE;
    const older = c.transition();
    yield* waitFor(() => c.settings.pendingReads() > 0);
    // The account signs out: nothing may stand.
    c.gate.accountSignedIn = false;
    assert.equal(yield* Effect.promise(() => c.transition()), true);
    yield* Effect.promise(() => onDefault(c.host.settled()));
    assertAbsentSet(c);
    const reportsAfterRemoval = c.reports.length;
    const warmsAfterRemoval = c.warms.length;

    // The older read answers now; it began under a signed-in gate and would
    // build the whole set, and it is overtaken.
    c.settings.release();
    assert.equal(yield* Effect.promise(() => older), false);
    yield* Effect.promise(() => onDefault(c.host.settled()));
    assertAbsentSet(c);
    assert.deepEqual(c.builds, ["hosted"]);
    assert.equal(c.reports.length, reportsAfterRemoval);
    assert.equal(c.warms.length, warmsAfterRemoval);

    // A closed gate is the same removal from the other side.
    c.gate.accountSignedIn = true;
    c.settings.holdNext = HELD_READ.PREFERENCE;
    const heldAgain = c.transition();
    yield* waitFor(() => c.settings.pendingReads() > 0);
    c.gate.credentialsUsable = false;
    assert.equal(yield* Effect.promise(() => c.transition()), true);
    c.settings.release();
    assert.equal(yield* Effect.promise(() => heldAgain), false);
    yield* Effect.promise(() => onDefault(c.host.settled()));
    assertAbsentSet(c);
    assert.deepEqual(c.builds, ["hosted"]);
  }),
);

test("transitions that do not overlap each install in turn", async () => {
  const c = composition();
  assert.equal(await c.transition(), true);
  const first = c.host.current();
  assert.ok(first);
  const firstLive = c.assembler.liveSessions;
  c.settings.voice = LIVE_VOICE.CEDAR;
  assert.equal(await c.transition(), true);
  assertHostedSet(c, LIVE_VOICE.CEDAR);
  const second = c.host.current();
  assert.ok(second);
  assert.notEqual(second, first);
  assert.notEqual(c.assembler.liveSessions, firstLive);
  assert.deepEqual(c.builds, ["hosted", "hosted"]);
  await Effect.runPromise(second.stop());
});
