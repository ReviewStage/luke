/**
 * index.ts -- the avatar room's own bundle: LiveKit's `Room`, adapted to the slice the viewer drives (`./contract.ts`).
 *
 * Adaptive stream and dynacast are off: the room holds one avatar publishing
 * one video and one audio track for one viewer, so there is no layer to pick
 * by an element's size and no subscriber to pause a layer for, and a track
 * handed out before any element is attached must not be paused for being
 * unseen.
 */

import { type RemoteTrack, Room, RoomEvent } from "livekit-client";
import type { AvatarRoomConnection, AvatarRoomModule } from "./contract";

function createRoom(): AvatarRoomConnection {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const connection: AvatarRoomConnection = {
    connect: (url, token) => room.connect(url, token, { autoSubscribe: true }),
    disconnect: () => room.disconnect(),
    remoteTracks: () =>
      [...room.remoteParticipants.values()].flatMap((participant) =>
        [...participant.trackPublications.values()].flatMap((publication) =>
          publication.track ? [publication.track.mediaStreamTrack] : [],
        ),
      ),
    ontrack: null,
    ondisconnected: null,
  };
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    connection.ontrack?.(track.mediaStreamTrack);
  });
  room.on(RoomEvent.Disconnected, () => {
    connection.ondisconnected?.();
  });
  return connection;
}

window.lukeAvatarRoom = { createRoom } satisfies AvatarRoomModule;
