import { APP_SETTING_FIELDS, APP_SETTING_SCHEMA, settingsScopeChanged } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import type {
  AppSettingField,
  AppSettingsView,
  AppSettingValue,
  SettingsResetScope,
} from "@luke/settings/wire";
import { appSettingsView, SETTINGS_RESET_SCOPE } from "@luke/settings/wire";
import { BUTTON_VARIANT, Button, ResetIcon } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { TOAST_HOLD, TOAST_TONE, UNDO_LABEL, useToast } from "../toast.js";
import type { SettingsWrites } from "./writes.js";

/** What the toast says once a page's reset landed, by the group it reset. */
const RESET_NOTES = {
  [SETTINGS_RESET_SCOPE.VOICE]: "Voice settings reset",
  [SETTINGS_RESET_SCOPE.APPEARANCE]: "Appearance settings reset",
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
 * chord. It ends the page's title line, quiet as a note's own act is, since
 * the title is what names the group it resets. One press is one ask of the
 * store; the control rests until the store answers, and a refusal is said
 * in a toast held as a failure is, since the page's title line has no row
 * under it to say it in.
 * A reset that landed takes the control away with what it reset, so it is
 * said in a toast with an Undo, which writes back what the page held.
 * The control is `@luke/ui`'s quiet `Button`, its glyph in the button's icon
 * slot.
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
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({ words: result.reason, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
        return result;
      }
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
  const { busy, run } = useSettingWrite(reset);
  return (
    <Button
      variant={BUTTON_VARIANT.QUIET}
      icon={<ResetIcon />}
      disabled={busy}
      onClick={() => run(scope)}
    >
      Reset to defaults
    </Button>
  );
}

/**
 * Which page carries which group's reset. The Voice page's takes the talk and
 * stop keys with the rest of the page.
 */
const PAGE_RESET = {
  [SETTINGS_VIEW.VOICE]: SETTINGS_RESET_SCOPE.VOICE,
  [SETTINGS_VIEW.APPEARANCE]: SETTINGS_RESET_SCOPE.APPEARANCE,
} satisfies Partial<Record<SettingsView, SettingsResetScope>>;

/** The reset a page's title line carries, absent while the page stands at its defaults. */
export function pageResetControl(
  view: SettingsView,
  settings: AppSettingsView | undefined,
  writes: SettingsWrites,
): React.JSX.Element | undefined {
  if (!(view in PAGE_RESET)) return undefined;
  // SAFETY: `in` narrows the view to the pages the table names.
  const scope = PAGE_RESET[view as keyof typeof PAGE_RESET];
  if (!settings || !settingsScopeChanged(settings, scope)) return undefined;
  // Keyed to the page, so a press out on one page does not rest the next one's.
  return <ResetPageButton key={scope} scope={scope} settings={settings} writes={writes} />;
}
