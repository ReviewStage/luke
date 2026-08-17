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
  type RealtimeDiagnostics,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import { useEffect, useRef, useState } from "react";
import type {
  AccountCalendar,
  AccountSnapshot,
  AppSettings,
  CalendarAccount,
  CredentialSource,
  MicrophoneStatus,
  ObservedAccountCalendars,
  SettingsResetScope,
  UpdateSnapshot,
} from "../shared/contracts";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  APP_SETTING_DEFAULTS,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  SETTINGS_RESET_SCOPE,
} from "../shared/contracts";
import type { CredentialProvider } from "../shared/credential-providers";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  INTEGRATION_PROVIDER_LIST,
  providerRunsSessionsInCloud,
  VOICE_CREDENTIAL_PROVIDER,
} from "../shared/credential-providers";
import { GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_NAME } from "../shared/google-calendar";
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
import { type ErrandTarget, errandTargetProps } from "./luke-errand";
import { APP_SETTING_ID } from "./luke-guide";
import {
  hostedVoiceNote,
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  VOICE_KEYLESS_NOTE,
  voiceAttentionNote,
} from "./microphone-access";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  BackIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DisplayIcon,
  DownloadIcon,
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
  UserIcon,
} from "./settings-icons";
import {
  pageExitMs,
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsSubview,
  type SettingsView,
  settingsNavRowId,
} from "./settings-views";
import { UPDATE_ROW_ACTION, updateRow } from "./update-row";

/** One provider the default-workspace rows can offer, by id and display name. */
export interface WorkspaceProviderOption {
  id: string;
  name: string;
  /**
   * The projects this provider's default-project row can offer: everything
   * currently observed for it, plus a stored default it no longer offers — a
   * choice the row cannot show is one that can be neither seen nor cleared.
   */
  projects: readonly { id: string; label: string }[];
}

/**
 * Whether Luke may open the microphone, and the two things that can be done
 * about that: asking the system for access, or opening the one place the
 * system's own grant can be changed.
 */
export interface MicrophoneControl {
  status: MicrophoneStatus;
  /** Whether there is anything to talk to, which is the microphone's only use. */
  voiceAvailable: boolean;
  /** Asks the system for access. Using the microphone is the talk key's job. */
  onRequest: () => void;
  /** Opens the one place the system's own grant can be changed. */
  onOpenSettings: () => void;
}

/**
 * Where the app stands against the latest release, and the two things the row
 * can do about that: ask GitHub now, or open the newer release's page in the
 * browser. Fetching an update stays the user's own act there — the row never
 * changes the running build.
 */
export interface UpdateControl {
  update: UpdateSnapshot;
  /** Asks GitHub for the latest release name, right now. */
  onCheck: () => Promise<void>;
  /** Opens the latest release's page, fixed by the build, in the browser. */
  onOpenLatest: () => void;
}

/**
 * The one way to write a stored preference. Every settings row that keeps a
 * choice travels through this, so the panel redraws from what was stored
 * rather than from the press — the same shape a credential's control is, for
 * the same reason: the writers live above the panel that draws them.
 */
export interface PreferenceWrites {
  /**
   * Turns the on-screen caption of Luke's speech on or off. The store answers
   * with why when it refuses, and the row is where that answer belongs.
   */
  onVoiceCaptionsChange: (enabled: boolean) => Promise<string | undefined>;
  /** Turns the quieting of Music and Spotify during a spoken exchange on or off. */
  onDuckOtherMediaChange: (enabled: boolean) => Promise<string | undefined>;
  /**
   * Turns the holding of announcements during calendar meetings on or off.
   * The store answers with why when it refuses, and the row is where that
   * answer belongs.
   */
  onQuietDuringMeetingsChange: (enabled: boolean) => Promise<string | undefined>;
  /** Chooses the voice Luke speaks with, from the set fixed by this build. */
  onVoiceChange: (voice: RealtimeVoice) => void;
  /** Chooses the pace Luke speaks at, from the set fixed by this build. */
  onVoiceSpeedChange: (speed: RealtimeVoiceSpeed) => void;
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
  /**
   * Chooses the project one provider creates nameless-ask workspaces in, or
   * returns to letting the first creation there choose when omitted. The
   * store answers with why when it refuses, and the row is where that answer
   * belongs.
   */
  onWorkspaceProjectDefaultChange: (
    providerId: ProviderId,
    providerProjectId: string | undefined,
  ) => Promise<string | undefined>;
  /**
   * Returns one group of settings to its defaults, in one stored write: the
   * scope names a page, or the Workspaces group, from the set fixed by this
   * build, and no scope reaches a credential. The store answers with why when
   * it refuses, and the control that asked is where that answer belongs.
   */
  onSettingsReset: (scope: SettingsResetScope) => Promise<string | undefined>;
}

/**
 * The talk, ask, and stop keys as registered, and the one way to move them
 * or to say a recording is under way. The keys the rows show are the ones
 * that actually answered, which can differ from the stored choice when
 * another app owns the chord — that stored choice is what Reset undoes.
 */
export interface ShortcutControl {
  /**
   * The talk key as registered, as an accelerator: the row draws it as its
   * separate keys and says it whole in the labels its buttons carry.
   */
  voiceHotkey?: string;
  /** Whether that key can be held, which is what the row has to describe. */
  voiceHotkeyHeld: boolean;
  /** Whether a chosen talk chord is stored, which is what Reset has to undo. */
  voiceChosen: boolean;
  /**
   * Moves the talk key to a recorded chord, or back to the defaults when
   * omitted. The store answers with why when it refuses, and the row is where
   * that answer belongs.
   */
  onVoiceHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  /** The ask key as registered, an accelerator on the talk key's terms. */
  askHotkey?: string;
  /** Whether a chosen ask chord is stored, on the talk key's terms. */
  askChosen: boolean;
  /**
   * Moves the ask key to a recorded chord, or back to the defaults when
   * omitted, on the talk key's terms: the store answers with why when it
   * refuses, and the row is where that answer belongs.
   */
  onAskHotkeyChange: (accelerator: string | undefined) => Promise<string | undefined>;
  /** The stop key as registered, an accelerator on the talk key's terms. */
  stopHotkey?: string;
  /** Whether a chosen stop chord is stored, on the other rows' terms. */
  stopChosen: boolean;
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
  onCapture: (capturing: boolean) => void;
}

/**
 * The settings tab, as the grouped controls that draw it. A preference write
 * or a shortcut lives on its own bundle so a leaf can change without the
 * panel, the body, or the app's settings object growing a new field.
 */
