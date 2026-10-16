/**
 * video-avatar.ts -- the avatars Luke can appear as on a video call, as the Mac chooses one and the voice service mints it.
 *
 * A door of its own, apart from `live-contract.ts`, because the settings
 * schema the renderer bundles reads this list, and the barrel would carry
 * every frame of the voice socket into that bundle behind it.
 *
 * Each avatar but the default is one of Keyframe's stock `persona-1.5-live`
 * avatars, named as Keyframe's avatar library names it
 * (https://docs.keyframelabs.com/guides/resources/avatar-library). The Mac
 * names an avatar by its key alone and never by Keyframe's persona id: the
 * service maps the key to the persona it mints on Luke's key, so a Mac can
 * ask for no persona this list does not hold. The default is the persona the
 * deployment names (`LUKE_KEYFRAME_PERSONA_ID`), which an `avatar.start`
 * naming no avatar asks for, as every start from a build before this list did.
 */

import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/** Every avatar's key: what the Mac stores its choice under and names on `avatar.start`. */
export const VIDEO_AVATAR = {
  /** The deployment's own persona, the one every call opened with before there was a choice. */
  DEFAULT: "default",
  ATLAS: "atlas",
  CASPIAN: "caspian",
  CASSIDY: "cassidy",
  CELIA: "celia",
  COSMO: "cosmo",
  LYRA: "lyra",
  ORION: "orion",
  SELENE: "selene",
} as const;

export type VideoAvatar = (typeof VIDEO_AVATAR)[keyof typeof VIDEO_AVATAR];

/** Every avatar, in the order the setting offers them: the default first, then Keyframe's library by name. */
export const VIDEO_AVATAR_LIST: readonly VideoAvatar[] = Object.values(VIDEO_AVATAR);

/** Each avatar as the setting's menu words it. */
export const VIDEO_AVATAR_NAME = {
  [VIDEO_AVATAR.DEFAULT]: "Default",
  [VIDEO_AVATAR.ATLAS]: "Atlas",
  [VIDEO_AVATAR.CASPIAN]: "Caspian",
  [VIDEO_AVATAR.CASSIDY]: "Cassidy",
  [VIDEO_AVATAR.CELIA]: "Celia",
  [VIDEO_AVATAR.COSMO]: "Cosmo",
  [VIDEO_AVATAR.LYRA]: "Lyra",
  [VIDEO_AVATAR.ORION]: "Orion",
  [VIDEO_AVATAR.SELENE]: "Selene",
} as const satisfies Record<VideoAvatar, string>;

const readsVideoAvatar = Schema.is(Schema.Literals(VIDEO_AVATAR_LIST));

/** Whether a value names an avatar this build lists. */
export function isVideoAvatar(value: UnparsedWireValue): value is VideoAvatar {
  return readsVideoAvatar(value);
}
