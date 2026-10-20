/**
 * shell-bundles.ts -- the bundles only a shell can reach, installed by its root before anything reads them.
 *
 * The panel's own side bundles (the editor, the whiteboard, the tree, the
 * terminal, the diagrams, the diff) are each imported from the panel's own
 * entry (`bundle-loader.ts`). A call's avatar is the shell's to name: it
 * runs Keyframe's session, which the desktop ships and another shell need
 * not. So the window's root installs how it is reached, and the panel
 * imports it through here. Note that this is a module-level door, as the
 * bridge's is, because the avatar's bundle is read outside any render; the
 * importer is read the moment it is called, never at module load, so a shell
 * that installs none fails that bundle alone.
 */

import type { AvatarSessionModule } from "@luke/ui/avatar-session-contract";

/** How the shell reaches each bundle the panel leaves to it. */
export interface ShellBundles {
  /** A call's avatar session. */
  readonly avatarSession: () => Promise<AvatarSessionModule>;
}

let installed: ShellBundles | undefined;

/** Installs how this window's shell reaches its bundles; its root does this once, before anything is drawn, and calls what it answers as it closes. */
export function installShellBundles(bundles: ShellBundles): () => void {
  installed = bundles;
  return () => {
    if (installed === bundles) installed = undefined;
  };
}

/** How this window's root said its shell's bundles are reached. */
export function shellBundles(): ShellBundles {
  if (installed === undefined) throw new Error("No shell bundles are installed in this window.");
  return installed;
}
