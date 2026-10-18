import {
  Building2Icon,
  CastleIcon,
  CloudSunIcon,
  EarthIcon,
  FactoryIcon,
  FlaskConicalIcon,
  type LucideIcon,
  SatelliteIcon,
  ShellIcon,
  ShovelIcon,
  TrainFrontIcon,
  TreeDeciduousIcon,
} from "lucide-react";
import { shellBundles } from "../shell-bundles.js";
import type { WorldModule } from "./world.js";

/**
 * registry.ts -- every world the Factory's picker offers after Board: its name, its glyph, and how its bundle is reached.
 *
 * A world is one folder under `worlds/` and one entry in `FACTORY_WORLDS`,
 * nothing else: its entry, `worlds/<key>/index.ts`, is a bundle of its own
 * (`factory-world-<key>.js`, which `scripts/build.mjs` finds by its folder),
 * reached through the shell (`shell-bundles.ts`) and imported only the first
 * time it is chosen, so one world's weight never
 * loads with another's. The picker lists the worlds in the order they stand
 * here, after the board and the campus. A key is the world's folder, and is
 * never `FACTORY_BOARD` or `FACTORY_CAMPUS`.
 */

/** One world the picker offers. */
export interface WorldEntry {
  /** Its folder under `worlds/`, which names its bundle; never `FACTORY_BOARD` or `FACTORY_CAMPUS`. */
  readonly key: string;
  /** What the picker calls it. */
  readonly name: string;
  /** The small glyph beside its name. */
  readonly icon: LucideIcon;
  /** Its entry, imported where the bundler put it. */
  readonly load: () => Promise<{ readonly world: WorldModule }>;
}

/** The picker's first entry, the Talk → Build → Ship board, which is no world. */
export const FACTORY_BOARD = "board";

/** The picker's second entry, the campus: the snapshot drawn in SVG as a town of the listed tasks, which is no world either (`campus/`). */
export const FACTORY_CAMPUS = "campus";

/** The worlds every build offers, in the picker's order. */
const FACTORY_WORLDS = [
  {
    key: "citadel",
    name: "Citadel",
    icon: CastleIcon,
    load: () => shellBundles().world("citadel"),
  },
  {
    key: "planet",
    name: "Planet",
    icon: EarthIcon,
    load: () => shellBundles().world("planet"),
  },
  {
    key: "factory",
    name: "Factory",
    icon: FactoryIcon,
    load: () => shellBundles().world("factory"),
  },
  {
    key: "tree",
    name: "World Tree",
    icon: TreeDeciduousIcon,
    load: () => shellBundles().world("tree"),
  },
  {
    key: "station",
    name: "Orbital Station",
    icon: SatelliteIcon,
    load: () => shellBundles().world("station"),
  },
  {
    key: "colony",
    name: "Ant Colony",
    icon: ShovelIcon,
    load: () => shellBundles().world("colony"),
  },
  {
    key: "archipelago",
    name: "Sky Archipelago",
    icon: CloudSunIcon,
    load: () => shellBundles().world("archipelago"),
  },
  {
    key: "neon",
    name: "Neon Megacity",
    icon: Building2Icon,
    load: () => shellBundles().world("neon"),
  },
  {
    key: "atlantis",
    name: "Atlantis",
    icon: ShellIcon,
    load: () => shellBundles().world("atlantis"),
  },
  {
    key: "railway",
    name: "Model Railway",
    icon: TrainFrontIcon,
    load: () => shellBundles().world("railway"),
  },
] as const satisfies readonly WorldEntry[];

/** The world a development build offers after them, which no packaged app does: the plainest drawing of the reading, for standing the host up. */
const DEV_WORLDS = [
  {
    key: "dev",
    name: "Test pattern",
    icon: FlaskConicalIcon,
    load: () => shellBundles().world("dev"),
  },
] as const satisfies readonly WorldEntry[];

/** A world, by its key. */
export type WorldKey = (typeof FACTORY_WORLDS)[number]["key"] | (typeof DEV_WORLDS)[number]["key"];

/** What the Factory page shows: the board, the campus, or a world. */
export type FactoryChoice = typeof FACTORY_BOARD | typeof FACTORY_CAMPUS | WorldKey;

/** The worlds a build offers, in the picker's order: every world, then the development one where this is no packaged app. */
export function worldsOffered(
  packaged: boolean,
): readonly (WorldEntry & { readonly key: WorldKey })[] {
  return packaged ? FACTORY_WORLDS : [...FACTORY_WORLDS, ...DEV_WORLDS];
}
