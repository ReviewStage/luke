import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { keepIdentity } from "@repo/wire";
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
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../cn.js";
import { ChevronRightIcon } from "../../face/glyphs.js";
import { joinRefs } from "../../join-refs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { type CountPart, CountParts } from "../choice/count-part.js";
import {
  ROVING_ORIENTATION,
  ROVING_STOP,
  type RovingBox,
  rovingItem,
  useRovingKeys,
} from "../roving-keys/roving-keys.js";
import { SCROLL_AXIS, SCROLL_FADE, scrollFadeMarks } from "../scroll-area/scroll-area.js";
import { Tooltip } from "../tooltip/hint.js";

const CHOICE_ROLE = {
  TAB: "tab",
  RADIO: "radio",
} as const;

type ChoiceRole = (typeof CHOICE_ROLE)[keyof typeof CHOICE_ROLE];

export const CHOICE_BAR_LOOK = {
  FILL: "fill",
  SEGMENTED: "segmented",
} as const;

export type ChoiceBarLook = (typeof CHOICE_BAR_LOOK)[keyof typeof CHOICE_BAR_LOOK];

export const CHOICE_BAR_SIZE = {
  REGULAR: "regular",
  COMPACT: "compact",
} as const;

export type ChoiceBarSize = (typeof CHOICE_BAR_SIZE)[keyof typeof CHOICE_BAR_SIZE];

export const CHOICE_BAR_FOCUS = {
  ROVING: "roving",
  NONE: "none",
} as const;

export type ChoiceBarFocus = (typeof CHOICE_BAR_FOCUS)[keyof typeof CHOICE_BAR_FOCUS];

export const CHOICE_BAR_FOLD = {
  OWN: "own",
  TOGETHER: "together",
  WORDS: "words",
} as const;

export type ChoiceBarFold = (typeof CHOICE_BAR_FOLD)[keyof typeof CHOICE_BAR_FOLD];

export interface ChoicePanelIds {
  readonly tab: string;
  readonly panel: string;
}

export type ChoiceAppAttributes = { [attribute: `data-${string}`]: string | undefined };

const THUMB = {
  PLACED: "placed",
  SLIDING: "sliding",
} as const;

const THUMB_ELEMENT = ":scope > .ui-choice-bar-thumb";

const FOLDABLE_NAME = ".ui-choice-bar-icon + .ui-choice-bar-label";

const FOLDABLE_PART = ".ui-choice-bar-option:has(> .ui-choice-bar-icon) .ui-count-part[data-folds]";

const NAME_FOLD = "--ui-choice-bar-name";
const NAME_FOLDED = "folded";

const NONE_FOLDED: ReadonlySet<string> = new Set();

const CHOSEN = ':scope > [aria-selected="true"], :scope > [aria-checked="true"]';

const BAR =
  "ui-choice-bar relative items-center flex-nowrap min-w-0 max-w-full [scrollbar-width:none]";

const BAR_FADE = scrollFadeMarks(SCROLL_FADE.BOTH, SCROLL_AXIS.HORIZONTAL);

const WORDS_FRAME =
  "ui-choice-bar-frame relative flex min-w-0 max-w-full self-stretch items-center pe-control-icon [.ui-pane-bar-middle>&]:flex-1";
const WORDS_BAR = "[.ui-choice-bar-frame>&]:flex-1";
const WORDS_MORE =
  "ui-choice-bar-more absolute inset-y-0 end-0 flex items-center pointer-events-none text-muted-foreground [&>svg]:size-control-icon";

const BAR_LOOK = {
  fill: "flex flex-none [.ui-pane-bar-middle>&]:flex-1 self-stretch @container/ui-choice-bar",
  segmented: "inline-flex gap-0.5 p-0.5 rounded-control bg-muted",
} as const satisfies Record<ChoiceBarLook, string>;

const FILL_GAP = {
  regular: "gap-0.5",
  compact: "gap-0",
} as const satisfies Record<ChoiceBarSize, string>;

const SEGMENTED_WIDTH = {
  hug: "flex-initial w-fit",
  stretch: "flex-auto w-auto",
} as const;

