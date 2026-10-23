/**
 * reveal.tsx -- what a setting brings with it: rows standing only while a switch is on or a choice is picked, unrolled in as they arrive and rolled up as they go.
 *
 * A switch that turns on a setting's own settings, or a choice whose every
 * value has rows of its own, draws them inside a `Reveal`. The layout lands
 * at once (docs/DESIGN.md) and the motion replays it: the rows arriving are
 * unrolled from their top edge by a clip as they fade in, and every row and
 * section under them glides down from where it stood on the same spring, so
 * the clip's foot and what stands under it travel as one edge. Turned off,
 * the rows are held drawn as they last stood (`useLeaving`), out of reach,
 * and rolled up the same way as what stands under them closes over them;
 * they are let go once that has played. A choice whose value changes rolls
 * up the rows of the one left and unrolls those of the one picked in the one
 * gesture (`RevealChoice`).
 *
 * The motion is `ListMotion`'s, unrolling (`LIST_MOTION_WAY.UNROLL`), over
 * the reveal area around it (`RevealArea`): a settings page's column of
 * sections, or a section's card where it stands alone, each of which is
 * one. Only the reveal's own change plays, so the page around it still
 * changes at once, as a settings page does, and a reveal drawn open from
 * the start, or drawn again, replays nothing. Outside an area the rows come
 * and go at once.
 *
 * Its rows stand in a box of their own, laid out as the rows around it are
 * (reveal.css): a column, its rows ruled one from the next as a card's are
 * (settings-section.css), the box itself ruled from the row above. The box
 * moves its rows as the area does, so a reveal inside another, a choice's
 * rows bringing more of their own, unrolls among them and carries them
 * with the box around it.
 */

import { createContext, type ReactNode, type RefObject, useContext, useMemo, useRef } from "react";
import {
  LIST_MOTION_WAY,
  ListMotion,
  motionKey,
  motionRows,
  useLeaving,
} from "../list-motion/list-motion.js";

/** One set of rows a reveal draws: what tells it from the others, and the rows. */
interface Revealed {
  readonly key: string;
  readonly rows: ReactNode;
}

const RevealAreaContext = createContext<RefObject<HTMLElement | null> | undefined>(undefined);

/** The attributes the box a reveal area names wears, spread on it, so the rows and groups in it are what moves. */
export function revealArea(): ReturnType<typeof motionRows> {
  return motionRows();
}

/**
 * Makes the box `root` names, which `children` draw wearing `revealArea()`,
 * the area every reveal under it moves: what stands in it glides as a
 * reveal's rows arrive and leave. An area inside another leaves its reveals
 * to the outer one, so a section on a page moves the sections under it too.
 */
export function RevealArea({
  root,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  children: ReactNode;
}): React.JSX.Element {
  const outer = useContext(RevealAreaContext);
  return <RevealAreaContext.Provider value={outer ?? root}>{children}</RevealAreaContext.Provider>;
}

/** What a reveal's motion is told while it draws nothing, so a commit that keeps it hidden plays nothing. */
const HIDDEN = Symbol("hidden");

/** How many sets of rows have been given a motion key, so the next is told from every one before it. */
let minted = 0;

/** A motion key no other set of rows wears. */
function mintKey(): string {
  minted += 1;
  return `reveal-${minted}`;
}

/** The rows of the set revealed, and those of a set left, rolling up, in their box each. */
function RevealedRows({ revealed }: { revealed: readonly Revealed[] }): React.JSX.Element {
  const drawn = useLeaving(revealed, (each) => each.key);
  return (
    <>
      {drawn.map(({ key, value }) => (
        <div key={key} className="luke-reveal" {...motionKey(key)} {...motionRows()}>
          {value.rows}
        </div>
      ))}
    </>
  );
}

/**
 * One set of rows, or none, under the area's motion, which plays as
 * `revealed` changes. Note that each set wears a key minted for it rather
 * than its value, since the motion finds a row by its key across the whole
 * area, where two reveals may draw sets of one value.
 */
function RevealMotion({
  revealed,
  children,
}: {
  revealed: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const area = useContext(RevealAreaContext);
  const fallback = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  let key: string | undefined;
  if (revealed !== undefined) {
    key = keys.current.get(revealed) ?? mintKey();
    keys.current.set(revealed, key);
  }
  // Note that the set is kept while nothing changed, so the rows held while it leaves are those it last drew.
  const listed = useMemo<readonly Revealed[]>(
    () => (key === undefined ? [] : [{ key, rows: children }]),
    [key, children],
  );
  return (
    <ListMotion root={area ?? fallback} change={key ?? HIDDEN} way={LIST_MOTION_WAY.UNROLL}>
      <RevealedRows revealed={listed} />
    </ListMotion>
  );
}

/** What `Reveal` draws its rows as revealed under. */
const SHOWN = "shown";

/** `children`, the rows a setting brings, while `shown`: unrolled in as it turns on, and rolled up as it turns off. */
export function Reveal({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <RevealMotion revealed={shown ? SHOWN : undefined}>{children}</RevealMotion>;
}

/**
 * The rows `children` draws for `value`, a choice whose values each bring
 * rows of their own, or none where it draws none: as the value changes, the
 * rows of the one left roll up as those of the one picked unroll.
 */
export function RevealChoice<Value extends string>({
  value,
  children,
}: {
  value: Value;
  children: (value: Value) => ReactNode;
}): React.JSX.Element {
  const rows = children(value);
  const none = rows === null || rows === undefined || rows === false;
  return <RevealMotion revealed={none ? undefined : value}>{rows}</RevealMotion>;
}
