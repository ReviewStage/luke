import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AVATAR_STOP_REASON, type AvatarStopReason } from "@luke/features";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { runModeFor } from "@luke/host";
import { type ActRows, type ActSender, createActRouter } from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import { AppStateStore, initialAppState } from "@luke/host/client";
import type { HostAvatar } from "@luke/host/effect";
import {
  AVATAR_END_REASON,
  AVATAR_FEED_KIND,
  AVATAR_STATUS,
  type AvatarFeed,
} from "@luke/voice/avatar";
import { AVATAR_VIEW_SIGNAL, type AvatarViewSignal } from "@luke/voice/avatar-view";
import {
  LIVE_AVATAR_END,
  LIVE_AVATAR_STATUS,
  type LiveAvatarState,
} from "@luke/voice/live-session";
import type { UnparsedWireValue } from "@luke/wire";
import { Context, Effect, PubSub, Stream } from "effect";
import type { WebContents } from "electron";
import { linkAvatar } from "../services/avatar-link";
import { avatarActRows, avatarReports } from "./avatar-acts";

/** What the document is composed from; the avatar rows read none of it. */
const RUN = {
  launch: {
    captureOutput: undefined,
    profile: "idle",
    captureMode: false,
    fixtureMode: false,
  },
  runMode: runModeFor({ capture: false, fixture: true }),
  appVersion: "0.0.0",
  packaged: false,
  platform: "darwin",
} as const;

const ROLE = { PANEL: "panel", VOICE: "voice", CALL: "call" } as const;

type Role = (typeof ROLE)[keyof typeof ROLE];

const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar-room.example.test",
  participantToken: "eyJhbGciOiJIUzI1NiJ9.grant.signature",
  agentIdentity: "keyframe-agent",
};

const CHUNK: AvatarFeed = { kind: AVATAR_FEED_KIND.AUDIO, pcm: "AAAA" };

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

/**
 * The host's avatar as a fake over the same in-process streams the holder
 * exposes: a test moves it as the service would, and a close this side did
 * not start stops it and asks once more, as the holder does on a call's
 * first such close. Its toggle answers as the holder's does: a start is
 * asked, and an off stops whatever is starting or up.
 */
function fakeHost() {
  return Effect.gen(function* () {
    const states = yield* PubSub.unbounded<LiveAvatarState>({ replay: 1 });
    const grants = yield* PubSub.unbounded<AvatarGrant | undefined>();
    let current: LiveAvatarState = { status: LIVE_AVATAR_STATUS.OFF };
    /** A restart the host stands at and has not yet told, which a test holds back to open the gap. */
    let untold: LiveAvatarState | undefined;
    const tell = (state: LiveAvatarState) => PubSub.publishUnsafe(states, state);
    const move = (state: LiveAvatarState) => {
      if (untold !== undefined) tell(untold);
      untold = undefined;
      current = state;
      tell(state);
    };
    const restarts = { told: true };
    move({ status: LIVE_AVATAR_STATUS.OFF });
    const host: HostAvatar = {
      states: Stream.fromPubSub(states),
      grants: Stream.fromPubSub(grants),
      closed: (reason: AvatarStopReason) => {
        move({ status: LIVE_AVATAR_STATUS.ENDED, end: { by: LIVE_AVATAR_END.STOPPED, reason } });
        PubSub.publishUnsafe(grants, undefined);
        if (restarts.told) {
          move({ status: LIVE_AVATAR_STATUS.STARTING });
        } else {
          current = { status: LIVE_AVATAR_STATUS.STARTING };
          untold = current;
        }
        return true;
      },
    };
    const grant = (granted: AvatarGrant) => {
      move({ status: LIVE_AVATAR_STATUS.GRANTED });
      PubSub.publishUnsafe(grants, granted);
    };
    const setVideo = (on: boolean) => {
      if (on) {
        move({ status: LIVE_AVATAR_STATUS.STARTING });
        return true;
      }
      const up =
        current.status === LIVE_AVATAR_STATUS.STARTING ||
        current.status === LIVE_AVATAR_STATUS.GRANTED;
      if (!up) return false;
      move({
        status: LIVE_AVATAR_STATUS.ENDED,
        end: { by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.USER },
      });
      return true;
    };
    return { host, move, grant, setVideo, restarts };
  });
}

