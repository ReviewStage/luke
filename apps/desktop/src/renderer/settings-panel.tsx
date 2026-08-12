import { useCallback, useEffect, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import type { CredentialProvider, CredentialProviderId } from "../shared/credential-providers";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import { KeyIcon, MicrophoneIcon, PowerIcon } from "./settings-icons";

export interface SettingsPanelProps {
  microphoneStatus: MicrophoneStatus;
  microphoneActive: boolean;
  microphoneError?: string;
  onToggleMicrophone: () => void;
  settings?: AppSettings;
  onSubmitProviderApiKey: (
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ) => Promise<string | undefined>;
  /** True while any key field holds focus or an unsaved draft. */
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
 * One provider's key. The credential is write-only from here: this field can
 * replace or clear the stored key, and the main process never sends one back —
 * only where it was resolved from.
 */
function ProviderKeyField({
  provider,
  source,
  storageUnavailable,
  onSubmit,
  onEditingChange,
}: {
  provider: CredentialProvider;
  source: CredentialSource;
  storageUnavailable: boolean;
  onSubmit: (
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ) => Promise<string | undefined>;
  onEditingChange: (providerId: CredentialProviderId, editing: boolean) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fieldId = `${provider.id}-api-key`;
  const hasStoredKey = source === CREDENTIAL_SOURCE.ENCRYPTED_FILE;

  // Opening the tab is not a request to type. What the panel does need to know
  // is when a field is in use, because that is the only time the pointer
  // leaving should not be allowed to close it.
  useEffect(() => {
    onEditingChange(provider.id, focused || draft.length > 0);
  }, [draft, focused, onEditingChange, provider.id]);
  useEffect(() => () => onEditingChange(provider.id, false), [onEditingChange, provider.id]);

  const submit = async (apiKey: string | undefined) => {
    setBusy(true);
    const failure = await onSubmit(provider.id, apiKey);
    setBusy(false);
    setRejection(failure);
    if (!failure) setDraft("");
  };

  return (
    <div className="credential-field">
      <label className="settings-field" htmlFor={fieldId}>
        {/* The provider's own mark, so a column of identical fields is read by
            brand rather than by a word every row would have to repeat. */}
        <span className="settings-label">
          <ProviderMark providerId={provider.id} className="credential-mark" />
          {provider.displayName}
        </span>
        <input
          id={fieldId}
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
          <strong className={`credential ${source}`}>{CREDENTIAL_LABEL[source]}</strong>
          <small>{provider.hint}</small>
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
    </div>
  );
}

/**
 * Every provider that can hold a key, in one section. A provider is listed
 * whether or not it has one, because an empty field is how you learn Luke can
 * watch that service at all.
 */
function CredentialsSection({
  settings,
  onSubmit,
  onEditingChange,
}: {
  settings: AppSettings;
  onSubmit: (
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ) => Promise<string | undefined>;
  onEditingChange: (editing: boolean) => void;
}): React.JSX.Element {
  const [editingProviders, setEditingProviders] = useState<readonly CredentialProviderId[]>([]);

  const reportEditing = useCallback((providerId: CredentialProviderId, editing: boolean) => {
    setEditingProviders((current) => {
      const held = current.includes(providerId);
      if (held === editing) return current;
      return editing ? [...current, providerId] : current.filter((id) => id !== providerId);
    });
  }, []);

  // The panel asks one question — is a key mid-entry — so the fields' answers
  // are collapsed into one before it is given.
  useEffect(() => {
    onEditingChange(editingProviders.length > 0);
  }, [editingProviders, onEditingChange]);

  return (
    <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
      <h2>
        <KeyIcon />
        Cloud API keys
      </h2>
      {CREDENTIAL_PROVIDER_LIST.map((provider) => (
        <ProviderKeyField
          key={provider.id}
          provider={provider}
          source={settings.credentialSources[provider.id]}
          storageUnavailable={!settings.secretStorageAvailable}
          onSubmit={onSubmit}
          onEditingChange={reportEditing}
        />
      ))}
      {/* True of every key here, so it is said once rather than per provider. */}
      <p className="settings-note">
        {settings.secretStorageAvailable
          ? "Luke reads only cloud workspaces you created, and never sends a prompt or any other change."
          : "This system offers no encrypted credential storage, so Luke will not store a key here."}
      </p>
    </section>
  );
}

export function SettingsPanel({
  microphoneStatus,
  microphoneActive,
  microphoneError,
  onToggleMicrophone,
  settings,
  onSubmitProviderApiKey,
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
        <CredentialsSection
          settings={settings}
          onSubmit={onSubmitProviderApiKey}
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