export interface SettingsPanelProps {
  account: AccountSnapshot;
  onSignOut: () => Promise<void>;
  /**
   * Which settings page is showing: the front page, or one of the pages a
   * front-page row opens. Held by the app rather than here because Escape
   * unwinds it and a credential entry has to survive a trip to the key slot
   * with its page intact.
   */
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  microphone: MicrophoneControl;
  updates: UpdateControl;
  settings?: AppSettings;
  /**
   * How voice stands right now, asked of the main process while the panel is
   * up: whose credential it runs on and what remains of a hosted day's
   * allowance. Absent until the first answer lands; the Voice page words its
   * hosted note without it until then.
   */
  voiceService?: RealtimeDiagnostics;
  preferences: PreferenceWrites;
  /** The one credential being entered anywhere, and everything that can be done to it. */
  credentials: CredentialEntryControl;
  /** The one note to the founders being written, and everything that can be done to it. */
  feedback: FeedbackEntryControl;
  /**
   * True while the panel is the shape on screen. A field can only hold the
   * caret then: everything here sits in an inert stage the rest of the time,
   * and an entry can outlast the panel it was started in.
   */
  panelOpen: boolean;
  /**
   * The providers the default-workspace row may offer: the ones currently
   * offering projects, plus a stored default that is not — a choice the row
   * cannot show is one that can be neither seen nor cleared.
   */
  workspaceProviders: readonly WorkspaceProviderOption[];
  /** Everything the Google Calendar block can do. */
  calendar: CalendarControl;
  onQuit: () => void;
  shortcuts: ShortcutControl;
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

/* The default-project rows' word for no default at all. An empty value for
   the ASK_EACH_TIME reason: no provider's project id can collide with it. */
const FIRST_CREATION_SETS_IT = "";

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
  children,
}: {
  provider: CredentialProvider;
  source: CredentialSource;
  storageUnavailable: boolean;
  control: CredentialEntryControl;
  panelOpen: boolean;
  /**
   * The provider's own sub-rows — today, the agent defaults a connected
   * Conductor offers. Drawn inside the credential block so the rule that
   * separates providers falls under them, not between them and their line.
   */
  children?: React.ReactNode;
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
              a word every line would have to repeat. An agent provider's mark
              carries the same cloud badge its session rows do — the key buys
              the observation of cloud sessions, and the same mark cannot
              differ between the row and the sessions it stands for. Linear and
              OpenAI are services Luke uses rather than sessions he watches, so
              their marks stand alone. */}
          <span className="credential-mark">
            <ProviderMark providerId={provider.id} />
            {providerRunsSessionsInCloud(provider.id) ? <CloudBadge /> : null}
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
      {children}
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

/**
 * The small mark beside a row's name while its value differs from the
 * default: what a page's reset would change, said row by row rather than
 * only by the reset appearing. A statement, not a control — the row's own
 * control is where the value moves — so it carries its meaning as words for
 * a reader and a hover alike.
 */
function ChangedMark(): React.JSX.Element {
  return (
    <span className="settings-changed" title="Changed from its default">
      <span className="visually-hidden">(changed from its default)</span>
    </span>
  );
}

/**
 * The small mark beside a name while the feature it belongs to still needs a
 * hand — the same mark wherever it stands, so one urgency reads the same on
 * the front page's Voice row, on the row that supplies the missing thing, and
 * on a shortcut whose key answers nothing until it is supplied. A statement,
 * not a control: the words are the hover's and the screen reader's, and the
 * page around it is where the missing thing is explained.
 */
function AttentionMark({ note }: { note: string }): React.JSX.Element {
  return (
    <span className="settings-attention" title={note}>
      <span aria-hidden="true">!</span>
      <span className="visually-hidden">({note})</span>
    </span>
  );
}

/* Whether each group holds a value its reset would change, judged from the
   same resolved settings the rows draw — so the mark, the reset, and the row
   always agree on what is standing. The voice and pace compare against the
   shipped defaults the way their menus label them; a launch-environment
   override reads as changed, which is what the row shows too. */
function voiceSettingsChanged(settings: AppSettings): boolean {
  return (
    settings.voice !== REALTIME_DEFAULTS.VOICE ||
    settings.voiceSpeed !== REALTIME_DEFAULTS.SPEED ||
    settings.voiceCaptions !== APP_SETTING_DEFAULTS.voiceCaptions ||
    settings.duckOtherMedia !== APP_SETTING_DEFAULTS.duckOtherMedia
  );
}

function appearanceSettingsChanged(settings: AppSettings): boolean {
  return (
    settings.showInMenuBar !== APP_SETTING_DEFAULTS.showInMenuBar ||
    settings.showInDock !== APP_SETTING_DEFAULTS.showInDock ||
    settings.showOnAllDisplays !== APP_SETTING_DEFAULTS.showOnAllDisplays ||
    settings.formFactor !== DEFAULT_PANEL_FORM_FACTOR
  );
}

/* The keys' terms are the rows' own: a chord is changed while one is stored,
   whatever key the row is showing for it. */
function shortcutSettingsChanged(shortcuts: ShortcutControl): boolean {
  return shortcuts.voiceChosen || shortcuts.askChosen || shortcuts.stopChosen;
}

/* Only the choices the Workspaces group itself draws: the Conductor agent
   pairing lives on the Conductor row, whose own menu already offers the
   provider's default, so no reset here may reach it. */
function workspaceSettingsChanged(settings: AppSettings): boolean {
  return (
    settings.defaultWorkspaceProvider !== undefined ||
    Object.keys(settings.workspaceProjectDefaults ?? {}).length > 0
  );
}

/**
 * The one control that returns a whole group to its defaults, drawn only
 * while the group holds something to return — until then it could only offer
 * to change nothing, the same reason a shortcut's own reset waits for a
 * chord. One press is one ask of the store; the control rests until the
 * store answers, and a refusal is worded where the press was.
 */
function ResetGroupButton({
  scope,
  label,
  onReset,
}: {
  scope: SettingsResetScope;
  /** The group as the button names it aloud: "the Voice page's settings". */
  label: string;
  onReset: (scope: SettingsResetScope) => Promise<string | undefined>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onReset);
  return (
    <>
      <button
        type="button"
        className="icon-button settings-reset"
        disabled={busy}
        aria-label={`Reset ${label} to the defaults`}
        title="Back to the defaults"
        onClick={() => run(scope)}
      >
        <ResetIcon />
      </button>
      {rejection ? <p className="error-message settings-reset-refusal">{rejection}</p> : null}
    </>
  );
}

/**
 * The round trip a settings control waits on. Each change is asked of the
 * store, the control rests until it answers rather than claiming a state it
 * may not get, and a refusal is kept here — under this control — rather than
 * on a line shared with every other row. One write in flight must not still
 * another control.
 *
 * Some choices cannot be refused (the voice, the pace): those answer void,
 * and there is nothing to rest for.
 */