function fixture() {
  return Effect.gen(function* () {
    const state = new AppStateStore(initialAppState(RUN, false, []), Context.empty());
    const { host, move, grant, setVideo, restarts } = yield* fakeHost();
    /** What reached the panel's page: each grant handed over, each feed and view signal relayed; and what reached the call window's. */
    const grants: (AvatarGrant | undefined)[] = [];
    const feeds: AvatarFeed[] = [];
    const views: AvatarViewSignal[] = [];
    const callViews: AvatarViewSignal[] = [];
    const page = { grants, feeds, views, callViews };
    /** What the Gateway's `voice.setVideo` was asked, the host being a process apart. */
    const asked: boolean[] = [];
    const avatar = yield* linkAvatar({
      host,
      state,
      panel: { showAvatarSession: (granted) => page.grants.push(granted) },
      setVideo: (on) =>
        Effect.sync(() => {
          asked.push(on);
          return setVideo(on);
        }),
    });
    yield* settle();
    const senders = {
      // SAFETY: the rows read a sender by identity alone.
      [ROLE.PANEL]: {} as WebContents,
      // SAFETY: as above.
      [ROLE.VOICE]: {} as WebContents,
      // SAFETY: as above.
      [ROLE.CALL]: {} as WebContents,
    };
    // SAFETY: only the avatar rows are under test; the router dispatches on
    // the kind alone, so the kinds this fragment does not answer are never reached.
    const router = createActRouter(avatarActRows({ avatar }) as ActRows);
    const reports = avatarReports({
      state,
      panel: {
        feedAvatar: (feed) => page.feeds.push(feed),
        signalAvatarView: (signal) => page.views.push(signal),
        owns: (sender) => sender === senders[ROLE.PANEL],
      },
      callWindow: {
        signalAvatarView: (signal) => page.callViews.push(signal),
        owns: (sender) => sender === senders[ROLE.CALL],
      },
      voiceOwns: (sender) => sender === senders[ROLE.VOICE],
    });
    const senderOf = (role: Role): ActSender => ({
      sender: senders[role],
      panel: role === ROLE.PANEL,
      voice: role === ROLE.VOICE,
      call: role === ROLE.CALL,
    });
    const perform = (role: Role, kind: ACT_KIND_UNDER_TEST, payload: UnparsedWireValue) =>
      Effect.gen(function* () {
        // SAFETY: a window's act crosses as a structured-clone value, which the router reads again.
        const act = { kind, payload } as Parameters<typeof router.performAct>[0];
        const outcome = yield* router.performAct(act, senderOf(role));
        yield* settle();
        return outcome.status;
      });
    const feed = (role: Role, sent: AvatarFeed) =>
      reports.feedAvatar({ sender: senders[role] }, sent);
    const signal = (role: Role, sent: AvatarViewSignal) =>
      reports.signalAvatarView({ sender: senders[role] }, sent);
    const moved = (next: LiveAvatarState) =>
      Effect.andThen(
        Effect.sync(() => move(next)),
        settle(),
      );
    const granted = Effect.andThen(
      Effect.sync(() => grant(GRANT)),
      settle(),
    );
    const avatarNow = () => state.snapshot().voice.avatar;
    return { perform, feed, signal, moved, granted, avatarNow, page, asked, restarts };
  });
}

type ACT_KIND_UNDER_TEST = typeof ACT_KIND.AVATAR_REPORT | typeof ACT_KIND.VOICE_SET_VIDEO;

it.effect(
  "the host's start is written at once, so the tile stands before the panel has a grant",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });
    }),
);

it.effect("the host's grant goes to the panel, and the panel's report then stands", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
    yield* f.granted;
    assert.deepEqual(f.page.grants, [GRANT]);
    assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });

    assert.equal(yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: "live" }), "done");
    assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.LIVE });
  }),
);

it.effect("the panel's report is not heard while the host holds no grant", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
    yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });
    assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });
  }),
);

it.effect("the call's end keeps its reason over the panel's own end on the grant withdrawn", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
    yield* f.granted;
    yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });

    yield* f.moved({ status: LIVE_AVATAR_STATUS.ENDED, end: { by: LIVE_AVATAR_END.CALL_ENDED } });
    yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.USER,
    });

    assert.deepEqual(f.avatarNow(), {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.CALL_ENDED,
    });
  }),
);

it.effect(
  "a close the window reports that this side did not start is told to the host, which asks again",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      yield* f.granted;
      yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });

      yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.SERVER_CLOSED,
      });

      assert.deepEqual(f.page.grants, [GRANT, undefined]);
      assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });
    }),
);

it.effect(
  "the floating call window's or the voice window's report, or the voice window's toggle, is refused and changes nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      yield* f.granted;
      for (const role of [ROLE.CALL, ROLE.VOICE]) {
        assert.equal(
          yield* f.perform(role, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE }),
          "refused",
        );
      }
      assert.equal(
        yield* f.perform(ROLE.VOICE, ACT_KIND.VOICE_SET_VIDEO, { on: false }),
        "refused",
      );
      assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });
      assert.deepEqual(f.asked, []);
    }),
);

it.effect("the floating call window's tile turns video off and on as the panel's does", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    assert.equal(yield* f.perform(ROLE.CALL, ACT_KIND.VOICE_SET_VIDEO, { on: true }), "done");
    assert.equal(yield* f.perform(ROLE.CALL, ACT_KIND.VOICE_SET_VIDEO, { on: false }), "done");
    assert.deepEqual(f.asked, [true, false]);
    assert.deepEqual(f.avatarNow(), {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.USER,
    });
  }),
);

