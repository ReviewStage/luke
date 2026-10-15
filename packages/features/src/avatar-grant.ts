/**
 * avatar-grant.ts -- Keyframe's session grant for a call's avatar, as the service answers it and the call window joins with it.
 *
 * A door of its own, apart from `live-contract.ts`, because the desktop's
 * renderer reads a grant crossing to the call window, and the barrel would
 * carry every frame of the voice socket into that bundle behind it. The
 * `avatar.started` frame is this grant with its type and request id.
 */

import { SCHEMA_REFUSAL, type UnparsedWireValue } from "@luke/wire";
import { readEither, wireRefusal } from "@luke/wire/effect";
import { Result, Schema } from "effect";

/** The longest each of the grant's strings may be: the server address, the participant token, and the avatar's identity. */
export const AVATAR_GRANT_BOUNDS = {
  URL_CHARS: 2_048,
  TOKEN_CHARS: 8_192,
  IDENTITY_CHARS: 256,
} as const;

/** The scheme the avatar's room must be on, so a service answer can never point the call window at a plain socket. */
const AVATAR_SERVER_PROTOCOL = "wss:";

function isSecureSocketUrl(value: string): boolean {
  return URL.canParse(value) && new URL(value).protocol === AVATAR_SERVER_PROTOCOL;
}

/** Text kept as written, bounded, and refused when it is only whitespace; as `live-contract.ts` reads verbatim text. */
function verbatimText(maximumChars: number): Schema.Codec<string, string> {
  return Schema.String.check(
    Schema.isMaxLength(maximumChars),
    Schema.makeFilter((value) => value.trim().length > 0, wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
  );
}

/**
 * The grant: the LiveKit server, the participant token the call window joins
 * with, and the identity the avatar publishes its tracks under. The token can
 * view the avatar and send it audio, so it reaches the call window alone.
 */
export const avatarGrantSchema = Schema.Struct({
  /** An absolute `wss:` address, bounded, as written. */
  serverUrl: Schema.String.check(
    Schema.isMaxLength(AVATAR_GRANT_BOUNDS.URL_CHARS),
    Schema.makeFilter(isSecureSocketUrl, wireRefusal(SCHEMA_REFUSAL.MALFORMED)),
  ),
  participantToken: verbatimText(AVATAR_GRANT_BOUNDS.TOKEN_CHARS),
  agentIdentity: verbatimText(AVATAR_GRANT_BOUNDS.IDENTITY_CHARS),
});

export type AvatarGrant = typeof avatarGrantSchema.Type;

/** A grant as it crossed to the call window, or nothing where it is not one. */
export function avatarGrantFromWire(value: UnparsedWireValue): AvatarGrant | undefined {
  return Result.getOrUndefined(readEither(avatarGrantSchema)(value));
}
