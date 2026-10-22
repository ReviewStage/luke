import { searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  type ChipWidth,
  cssCustomProperties,
  SettingsRow,
  type SettingsRowDensity,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { type ViewportBox, visibleViewport } from "@luke/ui/visible-viewport";
import { type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { type MenuRow, SearchableMenu } from "../searchable-menu.js";
import { ChangedMark } from "./marks.js";

/**
 * picker-row.tsx -- the one control a settings row picks a value with: a chip naming the value, and the app's own menu under it.
 *
 * Every pop-up in Settings is this control, so a short fixed set and the
 * forty-model catalog read as one thing: the chip shows the current value
 * with a chevron, and a press drops the shared menu, searched where the list
 * is long and plain where it is short. The menu scrolls on its own and the
 * page behind it stays still; it closes on a choice, on Escape (which stops
 * here, so it closes the menu and not Settings), and on focus leaving it,
 * and a close hands the keyboard back to the chip the way a native menu
 * returns it to its button. The menu is measured as it opens and hangs
 * below the chip, or above it where the page leaves more room there, with
 * its list capped to that room: the menu stands inside the page's own
 * scroller, which clips what runs past its edge, so the room is the
 * scroller's and not the window's.
 *
 * The chip is `@luke/ui`'s field `Chip`, at the column a settings row's
 * pop-ups share unless its place names another width, and a `PickerRow`
 * stands it in `@luke/ui`'s `SettingsRow`.
 */

/**
 * Which of the chip's edges the menu asks to hang from: its trailing edge,
 * where a settings column is, or its leading edge, where a chip leads its
 * line. The menu takes the other edge where only that keeps it inside what
 * clips it, and is pushed back inside where neither does.
 */
export const PICKER_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type PickerAlign = (typeof PICKER_ALIGN)[keyof typeof PICKER_ALIGN];

/** How the menu stands against the chip: below it, or above it where the window leaves more room there. */
const PICKER_SIDE = {
  BELOW: "below",
  ABOVE: "above",
} as const;

type PickerSide = (typeof PICKER_SIDE)[keyof typeof PICKER_SIDE];

/** The gap the menu keeps from the chip and from the window's edge, which its placement subtracts from the room. */
const MENU_GAP = 6;

/** The least height the list is worth drawing at below the chip before the menu turns to the room above. */
const LEAST_LIST_HEIGHT = 160;

/** What the menu's search field, padding, and any foot take out of the room the list may fill. */
const MENU_CHROME_HEIGHT = 48;

/**
 * Where the menu fits: the side with room for its list, the list height
 * that side allows, the chip's edge it hangs from, how far past that edge
 * it is pushed back inside what clips it, and the widest it may stand.
 * It hangs from the asked edge while it stands whole there, from the other
 * where only that keeps it whole, and otherwise from the edge with more
 * room, pushed back over the chip until its far side meets the room's edge.
 */
function pickerPlacement(input: {
  /** The chip's edges, in window coordinates. */
  chipTop: number;
  chipBottom: number;
  chipLeft: number;
  chipRight: number;
  /** The edges of what clips the menu: the nearest scroller, or the window. */
  roomTop: number;
  roomBottom: number;
  roomLeft: number;
  roomRight: number;
  align: PickerAlign;
  /** The menu's own width, in the chip's pixels, before any cap. */
  menuWidth: number;
  /** How many window pixels one of the chip's own pixels is, which a zoomed page sets above one. */
  scale: number;
}) {
  const below =
    (input.roomBottom - input.chipBottom) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const above = (input.chipTop - input.roomTop) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const side = below >= LEAST_LIST_HEIGHT || below >= above ? PICKER_SIDE.BELOW : PICKER_SIDE.ABOVE;
  const widthMax = Math.max((input.roomRight - input.roomLeft) / input.scale - MENU_GAP * 2, 0);
  const width = Math.min(input.menuWidth, widthMax);
  // The room the menu has from either edge, past the gap it keeps from what clips it.
  const fromStart = (input.roomRight - input.chipLeft) / input.scale - MENU_GAP;
  const fromEnd = (input.chipRight - input.roomLeft) / input.scale - MENU_GAP;
  const asked = input.align;
  const other = asked === PICKER_ALIGN.END ? PICKER_ALIGN.START : PICKER_ALIGN.END;
  const across = (edge: PickerAlign) => (edge === PICKER_ALIGN.END ? fromEnd : fromStart);
  const align: PickerAlign =
    across(asked) >= width
      ? asked
      : across(other) >= width || across(other) > across(asked)
        ? other
        : asked;
  return {
    side,
    align,
    listMax: Math.floor(Math.max(side === PICKER_SIDE.BELOW ? below : above, 0)),
    widthMax: Math.floor(widthMax),
    // Note that a negative inset pushes the menu back over the chip, so its far side stays inside.
    inset: Math.floor(Math.min(across(align) - width, 0)),
  };
}

/** The overflow values that make an element a scroller, which clips a menu running past its edge. */
const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(["auto", "scroll"]);

/**
 * The edges of the nearest scroller above the chip, cut to what can be seen
 * of the window, or of what can be seen where none stands: on a phone the
 * keyboard covers a scroller's foot.
 */
function roomAround(chip: HTMLElement): ViewportBox {
  const seen = visibleViewport();
  for (let each = chip.parentElement; each !== null; each = each.parentElement) {
    if (!SCROLLING_OVERFLOW.has(getComputedStyle(each).overflowY)) continue;
    const bounds = each.getBoundingClientRect();
    return {
      top: Math.max(bounds.top, seen.top),
      bottom: Math.min(bounds.bottom, seen.bottom),
      left: Math.max(bounds.left, seen.left),
      right: Math.min(bounds.right, seen.right),
    };
  }
  return seen;
}

/**
 * The menu's width as its own rules draw it, uncapped by the room the last
 * opening left it, which a menu reopened in a wider room would otherwise keep.
 */
function naturalWidth(menu: HTMLElement): number {
  const capped = menu.style.maxWidth;
  menu.style.maxWidth = "none";
  const width = menu.offsetWidth;
  menu.style.maxWidth = capped;
  return width;
}

/** The attributes the box holding a chip and its menu wears, which say where the menu hangs. */
interface PickerPlacementProps {
  readonly "data-side": PickerSide;
  readonly "data-align": PickerAlign;
  readonly style: React.CSSProperties | undefined;
}

/**
 * Where a chip's menu hangs as it opens, from the chip's edge `align`
 * names, or the other where only that keeps it whole, as the attributes the
 * box holding the chip and the menu wears: `data-side`, `data-align` for
 * the edge, the list's cap as `--settings-picker-list-max`, the menu's
 * widest as `--settings-picker-width-max`, and how far it stands in from
 * that edge as `--settings-picker-inset`, which is below zero where the
 * menu is pushed back over the chip to keep inside. Every chip whose menu
 * drops from a form row, a Settings picker, a task's standing chips, and the
 * repository and issue chips, is placed by it, so none runs past the
 * window's foot while there is room above, nor past the side of what clips
 * it and scrolls that sideways. The menu is the element `menuId` names,
 * measured at its own width on the frame it opens.
 */
export function usePickerPlacement(
  open: boolean,
  chip: RefObject<HTMLElement | null>,
  align: PickerAlign,
  menuId: string,
): PickerPlacementProps {
  const [placement, setPlacement] = useState<ReturnType<typeof pickerPlacement>>();

  // The menu is placed from the chip's bounds on the frame it opens, before it is painted.
  useLayoutEffect(() => {
    const menu = document.getElementById(menuId);
    if (!open || chip.current === null || menu === null) return;
    const bounds = chip.current.getBoundingClientRect();
    const room = roomAround(chip.current);
    // Note that the scale is read off the chip itself, because the page the
    // desktop draws Settings in is zoomed and a computed `zoom` names only
    // the element's own; a layout box with no height, as under a test, is one to one.
    const scale = chip.current.offsetHeight > 0 ? bounds.height / chip.current.offsetHeight : 1;
    setPlacement(
      pickerPlacement({
        chipTop: bounds.top,
        chipBottom: bounds.bottom,
        chipLeft: bounds.left,
        chipRight: bounds.right,
        roomTop: room.top,
        roomBottom: room.bottom,
        roomLeft: room.left,
        roomRight: room.right,
        align,
        menuWidth: naturalWidth(menu),
        scale,
      }),
    );
  }, [open, chip, align, menuId]);

  return {
    "data-side": placement?.side ?? PICKER_SIDE.BELOW,
    "data-align": placement?.align ?? align,
    style:
      placement === undefined
        ? undefined
        : cssCustomProperties({
            "--settings-picker-list-max": `${placement.listMax}px`,
            "--settings-picker-width-max": `${placement.widthMax}px`,
            "--settings-picker-inset": `${placement.inset}px`,
          }),
  };
}

/** What a picker is handed: the value it names and the menu it drops. */
interface PickerProps {
  /** The control's name for a reader: the row's own name, or a fuller one where that is too short. */
  label: string;
  /** The id of the why drawn beside it, which describes the chip. */
  describedBy?: string | undefined;
  /** Whether the chip's last pick was refused, as its row says under it. */
  invalid?: true | undefined;
  /** The id of the value chosen now, checked in the menu. */
  value: string;
  /** What the chip says: the chosen value's own words. */
  valueLabel: string;
  /** The chosen value's mark, where values carry one. */
  valueIcon?: React.ReactNode;
  rows: readonly MenuRow[];
  /** Present, the menu opens on a search over the rows; absent, the list is short enough to read whole. */
  placeholder?: string | undefined;
  noMatch: string;
  /** Drawn in place of the rows while they are being read or could not be. */
  note?: React.ReactNode;
  /** The id a pressed search result lands on: marked on the chip, which takes the keyboard. */
  anchor?: string | undefined;
  disabled?: boolean | undefined;
  /** The chip's edge the menu hangs from; the trailing one where none is named. */
  align?: PickerAlign | undefined;
  /** How wide the chip stands; the settings column where none is named. */
  width?: ChipWidth | undefined;
  /** Reads what the menu lists now, as it opens, so a list that failed to read is asked for again. */
  onOpen?: (() => void) | undefined;
  onPick: (id: string) => void;
}

/**
 * The chip and its menu alone, for a row that stands it beside another
 * control of its own, a time beside its zone; a row holding nothing else is
 * a `PickerRow`.
 */
export function Picker({
  label,
  describedBy,
  invalid,
  value,
  valueLabel,
  valueIcon,
  rows,
  placeholder,
  noMatch,
  note,
  anchor,
  disabled,
  align = PICKER_ALIGN.END,
  width = CHIP_WIDTH.FIELD,
  onOpen,
  onPick,
}: PickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const row = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const placement = usePickerPlacement(open, chip, align, menuId);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its button, because closing takes the focused menu away with it.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  return (
    <span className="settings-picker" ref={row} {...placement}>
      <Chip
        ref={chip}
        look={CHIP_LOOK.FIELD}
        width={width}
        chevron
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        aria-label={`${label}: ${valueLabel}`}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {valueIcon}
        <ChipName>{valueLabel}</ChipName>
      </Chip>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={label}
          className="settings-picker-menu"
          placeholder={placeholder}
          rows={rows}
          value={value}
          note={note}
          noMatch={noMatch}
          onPick={(id) => {
            close();
            onPick(id);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && row.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * A settings row picking one value: `@luke/ui`'s `SettingsRow`, its name
 * and why, then the picker, and under both the refusal of its last write.
 * The why describes the chip, and a refusal marks it invalid and describes
 * it too.
 */
export function PickerRow({
  detail,
  changed,
  error,
  density,
  ...picker
}: Omit<PickerProps, "describedBy" | "invalid"> & {
  /** The why under the row's name: words, and where a row needs one, a link among them. */
  detail?: React.ReactNode;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean | undefined;
  /** What the last write was refused with, or nothing while none was. */
  error?: React.ReactNode;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
}): React.JSX.Element {
  return (
    <SettingsRow
      density={density}
      label={picker.label}
      adornment={changed ? <ChangedMark /> : null}
      description={detail}
      error={error}
    >
      {(control) => (
        <Picker
          {...picker}
          describedBy={control["aria-describedby"]}
          invalid={control["aria-invalid"]}
        />
      )}
    </SettingsRow>
  );
}
