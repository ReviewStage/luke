import { searchAnchorProps } from "@luke/settings/settings-anchors";
import {
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  ChipName,
  type ChipWidth,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  type PopoverAlign,
  SearchableMenu,
  SettingsRow,
  type SettingsRowDensity,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useId, useRef, useState } from "react";
import { SettingMarks } from "./marks.js";

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
 * returns it to its button. The menu hangs from the chip in `@luke/ui`'s
 * `SearchableMenu`, at its narrow width, above the chip or below it where
 * only there is room, within what is seen of the window.
 *
 * The chip is `@luke/ui`'s field `Chip`, at the column a settings row's
 * pop-ups share unless its place names another width, and a `PickerRow`
 * stands it in `@luke/ui`'s `SettingsRow`.
 */

/** What a picker is handed: the value it names and the menu it drops. */
interface PickerProps {
  /** The control's name for a reader: the row's own name, or a fuller one where that is too short. */
  label: string;
  /** The id of the why drawn beside it, which describes the chip. */
  describedBy?: string | undefined;
  /** Whether the chip's last pick was refused, as its row says under it. */
  invalid?: true | undefined;
  /** The id of the value chosen now, checked in the menu; none where nothing is chosen yet, which keeps no row a check's room. */
  value: string | undefined;
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
  align?: PopoverAlign | undefined;
  /** How wide the chip stands; the settings column where none is named. */
  width?: ChipWidth | undefined;
  /** Reads what the menu lists now, as it opens, so a list that failed to read is asked for again. */
  onOpen?: (() => void) | undefined;
  /** Present, the owner answers the search: it hears each query as typed, and the rows it hands are listed unfiltered. */
  onSearch?: ((query: string) => void) | undefined;
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
  align = POPOVER_ALIGN.END,
  width = CHIP_WIDTH.FIELD,
  onOpen,
  onSearch,
  onPick,
}: PickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const row = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its button, because closing takes the focused menu away with it.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  return (
    <span
      className="settings-picker relative inline-flex min-w-0 flex-initial items-center"
      ref={row}
    >
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
          placeholder={placeholder}
          rows={rows}
          value={value}
          note={note}
          noMatch={noMatch}
          align={align}
          width={POPOVER_WIDTH.NARROW}
          onSearch={onSearch}
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
  saves = 0,
  error,
  density,
  ...picker
}: Omit<PickerProps, "describedBy" | "invalid"> & {
  /** The why under the row's name: words, and where a row needs one, a link among them. */
  detail?: React.ReactNode;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean | undefined;
  /** How many of the row's writes have landed, which its Saved tick confirms each of. */
  saves?: number | undefined;
  /** What the last write was refused with, or nothing while none was. */
  error?: React.ReactNode;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
}): React.JSX.Element {
  return (
    <SettingsRow
      density={density}
      label={picker.label}
      adornment={<SettingMarks changed={changed} saves={saves} />}
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
