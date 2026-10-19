/**
 * choice-bar.tsx -- the one bar of options where you choose one: tabs over a few views of one thing, or a pick-one that sets a value, in a fill or a segmented trough.
 *
 * What it says to a reader follows from what it does, never from how it
 * looks. A bar handed `panels` switches what is shown: it is a tablist,
 * each tab selected while its view is shown and controlling that view's
 * panel, which the caller draws labelled by its tab. A bar without sets a
 * value: it is a radio group, each option checked while it is the value.
 * Either is one tab stop on the chosen option (the first while none is),
 * the arrows (and ↑/↓ for a radio group) moving along it and choosing as
 * they go, wrapping, Home and End going to either end, a disabled option
 * stepped past. A bar its owner drives from a field the keyboard stays in
 * (`focus: none`) takes no focus at all, a press on it leaving the keyboard
 * where it was. A `clearable` bar's chosen option, pressed again, takes the
 * choice back.
 *
 * Each option is its glyph, its name, and a count. The name is always
 * given: a fill bar narrower than its options need scrolls sideways and
 * shows an option other than the chosen one by its glyph alone, its name
 * left to a reader who cannot see it; one standing in a toolbar beside other
 * controls folds every option at once instead, once their names no longer
 * fit (`fold`).
 * A count is words, or parts each in
 * its own tone (`CountPart`), which holds chosen or not; a diff's lines are
 * `linesCount`'s, always green and red.
 *
 * `look` is how the chosen option stands out. `fill` is the window's own
 * selected state, a sidebar row's and an open tab's: plain words at the
 * control's height, a fill under the one chosen. It draws no underline: a
 * bar heading a page or a column stands in its header's band, whose
 * hairline is the header's. `segmented` is a trough, the chosen option on a
 * thumb raised in it, its options wrapping inside it when too wide. In
 * either the fill or the thumb slides from option to option. `size`
 * compact is a step smaller, in the caption's type. A fill bar heading a
 * page read at its measure, or a narrow column, stands its options in line
 * with the words under it (`inset`). What finds the bar for an app (the
 * desktop's settings search) is the app's: it hands the bar the `data-`
 * attributes its search lands on.
 */

import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CHOICE_ROLE, type ChoiceRole } from "../choice/choice-keys.js";
import { type CountPart, CountParts } from "../choice/count-part.js";
import { type ChoiceKeys, useChoiceKeys } from "../choice/use-choice-keys.js";

/** How the bar draws its chosen option: a fill under it, or a thumb raised in a trough. */
export const CHOICE_BAR_LOOK = {
  FILL: "fill",
  SEGMENTED: "segmented",
} as const;

export type ChoiceBarLook = (typeof CHOICE_BAR_LOOK)[keyof typeof CHOICE_BAR_LOOK];

/** How much room the bar keeps around its options: a page's, or a step smaller in the caption's type. */
export const CHOICE_BAR_SIZE = {
  REGULAR: "regular",
  COMPACT: "compact",
} as const;

export type ChoiceBarSize = (typeof CHOICE_BAR_SIZE)[keyof typeof CHOICE_BAR_SIZE];

/** Whether the bar's options take the keyboard, one tab stop roving among them, or none, its owner driving the keys. */
export const CHOICE_BAR_FOCUS = {
  ROVING: "roving",
  NONE: "none",
} as const;

export type ChoiceBarFocus = (typeof CHOICE_BAR_FOCUS)[keyof typeof CHOICE_BAR_FOCUS];

/** Where a fill bar stands its options: at its container's edges, with the words of a page read at its measure, or at a column's inset. */
export const CHOICE_BAR_INSET = {
  NONE: "none",
  READING: "reading",
  COLUMN: "column",
} as const;

export type ChoiceBarInset = (typeof CHOICE_BAR_INSET)[keyof typeof CHOICE_BAR_INSET];

/**
 * What folds a fill bar's options when the row is short of room: its own
 * width, each option but the chosen one drawn by its glyph alone below a
 * width; or their names not fitting (`together`), measured, every option
 * then drawn by its glyph alone at once, the chosen one too, so none is
 * named while the others are not. A bar folding together also takes its
 * options' room in where its toolbar sets `--luke-fold: tight`, which it
 * does before their names stop fitting.
 */
export const CHOICE_BAR_FOLD = {
  OWN: "own",
  TOGETHER: "together",
} as const;

