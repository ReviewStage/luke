import {
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
  type ProviderId,
  REALTIME_DEFAULTS,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED_LIST,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import { Fragment, useEffect, useRef, useState } from "react";
import type { AppSettings, CredentialSource, MicrophoneStatus } from "../shared/contracts";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../shared/contracts";
import type { CredentialProvider } from "../shared/credential-providers";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  INTEGRATION_PROVIDER_LIST,
} from "../shared/credential-providers";
import {
  capturedVoiceHotkey,
  DEFAULT_ASK_HOTKEYS,
  DEFAULT_STOP_HOTKEYS,
  DEFAULT_VOICE_HOTKEYS,
  VOICE_HOTKEY_CAPTURE,
  voiceHotkeyLabel,
} from "../shared/voice-hotkey";
import { workspaceAgentModels } from "../shared/workspace-agents";
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
import type { FeedbackEntryControl } from "./feedback-entry";
import { FeedbackSection } from "./feedback-panel";
import { Keycaps } from "./keycaps";
import { errandTargetProps } from "./luke-errand";
import { APP_SETTING_ID } from "./luke-guide";
import { microphoneAccessRow } from "./microphone-access";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  BackIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DisplayIcon,
  ExternalIcon,
  FolderIcon,
  KeyboardIcon,
  KeyIcon,
  PencilIcon,
  PlugIcon,
  PopUpIcon,
  PowerIcon,
  ResetIcon,
  ShieldIcon,
  SpeakerIcon,
  TrashIcon,
} from "./settings-icons";
import {
  pageExitMs,
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsSubview,
  type SettingsView,
  settingsNavRowId,
} from "./settings-views";

/** One provider the default-workspace row can offer, by id and display name. */
export interface WorkspaceProviderOption {
  id: string;
  name: string;
}

export interface SettingsPanelProps {
  /**
   * Which settings page is showing: the front page, or one of the pages a
   * front-page row opens. Held by the app rather than here because Escape
   * unwinds it and a credential entry has to survive a trip to the key slot
   * with its page intact.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphoneStatus: MicrophoneStatus;
  microphoneError?: string;
  /** Asks the system for access. Using the microphone is the talk key's job. */
  onRequestMicrophone: () => void;
  /** Opens the one place the system's own grant can be changed. */
  onOpenMicrophoneSettings: () => void;
  /** Whether there is anything to talk to, which is the microphone's only use. */
  voiceAvailable: boolean;
  settings?: AppSettings;
  /**
   * Turns the on-screen caption of Luke's speech on or off. The store answers
   * with why when it refuses, and the row is where that answer belongs.
   */
  onVoiceCaptionsChange: (enabled: boolean) => Promise<string | undefined>;
  /** Turns the quieting of Music and Spotify during a spoken exchange on or off. */
  onDuckOtherMediaChange: (enabled: boolean) => Promise<string | undefined>;
  /** Turns the macOS notification about a session that wants the user on or off. */
  onSessionNotificationsChange: (enabled: boolean) => Promise<string | undefined>;
  /** The one credential being entered anywhere, and everything that can be done to it. */
  credentials: CredentialEntryControl;
  /** The one note to the founders being written, and everything that can be done to it. */
  feedback: FeedbackEntryControl;
  /** Chooses the voice Luke speaks with, from the set fixed by this build. */
  onVoiceChange: (voice: RealtimeVoice) => void;
  /** Chooses the pace Luke speaks at, from the set fixed by this build. */
  onVoiceSpeedChange: (speed: RealtimeVoiceSpeed) => void;
  /**
   * True while the panel is the shape on screen. A field can only hold the
   * caret then: everything here sits in an inert stage the rest of the time,
   * and an entry can outlast the panel it was started in.
   */
  panelOpen: boolean;
  /**
   * Shows or hides the menu bar status item. The store answers with why when it
   * refuses, and the row is where that answer belongs.
   */
  onShowInMenuBarChange: (show: boolean) => Promise<string | undefined>;
  /**
   * Shows or hides the Dock icon. The store answers with why when it refuses,
   * and the row is where that answer belongs.
   */
  onShowInDockChange: (show: boolean) => Promise<string | undefined>;
  /**
   * Stands Luke on every connected display, or brings him back to the main
   * one alone. The store answers with why when it refuses, and the row is
   * where that answer belongs.
   */
  onShowOnAllDisplaysChange: (show: boolean) => Promise<string | undefined>;
  /** Chooses how Luke stands on a display without a camera housing. */
  onFormFactorChange: (formFactor: PanelFormFactor) => Promise<string | undefined>;
  /**
   * The providers the default-workspace row may offer: the ones currently
   * offering projects, plus a stored default that is not — a choice the row
   * cannot show is one that can be neither seen nor cleared.
   */
  workspaceProviders: readonly WorkspaceProviderOption[];
  /**
   * Chooses the provider a conversational ask creates a workspace in when the
   * ask names none, or returns to asking each time when omitted. The store
   * answers with why when it refuses, and the row is where that answer
   * belongs.
   */
  onDefaultWorkspaceProviderChange: (
    providerId: ProviderId | undefined,
  ) => Promise<string | undefined>;
  /**
   * Chooses the agent kind and model one provider starts new workspaces with,
   * or returns to that provider's own defaults when omitted. The store
   * answers with why when it refuses, and the row is where that answer
   * belongs.
   */
  onWorkspaceAgentDefaultChange: (
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ) => Promise<string | undefined>;
  onQuit: () => void;
  /**
   * The talk key as registered, as an accelerator: the row draws it as its
   * separate keys and says it whole in the labels its buttons carry.
   */
  voiceHotkey?: string;
  /** Whether that key can be held, which is what the row has to describe. */
  voiceHotkeyHeld: boolean;
  /**
   * Moves the talk key to a recorded chord, or back to the defaults when
   * omitted. The store answers with why when it refuses, and the row is where
   * that answer belongs.
   */
  onVoiceHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  /** The ask key as registered, an accelerator on the talk key's terms. */
  askHotkey?: string;
  /**
   * Moves the ask key to a recorded chord, or back to the defaults when
   * omitted, on the talk key's terms: the store answers with why when it
   * refuses, and the row is where that answer belongs.
   */
  onAskHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  /** The stop key as registered, an accelerator on the talk key's terms. */
  stopHotkey?: string;
  /**
   * Moves the stop key to a recorded chord, or back to the default when
   * omitted, on the other rows' terms: the store answers with why when it
   * refuses, and the row is where that answer belongs.
   */
  onStopHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  /**
   * Whether a recording control has the keyboard. While one does, no Luke
   * key may act on its own press: the chord arriving is an entry, not an ask.
   */
  onShortcutCapture: (capturing: boolean) => void;
}

