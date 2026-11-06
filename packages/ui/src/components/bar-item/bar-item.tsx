import type { ReactNode } from "react";
import { pulseOnPress } from "../../press-pulse.js";
import { cappedCount } from "../count-figure/count-figure.js";

/**
 * bar-item.tsx -- one place in a phone's bar of places: its glyph over its name.
 *
 * A BarItem is a press that goes somewhere or opens something, standing in
 * a row of its kind (a flex row, which it shares equally). The place shown
 * (`current`) is announced as the page (`aria-current="page"`) and drawn in
 * the accent's ink on the selection's fill; the rest are muted. One that opens something says
 * whether it stands open (`expanded`), and one the room around it has made
 * inert takes no press. `onPointerDown` lets its caller mark the press
 * before the click lands. It takes no class or style.
 *
 * A `count` of what waits on the reader there stands as a badge on the
 * glyph's top corner, the figure alone, drawn "99+" past 99 (`cappedCount`), and is said after the item's name
 * with its noun ("Inbox, 3 need you"); it is left out at none. It is a
 * NavItem's needs-you count (`STATUS_TONE.ATTENTION`) turned inside out, so a
 * place reads the same in the bar as in a column of places.
 *
 * A phone's bar floats its places in one pill (`BarItems`), beside the one
 * action the bar offers (`BarAction`), a round press in the primary fill,
 * as a phone's own bars float their tabs beside a compose button.
 */

/** The press: a share of the bar, its glyph over its name in the caption's type, muted until it is the place shown, which stands on the selection's fill. */
const BAR_ITEM =
  "ui-bar-item flex min-h-ui-48 flex-1 basis-0 flex-col items-center justify-center gap-ui-2 border-0 bg-transparent [font-family:inherit] [font-style:inherit] [font-weight:inherit] text-caption text-muted-foreground rounded-ui-full aria-[current=page]:bg-fill-selected aria-[current=page]:text-accent-ink";

/** The pill a phone's places float in: a share of the bar's row, on the ground, lifted off the work by a floating edge. */
const BAR_ITEMS =
  "ui-bar-items flex min-w-0 flex-1 items-center rounded-ui-full bg-ground p-ui-4 shadow-floating-edge";

/** The bar's one action: a round press in the primary fill, as tall as the pill beside it, lifted as the pill is. */
const BAR_ACTION =
  "ui-bar-action flex size-bar-action flex-none items-center justify-center rounded-ui-full border-0 bg-primary text-primary-foreground shadow-floating-edge disabled:opacity-disabled [&_svg]:size-ui-24";

/**
 * What waits on the reader, as a badge on the glyph's top corner: a
 * NavItem's needs-you count turned inside out, its figures in white on the
 * needs-you fill the "!" disc is drawn in, in even figures, growing away from
 * the glyph as it lengthens. A ring of the ground the bar stands on parts it
 * from the glyph's strokes.
 */
const BAR_ITEM_COUNT =
  "absolute -top-ui-4 left-bar-count-reach h-caption-leading min-w-caption-leading rounded-ui-full bg-attention-fill px-ui-4 text-center text-caption font-emphasis text-on-attention tabular-nums shadow-bar-count-ring";

/** What waits on the reader in a place: its figure and what it counts, as a reader hears it after the figure. */
export interface BarCount {
  readonly value: number;
  /** Said after the figure to a reader, "need you"; the figure alone where absent. */
  readonly noun?: string | undefined;
}

export interface BarItemProps {
  /** The glyph over its name, decoration a reader is not told. */
  icon: ReactNode;
  /** Its name. */
  children: ReactNode;
  /** Whether it is the place shown. */
  current?: boolean | undefined;
  /** Whether what it opens stands open; absent where it opens nothing. */
  expanded?: boolean | undefined;
  /** What waits on the reader there, drawn on its glyph and said after its name; left out at none. */
  count?: BarCount | undefined;
  /** Whether the room around it is inert, so it takes no press. */
  inert?: boolean | undefined;
  onPointerDown?: (() => void) | undefined;
  onPress: () => void;
}

/** A place in a phone's bar; see the module's head. */
export function BarItem({
  icon,
  children,
  current = false,
  expanded,
  count,
  inert = false,
  onPointerDown,
  onPress,
}: BarItemProps): React.JSX.Element {
  const counted = count !== undefined && count.value > 0;
  return (
    <button
      type="button"
      className={BAR_ITEM}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      inert={inert}
      onPointerDown={onPointerDown}
      onClick={pulseOnPress(onPress)}
    >
      <span className="relative flex [&_svg]:size-ui-20" aria-hidden="true">
        {icon}
        {counted ? <span className={BAR_ITEM_COUNT}>{cappedCount(count.value)}</span> : null}
      </span>
      <span>
        {children}
        {counted ? (
          <span className="ui-visually-hidden">
            {count.noun === undefined ? `, ${count.value}` : `, ${count.value} ${count.noun}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** A phone bar's places, floating in one pill; see the module's head. */
export function BarItems({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={BAR_ITEMS}>{children}</div>;
}

export interface BarActionProps {
  /** The glyph, decoration a reader is not told. */
  icon: ReactNode;
  /** What the press does, the name a reader is told. */
  label: string;
  /** Whether it takes no press, as while no one is signed in. */
  disabled?: boolean | undefined;
  onPress: () => void;
}

/** A phone bar's one action, beside its places; see the module's head. */
export function BarAction({
  icon,
  label,
  disabled = false,
  onPress,
}: BarActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={BAR_ACTION}
      aria-label={label}
      disabled={disabled}
      onClick={pulseOnPress(onPress)}
    >
      <span className="flex" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
