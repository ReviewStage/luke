import { DIFF_SETTING_GROUPS, type DiffSettingSection, SETTING_SECTION } from "@luke/settings";
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
import { FILES_CHANGED_KEY, FILES_CHANGED_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  Dialog,
  IconButton,
  POPOVER_ALIGN,
  PopoverPanel,
  SETTINGS_ROW_DENSITY,
  SettingsRow,
  SettingsSection,
  Shortcut,
  Tooltip,
} from "@luke/ui";
import { drawnDark } from "@luke/ui/appearance";
import { SlidersHorizontalIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { MenuAction } from "../desktop/action-menu.js";
import { ChangedMark } from "../settings/marks.js";
import { PickerRow } from "../settings/picker-row.js";
import { SelectRow } from "../settings/select-row.js";
import { SwitchRow } from "../settings/switch-row.js";
import { CHANGES_WORDS } from "./changes-model.js";
import {
  DEFAULT_SETTINGS,
  type FileViewSettings,
  useFileViewSettings,
} from "./file-view-settings.js";

/**
 * view-settings.tsx -- the View options button in a bar over lines, and the popover under it: on Files changed every diff setting stage-cli offers, in Luke's own controls, grouped by what a reader changes; over a File tab's or a page's source only those its lines follow.
 *
 * The popover sets what every diff follows (`file-view-settings.ts`), the
 * Files changed view's and a review thread's alike, drawn again as each
 * changes, in the three groups the schema names (`DIFF_SETTING_GROUPS`),
 * which Settings › Appearance draws as well: Diff, what a diff marks (its
 * layout, its changed words, its indicators, and its backgrounds); Lines,
 * how lines run (wrap, numbers, and minimized comments, with the key that
 * turns them); and Text, how code looks (the syntax theme of the appearance
 * chosen, the type, its size and line height, and ligatures). A File
 * tab's lines and a page's source follow wrap, numbers, the syntax theme,
 * and the type, not a diff's own marks, so there it offers those alone,
 * never a row that changes nothing on the tab. Each row
 * carries the settings' mark while it differs from its default. A diff too
 * narrow to split says so under its layout, the choice kept for a wider one.
 * It closes on Escape, its ×, the button, or focus leaving it, and hands the
 * keyboard back to the button, as a menu does.
 */

/** What the button and its popover are called. */
const VIEW_SETTINGS_LABEL = "View options";

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

/** The key that turns Minimize inline comments in the list, which its row names. */
const MINIMIZE_CHORD = FILES_CHANGED_SHORTCUTS[FILES_CHANGED_KEY.MINIMIZE_COMMENTS].chord;

/** What a picker of themes says where its search matches none. */
const NO_THEME = "No themes match";

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
      {() => (
        <ChoiceBar
          label={label}
          items={options}
          value={value}
          look={CHOICE_BAR_LOOK.SEGMENTED}
          onChange={onChange}
        />
      )}
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

/** The appearance whose syntax theme the Text group shows, which picks the theme to set and never the window's appearance. */
const APPEARANCE = {
  LIGHT: "light",
  DARK: "dark",
} as const;

type Appearance = (typeof APPEARANCE)[keyof typeof APPEARANCE];

const APPEARANCE_OPTIONS = [
  { value: APPEARANCE.LIGHT, label: "Light" },
  { value: APPEARANCE.DARK, label: "Dark" },
] as const;

/** The appearance the window is drawn in now, which the Text group opens on. */
function currentAppearance(): Appearance {
  return drawnDark() ? APPEARANCE.DARK : APPEARANCE.LIGHT;
}

/** What a View options button sets: a diff's every setting, its layout's room said, or those a File tab's lines follow, its wrap, its numbers, its syntax theme, and its type. */
export const VIEW_SETTINGS_SCOPE = {
  DIFF: "diff",
  LINES: "lines",
} as const;

export type ViewSettingsScope =
  | {
      readonly kind: typeof VIEW_SETTINGS_SCOPE.DIFF;
      /** Whether the diff is wide enough to split, which the layout row says where it is not. */
      readonly roomy: boolean;
    }
  | {
      readonly kind: typeof VIEW_SETTINGS_SCOPE.LINES;
      /** Whether the lines carry notes, as a File tab's carry Luke's, which Minimize inline comments puts away; a page's source carries none. */
      readonly notes: boolean;
    };

/**
 * The settings every run of lines follows, a File tab's and a diff's alike:
 * wrap and numbers, and, where the lines carry notes, whether those notes
 * stand put away behind a chip at the end of their line, a review thread in
 * Files changed and Luke's note in a File tab alike.
 */
function LinesRows({ notes }: { notes: boolean }): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <>
      <SwitchRow
        density={SETTINGS_ROW_DENSITY.COMPACT}
        label="Word wrap"
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
      {notes ? (
        <SwitchRow
          density={SETTINGS_ROW_DENSITY.COMPACT}
          label="Minimize inline comments"
          detail={
            <>
              <span className="shortcut-hint">
                Or press <Shortcut chord={MINIMIZE_CHORD} spoken /> over the code
              </span>
            </>
          }
          checked={settings.diffMinimizeComments}
          changed={changed("diffMinimizeComments")}
          onChange={(diffMinimizeComments) => change("diffMinimizeComments", diffMinimizeComments)}
        />
      ) : null}
    </>
  );
}

