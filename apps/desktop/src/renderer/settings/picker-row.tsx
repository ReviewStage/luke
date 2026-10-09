import { ChevronDownIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { searchAnchorProps } from "../settings-anchors";

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

/** Where the menu fits: the side with room for its list, and the list height that side allows. */
function pickerPlacement(input: {
  /** The chip's top and bottom, in window coordinates. */
  chipTop: number;
  chipBottom: number;
  /** The edges of what clips the menu: the nearest scroller, or the window. */
  roomTop: number;
  roomBottom: number;
  /** How many window pixels one of the chip's own pixels is, which a zoomed page sets above one. */
  scale: number;
}) {
  const below =
    (input.roomBottom - input.chipBottom) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const above = (input.chipTop - input.roomTop) / input.scale - MENU_GAP * 2 - MENU_CHROME_HEIGHT;
  const side = below >= LEAST_LIST_HEIGHT || below >= above ? PICKER_SIDE.BELOW : PICKER_SIDE.ABOVE;
  return { side, listMax: Math.floor(Math.max(side === PICKER_SIDE.BELOW ? below : above, 0)) };
}

/** The overflow values that make an element a scroller, which clips a menu running past its edge. */
const SCROLLING_OVERFLOW: ReadonlySet<string> = new Set(["auto", "scroll"]);

/** The edges of the nearest scroller above the chip, or of the window where none stands. */
function roomAround(chip: HTMLElement) {
  for (let each = chip.parentElement; each !== null; each = each.parentElement) {
    if (!SCROLLING_OVERFLOW.has(getComputedStyle(each).overflowY)) continue;
    const bounds = each.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom };
  }
  return { top: 0, bottom: window.innerHeight };
}

export function PickerRow({
  label,
  copy,
  value,
  valueLabel,
  valueIcon,
  rows,
  placeholder,
  noMatch,
  note,
  anchor,
  disabled,
  onPick,
}: {
  /** The control's name for a reader: the row's own name, or a fuller one where that is too short. */
  label: string;
  /** The row's name and why, drawn before the chip. */
  copy: React.ReactNode;
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
  onPick: (id: string) => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const [open, setOpen] = useState(false);
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
        roomTop: room.top,
        roomBottom: room.bottom,
        scale,
      }),
    );
  }, [open]);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its button, because closing takes the focused menu away with it.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  return (
    <div className="settings-row">
      <span className="settings-copy">{copy}</span>
      <span
        className="settings-picker"
        ref={row}
        data-side={placement?.side ?? PICKER_SIDE.BELOW}
        style={
          placement === undefined
            ? undefined
            : cssCustomProperties({ "--settings-picker-list-max": `${placement.listMax}px` })
        }
      >
        <button
          ref={chip}
          type="button"
          className="plan-compose-chip settings-picker-chip"
          {...(anchor ? searchAnchorProps(anchor) : undefined)}
          aria-label={`${label}: ${valueLabel}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          disabled={disabled}
          onClick={() => setOpen(!open)}
          onFocus={() => {
            // The panel can be showing without its window being key, and the
            // menu's search field could take no keystroke then.
            tell(ACT_KIND.WINDOW_FOCUS_PANEL);
          }}
        >
          {valueIcon}
          <span className="plan-compose-chip-name">{valueLabel}</span>
          <ChevronDownIcon />
        </button>
        {open ? (
          <SearchableMenu
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
    </div>
  );
}