/* What nothing else on the line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
const CREDENTIAL_STATUS: Partial<Record<CredentialSource, string>> = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
};

/* Why a row that could otherwise be connected is not offering to be. */
const HELD_TITLE = "Finish the one you are entering first";

/* The default-workspace row's word for no default at all. An empty value
   rather than a member of the provider set, so no provider id can collide
   with it. */
const ASK_EACH_TIME = "";

/* The agent row's word for no choice at all: the provider's own default. */
const PROVIDER_DEFAULT_VALUE = "";

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

      {/* What connecting this one buys, for a provider whose section cannot
          say it once for every row. */}
      {provider.description ? <p className="settings-note">{provider.description}</p> : null}

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

/* The API names its voices in lowercase; on a control they read as names. The
   default carries its status into the menu, so returning to it never needs the
   README or a memory of what shipped. */
function voiceOptionLabel(voice: RealtimeVoice): string {
  const name = voice.charAt(0).toUpperCase() + voice.slice(1);
  return voice === REALTIME_DEFAULTS.VOICE ? `${name} (default)` : name;
}

/* A pace reads as a rate multiple, the way every player writes one. The
   natural rate carries its status into the menu for the same reason the
   default voice does. */
function speedOptionLabel(speed: RealtimeVoiceSpeed): string {
  return speed === REALTIME_DEFAULTS.SPEED ? `${speed}× (default)` : `${speed}×`;
}

/* The forms read as names, and the bubble carries its status into the menu the
   way the default voice does. */
function formFactorOptionLabel(formFactor: PanelFormFactor): string {
  const name = formFactor.charAt(0).toUpperCase() + formFactor.slice(1);
  return formFactor === DEFAULT_PANEL_FORM_FACTOR ? `${name} (default)` : name;
}

/* Why every Connect in a key-holding section is refusing, said once per
   section: a disabled control with no words beside it reads as broken. */
const STORAGE_UNAVAILABLE_NOTE =
  "This system offers no encrypted credential storage, so Luke will not store a key here.";

/**
 * Which model — and, where its agent takes one, which effort — this provider
 * starts new workspaces with, drawn as sub-rows of its credential line
 * because the choice means nothing until the key above it connects. The
 * options are the build's documented table for the provider, worded as the
 * names people know the models by; the first is no choice at all — the
 * provider's own default, which is the state every install begins in. The
 * effort row exists only while a model whose agent documents effort levels is
 * chosen, so nothing offers a level nowhere can honour.
 */
