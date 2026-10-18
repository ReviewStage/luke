import { PopoverPanel } from "@luke/panel/popover-panel";
import { Segmented } from "@luke/panel/segmented";
import { ChangedMark } from "@luke/panel/settings/marks";
import { SwitchRow } from "@luke/panel/settings/switch-row";
import { CHANGES_WORDS } from "@luke/panel/tasks/changes-model";
import {
  DEFAULT_SETTINGS,
  type FileViewSettings,
  useFileViewSettings,
} from "@luke/panel/tasks/file-view-settings";
import { Tooltip } from "@luke/panel/tooltip";
import {
  DIFF_FONT,
  DIFF_FONT_LABEL,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_INDICATORS_LABEL,
  DIFF_LAYOUT,
  DIFF_LAYOUT_LABEL,
  DIFF_LINE_HEIGHT,
  DIFF_LINE_HEIGHT_LABEL,
  DIFF_THEMES,
  INLINE_DIFF,
  INLINE_DIFF_LABEL,
} from "@luke/settings/diff-view";
import {
  AnchoredPopover,
  IconButton,
  POPOVER_ALIGN,
  SETTINGS_ROW_DENSITY,
  SettingsRow,
} from "@luke/ui";
import { SlidersHorizontalIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PickerRow } from "../settings/picker-row";
import { SelectRow } from "../settings/select-row";

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

