import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@sidecar/gateway";
import {
  AVATAR_END_REASON,
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarEndedFrame,
  type AvatarStartedFrame,
  type AvatarStopReason,
  type AvatarUnavailableFrame,
  type PlanActivityFrame,
  type PlanCallEndingFrame,
  type PlanCodeFrame,
  type PlanWorkFrame,
  VOICE_SERVICE_FRAME,
} from "@sidecar/hosted";
import {
  LIVE_CLOSE_REASON,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  parseLiveServerEvent,
} from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { Deferred, Effect, Option, type Scope, Stream } from "effect";
import {
  AVATAR_MEDIA_END_REASON,
  type AvatarMedia,
  type AvatarMediaEnd,
} from "../avatar/avatar-media.js";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { HELD_AVATAR_STATUS, LiveSessionHolder } from "./live-session-holder.js";

/**
 * The peer's holder of one hosted planning call, over a scripted source and
 * sideband. What these hold to is the whole of what the desktop still sends
 * once the exchange is the service's: the plan at creation, the stop, the
 * hang-up, and the idle report through the source's own door, and nothing on
 * a delegation, a transcript, or an acknowledgment, which are the service's
 * to read.
 */

const INVITES_PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  /** How many times the source's hang-up door asked the service to close this session. */
  hangUps = 0;
  closed = false;
  readonly #hold: SocketHold = holdSocket({
    send: () => undefined,
    ping: () => undefined,
    close: () => {
      this.closed = true;
    },
  });
  readonly #sideband: LiveSideband = sidebandOverSocket(this.#hold.socket);

  get arrivals(): Stream.Stream<SidebandArrival> {
    return this.#sideband.arrivals;
  }

  send(event: LiveClientEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sent.push(event);
    });
  }

  get close(): Effect.Effect<void> {
    return this.#sideband.close;
  }

  receive(payload: WireRecord): void {
    const frame = JSON.stringify(payload);
    assert.ok(parseLiveServerEvent(frame), `a test event must parse: ${frame}`);
    this.#hold.hear({ frame });
  }

  started(sessionId: string): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: sessionId },
    });
  }

  closedBy(reason: string, seconds: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason,
      usage: { seconds },
    });
  }

  dropConnection(): void {
    this.#hold.hear({ close: { code: 1006 } });
  }
}

/** A face's media socket as the holder sees it: what it was told, whether its scope let it go, and its end. */
interface FakeMedia {
  readonly url: string;
  readonly spoken: Uint8Array[];
  interrupts: number;
  released: boolean;
  readonly end: Deferred.Deferred<AvatarMediaEnd>;
}

const STARTED_FRAME: AvatarStartedFrame = {
  type: VOICE_SERVICE_FRAME.AVATAR_STARTED,
  avatarSessionId: "liveavatar-1",
  livekitUrl: "wss://room.livekit.example",
  viewerToken: "viewer-token",
  mediaUrl: "wss://media.liveavatar.example",
  maxSeconds: 1_200,
};

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface Fixture {
  holder: LiveSessionHolder;
  sidebands: FakeSideband[];
  /** The plan each session was created about, in order. */
  plans: string[];
  changes: VoiceLiveSessionChanged[];
  /** Every idle report the source's door was handed, in order. */
  reports: boolean[];
  /** How many times the source's stop door was asked. */
  stops: number;
  /** Every activity frame the holder told its caller, in order. */
  activity: PlanActivityFrame[];
  /** The service's activity frame, as the source's door would deliver it. */
  tellActivity(activity: PlanActivityFrame): void;
  /** Every code frame the holder told its caller, in order. */
  code: PlanCodeFrame[];
  /** The service's code frame, as the source's door would deliver it. */
  tellCode(code: PlanCodeFrame): void;
  /** Every work frame the holder told its caller, in order. */
  work: PlanWorkFrame[];
  /** The service's work frame, as the source's door would deliver it. */
  tellWork(work: PlanWorkFrame): void;
  /** The service's word that Luke is ending the call, as the source's door would deliver it. */
  tellEnding(ending: PlanCallEndingFrame): void;
  /** Every plan whose call the holder told its caller ended, in order. */
  callsEnded: string[];
  created: number;
  sourceAvailable: boolean;
  /** Whether the source opens the doors for the idle report and the stop, as the hosted source does and the keyed one does not. */
  reportsActivity: boolean;
  /** Every face the source's door asked the service for, as a count, and every stop with its reason. */
  avatarStarts: number;
  avatarStops: AvatarStopReason[];
  /** The service's avatar frames, as the source's door would deliver them. */
  tellAvatarStarted(started: AvatarStartedFrame): void;
  tellAvatarEnded(ended: AvatarEndedFrame): void;
  tellAvatarUnavailable(unavailable: AvatarUnavailableFrame): void;
  /** Every media socket the holder opened, in order. */
  media: FakeMedia[];
  /** Where a creation waits before the source answers, so a test can hold one in flight. */
  createGate: Effect.Effect<void>;
  open(planId?: string): Effect.Effect<FakeSideband>;
}

