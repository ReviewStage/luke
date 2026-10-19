import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AVATAR_VIEW_SIGNAL, type AvatarViewSignal } from "@luke/voice/avatar-view";
import { Effect, Fiber, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  type AvatarViewDoors,
  shareAvatarView,
  type ViewPeerConnection,
  type ViewSender,
  type ViewTransceiver,
  viewAvatar,
} from "./avatar-view.js";

/**
 * avatar-view.test.ts -- the call window's view of the avatar's video over fake peer connections joined back to back: what the window draws as the panel sends, stops, and is gone, and the signals main relays between them.
 */

/** A remote track as WebRTC hands one over: muted until media flows on it, and muted again when it stops. */
class FakeTrack extends EventTarget {
  muted = true;
  readyState = "live";

  constructor(readonly id: string) {
    super();
  }

  getSettings() {
    return { width: 1280 };
  }

  flows(flowing: boolean): void {
    if (this.muted === !flowing) return;
    this.muted = !flowing;
    this.dispatchEvent(new Event(flowing ? "unmute" : "mute"));
  }
}

// SAFETY: the link reads only a track's `muted`, `readyState`, events, and settings, and compares it by identity.
const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack;

/** The avatar's video as the panel holds it, which the fake line carries to the window's remote track. */
const AVATAR = new FakeTrack("avatar-video");

/**
 * Two fake peer connections joined by their descriptions: the window's offer
 * names it, the panel's answer to that offer is what the window applies, and
 * what the panel's sender carries is what flows on the window's remote track.
 */
class FakePeer implements ViewPeerConnection {
  /** Each window peer by the offer it made, for the panel peer that takes that offer. */
  static readonly offered = new Map<string, FakePeer>();
  readonly iceGatheringState = "complete";
  localDescription: { sdp: string } | null = null;
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  readonly transceivers: ViewTransceiver[] = [];
  readonly remote: FakeTrack;
  /** The window's peer this panel peer answered, once it has. */
  viewer: FakePeer | undefined;
  closed = false;

  constructor(readonly name: string) {
    this.remote = new FakeTrack(`remote-of-${name}`);
  }

  addTransceiver(): void {}

  getTransceivers(): readonly ViewTransceiver[] {
    return this.transceivers;
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    FakePeer.offered.set(this.name, this);
    return Promise.resolve({ type: "offer", sdp: this.name });
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: "answer", sdp: `answer-${this.viewer?.name}` });
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = { sdp: description.sdp ?? "" };
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (description.type === "offer") {
      const viewer = FakePeer.offered.get(description.sdp ?? "");
      this.viewer = viewer;
      const sender: ViewSender = {
        replaceTrack: (track) => {
          viewer?.remote.flows(track !== null && !this.closed);
          return Promise.resolve();
        },
        getParameters: () => ({
          encodings: [{}],
          transactionId: "",
          codecs: [],
          headerExtensions: [],
          rtcp: {},
        }),
        setParameters: () => Promise.resolve(),
      };
      this.transceivers.push({ direction: "recvonly", sender });
    } else {
      // SAFETY: the link reads only the event's track.
      this.ontrack?.({ track: asTrack(this.remote) } as RTCTrackEvent);
    }
    return Promise.resolve();
  }

  close(): void {
    this.closed = true;
    this.viewer?.remote.flows(false);
  }
}

/**
 * The two windows and main between them: each end's doors, main relaying the
 * window's offers and closes to the panel and the panel's answers to the
 * window, every signal written down as it passes.
 */
const windows = Effect.fnUntraced(function* (options: { panelAnswers?: boolean } = {}) {
  const relayed: AvatarViewSignal[] = [];
  const toPanel = new Set<(signal: AvatarViewSignal) => void>();
  const toWindow = new Set<(signal: AvatarViewSignal) => void>();
  const panelPeers: FakePeer[] = [];
  const windowPeers: FakePeer[] = [];
  const made = () => `peer-${panelPeers.length + windowPeers.length + 1}`;
  const subscribe =
    (listeners: Set<(signal: AvatarViewSignal) => void>) =>
    (deliver: (signal: AvatarViewSignal) => void) => {
      listeners.add(deliver);
      return () => listeners.delete(deliver);
    };
  const panel: AvatarViewDoors = {
    subscribe: subscribe(toPanel),
    send: (signal) =>
      Effect.sync(() => {
        relayed.push(signal);
        for (const deliver of toWindow) deliver(signal);
      }),
    createPeer: () => {
      const peer = new FakePeer(made());
      panelPeers.push(peer);
      return peer;
    },
  };
  const callWindow: AvatarViewDoors = {
    subscribe: subscribe(toWindow),
    send: (signal) =>
      Effect.sync(() => {
        relayed.push(signal);
        if (options.panelAnswers === false) return;
        for (const deliver of toPanel) deliver(signal);
      }),
    createPeer: () => {
      const peer = new FakePeer(made());
      windowPeers.push(peer);
      return peer;
    },
  };
  /** What the panel sends: the avatar's track, or nothing while the panel has the keyboard. */
  const sent = yield* Queue.unbounded<MediaStreamTrack | undefined>();
  yield* Effect.forkScoped(shareAvatarView(Stream.fromQueue(sent), panel));
  yield* settle;
  return { relayed, sent, callWindow, panelPeers, windowPeers };
});

