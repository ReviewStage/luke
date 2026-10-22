/**
 * desktop-bundles.ts -- how the desktop reaches the bundles the panel leaves to its shell: each one's entry, imported where the build put it.
 */

import type { ShellBundles } from "@luke/panel/shell-bundles";

/** The desktop's shell bundles, which the panel window's entry installs. */
export const DESKTOP_BUNDLES: ShellBundles = {
  avatarSession: () => import("./avatar-session/index").then((entry) => entry.avatarSession),
};
