/**
 * avatar-room.ts -- the avatar's LiveKit room as main hands it to the floating call window, and to no other window.
 *
 * The viewer token joins the room LiveAvatar publishes Luke's face into, so
 * it is a credential: it travels on the call window's own one-shot channel
 * (`onAvatarRoom` in `../bridge.ts`), never in the document every window is
 * sent, and never to the voice window, a Gateway answer or event, a counted
 * event, a trace, or a fixture.
 */

import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/** Where the call's own avatar room is, and the viewer token that joins it. */
export interface CallAvatarRoom {
  readonly livekitUrl: string;
  readonly viewerToken: string;
}

/** A room as the call window is handed one, or none once the face is down. */
export function isCallAvatarRoomDelivery(value: UnparsedWireValue): boolean {
  return (
    value === undefined ||
    (isRecord(value) && isWireString(value.livekitUrl) && isWireString(value.viewerToken))
  );
}
