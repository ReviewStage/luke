import { CheckIcon, ExternalIcon } from "@sidecar/panel";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { BusyLabel } from "../spinner";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "../update-row";
import type { UpdateControl } from "./controls";
import { SettingsGroup } from "./settings-group";

/**
 * The row's one act, in the bordered face every Settings row's act wears:
 * fetch the release, restart into it, reach its page in the browser, or
 * check for one. The accent is kept for a form's Save alone.
 */
function updateButton(action: UpdateRowAction, control: UpdateControl): React.JSX.Element {
  switch (action) {
    case UPDATE_ROW_ACTION.DOWNLOADING:
      return (
        <button type="button" className="toolbar-button bordered-button" disabled>
          <BusyLabel busy label="Downloading the update">
            Download
          </BusyLabel>
        </button>
      );
    case UPDATE_ROW_ACTION.RESTART:
      return (
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={control.onInstall}
        >
          Restart to update
        </button>
      );
    case UPDATE_ROW_ACTION.GET:
      return (
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={control.onOpenLatest}
        >
          Download
        </button>
      );
    default:
      return (
        <button
          type="button"
          className="toolbar-button bordered-button"
          disabled={action === UPDATE_ROW_ACTION.CHECKING}
          onClick={() => void control.onCheck()}
        >
          <BusyLabel busy={action === UPDATE_ROW_ACTION.CHECKING} label="Checking for updates">
            Check for updates
          </BusyLabel>
        </button>
      );
  }
}

/**
 * Where the build stands against the latest release. It stays below the pages
 * while the sidebar's update row carries the news outside.
 */
export function UpdatesSection({ control }: { control: UpdateControl }): React.JSX.Element {
  const { tell } = useAct();
  const row = updateRow(control.update);
  return (
    <SettingsGroup title="Updates">
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.UPDATES)}>
        <span className="settings-copy">
          <span className="settings-name">
            <strong>Version {control.update.currentVersion}</strong>
            {row.current ? <CheckIcon /> : null}
          </span>
          {/* Note that a failure mounts an element of its own, an alert, so
              it is announced as it lands; every other detail is read with
              the row rather than spoken over whatever the reader is on. */}
          {row.failed ? (
            <small key="failed" role="alert">
              {row.detail}
            </small>
          ) : (
            <small>{row.detail}</small>
          )}
        </span>
        {updateButton(row.action, control)}
      </div>
      {/* What the versions the row talks about actually changed — beside the
          version, as a trip to the fixed changelog page in the browser. */}
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.CHANGELOG)}>
        <span className="settings-copy">
          <span className="settings-name">
            <strong>Changelog</strong>
          </span>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={() => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG)}
        >
          Open
          <ExternalIcon />
        </button>
      </div>
    </SettingsGroup>
  );
}
