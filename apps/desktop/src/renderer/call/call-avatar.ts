/**
 * call-avatar.ts -- Luke's avatar as the panel runs it: Keyframe's session for as long as main hands a grant, fed Luke's voice, and reported as starting, live, and ended.
 *
 * Main hands the panel the call's grant, or nothing once the session is to
 * close, on a one-shot channel of its own (`app:avatar-session`), and relays
 * the voice window's feed on another (`app:avatar-feed`). Each grant opens
 * one session into a scope of its own, and the next grant, or nothing,
 * closes that scope and with it the session: there is no other way a session
 * ends from this side. The feed is mapped exactly as Keyframe's own bridge
 * maps it, and the panel reports the avatar to main with the act only it
 * may send: `STARTING` once a grant stands, `LIVE` once the first frame of
 * video has drawn and the voice has arrived, and `ENDED` with the reason the session closed for.
 *
 * The grant's token reaches the panel and the session it opens, and is
 * never reported, logged, or held anywhere but the scope it opened.
 */

import type { AvatarGrant } from "@luke/features/avatar-grant";
import { ACT_KIND, type ActPayload } from "@luke/host/acts";
import {
  AVATAR_CLOSE_REASON,
  type AvatarCloseReason,
  type AvatarSession,
  openAvatarSession,
} from "@luke/ui/avatar-session";
import type { AvatarSessionModule } from "@luke/ui/avatar-session-contract";
import {
  AVATAR_END_REASON,
  AVATAR_FEED_KIND,
  AVATAR_STATUS,
  type AvatarEndReason,
  type AvatarFeed,
} from "@luke/voice/avatar";
import {
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Result,
  Schedule,
  type Scope,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { tellAct } from "../act";
import { appBridge } from "../app-bridge";
import { avatarSessionAtom } from "../bundle-loader";
import { rendererRegistry, rendererRuntime } from "../renderer-runtime";

/** How long a refused play of the avatar's voice waits to be asked again, as the voice window's own element does. */
const AUDIO_RETRY_MS = 1_000;

/** The avatar as this window reports it to main. */
export type AvatarReport = ActPayload<typeof ACT_KIND.AVATAR_REPORT>;

/** What a running avatar reaches beyond its session: Luke's voice feed, main's document, and the SDK's bundle. */
export interface CallAvatarDoors {
  /** The voice feed main relays, read from the session's open to its close. */
  readonly feeds: Stream.Stream<AvatarFeed>;
  readonly report: (avatar: AvatarReport) => Effect.Effect<void>;
  readonly module: Effect.Effect<AvatarSessionModule, Error>;
}

/** The avatar's two tracks, each once Keyframe has published it. */
export interface CallAvatarTracks {
  readonly video?: MediaStreamTrack;
  readonly audio?: MediaStreamTrack;
}

export const NO_AVATAR_TRACKS: CallAvatarTracks = {};

/** Why the session closed, as the document names an avatar's end. */
const END_REASON_OF_CLOSE = {
  [AVATAR_CLOSE_REASON.USER]: AVATAR_END_REASON.USER,
  [AVATAR_CLOSE_REASON.SERVER_CLOSED]: AVATAR_END_REASON.SERVER_CLOSED,
  [AVATAR_CLOSE_REASON.ERROR]: AVATAR_END_REASON.ERROR,
} as const satisfies Record<AvatarCloseReason, AvatarEndReason>;

const ended = (endReason: AvatarEndReason): AvatarReport => ({
  status: AVATAR_STATUS.ENDED,
  endReason,
});

/** Two grants for the same session, which main may hand over twice. */
function sameGrant(held: AvatarGrant | undefined, next: AvatarGrant | undefined): boolean {
  if (held === undefined || next === undefined) return held === next;
  return (
    held.serverUrl === next.serverUrl &&
    held.participantToken === next.participantToken &&
    held.agentIdentity === next.agentIdentity
  );
}

/**
 * One feed message, as Keyframe's bridge in `@keyframelabs/elements` maps
 * it: a chunk is sent, a turn's end ends the audio turn, and the developer
 * cutting in ends the turn and then drops what the avatar has not shown.
 * Note that a chunk that is not base64 is dropped, though the bridge's guard
 * has already refused every one that is not.
 */
function fed(session: AvatarSession, feed: AvatarFeed): Effect.Effect<void> {
  switch (feed.kind) {
    case AVATAR_FEED_KIND.AUDIO:
      return Result.match(Base64.decode(feed.pcm), {
        onFailure: () => Effect.void,
        onSuccess: session.sendAudio,
      });
    case AVATAR_FEED_KIND.TURN_END:
      return session.endTurn;
    case AVATAR_FEED_KIND.INTERRUPT:
      return Effect.andThen(session.endTurn, session.interrupt);
  }
}

/** The video's first frame: a remote track stands muted until media flows on it. */
const firstFrame = (track: MediaStreamTrack): Effect.Effect<void> =>
  track.muted
    ? Effect.callback<void>((resume) => {
        const unmuted = () => resume(Effect.void);
        track.addEventListener("unmute", unmuted, { once: true });
        return Effect.sync(() => track.removeEventListener("unmute", unmuted));
      })
    : Effect.void;

/**
 * One grant's avatar, for the life of the scope it runs in: reported as
 * starting, opened, fed, its tracks published as each arrives, reported live
 * once the video's first frame and the voice have both arrived, and reported ended once the session closes,
 * for the reason it closed. A session that cannot be opened ends as an
 * error, and a scope closed under it ends it as the developer's own close,
 * which `callAvatar` lets through only while the grant still stands: the
 * window going away, never main withdrawing the grant, which knows why.
 */
const runAvatar = Effect.fnUntraced(
  function* (
    grant: AvatarGrant,
    doors: CallAvatarDoors,
    publish: (tracks: CallAvatarTracks) => Effect.Effect<unknown>,
  ): Effect.fn.Return<void, Error, Scope.Scope> {
    yield* doors.report({ status: AVATAR_STATUS.STARTING });
    const session = yield* openAvatarSession(grant, yield* doors.module);
    yield* Effect.forkScoped(Stream.runForEach(doors.feeds, (feed) => fed(session, feed)));
    // Note that live waits on the voice as well as the first frame, because the
    // voice window mutes Luke the moment it reads live.
    const live = yield* Effect.forkScoped(
      Effect.ignore(
        Effect.all(
          [
            Effect.flatMap(session.audio, (audio) => publish({ audio })),
            session.video.pipe(
              Effect.tap((video) => publish({ video })),
              Effect.flatMap(firstFrame),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.andThen(doors.report({ status: AVATAR_STATUS.LIVE }))),
      ),
    );
    const reason = yield* session.closed;
    // A first frame still awaited is not reported over the end.
    yield* Fiber.interrupt(live);
    yield* doors.report(ended(END_REASON_OF_CLOSE[reason]));
  },
  (body, _grant, doors) =>
    body.pipe(
      Effect.catch(() => doors.report(ended(AVATAR_END_REASON.ERROR))),
      Effect.onInterrupt(() => doors.report(ended(AVATAR_END_REASON.USER))),
    ),
);

/** One grant's avatar as the tracks it has published so far, none at first. */
const avatarOf = (grant: AvatarGrant, doors: CallAvatarDoors): Stream.Stream<CallAvatarTracks> =>
  Stream.callback<CallAvatarTracks>((queue) =>
    runAvatar(grant, doors, (tracks) => Queue.offer(queue, tracks)),
  ).pipe(
    Stream.scan(
      () => NO_AVATAR_TRACKS,
      (held, arrived) => ({ ...held, ...arrived }),
    ),
  );

/**
 * The panel's avatar over the grants main hands it: each grant runs
 * its own session, and the next grant, or nothing, closes the one before.
 * A session reports only while its grant is the one standing. Note that a
 * withdrawn session still closing, which can take as long as Keyframe's
 * `close()` takes to flush its queued audio, says nothing more, because main
 * would read its end, or a late `LIVE`, as the next grant's.
 */
export const callAvatar = (
  grants: Stream.Stream<AvatarGrant | undefined>,
  doors: CallAvatarDoors,
): Stream.Stream<CallAvatarTracks> =>
  Stream.suspend(() => {
    let standing: AvatarGrant | undefined;
    const reportingFor = (grant: AvatarGrant): CallAvatarDoors => ({
      ...doors,
      report: (avatar) =>
        Effect.suspend(() => (standing === grant ? doors.report(avatar) : Effect.void)),
    });
    return grants.pipe(
      Stream.changesWith(sameGrant),
      Stream.tap((grant) =>
        Effect.sync(() => {
          standing = grant;
        }),
      ),
      Stream.switchMap((grant) =>
        grant === undefined ? Stream.make(NO_AVATAR_TRACKS) : avatarOf(grant, reportingFor(grant)),
      ),
    );
  });

/** A bridge subscription as a stream, unsubscribed with the stream's scope. */
const subscription = <A>(subscribe: (deliver: (value: A) => void) => () => void) =>
  Stream.callback<A>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        subscribe((value) => {
          Queue.offerUnsafe(queue, value);
        }),
      ),
      (stop) => Effect.sync(stop),
    ),
  );

