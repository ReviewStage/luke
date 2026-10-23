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
 * `linesCount`'s, always green and red. An option may say more in the
 * hint over it (`hint`), such as the whole a count leaves out.
 *
 * `look` is how the chosen option stands out. `fill` is the window's own
 * selected state, a sidebar row's and an open tab's: plain words at the
 * control's height, a fill under the one chosen. It draws no underline: a
 * bar heading a page or a column stands in its header's band, whose
 * hairline is the header's. `segmented` is a trough, the chosen option on a
 * thumb raised in it, its options wrapping inside it when too wide, or,
 * stretched (`stretch`), filling its row on one line, its options sharing
 * it alike, as a pane switcher's. In either the fill or the thumb slides
 * from option to option. `size`
 * compact is a step smaller, in the caption's type. What finds the bar for an app (the
 * desktop's settings search) is the app's: it hands the bar the `data-`
 * attributes its search lands on.
 *
 * It is drawn by Base UI's toggle group (`@base-ui/react/toggle-group`),
 * single, each option one of its toggles: the bar is one element, one
 * roving tab stop over its options, a disabled option a native disabled
 * button, and a press on the pressed option let go, which `clearable`
 * takes as the choice taken back. Note that it is the toggle group rather
 * than Base UI's tabs or radio group, because tabs wrap their list in a
 * root element of their own and keep a disabled tab focusable, and a radio
 * stands a hidden input beside each option, each of which would change
 * what the bar is; the bar says it is a tablist or a radio group, and each
 * option a tab or a radio, over the group's own words. Its keys are Luke's
 * (`useChoiceKeys`), Base UI's own composite keys refused, because a
 * tablist steps by ← and → alone where a radio group takes ↑ and ↓ too, and
 * an arrow chooses as it moves. It is drawn in Tailwind over the theme
 * (`tailwind/theme.css`), each look's and size's utilities chosen here so
 * no two stand for one property; `choice-bar.css` keeps the thumb's
 * measured box and the fold's container and sibling rules. It keeps the
 * `luke-choice-bar*` classes, which the apps' sheets and tests select it by.
 */

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { keepIdentity } from "@luke/wire";
import {
  type ButtonHTMLAttributes,
  type ComponentType,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { pulseOnPress } from "../../press-pulse.js";
import { CHOICE_ROLE, type ChoiceRole } from "../choice/choice-keys.js";
import { type CountPart, CountParts } from "../choice/count-part.js";
import { type ChoiceKeys, useChoiceKeys } from "../choice/use-choice-keys.js";
import { Tooltip } from "../tooltip/hint.js";

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

/**
 * What folds a fill bar's options when the row is short of room: its own
 * width, each option but the chosen one drawn by its glyph alone below a
 * width; or their names not fitting (`together`), measured, every option
 * then drawn by its glyph alone at once, the chosen one too, so none is
 * named while the others are not. A bar folding together also takes its
 * options' room in where its toolbar sets `--luke-fold: tight`, which it
 * does before their names stop fitting. A bar a finger works (`words`) never
 * folds: every option is named in words alone, with no glyph a finger could
 * not hover for its name, and a row too long scrolls sideways.
 */
export const CHOICE_BAR_FOLD = {
  OWN: "own",
  TOGETHER: "together",
  WORDS: "words",
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

/**
 * The bar's box: a row of its options, never wider than its container. A
 * fill bar takes its container's width, scrolling sideways with no bar
 * drawn, and is the container its narrow fold measures (`choice-bar.css`);
 * a segmented one hugs its options in a trough, wrapping them inside it, or,
 * stretched, fills its row on one line.
 */
const BAR = "luke-choice-bar relative items-center min-w-0 max-w-full";

const BAR_LOOK = {
  fill: "flex flex-none self-stretch overflow-x-auto [scrollbar-width:none] @container/luke-choice-bar",
  segmented: "inline-flex gap-0.5 p-0.5 rounded-control bg-muted",
} as const satisfies Record<ChoiceBarLook, string>;

/** A fill bar's room between its options: compact takes it in. */
const FILL_GAP = {
  regular: "gap-0.5",
  compact: "gap-0",
} as const satisfies Record<ChoiceBarSize, string>;

/** A segmented bar's width: hugging its options and wrapping them, or filling its row on one line. */
const SEGMENTED_WIDTH = {
  hug: "flex-initial flex-wrap w-fit",
  stretch: "flex-auto flex-nowrap w-auto",
} as const;

/**
 * A fill bar folding together, or named in words alone, takes its options'
 * room in where its toolbar says `--luke-fold: tight`. Note that each is
 * keyed on the bar's `data-fold`, which outweighs the room it takes in.
 */
const FILL_TIGHT_BAR = "fold-tight:data-[fold]:gap-0";
const FILL_TIGHT_OPTION = "fold-tight:[[data-fold]_&]:gap-1 fold-tight:[[data-fold]_&]:px-1.5";

/**
 * An option: its glyph, name, and count in a row over the thumb, which is
 * drawn before it, in the muted ink, brightening to the text's own under
 * the pointer and while chosen, faded while disabled. Note that it draws
 * the keyboard's ring inside itself, because a scrolling row or a trough
 * leaves it no room outside; that its states are selectors of their own
 * rather than Tailwind's `hover:`, which a touch screen never answers; and
 * that the desktop's arrow cursor is keyed on its profile, which outweighs
 * the pointer.
 */
const OPTION = cn(
  "luke-choice-bar-option relative inline-flex items-center justify-center m-0 [border:0] [background:none]",
  "outline-offset-[var(--luke-focus-ring-inset)] text-muted-foreground font-ui font-medium whitespace-nowrap",
  "[transition:background-color_var(--luke-duration-hover)_ease,color_var(--luke-duration-hover)_ease]",
  "cursor-pointer [[data-luke-profile=desktop]_&]:cursor-default disabled:cursor-default disabled:opacity-40",
  "[&:hover:not(:disabled)]:text-foreground aria-selected:text-foreground aria-checked:text-foreground",
);

/**
 * Each look's option at each size. A fill option is the control's height,
 * lit under the pointer while not chosen; compact a step smaller, in the
 * caption's type. A segment sits inside its trough's inset, its corner the
 * trough's less that inset; on the site, whose muted ink holds AA on its
 * page's ground and not on the trough, it is drawn in the text's own ink.
 */
const OPTION_LOOK = {
  fill: {
    regular: "h-control py-0 px-2 gap-1.5 text-label",
    compact: "h-choice-fill-compact py-0 px-1.5 gap-1 text-caption",
  },
  segmented: {
    regular: "h-choice-segment py-0 px-3 gap-1.5 text-label",
    compact: "h-choice-segment-compact py-0 px-2 gap-1 text-caption",
  },
} as const satisfies Record<ChoiceBarLook, Record<ChoiceBarSize, string>>;

const OPTION_LOOK_STATE = {
  fill: "rounded-control [&:hover:not(:disabled):not([aria-selected=true],[aria-checked=true])]:bg-muted",
  segmented: "rounded-choice-segment [[data-luke-profile=web]_&]:text-foreground",
} as const satisfies Record<ChoiceBarLook, string>;

/** A stretched segment shares its row alike with the others; any other option keeps its own width. */
const OPTION_FLEX = {
  own: "flex-none",
  shared: "flex-[1_1_0]",
} as const;

/**
 * The thumb: hidden until the row has measured its chosen option, then
 * standing there (`choice-bar.css` reads the box), sliding on its transform
 * alone where motion is let run. A fill's is the strong fill; a segment's a
 * thumb raised on a hairline and a soft shadow.
 */
const THUMB_BOX =
  "luke-choice-bar-thumb absolute top-0 left-0 hidden [[data-thumb]_&]:block origin-top-left pointer-events-none motion-safe:[[data-thumb=sliding]_&]:[transition:transform_var(--luke-duration-fast)_var(--luke-spring-fast)]";

const THUMB_LOOK = {
  fill: "rounded-control bg-fill-strong",
  segmented:
    "rounded-choice-segment bg-choice-thumb [box-shadow:0_0_0_0.5px_var(--luke-color-border-strong),0_1px_2px_var(--luke-color-shadow-soft)]",
} as const satisfies Record<ChoiceBarLook, string>;

/** The glyph slot says its size (`--luke-glyph-size`), which a glyph the app seats in it, a `GlyphSlot`, reads. */
const ICON =
  "luke-choice-bar-icon inline-flex [--luke-glyph-size:var(--luke-control-icon)] [&>svg]:size-control-icon";

/**
 * The count lays its parts out as a row centred on the option rather than
 * as words on a line, because a part is an inline box whose baseline is its
 * glyph's bottom edge, which set it a pixel or two above the option's name;
 * the gap stands for the space between parts, which a row drops.
 */
const COUNT =
  "luke-choice-bar-count inline-flex items-center gap-1 text-subtle-foreground text-caption tabular-nums font-regular";

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
 * chose another, or that changed which options stand (`placed`), and placed
 * at once when the bar or an option resizes (a narrow bar dropping its
 * names, a count growing, a hidden panel shown). Note that each element is
 * watched by an observer of its own, let go with `disconnect`, the one way
 * every observer has to stop; and that a render changing neither is left
 * alone, because reading where an option stands lays out the whole window,
 * and a bar is drawn again with everything around it.
 */
function useThumb(chosen: string | undefined, placed: OptionsPlaced) {
  const bar = useRef<HTMLDivElement | null>(null);
  // Note that the thumb is placed again only when the choice or the options standing change; a resize is the observers'.
  useLayoutEffect(() => {
    if (bar.current !== null) placeThumb(bar.current, true);
  }, [chosen, placed]);
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

/**
 * The width the options take as they stand, from the bar's start to the
 * last one's end and the bar's own inset after it. Note that this is read
 * from the options rather than the bar's `scrollWidth`, which is never less
 * than the bar's own width, so it says how little folded options take.
 */
function optionsWidth(bar: HTMLElement): number {
  const options = bar.querySelectorAll<HTMLElement>(".luke-choice-bar-option");
  const last = options[options.length - 1];
  if (last === undefined) return 0;
  const inset = Number.parseFloat(getComputedStyle(bar).paddingInlineEnd) || 0;
  return last.offsetLeft + last.offsetWidth + inset;
}

/** The room the folded options' names would take back: each name's own width and the gap it would stand in. */
function foldedNames(bar: HTMLElement): number {
  let room = 0;
  for (const label of bar.querySelectorAll<HTMLElement>(
    ".luke-choice-bar-icon + .luke-choice-bar-label",
  )) {
    const option = label.parentElement;
    const gap = option === null ? 0 : Number.parseFloat(getComputedStyle(option).columnGap) || 0;
    room += label.scrollWidth + gap;
  }
  return room;
}

/** How far short of the bar's width named options must stand before a folded bar names them again, so a width on the edge never sets it folding and unfolding in turn. */
const UNFOLD_SLACK = 2;

/**
 * Whether a bar folding together draws its options by their glyphs alone:
 * while their names do not fit its width. The width the names take is
 * measured from the options as they stand, drawn or folded (`optionsWidth`),
 * a folded name read by its own width (`foldedNames`), so a change that makes them fit, a tighter step's
 * padding among them, unfolds the bar at once. It is measured before the
 * frame is painted as it first draws and whenever the options' names or the
 * bar's look change (`named`), and whenever the bar or an option resizes.
 * Note that a draw changing neither reads nothing, because measuring lays out
 * the whole window, and a bar is drawn again with everything around it.
 */
function useFoldTogether(
  on: boolean,
  bar: React.RefObject<HTMLDivElement | null>,
  named: OptionsNamed | undefined,
): boolean {
  const [folded, setFolded] = useState(false);
  const measure = useCallback(() => {
    const element = bar.current;
    if (!on || element === null) return;
    const named = optionsWidth(element) + (folded ? foldedNames(element) : 0);
    setFolded(folded ? named > element.clientWidth - UNFOLD_SLACK : named > element.clientWidth);
  }, [on, bar, folded]);
  useLayoutEffect(measure, [measure, named]);
  // Note that the options are found afresh as they change, so one that joined is watched too.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!on || element === null || !("ResizeObserver" in globalThis)) return undefined;
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    for (const option of element.children) resized.observe(option);
    return () => resized.disconnect();
  }, [on, bar, measure, named]);
  return on && folded;
}

/**
 * What the bar's own element says it is, and the keys it takes: a tablist,
 * or a radio group, over the toggle group's own `group`. Note that the
 * role, its name, and its handler are handed over together, because the bar
 * is one element whichever role it takes, and Biome's a11y rules read a
 * role only where it is a literal; and that the handler always refuses the
 * group's own composite keys, so a key the bar does not move by (↑ in a
 * tablist, a key held with a modifier, any in a disabled bar) moves nothing.
 */
function groupAttributes(
  role: ChoiceRole,
  label: string,
  onKeyDown: ChoiceKeys<string>["onKeyDown"],
): Pick<ToggleGroupPrimitive.Props<string>, "role" | "aria-label" | "onKeyDown"> {
  return {
    role: role === CHOICE_ROLE.TAB ? "tablist" : "radiogroup",
    "aria-label": label,
    onKeyDown: (event) => {
      event.preventBaseUIHandler();
      onKeyDown?.(event);
    },
  };
}

/**
 * What an option says it is: a tab selected while chosen and controlling
 * its panel, or a radio checked while chosen, never the toggle's own
 * pressed state, which would say it a second way.
 */
function optionAttributes(
  role: ChoiceRole,
  chosen: boolean,
  ids: ChoicePanelIds | undefined,
): ButtonHTMLAttributes<HTMLButtonElement> {
  return role === CHOICE_ROLE.TAB
    ? {
        role,
        id: ids?.tab,
        "aria-selected": chosen,
        "aria-controls": ids?.panel,
        "aria-pressed": undefined,
      }
    : { role, "aria-checked": chosen, "aria-pressed": undefined };
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
  /** What the hint over the option says beyond its name and count (the whole a count leaves out); none raises nothing. */
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
}

/** What a hint hands the option it wraps: when to show and go, and what it says of it. */
interface ChoiceBarHintProps {
  "aria-describedby"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/** The hint an app hangs from an option that has one, saying `label`. */
export type ChoiceBarHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<ChoiceBarHintProps>;
}>;

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
  fold?: ChoiceBarFold | undefined;
  /** Whether a segmented bar fills its row on one line, its options sharing it alike, rather than hugging them. */
  stretch?: boolean | undefined;
  /** The hint hung from each option that says one (`ChoiceItem.hint`): the window's tooltip, unless the caller hangs one of its own. */
  hint?: ChoiceBarHint | undefined;
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

/** How the bar draws its options and which stand, in order: what moves the thumb without resizing what it watches. */
interface OptionsPlaced {
  readonly look: ChoiceBarLook;
  readonly size: ChoiceBarSize;
  readonly values: readonly string[];
}

/** One option as a bar folding together is measured by: its glyph, name, and count. */
interface OptionNamed {
  readonly value: string;
  readonly glyph: boolean;
  readonly label: string;
  readonly count: string | readonly CountPart[] | null;
}

/** What a bar folding together is measured by: how it draws its options, and each option's glyph, name, and count; a change in any may fold or unfold it without resizing the bar. */
interface OptionsNamed {
  readonly look: ChoiceBarLook;
  readonly size: ChoiceBarSize;
  readonly options: readonly OptionNamed[];
}

/**
 * `next`, or the value held from an earlier draw where the two are equal in
 * every part (`keepIdentity`), so a value built afresh on every draw changes
 * identity only when what it says changes, and an effect listing it runs
 * only then.
 */
function useKept<Value>(next: Value): Value {
  const [held, setHeld] = useState(next);
  const kept = keepIdentity(held, next);
  if (kept !== held) setHeld(kept);
  return kept;
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
    fold = CHOICE_BAR_FOLD.OWN,
    stretch = false,
    hint: Hint = Tooltip,
    disabled = false,
    clearable: _,
    onChange: __,
    ...appAttributes
  } = props;
  const placed = useKept<OptionsPlaced>({
    look,
    size,
    values: items.map((item) => item.value),
  });
  const thumb = useThumb(value, placed);
  const together = fold === CHOICE_BAR_FOLD.TOGETHER;
  const named = useKept<OptionsNamed | undefined>(
    together
      ? {
          look,
          size,
          options: items.map((item) => ({
            value: item.value,
            glyph: item.icon !== undefined,
            label: item.label,
            count: item.count ?? null,
          })),
        }
      : undefined,
  );
  const folded = useFoldTogether(together, thumb.bar, named);
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
  // A press on another option chooses it; one on the chosen option lets it go, which a clearable bar takes as the choice taken back.
  const press = (pressed: readonly Value[]) => {
    const next = pressed[0];
    if (next !== undefined) choose(next);
    else if (props.clearable === true) props.onChange(undefined);
  };
  const segmented = look === CHOICE_BAR_LOOK.SEGMENTED;
  const tight = !segmented && fold !== CHOICE_BAR_FOLD.OWN;
  const optionClass = cn(
    OPTION,
    OPTION_LOOK[look][size],
    OPTION_LOOK_STATE[look],
    segmented && stretch ? OPTION_FLEX.shared : OPTION_FLEX.own,
    tight && FILL_TIGHT_OPTION,
  );
  return (
    <ToggleGroupPrimitive<Value>
      ref={thumb.barRef}
      value={value === undefined ? [] : [value]}
      onValueChange={press}
      {...groupAttributes(role, label, keys.onKeyDown)}
      {...appAttributes}
      className={cn(
        BAR,
        BAR_LOOK[look],
        segmented
          ? SEGMENTED_WIDTH[stretch ? "stretch" : "hug"]
          : [FILL_GAP[size], tight && FILL_TIGHT_BAR],
      )}
      data-look={look}
      data-size={size}
      data-fold={fold}
      data-folded={folded ? "true" : undefined}
      data-stretch={stretch ? "true" : undefined}
    >
      <span className={cn(THUMB_BOX, THUMB_LOOK[look])} aria-hidden="true" />
      {items.map((item) => {
        const chosen = item.value === value;
        const count = countOf(item.count);
        const option = (
          <TogglePrimitive<Value>
            key={item.value}
            ref={thumb.optionRef}
            {...optionAttributes(role, chosen, panels?.(item.value))}
            value={item.value}
            tabIndex={roving ? keys.tabIndexOf(item.value) : -1}
            className={optionClass}
            disabled={disabled || item.disabled === true}
            onMouseDown={roving ? undefined : keepFocus}
            onClick={pulseOnPress()}
          >
            {item.icon === undefined || fold === CHOICE_BAR_FOLD.WORDS ? null : (
              <span className={ICON} aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="luke-choice-bar-label">{item.label}</span>
            {count === undefined ? null : <span className={COUNT}>{count}</span>}
          </TogglePrimitive>
        );
        return item.hint === undefined ? (
          option
        ) : (
          <Hint key={item.value} label={item.hint}>
            {option}
          </Hint>
        );
      })}
    </ToggleGroupPrimitive>
  );
}