it.effect(
  "the call window's view of the video is signalled between the call window and the panel alone, and offered only while the avatar stands",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const offer = { kind: AVATAR_VIEW_SIGNAL.OFFER, view: "view-1", sdp: "v=0 offer" } as const;
      const answer = {
        kind: AVATAR_VIEW_SIGNAL.ANSWER,
        view: "view-1",
        sdp: "v=0 answer",
      } as const;
      const close = { kind: AVATAR_VIEW_SIGNAL.CLOSE, view: "view-1" } as const;
      // No avatar up: the offer reaches nothing.
      f.signal(ROLE.CALL, offer);
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      yield* f.granted;
      yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });
      f.signal(ROLE.CALL, offer);
      f.signal(ROLE.PANEL, answer);
      // Neither end speaks for the other, and the voice window speaks for neither.
      f.signal(ROLE.PANEL, offer);
      f.signal(ROLE.VOICE, offer);
      f.signal(ROLE.CALL, answer);
      f.signal(ROLE.VOICE, answer);
      f.signal(ROLE.CALL, close);
      assert.deepEqual(f.page.views, [offer, close]);
      assert.deepEqual(f.page.callViews, [answer]);
    }),
);

it.effect(
  "a report of OFF, a reason beside any status but ENDED, or ENDED without one, is refused",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      yield* f.granted;
      const cases = [
        { status: AVATAR_STATUS.OFF },
        { status: AVATAR_STATUS.LIVE, endReason: AVATAR_END_REASON.ERROR },
        { status: AVATAR_STATUS.ENDED },
        { status: AVATAR_STATUS.ENDED, endReason: "bored" },
        { status: "paused" },
      ];
      for (const payload of cases) {
        assert.equal(yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, payload), "refused");
      }
      assert.deepEqual(f.avatarNow(), { status: AVATAR_STATUS.STARTING });
    }),
);

it.effect("the tile's Restart video and Video off reach the host's toggle", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    assert.equal(yield* f.perform(ROLE.PANEL, ACT_KIND.VOICE_SET_VIDEO, { on: true }), "done");
    assert.equal(yield* f.perform(ROLE.PANEL, ACT_KIND.VOICE_SET_VIDEO, { on: false }), "done");
    assert.deepEqual(f.asked, [true, false]);
    assert.deepEqual(f.avatarNow(), {
      status: AVATAR_STATUS.ENDED,
      endReason: AVATAR_END_REASON.USER,
    });
  }),
);

it.effect(
  "Video off once the avatar has ended takes the tile down where the host had nothing to stop",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({
        status: LIVE_AVATAR_STATUS.ENDED,
        end: { by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.SERVER_CLOSED },
      });
      assert.deepEqual(f.avatarNow(), {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.SERVER_CLOSED,
      });

      yield* f.perform(ROLE.PANEL, ACT_KIND.VOICE_SET_VIDEO, { on: false });

      assert.deepEqual(f.asked, [false]);
      assert.deepEqual(f.avatarNow(), {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.USER,
      });
    }),
);

it.effect(
  "Video off pressed after a close, before the restart reaches the document, stops the restart",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
      yield* f.granted;
      yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });

      // The close asks the host for a restart, and the off lands before its start is written.
      f.restarts.told = false;
      yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.SERVER_CLOSED,
      });
      assert.equal(f.avatarNow().status, AVATAR_STATUS.ENDED);
      yield* f.perform(ROLE.PANEL, ACT_KIND.VOICE_SET_VIDEO, { on: false });

      assert.deepEqual(f.asked, [false]);
      assert.deepEqual(f.avatarNow(), {
        status: AVATAR_STATUS.ENDED,
        endReason: AVATAR_END_REASON.USER,
      });
    }),
);

it.effect("the voice window's feed reaches the panel while the avatar starts or is live", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.feed(ROLE.VOICE, CHUNK);
    yield* f.moved({ status: LIVE_AVATAR_STATUS.STARTING });
    f.feed(ROLE.VOICE, CHUNK);
    yield* f.granted;
    yield* f.perform(ROLE.PANEL, ACT_KIND.AVATAR_REPORT, { status: AVATAR_STATUS.LIVE });
    f.feed(ROLE.VOICE, { kind: AVATAR_FEED_KIND.TURN_END });
    // The panel's own feed, or the call window's, is not the voice window's.
    f.feed(ROLE.PANEL, CHUNK);
    f.feed(ROLE.CALL, CHUNK);
    yield* f.moved({ status: LIVE_AVATAR_STATUS.ENDED, end: { by: LIVE_AVATAR_END.CALL_ENDED } });
    f.feed(ROLE.VOICE, CHUNK);

    assert.deepEqual(f.page.feeds, [CHUNK, { kind: AVATAR_FEED_KIND.TURN_END }]);
  }),
);