function WorkspaceAgentRow({
  provider,
  providerId,
  selection,
  onChange,
}: {
  provider: CredentialProvider;
  providerId: ProviderId;
  selection?: WorkspaceAgentSelection;
  onChange: (
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ) => Promise<string | undefined>;
}): React.JSX.Element {
  // The change is a round trip through the settings file, so the selects rest
  // until the store has answered rather than claiming a state it may not get.
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  // The table's models flattened in its own order, each remembering its
  // agent's effort levels, so the select's indices are as stable as the build
  // that documents them.
  const choices = workspaceAgentModels(providerId).flatMap((entry) =>
    entry.models.map((model) => ({
      agent: entry.agent,
      model: model.id,
      label: model.label,
      efforts: entry.efforts,
    })),
  );
  const chosenIndex = choices.findIndex(
    (choice) => choice.agent === selection?.agent && choice.model === selection?.model,
  );
  const chosen = chosenIndex >= 0 ? choices[chosenIndex] : undefined;
  const choose = async (next: WorkspaceAgentSelection | undefined) => {
    setBusy(true);
    setRejection(await onChange(providerId, next));
    setBusy(false);
  };
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>New agents run</strong>
          {/* Scope, because this row must not claim the provider's own app:
              only what Luke itself creates — a workspace, or another agent in
              one — starts on this choice. */}
          <small>For workspaces and agents created through Luke.</small>
        </span>
        <span className="voice-select">
          <select
            aria-label={`The model new ${provider.displayName} workspaces run`}
            value={chosenIndex >= 0 ? String(chosenIndex) : PROVIDER_DEFAULT_VALUE}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value;
              if (next === PROVIDER_DEFAULT_VALUE) {
                void choose(undefined);
                return;
              }
              // The set is the one this row offered, so anything else arriving
              // out of the select is a broken control rather than a choice.
              const choice = choices[Number(next)];
              if (!choice) return;
              // A chosen effort survives a model change only where the new
              // agent documents the same level; anywhere else it returns to
              // the provider's default rather than riding somewhere unlisted.
              const effort =
                selection?.effort && choice.efforts.includes(selection.effort)
                  ? selection.effort
                  : undefined;
              void choose({
                agent: choice.agent,
                model: choice.model,
                ...(effort ? { effort } : {}),
              });
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            <option value={PROVIDER_DEFAULT_VALUE}>{`${provider.displayName}'s default`}</option>
            {choices.map((choice, index) => (
              // Indexed on purpose: the list is fixed by the build, and the
              // index is the same word the select's value speaks.
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is build-fixed
              <option key={index} value={String(index)}>
                {choice.label}
              </option>
            ))}
          </select>
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      {chosen && chosen.efforts.length > 0 ? (
        <div className="settings-row">
          <span className="settings-copy">
            <strong>Effort</strong>
            <small>How hard the chosen model thinks.</small>
          </span>
          <span className="voice-select">
            <select
              aria-label={`The effort new ${provider.displayName} agents think at`}
              value={
                selection?.effort && chosen.efforts.includes(selection.effort)
                  ? selection.effort
                  : PROVIDER_DEFAULT_VALUE
              }
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                // Held to the chosen agent's own documented levels, so the
                // stored selection is always one whole the table lists.
                const effort =
                  next !== PROVIDER_DEFAULT_VALUE && chosen.efforts.includes(next)
                    ? next
                    : undefined;
                void choose({
                  agent: chosen.agent,
                  model: chosen.model,
                  ...(effort ? { effort } : {}),
                });
              }}
              onFocus={() => {
                // The panel can be showing without its window being key, and
                // a menu opened then would drop its first choice.
                window.sidecar.focusPanel();
              }}
            >
              <option value={PROVIDER_DEFAULT_VALUE}>{`${provider.displayName}'s default`}</option>
              {chosen.efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
            <span className="voice-select-badge" aria-hidden="true">
              <PopUpIcon />
            </span>
          </span>
        </div>
      ) : null}
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </>
  );
}

/**
 * Every agent provider that can hold a key, one line each. A provider is
 * listed whether or not it has one, because the list is how you learn which
 * services Luke can watch at all.
 */
function CredentialsSection({
  settings,
  control,
  panelOpen,
  onWorkspaceAgentDefaultChange,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
  onWorkspaceAgentDefaultChange: (
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ) => Promise<string | undefined>;
}): React.JSX.Element {
  // Only a system Luke has actually asked, and been refused by, is reported as
  // one that cannot hold a key. Until then the rows stand as usual: a warning
  // about storage nobody has tried to use yet would be a guess.
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  return (
    <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
      <h2>
        <KeyIcon />
        Cloud Agent API keys
      </h2>
      {CLOUD_AGENT_PROVIDER_LIST.map((provider) => {
        // The agent row belongs to providers the build documents a table for,
        // and only while connected: disconnected, there is nothing the choice
        // could apply to, and the line above already says what to do first.
        const agentRow =
          isProviderId(provider.id) &&
          settings.credentialSources[provider.id] !== CREDENTIAL_SOURCE.NONE &&
          workspaceAgentModels(provider.id).length > 0
            ? provider.id
            : undefined;
        return (
          <Fragment key={provider.id}>
            <ProviderCredential
              provider={provider}
              source={settings.credentialSources[provider.id]}
              storageUnavailable={storageUnavailable}
              control={control}
              panelOpen={panelOpen}
            />
            {agentRow ? (
              <WorkspaceAgentRow
                provider={provider}
                providerId={agentRow}
                {...(settings.workspaceAgentDefaults?.[agentRow]
                  ? { selection: settings.workspaceAgentDefaults[agentRow] }
                  : {})}
                onChange={onWorkspaceAgentDefaultChange}
              />
            ) : null}
          </Fragment>
        );
      })}
      {/* True of every key here, so it is said once rather than per provider. */}
      <p className="settings-note">
        {storageUnavailable
          ? STORAGE_UNAVAILABLE_NOTE
          : "Luke reads only cloud workspaces you created, and never sends a prompt or any other change."}
      </p>
    </section>
  );
}

/**
 * The services Luke connects to that are not agents: today, the issue tracker.
 * Each row is the same credential line an agent provider gets — same entry,
 * same trash, same environment fallback — with its own one-line answer to what
 * connecting it buys, because the rows here do not all buy the same thing.
 */
