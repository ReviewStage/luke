/**
 * avatar-view.ts -- Luke's avatar's video carried from the panel to the floating call window, over a WebRTC connection between the two windows on this Mac.
 *
 * The panel runs the avatar's session (`call-avatar.ts`), and Keyframe's
 * token may reach no other window, so the call window cannot join the room
 * itself; a second participant would cost a second subscription and the
 * avatar's one identity besides. Nor can a track cross from one renderer to
 * another. So the panel hands its track on the standard way two pages share
 * live media: a peer connection between them, signalled through main
 * (`@luke/voice/avatar-view`). The call window offers to receive video while
 * its card draws the avatar live, the panel answers with the track it plays,
 * and it replaces that track as the avatar's sessions come and go, so a
 * restart needs no new offer. Each end gathers its candidates before it
 * sends its description, so nothing trickles.
 *
 * The panel encodes the track once more for the window, at no more than the
 * window draws it (`VIEW_SEND`), and only while no Luke window has the
 * keyboard, which is exactly while the call window stands: a focused panel
 * sends nothing and the connection idles, the hidden window holding its
 * last frame, or Luke's still face once the track reads muted, until frames
 * flow again as it is shown.
 */

import { useAtomValue } from "@effect/atom-react/Hooks";
import { appBridge } from "@luke/panel/app-bridge";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
import { gatherIce } from "@luke/panel/voice/live-peer";
import {
  AVATAR_VIEW_SIGNAL,
  type AvatarViewOffer,
  type AvatarViewSignal,
} from "@luke/voice/avatar-view";
import { Duration, Effect, Option, Queue, type Scope, Stream, SubscriptionRef } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { callAvatarAtom } from "./call-avatar";

/** How long the call window waits on the panel's answer before it draws the still face instead. */
const ANSWER_TIMEOUT_MS = 5_000;

/**
 * The most the panel sends the window: twice the window's 222px tile
 * across, for a Retina screen, rounded up, and a bitrate that carries that
 * well.
 */
const VIEW_SEND = { MAX_WIDTH: 640, MAX_BITRATE: 1_000_000 } as const;

/** What a track does that changes whether frames flow on it. */
const TRACK_EVENTS = ["mute", "unmute", "ended"] as const;

/** The slice of a sender the panel touches. */
export interface ViewSender {
  replaceTrack(track: MediaStreamTrack | null): Promise<void>;
  getParameters(): RTCRtpSendParameters;
  setParameters(parameters: RTCRtpSendParameters): Promise<void>;
}

export interface ViewTransceiver {
  direction: RTCRtpTransceiverDirection;
  readonly sender: ViewSender;
}

/** The slice of the browser's peer connection either end touches, so a test can stand a fake in for it. */
export interface ViewPeerConnection {
  readonly iceGatheringState: string;
  readonly localDescription: { readonly sdp: string } | null;
  addTransceiver(kind: "video", init: { direction: "recvonly" }): void;
  getTransceivers(): readonly ViewTransceiver[];
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  close(): void;
  onicegatheringstatechange: ((event: Event) => void) | null;
  ontrack: ((event: RTCTrackEvent) => void) | null;
}

/** What either end reaches: main's signals both ways, and a fresh peer connection. */
export interface AvatarViewDoors {
  /** Delivers every signal main relays to this window, until the stop it answers. */
  readonly subscribe: (deliver: (signal: AvatarViewSignal) => void) => () => void;
  readonly send: (signal: AvatarViewSignal) => Effect.Effect<void>;
  readonly createPeer: () => ViewPeerConnection;
}

/** The window's view where there is none: no track, which the tile draws as the still face. */
const NOT_VIEWED: Stream.Stream<MediaStreamTrack | undefined> = Stream.make(undefined);

/** Main's signals to this window, for as long as the scope that asked stands. */
const signalsOf = (doors: AvatarViewDoors): Stream.Stream<AvatarViewSignal> =>
  Stream.callback<AvatarViewSignal>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        doors.subscribe((signal) => {
          Queue.offerUnsafe(queue, signal);
        }),
      ),
      (stop) => Effect.sync(stop),
    ),
  );

/** A peer connection for the scope's life, closed with it. */
const acquirePeer = (doors: AvatarViewDoors) =>
  Effect.acquireRelease(
    Effect.try(() => doors.createPeer()),
    (peer) => Effect.sync(() => peer.close()),
  );

