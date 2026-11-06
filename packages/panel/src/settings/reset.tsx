import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type SettingsRowsInput,
  settingsScopeChanged,
  settingVisible,
} from "@repo/settings";
import { SETTINGS_VIEW, type SettingsView } from "@repo/settings/settings-views";
import type {
  AppSettingField,
  AppSettingsView,
  AppSettingValue,
  SettingsResetScope,
} from "@repo/settings/wire";
import { appSettingsView, SETTINGS_RESET_SCOPE } from "@repo/settings/wire";
import { BUTTON_VARIANT, Button, IconButton, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useIsMutating } from "@tanstack/react-query";
import { actFailureWords, KEPT, type Kept, notKept } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import type { SettingsWrites } from "./writes.js";

const RESET_NOTES = {
  [SETTINGS_RESET_SCOPE.APPEARANCE]: "Appearance settings reset",
} as const satisfies Record<SettingsResetScope, string>;

const RESET_LABEL = "Reset to defaults";

const UNDO_REFUSED_NOTE = "The settings could not be put back. Try again.";

type HeldSetting = readonly [AppSettingField, AppSettingValue<AppSettingField>];

function sameSetting(
  a: AppSettingValue<AppSettingField>,
  b: AppSettingValue<AppSettingField>,
): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function changedBy(
  before: AppSettingsView,
  after: AppSettingsView,
  scope: SettingsResetScope,
): readonly HeldSetting[] {
  return APP_SETTING_FIELDS.flatMap((field): HeldSetting[] => {
    if (APP_SETTING_SCHEMA[field].resetScope !== scope) return [];
    const was = before[field] as AppSettingValue<AppSettingField>;
    const now = after[field] as AppSettingValue<AppSettingField>;
    return sameSetting(was, now) ? [] : [[field, was]];
  });
}

function writeBack(writes: SettingsWrites, held: readonly HeldSetting[]): Promise<Kept> {
  return held.reduce<Promise<Kept>>(
    (before, [field, value]) =>
      before.then((taken) =>
        taken.kept
          ? writes
              .setting(field, value)
              .then(
                (result) =>
                  result.status === ACTION_RESULT_STATUS.ACCEPTED ? KEPT : notKept(result),
                notKept,
              )
          : taken,
      ),
    Promise.resolve(KEPT),
  );
}

function ResetPageButton({
  scope,
  settings,
  writes,
  rows,
  more,
}: {
  scope: SettingsResetScope;
  settings: AppSettingsView;
  writes: SettingsWrites;
  rows: SettingsRowsInput;
  more: string | undefined;
}): React.JSX.Element {
  const toast = useToast();
  const reset = (asked: SettingsResetScope): Promise<ActionResult> => {
    const before = settings;
    const unseen = APP_SETTING_FIELDS.filter(
      (field) => APP_SETTING_SCHEMA[field].resetScope === asked && !settingVisible(field, rows),
    );
    return writes.reset(asked, unseen).then((result) => {
      if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) {
        toast({
          words: result.reason,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.SETTINGS_RESET, cause: result },
        });
        return result;
      }
      const held = changedBy(before, appSettingsView(result.settings), asked).filter(
        ([field]) => !unseen.includes(field),
      );
      const undo = () =>
        writeBack(writes, held).then((taken) => {
          if (taken.kept) return;
          toast({
            words: UNDO_REFUSED_NOTE,
            replayUnmasked: true,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: { surface: FAILURE_SURFACE.SETTINGS_RESET, cause: taken.cause },
          });
        });
      toast({ ...undoToast(RESET_NOTES[asked], undo), replayUnmasked: true });
      return result;
    });
  };
  const busy = useIsMutating({ mutationKey: actMutation(ACT_KIND.SETTINGS_RESET).mutationKey }) > 0;
  const run = (asked: SettingsResetScope) => {
    void reset(asked).catch((error: unknown) =>
      toast({
        words: actFailureWords(error),
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.SETTINGS_RESET, cause: error },
      }),
    );
  };
  if (more !== undefined) {
    return (
      <IconButton
        variant={BUTTON_VARIANT.QUIET}
        icon={<GLYPH.GO_BACK />}
        label={RESET_LABEL}
        busy={busy}
        busyLabel="Resetting"
        onClick={() => run(scope)}
      />
    );
  }
  return (
    <Button
      variant={BUTTON_VARIANT.QUIET}
      icon={<GLYPH.GO_BACK />}
      busy={busy}
      busyLabel="Resetting"
      onClick={() => run(scope)}
    >
      {RESET_LABEL}
    </Button>
  );
}

const PAGE_RESET = {
  [SETTINGS_VIEW.APPEARANCE]: SETTINGS_RESET_SCOPE.APPEARANCE,
} satisfies Partial<Record<SettingsView, SettingsResetScope>>;

export function pageResetControl(
  view: SettingsView,
  settings: AppSettingsView | undefined,
  writes: SettingsWrites,
  rows: SettingsRowsInput | undefined,
  more?: string | undefined,
): React.JSX.Element | undefined {
  if (!(view in PAGE_RESET)) return undefined;
  const scope = PAGE_RESET[view as keyof typeof PAGE_RESET];
  if (!settings || !rows || !settingsScopeChanged(settings, scope, rows)) return undefined;
  return (
    <ResetPageButton
      key={scope}
      scope={scope}
      settings={settings}
      writes={writes}
      rows={rows}
      more={more}
    />
  );
}
