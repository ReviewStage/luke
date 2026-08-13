import { useEffect, useRef, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../shared/contracts";
import type { CredentialProvider } from "../shared/credential-providers";
import { CREDENTIAL_PROVIDER_LIST } from "../shared/credential-providers";
import {
  CREDENTIAL_PLACEHOLDER,
  type CredentialEntryControl,
  entryForProvider,
  focusWhenVisible,
  isSubmittable,
  useStagedFocus,
} from "./credential-entry";
import {
  REMOVAL_STAGE,
  type RemovalStage,
  removalAsked,
  removalStage,
  removalWithdrawable,
} from "./credential-removal";
import { microphoneAccessRow } from "./microphone-access";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  CheckIcon,
  ExternalIcon,
  KeyboardIcon,
  KeyIcon,
  MicrophoneIcon,
  PencilIcon,
  PowerIcon,
  ShieldIcon,
  TrashIcon,
} from "./settings-icons";

export interface SettingsPanelProps {
  microphoneStatus: MicrophoneStatus;
  microphoneError?: string;
  /** Asks the system for access. Using the microphone is the talk key's job. */
  onRequestMicrophone: () => void;
  /** Gives Luke the microphone, or takes it back, without touching the system's grant. */
  onAllowMicrophone: (allowed: boolean) => void;
  /** Whether there is anything to talk to, which is the microphone's only use. */
  voiceAvailable: boolean;
  settings?: AppSettings;
  /** The one credential being entered anywhere, and everything that can be done to it. */
  credentials: CredentialEntryControl;
  /**
   * True while the panel is the shape on screen. A field can only hold the
   * caret then: everything here sits in an inert stage the rest of the time,
   * and an entry can outlast the panel it was started in.
   */
  panelOpen: boolean;
  onQuit: () => void;
  /** The talk key, shown so it can be learned. It is not editable yet. */
  voiceHotkey?: string;
  /** Whether that key can be held, which is what the row has to describe. */
  voiceHotkeyHeld: boolean;
}

/* What nothing else on the line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
const CREDENTIAL_STATUS: Partial<Record<CredentialSource, string>> = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
};

/* Why a row that could otherwise be connected is not offering to be. */
const HELD_TITLE = "Finish the one you are entering first";

/* The safe answer arrives first and the one that cannot be taken back lands a
   beat behind it, on the same stagger the panel's rows fan open with. Their
   order on the line is the order they arrive in, so this is their place in it
   rather than a delay written per button. */
const REMOVAL_ANSWER_INDEX = {
  KEEP: 0,
  DELETE: 1,
} as const;

function answerOrder(index: number): React.CSSProperties {
  return { "--answer-index": index } as React.CSSProperties;
}

/**
 * One provider, one line: its mark, its name, whether it is connected, and what
 * can be done about that — connect, supersede, or delete, whichever the state
 * actually allows. The field only exists while a key is being entered, because
 * a settings tab that is mostly empty input boxes reads as work to do rather
 * than as a state to check.
 *
 * Asking to write one takes the panel down to the slot, so the field is drawn
 * here only when the panel is brought back around an entry that is still open.
 * Asking to delete one goes nowhere at all: the question and its answer are the
 * same few pixels the trash was drawn in.
 *
 * The credential is write-only from here: this can replace or clear the stored
 * key, and the main process never sends one back — only where it was resolved
 * from.
 */