export type ChoiceBarFold = (typeof CHOICE_BAR_FOLD)[keyof typeof CHOICE_BAR_FOLD];

/** The ids a tab and the panel it controls carry. */
export interface ChoicePanelIds {
  readonly tab: string;
  readonly panel: string;
}

/** The attributes an app hands the bar for finding it, its `data-` attributes alone. */
export type ChoiceAppAttributes = { [attribute: `data-${string}`]: string | undefined };

/** Where the thumb stands: hidden while nothing is chosen or drawn, placed at once, or sliding to a new option. */
const THUMB = {
  PLACED: "placed",
  SLIDING: "sliding",
} as const;

/** The bar's thumb, of its own children. */
const THUMB_ELEMENT = ":scope > .luke-choice-bar-thumb";

/** The option a bar's thumb stands under, of the bar's own options. */
const CHOSEN = ':scope > [aria-selected="true"], :scope > [aria-checked="true"]';

/** A box in a bar, in pixels from its padding edge. */
interface ThumbBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Sets where the thumb stands, its box, and the scale it is drawn at from its corner. */
function setThumb(bar: HTMLElement, box: ThumbBox, scaleX: number, scaleY: number): void {
  const style = bar.style;
  style.setProperty("--luke-choice-bar-thumb-x", `${box.x}px`);
  style.setProperty("--luke-choice-bar-thumb-y", `${box.y}px`);
  style.setProperty("--luke-choice-bar-thumb-width", `${box.width}px`);
  style.setProperty("--luke-choice-bar-thumb-height", `${box.height}px`);
  style.setProperty("--luke-choice-bar-thumb-scale-x", String(scaleX));
  style.setProperty("--luke-choice-bar-thumb-scale-y", String(scaleY));
}

/** Whether the thumb already stands, unscaled, on `box`. */
function thumbStands(bar: HTMLElement, box: ThumbBox): boolean {
  const style = bar.style;
  return (
    style.getPropertyValue("--luke-choice-bar-thumb-x") === `${box.x}px` &&
    style.getPropertyValue("--luke-choice-bar-thumb-y") === `${box.y}px` &&
    style.getPropertyValue("--luke-choice-bar-thumb-width") === `${box.width}px` &&
    style.getPropertyValue("--luke-choice-bar-thumb-height") === `${box.height}px` &&
    style.getPropertyValue("--luke-choice-bar-thumb-scale-x") === "1" &&
    style.getPropertyValue("--luke-choice-bar-thumb-scale-y") === "1"
  );
}

/**
 * Stands `bar`'s thumb under its chosen option, sliding there where `slide`
 * asks and the thumb already shows, and at once otherwise.
 *
 * A slide is played FLIP-style, on `transform` alone, as the motion
 * contract has it (`docs/DESIGN.md`): the thumb lands in its new box at
 * once, drawn by a transform where it was drawn before, from wherever a
 * slide still running had it; then, with its transition on, the transform
 * is let go. Note that the attribute that turns the transition on or off is
 * set beside each step, because a transition starts from the style after a
 * change, so the step back is never seen and the let go always is; and that
 * a thumb already where it should be is left alone, so a resize the slide
 * itself set off does not cut it short.
 */
function placeThumb(bar: HTMLElement, slide: boolean): void {
  const chosen = bar.querySelector<HTMLElement>(CHOSEN);
  const thumb = bar.querySelector<HTMLElement>(THUMB_ELEMENT);
  if (chosen === null || thumb === null || chosen.offsetWidth === 0) {
    bar.removeAttribute("data-thumb");
    return;
  }
  const box = {
    x: chosen.offsetLeft,
    y: chosen.offsetTop,
    width: chosen.offsetWidth,
    height: chosen.offsetHeight,
  };
  const shown = bar.hasAttribute("data-thumb");
  if (shown && thumbStands(bar, box)) return;
  if (slide && shown) {
    const drawn = thumb.getBoundingClientRect();
    const within = bar.getBoundingClientRect();
    const from = {
      x: drawn.left - within.left - bar.clientLeft + bar.scrollLeft,
      y: drawn.top - within.top - bar.clientTop + bar.scrollTop,
      width: box.width,
      height: box.height,
    };
    bar.setAttribute("data-thumb", THUMB.PLACED);
    setThumb(bar, from, drawn.width / box.width, drawn.height / box.height);
    // Note that measuring the thumb settles its step back before the slide starts.
    thumb.getBoundingClientRect();
  }
  bar.setAttribute("data-thumb", slide && shown ? THUMB.SLIDING : THUMB.PLACED);
  setThumb(bar, box, 1, 1);
}

