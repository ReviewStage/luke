import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE } from "../shared/contracts";
import type { CredentialProvider, CredentialProviderId } from "../shared/credential-providers";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  CheckIcon,
  ExternalIcon,
  KeyIcon,
  MicrophoneIcon,
  PencilIcon,
  PowerIcon,
  TrashIcon,
} from "./settings-icons";

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

/* What nothing else on the line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
const CREDENTIAL_STATUS: Partial<Record<CredentialSource, string>> = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
};

/* One field, three jobs: what it is for depends on what is answering for the
   provider now, and a credential typed here always wins over one read
   elsewhere. The label above names what to paste, so these do not repeat it —
   and cannot, since not every provider calls it the same thing. */
const CREDENTIAL_PLACEHOLDER: Record<CredentialSource, string> = {
  [CREDENTIAL_SOURCE.NONE]: "Paste it here",
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "Paste one to use instead of the one from the environment",
  [CREDENTIAL_SOURCE.ENCRYPTED_FILE]: "Replace what is stored",
};

/**
 * One provider, one line: its mark, its name, whether it is connected, and what
 * can be done about that — connect, supersede, or delete, whichever the state
 * actually allows. The field only exists while a key is being entered, because
 * a settings tab that is mostly empty input boxes reads as work to do rather
 * than as a state to check.
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
  // Deleting is only ever for a key kept here; one read from the environment is
  // not Luke's to remove. Either can be superseded by a key typed in, so both
  // connected states offer the same editor and only the unconnected one is
  // asked to connect.
  const stored = source === CREDENTIAL_SOURCE.ENCRYPTED_FILE;
  const connected = source !== CREDENTIAL_SOURCE.NONE;
  const status = CREDENTIAL_STATUS[source];
  // The pencil opens the same editor from either connected state, but it does
  // not mean the same thing: one replaces the key Luke keeps, the other stands
  // in front of one it only reads.
  const editTitle = stored ? "Replace" : "Use a credential stored here";
  // Most providers issue an API key. One issues something it calls by another
  // name, and a field asking for the wrong thing sends the user to the page
  // that hands out the credential Luke refuses.
  const credential = provider.keyFormat?.label ?? "API key";
  const editLabel = stored
    ? `Replace the ${provider.displayName} ${credential}`
    : `Store a ${provider.displayName} ${credential} instead of the one from the environment`;

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

  // Every control that offers to write a key opens the one editor, and clears
  // whatever the last attempt was rejected for on the way in.
  const openEditor = () => {
    setRejection(undefined);
    setDraft("");
  };

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
        <span className="credential-identity">
          {/* The provider's own mark, so a list is read by brand rather than by
              a word every line would have to repeat. Every provider that can
              hold a key is one whose sessions live in a cloud service — that is
              what makes the key necessary — so each mark carries the same badge
              its session rows do, rather than one line's mark differing from
              the same mark elsewhere. */}
          <span className="credential-mark">
            <ProviderMark providerId={provider.id} />
            <CloudBadge />
          </span>
          <span className="credential-name">{provider.displayName}</span>
          {connected ? <CheckIcon /> : null}
        </span>
        {/* The check says connected and the controls say what can be done about
            it, so the words are kept for the one thing neither can say:
            connected from the environment rather than from a key kept here. */}
        {status ? <span className="credential-status">{status}</span> : null}
        <span className="settings-actions">
          {stored ? (
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={busy}
              aria-label={`Delete the ${provider.displayName} ${credential}`}
              title="Delete"
              onClick={() => void submit(undefined)}
            >
              <TrashIcon />
            </button>
          ) : null}
          {connected ? (
            <button
              type="button"
              className="icon-button"
              disabled={busy || storageUnavailable || editing}
              aria-label={editLabel}
              title={editTitle}
              onClick={openEditor}
            >
              <PencilIcon />
            </button>
          ) : (
            /* Named for its provider like the icon buttons beside it: a list of
               controls read on its own is otherwise two identical Connects. */
            <button
              type="button"
              className="quiet-button"
              disabled={busy || storageUnavailable || editing}
              aria-label={`Connect ${provider.displayName}`}
              onClick={openEditor}
            >
              Connect
            </button>
          )}
        </span>
      </div>

      {editing ? (
        /* Named as a group, because Cancel, Save, and the link to the
           provider's own page are the same three words on every row and two
           editors can be open at once. */
        <fieldset
          className="credential-editor"
          aria-label={`${provider.displayName} ${credential}`}
        >
          <label className="settings-field" htmlFor={fieldId}>
            {/* The provider is named on the line above, so the visible label
                does not repeat it — but a reader hearing the field alone still
                needs to know whose key it is. */}
            <span className="settings-label">{credential}</span>
            <input
              id={fieldId}
              ref={field}
              aria-label={`${provider.displayName} ${credential}`}
              className="settings-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={CREDENTIAL_PLACEHOLDER[source]}
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
                Where to get one
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
                {busy ? "Saving…" : "Save"}
              </button>
            </span>
          </div>
        </fieldset>
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

  // A hold has to be released by whatever still exists to release it. Switching
  // tabs unmounts this section and its fields in one commit, so a field's own
  // "no longer editing" is reported into a tree that is already going away, and
  // the panel would stay held open by an entry that is gone.
  useEffect(() => () => onEditingChange(false), [onEditingChange]);

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