const FILL_TIGHT_BAR = "fold-tight:data-[fold]:gap-0";
const FILL_TIGHT_OPTION = "fold-tight:[[data-fold]_&]:gap-1 fold-tight:[[data-fold]_&]:px-1.5";

const OPTION = cn(
  "ui-choice-bar-option relative inline-flex items-center justify-center m-0 [border:0] [background:none]",
  "outline-offset-[var(--ui-focus-ring-inset)] text-muted-foreground font-ui font-label whitespace-nowrap",
  "[transition:background-color_var(--ui-duration-hover)_var(--ui-motion-exit),color_var(--ui-duration-hover)_var(--ui-motion-exit)]",
  "cursor-press disabled:cursor-default disabled:opacity-disabled",
  "hover:not-disabled:text-foreground aria-selected:text-foreground aria-checked:text-foreground",
);

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
  fill: "rounded-control hover:not-disabled:not-aria-selected:not-aria-checked:bg-muted",
  segmented: "rounded-choice-segment [[data-ui-profile=web]_&]:text-foreground",
} as const satisfies Record<ChoiceBarLook, string>;

const OPTION_FLEX = {
  own: "flex-none",
  shared: "flex-[1_1_0]",
} as const;

const THUMB_BOX =
  "ui-choice-bar-thumb absolute top-0 left-0 hidden [[data-thumb]_&]:block origin-top-left pointer-events-none motion-safe:[[data-thumb=sliding]_&]:[transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast)]";

const THUMB_LOOK = {
  fill: "rounded-control bg-fill-strong",
  segmented:
    "rounded-choice-segment bg-choice-thumb [box-shadow:0_0_0_0.5px_var(--ui-color-border-strong),0_1px_2px_var(--ui-color-shadow-soft)]",
} as const satisfies Record<ChoiceBarLook, string>;

const ICON =
  "ui-choice-bar-icon inline-flex [--ui-glyph-size:var(--ui-control-icon)] [&>svg]:size-control-icon";

const COUNT =
  "ui-choice-bar-count inline-flex items-center gap-1 text-muted-foreground text-caption tabular-nums font-caption";

interface ThumbBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function setThumb(bar: HTMLElement, box: ThumbBox, scaleX: number, scaleY: number): void {
  const style = bar.style;
  style.setProperty("--ui-choice-bar-thumb-x", `${box.x}px`);
  style.setProperty("--ui-choice-bar-thumb-y", `${box.y}px`);
  style.setProperty("--ui-choice-bar-thumb-width", `${box.width}px`);
  style.setProperty("--ui-choice-bar-thumb-height", `${box.height}px`);
  style.setProperty("--ui-choice-bar-thumb-scale-x", String(scaleX));
  style.setProperty("--ui-choice-bar-thumb-scale-y", String(scaleY));
}

function thumbStands(bar: HTMLElement, box: ThumbBox): boolean {
  const style = bar.style;
  return (
    style.getPropertyValue("--ui-choice-bar-thumb-x") === `${box.x}px` &&
    style.getPropertyValue("--ui-choice-bar-thumb-y") === `${box.y}px` &&
    style.getPropertyValue("--ui-choice-bar-thumb-width") === `${box.width}px` &&
    style.getPropertyValue("--ui-choice-bar-thumb-height") === `${box.height}px` &&
    style.getPropertyValue("--ui-choice-bar-thumb-scale-x") === "1" &&
    style.getPropertyValue("--ui-choice-bar-thumb-scale-y") === "1"
  );
}

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
    thumb.getBoundingClientRect();
  }
  bar.setAttribute("data-thumb", slide && shown ? THUMB.SLIDING : THUMB.PLACED);
  setThumb(bar, box, 1, 1);
}

function revealChosen(bar: HTMLElement): void {
  const chosen = bar.querySelector<HTMLElement>(CHOSEN);
  if (chosen === null || bar.scrollWidth <= bar.clientWidth) return;
  const style = getComputedStyle(bar);
  const start = chosen.offsetLeft - (Number.parseFloat(style.scrollPaddingInlineStart) || 0);
  const end =
    chosen.offsetLeft +
    chosen.offsetWidth +
    (Number.parseFloat(style.scrollPaddingInlineEnd) || 0) -
    bar.clientWidth;
  if (start < bar.scrollLeft) bar.scrollLeft = start;
  else if (end > bar.scrollLeft) bar.scrollLeft = end;
}

