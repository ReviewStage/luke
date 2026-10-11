import { ResetIcon } from "@sidecar/panel";
import { APP_SETTING_FIELDS, APP_SETTING_SCHEMA, settingsScopeChanged } from "@sidecar/settings";
import type {
  AppSettingField,
  AppSettingsView,
  AppSettingValue,
  SettingsResetScope,
} from "@sidecar/settings/wire";
import { appSettingsView, SETTINGS_RESET_SCOPE } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast";
import { useSettingWrite } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/** What the toast says once a page's reset landed, by the group it reset. */
const RESET_NOTES = {
  [SETTINGS_RESET_SCOPE.VOICE]: "Voice settings reset",
  [SETTINGS_RESET_SCOPE.APPEARANCE]: "Appearance settings reset",
  [SETTINGS_RESET_SCOPE.SHORTCUTS]: "Shortcuts reset",
} as const satisfies Record<SettingsResetScope, string>;

/** What the toast says when an Undo could not write a setting back. */
const UNDO_REFUSED_NOTE = "The settings could not be put back. Try again.";

/** One setting as it stood, which an Undo writes back. */
type HeldSetting = readonly [AppSettingField, AppSettingValue<AppSettingField>];

/** Whether two readings of a setting say the same, a chord compared by its keys rather than by which object carries them. */
function sameSetting(
  a: AppSettingValue<AppSettingField>,
  b: AppSettingValue<AppSettingField>,
): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The group's settings the reset changed, as they stood before it: each
 * whose reading before differs from the store's answer after. Note that
 * the answer is what decides, not the defaults, because a setting the file
 * never held is read as what the launch resolved, a voice chosen by the
 * environment among them, and the reset leaves it reading the same, so an
 * Undo writing it back would make it the file's own.
 */
function changedBy(
  before: AppSettingsView,
  after: AppSettingsView,
  scope: SettingsResetScope,
): readonly HeldSetting[] {
  return APP_SETTING_FIELDS.flatMap((field): HeldSetting[] => {
    if (APP_SETTING_SCHEMA[field].resetScope !== scope) return [];
    // SAFETY: the value is the one this field holds, read from the settings by the field.
    const was = before[field] as AppSettingValue<AppSettingField>;
    // SAFETY: as above, from the settings the reset left.
    const now = after[field] as AppSettingValue<AppSettingField>;
    return sameSetting(was, now) ? [] : [[field, was]];
  });
}

/**
 * Writes each setting back as it stood, one after another so a chord
 * written back is checked against the one before it, answering whether
 * every write was taken.
 */
function writeBack(writes: SettingsWrites, held: readonly HeldSetting[]): Promise<boolean> {
  return held.reduce<Promise<boolean>>(
    (before, [field, value]) =>
      before.then((taken) =>
        taken
          ? writes.setting(field, value).then(
              (result) => result.status === ACTION_RESULT_STATUS.ACCEPTED,
              () => false,
            )
          : false,
      ),
    Promise.resolve(true),
  );
}

/**
 * The one control that returns a whole page to its defaults, drawn only
 * while the page holds something to return — until then it could only offer
 * to change nothing, the same reason a shortcut's own reset waits for a
 * chord. It stands in the window's toolbar beside the page's title, which is
 * what names the group it resets. One press is one ask of the store; the
 * control rests until the store answers, and a refusal is worded beside it.
 * A reset that landed takes the control away with what it reset, so it is
 * said in a toast with an Undo, which writes back what the page held.
 */
function ResetPageButton({
  scope,
  settings,
  writes,
}: {
  scope: SettingsResetScope;
  settings: AppSettingsView;
  writes: SettingsWrites;
}): React.JSX.Element {
  const toast = useToast();
  const reset = (asked: SettingsResetScope): Promise<ActionResult> => {
    const before = settings;
    return writes.reset(asked).then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) return result;
      const held = changedBy(before, appSettingsView(result.settings), asked);
      const undo = () =>
        writeBack(writes, held).then((taken) => {
          if (taken) return;
          toast({ words: UNDO_REFUSED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
        });
      toast({
        words: RESET_NOTES[asked],
        tone: TOAST_TONE.DONE,
        action: { label: UNDO_LABEL, onPress: undo },
      });
      return result;
    });
  };
  const { busy, rejection, run } = useSettingWrite(reset);
  return (
    <>
      {rejection ? (
        <p className="desktop-toolbar-note" role="alert">
          {rejection}
        </p>
      ) : null}
      <button type="button" className="toolbar-button" disabled={busy} onClick={() => run(scope)}>
        <ResetIcon />
        Reset to defaults
      </button>
    </>
  );
}

/**
 * Which page carries which group's reset.
 * Connections is absent rather than empty: the page holds keys and rows that
 * are not settings, and its one resettable group, Workspaces, carries its own
 * control on its own heading instead.
 */
const PAGE_RESET = {
  [SETTINGS_VIEW.VOICE]: SETTINGS_RESET_SCOPE.VOICE,
  [SETTINGS_VIEW.APPEARANCE]: SETTINGS_RESET_SCOPE.APPEARANCE,
  [SETTINGS_VIEW.SHORTCUTS]: SETTINGS_RESET_SCOPE.SHORTCUTS,
} satisfies Partial<Record<SettingsView, SettingsResetScope>>;

/** The reset the toolbar carries for a page, absent while the page stands at its defaults. */
export function pageResetControl(
  view: SettingsView,
  settings: AppSettingsView | undefined,
  writes: SettingsWrites,
): React.JSX.Element | undefined {
  if (!(view in PAGE_RESET)) return undefined;
  // SAFETY: `in` narrows the view to the pages the table names.
  const scope = PAGE_RESET[view as keyof typeof PAGE_RESET];
  if (!settings || !settingsScopeChanged(settings, scope)) return undefined;
  // Keyed to the page, so a refusal said on one page is not carried to the next.
  return <ResetPageButton key={scope} scope={scope} settings={settings} writes={writes} />;
}