/**
 * The ref the bar's own element takes and the one each option takes, which
 * keep its thumb under the chosen option: sliding to it after a render that
 * chose another, and placed at once when the bar or an option resizes (a
 * narrow bar dropping its names, a count growing, a hidden panel shown).
 * Note that each element is watched by an observer of its own, let go with
 * `disconnect`, the one way every observer has to stop.
 */
function useThumb() {
  const bar = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (bar.current !== null) placeThumb(bar.current, true);
  });
  const optionRef = useCallback((element: HTMLElement | null) => {
    if (element === null || !("ResizeObserver" in globalThis)) return undefined;
    const resized = new ResizeObserver(() => {
      if (bar.current !== null) placeThumb(bar.current, false);
    });
    resized.observe(element);
    return () => resized.disconnect();
  }, []);
  const barRef = useCallback(
    (element: HTMLDivElement | null) => {
      bar.current = element;
      const unwatch = optionRef(element);
      return () => {
        bar.current = null;
        unwatch?.();
      };
    },
    [optionRef],
  );
  return { bar, barRef, optionRef };
}

/** What the options say, which a fold measured with their names stands for until it changes. */
function namesOf(items: readonly ChoiceItem<string>[]): string {
  return JSON.stringify(
    items.map((item) => [
      item.label,
      item.count === undefined || !isParts(item.count)
        ? item.count
        : item.count.map((part) => part.text),
    ]),
  );
}

/**
 * Whether a bar folding together draws its options by their glyphs alone:
 * while their names do not fit its width. Note that the width the names
 * need is measured while they are drawn and kept while they are folded,
 * when it cannot be read, so the bar unfolds only once that much room
 * stands; options that say something new are measured named again, before
 * the frame is painted.
 */
function useFoldTogether(
  on: boolean,
  bar: React.RefObject<HTMLDivElement | null>,
  names: string,
): boolean {
  const [folded, setFolded] = useState(false);
  const needed = useRef(0);
  // Note that new names are measured named again, which is all this effect is for.
  useLayoutEffect(() => {
    setFolded(false);
  }, [names]);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!on || element === null) return undefined;
    const measure = () => {
      if (!folded && element.scrollWidth > element.clientWidth) {
        needed.current = element.scrollWidth;
        setFolded(true);
      } else if (folded && element.clientWidth >= needed.current) {
        setFolded(false);
      }
    };
    measure();
    if (!("ResizeObserver" in globalThis)) return undefined;
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    return () => resized.disconnect();
  }, [on, folded, bar, names]);
  return on && folded;
}

/**
 * What the bar's own element says it is, and the keys it takes: a tablist,
 * or a radio group. Note that the role, its name, and its handler are
 * handed over together, because the bar is one element whichever role it
 * takes, and Biome's a11y rules read a role only where it is a literal.
 */
function groupAttributes(
  role: ChoiceRole,
  label: string,
  onKeyDown: ChoiceKeys<string>["onKeyDown"],
): HTMLAttributes<HTMLDivElement> {
  return {
    role: role === CHOICE_ROLE.TAB ? "tablist" : "radiogroup",
    "aria-label": label,
    onKeyDown,
  };
}

/** What an option says it is: a tab selected while chosen and controlling its panel, or a radio checked while chosen. */
function optionAttributes(
  role: ChoiceRole,
  chosen: boolean,
  ids: ChoicePanelIds | undefined,
): ButtonHTMLAttributes<HTMLButtonElement> {
  return role === CHOICE_ROLE.TAB
    ? { role, id: ids?.tab, "aria-selected": chosen, "aria-controls": ids?.panel }
    : { role, "aria-checked": chosen };
}

