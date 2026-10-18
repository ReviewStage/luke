/**
 * shell-bundles.ts -- the bundles only a shell can reach, installed by its root before anything reads them.
 *
 * The panel's own side bundles (the editor, the whiteboard, the tree, the
 * terminal, the diagrams, the diff) are each imported from the panel's own
 * entry (`bundle-loader.ts`). A few are the shell's to name: the Factory's
 * worlds draw with three.js on WebGL, and a call's avatar runs Keyframe's
 * session, which the desktop ships and another shell need not. So the
 * window's root installs how each is reached, and the panel imports them
 * through here. Note that this is a module-level door, as the bridge's is,
 * because a world's bundle and the avatar's are read outside any render;
 * each importer is read the moment it is called, never at module load, so a
 * shell that installs none fails those bundles alone. The Factory's scene,
 * which a surface reads, is the shell's too, and is handed to the surfaces
 * through `SideBundlesContext` instead.
 */

import type { AvatarSessionModule } from "@luke/ui/avatar-session-contract";
import type { WorldModule } from "./factory-world/world.js";

/** How the shell reaches each bundle the panel leaves to it. */
export interface ShellBundles {
  /** A Factory world's entry, by its key (`factory-world/registry.ts`). */
  readonly world: (key: string) => Promise<{ readonly world: WorldModule }>;
  /** A call's avatar session. */
  readonly avatarSession: () => Promise<AvatarSessionModule>;
}

let installed: ShellBundles | undefined;

/** Installs how this window's shell reaches its bundles; its root does this once, before anything is drawn. */
export function installShellBundles(bundles: ShellBundles): void {
  installed = bundles;
}

/** How this window's root said its shell's bundles are reached. */
export function shellBundles(): ShellBundles {
  if (installed === undefined) throw new Error("No shell bundles are installed in this window.");
  return installed;
}
