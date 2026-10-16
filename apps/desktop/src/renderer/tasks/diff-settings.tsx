import { CloseIcon } from "@luke/ui";
import { SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AnchoredPopover, POPOVER_ALIGN } from "../anchored-popover";
import {
  DIFF_FONT,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  DIFF_THEMES,
  INLINE_DIFF,
} from "../diff-view/contract";
import { Segmented } from "../segmented";
import { ChangedMark } from "../settings/marks";
import { PickerRow } from "../settings/picker-row";
import { SelectRow } from "../settings/select-row";
import { SwitchRow } from "../settings/switch-row";
import { Tooltip } from "../tooltip";
import { CHANGES_WORDS } from "./changes-model";
import { DEFAULT_SETTINGS, type FileViewSettings, useFileViewSettings } from "./file-view-settings";

/**
 * diff-settings.tsx -- the diff settings button in the Files changed bar, and the popover under it: every diff setting stage-cli offers, in Luke's own controls.
 *
 * The popover sets what every diff follows (`file-view-settings.ts`), the
 * Files changed view's and a review thread's alike, drawn again as each
 * changes: the layout and how a changed line is marked in segmented
 * controls, what of it is marked, the type, its size and line height, and
 * each appearance's syntax theme in settings pop-ups, that last searched,
 * and backgrounds, wrap, line numbers, ligatures, and minimized comments in
 * switches. Each row carries the settings' mark while it differs from its
 * default. A diff too narrow to split says so under its layout, the choice
 * kept for a wider one. It closes on Escape, its ×, the button, or focus
 * leaving it, and hands the keyboard back to the button, as a menu does.
 */

/** What the button and its popover are called. */
const DIFF_SETTINGS_LABEL = "Diff settings";

/** Each indicator's words. */
const INDICATOR_OPTIONS = [
  { value: DIFF_INDICATORS.CLASSIC, label: "Classic (+/-)" },
  { value: DIFF_INDICATORS.BARS, label: "Bars" },
  { value: DIFF_INDICATORS.NONE, label: "None" },
] as const;

/** Each inline diff's words. */
const INLINE_DIFF_OPTIONS = [
  { value: INLINE_DIFF.WORD_ALT, label: "Word-Alt" },
  { value: INLINE_DIFF.WORD, label: "Word" },
  { value: INLINE_DIFF.CHAR, label: "Character" },
  { value: INLINE_DIFF.NONE, label: "None" },
] as const;

/** Each font's name. */
const FONT_OPTIONS = [
  { value: DIFF_FONT.SF_MONO, label: "SF Mono" },
  { value: DIFF_FONT.MENLO, label: "Menlo" },
  { value: DIFF_FONT.MONACO, label: "Monaco" },
  { value: DIFF_FONT.COURIER_NEW, label: "Courier New" },
  { value: DIFF_FONT.ANDALE_MONO, label: "Andale Mono" },
] as const;

/** Each size, in pixels. */
const FONT_SIZE_OPTIONS = DIFF_FONT_SIZES.map((size) => ({ value: size, label: `${size}px` }));

/** Each line height's words, tightest first. */
const LINE_HEIGHT_OPTIONS = [
  { value: DIFF_LINE_HEIGHT.COMPACT, label: "Compact" },
  { value: DIFF_LINE_HEIGHT.NORMAL, label: "Normal" },
  { value: DIFF_LINE_HEIGHT.SPACIOUS, label: "Spacious" },
] as const;

/** The layouts' words. */
const LAYOUT_OPTIONS = [
  { value: DIFF_LAYOUT.UNIFIED, label: "Unified" },
  { value: DIFF_LAYOUT.SPLIT, label: "Split" },
] as const;

/** What a picker of themes says where its search matches none. */
const NO_THEME = "No theme matches.";

/** The option a value is among `options`, which a pop-up's pick is read back through. */
function optionOf<Value extends string>(
  options: readonly { readonly value: Value }[],
  raw: string,
): Value | undefined {
  return options.find((option) => option.value === raw)?.value;
}

