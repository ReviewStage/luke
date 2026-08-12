import { useEffect, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { KeyIcon, MicrophoneIcon, PowerIcon } from "./settings-icons";

export interface SettingsPanelProps {
  microphoneStatus: MicrophoneStatus;
  microphoneActive: boolean;
  microphoneError?: string;
  onToggleMicrophone: () => void;
  settings?: AppSettings;
  onSubmitConductorApiKey: (apiKey: string | undefined) => Promise<string | undefined>;
  /** True while the key field holds focus or an unsaved draft. */
  onEditingChange: (editing: boolean) => void;
  onQuit: () => void;
}

const MICROPHONE_STATUS_LABEL: Record<MicrophoneStatus, string> = {
  "not-determined": "Not requested yet",
  granted: "Granted",
  denied: "Denied in System Settings",
  restricted: "Restricted by this Mac",
  unknown: "Unknown",
};

const CREDENTIAL_LABEL: Record<CredentialSource, string> = {
  [CREDENTIAL_SOURCE.NONE]: "Not connected",
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "Connected · key read from the environment",
  [CREDENTIAL_SOURCE.ENCRYPTED_FILE]: "Connected · key encrypted on this Mac",
};

/**
 * The credential is write-only from here: this form can replace or clear the
 * stored key, and the main process never sends one back — only where it was
 * resolved from.
 */
function ConductorSection({
  settings,
  onSubmit,
  onEditingChange,
}: {
  settings: AppSettings;
  onSubmit: (apiKey: string | undefined) => Promise<string | undefined>;
  onEditingChange: (editing: boolean) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const storageUnavailable = !settings.secretStorageAvailable;
  const hasStoredKey = settings.conductorApiKeySource === CREDENTIAL_SOURCE.ENCRYPTED_FILE;

  // Opening the tab is not a request to type. What the panel does need to know
  // is when the field is in use, because that is the only time the pointer
  // leaving should not be allowed to close it.
  useEffect(() => {
    onEditingChange(focused || draft.length > 0);
  }, [draft, focused, onEditingChange]);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);

  const submit = async (apiKey: string | undefined) => {
    setBusy(true);
    const failure = await onSubmit(apiKey);
    setBusy(false);
    setRejection(failure);
    if (!failure) setDraft("");
  };

  return (
    <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
      <h2>
        <KeyIcon />
        Conductor cloud
      </h2>
      <label className="settings-field" htmlFor="conductor-api-key">
        <span className="settings-label">API key</span>
        <input
          id="conductor-api-key"
          className="settings-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={hasStoredKey ? "Replace the stored key" : "Paste an API key"}
          value={draft}
          disabled={busy || storageUnavailable}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setFocused(true);
            // The panel can be showing without its window being key, and a
            // field that cannot be typed into is worse than no field.
            window.sidecar.focusPanel();
          }}
          onBlur={() => setFocused(false)}
        />
      </label>
      <div className="settings-row">
        <span className="settings-copy">
          <strong className={`credential ${settings.conductorApiKeySource}`}>
            {CREDENTIAL_LABEL[settings.conductorApiKeySource]}
          </strong>
          <small>
            {storageUnavailable
              ? "This system offers no encrypted credential storage, so Luke will not store a key here."
              : "Create one in Conductor under Settings · API keys. Luke reads only cloud workspaces you created, and never sends a prompt or any other change."}
          </small>
        </span>
        <span className="settings-actions">
          {hasStoredKey ? (
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => void submit(undefined)}
            >
              Remove
            </button>
          ) : null}
          <button
            type="button"
            className="action-button"
            disabled={busy || storageUnavailable || draft.trim().length === 0}
            onClick={() => void submit(draft)}
          >
            {busy ? "Saving…" : "Save key"}
          </button>
        </span>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </section>
  );
}

export function SettingsPanel({
  microphoneStatus,
  microphoneActive,
  microphoneError,
  onToggleMicrophone,
  settings,
  onSubmitConductorApiKey,
  onEditingChange,
  onQuit,
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
      {settings ? (
        <ConductorSection
          settings={settings}
          onSubmit={onSubmitConductorApiKey}
          onEditingChange={onEditingChange}
        />
      ) : null}

      <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
        <h2>
          <MicrophoneIcon />
          Microphone
        </h2>
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

      <button
        type="button"
        className="quit-button"
        style={{ "--row-index": 3 } as React.CSSProperties}
        onClick={onQuit}
      >
        <PowerIcon />
        Quit Luke
      </button>
    </div>
  );
}