function useSettingWrite<Value>(
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<string | undefined>,
): {
  busy: boolean;
  rejection: string | undefined;
  run: (value: Value) => void;
} {
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const run = (value: Value) => {
    const reply = onChange(value);
    if (!(reply instanceof Promise)) return;
    setBusy(true);
    void reply.then((reason) => {
      setRejection(reason);
      setBusy(false);
    });
  };
  return { busy, rejection, run };
}

/**
 * A settings switch: its name, optional why, and the thumb. The write and the
 * refusal live here, so two switches can be in flight at once and a refusal
 * names the row that asked.
 */
function SwitchRow({
  label,
  detail,
  checked,
  ariaLabel,
  errand,
  changed,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  /** When the visible name is too short to stand as the control's own name. */
  ariaLabel?: string;
  /** The id a spoken change names this switch by, so an errand lands on it. */
  errand?: ErrandTarget;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  onChange: (enabled: boolean) => Promise<string | undefined>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>
            {label}
            {changed ? <ChangedMark /> : null}
          </strong>
          {detail ? <small>{detail}</small> : null}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel ?? label}
          className="switch"
          {...(errand ? errandTargetProps(errand) : {})}
          disabled={busy}
          onClick={() => run(!checked)}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </>
  );
}

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set. The closed face is drawn here and the open menu is the system's, which
 * is also why the window is focused before the menu opens — a menu opened
 * while the panel is showing without being key would drop its first choice.
 * The up-and-down badge is the macOS mark for that kind of button; the select
 * alone answers the pointer.
 */
function SelectRow<Value extends string | number>({
  label,
  detail,
  value,
  options,
  parse,
  ariaLabel,
  errand,
  changed,
  busy: restBusy,
  onChange,
}: {
  label: string;
  detail?: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  parse: (raw: string) => Value | undefined;
  /** When the visible name is too short to stand as the control's own name. */
  ariaLabel?: string;
  /**
   * The id a spoken change names this pop-up by. Marked on the `select`
   * rather than the box positioning it: an errand outlines what it lands on,
   * and only the `select` is drawn with the corners that outline has to take.
   */
  errand?: ErrandTarget;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  /**
   * A sibling write in flight. Two pop-ups that store one setting share a
   * rest so one save cannot finish behind the other.
   */
  busy?: boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<string | undefined>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>
            {label}
            {changed ? <ChangedMark /> : null}
          </strong>
          {detail ? <small>{detail}</small> : null}
        </span>
        <span className="voice-select">
          <select
            {...(errand ? errandTargetProps(errand) : {})}
            aria-label={ariaLabel ?? label}
            value={value}
            disabled={busy || Boolean(restBusy)}
            onChange={(event) => {
              const next = parse(event.target.value);
              if (next !== undefined) run(next);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              window.sidecar.focusPanel();
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </>
  );
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
  const providerDefault = `${provider.displayName}'s default`;
  // One rest for both pop-ups: they write the same stored pairing, so a model
  // change in flight must still the effort row and the other way around —
  // otherwise two saves can finish out of order and keep whichever answered last.
  const write = useSettingWrite((next: WorkspaceAgentSelection | undefined) =>
    onChange(providerId, next),
  );
  return (
    <>
      <SelectRow
        label="New agents run"
        ariaLabel={`The model new ${provider.displayName} workspaces run`}
        detail={
          /* Scope, because this row must not claim the provider's own app:
             only what Luke itself creates — a workspace, or another agent in
             one — starts on this choice. */
          "For workspaces and agents created through Luke."
        }
        value={chosenIndex >= 0 ? String(chosenIndex) : PROVIDER_DEFAULT_VALUE}
        options={[
          { value: PROVIDER_DEFAULT_VALUE, label: providerDefault },
          // Indexed on purpose: the list is fixed by the build, and the
          // index is the same word the select's value speaks.
          ...choices.map((choice, index) => ({
            value: String(index),
            label: choice.label,
          })),
        ]}
        parse={(raw) => {
          if (raw === PROVIDER_DEFAULT_VALUE) return raw;
          // The set is the one this row offered, so anything else arriving
          // out of the select is a broken control rather than a choice.
          return choices[Number(raw)] ? raw : undefined;
        }}
        changed={selection !== undefined}
        busy={write.busy}
        onChange={(next) => {
          if (next === PROVIDER_DEFAULT_VALUE) {
            write.run(undefined);
            return;
          }
          const choice = choices[Number(next)];
          if (!choice) return;
          // A chosen effort survives a model change only where the new
          // agent documents the same level; anywhere else it returns to
          // the provider's default rather than riding somewhere unlisted.
          const effort =
            selection?.effort && choice.efforts.includes(selection.effort)
              ? selection.effort
              : undefined;
          write.run({
            agent: choice.agent,
            model: choice.model,
            ...(effort ? { effort } : {}),
          });
        }}
      />
      {chosen && chosen.efforts.length > 0 ? (
        <SelectRow
          label="Effort"
          ariaLabel={`The effort new ${provider.displayName} agents think at`}
          detail="How hard the chosen model thinks."
          value={
            selection?.effort && chosen.efforts.includes(selection.effort)
              ? selection.effort
              : PROVIDER_DEFAULT_VALUE
          }
          options={[
            { value: PROVIDER_DEFAULT_VALUE, label: providerDefault },
            ...chosen.efforts.map((effort) => ({ value: effort, label: effort })),
          ]}
          parse={(raw) => {
            if (raw === PROVIDER_DEFAULT_VALUE) return raw;
            // Held to the chosen agent's own documented levels, so the
            // stored selection is always one whole the table lists.
            return chosen.efforts.includes(raw) ? raw : undefined;
          }}
          changed={selection?.effort !== undefined}
          busy={write.busy}
          onChange={(next) => {
            const effort = next !== PROVIDER_DEFAULT_VALUE ? next : undefined;
            write.run({
              agent: chosen.agent,
              model: chosen.model,
              ...(effort ? { effort } : {}),
            });
          }}
        />
      ) : null}
      {write.rejection ? <p className="error-message">{write.rejection}</p> : null}
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
  preferences,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
  preferences: PreferenceWrites;
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
      {/* True of every key here, so it is said once rather than per provider. */}
      <p className="settings-note">
        Luke reads only cloud workspaces you created, and never sends a prompt or any other change.
      </p>
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
          <ProviderCredential
            key={provider.id}
            provider={provider}
            source={settings.credentialSources[provider.id]}
            storageUnavailable={storageUnavailable}
            control={control}
            panelOpen={panelOpen}
          >
            {agentRow ? (
              <WorkspaceAgentRow
                provider={provider}
                providerId={agentRow}
                {...(settings.workspaceAgentDefaults?.[agentRow]
                  ? { selection: settings.workspaceAgentDefaults[agentRow] }
                  : {})}
                onChange={preferences.onWorkspaceAgentDefaultChange}
              />
            ) : null}
          </ProviderCredential>
        );
      })}
      {/* The same refusal the trackers' section explains: a Connect stilled by
          missing storage needs its why in this section too. */}
      {storageUnavailable ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}