function useThumb(chosen: string | undefined, placed: OptionsPlaced) {
  const bar = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (bar.current === null) return;
    placeThumb(bar.current, true);
    revealChosen(bar.current);
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

function optionsWidth(bar: HTMLElement): number {
  const options = bar.querySelectorAll<HTMLElement>(".ui-choice-bar-option");
  const last = options[options.length - 1];
  if (last === undefined) return 0;
  const inset = Number.parseFloat(getComputedStyle(bar).paddingInlineEnd) || 0;
  return last.offsetLeft + last.offsetWidth + inset;
}

function foldedNames(bar: HTMLElement): number {
  let room = 0;
  for (const folded of bar.querySelectorAll<HTMLElement>(`${FOLDABLE_NAME}, ${FOLDABLE_PART}`)) {
    const row = folded.parentElement;
    const gap = row === null ? 0 : Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    room += folded.scrollWidth + gap;
  }
  return room;
}

const UNFOLD_SLACK = 2;

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

function foldedAs(folded: ReadonlySet<string>, value: string, now: boolean): ReadonlySet<string> {
  const next = new Set(folded);
  if (now) next.add(value);
  else next.delete(value);
  return next;
}

function useOwnFold(on: boolean): {
  readonly optionRef: (option: HTMLElement | null) => (() => void) | undefined;
  readonly folded: ReadonlySet<string>;
} {
  const [folded, setFolded] = useState(NONE_FOLDED);
  const optionRef = useCallback(
    (option: HTMLElement | null) => {
      const value = option?.dataset.value;
      if (!on || option === null || value === undefined) return undefined;
      if (!("ResizeObserver" in globalThis)) return undefined;
      const resized = new ResizeObserver(() => {
        const name = option.querySelector<HTMLElement>(FOLDABLE_NAME);
        const now =
          name !== null &&
          getComputedStyle(name).getPropertyValue(NAME_FOLD).trim() === NAME_FOLDED;
        setFolded((was) => (was.has(value) === now ? was : foldedAs(was, value, now)));
      });
      resized.observe(option);
      return () => resized.disconnect();
    },
    [on],
  );
  return { optionRef, folded };
}

function groupAttributes(
  role: ChoiceRole,
  label: string,
  onKeyDown: RovingBox<HTMLDivElement>["onKeyDown"] | undefined,
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

function keepFocus(event: ReactMouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

export interface ChoiceItem<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly count?: string | readonly CountPart[] | undefined;
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly replayMasked?: boolean | undefined;
}

interface ChoiceBarHintProps {
  "aria-describedby"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type ChoiceBarHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<ChoiceBarHintProps>;
}>;

interface ChoiceBarBase<Value extends string> {
  label: string;
  items: readonly ChoiceItem<Value>[];
  value: Value | undefined;
  look: ChoiceBarLook;
  size?: ChoiceBarSize | undefined;
  panels?: ((value: Value) => ChoicePanelIds) | undefined;
  focus?: ChoiceBarFocus | undefined;
  fold?: ChoiceBarFold | undefined;
  stretch?: boolean | undefined;
  hint?: ChoiceBarHint | undefined;
  disabled?: boolean | undefined;
}

interface ChoiceBarFixed<Value extends string> extends ChoiceBarBase<Value> {
  clearable?: false | undefined;
  onChange: (value: Value) => void;
}

interface ChoiceBarClearable<Value extends string> extends ChoiceBarBase<Value> {
  clearable: boolean;
  onChange: (value: Value | undefined) => void;
}

export type ChoiceBarProps<Value extends string> = (
  | ChoiceBarFixed<Value>
  | ChoiceBarClearable<Value>
) &
  ChoiceAppAttributes;

function isParts(count: string | readonly CountPart[]): count is readonly CountPart[] {
  return Array.isArray(count);
}

function countOf(count: ChoiceItem<string>["count"]): ReactNode {
  if (count === undefined) return undefined;
  return <CountParts parts={isParts(count) ? count : [{ text: count }]} />;
}

interface OptionsPlaced {
  readonly look: ChoiceBarLook;
  readonly size: ChoiceBarSize;
  readonly values: readonly string[];
}

interface OptionNamed {
  readonly value: string;
  readonly glyph: boolean;
  readonly label: string;
  readonly count: string | readonly CountPart[] | null;
}

interface OptionsNamed {
  readonly look: ChoiceBarLook;
  readonly size: ChoiceBarSize;
  readonly options: readonly OptionNamed[];
}

function useKept<Value>(next: Value): Value {
  const [held, setHeld] = useState(next);
  const kept = keepIdentity(held, next);
  if (kept !== held) setHeld(kept);
  return kept;
}

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
  const ownFolds = fold === CHOICE_BAR_FOLD.OWN && look === CHOICE_BAR_LOOK.FILL;
  const ownFold = useOwnFold(ownFolds);
  const optionRef = useMemo(
    () => joinRefs(thumb.optionRef, ownFold.optionRef),
    [thumb.optionRef, ownFold.optionRef],
  );
  const role = panels === undefined ? CHOICE_ROLE.RADIO : CHOICE_ROLE.TAB;
  const roving = focus === CHOICE_BAR_FOCUS.ROVING;
  const choose = (chosen: Value) => props.onChange(chosen);
  const keys = useRovingKeys<HTMLDivElement>({
    orientation: role === CHOICE_ROLE.TAB ? ROVING_ORIENTATION.HORIZONTAL : ROVING_ORIENTATION.BOTH,
    stop: roving ? ROVING_STOP.CHOSEN : ROVING_STOP.NONE,
    moveTo: (option) => {
      option.focus();
      const landed = items.find((item) => item.value === option.dataset.value);
      if (landed !== undefined && landed.value !== value) choose(landed.value);
    },
  });
  const barRef = useMemo(() => joinRefs(thumb.barRef, keys.ref), [thumb.barRef, keys.ref]);
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
  const words = fold === CHOICE_BAR_FOLD.WORDS;
  const bar = (
    <ToggleGroupPrimitive<Value>
      ref={barRef}
      value={value === undefined ? [] : [value]}
      onValueChange={press}
      data-roving={keys["data-roving"]}
      onFocus={keys.onFocus}
      {...groupAttributes(role, label, disabled || !roving ? undefined : keys.onKeyDown)}
      {...appAttributes}
      data-axis={BAR_FADE["data-axis"]}
      data-fade={BAR_FADE["data-fade"]}
      className={cn(
        BAR,
        BAR_FADE.className,
        BAR_LOOK[look],
        segmented
          ? SEGMENTED_WIDTH[stretch ? "stretch" : "hug"]
          : [FILL_GAP[size], tight && FILL_TIGHT_BAR],
        words && WORDS_BAR,
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
            ref={optionRef}
            {...optionAttributes(role, chosen, panels?.(item.value))}
            value={item.value}
            data-value={item.value}
            {...rovingItem()}
            tabIndex={-1}
            className={optionClass}
            disabled={disabled || item.disabled === true}
            onMouseDown={roving ? undefined : keepFocus}
            onClick={pulseOnPress()}
          >
            {item.icon === undefined || words ? null : (
              <span className={ICON} aria-hidden="true">
                {item.icon}
              </span>
            )}
            <span className="ui-choice-bar-label">
              <ReplayWords masked={item.replayMasked}>{item.label}</ReplayWords>
            </span>
            {count === undefined ? null : <span className={COUNT}>{count}</span>}
          </TogglePrimitive>
        );
        const foldable = item.icon !== undefined && (together || ownFolds);
        const nameFolded = foldable && (folded || ownFold.folded.has(item.value));
        return item.hint === undefined && !foldable ? (
          option
        ) : (
          <Hint key={item.value} label={item.hint ?? (nameFolded ? item.label : undefined)}>
            {option}
          </Hint>
        );
      })}
    </ToggleGroupPrimitive>
  );
  return words ? (
    <span className={WORDS_FRAME}>
      {bar}
      <span className={WORDS_MORE} aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </span>
  ) : (
    bar
  );
}
