import { AVATAR_SESSION_ASSET } from "@luke/ui/avatar-session-contract";
import { bundleAtom } from "../bundle-loader";

/**
 * avatar-session-bundle.ts -- the avatar session bundle, loaded once by the panel the first time an avatar is shown, and kept for the window's life.
 */

/** Why the avatar could not be shown where its bundle failed to load. */
const AVATAR_SESSION_LOAD_FAILED = "The video could not be started.";

export const avatarSessionModuleAtom = bundleAtom(
  { script: AVATAR_SESSION_ASSET.SCRIPT },
  () => window.lukeAvatarSession,
  AVATAR_SESSION_LOAD_FAILED,
);