const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 30; turn += 1) yield* Effect.yieldNow;
});

/** The window's view as `view`, every track it draws written down in order, the window's own scope closing it. */
const opened = Effect.fnUntraced(function* (doors: AvatarViewDoors, view: string) {
  const drawn: (string | undefined)[] = [];
  const fiber = yield* Effect.forkChild(
    Stream.runForEach(viewAvatar(doors, view), (track) =>
      Effect.sync(() => {
        drawn.push(track?.id);
      }),
    ),
  );
  yield* settle;
  return { drawn, fiber };
});

it.effect(
  "the call window draws the panel's track while frames flow, its still face while the panel has the keyboard, and closes its view with its card",
  () =>
    Effect.gen(function* () {
      const w = yield* windows();
      yield* Queue.offer(w.sent, asTrack(AVATAR));
      const view = yield* opened(w.callWindow, "view-1");
      const [remote] = w.windowPeers;
      assert.ok(remote);
      // Answered, and drawing the panel's frames as they arrive.
      assert.deepEqual(
        w.relayed.map((signal) => signal.kind),
        [AVATAR_VIEW_SIGNAL.OFFER, AVATAR_VIEW_SIGNAL.ANSWER],
      );
      assert.deepEqual(view.drawn, [remote.remote.id]);

      // The panel takes the keyboard, so the call window is gone and nothing is sent.
      yield* Queue.offer(w.sent, undefined);
      yield* settle;
      assert.deepEqual(view.drawn, [remote.remote.id, undefined]);
      // And gives it up again: the same view draws again, with no new offer.
      yield* Queue.offer(w.sent, asTrack(AVATAR));
      yield* settle;
      assert.deepEqual(view.drawn, [remote.remote.id, undefined, remote.remote.id]);
      assert.equal(w.relayed.length, 2);

      // The card stops drawing the avatar: the window closes its view, and the panel its end.
      yield* Fiber.interrupt(view.fiber);
      yield* settle;
      assert.deepEqual(w.relayed.at(-1), { kind: AVATAR_VIEW_SIGNAL.CLOSE, view: "view-1" });
      assert.ok(remote.closed);
      assert.ok(w.panelPeers.every((peer) => peer.closed));
    }),
);

it.effect("a fresh view replaces the one before it, whose late close reaches nothing", () =>
  Effect.gen(function* () {
    const w = yield* windows();
    yield* Queue.offer(w.sent, asTrack(AVATAR));
    const first = yield* opened(w.callWindow, "view-1");
    const second = yield* opened(w.callWindow, "view-2");
    const [firstPanel, secondPanel] = w.panelPeers;
    assert.ok(firstPanel?.closed, "the panel's end of the first view went with it");
    yield* Fiber.interrupt(first.fiber);
    yield* settle;
    assert.equal(secondPanel?.closed, false);
    assert.equal(second.drawn.at(-1), w.windowPeers[1]?.remote.id);
  }),
);

it.effect("a view the panel never answers draws the still face, and is closed", () =>
  Effect.gen(function* () {
    const w = yield* windows({ panelAnswers: false });
    const view = yield* opened(w.callWindow, "view-1");
    assert.deepEqual(view.drawn, []);
    yield* TestClock.adjust("5 seconds");
    yield* settle;
    assert.deepEqual(view.drawn, [undefined]);
    assert.deepEqual(w.relayed.at(-1), { kind: AVATAR_VIEW_SIGNAL.CLOSE, view: "view-1" });
    assert.ok(w.windowPeers[0]?.closed);
  }),
);
