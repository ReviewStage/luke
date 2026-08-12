import type { MicrophoneStatus } from "../shared/contracts";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";

export interface SettingsPanelProps {
  microphoneStatus: MicrophoneStatus;
  microphoneActive: boolean;
  microphoneError?: string;
  onToggleMicrophone: () => void;
  onQuit: () => void;
  displaySummary: string;
}

const MICROPHONE_STATUS_LABEL: Record<MicrophoneStatus, string> = {
  "not-determined": "Not requested yet",
  granted: "Granted",
  denied: "Denied in System Settings",
  restricted: "Restricted by this Mac",
  unknown: "Unknown",
};

export function SettingsPanel({
  microphoneStatus,
  microphoneActive,
  microphoneError,
  onToggleMicrophone,
  onQuit,
  displaySummary,
}: SettingsPanelProps): React.JSX.Element {
  const microphoneAction = microphoneActive
    ? "Stop listening"
    : microphoneStatus === "granted"
      ? "Start listening"
      : "Grant access";

  return (
    <div
      className="settings"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SETTINGS)}
      aria-labelledby={panelTabId(PANEL_TAB.SETTINGS)}
    >
      <section className="settings-section">
        <h2>Microphone</h2>
        <div className="settings-row">
          <span className="settings-copy">
            <strong>{MICROPHONE_STATUS_LABEL[microphoneStatus]}</strong>
            <small>Speech stays on this Mac and is never written to disk.</small>
          </span>
          <button type="button" className="action-button" onClick={onToggleMicrophone}>
            {microphoneAction}
          </button>
        </div>
        {microphoneError ? <p className="error-message">{microphoneError}</p> : null}
      </section>

      <section className="settings-section settings-section-quiet">
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Luke</strong>
            <small>{displaySummary}</small>
          </span>
          <button type="button" className="quiet-button" onClick={onQuit}>
            Quit
          </button>
        </div>
      </section>
    </div>
  );
}
