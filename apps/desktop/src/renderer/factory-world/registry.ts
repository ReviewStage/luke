import {
  Building2Icon,
  CastleIcon,
  CloudSunIcon,
  FlaskConicalIcon,
  type LucideIcon,
  SatelliteIcon,
  TrainFrontIcon,
} from "lucide-react";
import type { WorldModule } from "./world";

/**
 * registry.ts -- every world the Factory's picker offers after Board: its name, its glyph, and how its bundle is reached.
 *
 * A world is one folder under `worlds/` and one entry in `FACTORY_WORLDS`,
 * nothing else: its entry, `worlds/<key>/index.ts`, is a bundle of its own
 * (`factory-world-<key>.js`, which `scripts/build.mjs` finds by its folder),
 * imported only the first time it is chosen, so one world's weight never
 * loads with another's. The picker lists the worlds in the order they stand
 * here. A key is the world's folder, and is never `FACTORY_BOARD`.
 */

/** One world the picker offers. */
export interface WorldEntry {
  /** Its folder under `worlds/`, which names its bundle; never `FACTORY_BOARD`. */
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

/** The worlds every build offers, in the picker's order. */
const FACTORY_WORLDS = [
  {
    key: "citadel",
    name: "Citadel",
    icon: CastleIcon,
    load: () => import("./worlds/citadel/index"),
  },
  {
    key: "station",
    name: "Orbital Station",
    icon: SatelliteIcon,
    load: () => import("./worlds/station/index"),
  },
  {
    key: "archipelago",
    name: "Sky Archipelago",
    icon: CloudSunIcon,
    load: () => import("./worlds/archipelago/index"),
  },
  {
    key: "neon",
    name: "Neon Megacity",
    icon: Building2Icon,
    load: () => import("./worlds/neon/index"),
  },
  {
    key: "railway",
    name: "Model Railway",
    icon: TrainFrontIcon,
    load: () => import("./worlds/railway/index"),
  },
] as const satisfies readonly WorldEntry[];

/** The world a development build offers after them, which no packaged app does: the plainest drawing of the reading, for standing the host up. */
const DEV_WORLDS = [
  {
    key: "dev",
    name: "Test pattern",
    icon: FlaskConicalIcon,
    load: () => import("./worlds/dev/index"),
  },
] as const satisfies readonly WorldEntry[];

/** A world, by its key. */
export type WorldKey = (typeof FACTORY_WORLDS)[number]["key"] | (typeof DEV_WORLDS)[number]["key"];

/** What the Factory page shows: the board, or a world. */
export type FactoryChoice = typeof FACTORY_BOARD | WorldKey;

/** The worlds a build offers, in the picker's order: every world, then the development one where this is no packaged app. */
export function worldsOffered(
  packaged: boolean,
): readonly (WorldEntry & { readonly key: WorldKey })[] {
  return packaged ? FACTORY_WORLDS : [...FACTORY_WORLDS, ...DEV_WORLDS];
}