/** Everything the Google Calendar block can do, wired above the panel. */
export interface CalendarControl {
  /** Each connected account's calendars, as last observed. */
  choices: readonly ObservedAccountCalendars[];
  /** True while another entry holds the slot, which refuses a second act. */
  held: boolean;
  /** True while a sign-in is waiting on the browser. */
  connecting: boolean;
  /** Stands the panel down and opens Google's consent page. */
  onSignIn: () => void;
  onRemoveAccount: (accountId: string) => Promise<string | undefined>;
  onToggleCalendar: (
    accountId: string,
    calendarId: string,
    selected: boolean,
  ) => Promise<string | undefined>;
}

/**
 * One connected account: its address, the trash that disconnects it, and a
 * checkbox per calendar its list offered — checked meaning its meetings hold
 * announcements. The names drawn here are the user's own calendar names, on
 * the user's own screen, read under the list scope the sign-in asked for.
 */
function CalendarAccountRow({
  account,
  calendars,
  onRemove,
  onToggle,
}: {
  account: CalendarAccount;
  calendars: readonly AccountCalendar[];
  onRemove: () => Promise<string | undefined>;
  onToggle: (calendarId: string, selected: boolean) => Promise<string | undefined>;
}): React.JSX.Element {
  // Disconnecting asks first, exactly like deleting a key: nothing here can
  // hand the grant back, so a remove taken on the first press would cost a
  // trip through Google's consent to undo.
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();

  const removeAccount = async () => {
    setBusy(true);
    setRejection(await onRemove());
    setBusy(false);
    setAsking(false);
  };

  const toggleCalendar = async (calendarId: string, selected: boolean) => {
    setBusy(true);
    setRejection(await onToggle(calendarId, selected));
    setBusy(false);
  };

  return (
    <div className="calendar-account">
      <div className="calendar-account-row">
        <span className="calendar-account-name">{account.id}</span>
        {/* The trash and the confirm that stands in for it share one grid
            cell, exactly as the credential rows' do: the cell is as wide and
            as tall as the larger of the two whichever is showing, so asking
            the question never re-shapes the line. */}
        <span className="credential-actions">
          <span
            className="settings-actions credential-controls"
            data-drawn={String(!asking)}
            aria-hidden={asking}
            inert={asking}
          >
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={busy}
              aria-label={`Disconnect ${account.id}`}
              /* The ellipsis is the promise that it asks first. */
              title="Disconnect…"
              onClick={() => {
                setRejection(undefined);
                setAsking(true);
              }}
            >
              <TrashIcon />
            </button>
          </span>
          <fieldset
            className="settings-actions credential-confirm"
            aria-label={`Disconnect ${account.id}?`}
            data-drawn={String(asking)}
            aria-hidden={!asking}
            inert={!asking}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || busy) return;
              event.stopPropagation();
              setAsking(false);
            }}
          >
            <button
              type="button"
              className="quiet-button"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => void removeAccount()}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </fieldset>
        </span>
      </div>
      {/* Which of the account's calendars count, one checkbox each — drawn in
          the calendar's own colour where Google listed one, the panel's
          working accent where it did not. A calendar the selection names but
          the list no longer offers simply is not drawn — and never reaches a
          read either way. */}
      {calendars.map((calendar) => {
        const selected = account.selectedCalendarIds.includes(calendar.id);
        return (
          <label
            className="calendar-choice"
            key={calendar.id}
            {...(calendar.color
              ? { style: { "--calendar-color": calendar.color } as React.CSSProperties }
              : {})}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={busy}
              aria-label={`Count meetings on ${calendar.label}`}
              onChange={() => void toggleCalendar(calendar.id, !selected)}
            />
            <span className="calendar-choice-name">{calendar.label}</span>
          </label>
        );
      })}
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </div>
  );
}

/**
 * The calendar integration: connected by signing in with Google, never by a
 * pasted credential, and drawn at all only in a build that carries the OAuth
 * client the sign-in runs on — a row whose one act cannot run is not a row.
 */
function GoogleCalendarIntegration({
  settings,
  calendar,
  preferences,
}: {
  settings: AppSettings;
  calendar: CalendarControl;
  preferences: PreferenceWrites;
}): React.JSX.Element | null {
  if (!settings.calendarSignInAvailable) return null;
  const accounts = settings.calendarAccounts;
  return (
    <div className="credential">
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
          </span>
          <span className="credential-name">{GOOGLE_CALENDAR_NAME}</span>
          {accounts.length > 0 ? <CheckIcon /> : null}
        </span>
        <span className="settings-actions">
          {/* The consent page does the connecting: the same word every other
              integration's row uses, and a second account is the same act
              worded for what it adds. */}
          <button
            type="button"
            className="quiet-button"
            disabled={calendar.held || calendar.connecting}
            aria-label={
              accounts.length > 0
                ? "Add another Google account"
                : "Connect Google Calendar by signing in"
            }
            title={calendar.held ? HELD_TITLE : undefined}
            onClick={calendar.onSignIn}
          >
            {calendar.connecting
              ? "Waiting for Google…"
              : accounts.length > 0
                ? "Add account"
                : "Connect"}
          </button>
        </span>
      </div>
      <p className="settings-note">
        Luke reads when your meetings start and end — never their titles — and can hold
        announcements until they finish.
      </p>
      {accounts.map((account) => (
        <CalendarAccountRow
          key={account.id}
          account={account}
          calendars={
            calendar.choices.find((choice) => choice.accountId === account.id)?.calendars ?? []
          }
          onRemove={() => calendar.onRemoveAccount(account.id)}
          onToggle={(calendarId, selected) =>
            calendar.onToggleCalendar(account.id, calendarId, selected)
          }
        />
      ))}
      {/* The quiet is a fact about the calendars above it, so it appears with
          the first account and leaves with the last — a switch gating what a
          disconnected calendar cannot do would be a control over nothing. */}
      {accounts.length > 0 ? (
        <SwitchRow
          label="Quiet during meetings"
          ariaLabel="Hold announcements while a calendar meeting is on"
          errand={APP_SETTING_ID.QUIET_DURING_MEETINGS}
          detail="While a meeting is on, spoken announcements wait and are read out together after it ends."
          checked={settings.quietDuringMeetings}
          onChange={preferences.onQuietDuringMeetingsChange}
        />
      ) : null}
    </div>
  );
}

/**
 * The services Luke connects to that are not agents: the issue tracker and
 * the calendar. Each row is the same credential line an agent provider gets —
 * same entry, same trash, same environment fallback — with its own one-line
 * answer to what connecting it buys. The OpenAI key is not here: it lives at
 * the top of the Voice page, beside the feature it turns on.
 */