/** The panel's own doors: main's two channels, the act it alone may send, and the SDK's bundle. */
const windowDoors: CallAvatarDoors = {
  feeds: subscription<AvatarFeed>((deliver) => appBridge().onAvatarFeed(deliver)),
  report: (avatar) => Effect.sync(() => tellAct(ACT_KIND.AVATAR_REPORT, avatar)),
  module: AtomRegistry.getResult(rendererRegistry, avatarSessionAtom),
};

/**
 * The avatar the panel runs, as its tracks. Kept alive and mounted at the
 * renderer's root before anything is drawn, whatever tab is shown and while
 * the panel is hidden, because main hands a page the standing grant once it
 * has drawn its first frame, a subscription made later would miss it, and
 * the avatar's voice is what the developer hears. Only the panel is ever
 * handed a grant.
 */
export const callAvatarAtom = Atom.keepAlive(
  rendererRuntime.atom(
    callAvatar(
      subscription<AvatarGrant | undefined>((deliver) => appBridge().onAvatarSession(deliver)),
      windowDoors,
    ),
  ),
);

/** The element the tile plays the avatar's voice on, while it is drawn. */
export const callAvatarAudioElementAtom = Atom.keepAlive(Atom.make<HTMLAudioElement | null>(null));

/**
 * The avatar's voice, played: the element autoplays, which the panel
 * allows without a gesture, and a refused play is asked again for as long as
 * the track stands, as the voice window's own element is, because a refusal
 * is the one failure nobody would see: the avatar's lips move and nothing is
 * heard.
 */
export const callAvatarPlaybackAtom = rendererRuntime.atom((get) => {
  const element = get(callAvatarAudioElementAtom);
  const audio = Option.getOrUndefined(AsyncResult.value(get(callAvatarAtom)))?.audio;
  if (element === null || audio === undefined) return Effect.void;
  return Effect.retry(
    Effect.tryPromise(() => element.play()),
    Schedule.spaced(Duration.millis(AUDIO_RETRY_MS)),
  );
});