/**
 * The syntax theme of one appearance at a time, the window's own as it
 * opens and the other a press away: the press picks which theme is set,
 * never the window's appearance.
 */
function ThemeRows(): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const [appearance, setAppearance] = useState(currentAppearance);
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <>
      <SegmentedRow
        label="Syntax theme"
        value={appearance}
        options={APPEARANCE_OPTIONS}
        changed={false}
        onChange={setAppearance}
      />
      {appearance === APPEARANCE.DARK ? (
        <ThemeRow
          label="For dark mode"
          themes={DIFF_THEMES.DARK}
          value={settings.diffDarkTheme}
          changed={changed("diffDarkTheme")}
          onChange={(diffDarkTheme) => change("diffDarkTheme", diffDarkTheme)}
        />
      ) : (
        <ThemeRow
          label="For light mode"
          themes={DIFF_THEMES.LIGHT}
          value={settings.diffLightTheme}
          changed={changed("diffLightTheme")}
          onChange={(diffLightTheme) => change("diffLightTheme", diffLightTheme)}
        />
      )}
    </>
  );
}

/** The type every run of code is set in: its font, its size, its line height, and its ligatures, a File tab's lines and a diff's alike. */
function TypeRows(): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <>
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
    </>
  );
}

/** What a diff marks: its layout, its changed words, its indicators, and its backgrounds, where the diff is wide enough to split said under the layout. */
function DiffRows({ roomy }: { roomy: boolean }): React.JSX.Element {
  const { settings, change } = useFileViewSettings();
  const changed = (key: keyof FileViewSettings) => settings[key] !== DEFAULT_SETTINGS[key];
  return (
    <>
      <SegmentedRow
        label="Layout"
        detail={roomy ? undefined : CHANGES_WORDS.TOO_NARROW_TO_SPLIT}
        value={settings.diffLayout}
        options={LAYOUT_OPTIONS}
        changed={changed("diffLayout")}
        onChange={(diffLayout) => change("diffLayout", diffLayout)}
      />
      <SelectRow
        density={SETTINGS_ROW_DENSITY.COMPACT}
        label="Changed words"
        value={settings.inlineDiff}
        options={INLINE_DIFF_OPTIONS}
        parse={(raw) => optionOf(INLINE_DIFF_OPTIONS, raw)}
        changed={changed("inlineDiff")}
        onChange={(inlineDiff) => change("inlineDiff", inlineDiff)}
      />
      <SegmentedRow
        label="Indicators"
        value={settings.diffIndicators}
        options={INDICATOR_OPTIONS}
        changed={changed("diffIndicators")}
        onChange={(diffIndicators) => change("diffIndicators", diffIndicators)}
      />
      <SwitchRow
        density={SETTINGS_ROW_DENSITY.COMPACT}
        label="Backgrounds"
        checked={settings.diffBackgrounds}
        changed={changed("diffBackgrounds")}
        onChange={(diffBackgrounds) => change("diffBackgrounds", diffBackgrounds)}
      />
    </>
  );
}

