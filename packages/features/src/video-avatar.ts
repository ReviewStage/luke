/**
 * video-avatar.ts -- the avatars Luke can appear as on a video call, as the Mac chooses one and the voice service mints it.
 *
 * A door of its own, apart from `live-contract.ts`, because the settings
 * schema the renderer bundles reads this list, and the barrel would carry
 * every frame of the voice socket into that bundle behind it.
 *
 * Each avatar is one of Keyframe's stock `persona-1.5-live` avatars, named
 * as Keyframe's avatar library names it
 * (https://docs.keyframelabs.com/guides/resources/avatar-library). The Mac
 * names an avatar by its key alone and never by Keyframe's persona id: the
 * service maps the key to the persona it mints on Luke's key, so a Mac can
 * ask for no persona this list does not hold. Every start from this build
 * names one; the persona the deployment names (`LUKE_KEYFRAME_PERSONA_ID`) is
 * what an `avatar.start` naming none asks for, as every start from a build
 * before this list did, and is no longer a choice the Mac offers.
 */

import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/** Every avatar's key: what the Mac stores its choice under and names on `avatar.start`. */
export const VIDEO_AVATAR = {
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

/** Every avatar, in the order the setting offers them: Keyframe's library by name. */
export const VIDEO_AVATAR_LIST: readonly VideoAvatar[] = Object.values(VIDEO_AVATAR);

/**
 * The avatar a Mac shows where the developer chose none, and where it holds
 * a choice this build does not list, such as the `default` an earlier build
 * stored for the deployment's own persona.
 */
export const DEFAULT_VIDEO_AVATAR: VideoAvatar = VIDEO_AVATAR.ATLAS;

/**
 * Where Keyframe serves its stock avatars' cover photos, which the setting's
 * menu loads from there as it opens. The panel's Content Security Policy
 * names this origin and no other of Keyframe's (`apps/desktop/src/renderer/index.html`).
 */
export const VIDEO_AVATAR_COVER_ORIGIN = "https://storage-public.keyframelabs.com";

/**
 * Each stock avatar's cover photo, as Keyframe's avatar library shows it.
 * Note that a cover's path is not always its persona's id (Cosmo's is not),
 * so each address is kept whole rather than built from the id.
 */
const VIDEO_AVATAR_COVER = {
  [VIDEO_AVATAR.ATLAS]: "/personas/81b834ee-8aaa-4796-861e-5b206f6e1bff/cover.jpg",
  [VIDEO_AVATAR.CASPIAN]: "/personas/b5a52072-3beb-4578-80c1-4bfa580f68c4/cover.jpg",
  [VIDEO_AVATAR.CASSIDY]: "/personas/de49f8e0-572c-40b0-8e46-893d6ec72eda/cover.jpg",
  [VIDEO_AVATAR.CELIA]: "/personas/fbf30421-c647-49f8-8440-b748c01201fe/cover.jpg",
  [VIDEO_AVATAR.COSMO]: "/personas/d889c3fd-473f-4a80-aca9-7d28b24b1592/cover.jpeg",
  [VIDEO_AVATAR.LYRA]: "/personas/b6dad089-2dd4-4012-9f6c-53b8aec8d4f5/cover.jpeg",
  [VIDEO_AVATAR.ORION]: "/personas/9b3988bd-8b4e-43ca-aef2-90da70dba2c0/cover.jpg",
  [VIDEO_AVATAR.SELENE]: "/personas/37fc1a9e-144e-4447-8df1-f4cb4dd76914/cover.jpg",
} as const satisfies Record<VideoAvatar, string>;

/** The address of an avatar's cover photo on Keyframe's storage. */
export function videoAvatarCover(avatar: VideoAvatar): string {
  return `${VIDEO_AVATAR_COVER_ORIGIN}${VIDEO_AVATAR_COVER[avatar]}`;
}

/** Each avatar as the setting's menu words it. */
export const VIDEO_AVATAR_NAME = {
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