function fixture(): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sidebands: FakeSideband[] = [];
    const plans: string[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const reports: boolean[] = [];
    const activity: PlanActivityFrame[] = [];
    let activityListener: ((activity: PlanActivityFrame) => void) | undefined;
    const code: PlanCodeFrame[] = [];
    let codeListener: ((code: PlanCodeFrame) => void) | undefined;
    const work: PlanWorkFrame[] = [];
    let workListener: ((work: PlanWorkFrame) => void) | undefined;
    let endingListener: ((ending: PlanCallEndingFrame) => void) | undefined;
    const callsEnded: string[] = [];
    const avatarStops: AvatarStopReason[] = [];
    let avatarStartedListener: ((started: AvatarStartedFrame) => void) | undefined;
    let avatarEndedListener: ((ended: AvatarEndedFrame) => void) | undefined;
    let avatarUnavailableListener: ((unavailable: AvatarUnavailableFrame) => void) | undefined;
    const media: FakeMedia[] = [];
    const state = {
      avatarStarts: 0,
      sourceAvailable: true,
      reportsActivity: true,
      created: 0,
      stops: 0,
      createGate: Effect.void satisfies Effect.Effect<void>,
    };
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.map(state.createGate, () => {
          plans.push(input.planId);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () => Effect.succeed(sideband),
            hangUp: () => {
              sideband.hangUps += 1;
            },
            ...(state.reportsActivity
              ? {
                  reportActivity: (idle: boolean) => {
                    reports.push(idle);
                  },
                  stopSpeaking: () => {
                    state.stops += 1;
                  },
                  onPlanActivity: (listener: (activity: PlanActivityFrame) => void) => {
                    activityListener = listener;
                  },
                  onPlanCode: (listener: (code: PlanCodeFrame) => void) => {
                    codeListener = listener;
                  },
                  onPlanWork: (listener: (work: PlanWorkFrame) => void) => {
                    workListener = listener;
                  },
                  onPlanCallEnding: (listener: (ending: PlanCallEndingFrame) => void) => {
                    endingListener = listener;
                  },
                  startAvatar: () => {
                    state.avatarStarts += 1;
                  },
                  stopAvatar: (reason: AvatarStopReason) => {
                    avatarStops.push(reason);
                  },
                  onAvatarStarted: (listener: (started: AvatarStartedFrame) => void) => {
                    avatarStartedListener = listener;
                  },
                  onAvatarEnded: (listener: (ended: AvatarEndedFrame) => void) => {
                    avatarEndedListener = listener;
                  },
                  onAvatarUnavailable: (
                    listener: (unavailable: AvatarUnavailableFrame) => void,
                  ) => {
                    avatarUnavailableListener = listener;
                  },
                }
              : undefined),
          };
          return opened;
        }),
      setVoice: () => undefined,
      diagnostics: () => {
        throw new Error("not read here");
      },
    };
    const holder = yield* LiveSessionHolder.make({
      source: () => (state.sourceAvailable ? source : undefined),
      emit: (change) => changes.push(change),
      onPlanActivity: (word) => {
        activity.push(word);
      },
      onPlanCode: (frame) => {
        code.push(frame);
      },
      onPlanWork: (frame) => {
        work.push(frame);
      },
      onPlanCallEnded: (planId) => {
        callsEnded.push(planId);
      },
      onSessionCreated: () => {
        state.created += 1;
      },
      acquireAvatarMedia: (url) =>
        Effect.gen(function* () {
          const opened: FakeMedia = {
            url,
            spoken: [],
            interrupts: 0,
            released: false,
            end: yield* Deferred.make<AvatarMediaEnd>(),
          };
          media.push(opened);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              opened.released = true;
            }),
          );
          return {
            speak: (pcm) =>
              Effect.sync(() => {
                opened.spoken.push(pcm);
              }),
            interrupt: () =>
              Effect.sync(() => {
                opened.interrupts += 1;
              }),
            ended: Deferred.await(opened.end),
          } satisfies AvatarMedia;
        }),
    });
    return {
      holder,
      sidebands,
      plans,
      changes,
      reports,
      get created() {
        return state.created;
      },
      get sourceAvailable() {
        return state.sourceAvailable;
      },
      set sourceAvailable(value: boolean) {
        state.sourceAvailable = value;
      },
      get stops() {
        return state.stops;
      },
      activity,
      tellActivity: (word) => {
        activityListener?.(word);
      },
      code,
      tellCode: (frame) => {
        codeListener?.(frame);
      },
      work,
      tellWork: (frame) => {
        workListener?.(frame);
      },
      tellEnding: (frame) => {
        endingListener?.(frame);
      },
      callsEnded,
      get avatarStarts() {
        return state.avatarStarts;
      },
      avatarStops,
      tellAvatarStarted: (frame) => {
        avatarStartedListener?.(frame);
      },
      tellAvatarEnded: (frame) => {
        avatarEndedListener?.(frame);
      },
      tellAvatarUnavailable: (frame) => {
        avatarUnavailableListener?.(frame);
      },
      media,
      get reportsActivity() {
        return state.reportsActivity;
      },
      set reportsActivity(value: boolean) {
        state.reportsActivity = value;
      },
      get createGate() {
        return state.createGate;
      },
      set createGate(value: Effect.Effect<void>) {
        state.createGate = value;
      },
      open: (planId = INVITES_PLAN) =>
        Effect.gen(function* () {
          const created = yield* holder.createSession("offer", planId);
          assert.ok(created);
          const sideband = sidebands[sidebands.length - 1];
          assert.ok(sideband);
          sideband.started(created.sessionId);
          yield* settle();
          return sideband;
        }),
    };
  });
}