/** One group of the schema's (`DIFF_SETTING_GROUPS`), drawn as its rows. */
function GroupRows({
  section,
  scope,
}: {
  section: DiffSettingSection;
  scope: ViewSettingsScope;
}): React.JSX.Element {
  const diff = scope.kind === VIEW_SETTINGS_SCOPE.DIFF;
  switch (section) {
    case SETTING_SECTION.DIFF:
      return <DiffRows roomy={diff && scope.roomy} />;
    case SETTING_SECTION.LINES:
      return <LinesRows notes={diff || scope.notes} />;
    case SETTING_SECTION.TEXT:
      return (
        <>
          <ThemeRows />
          <TypeRows />
        </>
      );
  }
}

/**
 * The rows a View settings scope sets, in the groups the schema names and
 * Settings › Appearance draws as well: a diff's every group, or only those a
 * File tab's lines follow, so no row sets what the tab does not draw. Each is
 * changed for every diff as it is set. The Text group shows one appearance's
 * syntax theme at a time, the window's own as it opens, and the other a
 * press away.
 */
function ViewSettingsRows({ scope }: { scope: ViewSettingsScope }): React.JSX.Element {
  const groups =
    scope.kind === VIEW_SETTINGS_SCOPE.DIFF
      ? DIFF_SETTING_GROUPS
      : DIFF_SETTING_GROUPS.filter(({ section }) => section !== SETTING_SECTION.DIFF);
  return (
    <>
      {groups.map(({ section, title }) => (
        <SettingsSection key={section} title={title}>
          <GroupRows section={section} scope={scope} />
        </SettingsSection>
      ))}
    </>
  );
}

/** The popover: its title and ×, then the rows (`PopoverPanel`). */
function ViewSettingsPopover({
  open,
  id,
  scope,
  onClose,
  onLeave,
}: {
  /** Whether it stands; closed, it fades out. */
  open: boolean;
  id: string;
  scope: ViewSettingsScope;
  /** Closes the popover and hands the keyboard back to the button. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  return (
    <PopoverPanel
      open={open}
      id={id}
      title={VIEW_SETTINGS_LABEL}
      closeLabel="Close"
      onDismiss={onClose}
      onLeave={onLeave}
    >
      <ViewSettingsRows scope={scope} />
    </PopoverPanel>
  );
}

/**
 * View options as a phone offers it, where the bar it stands in is not
 * drawn: an item of the task's header's ⋯ (`useTabActions`), which opens
 * the same rows in a dialog over the screen, since no button stands for
 * the popover to hang from, and Done, Escape, or a press on the dimmed
 * screen puts it away.
 */
export function useViewSettingsSheet(scope: ViewSettingsScope): {
  readonly action: MenuAction;
  readonly sheet: React.ReactNode;
} {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return {
    action: {
      label: VIEW_SETTINGS_LABEL,
      icon: <SlidersHorizontalIcon aria-hidden="true" />,
      onSelect: () => setOpen(true),
    },
    sheet: (
      <Dialog
        open={open}
        title={VIEW_SETTINGS_LABEL}
        onDismiss={close}
        actions={
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={close}>
            Done
          </Button>
        }
      >
        <ViewSettingsRows scope={scope} />
      </Dialog>
    ),
  };
}

/** A bar's View options button, and its popover while open: a diff's every setting, or only those its lines follow, so no row sets what the tab does not draw. */
export function ViewSettingsButton({ scope }: { scope: ViewSettingsScope }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="view-settings relative flex" ref={root}>
      <Tooltip label={VIEW_SETTINGS_LABEL}>
        <IconButton
          ref={trigger}
          icon={<SlidersHorizontalIcon aria-hidden="true" />}
          label={VIEW_SETTINGS_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={() => setOpen(!open)}
        />
      </Tooltip>
      <AnchoredPopover open={open} align={POPOVER_ALIGN.END}>
        <ViewSettingsPopover
          open={open}
          id={popoverId}
          scope={scope}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      </AnchoredPopover>
    </div>
  );
}