/** The description `made` set as this end's own, with every candidate gathered into it. */
const describe = Effect.fnUntraced(function* (
  peer: ViewPeerConnection,
  made: RTCSessionDescriptionInit,
) {
  yield* Effect.tryPromise(() => peer.setLocalDescription(made));
  yield* gatherIce(peer);
  const sdp = peer.localDescription?.sdp;
  if (!sdp) return yield* Effect.fail(new Error("The peer produced no description."));
  return sdp;
});

/**
 * The track on the window's line, or nothing, at no more than the window
 * draws it. Note that a sender that cannot be fitted still sends, because a
 * larger picture than the window needs costs the panel more than no picture
 * costs the developer.
 */
const sendOn = (sender: ViewSender, track: MediaStreamTrack | undefined): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => sender.replaceTrack(track ?? null));
    const width = track?.getSettings().width;
    if (width === undefined) return;
    const parameters = sender.getParameters();
    for (const encoding of parameters.encodings) {
      encoding.maxBitrate = VIEW_SEND.MAX_BITRATE;
      encoding.scaleResolutionDownBy = Math.max(1, width / VIEW_SEND.MAX_WIDTH);
    }
    yield* Effect.tryPromise(() => sender.setParameters(parameters));
  }).pipe(Effect.ignore);

/**
 * One view the window offered, answered for the life of the scope: the
 * offer taken, the window's one video line turned to send, the answer sent
 * back, and the track the panel is sending kept on that line from then on.
 * A view that cannot be answered leaves the window waiting out its answer,
 * on the still face.
 */
const answerView = (
  offer: AvatarViewOffer,
  sent: SubscriptionRef.SubscriptionRef<MediaStreamTrack | undefined>,
  doors: AvatarViewDoors,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const peer = yield* acquirePeer(doors);
    yield* Effect.tryPromise(() => peer.setRemoteDescription({ type: "offer", sdp: offer.sdp }));
    const [line] = peer.getTransceivers();
    if (line === undefined) return;
    line.direction = "sendonly";
    const answer = yield* Effect.tryPromise(() => peer.createAnswer());
    const sdp = yield* describe(peer, answer);
    yield* doors.send({ kind: AVATAR_VIEW_SIGNAL.ANSWER, view: offer.view, sdp });
    yield* Stream.runForEach(SubscriptionRef.changes(sent), (track) => sendOn(line.sender, track));
  }).pipe(Effect.ignore);

/** The view the window holds open: its latest offer, until it closes that one. */
function standingView(
  standing: AvatarViewOffer | undefined,
  signal: AvatarViewSignal,
): readonly [AvatarViewOffer | undefined, ReadonlyArray<AvatarViewOffer | undefined>] {
  switch (signal.kind) {
    case AVATAR_VIEW_SIGNAL.OFFER:
      return [signal, [signal]];
    case AVATAR_VIEW_SIGNAL.CLOSE:
      return standing?.view === signal.view ? [undefined, [undefined]] : [standing, []];
    case AVATAR_VIEW_SIGNAL.ANSWER:
      return [standing, []];
  }
}

/**
 * The panel's end: every view the call window offers is answered with the
 * track `sent` holds, which follows that track for as long as the view
 * stands. A fresh offer replaces the view before it, since the window holds
 * one at a time, and a close ends the one it names.
 */
export const shareAvatarView = (
  sent: Stream.Stream<MediaStreamTrack | undefined, unknown>,
  doors: AvatarViewDoors,
): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const held = yield* SubscriptionRef.make<MediaStreamTrack | undefined>(undefined);
      yield* Effect.forkScoped(
        Effect.ignore(Stream.runForEach(sent, (track) => SubscriptionRef.set(held, track))),
      );
      yield* signalsOf(doors).pipe(
        Stream.mapAccum((): AvatarViewOffer | undefined => undefined, standingView),
        Stream.switchMap((offer) =>
          offer === undefined
            ? Stream.empty
            : Stream.fromEffectDrain(Effect.scoped(answerView(offer, held, doors))),
        ),
        Stream.runDrain,
      );
    }),
  );

/** A track as the window draws it: itself while frames flow on it, and nothing while they do not. */
const flowing = (track: MediaStreamTrack): Stream.Stream<MediaStreamTrack | undefined> =>
  Stream.callback<MediaStreamTrack | undefined>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const told = () => {
          const drawn = track.muted || track.readyState === "ended" ? undefined : track;
          Queue.offerUnsafe(queue, drawn);
        };
        for (const event of TRACK_EVENTS) track.addEventListener(event, told);
        told();
        return told;
      }),
      (told) =>
        Effect.sync(() => {
          for (const event of TRACK_EVENTS) track.removeEventListener(event, told);
        }),
    ),
  ).pipe(Stream.changes);

