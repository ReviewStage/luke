/**
 * contract.ts -- what the call window and the avatar room bundle say to each other: the one room the bundle makes, as the narrowest slice of LiveKit's `Room` the viewer touches.
 *
 * The avatar's face and voice arrive in a LiveKit room that LiveAvatar
 * publishes into, and `livekit-client` is too large for the bundle every
 * window parses, so it ships as a bundle of its own (`avatar-room.js`, built
 * from `./index.ts`) that the call window loads the first time a call turns
 * its video on, as the Plans tab loads the whiteboard. That bundle sets one
 * global, `window.lukeAvatarRoom`, and this file is the whole of what the two
 * share: no LiveKit type crosses, only the browser's own `MediaStreamTrack`,
 * and nothing here imports a value, so the call window carries none of
 * LiveKit until it asks for it.
 *
 * The slice is written the way `../voice/live-peer.ts` writes the browser's
 * peer, so a test stands a fake in for the room without a browser or a
 * LiveKit server.
 */

/** The room as the viewer drives it: join, watch what is published, and leave. */
export interface AvatarRoomConnection {
  /** Joins the room at `url` on the viewer's token, subscribing to whatever is published. */
  connect(url: string, token: string): Promise<void>;
  /** Leaves the room. A room never joined, or already left, leaves at once. */
  disconnect(): Promise<void>;
  /** Every remote track subscribed so far, for the ones published before `connect` settled. */
  remoteTracks(): readonly MediaStreamTrack[];
  /** A remote track the room subscribed to after the handler was set. */
  ontrack: ((track: MediaStreamTrack) => void) | null;
  /** The room is gone: the server closed it, the token ran out, or the link dropped past LiveKit's own retries. */
  ondisconnected: (() => void) | null;
}

/** What the avatar room bundle sets on `window` once it has loaded. */
export interface AvatarRoomModule {
  readonly createRoom: () => AvatarRoomConnection;
}

declare global {
  interface Window {
    lukeAvatarRoom?: AvatarRoomModule;
  }
}

/** The file the avatar room bundle is, beside `call.html`. */
export const AVATAR_ROOM_ASSET = { SCRIPT: "avatar-room.js" } as const;
