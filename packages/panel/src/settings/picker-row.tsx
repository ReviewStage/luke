import { searchAnchorProps } from "@repo/settings/settings-anchors";
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
  type PopoverWidth,
  SearchableMenu,
  SettingsRow,
  type SettingsRowDensity,
  type SettingsRowIndent,
  Tooltip,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";
import { replayMaskedError, SettingMarks } from "./marks.js";

interface PickerProps {
  label: string;
  describedBy?: string | undefined;
  invalid?: true | undefined;
  value: string | undefined;
  valueLabel: string;
  valueReplayMasked?: boolean | undefined;
  valueIcon?: React.ReactNode;
  iconOnly?: boolean | undefined;
  replayUnmasked?: boolean | undefined;
  rows: readonly MenuRow[];
  placeholder?: string | undefined;
  noMatch: string;
  note?: React.ReactNode;
  anchor?: string | undefined;
  disabled?: boolean | undefined;
  hint?: string | undefined;
  align?: PopoverAlign | undefined;
  width?: ChipWidth | undefined;
  look?: typeof CHIP_LOOK.FIELD | typeof CHIP_LOOK.TOOLBAR | undefined;
  chevron?: boolean | undefined;
  menuWidth?: PopoverWidth | undefined;
  onOpen?: (() => void) | undefined;
  onSearch?: ((query: string) => void) | undefined;
  openRequest?: number | undefined;
  onPick: (id: string) => void;
}

export function Picker({
  label,
  describedBy,
  invalid,
  value,
  valueLabel,
  valueReplayMasked = false,
  valueIcon,
  iconOnly = false,
  replayUnmasked,
  rows,
  placeholder,
  noMatch,
  note,
  anchor,
  disabled,
  hint,
  align = POPOVER_ALIGN.END,
  width = CHIP_WIDTH.FIELD,
  look = CHIP_LOOK.FIELD,
  chevron = look === CHIP_LOOK.FIELD,
  menuWidth = POPOVER_WIDTH.NARROW,
  onOpen,
  onSearch,
  openRequest,
  onPick,
}: PickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const row = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };

  useEffect(() => {
    if (openRequest === undefined || openRequest === 0 || disabled) return;
    onOpen?.();
    setOpen(true);
  }, [openRequest]);

  return (
    <span
      className="settings-picker relative inline-flex min-w-0 flex-initial items-center"
      ref={row}
    >
      <Tooltip label={open ? undefined : (hint ?? (iconOnly ? valueLabel : undefined))}>
        <Chip
          ref={chip}
          look={look}
          width={width}
          iconOnly={iconOnly && valueIcon != null}
          chevron={chevron}
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
          <ChipName>
            <ReplayWords masked={valueReplayMasked}>{valueLabel}</ReplayWords>
          </ChipName>
        </Chip>
      </Tooltip>
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
          width={menuWidth}
          replayUnmasked={replayUnmasked}
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

export function PickerRow({
  detail,
  changed,
  saves = 0,
  error,
  density,
  indent,
  labelReplayUnmasked = false,
  ...picker
}: Omit<PickerProps, "describedBy" | "invalid"> & {
  labelReplayUnmasked?: boolean | undefined;
  detail?: React.ReactNode;
  changed?: boolean | undefined;
  saves?: number | undefined;
  error?: ShownError | undefined;
  density?: SettingsRowDensity | undefined;
  indent?: SettingsRowIndent | undefined;
}): React.JSX.Element {
  return (
    <SettingsRow
      density={density}
      indent={indent}
      label={<ReplayWords unmasked={labelReplayUnmasked}>{picker.label}</ReplayWords>}
      adornment={<SettingMarks changed={changed} saves={saves} />}
      description={detail}
      error={replayMaskedError(error)}
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