function ProviderCredential({
  provider,
  source,
  storageUnavailable,
  control,
  panelOpen,
}: {
  provider: CredentialProvider;
  source: CredentialSource;
  storageUnavailable: boolean;
  control: CredentialEntryControl;
  panelOpen: boolean;
}): React.JSX.Element {
  // Deleting is the one act that begins and ends on this line, question and
  // answer both. Entering a credential does not: it can leave for the slot and
  // come back, so it is held above.
  const [heldRemoval, setHeldRemoval] = useState<RemovalStage>(REMOVAL_STAGE.RESTING);
  const [removalRejection, setRemovalRejection] = useState<string>();
  const field = useRef<HTMLInputElement | null>(null);
  const trash = useRef<HTMLButtonElement | null>(null);
  const keep = useRef<HTMLButtonElement | null>(null);
  const editControl = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const fieldId = `${provider.id}-api-key`;
  const entry = entryForProvider(control, provider.id);
  const editing = entry !== undefined;
  // Deleting is only ever for a key kept here; one read from the environment is
  // not Luke's to remove. Either can be superseded by a key typed in, so both
  // connected states offer the same editor and only the unconnected one is
  // asked to connect.
  const stored = source === CREDENTIAL_SOURCE.ENCRYPTED_FILE;
  const connected = source !== CREDENTIAL_SOURCE.NONE;
  const removal = removalStage(heldRemoval, { stored, panelOpen });
  // Corrected during the render that discovers it rather than from an effect,
  // the way an emptied filter is: a question whose subject or whose surface has
  // gone must never be drawn once and taken back on the next frame.
  if (removal !== heldRemoval) setHeldRemoval(removal);
  const asking = removalAsked(removal);
  const clearing = removal === REMOVAL_STAGE.CLEARING;
  const busy = clearing || (entry?.busy ?? false);
  const rejection = removalRejection ?? entry?.rejection;
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
  // One credential is entered at a time, because there is one slot to enter it
  // in. A row cannot begin a second entry over the top of one already open —
  // not even another provider's, whose draft is just as likely to be something
  // already pasted — and it says why rather than going quiet for no visible
  // reason.
  const held = control.entry !== undefined && !editing;
  const beginBlocked = busy || storageUnavailable || editing || held;

  // The field takes the caret whenever the panel is the shape around it: coming
  // back to a panel mid-entry — pressing the capsule while the slot holds the
  // credential — hands focus out of an inert stage on the way, and returns
  // someone who was in the middle of typing.
  useStagedFocus(field, editing && panelOpen && !busy);

  // The question takes the focus to the answer that changes nothing. The
  // control that asked it is inert by the time the confirm is drawn, so focus
  // has nowhere else to go — and of the two places it could land, only one is
  // safe to arrive on with a key already pressed.
  useStagedFocus(keep, asking && !clearing);

  // Answering hands it back to the line: to the trash if the key survived, and
  // to whatever now stands where the trash was if it did not. Only an answer
  // moves focus — a question the panel closing withdrew was never answered, and
  // reaching into a shape that is leaving would pull it back open.
  useEffect(() => {
    if (asking || !returnFocus.current) return;
    returnFocus.current = false;
    return focusWhenVisible(trash.current ?? editControl.current);
  }, [asking]);

  // Every control that offers to write one begins the one entry — which takes
  // the panel down to the slot — and clears whatever the last attempt was
  // rejected for on the way.
  const beginEntry = () => {
    setRemovalRejection(undefined);
    control.begin(provider.id);
  };

  // The trash asks; only the answer acts. Nothing here can hand a key back, so
  // a delete taken on the first press would cost a trip to the provider's own
  // site to undo.
  const askToRemove = () => {
    setRemovalRejection(undefined);
    setHeldRemoval(REMOVAL_STAGE.ASKING);
  };

  // Keeping it changes nothing, so it says nothing: the line goes back to the
  // controls it was showing. Only a question can be kept from — an answer
  // already sent is not this control's to take back.
  const keepKey = () => {
    if (!removalWithdrawable(removal)) return;
    returnFocus.current = true;
    setHeldRemoval(REMOVAL_STAGE.RESTING);
  };

  const removeKey = async () => {
    setHeldRemoval(REMOVAL_STAGE.CLEARING);
    const reason = await control.remove(provider.id);
    returnFocus.current = true;
    setRemovalRejection(reason);
    // Answered either way. A refusal is an answer too, and asking again is a
    // fresh decision rather than a confirm left standing over a key that turned
    // out to still be there.
    setHeldRemoval(REMOVAL_STAGE.RESTING);
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
        {/* The line's controls and the confirm that stands in for them are the
            same cell of one grid, so the box is as wide as the wider of the two
            whichever is showing and the provider's name beside it never
            re-shapes as they trade places. Neither layer is mounted by the
            press either: one arriving from nothing would have no size to spring
            from. */}
        <span className="credential-actions">
          <span
            className="settings-actions credential-controls"
            data-drawn={String(!asking)}
            aria-hidden={asking}
            inert={asking}
          >
            {stored ? (
              <button
                type="button"
                ref={trash}
                className="icon-button credential-remove"
                disabled={busy}
                aria-label={`Delete the ${provider.displayName} ${credential}`}
                /* The ellipsis is the promise that it asks first. */
                title="Delete…"
                onClick={askToRemove}
              >
                <TrashIcon />
              </button>
            ) : null}
            {connected ? (
              <button
                type="button"
                ref={editControl}
                className="icon-button"
                disabled={beginBlocked}
                aria-label={editLabel}
                title={held ? HELD_TITLE : editTitle}
                onClick={beginEntry}
              >
                <PencilIcon />
              </button>
            ) : (
              /* Named for its provider like the icon buttons beside it: a list
                 of controls read on its own is otherwise two identical
                 Connects. */
              <button
                type="button"
                ref={editControl}
                className="quiet-button"
                disabled={beginBlocked}
                aria-label={`Connect ${provider.displayName}`}
                title={held ? HELD_TITLE : undefined}
                onClick={beginEntry}
              >
                Connect
              </button>
            )}
          </span>
          {/* Only ever drawn for a key Luke keeps, because that is the only key
              it has any business deleting. The group carries the question, so
              the two answers are read as answers rather than as a Cancel and a
              Delete that could belong to anything on the line. */}
          {stored ? (
            <fieldset
              className="settings-actions credential-confirm"
              aria-label={`Delete the ${provider.displayName} ${credential}?`}
              data-drawn={String(asking)}
              aria-hidden={!asking}
              inert={!asking}
              onKeyDown={(event) => {
                // Escape withdraws the question rather than closing the panel
                // the question was asked on — but only while it is still a
                // question. Once the delete has gone there is nothing here for
                // Escape to take back, so it is left to mean what it means
                // everywhere else in the panel.
                if (event.key !== "Escape" || !removalWithdrawable(removal)) return;
                event.stopPropagation();
                keepKey();
              }}
            >
              <button
                type="button"
                ref={keep}
                className="quiet-button"
                style={answerOrder(REMOVAL_ANSWER_INDEX.KEEP)}
                disabled={clearing}
                onClick={keepKey}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                style={answerOrder(REMOVAL_ANSWER_INDEX.DELETE)}
                disabled={clearing}
                onClick={() => void removeKey()}
              >
                {clearing ? "Deleting…" : "Delete"}
              </button>
            </fieldset>
          ) : null}
        </span>
      </div>

      {entry ? (
        /* Named as a group, because Cancel, Save, and the link to the
           provider's own page are the same three words on every row. */
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
              value={entry.draft}
              disabled={busy}
              onChange={(event) => control.change(event.target.value)}
              onFocus={() => {
                // The panel can be showing without its window being key, and a
                // field that cannot be typed into is worse than no field.
                window.sidecar.focusPanel();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isSubmittable(entry)) control.commit();
                // Escape closes the editor rather than the panel behind it.
                if (event.key === "Escape") {
                  event.stopPropagation();
                  control.cancel();
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
                disabled={busy}
                onClick={() => control.fetchKey()}
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
                onClick={() => control.cancel()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button"
                disabled={busy || !isSubmittable(entry)}
                onClick={() => control.commit()}
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
  control,
  panelOpen,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
}): React.JSX.Element {
  // Only a system Luke has actually asked, and been refused by, is reported as
  // one that cannot hold a key. Until then the rows stand as usual: a warning
  // about storage nobody has tried to use yet would be a guess.
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  return (
    <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
      <h2>
        <KeyIcon />
        Cloud API keys
      </h2>
      {CREDENTIAL_PROVIDER_LIST.map((provider) => (
        <ProviderCredential
          key={provider.id}
          provider={provider}
          source={settings.credentialSources[provider.id]}
          storageUnavailable={storageUnavailable}
          control={control}
          panelOpen={panelOpen}
        />
      ))}
      {/* True of every key here, so it is said once rather than per provider. */}
      <p className="settings-note">
        {storageUnavailable
          ? "This system offers no encrypted credential storage, so Luke will not store a key here."
          : "Luke reads only cloud workspaces you created, and never sends a prompt or any other change."}
      </p>
    </section>
  );
}

export function SettingsPanel({
  microphoneStatus,
  microphoneError,
  onRequestMicrophone,
  onAllowMicrophone,
  voiceAvailable,
  settings,
  credentials,
  panelOpen,
  onQuit,
  voiceHotkey,
  voiceHotkeyHeld,
}: SettingsPanelProps): React.JSX.Element {
  const microphone = microphoneAccessRow({
    voiceAvailable,
    allowed: settings?.microphoneAllowed ?? true,
    status: microphoneStatus,
  });
  return (
    <div
      className="settings"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SETTINGS)}
      aria-labelledby={panelTabId(PANEL_TAB.SETTINGS)}
    >
      {/* First, because it is how Luke is reached rather than what he can see.
          Shown rather than offered: the key is fixed for now, and a control
          that cannot change anything is worse than a plain statement of it. */}
      <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
        <h2>
          <KeyboardIcon />
          Keyboard shortcuts
        </h2>
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Talk to Luke</strong>
            {/* What the key actually does, which depends on whether it can
                report being let go of. Describing a hold to someone whose key
                can only toggle would leave them holding it and wondering. */}
            <small>
              {voiceHotkeyHeld
                ? "From any app: hold to talk, let go to send. Tap instead to keep it open."
                : "From any app: press to talk, again to send, again to interrupt."}
            </small>
          </span>
          <span className="shortcut-key">{voiceHotkey ?? "Unavailable"}</span>
        </div>
      </section>

      {settings ? (
        <CredentialsSection settings={settings} control={credentials} panelOpen={panelOpen} />
      ) : null}

      <section className="settings-section" style={{ "--row-index": 3 } as React.CSSProperties}>
        <h2>
          <ShieldIcon />
          Permissions
        </h2>
        {/* Access, not use. The talk key is what opens the microphone, so a
            button here could only ever repeat what the key already does — the
            line answers the one question it can: whether Luke is allowed. */}
        {/* Named and marked like a provider, because it is the same question in
            the same words: what Luke has been let at, and whether it is on.
            Access, not use — the talk key is what opens the microphone, so a
            control here could only repeat what the key already does. */}
        <div className="settings-row">
          <span className="settings-copy">
            <span className="settings-name">
              <MicrophoneIcon />
              <strong>Microphone</strong>
              {microphone.ready ? <CheckIcon /> : null}
            </span>
            <small>{microphone.detail}</small>
          </span>
          <span className="settings-actions">
            {microphone.offerRevoke ? (
              <button
                type="button"
                className="quiet-button"
                aria-label="Take the microphone back from Luke"
                onClick={() => onAllowMicrophone(false)}
              >
                Revoke
              </button>
            ) : null}
            {microphone.offerAccess ? (
              <button type="button" className="quiet-button" onClick={onRequestMicrophone}>
                Allow
              </button>
            ) : null}
          </span>
        </div>
        {microphoneError ? <p className="error-message">{microphoneError}</p> : null}
      </section>

      <button
        type="button"
        className="quit-button"
        style={{ "--row-index": 4 } as React.CSSProperties}
        onClick={onQuit}
      >
        <PowerIcon />
        Quit Luke
      </button>
    </div>
  );
}