function phases(changes: readonly VoiceLiveSessionChanged[]) {
  return changes.map((change) => change.phase);
}

it.effect(
  "a created session is about its plan, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.deepEqual(created, {
        sessionId: "sess-1",
        sdpAnswer: "answer-for-offer",
      });
      assert.equal(f.created, 1);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(f.plans, [INVITES_PLAN]);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED]);
      f.sidebands[0]?.started("sess-1");
      yield* settle();
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
      // Nothing is sent at creation or start: the exchange is the service's, and it seeds nothing twice.
      assert.deepEqual(f.sidebands[0]?.sent, []);
    }),
);

/** What an observable stands at now: `SubscriptionRef.changes` begins with the current value. */
function now<A>(stream: Stream.Stream<A>): Effect.Effect<A | undefined> {
  return Effect.map(Stream.runHead(stream), Option.getOrUndefined);
}

/** A call standing with its face up: video asked for, the room answered, the media socket open. */
function withFace(f: Fixture) {
  return Effect.gen(function* () {
    yield* f.open();
    f.holder.setVideo(true);
    f.tellAvatarStarted(STARTED_FRAME);
    yield* settle();
    const media = f.media[0];
    assert.ok(media);
    return media;
  });
}

it.effect("a chunk of Luke's voice reaches the face's media socket once its room stands", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.open();
    f.holder.setVideo(true);
    yield* settle();
    assert.equal(f.avatarStarts, 1);
    assert.deepEqual(yield* now(f.holder.avatarStatus), { status: HELD_AVATAR_STATUS.STARTING });
    // A chunk before the room stands has no socket to take it and is dropped.
    yield* f.holder.avatarAudio(new Uint8Array([9]));
    f.tellAvatarStarted(STARTED_FRAME);
    yield* settle();
    const media = f.media[0];
    assert.equal(media?.url, STARTED_FRAME.mediaUrl);
    assert.deepEqual(yield* now(f.holder.avatarStatus), { status: HELD_AVATAR_STATUS.STARTED });
    assert.deepEqual(yield* now(f.holder.avatarRoom), {
      livekitUrl: STARTED_FRAME.livekitUrl,
      viewerToken: STARTED_FRAME.viewerToken,
    });
    const chunk = new Uint8Array([1, 2, 3, 4]);
    yield* f.holder.avatarAudio(chunk);
    yield* f.holder.avatarInterrupt();
    assert.deepEqual(media?.spoken, [chunk]);
    assert.equal(media?.interrupts, 1);
    // The room's token is the call window's alone: no phase the peer is told carries it.
    assert.ok(!JSON.stringify(f.changes).includes(STARTED_FRAME.viewerToken));
  }),
);