/** A vocabulary's values as a control's options, each by the name the settings give it. */
function optionsOf<Value extends string>(
  values: readonly Value[],
  labels: Readonly<Record<Value, string>>,
): readonly { readonly value: Value; readonly label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const LAYOUT_OPTIONS = optionsOf(Object.values(DIFF_LAYOUT), DIFF_LAYOUT_LABEL);
const INDICATOR_OPTIONS = optionsOf(Object.values(DIFF_INDICATORS), DIFF_INDICATORS_LABEL);
const INLINE_DIFF_OPTIONS = optionsOf(Object.values(INLINE_DIFF), INLINE_DIFF_LABEL);
const FONT_OPTIONS = optionsOf(Object.values(DIFF_FONT), DIFF_FONT_LABEL);
const LINE_HEIGHT_OPTIONS = optionsOf(Object.values(DIFF_LINE_HEIGHT), DIFF_LINE_HEIGHT_LABEL);

/** Each size, in pixels. */
const FONT_SIZE_OPTIONS = DIFF_FONT_SIZES.map((size) => ({ value: size, label: `${size}px` }));

/** What a picker of themes says where its search matches none. */
const NO_THEME = "No theme matches.";

/** The option a value is among `options`, which a pop-up's pick is read back through. */
function optionOf<Value extends string>(
  options: readonly { readonly value: Value }[],
  raw: string,
): Value | undefined {
  return options.find((option) => option.value === raw)?.value;
}

/** A setting's row of segments, as compact as the popover's other rows: its name, the settings' mark while changed, why it is so where it says, and the segments. */
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
    <SettingsRow
      density={SETTINGS_ROW_DENSITY.COMPACT}
      label={label}
      adornment={changed ? <ChangedMark /> : null}
      description={detail}
    >
      {() => <Segmented legend={label} options={options} value={value} onChange={onChange} />}
    </SettingsRow>
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
      density={SETTINGS_ROW_DENSITY.COMPACT}
      label={label}
      changed={changed}
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

/** The popover's rows, every diff setting in groups set apart by a rule, as the context popover sets its sections apart: the layout and the marks, the switches, the themes, the type, and the comments. Each is changed for every diff as it is set. */
function DiffSettingsRows({ roomy }: { roomy: boolean }): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <>
      <div className="diff-settings-group">
        <SegmentedRow
          label="Layout"
          detail={roomy ? undefined : CHANGES_WORDS.TOO_NARROW_TO_SPLIT}
          value={settings.diffLayout}
          options={LAYOUT_OPTIONS}
          changed={changed("diffLayout")}
          onChange={(diffLayout) => change("diffLayout", diffLayout)}
        />
        <SegmentedRow
          label="Indicators"
          value={settings.diffIndicators}
          options={INDICATOR_OPTIONS}
          changed={changed("diffIndicators")}
          onChange={(diffIndicators) => change("diffIndicators", diffIndicators)}
        />
        <SelectRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Inline diffs"
          value={settings.inlineDiff}
          options={INLINE_DIFF_OPTIONS}
          parse={(raw) => optionOf(INLINE_DIFF_OPTIONS, raw)}
          changed={changed("inlineDiff")}
          onChange={(inlineDiff) => change("inlineDiff", inlineDiff)}
        />
      </div>
      <div className="diff-settings-group">
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Backgrounds"
          checked={settings.diffBackgrounds}
          changed={changed("diffBackgrounds")}
          onChange={(diffBackgrounds) => change("diffBackgrounds", diffBackgrounds)}
        />
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Wrapping"
          checked={settings.wordWrap}
          changed={changed("wordWrap")}
          onChange={(wordWrap) => change("wordWrap", wordWrap)}
        />
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Line numbers"
          checked={settings.lineNumbers}
          changed={changed("lineNumbers")}
          onChange={(lineNumbers) => change("lineNumbers", lineNumbers)}
        />
      </div>
      <div className="diff-settings-group">
        <ThemeRow
          label="Dark theme"
          themes={DIFF_THEMES.DARK}
          value={settings.diffDarkTheme}
          changed={changed("diffDarkTheme")}
          onChange={(diffDarkTheme) => change("diffDarkTheme", diffDarkTheme)}
        />
        <ThemeRow
          label="Light theme"
          themes={DIFF_THEMES.LIGHT}
          value={settings.diffLightTheme}
          changed={changed("diffLightTheme")}
          onChange={(diffLightTheme) => change("diffLightTheme", diffLightTheme)}
        />
      </div>
      <div className="diff-settings-group">
        <SelectRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Font"
          value={settings.diffFont}
          options={FONT_OPTIONS}
          parse={(raw) => optionOf(FONT_OPTIONS, raw)}
          changed={changed("diffFont")}
          onChange={(diffFont) => change("diffFont", diffFont)}
        />
        <SelectRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Font size"
          value={settings.diffFontSize}
          options={FONT_SIZE_OPTIONS}
          parse={(raw) => optionOf(FONT_SIZE_OPTIONS, raw)}
          changed={changed("diffFontSize")}
          onChange={(diffFontSize) => change("diffFontSize", diffFontSize)}
        />
        <SelectRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Line height"
          value={settings.diffLineHeight}
          options={LINE_HEIGHT_OPTIONS}
          parse={(raw) => optionOf(LINE_HEIGHT_OPTIONS, raw)}
          changed={changed("diffLineHeight")}
          onChange={(diffLineHeight) => change("diffLineHeight", diffLineHeight)}
        />
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Ligatures"
          checked={settings.diffLigatures}
          changed={changed("diffLigatures")}
          onChange={(diffLigatures) => change("diffLigatures", diffLigatures)}
        />
      </div>
      <div className="diff-settings-group">
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Minimize inline comments"
          checked={settings.diffMinimizeComments}
          changed={changed("diffMinimizeComments")}
          onChange={(diffMinimizeComments) => change("diffMinimizeComments", diffMinimizeComments)}
        />
      </div>
    </>
  );
}

/** The popover: its title and ×, then the rows (`PopoverPanel`). */
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
  return (
    <PopoverPanel
      id={id}
      title={DIFF_SETTINGS_LABEL}
      closeLabel="Close"
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <DiffSettingsRows roomy={roomy} />
    </PopoverPanel>
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
        <IconButton
          ref={trigger}
          icon={<SlidersHorizontalIcon aria-hidden="true" />}
          label={DIFF_SETTINGS_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setOpen(!open)}
        />
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
