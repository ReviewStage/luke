import { CheckIcon, DownloadIcon, ExternalIcon } from "@sidecar/panel";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "../update-row";
import type { UpdateControl } from "./controls";

/**
 * The buttons with somewhere new to go — fetch the release, restart into it,
 * or reach its page in the browser — are filled with the accent, as the one
 * act the row exists for; checking stays a plain toolbar button, because
 * checking is maintenance.
 */
function updateButton(action: UpdateRowAction, control: UpdateControl): React.JSX.Element {
  switch (action) {
    case UPDATE_ROW_ACTION.DOWNLOADING:
      return (
        <button type="button" className="toolbar-button" disabled>
          Downloading…
        </button>
      );
    case UPDATE_ROW_ACTION.RESTART:
      return (
        <button type="button" className="primary-button" onClick={control.onInstall}>
          Restart to update
        </button>
      );
    case UPDATE_ROW_ACTION.GET:
      return (
        <button type="button" className="primary-button" onClick={control.onOpenLatest}>
          Download
        </button>
      );
    default:
      return (
        <button
          type="button"
          className="toolbar-button"
          disabled={action === UPDATE_ROW_ACTION.CHECKING}
          onClick={() => void control.onCheck()}
        >
          {action === UPDATE_ROW_ACTION.CHECKING ? "Checking…" : "Check for updates"}
        </button>
      );
  }
}

/**
 * Where the build stands against the latest release. It stays below the pages
 * while the Settings tab's dot carries the news outside.
 */
export function UpdatesSection({ control }: { control: UpdateControl }): React.JSX.Element {
  const { tell } = useAct();
  const row = updateRow(control.update);
  return (
    <section className="settings-section">
      <h2>
        <DownloadIcon />
        Updates
      </h2>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.UPDATES)}>
        <span className="settings-copy">
          <span className="settings-name">
            <strong>Version {control.update.currentVersion}</strong>
            {row.current ? <CheckIcon /> : null}
          </span>
          <small>{row.detail}</small>
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
          className="toolbar-button"
          onClick={() => tell(ACT_KIND.UPDATE_OPEN_CHANGELOG)}
        >
          Open
          <ExternalIcon />
        </button>
      </div>
    </section>
  );
}
