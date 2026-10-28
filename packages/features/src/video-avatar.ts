/**
 * video-avatar.ts -- the avatars a released Mac may ask Luke to appear as on a video call, as the voice service mints them.
 *
 * No build offers video calls any more, but a released Mac with the Video
 * calls experiment on still names one of these on `avatar.start`, which the
 * voice service answers until its side of video calls is retired.
 *
 * Each avatar is one of Keyframe's stock `persona-1.5-live` avatars, named
 * as Keyframe's avatar library names it
 * (https://docs.keyframelabs.com/guides/resources/avatar-library). The Mac
 * names an avatar by its key alone and never by Keyframe's persona id: the
 * service maps the key to the persona it mints on Luke's key, so a Mac can
 * ask for no persona this list does not hold. The persona the deployment
 * names (`LUKE_KEYFRAME_PERSONA_ID`) is what an `avatar.start` naming none
 * asks for, as every start from a build before this list did.
 */

/** Every avatar's key: what a Mac names on `avatar.start`. */
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

/** Every avatar, as Keyframe's library lists them by name. */
export const VIDEO_AVATAR_LIST: readonly VideoAvatar[] = Object.values(VIDEO_AVATAR);
