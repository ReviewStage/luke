import type { AvatarGrant } from "@luke/features/avatar-grant";
import { Effect, Queue, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { appBridge } from "../app-bridge.js";
import { rendererRuntime } from "../renderer-runtime.js";

/**
 * avatar-grant.ts -- the grant main hands the panel for a call's avatar, held from before the first draw, and the tracks a running avatar publishes.
 *
 * Main hands a page the standing grant once it has drawn its first frame,
 * so a subscription made later would miss it. The avatar's session is a
 * chunk of its own, read only while the Video calls experiment is on
 * (`panel-avatar.tsx`), and that read can land after the first frame; so
 * the channel is listened to here, in the bundle every window parses, and
 * the session reads the grant standing when it lands and every one after.
 */

/** The avatar's two tracks, each once Keyframe has published it. */
export interface CallAvatarTracks {
  readonly video?: MediaStreamTrack;
  readonly audio?: MediaStreamTrack;
}

export const NO_AVATAR_TRACKS: CallAvatarTracks = {};

/** A bridge subscription as a stream, unsubscribed with the stream's scope. */
export const bridgeSubscription = <A>(subscribe: (deliver: (value: A) => void) => () => void) =>
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

/**
 * The grant standing, or nothing once its session is to close; waiting
 * until main hands one. Kept alive once read, and read from the panel's root
 * before anything is drawn (`panel-avatar.tsx`'s `panelAvatarAtom`).
 */
export const avatarGrantAtom = Atom.keepAlive(
  rendererRuntime.atom(
    bridgeSubscription<AvatarGrant | undefined>((deliver) => appBridge().onAvatarSession(deliver)),
  ),
);