function IntegrationsSection({
  settings,
  control,
  panelOpen,
  preferences,
  calendar,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
  preferences: PreferenceWrites;
  calendar: CalendarControl;
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
      <GoogleCalendarIntegration
        settings={settings}
        calendar={calendar}
        preferences={preferences}
      />
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
 * the way a macOS settings row is. The one thing a row may add is the
 * attention mark: a state, not a sentence, saying the page holds something
 * that needs a hand before its feature can run — the mark's words are the
 * hover's, and the page itself is where they are explained.
 */
function SettingsNavRow({
  view,
  onOpen,
  attention,
}: {
  view: SettingsSubview;
  onOpen: (view: SettingsSubview) => void;
  /** Why the page needs a hand, absent while nothing on it does. */
  attention?: string;
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
      {attention ? <AttentionMark note={attention} /> : null}
      <ChevronIcon />
    </button>
  );
}

/**
 * A page's head: the way back beside the page's own name. The back button
 * returns to the front page and nothing else — a page holds no unsaved state
 * of its own, so leaving one never needs a warning. A page whose settings can
 * be returned to their defaults ends the line with that reset, drawn only
 * while something on the page differs from them.
 */
function SettingsPageHeader({
  view,
  onBack,
  backControl,
  reset,
}: {
  view: SettingsSubview;
  onBack: () => void;
  backControl: React.RefObject<HTMLButtonElement | null>;
  /** The page's reset control, absent while the page stands at its defaults. */
  reset?: React.JSX.Element;
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
      {reset}
    </div>
  );
}

/**
 * How Luke sounds and what he says unprompted — led by what voice runs on.
 * The OpenAI credential stands at the top of this page rather than under
 * Connections because voice is what the key changes: included with the
 * signed-in account under a daily allowance, and run unmetered on the
 * developer's own key the moment one is connected — so the section that
 * explains whose credential is speaking is the section a key is typed into.
 * The page reveals itself in stages rather than all at once: the key section
 * alone until voice is available at all, the microphone permission beneath it
 * once there is a voice for the microphone to reach, and the voice controls
 * only once both stand —
 * a page of settings for a feature two steps from running reads as work
 * already done, and the one thing to do next reads clearest standing alone.
 * Whichever stage is missing wears the same exclamation mark the front
 * page's Voice row wears, so the mark that brought someone here is the mark
 * they land on. The voice Luke speaks with leads the controls — it is what
 * Luke *is* to the ear — offered the way macOS offers one value from a small
 * fixed set: a pop-up button whose closed face is drawn here and whose open
 * menu is the system's, which also lets it escape a window sized to the
 * panel rather than being clipped by it.
 */
function VoiceSection({
  settings,
  preferences,
  credentials,
  panelOpen,
  microphone,
  voiceService,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
  credentials: CredentialEntryControl;
  panelOpen: boolean;
  microphone: MicrophoneControl;
  voiceService?: RealtimeDiagnostics;
}): React.JSX.Element {
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  const microphoneRow = microphoneAccessRow({
    voiceAvailable: microphone.voiceAvailable,
    status: microphone.status,
  });
  return (
    <>
      <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
        <h2>
          <KeyIcon />
          OpenAI API key
          {/* The same mark, for the same missing key, as the front page's
              Voice row wears: the row someone pressed a mark to reach is the
              row that has to carry it. */}
          {settings.voiceAvailable ? null : <AttentionMark note={VOICE_KEYLESS_NOTE} />}
        </h2>
        <ProviderCredential
          provider={VOICE_CREDENTIAL_PROVIDER}
          source={settings.credentialSources[VOICE_CREDENTIAL_PROVIDER.id]}
          storageUnavailable={storageUnavailable}
          control={credentials}
          panelOpen={panelOpen}
        />
        {/* Said only while it is true, and as a state rather than an error:
            nothing is broken, the page is waiting on the one thing that turns
            it on. `voiceAvailable` rather than the credential source, because
            availability is the store's own answer — a fixture run or a key
            that failed to resolve leaves voice off however the row reads.
            While voice runs on the account instead, the note says whose
            allowance is speaking and what a key of one's own changes, so an
            unconnected row above a working feature does not read as a step
            still owed. While this system cannot store a key at all, the
            storage refusal replaces the invitation: a Connect stilled by
            missing storage needs its why here exactly as it does in the other
            key sections, and a note urging a key the panel will not store
            would only send someone to a disabled control. */}
        {storageUnavailable ? (
          <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p>
        ) : !settings.voiceAvailable ? (
          <p className="settings-note">
            Voice is off until you sign in or connect a key — Luke cannot talk, listen, or announce
            sessions.
          </p>
        ) : settings.credentialSources[VOICE_CREDENTIAL_PROVIDER.id] === CREDENTIAL_SOURCE.NONE ? (
          <p className="settings-note">{hostedVoiceNote(voiceService)}</p>
        ) : null}
      </section>
      {/* Drawn only once there is a voice for the microphone to reach: until
          the key connects, the permission guards a feature that cannot run,
          and the page holds the one thing to do next rather than a queue of
          them. */}
      {settings.voiceAvailable ? (
        <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
          <h2>
            <ShieldIcon />
            Permissions
          </h2>
          {/* Access, not use. The talk key is what opens the microphone, so a
              button here could only ever repeat what the key already does — the
              line answers the one question it can: whether Luke is allowed. It
              lives on this page, under the key it waits on, because the
              microphone's one use is the voice that key turns on. */}
          {/* Named and marked like a provider, because it is the same question in
              the same words: what Luke has been let at, and whether it is on. The
              check and the attention mark trade the same spot: allowed, or the
              next thing needing a hand. */}
          <div className="settings-row">
            <span className="settings-copy">
              <span className="settings-name">
                <strong>Microphone</strong>
                {microphoneRow.ready ? (
                  <CheckIcon />
                ) : (
                  <AttentionMark note={MICROPHONE_UNGRANTED_NOTE} />
                )}
              </span>
              <small>{microphoneRow.detail}</small>
            </span>
            <span className="settings-actions">
              {microphoneRow.offerSystemSettings ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Open Privacy & Security in System Settings"
                  /* The ellipsis is the promise that it opens somewhere else. */
                  title="System Settings…"
                  onClick={microphone.onOpenSettings}
                >
                  <ExternalIcon />
                </button>
              ) : null}
              {microphoneRow.offerAccess ? (
                <button type="button" className="quiet-button" onClick={microphone.onRequest}>
                  Allow
                </button>
              ) : null}
            </span>
          </div>
        </section>
      ) : null}
      {/* `ready` already folds the key in — a microphone with no voice to
          reach never reports itself ready — so the controls stand exactly
          while both halves do. */}
      {microphoneRow.ready ? (
        <VoiceControlsSection settings={settings} preferences={preferences} />
      ) : null}
    </>
  );
}

/** The voice controls themselves, below the key that powers them. */
function VoiceControlsSection({
  settings,
  preferences,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
}): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={{ "--row-index": 3 } as React.CSSProperties}
    >
      <SelectRow
        label="Voice"
        errand={APP_SETTING_ID.VOICE}
        changed={settings.voice !== REALTIME_DEFAULTS.VOICE}
        value={settings.voice}
        options={REALTIME_VOICE_LIST.map((candidate) => ({
          value: candidate,
          label: voiceOptionLabel(candidate),
        }))}
        parse={(raw) => {
          // The set is fixed by this build, so anything else arriving out
          // of a select is a broken control rather than a choice.
          return isRealtimeVoice(raw) ? raw : undefined;
        }}
        onChange={preferences.onVoiceChange}
      />
      <SelectRow
        label="Speed"
        errand={APP_SETTING_ID.VOICE_SPEED}
        changed={settings.voiceSpeed !== REALTIME_DEFAULTS.SPEED}
        value={settings.voiceSpeed}
        options={REALTIME_VOICE_SPEED_LIST.map((candidate) => ({
          value: candidate,
          label: speedOptionLabel(candidate),
        }))}
        parse={(raw) => {
          // A select serializes its value to a string, so the number is
          // read back out and held to the set fixed by this build.
          const next = Number(raw);
          return isRealtimeVoiceSpeed(next) ? next : undefined;
        }}
        onChange={preferences.onVoiceSpeedChange}
      />
      <SwitchRow
        label="Captions"
        ariaLabel="Caption Luke's speech on screen"
        errand={APP_SETTING_ID.VOICE_CAPTIONS}
        changed={settings.voiceCaptions !== APP_SETTING_DEFAULTS.voiceCaptions}
        checked={settings.voiceCaptions}
        onChange={preferences.onVoiceCaptionsChange}
      />
      <SwitchRow
        label="Quiet Music and Spotify"
        ariaLabel="Quiet Music and Spotify while talking with Luke"
        errand={APP_SETTING_ID.DUCK_OTHER_MEDIA}
        detail={
          /* Named by app rather than as "other media": these two are the ones
             macOS lets Luke turn down, and a switch claiming more would claim
             a capability the system does not grant. The first duck is also
             when macOS asks whether Luke may speak to each player at all. */
          "Their volume dips while you and Luke are talking, and returns after."
        }
        changed={settings.duckOtherMedia !== APP_SETTING_DEFAULTS.duckOtherMedia}
        checked={settings.duckOtherMedia}
        onChange={preferences.onDuckOtherMediaChange}
      />
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
  settings,
  preferences,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
}): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
      <SwitchRow
        label="Show Luke in the menu bar"
        errand={APP_SETTING_ID.SHOW_IN_MENU_BAR}
        changed={settings.showInMenuBar !== APP_SETTING_DEFAULTS.showInMenuBar}
        checked={settings.showInMenuBar}
        onChange={preferences.onShowInMenuBarChange}
      />
      <SwitchRow
        label="Show Luke in the Dock"
        errand={APP_SETTING_ID.SHOW_IN_DOCK}
        changed={settings.showInDock !== APP_SETTING_DEFAULTS.showInDock}
        checked={settings.showInDock}
        onChange={preferences.onShowInDockChange}
      />
      <SwitchRow
        label="Show Luke on all displays"
        errand={APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS}
        changed={settings.showOnAllDisplays !== APP_SETTING_DEFAULTS.showOnAllDisplays}
        checked={settings.showOnAllDisplays}
        onChange={preferences.onShowOnAllDisplaysChange}
      />
      <SelectRow
        label="Form factor"
        errand={APP_SETTING_ID.FORM_FACTOR}
        changed={settings.formFactor !== DEFAULT_PANEL_FORM_FACTOR}
        detail={
          /* Where the choice applies, because on a notched display this row
             visibly does nothing: the real housing always wins. */
          "On displays without a notch."
        }
        value={settings.formFactor}
        options={PANEL_FORM_FACTOR_LIST.map((candidate) => ({
          value: candidate,
          label: formFactorOptionLabel(candidate),
        }))}
        parse={(raw) => {
          // The set is fixed by this build, so anything else arriving out
          // of a select is a broken control rather than a choice.
          return isPanelFormFactor(raw) ? raw : undefined;
        }}
        onChange={preferences.onFormFactorChange}
      />
    </section>
  );
}

