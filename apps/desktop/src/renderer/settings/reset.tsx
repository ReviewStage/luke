import { ResetIcon } from "@sidecar/panel";
import { settingsScopeChanged } from "@sidecar/settings";
import type { AppSettingsView, SettingsResetScope } from "@sidecar/settings/wire";
import { SETTINGS_RESET_SCOPE } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { useSettingWrite } from "./use-setting-write";
import type { SettingsWrites } from "./writes";

/**
 * The one control that returns a whole page to its defaults, drawn only
 * while the page holds something to return — until then it could only offer
 * to change nothing, the same reason a shortcut's own reset waits for a
 * chord. It stands in the window's toolbar beside the page's title, which is
 * what names the group it resets. One press is one ask of the store; the
 * control rests until the store answers, and a refusal is worded beside it.
 */
function ResetPageButton({
  scope,
  onReset,
}: {
  scope: SettingsResetScope;
  onReset: (scope: SettingsResetScope) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onReset);
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
  return <ResetPageButton key={scope} scope={scope} onReset={writes.reset} />;
}
