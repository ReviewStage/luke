import { useAtom } from "@effect/atom-react";
import { EXPERIMENT } from "@luke/settings";
import { Select, type SelectOption } from "@luke/ui";
import * as Atom from "effect/reactivity/Atom";
import { Building2Icon, SquareKanbanIcon } from "lucide-react";
import { useAppState, useExperiment } from "../use-app-state";
import {
  FACTORY_BOARD,
  FACTORY_CAMPUS,
  type FactoryChoice,
  type WorldEntry,
  type WorldKey,
  worldsOffered,
} from "./registry";

/**
 * world-picker.tsx -- the Factory toolbar's pop-up of what the page shows: the board first, as it always was, then the campus, then each world the build offers.
 *
 * The choice is the window's, held for the session and never stored: the
 * board is what every launch opens on, and a world chosen stands until
 * another is, Factory closing and opening again between. It is Factory's
 * experiment (`EXPERIMENT.FACTORY`) like the page itself: while it is off,
 * nothing is offered, the picker does not stand at all, and the page is the
 * board alone.
 */

/** What the page shows, kept for the window's session. */
const choiceAtom = Atom.keepAlive(Atom.make<FactoryChoice>(FACTORY_BOARD));

/** The board's own entry in the picker. */
const BOARD_OPTION: SelectOption<FactoryChoice> = {
  value: FACTORY_BOARD,
  label: "Board",
  icon: <SquareKanbanIcon />,
};

/** The campus's entry, after the board's. */
const CAMPUS_OPTION: SelectOption<FactoryChoice> = {
  value: FACTORY_CAMPUS,
  label: "Campus",
  icon: <Building2Icon />,
};

/** What the page offers and shows: the worlds it may choose among, the one chosen, and the choosing. */
export interface FactoryWorlds {
  readonly offered: readonly (WorldEntry & { readonly key: WorldKey })[];
  /** The world shown; none where the board or the campus is. */
  readonly chosen: WorldEntry | undefined;
  /** Whether the campus is shown. */
  readonly campus: boolean;
  readonly choice: FactoryChoice;
  readonly choose: (choice: FactoryChoice) => void;
}

/** The worlds this build offers, and the one the window chose this session, while Factory's experiment is on. */
export function useFactoryWorlds(): FactoryWorlds {
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  // Note that a run main has not described yet offers no development world, as a packaged app would not.
  const packaged = useAppState()?.run.packaged ?? true;
  const [held, choose] = useAtom(choiceAtom);
  const offered = factoryOn ? worldsOffered(packaged) : [];
  const chosen = offered.find((entry) => entry.key === held);
  const campus = factoryOn && held === FACTORY_CAMPUS;
  const choice = chosen !== undefined || campus ? held : FACTORY_BOARD;
  return { offered, chosen, campus, choice, choose };
}

/** The pop-up in Factory's toolbar. */
export function WorldPicker({ worlds }: { worlds: FactoryWorlds }): React.JSX.Element {
  const options: SelectOption<FactoryChoice>[] = [
    BOARD_OPTION,
    CAMPUS_OPTION,
    ...worlds.offered.map(({ key, name, icon: Icon }) => ({
      value: key,
      label: name,
      icon: <Icon />,
    })),
  ];
  return <Select label="View" options={options} value={worlds.choice} onChange={worlds.choose} />;
}