/**
 * What a conversational ask creates and where, beside the connections it
 * creates through: its own named group on the Connections page, because the
 * default is about every provider at once rather than any one row.
 */
function WorkspacesSection({
  settings,
  workspaceProviders,
  preferences,
}: {
  settings: AppSettings;
  workspaceProviders: readonly WorkspaceProviderOption[];
  preferences: PreferenceWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={{ "--row-index": 3 } as React.CSSProperties}>
      {/* The heading and the group's reset share a line: the reset stands
          over exactly the rows below it, and nothing else on the Connections
          page — the keys above are not settings and are never reset. */}
      <div className="settings-heading">
        <h2>
          <FolderIcon />
          Workspaces
        </h2>
        {workspaceSettingsChanged(settings) ? (
          <ResetGroupButton
            scope={SETTINGS_RESET_SCOPE.WORKSPACES}
            label="the workspace defaults"
            onReset={preferences.onSettingsReset}
          />
        ) : null}
      </div>
      <SelectRow
        label="Default workspace provider"
        detail={
          /* How the default comes to exist, because the row is most often
             read before any choice was made here: the first workspace
             created in conversation fills it in, and this select is where
             that choice is seen, changed, or returned to asking. */
          "Where an ask that names no provider creates a workspace. Your first creation sets it."
        }
        changed={settings.defaultWorkspaceProvider !== undefined}
        value={settings.defaultWorkspaceProvider ?? ASK_EACH_TIME}
        options={[
          { value: ASK_EACH_TIME, label: "Ask each time" },
          ...workspaceProviders.map((option) => ({ value: option.id, label: option.name })),
        ]}
        parse={(raw) => {
          if (raw === ASK_EACH_TIME) return raw;
          // The set is the one this row offered, so anything else arriving
          // out of the select is a broken control rather than a choice.
          if (isProviderId(raw) && workspaceProviders.some((option) => option.id === raw)) {
            return raw;
          }
          return undefined;
        }}
        onChange={(next) => {
          if (next === ASK_EACH_TIME)
            return preferences.onDefaultWorkspaceProviderChange(undefined);
          if (isProviderId(next)) return preferences.onDefaultWorkspaceProviderChange(next);
        }}
      />
      {workspaceProviders.map((provider) => (
        <WorkspaceProjectRow
          key={provider.id}
          provider={provider}
          settings={settings}
          preferences={preferences}
        />
      ))}
    </section>
  );
}

