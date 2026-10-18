/**
 * desktop-bundles.ts -- how the desktop reaches the bundles the panel leaves to its shell: each one's entry, imported where the build put it.
 */

import { type SideBundles, sideBundles } from "@luke/panel/bundle-loader";
import type { WorldKey } from "@luke/panel/factory-world/registry";
import type { WorldModule } from "@luke/panel/factory-world/world";
import type { ShellBundles } from "@luke/panel/shell-bundles";

/** Each Factory world's entry, by its key; `scripts/build.mjs` makes each folder a bundle of its own. */
const WORLD_ENTRIES = new Map<string, () => Promise<{ readonly world: WorldModule }>>(
  Object.entries({
    citadel: () => import("./factory-world/worlds/citadel/index"),
    planet: () => import("./factory-world/worlds/planet/index"),
    factory: () => import("./factory-world/worlds/factory/index"),
    tree: () => import("./factory-world/worlds/tree/index"),
    station: () => import("./factory-world/worlds/station/index"),
    colony: () => import("./factory-world/worlds/colony/index"),
    archipelago: () => import("./factory-world/worlds/archipelago/index"),
    neon: () => import("./factory-world/worlds/neon/index"),
    atlantis: () => import("./factory-world/worlds/atlantis/index"),
    railway: () => import("./factory-world/worlds/railway/index"),
    dev: () => import("./factory-world/worlds/dev/index"),
  } satisfies Record<WorldKey, () => Promise<{ readonly world: WorldModule }>>),
);

/** The desktop's shell bundles, which the panel window's entry installs. */
export const DESKTOP_BUNDLES: ShellBundles = {
  world: (key) =>
    WORLD_ENTRIES.get(key)?.() ?? Promise.reject(new Error(`No world is named ${key}.`)),
  avatarSession: () => import("./avatar-session/index").then((entry) => entry.avatarSession),
};

/** The panel's side bundles with the desktop's Factory scene among them, which the panel window's entry hands its surfaces. */
export const DESKTOP_SIDE_BUNDLES: SideBundles = sideBundles({
  factoryScene: () => import("./factory-world/scene/index").then((entry) => entry.factoryScene),
});