function IntegrationsSection({
  settings,
  control,
  panelOpen,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
}): React.JSX.Element {
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  return (
    <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
      <h2>
        <PlugIcon />
        Integrations
      </h2>
      {INTEGRATION_PROVIDER_LIST.map((provider) => (
        <ProviderCredential
          key={provider.id}
          provider={provider}
          source={settings.credentialSources[provider.id]}
          storageUnavailable={storageUnavailable}
          control={control}
          panelOpen={panelOpen}
        />
      ))}
      {/* The same refusal the agents' section explains: a Connect stilled by
          missing storage needs its why in this section too. */}
      {storageUnavailable ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}

/**
 * What each page is called on the front page and at its own head. One table,
 * because the row that opens a page and the header that leaves it must never
 * disagree about its name. The name and the glyph are the whole row: what a
 * page holds is one press away, and a sentence under every name made the
 * front page read as prose rather than as places to go.
 */
const SETTINGS_PAGE: Record<SettingsSubview, { title: string; icon: React.JSX.Element }> = {
  [SETTINGS_VIEW.VOICE]: {
    title: "Voice",
    icon: <SpeakerIcon />,
  },
  [SETTINGS_VIEW.APPEARANCE]: {
    title: "Appearance",
    icon: <DisplayIcon />,
  },
  [SETTINGS_VIEW.SHORTCUTS]: {
    title: "Keyboard shortcuts",
    icon: <KeyboardIcon />,
  },
  [SETTINGS_VIEW.CONNECTIONS]: {
    title: "Connections",
    icon: <PlugIcon />,
  },
};

/**
 * One front-page row per page: its glyph, its name, and the chevron that
 * promises a page rather than a control. The row is the whole press target,
 * the way a macOS settings row is.
 */
function SettingsNavRow({
  view,
  onOpen,
}: {
  view: SettingsSubview;
  onOpen: (view: SettingsSubview) => void;
}): React.JSX.Element {
  const page = SETTINGS_PAGE[view];
  return (
    <button
      type="button"
      id={settingsNavRowId(view)}
      className="settings-nav"
      onClick={() => onOpen(view)}
    >
      <span className="settings-nav-mark" aria-hidden="true">
        {page.icon}
      </span>
      <span className="settings-copy">
        <strong>{page.title}</strong>
      </span>
      <ChevronIcon />
    </button>
  );
}

/**
 * A page's head: the way back beside the page's own name. The back button
 * returns to the front page and nothing else — a page holds no unsaved state
 * of its own, so leaving one never needs a warning.
 */
function SettingsPageHeader({
  view,
  onBack,
  backControl,
}: {
  view: SettingsSubview;
  onBack: () => void;
  backControl: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  return (
    <div className="settings-header" style={{ "--row-index": 0 } as React.CSSProperties}>
      <button
        type="button"
        ref={backControl}
        className="icon-button"
        aria-label="Back to Settings"
        title="Back"
        onClick={onBack}
      >
        <BackIcon />
      </button>
      <strong>{SETTINGS_PAGE[view].title}</strong>
    </div>
  );
}

/**
 * How Luke sounds and what he says unprompted. The voice he speaks with comes
 * first — it is what Luke *is* to the ear — offered the way macOS offers one
 * value from a small fixed set: a pop-up button whose closed face is drawn
 * here and whose open menu is the system's, which also lets it escape a
 * window sized to the panel rather than being clipped by it.
 */
function VoiceSection({
  voice,
  onVoiceChange,
  speed,
  onVoiceSpeedChange,
  captions,
  onVoiceCaptionsChange,
  ducking,
  onDuckOtherMediaChange,
  notifications,
  onSessionNotificationsChange,
}: {
  voice: RealtimeVoice;
  onVoiceChange: (voice: RealtimeVoice) => void;
  speed: RealtimeVoiceSpeed;
  onVoiceSpeedChange: (speed: RealtimeVoiceSpeed) => void;
  captions: boolean;
  onVoiceCaptionsChange: (enabled: boolean) => Promise<string | undefined>;
  ducking: boolean;
  onDuckOtherMediaChange: (enabled: boolean) => Promise<string | undefined>;
  notifications: boolean;
  onSessionNotificationsChange: (enabled: boolean) => Promise<string | undefined>;
}): React.JSX.Element {
  // Each change is a round trip through the settings file, so each switch
  // rests on its own flag until the store has answered rather than claiming a
  // state it may not get — one save in flight must not still another switch.
  // The rejection line is shared: it reports the last answer, whichever row
  // asked.
  const [rejection, setRejection] = useState<string>();
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const toggleCaptions = async () => {
    setCaptionsBusy(true);
    setRejection(await onVoiceCaptionsChange(!captions));
    setCaptionsBusy(false);
  };
  const [duckBusy, setDuckBusy] = useState(false);
  const toggleDucking = async () => {
    setDuckBusy(true);
    setRejection(await onDuckOtherMediaChange(!ducking));
    setDuckBusy(false);
  };
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const toggleNotifications = async () => {
    setNotificationsBusy(true);
    setRejection(await onSessionNotificationsChange(!notifications));
    setNotificationsBusy(false);
  };
  return (
    <section
      className="settings-section settings-plain"
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Voice</strong>
          {/* When it lands, because a control that seems not to act invites a
              second press. The API locks a session's voice once the model has
              spoken, so a call already open is quietly reopened in the new
              voice — heard right away, at the price of the conversation
              starting afresh. */}
          <small>How Luke sounds; a conversation under way starts afresh.</small>
        </span>
        {/* Every control a spoken change can reach carries the id that change
            names it by, so an errand lands on the control itself rather than
            somewhere near it. The control is marked rather than the row — the
            switch is what moved, and the row is only what explains it — and,
            here, the `select` rather than the box positioning it: the errand
            outlines what it lands on, and only the `select` is drawn with the
            corners that outline has to take. */}
        <span className="voice-select">
          <select
            {...errandTargetProps(APP_SETTING_ID.VOICE)}
            aria-label="Voice"
            value={voice}
            onChange={(event) => {
              // The set is fixed by this build, so anything else arriving out
              // of a select is a broken control rather than a choice.
              const next = event.target.value;
              if (isRealtimeVoice(next)) onVoiceChange(next);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            {REALTIME_VOICE_LIST.map((candidate) => (
              <option key={candidate} value={candidate}>
                {voiceOptionLabel(candidate)}
              </option>
            ))}
          </select>
          {/* Drawn over the select, the way macOS badges a pop-up button; the
              select alone answers the pointer. */}
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Speed</strong>
          {/* Unlike the voice, a pace change rides a session update onto the
              call already open, so nothing starts over. */}
          <small>How fast Luke talks, from his next reply on.</small>
        </span>
        <span className="voice-select">
          <select
            {...errandTargetProps(APP_SETTING_ID.VOICE_SPEED)}
            aria-label="Speed"
            value={speed}
            onChange={(event) => {
              // A select serializes its value to a string, so the number is
              // read back out and held to the set fixed by this build.
              const next = Number(event.target.value);
              if (isRealtimeVoiceSpeed(next)) onVoiceSpeedChange(next);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            {REALTIME_VOICE_SPEED_LIST.map((candidate) => (
              <option key={candidate} value={candidate}>
                {speedOptionLabel(candidate)}
              </option>
            ))}
          </select>
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Captions</strong>
          {/* Off by default: the voice experience ships as sound, so the words
              are chosen rather than discovered. What is *not* kept is the one
              thing worth a line — the caption is the reply being said. The
              muted exception is stated because it overrides this very switch:
              a reply the Mac would swallow is captioned whatever it says. */}
          <small>
            Luke&rsquo;s words on screen as he speaks, and on their own while your Mac is muted.
            Nothing is kept.
          </small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={captions}
          aria-label="Caption Luke's speech on screen"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.VOICE_CAPTIONS)}
          disabled={captionsBusy}
          onClick={() => void toggleCaptions()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Quiet Music and Spotify</strong>
          {/* Named by app rather than as "other media": these two are the ones
              macOS lets Luke turn down, and a switch claiming more would claim
              a capability the system does not grant. The first duck is also
              when macOS asks whether Luke may speak to each player at all. */}
          <small>Their volume dips while you and Luke are talking, and returns after.</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={ducking}
          aria-label="Quiet Music and Spotify while talking with Luke"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.DUCK_OTHER_MEDIA)}
          disabled={duckBusy}
          onClick={() => void toggleDucking()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Announce when a session needs you</strong>
          {/* The three edges by name, because the switch governs exactly these
              and the panel already shows everything else: the voice is for the
              developer whose eyes are on another screen entirely. No
              conversation needs to be open — Luke opens a speak-only call for
              the sentence, and the microphone stays untouched. */}
          <small>
            Luke says it out loud when an agent starts waiting on you, hits an error, or finishes.
          </small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={notifications}
          aria-label="Announce when a session needs you"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.SESSION_NOTIFICATIONS)}
          disabled={notificationsBusy}
          onClick={() => void toggleNotifications()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </section>
  );
}

/**
 * Where Luke stands and how he is drawn: the menu bar and the Dock as second
 * doors — Settings and Quit live in this panel, so neither is the only one —
 * every display or just the main one, and the form he takes on a display
 * without a housing. Switches and one pop-up, because nothing rides on any
 * answer here.
 */
function AppearanceSection({
  shown,
  onShowInMenuBarChange,
  dockShown,
  onShowInDockChange,
  allDisplays,
  onShowOnAllDisplaysChange,
  formFactor,
  onFormFactorChange,
}: {
  shown: boolean;
  onShowInMenuBarChange: (show: boolean) => Promise<string | undefined>;
  dockShown: boolean;
  onShowInDockChange: (show: boolean) => Promise<string | undefined>;
  allDisplays: boolean;
  onShowOnAllDisplaysChange: (show: boolean) => Promise<string | undefined>;
  formFactor: PanelFormFactor;
  onFormFactorChange: (formFactor: PanelFormFactor) => Promise<string | undefined>;
}): React.JSX.Element {
  // The same resting discipline the Voice page's switches keep: each change is
  // its own round trip, each control rests on its own flag, and the rejection
  // line reports the last answer whichever row asked.
  const [rejection, setRejection] = useState<string>();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    setRejection(await onShowInMenuBarChange(!shown));
    setBusy(false);
  };
  const [dockBusy, setDockBusy] = useState(false);
  const toggleDock = async () => {
    setDockBusy(true);
    setRejection(await onShowInDockChange(!dockShown));
    setDockBusy(false);
  };
  const [displayBusy, setDisplayBusy] = useState(false);
  const toggleAllDisplays = async () => {
    setDisplayBusy(true);
    setRejection(await onShowOnAllDisplaysChange(!allDisplays));
    setDisplayBusy(false);
  };
  const [formBusy, setFormBusy] = useState(false);
  const chooseFormFactor = async (nextFormFactor: PanelFormFactor) => {
    setFormBusy(true);
    setRejection(await onFormFactorChange(nextFormFactor));
    setFormBusy(false);
  };
  return (
    <section
      className="settings-section settings-plain"
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Show Luke in the menu bar</strong>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-label="Show Luke in the menu bar"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.SHOW_IN_MENU_BAR)}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Show Luke in the Dock</strong>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={dockShown}
          aria-label="Show Luke in the Dock"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.SHOW_IN_DOCK)}
          disabled={dockBusy}
          onClick={() => void toggleDock()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Show Luke on all displays</strong>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={allDisplays}
          aria-label="Show Luke on all displays"
          className="switch"
          {...errandTargetProps(APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS)}
          disabled={displayBusy}
          onClick={() => void toggleAllDisplays()}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Form factor</strong>
          {/* Where the choice applies, because on a notched display this row
              visibly does nothing: the real housing always wins. */}
          <small>On displays without a notch.</small>
        </span>
        <span className="voice-select">
          <select
            {...errandTargetProps(APP_SETTING_ID.FORM_FACTOR)}
            aria-label="Form factor"
            value={formFactor}
            disabled={formBusy}
            onChange={(event) => {
              // The set is fixed by this build, so anything else arriving out
              // of a select is a broken control rather than a choice.
              const next = event.target.value;
              if (isPanelFormFactor(next)) void chooseFormFactor(next);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            {PANEL_FORM_FACTOR_LIST.map((candidate) => (
              <option key={candidate} value={candidate}>
                {formFactorOptionLabel(candidate)}
              </option>
            ))}
          </select>
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </section>
  );
}

/**
 * What a conversational ask creates and where, beside the connections it
 * creates through: its own named group on the Connections page, because the
 * default is about every provider at once rather than any one row.
 */
function WorkspacesSection({
  defaultWorkspaceProvider,
  workspaceProviders,
  onDefaultWorkspaceProviderChange,
}: {
  defaultWorkspaceProvider?: ProviderId;
  workspaceProviders: readonly WorkspaceProviderOption[];
  onDefaultWorkspaceProviderChange: (
    providerId: ProviderId | undefined,
  ) => Promise<string | undefined>;
}): React.JSX.Element {
  // The same resting discipline every settings control keeps: the change is a
  // round trip through the settings file, so the select rests until the store
  // has answered rather than claiming a choice it may not get.
  const [rejection, setRejection] = useState<string>();
  const [defaultProviderBusy, setDefaultProviderBusy] = useState(false);
  const chooseDefaultProvider = async (providerId: ProviderId | undefined) => {
    setDefaultProviderBusy(true);
    setRejection(await onDefaultWorkspaceProviderChange(providerId));
    setDefaultProviderBusy(false);
  };
  return (
    <section className="settings-section" style={{ "--row-index": 3 } as React.CSSProperties}>
      <h2>
        <FolderIcon />
        Workspaces
      </h2>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Default workspace provider</strong>
          {/* How the default comes to exist, because the row is most often
              read before any choice was made here: the first workspace
              created in conversation fills it in, and this select is where
              that choice is seen, changed, or returned to asking. */}
          <small>
            Where an ask that names no provider creates a workspace. Your first creation sets it.
          </small>
        </span>
        <span className="voice-select">
          <select
            aria-label="Default workspace provider"
            value={defaultWorkspaceProvider ?? ASK_EACH_TIME}
            disabled={defaultProviderBusy}
            onChange={(event) => {
              const next = event.target.value;
              if (next === ASK_EACH_TIME) {
                void chooseDefaultProvider(undefined);
                return;
              }
              // The set is the one this row offered, so anything else arriving
              // out of the select is a broken control rather than a choice.
              if (isProviderId(next) && workspaceProviders.some((option) => option.id === next)) {
                void chooseDefaultProvider(next);
              }
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            <option value={ASK_EACH_TIME}>Ask each time</option>
            {workspaceProviders.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </section>
  );
}

/* What a talk key may be: offered the moment recording starts, and restated
   in the error line for the keystroke that was not one. */
const SHORTCUT_HINT = "Hold ⌃, ⌥ or ⌘ — ⇧ may join — and press a letter or Space.";

/**
 * How Luke is reached rather than what he can see. The chord is drawn as the
 * keys it is — one cap each, the way a keyboard has them — and is a statement
 * rather than a control; the pencil beside it is what moves it. Pressing it
 * starts a recording — what a chord may be is shown under the controls at
 * once, the next whole chord is stored and registered at once, and Escape (or
 * the pencil, now a cross) keeps the key that was already there. Recording
 * happens in that focused button rather than anywhere global, so a keystroke
 * can only become a shortcut while the user is visibly holding the control
 * that asks for one.
 *
 * Reset stands beside the chip only while a chosen chord is stored and no
 * recording is underway: until a chord is stored it could only offer to
 * change nothing, and during a recording the chord it would return to is
 * exactly what typing nothing already keeps. What the row shows is the
 * key as registered, not as stored — the two differ when another app owns the
 * chosen chord, and a row that showed the stored one would name a key that
 * answers nothing.
 */
function ShortcutRow({
  title,
  detail,
  shown,
  chosen,
  defaultKey,
  onChange,
  onCapture,
}: {
  title: string;
  detail: string;
  /** The accelerator as registered, absent when no candidate answered. */
  shown?: string | undefined;
  /** Whether a chosen chord is stored, which is what Reset has to undo. */
  chosen: boolean;
  /** The first default, which is what the reset offers to return to. */
  defaultKey: string;
  onChange: (accelerator: string | undefined) => Promise<string | undefined>;
  onCapture: (capturing: boolean) => void;
}): React.JSX.Element {
  const [recording, setRecording] = useState(false);
  // The change is a round trip through the settings file and the system's
  // registrar, so the controls rest until the store has answered rather than
  // claiming a chord they may not get.
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();

  // Both Luke keys stay registered while a chord is recorded — the recording
  // ends by replacing one — so pressing a current chord mid-recording would
  // open the microphone, or summon the composer, under the very field being
  // typed into. The app is told when a field has the keyboard so it can hold
  // that press, and the unmount arm covers the panel closing over an open
  // recording.
  useEffect(() => {
    onCapture(recording);
    return () => onCapture(false);
  }, [recording, onCapture]);

  const apply = async (accelerator: string | undefined) => {
    setBusy(true);
    setRejection(await onChange(accelerator));
    setBusy(false);
  };

  return (
    <div className="settings-row">
      <span className="settings-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="shortcut-controls">
        <span className="settings-actions">
          {/* The chord as its own keys while there is one to press, and a
              sentence when there is not: "Type a shortcut…" and "Unavailable"
              are things being said about the key, not keys to draw. */}
          {recording ? (
            <span className="shortcut-state" data-recording="true">
              Type a shortcut…
            </span>
          ) : shown ? (
            <Keycaps className="shortcut-chord" accelerator={shown} />
          ) : (
            <span className="shortcut-state">Unavailable</span>
          )}
          {chosen && !recording ? (
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={`Reset the shortcut to ${voiceHotkeyLabel(defaultKey)}`}
              title={`Back to ${voiceHotkeyLabel(defaultKey)}`}
              onClick={() => void apply(undefined)}
            >
              <ResetIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={
              recording
                ? "Type the new shortcut, or press Escape to keep this one"
                : `Change the shortcut for ${title}`
            }
            title={recording ? "Cancel" : "Change…"}
            onClick={() => {
              if (recording) {
                setRecording(false);
                return;
              }
              setRejection(undefined);
              setRecording(true);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // recording no keystroke can reach would read as a dead control.
              window.sidecar.focusPanel();
            }}
            // Focus leaving takes the recording with it: whatever was pressed
            // instead is its own act, not a half-formed chord left armed.
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              // A key that repeats is being held through the chord, not
              // pressed as one; only its first arrival is read.
              if (!recording || event.repeat) return;
              // Nothing typed here is typing: not a Space press on the button,
              // and not the panel's own Escape-to-close behind it.
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                setRecording(false);
                return;
              }
              const read = capturedVoiceHotkey(event);
              if (read.outcome === VOICE_HOTKEY_CAPTURE.PENDING) return;
              if (read.outcome === VOICE_HOTKEY_CAPTURE.REFUSED) {
                setRejection(SHORTCUT_HINT);
                return;
              }
              setRejection(undefined);
              setRecording(false);
              void apply(read.accelerator);
            }}
          >
            {recording ? <CloseIcon /> : <PencilIcon />}
          </button>
        </span>
        {rejection ? (
          <p className="error-message">{rejection}</p>
        ) : recording ? (
          <p className="shortcut-hint">{SHORTCUT_HINT}</p>
        ) : null}
      </span>
    </div>
  );
}

function ShortcutSection({
  voiceHotkey,
  voiceHotkeyHeld,
  chosen,
  onVoiceHotkeyChange,
  askHotkey,
  askChosen,
  onAskHotkeyChange,
  stopHotkey,
  stopChosen,
  onStopHotkeyChange,
  onShortcutCapture,
}: {
  voiceHotkey?: string | undefined;
  voiceHotkeyHeld: boolean;
  chosen: boolean;
  onVoiceHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  askHotkey?: string | undefined;
  askChosen: boolean;
  onAskHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  stopHotkey?: string | undefined;
  stopChosen: boolean;
  onStopHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  onShortcutCapture: (capturing: boolean) => void;
}): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
      <ShortcutRow
        title="Talk to Luke"
        // What the key actually does, which depends on whether it can report
        // being let go of. Describing a hold to someone whose key can only
        // toggle would leave them holding it and wondering.
        detail={
          voiceHotkeyHeld
            ? "Hold to talk, let go to send. Tap instead to keep it open."
            : "Press to talk, again to send, again to interrupt."
        }
        {...(voiceHotkey ? { shown: voiceHotkey } : {})}
        chosen={chosen}
        defaultKey={DEFAULT_VOICE_HOTKEYS[0] ?? ""}
        onChange={onVoiceHotkeyChange}
        onCapture={onShortcutCapture}
      />
      <ShortcutRow
        title="Ask Luke"
        detail="Press to type to Luke from any app. The same key puts it away."
        {...(askHotkey ? { shown: askHotkey } : {})}
        chosen={askChosen}
        defaultKey={DEFAULT_ASK_HOTKEYS[0] ?? ""}
        onChange={onAskHotkeyChange}
        onCapture={onShortcutCapture}
      />
      <ShortcutRow
        title="Stop Luke"
        detail="Press to cut off a reply mid-sentence, from any app. Escape does the same here."
        {...(stopHotkey ? { shown: stopHotkey } : {})}
        chosen={stopChosen}
        defaultKey={DEFAULT_STOP_HOTKEYS[0] ?? ""}
        onChange={onStopHotkeyChange}
        onCapture={onShortcutCapture}
      />
    </section>
  );
}

export function SettingsPanel({
  view,
  onViewChange,
  microphoneStatus,
  microphoneError,
  onRequestMicrophone,
  onOpenMicrophoneSettings,
  voiceAvailable,
  settings,
  onVoiceCaptionsChange,
  onDuckOtherMediaChange,
  onSessionNotificationsChange,
  credentials,
  feedback,
  onVoiceChange,
  onVoiceSpeedChange,
  panelOpen,
  onShowInMenuBarChange,
  onShowInDockChange,
  onShowOnAllDisplaysChange,
  onFormFactorChange,
  workspaceProviders,
  onDefaultWorkspaceProviderChange,
  onWorkspaceAgentDefaultChange,
  onQuit,
  voiceHotkey,
  voiceHotkeyHeld,
  onVoiceHotkeyChange,
  askHotkey,
  onAskHotkeyChange,
  stopHotkey,
  onStopHotkeyChange,
  onShortcutCapture,
}: SettingsPanelProps): React.JSX.Element {
  const microphone = microphoneAccessRow({ voiceAvailable, status: microphoneStatus });
  // The page as drawn, trailing the page as asked: turning one is a leave and
  // then an arrival, and the leaving page must be held mounted through its own
  // exit — the surface never resizes out from under something still drawn.
  // The swap is timed off the token the stylesheet fades with, read live off
  // the element: a capture run and reduced motion zero it, and the drawn page
  // has to swap as fast as the fade they stilled.
  const box = useRef<HTMLDivElement | null>(null);
  const [drawnView, setDrawnView] = useState(view);
  // Whether a page has turned since this panel mounted, which is what scopes
  // the arrival animation: the tab's first draw belongs to the panel-arrival
  // transition alone.
  const [turned, setTurned] = useState(false);
  const leaving = drawnView !== view;
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      setDrawnView(view);
      setTurned(true);
    }, pageExitMs(box.current));
    return () => window.clearTimeout(timer);
  }, [leaving, view]);
  // Moving between pages moves the keyboard with it: into a page, onto its
  // back button; back out, onto the row that opened the page just left. Keyed
  // to the drawn page, because the control being reached for only exists once
  // the new page is mounted. Only while the panel is the shape on screen — a
  // view reset behind a closed panel is housekeeping, and reaching into an
  // inert stage would find nothing focusable anyway.
  const backControl = useRef<HTMLButtonElement | null>(null);
  const heldView = useRef(drawnView);
  useEffect(() => {
    const previous = heldView.current;
    heldView.current = drawnView;
    if (previous === drawnView || !panelOpen) return;
    if (drawnView === SETTINGS_VIEW.ROOT) {
      if (previous !== SETTINGS_VIEW.ROOT) {
        document.getElementById(settingsNavRowId(previous))?.focus();
      }
      return;
    }
    backControl.current?.focus();
  }, [drawnView, panelOpen]);
  return (
    <div
      ref={box}
      className="settings"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SETTINGS)}
      aria-labelledby={panelTabId(PANEL_TAB.SETTINGS)}
      data-page-leaving={String(leaving)}
      data-page-turned={String(turned)}
    >
      {drawnView !== SETTINGS_VIEW.ROOT ? (
        <SettingsPageHeader
          view={drawnView}
          onBack={() => onViewChange(SETTINGS_VIEW.ROOT)}
          backControl={backControl}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.ROOT ? (
        /* The front page: one row per page, then the sections that answer at
           a glance — what Luke is allowed, the way to the founders, and the
           way out. */
        <section
          className="settings-section settings-index"
          style={{ "--row-index": 1 } as React.CSSProperties}
        >
          {SETTINGS_SUBVIEW_LIST.map((subview) => (
            <SettingsNavRow key={subview} view={subview} onOpen={onViewChange} />
          ))}
        </section>
      ) : null}

      {drawnView === SETTINGS_VIEW.VOICE && settings ? (
        <VoiceSection
          voice={settings.voice}
          onVoiceChange={onVoiceChange}
          speed={settings.voiceSpeed}
          onVoiceSpeedChange={onVoiceSpeedChange}
          captions={settings.voiceCaptions}
          onVoiceCaptionsChange={onVoiceCaptionsChange}
          ducking={settings.duckOtherMedia}
          onDuckOtherMediaChange={onDuckOtherMediaChange}
          notifications={settings.sessionNotifications}
          onSessionNotificationsChange={onSessionNotificationsChange}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.APPEARANCE && settings ? (
        <AppearanceSection
          shown={settings.showInMenuBar}
          onShowInMenuBarChange={onShowInMenuBarChange}
          dockShown={settings.showInDock}
          onShowInDockChange={onShowInDockChange}
          allDisplays={settings.showOnAllDisplays}
          onShowOnAllDisplaysChange={onShowOnAllDisplaysChange}
          formFactor={settings.formFactor}
          onFormFactorChange={onFormFactorChange}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.SHORTCUTS ? (
        <ShortcutSection
          {...(voiceHotkey ? { voiceHotkey } : {})}
          voiceHotkeyHeld={voiceHotkeyHeld}
          chosen={settings?.voiceHotkey !== undefined}
          onVoiceHotkeyChange={onVoiceHotkeyChange}
          {...(askHotkey ? { askHotkey } : {})}
          askChosen={settings?.askHotkey !== undefined}
          onAskHotkeyChange={onAskHotkeyChange}
          {...(stopHotkey ? { stopHotkey } : {})}
          stopChosen={settings?.stopHotkey !== undefined}
          onStopHotkeyChange={onStopHotkeyChange}
          onShortcutCapture={onShortcutCapture}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.CONNECTIONS && settings ? (
        <>
          <CredentialsSection
            settings={settings}
            control={credentials}
            panelOpen={panelOpen}
            onWorkspaceAgentDefaultChange={onWorkspaceAgentDefaultChange}
          />
          <IntegrationsSection settings={settings} control={credentials} panelOpen={panelOpen} />
          <WorkspacesSection
            {...(settings.defaultWorkspaceProvider
              ? { defaultWorkspaceProvider: settings.defaultWorkspaceProvider }
              : {})}
            workspaceProviders={workspaceProviders}
            onDefaultWorkspaceProviderChange={onDefaultWorkspaceProviderChange}
          />
        </>
      ) : null}

      {drawnView !== SETTINGS_VIEW.ROOT ? null : (
        <>
          <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
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
                  <strong>Microphone</strong>
                  {microphone.ready ? <CheckIcon /> : null}
                </span>
                <small>{microphone.detail}</small>
              </span>
              <span className="settings-actions">
                {microphone.offerSystemSettings ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Open Privacy & Security in System Settings"
                    /* The ellipsis is the promise that it opens somewhere else. */
                    title="System Settings…"
                    onClick={onOpenMicrophoneSettings}
                  >
                    <ExternalIcon />
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

          <FeedbackSection control={feedback} />

          <button
            type="button"
            className="quit-button"
            style={{ "--row-index": 4 } as React.CSSProperties}
            onClick={onQuit}
          >
            <PowerIcon />
            Quit Luke
          </button>
        </>
      )}
    </div>
  );
}