/**
 * Where one provider's nameless creation ask lands: a row per provider with
 * projects to choose between, filled in the way the provider default is — by
 * the first creation there — and this select is where that choice is seen,
 * changed, or returned to the first creation.
 */
function WorkspaceProjectRow({
  provider,
  settings,
  preferences,
}: {
  provider: WorkspaceProviderOption;
  settings: AppSettings;
  preferences: PreferenceWrites;
}): React.JSX.Element | null {
  const providerId = provider.id;
  // A provider this build cannot store a choice for, or one with no projects
  // to choose between, has nothing for the row to say.
  if (!isProviderId(providerId) || provider.projects.length === 0) return null;
  const stored = settings.workspaceProjectDefaults?.[providerId];
  return (
    <SelectRow
      label={`Default ${provider.name} project`}
      ariaLabel={`The project a nameless ask creates ${provider.name} workspaces in`}
      detail="Where an ask that names no project creates a workspace. Your first creation there sets it."
      changed={stored !== undefined}
      value={stored ?? FIRST_CREATION_SETS_IT}
      options={[
        { value: FIRST_CREATION_SETS_IT, label: "First creation sets it" },
        ...provider.projects.map((project) => ({ value: project.id, label: project.label })),
      ]}
      parse={(raw) => {
        if (raw === FIRST_CREATION_SETS_IT) return raw;
        // The set is the one this row offered, so anything else arriving out
        // of the select is a broken control rather than a choice.
        return provider.projects.some((project) => project.id === raw) ? raw : undefined;
      }}
      onChange={(next) =>
        preferences.onWorkspaceProjectDefaultChange(
          providerId,
          next === FIRST_CREATION_SETS_IT ? undefined : next,
        )
      }
    />
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
  attention,
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
  /** Why the key answers nothing right now, absent while it answers. */
  attention?: string;
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
        <strong>
          {title}
          {/* A stored chord is a changed value on the other rows' terms; the
              flag that shows Reset is the flag that earns the mark. */}
          {chosen ? <ChangedMark /> : null}
          {/* The same mark the Voice page wears, because it is the same
              missing key: the chord is still shown and still changeable, the
              mark only says pressing it does nothing yet. */}
          {attention ? <AttentionMark note={attention} /> : null}
        </strong>
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
  shortcuts,
  settings,
  voiceAvailable,
}: {
  shortcuts: ShortcutControl;
  settings?: AppSettings;
  voiceAvailable: boolean;
}): React.JSX.Element {
  // While voice is off the system keys are deliberately not taken — a global
  // chord answering nothing is a key stolen from every other app — so no
  // registered chord ever arrives here. The rows still show the chord each
  // key will hold once voice is on — the stored choice, or the first default
  // — wearing the same mark the Voice page does instead of an "Unavailable"
  // that reads as broken. A key that is genuinely unregistered while voice is
  // on — another app owns the chord — keeps the honest "Unavailable".
  const attention = voiceAvailable ? undefined : VOICE_KEYLESS_NOTE;
  const promisedTalk = settings?.voiceHotkey ?? DEFAULT_VOICE_HOTKEYS[0];
  const promisedAsk = settings?.askHotkey ?? DEFAULT_ASK_HOTKEYS[0];
  const promisedStop = settings?.stopHotkey ?? DEFAULT_STOP_HOTKEYS[0];
  const shownTalk = shortcuts.voiceHotkey ?? (voiceAvailable ? undefined : promisedTalk);
  const shownAsk = shortcuts.askHotkey ?? (voiceAvailable ? undefined : promisedAsk);
  const shownStop = shortcuts.stopHotkey ?? (voiceAvailable ? undefined : promisedStop);
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
          shortcuts.voiceHotkeyHeld
            ? "Hold to talk, let go to send. Tap instead to keep it open."
            : "Press to talk, again to send, again to interrupt."
        }
        {...(shownTalk ? { shown: shownTalk } : {})}
        chosen={shortcuts.voiceChosen}
        defaultKey={DEFAULT_VOICE_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : {})}
        onChange={shortcuts.onVoiceHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      <ShortcutRow
        title="Ask Luke"
        detail="Press to type to Luke from any app. The same key puts it away."
        {...(shownAsk ? { shown: shownAsk } : {})}
        chosen={shortcuts.askChosen}
        defaultKey={DEFAULT_ASK_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : {})}
        onChange={shortcuts.onAskHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      <ShortcutRow
        title="Stop Luke"
        detail="Press to cut off a reply mid-sentence, from any app. Escape does the same here."
        {...(shownStop ? { shown: shownStop } : {})}
        chosen={shortcuts.stopChosen}
        defaultKey={DEFAULT_STOP_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : {})}
        onChange={shortcuts.onStopHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
    </section>
  );
}

function AccountSection({
  account,
  onSignOut,
  panelOpen,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  onSignOut: () => Promise<void>;
  panelOpen: boolean;
}): React.JSX.Element {
  // Signing out asks first, the way deleting a key does: getting back in costs
  // a whole trip through the browser, so the button asks and only the answer
  // acts. The question follows the removal confirm's one rule about surfaces —
  // it does not survive the panel closing — corrected during the render that
  // discovers it rather than from an effect.
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const keep = useRef<HTMLButtonElement | null>(null);
  if (asking && !panelOpen && !busy) setAsking(false);

  // The question takes the focus to the answer that changes nothing, exactly
  // as the delete confirm does: the control that asked is inert by the time
  // the confirm is drawn.
  useStagedFocus(keep, asking && !busy);

  const signOut = () => {
    setBusy(true);
    void onSignOut().finally(() => {
      setBusy(false);
      setAsking(false);
    });
  };

  return (
    <section className="settings-section" style={{ "--row-index": 4 } as React.CSSProperties}>
      <h2>
        <UserIcon />
        Account
      </h2>
      <div className="settings-row">
        <span className="settings-copy account-identity">
          {/* The provider's own picture of the person, when their identity
              carried one from a host this build pins — otherwise the same
              glyph the heading wears, so the line never shows a broken image. */}
          {account.pictureUrl ? (
            <img
              className="account-avatar"
              src={account.pictureUrl}
              alt=""
              referrerPolicy="no-referrer"
              draggable={false}
            />
          ) : (
            <span className="account-avatar account-avatar-fallback" aria-hidden="true">
              <UserIcon />
            </span>
          )}
          <span className="account-words">
            <span className="settings-name">
              <strong>{account.email}</strong>
            </span>
            <small>
              Signed in with {account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}
            </small>
          </span>
        </span>
        {/* The control and the confirm that stands in for it are the same cell
            of one grid, exactly as a credential row's are, so the line never
            re-shapes as they trade places. */}
        <span className="credential-actions">
          <span
            className="settings-actions credential-controls"
            data-drawn={String(!asking)}
            aria-hidden={asking}
            inert={asking}
          >
            <button
              type="button"
              className="quiet-button account-signout"
              disabled={busy}
              /* The ellipsis is the promise that it asks first. */
              title="Sign out…"
              onClick={() => setAsking(true)}
            >
              Sign out
            </button>
          </span>
          <fieldset
            className="settings-actions credential-confirm"
            aria-label={`Sign out of ${account.email}?`}
            data-drawn={String(asking)}
            aria-hidden={!asking}
            inert={!asking}
            onKeyDown={(event) => {
              // Escape withdraws the question rather than closing the panel it
              // was asked on — but only while it is still a question.
              if (event.key !== "Escape" || busy) return;
              event.stopPropagation();
              setAsking(false);
            }}
          >
            <button
              type="button"
              ref={keep}
              className="quiet-button"
              style={answerOrder(REMOVAL_ANSWER_INDEX.KEEP)}
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-button"
              style={answerOrder(REMOVAL_ANSWER_INDEX.DELETE)}
              disabled={busy}
              onClick={signOut}
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </fieldset>
        </span>
      </div>
    </section>
  );
}

