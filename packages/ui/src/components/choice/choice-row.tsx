/**
 * choice-row.tsx -- the row every bar of options where you choose one draws through: `ChoiceBar`, and the `Tabs` and `Segmented` it stands behind.
 *
 * The row's semantics follow from whether its options show panels, never
 * from how it looks: handed `panels`, it is a tablist whose tabs control
 * them; without, a radio group whose radios set a value. Its keys and its
 * one tab stop are `useChoiceKeys`'s, unless the row takes no focus at all
 * (`CHOICE_BAR_FOCUS.NONE`), where its owner, a field the keyboard stays in,
 * drives it. Its look is a fill under the chosen option, as the sidebar's
 * rows and the window's tabs draw theirs, or a thumb raised in a trough;
 * either is one element that slides from option to option, measured off
 * the chosen one, placed without a move when it first shows or when the
 * row's layout changes under it, and still under reduced motion (the
 * motion tokens answer that). The row draws a count already drawn: a
 * caller with parts hands `CountParts`, which `ChoiceBar` does for it.
 *
 * This module is the engine's, not the barrel's: a caller reaches it as
 * `ChoiceBar`.
 */

import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { CHOICE_ROLE, type ChoiceRole } from "./choice-keys.js";
import { type ChoiceKeys, useChoiceKeys } from "./use-choice-keys.js";

/** How the row draws its chosen option: a fill under it, or a thumb raised in a trough. */
export const CHOICE_BAR_LOOK = {
  FILL: "fill",
  SEGMENTED: "segmented",
} as const;

export type ChoiceBarLook = (typeof CHOICE_BAR_LOOK)[keyof typeof CHOICE_BAR_LOOK];

/** How much room the row keeps around its options: a page's, or a step smaller in the caption's type. */
export const CHOICE_BAR_SIZE = {
  REGULAR: "regular",
  COMPACT: "compact",
} as const;

export type ChoiceBarSize = (typeof CHOICE_BAR_SIZE)[keyof typeof CHOICE_BAR_SIZE];

/** Whether the row's options take the keyboard, one tab stop roving among them, or none, its owner driving the keys. */
export const CHOICE_BAR_FOCUS = {
  ROVING: "roving",
  NONE: "none",
} as const;

export type ChoiceBarFocus = (typeof CHOICE_BAR_FOCUS)[keyof typeof CHOICE_BAR_FOCUS];

/** Where a fill row stands its options: at its container's edges, with the words of a page read at its measure, or at a column's inset. */
export const CHOICE_BAR_INSET = {
  NONE: "none",
  READING: "reading",
  COLUMN: "column",
} as const;

export type ChoiceBarInset = (typeof CHOICE_BAR_INSET)[keyof typeof CHOICE_BAR_INSET];

/** The ids a tab and the panel it controls carry. */
export interface ChoicePanelIds {
  readonly tab: string;
  readonly panel: string;
}

/** The attributes an app hands the row for finding it, its `data-` attributes alone. */
export type ChoiceAppAttributes = { [attribute: `data-${string}`]: string | undefined };

/** One option as the row draws it: its count already drawn. */
export interface ChoiceRowOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly count?: ReactNode;
  readonly disabled?: boolean | undefined;
}

/** Where the thumb stands: hidden while nothing is chosen or drawn, placed at once, or sliding to a new option. */
const THUMB = {
  PLACED: "placed",
  SLIDING: "sliding",
} as const;

/** The row's thumb, of its own children. */
const THUMB_ELEMENT = ":scope > .luke-choice-bar-thumb";

/** The option a row's thumb stands under, of the row's own options. */
const CHOSEN = ':scope > [aria-selected="true"], :scope > [aria-checked="true"]';

/** A box in a row, in pixels from its padding edge. */
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
 * The ref the row's own element takes and the one each option takes, which
 * keep its thumb under the chosen option: sliding to it after a render that
 * chose another, and placed at once when the row or an option resizes (a
 * narrow row dropping its names, a count growing, a hidden panel shown).
 */
function useThumb() {
  const bar = useRef<HTMLDivElement | null>(null);
  const resized = useRef<ResizeObserver | undefined>(undefined);
  useLayoutEffect(() => {
    if (bar.current !== null) placeThumb(bar.current, true);
  });
  const optionRef = useCallback((element: HTMLElement | null) => {
    if (element === null || !("ResizeObserver" in globalThis)) return undefined;
    resized.current ??= new ResizeObserver(() => {
      if (bar.current !== null) placeThumb(bar.current, false);
    });
    const observer = resized.current;
    observer.observe(element);
    return () => observer.unobserve(element);
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
  return { barRef, optionRef };
}

/**
 * What the row's own element says it is, and the keys it takes: a tablist,
 * or a radio group. Note that the role, its name, and its handler are
 * handed over together, because the row is one element whichever role it
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

/** The row of `options`, `value` chosen, drawn in `look`. */
export function ChoiceRow<Value extends string>({
  label,
  options,
  value,
  onChoose,
  onClear,
  look,
  size = CHOICE_BAR_SIZE.REGULAR,
  panels,
  focus = CHOICE_BAR_FOCUS.ROVING,
  inset = CHOICE_BAR_INSET.NONE,
  disabled = false,
  appAttributes,
}: {
  /** The row's accessible name. */
  label: string;
  options: readonly ChoiceRowOption<Value>[];
  /** The chosen option, or nothing while none is. */
  value: Value | undefined;
  /** Answers a press or a key that lands on an option other than the chosen one. */
  onChoose: (value: Value) => void;
  /** Answers a press on the chosen option, which takes the choice back; none where the row's choice stands. */
  onClear?: (() => void) | undefined;
  look: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
  /** The id of each tab and of the panel it shows, which makes the row a tablist; none for a radio group. */
  panels?: ((value: Value) => ChoicePanelIds) | undefined;
  focus?: ChoiceBarFocus | undefined;
  inset?: ChoiceBarInset | undefined;
  disabled?: boolean | undefined;
  appAttributes?: ChoiceAppAttributes | undefined;
}): React.JSX.Element {
  const thumb = useThumb();
  const role = panels === undefined ? CHOICE_ROLE.RADIO : CHOICE_ROLE.TAB;
  const roving = focus === CHOICE_BAR_FOCUS.ROVING;
  // An arrow chooses the next option along and takes the keyboard there; Home and End go to either end.
  const keys = useChoiceKeys({ options, value, role, disabled: disabled || !roving, onChoose });
  const press = (pressed: Value) => {
    if (pressed !== value) onChoose(pressed);
    else onClear?.();
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
    >
      <span className="luke-choice-bar-thumb" aria-hidden="true" />
      {options.map((option) => {
        const chosen = option.value === value;
        const ids = panels?.(option.value);
        return (
          <button
            key={option.value}
            ref={thumb.optionRef}
            type="button"
            {...optionAttributes(role, chosen, ids)}
            tabIndex={roving ? keys.tabIndexOf(option.value) : -1}
            className="luke-choice-bar-option"
            disabled={disabled || option.disabled === true}
            onMouseDown={roving ? undefined : keepFocus}
            onClick={() => press(option.value)}
          >
            {option.icon === undefined ? null : (
              <span className="luke-choice-bar-icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="luke-choice-bar-label">{option.label}</span>
            {option.count === undefined ? null : (
              <span className="luke-choice-bar-count">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
