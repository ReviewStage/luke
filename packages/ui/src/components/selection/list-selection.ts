import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";

/**
 * list-selection.ts -- the rows a `List` holds chosen at once, as a Mac's list chooses them: ⌘-click one in or out, ⇧-click a run of them, ⌘A every one, Esc none, and ⇧↑↓ grow the run from the row in hand.
 *
 * A list chooses rows only where it is asked to (`List`'s `selection`),
 * and its owner keeps which ones: the list hands it the next set and is
 * drawn with whatever set it is handed back, so the owner may clear it, act
 * on it, or drop a row that has gone. A row takes part by its key
 * (`ListRow`'s `selectKey`) and only through its press, so a row that opens
 * nothing is never chosen; one unavailable is passed over by every way in.
 *
 * A plain press is the row's own, opening it as it always has, and leaves
 * the set as it stands; it only marks where a run starts, the anchor. ⌘
 * (or Ctrl, off a Mac) and a press puts the row in or takes it out and
 * anchors there. ⇧ and a press chooses the run from the anchor to the row,
 * over whatever was chosen as the anchor was set, so a second ⇧-press
 * swaps the run for a longer or a shorter one rather than adding to it.
 * ⇧↑ and ⇧↓ grow or shrink that run a row at a time from the row holding
 * the focus, which they take on with them, and stop at either end rather
 * than wrapping. ⌘A chooses every row, and Esc, while any is chosen, none.
 *
 * Note that the order and who is available are read off the rows as they
 * are drawn, as `useRovingKeys` reads its items, because the rows are
 * drawn by whoever fills the list. And note that a key pressed in a field
 * inside the list is the field's.
 */

/** Which rows of a `List` are chosen, kept by its owner: the keys chosen, and what hears the next set. */
export interface ListSelection {
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
}

/** What a row of a choosing `List` reads: whether it is chosen, and the door its press goes through. */
export interface ListSelecting {
  readonly selected: ReadonlySet<string>;
  /** Hears a press on the row keyed `key`; answers whether it chose rows, so the row's own press is not also made. */
  readonly press: (key: string, event: MouseEvent<HTMLElement>) => boolean;
}

/** The selection of the `List` a row stands in, where that list chooses rows at all. */
export const ListSelectionContext = createContext<ListSelecting | undefined>(undefined);

/** The attribute a choosable row's press wears, naming its key. */
const KEY_ATTRIBUTE = "data-select-key";

/** What a row's press wears in a list that chooses rows. */
export function selectableRow(key: string): { readonly "data-select-key": string } {
  return { [KEY_ATTRIBUTE]: key };
}

/** Where a run starts, the chosen set it is laid over, the row it reaches now, and the set it left. */
interface Anchor {
  readonly key: string;
  readonly base: ReadonlySet<string>;
  readonly head: string;
  readonly left: ReadonlySet<string>;
}

/** A choosable row of the list, in the order drawn: its key, its press, and whether it is available. */
interface Choosable {
  readonly key: string;
  readonly press: HTMLElement;
}

/** The available rows of `list` that can be chosen, in the order they are drawn, none of a list nested in it. */
function choosableOf(list: Element): Choosable[] {
  return Array.from(list.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`))
    .filter((press) => press.closest(".luke-list") === list)
    .filter(
      (press) => !press.matches(":disabled") && press.getAttribute("aria-disabled") !== "true",
    )
    .map((press) => ({ key: press.getAttribute(KEY_ATTRIBUTE) ?? "", press }));
}

/** Whether `a` and `b` hold the same keys. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/** `base` with every row from `from` to `to` in it, both ends included; `to` alone where `from` is drawn no more. */
function withRun(
  rows: readonly Choosable[],
  base: ReadonlySet<string>,
  from: string,
  to: string,
): ReadonlySet<string> {
  const end = rows.findIndex((row) => row.key === to);
  const found = rows.findIndex((row) => row.key === from);
  const start = found < 0 ? end : found;
  const run = rows.slice(Math.min(start, end), Math.max(start, end) + 1).map((row) => row.key);
  return new Set([...base, ...run]);
}

/** Whether a key landed in a field, whose own it is. */
function typedIn(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/** Whether ⌘ is held, or Ctrl, the same key off a Mac. */
function command(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * The selection a `List` keeps over its rows: what its rows read, and the
 * keys it hears, which answer whether they chose anything so the arrows'
 * walk is not also made. A list asked for none chooses nothing.
 */
export function useListSelection(selection: ListSelection | undefined): {
  readonly selecting: ListSelecting | undefined;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
} {
  const anchor = useRef<Anchor | undefined>(undefined);
  // The latest selection, which a caller hands anew on every render.
  const latest = useRef(selection);
  latest.current = selection;

  // Note that an anchor stands only while the set is the one it left, so a
  // set its owner changed itself, a Clear, starts the next run afresh.
  const standing = useCallback((chosen: ReadonlySet<string>): Anchor | undefined => {
    const held = anchor.current;
    return held !== undefined && sameKeys(held.left, chosen) ? held : undefined;
  }, []);

  const hand = useCallback((next: ReadonlySet<string>, to: Anchor | undefined) => {
    anchor.current = to;
    latest.current?.onChange(next);
  }, []);

  const press = useCallback(
    (key: string, event: MouseEvent<HTMLElement>): boolean => {
      const current = latest.current;
      if (current === undefined) return false;
      const chosen = current.selected;
      if (event.shiftKey) {
        const list = event.currentTarget.closest(".luke-list");
        if (list === null) return false;
        const from = standing(chosen) ?? { key, base: chosen, head: key, left: chosen };
        const next = withRun(choosableOf(list), from.base, from.key, key);
        hand(next, { ...from, head: key, left: next });
        return true;
      }
      if (command(event)) {
        const next = new Set(chosen);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        hand(next, { key, base: next, head: key, left: next });
        return true;
      }
      anchor.current = { key, base: chosen, head: key, left: chosen };
      return false;
    },
    [hand, standing],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      const current = latest.current;
      if (current === undefined || event.defaultPrevented || typedIn(event.target)) return false;
      const list = event.currentTarget;
      if (event.key === "Escape") {
        if (current.selected.size === 0 || event.nativeEvent.isComposing) return false;
        // Note that the key goes no further, so what stands behind the list stays open.
        event.preventDefault();
        event.stopPropagation();
        hand(new Set(), undefined);
        return true;
      }
      if (command(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        hand(new Set(choosableOf(list).map((row) => row.key)), undefined);
        return true;
      }
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step === 0 || !event.shiftKey || command(event) || event.altKey) return false;
      const rows = choosableOf(list);
      const at = rows.findIndex((row) => row.press === event.target);
      if (at < 0) return false;
      event.preventDefault();
      const here = rows[at]?.key ?? "";
      // Note that the run grows from the row in hand: one the focus walked to apart from the run starts a new one there.
      const held = standing(current.selected);
      const from =
        held !== undefined && held.head === here
          ? held
          : { key: here, base: current.selected, head: here, left: current.selected };
      const to = rows[at + step];
      if (to === undefined) return true;
      const next = withRun(rows, from.base, from.key, to.key);
      hand(next, { ...from, head: to.key, left: next });
      to.press.focus();
      return true;
    },
    [hand, standing],
  );

  const selected = selection?.selected;
  const selecting = useMemo(
    () => (selected === undefined ? undefined : { selected, press }),
    [selected, press],
  );
  return { selecting, onKeyDown };
}