/**
 * The reset a page's header carries, absent while everything the page draws
 * stands at its defaults. Voice, Appearance, and Keyboard shortcuts each
 * offer their own; Connections offers none — the page holds keys and rows
 * that are not settings, and its one resettable group, Workspaces, carries
 * its own control on its own heading instead.
 */
function pageResetControl(
  view: SettingsView,
  settings: AppSettings | undefined,
  shortcuts: ShortcutControl,
  preferences: PreferenceWrites,
): React.JSX.Element | undefined {
  if (view === SETTINGS_VIEW.VOICE && settings && voiceSettingsChanged(settings)) {
    return (
      <ResetGroupButton
        scope={SETTINGS_RESET_SCOPE.VOICE}
        label="the Voice settings"
        onReset={preferences.onSettingsReset}
      />
    );
  }
  if (view === SETTINGS_VIEW.APPEARANCE && settings && appearanceSettingsChanged(settings)) {
    return (
      <ResetGroupButton
        scope={SETTINGS_RESET_SCOPE.APPEARANCE}
        label="the Appearance settings"
        onReset={preferences.onSettingsReset}
      />
    );
  }
  if (view === SETTINGS_VIEW.SHORTCUTS && shortcutSettingsChanged(shortcuts)) {
    return (
      <ResetGroupButton
        scope={SETTINGS_RESET_SCOPE.SHORTCUTS}
        label="the keyboard shortcuts"
        onReset={preferences.onSettingsReset}
      />
    );
  }
  return undefined;
}

function UpdatesSection({ control }: { control: UpdateControl }): React.JSX.Element {
  const row = updateRow(control.update);
  return (
    <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
      <h2>
        <DownloadIcon />
        Updates
      </h2>
      <div className="settings-row">
        <span className="settings-copy">
          <span className="settings-name">
            <strong>Version {control.update.currentVersion}</strong>
            {row.current ? <CheckIcon /> : null}
          </span>
          <small>{row.detail}</small>
        </span>
        {row.action === UPDATE_ROW_ACTION.GET ? (
          <button type="button" className="quiet-button" onClick={control.onOpenLatest}>
            Download
          </button>
        ) : (
          <button
            type="button"
            className="quiet-button"
            disabled={row.action === UPDATE_ROW_ACTION.CHECKING}
            onClick={() => void control.onCheck()}
          >
            {row.action === UPDATE_ROW_ACTION.CHECKING ? "Checking…" : "Check for Updates"}
          </button>
        )}
      </div>
      {/* Always on, like the announcements — stated rather than switched, so
          the disclosure the retired switch carried is still on the row. */}
      <p className="settings-note">
        Luke checks on his own a few times a day. Nothing about you or your sessions is sent.
      </p>
    </section>
  );
}

export function SettingsPanel({
  account,
  onSignOut,
  view,
  onViewChange,
  microphone,
  updates,
  settings,
  voiceService,
  preferences,
  credentials,
  feedback,
  panelOpen,
  workspaceProviders,
  calendar,
  onQuit,
  shortcuts,
}: SettingsPanelProps): React.JSX.Element {
  // Why the front page's Voice row wears its mark, or nothing while voice is
  // fully set up. Judged here rather than on the Voice page because the mark
  // has to stand while that page is not drawn: it is the front page saying a
  // page one press away still needs a hand.
  const voiceNote = voiceAttentionNote({
    voiceAvailable: microphone.voiceAvailable,
    status: microphone.status,
  });
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
  // The drawn page's reset, absent while that page stands at its defaults.
  const pageReset = pageResetControl(drawnView, settings, shortcuts, preferences);
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
          {...(pageReset ? { reset: pageReset } : {})}
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
            <SettingsNavRow
              key={subview}
              view={subview}
              onOpen={onViewChange}
              {...(subview === SETTINGS_VIEW.VOICE && voiceNote ? { attention: voiceNote } : {})}
            />
          ))}
        </section>
      ) : null}

      {drawnView === SETTINGS_VIEW.VOICE && settings ? (
        <VoiceSection
          settings={settings}
          preferences={preferences}
          credentials={credentials}
          panelOpen={panelOpen}
          microphone={microphone}
          {...(voiceService ? { voiceService } : {})}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.APPEARANCE && settings ? (
        <AppearanceSection settings={settings} preferences={preferences} />
      ) : null}

      {drawnView === SETTINGS_VIEW.SHORTCUTS ? (
        <ShortcutSection
          shortcuts={shortcuts}
          {...(settings ? { settings } : {})}
          voiceAvailable={microphone.voiceAvailable}
        />
      ) : null}

      {drawnView === SETTINGS_VIEW.CONNECTIONS && settings ? (
        <>
          <CredentialsSection
            settings={settings}
            control={credentials}
            panelOpen={panelOpen}
            preferences={preferences}
          />
          <IntegrationsSection
            settings={settings}
            control={credentials}
            panelOpen={panelOpen}
            preferences={preferences}
            calendar={calendar}
          />
          <WorkspacesSection
            settings={settings}
            workspaceProviders={workspaceProviders}
            preferences={preferences}
          />
        </>
      ) : null}

      {drawnView !== SETTINGS_VIEW.ROOT ? null : (
        <>
          <UpdatesSection control={updates} />

          <FeedbackSection control={feedback} />

          {/* The account stands last before the way out: signing out and
              quitting are the two acts that end the session, so they live
              together at the foot rather than above the sections still in use. */}
          {account.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <AccountSection account={account} onSignOut={onSignOut} panelOpen={panelOpen} />
          ) : null}

          <button
            type="button"
            className="quit-button"
            style={{ "--row-index": 5 } as React.CSSProperties}
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