/** A setting's row of segments: its name, the settings' mark while changed, and the segments under a line of their own. */
function SegmentedRow<Value extends string>({
  label,
  detail,
  value,
  options,
  changed,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  options: readonly { readonly value: Value; readonly label: string }[];
  changed: boolean;
  onChange: (value: Value) => void;
}): React.JSX.Element {
  return (
    <div className="settings-row diff-settings-segmented">
      <span className="settings-copy">
        <strong>
          {label}
          {changed ? <ChangedMark /> : null}
        </strong>
        {detail === undefined ? null : <small>{detail}</small>}
      </span>
      <Segmented legend={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

/** One appearance's syntax theme, picked from Shiki's themes of that appearance with a search. */
function ThemeRow<Id extends string>({
  label,
  themes,
  value,
  changed,
  onChange,
}: {
  label: string;
  themes: readonly { readonly id: Id; readonly label: string }[];
  value: Id;
  changed: boolean;
  onChange: (id: Id) => void;
}): React.JSX.Element {
  const chosen = themes.find((theme) => theme.id === value);
  return (
    <PickerRow
      label={label}
      copy={
        <strong>
          {label}
          {changed ? <ChangedMark /> : null}
        </strong>
      }
      value={value}
      valueLabel={chosen?.label ?? value}
      rows={themes.map((theme) => ({ id: theme.id, label: theme.label }))}
      placeholder="Search themes"
      noMatch={NO_THEME}
      onPick={(id) => {
        const theme = themes.find((each) => each.id === id);
        if (theme !== undefined) onChange(theme.id);
      }}
    />
  );
}

/** The popover's rows, every diff setting, each changed for every diff as it is set. */
function DiffSettingsRows({ roomy }: { roomy: boolean }): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <div className="diff-settings-rows">
      <SegmentedRow
        label="Layout"
        detail={roomy ? undefined : CHANGES_WORDS.TOO_NARROW_TO_SPLIT}
        value={settings.diffLayout}
        options={LAYOUT_OPTIONS}
        changed={changed("diffLayout")}
        onChange={(diffLayout) => change({ diffLayout })}
      />
      <SegmentedRow
        label="Indicators"
        value={settings.diffIndicators}
        options={INDICATOR_OPTIONS}
        changed={changed("diffIndicators")}
        onChange={(diffIndicators) => change({ diffIndicators })}
      />
      <SelectRow
        label="Inline diffs"
        value={settings.inlineDiff}
        options={INLINE_DIFF_OPTIONS}
        parse={(raw) => optionOf(INLINE_DIFF_OPTIONS, raw)}
        changed={changed("inlineDiff")}
        onChange={(inlineDiff) => change({ inlineDiff })}
      />
      <SwitchRow
        label="Backgrounds"
        checked={settings.diffBackgrounds}
        changed={changed("diffBackgrounds")}
        onChange={(diffBackgrounds) => change({ diffBackgrounds })}
      />
      <SwitchRow
        label="Wrapping"
        checked={settings.wordWrap}
        changed={changed("wordWrap")}
        onChange={(wordWrap) => change({ wordWrap })}
      />
      <SwitchRow
        label="Line numbers"
        checked={settings.lineNumbers}
        changed={changed("lineNumbers")}
        onChange={(lineNumbers) => change({ lineNumbers })}
      />
      <ThemeRow
        label="Dark theme"
        themes={DIFF_THEMES.DARK}
        value={settings.darkTheme}
        changed={changed("darkTheme")}
        onChange={(darkTheme) => change({ darkTheme })}
      />
      <ThemeRow
        label="Light theme"
        themes={DIFF_THEMES.LIGHT}
        value={settings.lightTheme}
        changed={changed("lightTheme")}
        onChange={(lightTheme) => change({ lightTheme })}
      />
      <SelectRow
        label="Font"
        value={settings.diffFont}
        options={FONT_OPTIONS}
        parse={(raw) => optionOf(FONT_OPTIONS, raw)}
        changed={changed("diffFont")}
        onChange={(diffFont) => change({ diffFont })}
      />
      <SelectRow
        label="Font size"
        value={settings.diffFontSize}
        options={FONT_SIZE_OPTIONS}
        parse={(raw) => optionOf(FONT_SIZE_OPTIONS, raw)}
        changed={changed("diffFontSize")}
        onChange={(diffFontSize) => change({ diffFontSize })}
      />
      <SelectRow
        label="Line height"
        value={settings.diffLineHeight}
        options={LINE_HEIGHT_OPTIONS}
        parse={(raw) => optionOf(LINE_HEIGHT_OPTIONS, raw)}
        changed={changed("diffLineHeight")}
        onChange={(diffLineHeight) => change({ diffLineHeight })}
      />
      <SwitchRow
        label="Ligatures"
        checked={settings.diffLigatures}
        changed={changed("diffLigatures")}
        onChange={(diffLigatures) => change({ diffLigatures })}
      />
      <SwitchRow
        label="Minimize inline comments"
        detail="Review comments on their lines stand folded to a mark."
        checked={settings.minimizeComments}
        changed={changed("minimizeComments")}
        onChange={(minimizeComments) => change({ minimizeComments })}
      />
    </div>
  );
}

/** The popover: its title and ×, then the rows; it takes the keyboard as it opens, so Escape and focus leaving it are heard. */
function DiffSettingsPopover({
  id,
  roomy,
  onClose,
  onLeave,
}: {
  id: string;
  roomy: boolean;
  /** Closes the popover and hands the keyboard back to the button. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <div
      ref={box}
      id={id}
      className="diff-settings-popover"
      role="dialog"
      aria-label={DIFF_SETTINGS_LABEL}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      onBlur={(event) => onLeave(event.relatedTarget)}
    >
      <div className="diff-settings-head">
        <h2 className="diff-settings-title">{DIFF_SETTINGS_LABEL}</h2>
        <Tooltip label="Close">
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </Tooltip>
      </div>
      <DiffSettingsRows roomy={roomy} />
    </div>
  );
}

/** The bar's diff settings button, and its popover while open. */
export function DiffSettingsButton({
  roomy,
}: {
  /** Whether the diff is wide enough to split, which the layout row says where it is not. */
  roomy: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="diff-settings" ref={root}>
      <Tooltip label={DIFF_SETTINGS_LABEL}>
        <button
          ref={trigger}
          type="button"
          className="icon-button"
          aria-label={DIFF_SETTINGS_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontalIcon aria-hidden="true" />
        </button>
      </Tooltip>
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <DiffSettingsPopover
            id={popoverId}
            roomy={roomy}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
