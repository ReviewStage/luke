import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { cssCustomProperties } from "@luke/ui";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { CHIP_LOOK, Chip } from "../chip";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { useDisclosure } from "../use-disclosure";

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
 */

/** Which of the chip's edges the menu hangs from: its trailing edge, where a settings column is, or its leading edge, where a chip leads its line. */
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

/** The gap the menu keeps from the chip and from the window's edge, which its placement subtracts from the room. */
const MENU_GAP = 6;

/** The least height the list is worth drawing at below the chip before the menu turns to the room above. */
const LEAST_LIST_HEIGHT = 160;

/** What the menu's search field, padding, and any foot take out of the room the list may fill. */
const MENU_CHROME_HEIGHT = 48;

/**
 * Where the menu fits: the side with room for its list, the list height
 * that side allows, and the widest the menu may stand from the chip's edge
 * it hangs from before what clips it cuts its far side off.
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
  /** How many window pixels one of the chip's own pixels is, which a zoomed page sets above one. */
  scale: number;
}) {
  const below =
    (input.roomBottom - input.chipBottom) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const above = (input.chipTop - input.roomTop) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const side = below >= LEAST_LIST_HEIGHT || below >= above ? PICKER_SIDE.BELOW : PICKER_SIDE.ABOVE;
  const across =
    input.align === PICKER_ALIGN.END
      ? input.chipRight - input.roomLeft
      : input.roomRight - input.chipLeft;
  return {
    side,
    listMax: Math.floor(Math.max(side === PICKER_SIDE.BELOW ? below : above, 0)),
    widthMax: Math.floor(Math.max(across / input.scale - MENU_GAP, 0)),
  };
}

/** The overflow values that make an element a scroller, which clips a menu running past its edge. */
const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(["auto", "scroll"]);

/** The edges of the nearest scroller above the chip, or of the window where none stands. */
function roomAround(chip: HTMLElement) {
  for (let each = chip.parentElement; each !== null; each = each.parentElement) {
    if (!SCROLLING_OVERFLOW.has(getComputedStyle(each).overflowY)) continue;
    const bounds = each.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
  }
  return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
}

/** What a picker is handed: the value it names and the menu it drops. */
interface PickerProps {
  /** The control's name for a reader: the row's own name, or a fuller one where that is too short. */
  label: string;
  /** The id of the why drawn beside it, which describes the chip. */
  describedBy?: string | undefined;
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
  onOpen,
  onPick,
}: PickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [placement, setPlacement] = useState<ReturnType<typeof pickerPlacement>>();
  const menuId = useId();
  const row = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  // The menu is placed from the chip's bounds on the frame it opens, before it is painted.
  useLayoutEffect(() => {
    if (!open || chip.current === null) return;
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
        scale,
      }),
    );
  }, [open, align]);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its button, because closing takes the focused menu away with it.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  return (
    <span
      className="settings-picker"
      ref={row}
      data-side={placement?.side ?? PICKER_SIDE.BELOW}
      data-align={align}
      style={
        placement === undefined
          ? undefined
          : cssCustomProperties({
              "--settings-picker-list-max": `${placement.listMax}px`,
              "--settings-picker-width-max": `${placement.widthMax}px`,
            })
      }
    >
      <Chip
        ref={chip}
        look={CHIP_LOOK.FIELD}
        chevron
        className="settings-picker-chip"
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        aria-label={`${label}: ${valueLabel}`}
        aria-describedby={describedBy}
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
        <span className="chip-name">{valueLabel}</span>
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

/** A settings row picking one value: its name and why, then the picker. */
export function PickerRow({
  copy,
  ...picker
}: PickerProps & {
  /** The row's name and why, drawn before the chip. */
  copy: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <span className="settings-copy">{copy}</span>
      <Picker {...picker} />
    </div>
  );
}
