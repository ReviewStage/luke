import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@luke/settings/settings-anchors";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "@luke/settings/update-row";
import { CheckIcon, ExternalIcon } from "@luke/ui";
import type { UpdateControl } from "@luke/voice/settings-controls";
import { useAct } from "../act";
import { BusyLabel } from "../spinner";
import { SettingsGroup } from "./settings-group";

/**
 * The row's one act, in the bordered face every Settings row's act wears:
 * restart into the release, reach its page in the browser, check for one,
 * or check again — or none at all, while a download runs or for a
 * development build no release is newer than. The accent is kept for a
 * form's Save alone.
 */
function updateButton(action: UpdateRowAction, control: UpdateControl): React.JSX.Element | null {
  switch (action) {
    case UPDATE_ROW_ACTION.NONE:
    case UPDATE_ROW_ACTION.DOWNLOADING:
      return null;
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
          <ExternalIcon />
        </button>
      );
    case UPDATE_ROW_ACTION.RETRY:
      return (
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={() => void control.onCheck()}
        >
          Try again
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
 * Where the build stands against the latest release, and what it changed: the
 * About page's one group, while the sidebar's update row carries the news
 * outside.
 */
export function UpdatesSection({ control }: { control: UpdateControl }): React.JSX.Element {
  const { tell } = useAct();
  const row = updateRow(control.update, control.build);
  return (
    <SettingsGroup>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.UPDATES)}>
        <span className="settings-copy">
          <span className="settings-name">
            <strong>{row.title}</strong>
            {row.current ? <CheckIcon /> : null}
          </span>
          {/* Note that a failure mounts an element of its own, an alert, so
              it is announced as it lands; every other detail is read with
              the row rather than spoken over whatever the reader is on. */}
          {row.failed ? (
            <small key="failed" className="error-message" role="alert">
              {row.detail}
            </small>
          ) : (
            <small>{row.detail}</small>
          )}
          {row.progress === undefined ? null : (
            <span className="update-progress" aria-hidden="true">
              <span style={{ width: `${row.progress}%` }} />
            </span>
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