/**
 * The call window's end, for the life of the stream: one video line offered
 * as `view`, the panel's answer awaited under its bound, and the track it
 * sends drawn while frames flow on it. The view is closed with the stream,
 * and the panel told. Note that the answers are listened for before the
 * offer is sent, because the panel may answer before a later subscription
 * would stand.
 */
const openView = Effect.fnUntraced(function* (doors: AvatarViewDoors, view: string) {
  const answers = yield* Queue.unbounded<string>();
  yield* Effect.acquireRelease(
    Effect.try(() =>
      doors.subscribe((signal) => {
        if (signal.kind === AVATAR_VIEW_SIGNAL.ANSWER && signal.view === view) {
          Queue.offerUnsafe(answers, signal.sdp);
        }
      }),
    ),
    (stop) => Effect.sync(stop),
  );
  const tracks = yield* Queue.unbounded<MediaStreamTrack>();
  const peer = yield* acquirePeer(doors);
  yield* Effect.addFinalizer(() => doors.send({ kind: AVATAR_VIEW_SIGNAL.CLOSE, view }));
  peer.ontrack = (event) => {
    Queue.offerUnsafe(tracks, event.track);
  };
  yield* Effect.try(() => peer.addTransceiver("video", { direction: "recvonly" }));
  const offer = yield* Effect.tryPromise(() => peer.createOffer());
  const sdp = yield* describe(peer, offer);
  yield* doors.send({ kind: AVATAR_VIEW_SIGNAL.OFFER, view, sdp });
  const answer = yield* Effect.timeout(Queue.take(answers), Duration.millis(ANSWER_TIMEOUT_MS));
  yield* Effect.tryPromise(() => peer.setRemoteDescription({ type: "answer", sdp: answer }));
  return flowing(yield* Queue.take(tracks));
});

/** The call window's view of the avatar as `view`: the track while frames flow on it, and nothing otherwise, a view that fails included. */
export const viewAvatar = (
  doors: AvatarViewDoors,
  view: string,
): Stream.Stream<MediaStreamTrack | undefined> =>
  Stream.unwrap(openView(doors, view).pipe(Effect.catch(() => Effect.succeed(NOT_VIEWED))));

/** Whether this window has the keyboard, as it moves. */
const windowFocused: Stream.Stream<boolean> = Stream.callback<boolean>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const focus = () => Queue.offerUnsafe(queue, true);
      const blur = () => Queue.offerUnsafe(queue, false);
      window.addEventListener("focus", focus);
      window.addEventListener("blur", blur);
      Queue.offerUnsafe(queue, document.hasFocus());
      return { focus, blur };
    }),
    ({ focus, blur }) =>
      Effect.sync(() => {
        window.removeEventListener("focus", focus);
        window.removeEventListener("blur", blur);
      }),
  ),
);

/** Either window's doors: main's channel each way, and the browser's own peer connection. */
const windowDoors: AvatarViewDoors = {
  subscribe: (deliver) => appBridge().onAvatarViewSignal(deliver),
  send: (signal) => Effect.sync(() => appBridge().signalAvatarView(signal)),
  createPeer: () => new RTCPeerConnection(),
};

/**
 * The panel's end, mounted beside its avatar's voice: the avatar's video,
 * sent while the panel does not have the keyboard, to whichever view the
 * call window holds open. Only the call window ever offers one.
 */
export const avatarViewShareAtom = rendererRuntime.atom((get) =>
  shareAvatarView(
    Stream.zipLatestWith(
      get.streamResult(callAvatarAtom).pipe(Stream.map((tracks) => tracks.video)),
      windowFocused,
      (video, focused) => (focused ? undefined : video),
    ).pipe(Stream.changes),
    windowDoors,
  ),
);

/** The call window's view, opened afresh each time a card mounts it and closed once none reads it. */
const avatarViewAtom = rendererRuntime.atom(
  Stream.suspend(() => viewAvatar(windowDoors, crypto.randomUUID())),
);

const notViewingAtom = Atom.make(AsyncResult.initial<MediaStreamTrack | undefined, never>());

/** The avatar's video as the call window draws it, viewed only while `wanted`. */
export function useAvatarView(wanted: boolean): MediaStreamTrack | undefined {
  return Option.getOrUndefined(
    AsyncResult.value(useAtomValue(wanted ? avatarViewAtom : notViewingAtom)),
  );
}
