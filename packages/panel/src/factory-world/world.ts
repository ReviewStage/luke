import type { FactoryWorld } from "@luke/features/factory-world-wire";
import type { BlastZone, FactoryWorldView } from "@luke/ui/factory-world";

/**
 * world.ts -- what the Factory's campus draws: the state handed it on every update, and what a press or a hover lands on.
 *
 * The campus (`campus/`) draws one reading of a repository
 * (`@luke/ui/factory-world`) as a town of the listed tasks. The page
 * (`world-page.tsx`) owns everything around it: the data read, the shared
 * chrome in the page's DOM, the selection, and the layers shown. It hands the
 * campus a `WorldState` whole on every change, and hears back what the pointer
 * rests on and what a press lands on as `PickTarget`s.
 */

/** What a press or a hover lands on: one item of the view, by its kind and its id there. */
export const PICK_KIND = {
  /** An agent at work, by its id. */
  AGENT: "agent",
  /** A zone, by its path. */
  ZONE: "zone",
  /** A merged pull request, by its URL. */
  SHIPPED: "shipped",
  /** A Linear issue planned, by its key. */
  PLANNED: "planned",
  /** A defect, by its id at the monitor. */
  DEFECT: "defect",
  /** A listed task, by its id, which the campus draws as a building. */
  TASK: "task",
} as const;

type PickKind = (typeof PICK_KIND)[keyof typeof PICK_KIND];

/** One item the campus drew, as picking names it to the chrome and the chrome names it back. */
export interface PickTarget {
  readonly kind: PickKind;
  readonly id: string;
}

/** The layers the pipeline bar's counts pick out, each a signal the campus draws or leaves out. */
export const WORLD_LAYER = {
  PLANNED: "planned",
  BUILDING: "building",
  SHIPPED: "shipped",
  DEFECTS: "defects",
} as const;

export type WorldLayer = (typeof WORLD_LAYER)[keyof typeof WORLD_LAYER];

/** Which layers stand drawn; the campus leaves out what a layer switched off holds. */
export type WorldLayers = { readonly [Layer in WorldLayer]: boolean };

/** Everything the campus draws, handed whole on every change of any part of it. */
export interface WorldState {
  /** The reading, as of the scrubber's instant. */
  readonly view: FactoryWorldView;
  /** The snapshot the reading is of, as of the same instant: what the reading does not carry, the planned issues (`planned`) and the defects (`defects`), each placed on its `zonePaths`. */
  readonly snapshot: FactoryWorld;
  /** Whether the instant is the snapshot's own, the scrubber at its end. */
  readonly live: boolean;
  /** What the developer chose, which the agent card describes. */
  readonly selected: PickTarget | undefined;
  /** What the pointer rests on, which the hover label names. */
  readonly hovered: PickTarget | undefined;
  /** The selected agent's blast radius: each zone its work ripples to, by path, and how many steps away; empty with no agent selected. */
  readonly blast: ReadonlyMap<string, BlastZone["distance"]>;
  readonly layers: WorldLayers;
  /** Whether motion is held still: reduced motion or a capture run. The campus draws a still frame that says everything a moving one would. */
  readonly still: boolean;
  /** Whether the window draws in its dark appearance, so the campus dresses its ground to match. */
  readonly dark: boolean;
}