/** Keeps the keyboard where it was when an option that takes no focus is pressed. */
function keepFocus(event: ReactMouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** One option: the value it chooses, its name, its glyph, what it counts, and whether it can be chosen. */
export interface ChoiceItem<Value extends string> {
  readonly value: Value;
  /** The option's name, read aloud where a narrow bar shows its glyph alone. */
  readonly label: string;
  readonly icon?: ReactNode;
  /** Words drawn quiet after the name, or parts each in its own tone. */
  readonly count?: string | readonly CountPart[] | undefined;
  readonly disabled?: boolean | undefined;
}

interface ChoiceBarBase<Value extends string> {
  /** The bar's accessible name. */
  label: string;
  items: readonly ChoiceItem<Value>[];
  /** The chosen option, or nothing while none is. */
  value: Value | undefined;
  look: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
  /** The id of each tab and of the panel it shows, by value: given, the bar is a tablist; absent, a radio group. */
  panels?: ((value: Value) => ChoicePanelIds) | undefined;
  focus?: ChoiceBarFocus | undefined;
  inset?: ChoiceBarInset | undefined;
  fold?: ChoiceBarFold | undefined;
  disabled?: boolean | undefined;
}

/** A bar whose choice always stands once made. */
interface ChoiceBarFixed<Value extends string> extends ChoiceBarBase<Value> {
  clearable?: false | undefined;
  onChange: (value: Value) => void;
}

/** A bar whose chosen option, pressed again, takes the choice back where `clearable` is on. */
interface ChoiceBarClearable<Value extends string> extends ChoiceBarBase<Value> {
  clearable: boolean;
  onChange: (value: Value | undefined) => void;
}

export type ChoiceBarProps<Value extends string> = (
  | ChoiceBarFixed<Value>
  | ChoiceBarClearable<Value>
) &
  ChoiceAppAttributes;

/** Whether an option's count is parts, each in its tone, rather than words. */
function isParts(count: string | readonly CountPart[]): count is readonly CountPart[] {
  return Array.isArray(count);
}

/** What an option counts, drawn: words as one quiet part, parts each in its tone. */
function countOf(count: ChoiceItem<string>["count"]): ReactNode {
  if (count === undefined) return undefined;
  return <CountParts parts={isParts(count) ? count : [{ text: count }]} />;
}

/** The bar over `items`, `value` chosen. */
export function ChoiceBar<Value extends string>(props: ChoiceBarProps<Value>): React.JSX.Element {
  const {
    label,
    items,
    value,
    look,
    size = CHOICE_BAR_SIZE.REGULAR,
    panels,
    focus = CHOICE_BAR_FOCUS.ROVING,
    inset = CHOICE_BAR_INSET.NONE,
    fold = CHOICE_BAR_FOLD.OWN,
    disabled = false,
    clearable: _,
    onChange: __,
    ...appAttributes
  } = props;
  const thumb = useThumb();
  const folded = useFoldTogether(fold === CHOICE_BAR_FOLD.TOGETHER, thumb.bar, namesOf(items));
  const role = panels === undefined ? CHOICE_ROLE.RADIO : CHOICE_ROLE.TAB;
  const roving = focus === CHOICE_BAR_FOCUS.ROVING;
  const choose = (chosen: Value) => props.onChange(chosen);
  // An arrow chooses the next option along and takes the keyboard there; Home and End go to either end.
  const keys = useChoiceKeys({
    options: items,
    value,
    role,
    disabled: disabled || !roving,
    onChoose: choose,
  });
  const press = (pressed: Value) => {
    if (pressed !== value) choose(pressed);
    else if (props.clearable === true) props.onChange(undefined);
  };
  return (
    <div
      ref={thumb.barRef}
      {...groupAttributes(role, label, keys.onKeyDown)}
      {...appAttributes}
      className="luke-choice-bar"
      data-look={look}
      data-size={size}
      data-inset={inset}
      data-fold={fold}
      data-folded={folded ? "true" : undefined}
    >
      <span className="luke-choice-bar-thumb" aria-hidden="true" />
      {items.map((item) => {
        const chosen = item.value === value;
        const count = countOf(item.count);
        return (
          <button
            key={item.value}
            ref={thumb.optionRef}
            type="button"
            {...optionAttributes(role, chosen, panels?.(item.value))}
            tabIndex={roving ? keys.tabIndexOf(item.value) : -1}
            className="luke-choice-bar-option"
            disabled={disabled || item.disabled === true}
            onMouseDown={roving ? undefined : keepFocus}
            onClick={() => press(item.value)}
          >
            {item.icon === undefined ? null : (
              <span className="luke-choice-bar-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="luke-choice-bar-label">{item.label}</span>
            {count === undefined ? null : <span className="luke-choice-bar-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
