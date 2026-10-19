import { useAtom } from "@effect/atom-react";
import { EXPERIMENT } from "@luke/settings";
import { Select, type SelectOption } from "@luke/ui";
import * as Atom from "effect/reactivity/Atom";
import { Building2Icon, SquareKanbanIcon } from "lucide-react";
import { useExperiment } from "../use-app-state.js";

/**
 * world-picker.tsx -- the Factory toolbar's pop-up of what the page shows: the board first, as it always was, then the campus.
 *
 * The choice is the window's, held for the session and never stored: the
 * board is what every launch opens on, and the campus chosen stands until
 * the board is, Factory closing and opening again between. It is Factory's
 * experiment (`EXPERIMENT.FACTORY`) like the page itself: while it is off,
 * the picker does not stand at all, and the page is the board alone.
 */

/** What the Factory page shows. */
export const FACTORY_CHOICE = {
  /** The Talk → Build → Ship board. */
  BOARD: "board",
  /** The snapshot drawn in SVG as a town of the listed tasks (`campus/`). */
  CAMPUS: "campus",
} as const;

type FactoryChoice = (typeof FACTORY_CHOICE)[keyof typeof FACTORY_CHOICE];

/** What the page shows, kept for the window's session. */
const choiceAtom = Atom.keepAlive(Atom.make<FactoryChoice>(FACTORY_CHOICE.BOARD));

/** The picker's entries, in its order. */
const OPTIONS: readonly SelectOption<FactoryChoice>[] = [
  { value: FACTORY_CHOICE.BOARD, label: "Board", icon: <SquareKanbanIcon /> },
  { value: FACTORY_CHOICE.CAMPUS, label: "Campus", icon: <Building2Icon /> },
];

/** What the page offers and shows: whether the picker stands, the view chosen, and the choosing. */
export interface FactoryViews {
  /** Whether the picker stands, Factory's experiment being on. */
  readonly offered: boolean;
  readonly choice: FactoryChoice;
  readonly choose: (choice: FactoryChoice) => void;
}

/** The view the window chose this session, the board wherever Factory's experiment is off. */
export function useFactoryViews(): FactoryViews {
  const offered = useExperiment(EXPERIMENT.FACTORY);
  const [held, choose] = useAtom(choiceAtom);
  const choice = offered ? held : FACTORY_CHOICE.BOARD;
  return { offered, choice, choose };
}

/** The pop-up in Factory's toolbar. */
export function FactoryViewPicker({ views }: { views: FactoryViews }): React.JSX.Element {
  return <Select label="View" options={OPTIONS} value={views.choice} onChange={views.choose} />;
}
