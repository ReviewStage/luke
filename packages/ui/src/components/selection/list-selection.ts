import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";

export interface ListSelection {
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
}

export interface ListSelecting {
  readonly selected: ReadonlySet<string>;
  readonly press: (key: string, event: MouseEvent<HTMLElement>) => boolean;
  readonly toggle: (key: string) => void;
}

export const ListSelectionContext = createContext<ListSelecting | undefined>(undefined);

const KEY_ATTRIBUTE = "data-select-key";

const ROOT_ATTRIBUTE = "data-selection-root";

const ROOT_SELECTOR = `[${ROOT_ATTRIBUTE}]`;

const RUN_ATTRIBUTE = "data-selection-run";

const RUN_SELECTOR = `[${RUN_ATTRIBUTE}]`;

export function selectionRoot(): { readonly "data-selection-root": "" } {
  return { [ROOT_ATTRIBUTE]: "" };
}

export function selectionRun(): { readonly "data-selection-run": "" } {
  return { [RUN_ATTRIBUTE]: "" };
}

export function selectableRow(key: string): { readonly "data-select-key": string } {
  return { [KEY_ATTRIBUTE]: key };
}

interface Anchor {
  readonly key: string;
  readonly base: ReadonlySet<string>;
  readonly head: string;
  readonly left: ReadonlySet<string>;
}

interface Choosable {
  readonly key: string;
  readonly press: HTMLElement;
}

function choosableOf(list: Element): Choosable[] {
  return Array.from(list.querySelectorAll<HTMLElement>(`[${KEY_ATTRIBUTE}]`))
    .filter((press) => press.closest(ROOT_SELECTOR) === list)
    .filter(
      (press) => !press.matches(":disabled") && press.getAttribute("aria-disabled") !== "true",
    )
    .map((press) => ({ key: press.getAttribute(KEY_ATTRIBUTE) ?? "", press }));
}

function inRunOf(rows: readonly Choosable[], press: Element): readonly Choosable[] {
  const run = press.closest(RUN_SELECTOR);
  return run === null ? rows : rows.filter((row) => row.press.closest(RUN_SELECTOR) === run);
}

export function focusChoosable(box: Element): boolean {
  const first = choosableOf(box)[0];
  first?.press.focus();
  return first !== undefined;
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

function withRun(
  keys: readonly string[],
  base: ReadonlySet<string>,
  from: string,
  to: string,
): ReadonlySet<string> {
  const end = keys.indexOf(to);
  const found = keys.indexOf(from);
  const start = found < 0 ? end : found;
  const run = keys.slice(Math.min(start, end), Math.max(start, end) + 1);
  return new Set([...base, ...run]);
}

function keysOf(rows: readonly Choosable[]): readonly string[] {
  return rows.map((row) => row.key);
}

function runListing(order: readonly (readonly string[])[], key: string): readonly string[] {
  return order.find((run) => run.includes(key)) ?? [];
}

function typedIn(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

function command(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey;
}

export function holdRun(event: MouseEvent<HTMLElement>): void {
  if (!event.shiftKey) return;
  event.preventDefault();
  event.currentTarget.focus();
}

export function useListSelection(
  selection: ListSelection | undefined,
  order?: readonly (readonly string[])[],
  bringIn?: (key: string, then: () => void) => boolean,
): {
  readonly selecting: ListSelecting | undefined;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
} {
  const anchor = useRef<Anchor | undefined>(undefined);
  const latest = useRef(selection);
  latest.current = selection;
  const listed = useRef(order);
  listed.current = order;
  const bringing = useRef(bringIn);
  bringing.current = bringIn;

  const standing = useCallback((chosen: ReadonlySet<string>): Anchor | undefined => {
    const held = anchor.current;
    return held !== undefined && sameKeys(held.left, chosen) ? held : undefined;
  }, []);

  const hand = useCallback((next: ReadonlySet<string>, to: Anchor | undefined) => {
    anchor.current = to;
    latest.current?.onChange(next);
  }, []);

  const toggle = useCallback(
    (key: string) => {
      const current = latest.current;
      if (current === undefined) return;
      const next = new Set(current.selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      hand(next, { key, base: next, head: key, left: next });
    },
    [hand],
  );

  const press = useCallback(
    (key: string, event: MouseEvent<HTMLElement>): boolean => {
      const current = latest.current;
      if (current === undefined) return false;
      const chosen = current.selected;
      if (event.shiftKey) {
        const list = event.currentTarget.closest(ROOT_SELECTOR);
        if (list === null) return false;
        const from = standing(chosen) ?? { key, base: chosen, head: key, left: chosen };
        const runs = listed.current;
        const keys =
          runs === undefined
            ? keysOf(inRunOf(choosableOf(list), event.currentTarget))
            : runListing(runs, key);
        const next = withRun(keys, from.base, from.key, key);
        hand(next, { ...from, head: key, left: next });
        return true;
      }
      if (command(event)) {
        toggle(key);
        return true;
      }
      anchor.current = { key, base: chosen, head: key, left: chosen };
      return false;
    },
    [hand, standing, toggle],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      const current = latest.current;
      if (current === undefined || event.defaultPrevented || typedIn(event.target)) return false;
      const list = event.currentTarget;
      if (event.key === "Escape") {
        if (current.selected.size === 0 || event.nativeEvent.isComposing) return false;
        event.preventDefault();
        event.stopPropagation();
        hand(new Set(), undefined);
        return true;
      }
      if (command(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        hand(new Set(listed.current?.flat() ?? keysOf(choosableOf(list))), undefined);
        return true;
      }
      const bare = !command(event) && !event.shiftKey && !event.altKey;
      if (bare && event.key.toLowerCase() === "x") {
        const row = choosableOf(list).find((each) => each.press === event.target);
        if (row === undefined) return false;
        event.preventDefault();
        toggle(row.key);
        return true;
      }
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step === 0 || !event.shiftKey || command(event) || event.altKey) return false;
      const all = choosableOf(list);
      const inHand = all.find((row) => row.press === event.target);
      if (inHand === undefined) return false;
      const rows = inRunOf(all, inHand.press);
      const runs = listed.current;
      const keys = runs === undefined ? keysOf(rows) : runListing(runs, inHand.key);
      const at = keys.indexOf(inHand.key);
      event.preventDefault();
      const here = inHand.key;
      const held = standing(current.selected);
      const from =
        held !== undefined && held.head === here
          ? held
          : { key: here, base: current.selected, head: here, left: current.selected };
      const to = at < 0 ? undefined : keys[at + step];
      if (to === undefined) return true;
      const next = withRun(keys, from.base, from.key, to);
      hand(next, { ...from, head: to, left: next });
      const pressOf = () => choosableOf(list).find((row) => row.key === to)?.press;
      const drawn = pressOf();
      if (drawn !== undefined) drawn.focus();
      else bringing.current?.(to, () => pressOf()?.focus());
      return true;
    },
    [hand, standing, toggle],
  );

  const selected = selection?.selected;
  const selecting = useMemo(
    () => (selected === undefined ? undefined : { selected, press, toggle }),
    [selected, press, toggle],
  );
  return { selecting, onKeyDown };
}
