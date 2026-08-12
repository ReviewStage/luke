import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import type { CredentialProvider, CredentialProviderId } from "../shared/credential-providers";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import { ExternalIcon, KeyIcon, MicrophoneIcon, PowerIcon } from "./settings-icons";

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

/* Short enough to sit on the provider's own line: the section's note says where
   a key is kept, so the status only has to say whether there is one. */
const CREDENTIAL_STATUS: Record<CredentialSource, string> = {
  [CREDENTIAL_SOURCE.NONE]: "Not connected",
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
  [CREDENTIAL_SOURCE.ENCRYPTED_FILE]: "Connected",
};

/**
 * One provider, one line: its mark, its name, whether it is connected, and the
 * two things you can do about that. The field only exists while a key is being
 * entered, because a settings tab that is mostly empty input boxes reads as
 * work to do rather than as a state to check.
 *
 * The credential is write-only from here: this can replace or clear the stored
 * key, and the main process never sends one back — only where it was resolved
 * from.
 */
function ProviderCredential({
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
  const [draft, setDraft] = useState<string>();
  const [rejection, setRejection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const fieldId = `${provider.id}-api-key`;
  const editing = draft !== undefined;
  const stored = source === CREDENTIAL_SOURCE.ENCRYPTED_FILE;

  // Opening the tab is not a request to type, so the editor opens only on a
  // press — and then it takes the caret, because opening it is a request to
  // type. The panel is told an entry is in progress, because that is the only
  // time the pointer leaving must not be allowed to discard it.
  useEffect(() => {
    if (editing) field.current?.focus({ preventScroll: true });
  }, [editing]);
  useEffect(() => {
    onEditingChange(provider.id, editing);
  }, [editing, onEditingChange, provider.id]);
  useEffect(() => () => onEditingChange(provider.id, false), [onEditingChange, provider.id]);

  const submit = async (apiKey: string | undefined) => {
    setBusy(true);
    const failure = await onSubmit(provider.id, apiKey);
    setBusy(false);
    setRejection(failure);
    if (!failure) setDraft(undefined);
  };

  return (
    <div className="credential">
      <div className="credential-row">
        {/* The provider's own mark, so a list is read by brand rather than by a
            word every line would have to repeat. */}
        <ProviderMark providerId={provider.id} className="credential-mark" />
        <span className="credential-name">{provider.displayName}</span>
        <span className={`credential-status ${source}`}>{CREDENTIAL_STATUS[source]}</span>
        <span className="settings-actions">
          {stored ? (
            <button
              type="button"
              className="quiet-button credential-remove"
              disabled={busy}
              onClick={() => void submit(undefined)}
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            className="quiet-button"
            disabled={busy || storageUnavailable || editing}
            onClick={() => {
              setRejection(undefined);
              setDraft("");
            }}
          >
            {stored ? "Edit" : "Connect"}
          </button>
        </span>
      </div>

      {editing ? (
        <div className="credential-editor">
          <label className="settings-field" htmlFor={fieldId}>
            {/* The provider is named on the line above, so the visible label
                does not repeat it — but a reader hearing the field alone still
                needs to know whose key it is. */}
            <span className="settings-label">API key</span>
            <input
              id={fieldId}
              ref={field}
              aria-label={`${provider.displayName} API key`}
              className="settings-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={stored ? "Replace the stored key" : "Paste an API key"}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={() => {
                // The panel can be showing without its window being key, and a
                // field that cannot be typed into is worse than no field.
                window.sidecar.focusPanel();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && draft.trim().length > 0) void submit(draft);
                // Escape closes the editor rather than the panel behind it.
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setDraft(undefined);
                }
              }}
            />
          </label>
          <div className="settings-row">
            <small className="settings-note">
              {provider.hint}{" "}
              {/* A button, not an anchor: the renderer has no browser to
                  navigate, and the main process opens the page by provider
                  rather than by an address the panel supplies. */}
              <button
                type="button"
                className="link-button"
                onClick={() => window.sidecar.openProviderApiKeys(provider.id)}
              >
                Get an API key
                <ExternalIcon />
              </button>
            </small>
            <span className="settings-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                onClick={() => setDraft(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button"
                disabled={busy || draft.trim().length === 0}
                onClick={() => void submit(draft)}
              >
                {busy ? "Saving…" : "Save key"}
              </button>
            </span>
          </div>
        </div>
      ) : null}
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </div>
  );
}

/**
 * Every provider that can hold a key, one line each. A provider is listed
 * whether or not it has one, because the list is how you learn which services
 * Luke can watch at all.
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
        <ProviderCredential
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