it.effect("video off stops the face, releases its socket, and leaves the call standing", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const media = yield* withFace(f);
    f.holder.setVideo(false);
    yield* settle();
    assert.deepEqual(f.avatarStops, [AVATAR_STOP_REASON.USER]);
    assert.equal(media.released, true);
    assert.deepEqual(yield* now(f.holder.avatarStatus), {
      status: HELD_AVATAR_STATUS.ENDED,
      reason: AVATAR_END_REASON.USER,
    });
    assert.equal(yield* now(f.holder.avatarRoom), undefined);
    yield* f.holder.avatarAudio(new Uint8Array([1]));
    assert.deepEqual(media.spoken, []);
    assert.equal(f.holder.sessionStands(), true);
    // The service's echo of the stop says nothing new.
    f.tellAvatarEnded({ type: VOICE_SERVICE_FRAME.AVATAR_ENDED, reason: AVATAR_END_REASON.USER });
    yield* settle();
    assert.deepEqual(f.avatarStops, [AVATAR_STOP_REASON.USER]);
    // Video on again asks for a new face.
    f.holder.setVideo(true);
    assert.equal(f.avatarStarts, 2);
  }),
);

it.effect("a media socket that ends for good tells the service the media is lost", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const media = yield* withFace(f);
    yield* Deferred.succeed(media.end, { reason: AVATAR_MEDIA_END_REASON.LOST });
    yield* settle();
    assert.deepEqual(f.avatarStops, [AVATAR_STOP_REASON.MEDIA_LOST]);
    assert.equal(media.released, true);
    assert.deepEqual(yield* now(f.holder.avatarStatus), {
      status: HELD_AVATAR_STATUS.ENDED,
      reason: AVATAR_END_REASON.MEDIA_LOST,
    });
    assert.equal(f.holder.sessionStands(), true);
  }),
);

it.effect("the service's end of the face releases its socket and says why", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const media = yield* withFace(f);
    f.tellAvatarEnded({
      type: VOICE_SERVICE_FRAME.AVATAR_ENDED,
      reason: AVATAR_END_REASON.MAX_DURATION,
    });
    yield* settle();
    assert.equal(media.released, true);
    assert.deepEqual(f.avatarStops, []);
    assert.deepEqual(yield* now(f.holder.avatarStatus), {
      status: HELD_AVATAR_STATUS.ENDED,
      reason: AVATAR_END_REASON.MAX_DURATION,
    });
    assert.equal(yield* now(f.holder.avatarRoom), undefined);
  }),
);

it.effect("a face the service cannot put up leaves the call as voice", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.open();
    f.holder.setVideo(true);
    f.tellAvatarUnavailable({
      type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
      reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
    });
    yield* settle();
    assert.deepEqual(yield* now(f.holder.avatarStatus), {
      status: HELD_AVATAR_STATUS.UNAVAILABLE,
      reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
    });
    assert.deepEqual(f.media, []);
    assert.equal(f.holder.sessionStands(), true);
  }),
);

it.effect("a room for a face turned off while it was minted opens no socket", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.open();
    f.holder.setVideo(true);
    f.holder.setVideo(false);
    f.tellAvatarStarted(STARTED_FRAME);
    yield* settle();
    assert.deepEqual(f.avatarStops, [AVATAR_STOP_REASON.USER]);
    assert.deepEqual(f.media, []);
    assert.equal(yield* now(f.holder.avatarRoom), undefined);
  }),
);

it.effect("the call's end takes the face with it", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const media = yield* withFace(f);
    const sideband = f.sidebands[0];
    assert.ok(sideband);
    sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 30);
    yield* settle();
    assert.equal(media.released, true);
    assert.deepEqual(yield* now(f.holder.avatarStatus), { status: HELD_AVATAR_STATUS.OFF });
    assert.equal(yield* now(f.holder.avatarRoom), undefined);
  }),
);
