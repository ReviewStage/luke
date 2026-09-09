import { ResetIcon } from "@sidecar/panel";
import { settingsScopeChanged } from "@sidecar/settings";
import type { AppSettingsView, SettingsResetScope } from "@sidecar/settings/wire";
import { SETTINGS_RESET_SCOPE } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { useSettingWrite } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/**
 * The one control that returns a whole group to its defaults, drawn only
 * while the group holds something to return — until then it could only offer
 * to change nothing, the same reason a shortcut's own reset waits for a
 * chord. One press is one ask of the store; the control rests until the
 * store answers, and a refusal is worded where the press was.
 */
export function ResetGroupButton({
  scope,
  label,
  onReset,
}: {
  scope: SettingsResetScope;
  /** The group as the button names it aloud: "the Voice page's settings". */
  label: string;
  onReset: (scope: SettingsResetScope) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onReset);
  return (
    <>
      <button
        type="button"
        className="icon-button settings-reset"
        disabled={busy}
        aria-label={`Reset ${label} to the defaults`}
        title="Back to the defaults"
        onClick={() => run(scope)}
      >
        <ResetIcon />
      </button>
      {rejection ? (
        <p className="error-message settings-reset-refusal" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}

/**
 * Which page carries which group's reset, and what that group is called aloud.
 * Connections is absent rather than empty: the page holds keys and rows that
 * are not settings, and its one resettable group, Workspaces, carries its own
 * control on its own heading instead.
 */
const PAGE_RESET: Partial<Record<SettingsView, { scope: SettingsResetScope; label: string }>> = {
  [SETTINGS_VIEW.VOICE]: { scope: SETTINGS_RESET_SCOPE.VOICE, label: "the Voice settings" },
  [SETTINGS_VIEW.APPEARANCE]: {
    scope: SETTINGS_RESET_SCOPE.APPEARANCE,
    label: "the Appearance settings",
  },
  [SETTINGS_VIEW.SHORTCUTS]: {
    scope: SETTINGS_RESET_SCOPE.SHORTCUTS,
    label: "the keyboard shortcuts",
  },
};

/** The reset a page's header carries, absent while the page stands at its defaults. */
export function pageResetControl(
  view: SettingsView,
  settings: AppSettingsView | undefined,
  writes: SettingsWrites,
): React.JSX.Element | undefined {
  const group = PAGE_RESET[view];
  if (!group || !settings || !settingsScopeChanged(settings, group.scope)) return undefined;
  return <ResetGroupButton scope={group.scope} label={group.label} onReset={writes.reset} />;
}
