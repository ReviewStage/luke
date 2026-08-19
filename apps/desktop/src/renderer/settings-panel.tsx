import {
  DEFAULT_PANEL_FORM_FACTOR,
  type HostedQuota,
  type HostedUsageAnswer,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
  PROVIDER_ID,
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
  WorkspaceProviderId,
} from "../shared/contracts";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  APP_SETTING_DEFAULTS,
  CLI_CONNECTION,
  type CliConnection,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  SETTINGS_RESET_SCOPE,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  VOICE_SOURCE,
  type VoiceSource,
} from "../shared/contracts";
import type { CredentialProvider } from "../shared/credential-providers";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  providerRunsSessionsInCloud,
  VOICE_CREDENTIAL_PROVIDER,
} from "../shared/credential-providers";
import { GOOGLE_CALENDAR_ID, GOOGLE_CALENDAR_NAME } from "../shared/google-calendar";
import { settingsScopeChanged } from "../shared/settings-schema";
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
import { cssCustomProperties } from "./css-custom-properties";
import type { FeedbackEntryControl } from "./feedback-entry";
import { FeedbackSection } from "./feedback-panel";
import { Keycaps } from "./keycaps";
import { type ErrandTarget, errandTargetProps } from "./luke-errand";
import { APP_SETTING_ID } from "./luke-guide";
import {
  currentQuota,
  fresherQuota,
  HOSTED_METER_LABEL,
  hostedVoiceSpentNote,
  MICROPHONE_UNGRANTED_NOTE,
  microphoneAccessRow,
  quotaLevel,
  quotaResetsWhen,
  VOICE_KEYLESS_NOTE,
  VOICE_SOURCE_DETAIL,
  VOICE_SOURCE_LABEL,
  voiceAttentionNote,
  voiceSourceLabel,
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
  LukeIcon,
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
  SETTINGS_SUBVIEW_LIST,
  SETTINGS_VIEW,
  type SettingsSubview,
  type SettingsView,
  settingsNavRowId,
} from "./settings-views";
import { UPDATE_ROW_ACTION, updateAvailable, updateRow } from "./update-row";

/** One provider the default-workspace rows can offer, by id and display name. */
export interface WorkspaceProviderOption {
  id: WorkspaceProviderId;
  name: string;
  /**
   * The projects this provider's default-project row can offer: everything
   * currently observed for it, and nothing else. A stored default the provider
   * has stopped offering has no label of its own to be drawn under, and steers
   * nothing until it is cleared, which the main process does on the same
   * observation that stopped offering it.
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
  /** Turns the counting of Luke's own feature use on or off. */
  onShareUsageDataChange: (enabled: boolean) => Promise<string | undefined>;
  /**
   * Chooses which credential Luke speaks and reviews sessions on. The store
   * answers with why when it refuses, and the toggle is where that answer
   * belongs.
   */
  onVoiceSourceChange: (source: VoiceSource) => Promise<string | undefined>;
  /** Turns the Mac-microphone-over-Bluetooth-headset preference on or off. */
  onPreferBuiltInMicrophoneChange: (enabled: boolean) => Promise<string | undefined>;
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
    providerId: WorkspaceProviderId | undefined,
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
    providerId: WorkspaceProviderId,
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
 // SAFETY: The preceding check establishes the asserted contract.
 * The talk, ask, and stop keys as registered, and the one way to move them
 * or to say a recording is under way. The keys the rows show are the ones
 * that actually answered, which can differ from the stored choice when
 * another app owns the chord — that stored choice is what Reset undoes.
 */
export interface ShortcutControl {
  /**
   // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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
 // SAFETY: The preceding check establishes the asserted contract.
 * The settings tab, as the grouped controls that draw it. A preference write
 * or a shortcut lives on its own bundle so a leaf can change without the
 * panel, the body, or the app's settings object growing a new field.
 */
export interface SettingsPanelProps {
  account: AccountSnapshot;
  onSignOut: () => Promise<void>;
  /**
   * Asks the service to erase the account, resolving to why when it refuses —
   * the row keeps drawing the account it still has, with the answer under it.
   */
  onDeleteAccount: () => Promise<string | undefined>;
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
  /**
   * Today's hosted allowance on both meters, read without spending either.
   * Absent on a keyed or signed-out run, and until the first answer lands.
   */
  hostedUsage?: HostedUsageAnswer;
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
  /** Everything the Linear block can do. */
  linear: LinearControl;
  /** Superset is observed locally; its CLI login only gates actions. */
  superset: SupersetControl;
  onQuit: () => void;
  shortcuts: ShortcutControl;
}

/* What nothing else on the line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
const CREDENTIAL_STATUS = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
} as const satisfies Partial<Record<CredentialSource, string>>;

/* Why a row that could otherwise be connected is not offering to be. */
const HELD_TITLE = "Finish the one you are entering first";

/* The default-workspace row's word for no default at all. An empty value
   rather than a member of the provider set, so no provider id can collide
   with it. */
const ASK_EACH_TIME = "";

/* The agent row's word for no choice at all: the provider's own default. */
const PROVIDER_DEFAULT_VALUE = "";

/* The default-project rows' word for no default at all — the provider row's
   own phrase, so the two rows say the same state the same way. An empty value
   for the ASK_EACH_TIME reason: no provider's project id can collide with it. */
const PROJECT_ASK_EACH_TIME = "";

/* The safe answer arrives first and the one that cannot be taken back lands a
   beat behind it, on the same stagger the panel's rows fan open with. Their
   order on the line is the order they arrive in, so this is their place in it
   rather than a delay written per button. */
const REMOVAL_ANSWER_INDEX = {
  KEEP: 0,
  DELETE: 1,
} as const;

function answerOrder(index: number): React.CSSProperties {
  // SAFETY: The preceding check establishes the asserted contract.
  return { "--answer-index": index } as React.CSSProperties;
}

/**
 * One provider, one line: its mark, its name, whether it is connected, and what
 * can be done about that — connect, supersede, or delete, whichever the state
 * actually allows. The field only exists while a key is being entered, because
 // SAFETY: The preceding check establishes the asserted contract.
 * a settings tab that is mostly empty input boxes reads as work to do rather
 // SAFETY: The preceding check establishes the asserted contract.
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
   * The provider's own sub-rows — what a new agent runs, and where a nameless
   * ask creates. Drawn inside the credential block so the rule that separates
   * providers falls under them, not between them and their line.
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
  const status =
    source === CREDENTIAL_SOURCE.ENVIRONMENT
      ? CREDENTIAL_STATUS[CREDENTIAL_SOURCE.ENVIRONMENT]
      : undefined;
  // The pencil opens the same editor from either connected state, but it does
  // not mean the same thing: one replaces the key Luke keeps, the other stands
  // in front of one it only reads.
  const editTitle = stored ? "Replace" : "Use a credential stored here";
  // Most providers issue an API key. One issues something it calls by another
  // name, and a field asking for the wrong thing sends the user to the page
  // that hands out the credential Luke refuses.
  const credential =
    provider.connection === CREDENTIAL_CONNECTION.KEY
      ? (provider.keyFormat?.label ?? "API key")
      : "API key";
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
            // SAFETY: The preceding check establishes the asserted contract.
            same cell of one grid, so the box is as wide as the wider of the two
            whichever is showing and the provider's name beside it never
            // SAFETY: The preceding check establishes the asserted contract.
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
              // SAFETY: The preceding check establishes the asserted contract.
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
        // SAFETY: The preceding check establishes the asserted contract.
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

// SAFETY: The preceding check establishes the asserted contract.
/* The API names its voices in lowercase; on a control they read as names. The
   default carries its status into the menu, so returning to it never needs the
   README or a memory of what shipped. */
function voiceOptionLabel(voice: RealtimeVoice): string {
  const name = voice.charAt(0).toUpperCase() + voice.slice(1);
  return voice === REALTIME_DEFAULTS.VOICE ? `${name} (default)` : name;
}

// SAFETY: The preceding check establishes the asserted contract.
/* A pace reads as a rate multiple, the way every player writes one. The
   natural rate carries its status into the menu for the same reason the
   default voice does. */
function speedOptionLabel(speed: RealtimeVoiceSpeed): string {
  return speed === REALTIME_DEFAULTS.SPEED ? `${speed}× (default)` : `${speed}×`;
}

// SAFETY: The preceding check establishes the asserted contract.
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
 // SAFETY: The preceding check establishes the asserted contract.
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
   // SAFETY: The preceding check establishes the asserted contract.
   override reads as changed, which is what the row shows too. */
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
  // SAFETY: The preceding check establishes the asserted contract.
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
) {
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
  return { busy, rejection, run } satisfies {
    busy: boolean;
    rejection: string | undefined;
    run: (value: Value) => void;
  };
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
  // SAFETY: The preceding check establishes the asserted contract.
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
          {...(errand ? errandTargetProps(errand) : undefined)}
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
  // SAFETY: The preceding check establishes the asserted contract.
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
            {...(errand ? errandTargetProps(errand) : undefined)}
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
   // SAFETY: The preceding check establishes the asserted contract.
   section: a disabled control with no words beside it reads as broken. */
const STORAGE_UNAVAILABLE_NOTE =
  "This system offers no encrypted credential storage, so Luke will not store a key here.";

/**
 * Which model — and, where its agent takes one, which effort — this provider
 // SAFETY: The preceding check establishes the asserted contract.
 * starts new workspaces with, drawn as sub-rows of its credential line
 * because the choice means nothing until the key above it connects. The
 // SAFETY: The preceding check establishes the asserted contract.
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
            ...(effort ? { effort } : undefined),
          });
        }}
      />
      {chosen && chosen.efforts.length > 0 ? (
        <SelectRow
          label="Effort"
          ariaLabel={`The effort new ${provider.displayName} agents think at`}
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
              ...(effort ? { effort } : undefined),
            });
          }}
        />
      ) : null}
      {write.rejection ? <p className="error-message">{write.rejection}</p> : null}
    </>
  );
}

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * What each answer the Codex CLI can give reads as on its row. Every state
 * has words — unlike a key row, whose check needs none — because the check
 * alone could not say the connection is a CLI login rather than a key, and
 * the disconnected states are exactly where the next step must be named.
 // SAFETY: The preceding check establishes the asserted contract.
 * The step is a command, so it is drawn as one.
 */
const CODEX_CLOUD_STATUS = {
  [CLI_CONNECTION.CONNECTED]: "Via the Codex CLI login",
  [CLI_CONNECTION.SIGNED_OUT]: (
    <>
      Run <code>codex login</code> on your Mac
    </>
  ),
  [CLI_CONNECTION.CLI_MISSING]: "Codex CLI not installed",
  [CLI_CONNECTION.UNKNOWN]: "Not checked yet",
};

/**
 * The one provider observed through its own CLI's login rather than a key.
 * The row reports what the latest pass learned and offers nothing to enter
 * or delete: connecting is `codex login` in the user's own terminal, and
 * signing that CLI out is what disconnects — so the words name that step
 * exactly when it is the missing one, and no control pretends otherwise.
 */
function CodexCloudConnection({
  connection,
  settings,
  preferences,
  workspaceProvider,
}: {
  connection: CliConnection;
  settings: AppSettings;
  preferences: PreferenceWrites;
  /**
   * Codex's own projects, absent until an observation pass reports any. Codex
   * connects by CLI login rather than by key, so it has no credential row to
   * hang its creation defaults under and carries them here instead.
   */
  workspaceProvider?: WorkspaceProviderOption;
}): React.JSX.Element {
  return (
    <div className="credential">
      <div className="credential-row">
        <span className="credential-identity">
          {/* The same mark and cloud badge the codex session rows carry: the
              login buys the observation of cloud tasks, and the same mark
              cannot differ between the row and the sessions it stands for. */}
          <span className="credential-mark">
            <ProviderMark providerId={PROVIDER_ID.CODEX} />
            <CloudBadge />
          </span>
          <span className="credential-name">Codex</span>
          {connection === CLI_CONNECTION.CONNECTED ? <CheckIcon /> : null}
        </span>
        <span className="credential-status">{CODEX_CLOUD_STATUS[connection]}</span>
      </div>
      {connection === CLI_CONNECTION.CONNECTED && workspaceProvider ? (
        <WorkspaceProjectRow
          provider={workspaceProvider}
          settings={settings}
          preferences={preferences}
        />
      ) : null}
    </div>
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
  workspaceProviders,
}: {
  settings: AppSettings;
  control: CredentialEntryControl;
  panelOpen: boolean;
  preferences: PreferenceWrites;
  workspaceProviders: readonly WorkspaceProviderOption[];
}): React.JSX.Element {
  // Only a system Luke has actually asked, and been refused by, is reported as
  // one that cannot hold a key. Until then the rows stand as usual: a warning
  // about storage nobody has tried to use yet would be a guess.
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  const codexWorkspace = workspaceProviders.find((option) => option.id === PROVIDER_ID.CODEX);
  return (
    // SAFETY: The preceding check establishes the asserted contract.
    <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
      <h2>
        <KeyIcon />
        Cloud Agent API keys
      </h2>
      {/* First because the list reads alphabetically, like the key rows below. */}
      <CodexCloudConnection
        connection={settings.codexCloudConnection}
        settings={settings}
        preferences={preferences}
        {...(codexWorkspace ? { workspaceProvider: codexWorkspace } : {})}
      />
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
        const workspaceProvider = workspaceProviders.find((option) => option.id === provider.id);
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
                  : undefined)}
                onChange={preferences.onWorkspaceAgentDefaultChange}
              />
            ) : null}
            {workspaceProvider ? (
              <WorkspaceProjectRow
                provider={workspaceProvider}
                settings={settings}
                preferences={preferences}
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
  // SAFETY: The preceding check establishes the asserted contract.
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
            // SAFETY: The preceding check establishes the asserted contract.
            cell, exactly as the credential rows' do: the cell is as wide and
            // SAFETY: The preceding check establishes the asserted contract.
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
              ? {
                  style: cssCustomProperties({ "--calendar-color": calendar.color }),
                }
              : undefined)}
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
          checked={settings.quietDuringMeetings}
          onChange={preferences.onQuietDuringMeetingsChange}
        />
      ) : null}
    </div>
  );
}

/** What the Linear row can be asked for, which is connecting and ending it. */
export interface LinearControl {
  /** True while another entry holds the slot, which refuses a second act. */
  held: boolean;
  /** True while a sign-in is waiting on the browser. */
  connecting: boolean;
  /** Stands the panel down and opens Linear's consent page. */
  onSignIn: () => void;
  onDisconnect: () => Promise<string | undefined>;
}

export interface SupersetControl {
  installed: boolean;
  connected: boolean;
  held: boolean;
  connecting: boolean;
  onConnect: () => void;
  agents: readonly string[];
  defaultAgent?: string;
  onDefaultAgentChange: (agent: string | undefined) => Promise<string | undefined>;
}

function SupersetIntegration({
  control,
  settings,
  preferences,
  workspaceProvider,
}: {
  control: SupersetControl;
  settings: AppSettings;
  preferences: PreferenceWrites;
  /** Superset's own projects, absent until an observation pass reports any. */
  workspaceProvider?: WorkspaceProviderOption;
}): React.JSX.Element | null {
  if (!control.installed) return null;
  return (
    <div className="credential">
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <PlugIcon />
          </span>
          <span className="credential-name">Superset</span>
          {control.connected ? <CheckIcon /> : null}
        </span>
        {!control.connected ? (
          <span className="settings-actions">
            <button
              type="button"
              className="quiet-button"
              disabled={control.held || control.connecting}
              onClick={control.onConnect}
            >
              {control.connecting ? "Connecting…" : "Connect"}
            </button>
          </span>
        ) : null}
      </div>
      {control.connected && control.agents.length > 0 ? (
        <SelectRow
          label="New Superset sessions run"
          ariaLabel="Default agent for new Superset sessions"
          changed={control.defaultAgent !== undefined}
          value={control.defaultAgent ?? PROVIDER_DEFAULT_VALUE}
          options={[
            { value: PROVIDER_DEFAULT_VALUE, label: "Ask each time" },
            ...control.agents.map((agent) => ({ value: agent, label: agent })),
          ]}
          parse={(raw) =>
            raw === PROVIDER_DEFAULT_VALUE || control.agents.includes(raw) ? raw : undefined
          }
          onChange={(agent) =>
            control.onDefaultAgentChange(agent === PROVIDER_DEFAULT_VALUE ? undefined : agent)
          }
        />
      ) : null}
      {control.connected && workspaceProvider ? (
        <WorkspaceProjectRow
          provider={workspaceProvider}
          settings={settings}
          preferences={preferences}
        />
      ) : null}
    </div>
  );
}

/**
 * The issue tracker: connected by signing in with Linear, never by a pasted
 * credential, and drawn at all only in a build that carries the OAuth client
 * the sign-in runs on — a row whose one act cannot run is not a row.
 */
function LinearIntegration({
  settings,
  linear,
}: {
  settings: AppSettings;
  linear: LinearControl;
}): React.JSX.Element | null {
  const provider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
  // Disconnecting asks first, exactly like deleting a key: nothing here can
  // hand the grant back, so a disconnect taken on the first press would cost
  // a trip through Linear's consent to undo.
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();

  if (!settings.linearSignInAvailable) return null;
  const connected = settings.credentialSources[provider.id] !== CREDENTIAL_SOURCE.NONE;

  const disconnect = async () => {
    setBusy(true);
    setRejection(await linear.onDisconnect());
    setBusy(false);
    setAsking(false);
  };

  return (
    <div className="credential">
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={provider.id} />
          </span>
          <span className="credential-name">{provider.displayName}</span>
          {connected ? <CheckIcon /> : null}
        </span>
        {connected ? (
          /* The trash and the confirm that stands in for it share one grid
             // SAFETY: The preceding check establishes the asserted contract.
             cell, exactly as the credential rows' do: the cell is as wide and
             // SAFETY: The preceding check establishes the asserted contract.
             as tall as the larger of the two whichever is showing, so asking
             the question never re-shapes the line. */
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
                aria-label={`Disconnect ${provider.displayName}`}
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
              aria-label={`Disconnect ${provider.displayName}?`}
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
                onClick={() => void disconnect()}
              >
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </fieldset>
          </span>
        ) : (
          <span className="settings-actions">
            {/* The consent page does the connecting: the same word every
                other integration's row uses. */}
            <button
              type="button"
              className="quiet-button"
              disabled={linear.held || linear.connecting}
              aria-label={`Connect ${provider.displayName} by signing in`}
              title={linear.held ? HELD_TITLE : undefined}
              onClick={linear.onSignIn}
            >
              {linear.connecting ? "Waiting for Linear…" : "Connect"}
            </button>
          </span>
        )}
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </div>
  );
}

/**
 * The services Luke connects to that are not agents: the issue tracker and
 * the calendar. Both are signed into rather than pasted into, so each is a
 * mark, a name and one button, with its own one-line answer to what
 * connecting it buys. The OpenAI key is not here: it lives at the top of the
 * Voice page, beside the feature it turns on.
 */
function IntegrationsSection({
  settings,
  preferences,
  calendar,
  linear,
  superset,
  workspaceProviders,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
  calendar: CalendarControl;
  linear: LinearControl;
  superset: SupersetControl;
  workspaceProviders: readonly WorkspaceProviderOption[];
}): React.JSX.Element {
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  const supersetWorkspace = workspaceProviders.find(
    (option) => option.id === SUPERSET_WORKSPACE_PROVIDER_ID,
  );
  return (
    // SAFETY: The preceding check establishes the asserted contract.
    <section className="settings-section" style={{ "--row-index": 2 } as React.CSSProperties}>
      <h2>
        <PlugIcon />
        Integrations
      </h2>
      <LinearIntegration settings={settings} linear={linear} />
      <SupersetIntegration
        control={superset}
        settings={settings}
        preferences={preferences}
        {...(supersetWorkspace ? { workspaceProvider: supersetWorkspace } : {})}
      />
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
 // SAFETY: The preceding check establishes the asserted contract.
 * front page read as prose rather than as places to go.
 */
const SETTINGS_PAGE = {
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
    // SAFETY: The preceding check establishes the asserted contract.
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
 // SAFETY: The preceding check establishes the asserted contract.
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
  microphone,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
  microphone: MicrophoneControl;
}): React.JSX.Element {
  const microphoneRow = microphoneAccessRow({
    voiceAvailable: microphone.voiceAvailable,
    status: microphone.status,
  });
  return (
    <>
      {/* The key row lives with the account on the front page — voice's
          two ways in stand together there. This page holds what voice does
          once it runs; while it cannot run, the one section says where to
          turn it on rather than drawing settings for a feature two steps
          from working. The line stays because it is the way in, not a
          description of one: without it the page is a heading and a tooltip. */}
      {settings.voiceAvailable ? null : (
        // SAFETY: The preceding check establishes the asserted contract.
        <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
          <h2>
            <KeyIcon />
            Voice
            <AttentionMark note={VOICE_KEYLESS_NOTE} />
          </h2>
          <p className="settings-note">{VOICE_KEYLESS_NOTE}</p>
        </section>
      )}
      {/* Drawn only once there is a voice for the microphone to reach: until
          then, the permission guards a feature that cannot run, and the page
          holds the one thing to do next rather than a queue of them. */}
      {settings.voiceAvailable ? (
        // SAFETY: The preceding check establishes the asserted contract.
        <section className="settings-section" style={{ "--row-index": 1 } as React.CSSProperties}>
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
              {microphoneRow.detail ? <small>{microphoneRow.detail}</small> : undefined}
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

/** The voice controls themselves, below the permission that lets Luke listen. */
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
      // SAFETY: The preceding check establishes the asserted contract.
      style={{ "--row-index": 2 } as React.CSSProperties}
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
        changed={settings.duckOtherMedia !== APP_SETTING_DEFAULTS.duckOtherMedia}
        checked={settings.duckOtherMedia}
        onChange={preferences.onDuckOtherMediaChange}
      />
      <SwitchRow
        label="Prefer the Mac's microphone"
        ariaLabel="Listen through the Mac's own microphone instead of a Bluetooth headset's"
        errand={APP_SETTING_ID.PREFER_BUILT_IN_MICROPHONE}
        changed={settings.preferBuiltInMicrophone !== APP_SETTING_DEFAULTS.preferBuiltInMicrophone}
        checked={settings.preferBuiltInMicrophone}
        onChange={preferences.onPreferBuiltInMicrophoneChange}
      />
    </section>
  );
}

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * Where Luke stands and how he is drawn: the Dock as a second door, every
 * display or just the main one, and the form he takes on a display
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
      // SAFETY: The preceding check establishes the asserted contract.
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
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
    // SAFETY: The preceding check establishes the asserted contract.
    <section className="settings-section" style={{ "--row-index": 3 } as React.CSSProperties}>
      {/* The heading and the group's reset share a line. The reset groups by
          meaning rather than by position: it covers every workspace-creation
          default on this page, including the per-provider rows drawn beside
          the providers they belong to. Only the keys are exempt — they are not
          settings and are never reset. */}
      <div className="settings-heading">
        <h2>
          <FolderIcon />
          Workspaces
        </h2>
        {settingsScopeChanged(settings, SETTINGS_RESET_SCOPE.WORKSPACES) ? (
          <ResetGroupButton
            scope={SETTINGS_RESET_SCOPE.WORKSPACES}
            label="the workspace defaults"
            onReset={preferences.onSettingsReset}
          />
        ) : null}
      </div>
      <SelectRow
        label="Default workspace provider"
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
          if (workspaceProviders.some((option) => option.id === raw)) {
            return raw;
          }
          return undefined;
        }}
        onChange={(next) => {
          if (next === ASK_EACH_TIME)
            return preferences.onDefaultWorkspaceProviderChange(undefined);
          const provider = workspaceProviders.find((option) => option.id === next);
          if (provider) return preferences.onDefaultWorkspaceProviderChange(provider.id);
        }}
      />
    </section>
  );
}

/**
 * Where one provider's nameless creation ask lands: filled in the way the
 * provider default is — by the first creation there — and this select is where
 * that choice is seen, changed, or returned to the first creation. Drawn under
 * its own provider, beside what a new agent there runs, because both answer
 * the same question about the same provider; the label leaves the provider to
 * the heading above it and the aria-label carries it for a reader arriving
 * without that context.
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
  if (provider.projects.length === 0) return null;
  const stored = settings.workspaceProjectDefaults?.[providerId];
  // A stored default the provider has stopped offering is on its way out: the
  // main process clears it on the same observation, and until that write lands
  // the row reads as the unchosen state it is about to become. Drawing the
  // stored value instead would leave the select on an option it does not hold.
  const shown =
    stored !== undefined && provider.projects.some((project) => project.id === stored)
      ? stored
      : PROJECT_ASK_EACH_TIME;
  return (
    <SelectRow
      label="Default project"
      ariaLabel={`The project a nameless ask creates ${provider.name} workspaces in`}
      changed={shown !== PROJECT_ASK_EACH_TIME}
      value={shown}
      options={[
        // The provider row's own words for the same state: until a default
        // exists, an ambiguous ask is asked about, and the two rows should
        // say that identically.
        { value: PROJECT_ASK_EACH_TIME, label: "Ask each time" },
        ...provider.projects.map((project) => ({ value: project.id, label: project.label })),
      ]}
      parse={(raw) => {
        if (raw === PROJECT_ASK_EACH_TIME) return raw;
        // The set is the one this row offered, so anything else arriving out
        // of the select is a broken control rather than a choice.
        return provider.projects.some((project) => project.id === raw) ? raw : undefined;
      }}
      onChange={(next) =>
        preferences.onWorkspaceProjectDefaultChange(
          providerId,
          next === PROJECT_ASK_EACH_TIME ? undefined : next,
        )
      }
    />
  );
}

/* What a talk key may be: offered the moment recording starts, and restated
   in the error line for the keystroke that was not one. */
const SHORTCUT_HINT = "Hold ⌃, ⌥ or ⌘ — ⇧ may join — and press a letter or Space.";

/**
 // SAFETY: The preceding check establishes the asserted contract.
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
 // SAFETY: The preceding check establishes the asserted contract.
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
  // SAFETY: The preceding check establishes the asserted contract.
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
      // SAFETY: The preceding check establishes the asserted contract.
      style={{ "--row-index": 1 } as React.CSSProperties}
    >
      <ShortcutRow
        title="Talk to Luke"
        // What the key actually does, which depends on whether it can report
        // being let go of. Describing a hold to someone whose key can only
        // toggle would leave them holding it and wondering.
        detail={
          shortcuts.voiceHotkeyHeld
            ? "Hold to talk, let go to send."
            : "Press to talk, again to send."
        }
        {...(shownTalk ? { shown: shownTalk } : undefined)}
        chosen={shortcuts.voiceChosen}
        defaultKey={DEFAULT_VOICE_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : undefined)}
        onChange={shortcuts.onVoiceHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      <ShortcutRow
        title="Ask Luke"
        detail="Press to type to Luke from any app."
        {...(shownAsk ? { shown: shownAsk } : undefined)}
        chosen={shortcuts.askChosen}
        defaultKey={DEFAULT_ASK_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : undefined)}
        onChange={shortcuts.onAskHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
      <ShortcutRow
        title="Stop Luke"
        detail="Press to cut off a reply, from any app."
        {...(shownStop ? { shown: shownStop } : undefined)}
        chosen={shortcuts.stopChosen}
        defaultKey={DEFAULT_STOP_HOTKEYS[0] ?? ""}
        {...(attention ? { attention } : undefined)}
        onChange={shortcuts.onStopHotkeyChange}
        onCapture={shortcuts.onCapture}
      />
    </section>
  );
}

/* Which question the Account section is asking, at most one at a time: both
   acts end in the same signed-out place, so their confirms never stand side
   by side. */
const ACCOUNT_ASK = {
  NONE: "none",
  SIGN_OUT: "sign-out",
  DELETE: "delete",
} as const;

type AccountAsk = (typeof ACCOUNT_ASK)[keyof typeof ACCOUNT_ASK];

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * One meter of today's allowance, drawn as a track the day fills. The native
 * `meter` rather than a progressbar, because nothing is underway: it reports
 * a level against a limit. Nothing about it animates — a changed value snaps
 * in place and only the section's arrival staggers.
 *
 * The fill is the working blue every live thing on the surface wears, and it
 * turns to the attention orange while the day is running out — at the same
 * level, and for the same reason, a session row wears it: something is about
 * to need the developer. The bar and the sentence beside it therefore say the
 * same thing at the same moment.
 */
function UsageMeter({ label, quota }: { label: string; quota: HostedQuota }): React.JSX.Element {
  const capped = Math.min(quota.used, quota.limit);
  return (
    <div className="usage-meter" data-level={quotaLevel(quota)}>
      <span className="usage-words" aria-hidden="true">
        <small>{label}</small>
        <small>
          {quota.remaining} of {quota.limit} left
        </small>
      </span>
      <meter
        className="usage-track"
        min={0}
        max={quota.limit > 0 ? quota.limit : 1}
        value={quota.limit > 0 ? capped : 1}
        aria-label={`${label}: ${quota.remaining} of ${quota.limit} left today`}
      />
    </div>
  );
}

/**
 * The choice itself: two halves side by side, each carrying its own name, with
 * the live one marked. A radio group rather than two buttons, because it is
 * one value from a small fixed set — the same thing a
 * pop-up would be, drawn open because there are only two and the whole point
 * is seeing them together.
 *
 * Pressing the half that is already live does nothing. Pressing the other
 * either switches to a key already stored, or — with none — begins the entry
 * that would store one, which is the same act the row's Connect was: a source
 * you have not supplied yet has to be supplied before it can be chosen.
 */
function VoiceSourceToggle({
  source,
  keyStored,
  storageLocked,
  onChoose,
  onConnect,
}: {
  // SAFETY: The preceding check establishes the asserted contract.
  /** Which source is actually running, as the store resolved it. */
  source: VoiceSource;
  /** Whether a key is stored at all, which decides what its half does. */
  keyStored: boolean;
  /** Whether this system can hold a key, which decides whether it can at all. */
  storageLocked: boolean;
  onChoose: (source: VoiceSource) => Promise<string | undefined>;
  /** Begins the entry, which stands the panel down to the slot. */
  onConnect: () => void;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChoose);
  return (
    <>
      {/* Real radios under the drawing, the way the calendar's choices are
          real checkboxes: one value from a set of two is exactly what a radio
          group is, and taking the native one means the arrow keys, the
          grouping, and the announcement all come with it. */}
      <div className="source-toggle">
        {[VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY].map((candidate) => {
          const live = candidate === source;
          // The key's half is the one that can be unavailable: a machine with
          // no encrypted storage has nowhere to put one, so it can neither be
          // supplied nor chosen. The account's half is always there — this
          // section is only drawn for a signed-in account.
          const blocked = candidate === VOICE_SOURCE.KEY && storageLocked;
          // A key not yet supplied cannot be chosen, so its half says what
          // pressing it will actually do.
          const asksForKey = candidate === VOICE_SOURCE.KEY && !keyStored;
          return (
            <label
              key={candidate}
              /* The Feedback section's own button, wearing its class rather
                 than a copy of its measurements: the two sections offer the
                 same kind of pair a few rows apart, and one that drifted from
                 the other would be the drift nobody notices. */
              className="quiet-button source-choice"
              data-live={String(live)}
              title={blocked ? STORAGE_UNAVAILABLE_NOTE : undefined}
            >
              <input
                type="radio"
                className="visually-hidden"
                name="voice-source"
                value={candidate}
                checked={live}
                disabled={busy || blocked}
                aria-label={voiceSourceLabel(candidate)}
                onChange={() => {
                  // With no key stored there is nothing to switch to yet, so
                  // the press asks for one instead of storing a choice that
                  // would resolve straight back to where it started.
                  if (asksForKey) onConnect();
                  else run(candidate);
                }}
              />
              <span className="source-name">
                {VOICE_SOURCE_LABEL[candidate]}
                {live ? <CheckIcon /> : null}
              </span>
              <small>
                {asksForKey ? "Connect a key to use it" : VOICE_SOURCE_DETAIL[candidate]}
              </small>
            </label>
          );
        })}
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
    </>
  );
}

/**
 * The one question this section settles: which credential Luke speaks and
 * reviews sessions on. Both answers stand here, side by side and switchable,
 * because a choice split across two places — an allowance here, a key row
 * there — is a choice nobody knows they have. It leads the front page: what
 * Luke is running on, and what is left of it today, is the first thing worth
 * knowing.
 *
 * The account itself is not here. Signing out and deleting are rare acts that
 * cannot be taken back, and they sit at the foot of the page with the other
 * ways out; this section is only ever read and switched.
 */
function WhatLukeRunsOnSection({
  panelOpen,
  storageLocked,
  settings,
  credentials,
  preferences,
  voiceService,
  hostedUsage,
  rowIndex,
}: {
  panelOpen: boolean;
  /** Where the section stands in the page's arrival stagger, counted by the caller. */
  rowIndex: number;
  /**
   * Whether this system cannot store a key at all. The key half cannot be
   * chosen or supplied then, and it says why rather than going quiet.
   */
  storageLocked: boolean;
  settings: AppSettings;
  /** The one credential being entered anywhere; the key row here uses it. */
  credentials: CredentialEntryControl;
  preferences: PreferenceWrites;
  voiceService?: RealtimeDiagnostics;
  hostedUsage?: HostedUsageAnswer;
}): React.JSX.Element {
  const keySource = settings.credentialSources[VOICE_CREDENTIAL_PROVIDER.id];
  const keyStored = keySource !== CREDENTIAL_SOURCE.NONE;
  const entering = entryForProvider(credentials, VOICE_CREDENTIAL_PROVIDER.id) !== undefined;
  const hosted = settings.voiceSource === VOICE_SOURCE.ACCOUNT;
  // Which half's contents stand below. The live one, except while a key is
  // being entered: an entry in flight is that half being supplied, and the
  // panel brought back around it has to find the field still drawn — the
  // source itself does not move until the key lands.
  const keyBody = !hosted || entering;
  // The freshest reading of each meter, wherever it came from: the usage read
  // against the quota the last mint carried, day and remainder telling the two
  // apart — and neither counted past its own reset, because a spent yesterday
  // must not be drawn as an almost-back today.
  const now = Date.now();
  const voiceQuota = hosted
    ? fresherQuota(currentQuota(hostedUsage?.voice, now), currentQuota(voiceService?.quota, now))
    : undefined;
  // Decided, not missed: a same-day reviews reading may trail a fresher voice
  // mint, because mints say nothing about reviews — dropping it would delete
  // the only reviews count for no accuracy gained. The skew is bounded by the
  // refresh riding every settings change and tab turn, and a different day
  // still discards it.
  const reviewQuota =
    voiceQuota && hostedUsage && hostedUsage.attention.resetsAt === voiceQuota.resetsAt
      ? hostedUsage.attention
      : undefined;
  return (
    <section
      className="settings-section"
      // SAFETY: The preceding check establishes the asserted contract.
      style={{ "--row-index": rowIndex } as React.CSSProperties}
    >
      <h2>
        <LukeIcon />
        What Luke runs on
        {/* The mark for voice having nothing to run on sits where both ways
            in are drawn: the two halves of the toggle below. */}
        {settings.voiceAvailable ? null : <AttentionMark note={VOICE_KEYLESS_NOTE} />}
      </h2>
      <VoiceSourceToggle
        source={settings.voiceSource}
        keyStored={keyStored}
        storageLocked={storageLocked}
        onChoose={preferences.onVoiceSourceChange}
        onConnect={() => credentials.begin(VOICE_CREDENTIAL_PROVIDER.id)}
      />
      {/* Each half's own contents, drawn under the toggle for whichever is
          live. They answer the same two questions in the two ways the sources
          differ: the allowance is a quantity, so it draws bars and says when
          they return; a key is a connection, so it draws the connection and
          says what runs on it. Neither half explains the other — the toggle
          above is where they are compared. */}
      {keyBody ? (
        <ProviderCredential
          provider={VOICE_CREDENTIAL_PROVIDER}
          source={keySource}
          storageUnavailable={storageLocked}
          control={credentials}
          panelOpen={panelOpen}
        />
      ) : (
        /* The day's allowance from the usage read, or the voice meter alone
           from the quota the last mint carried while no read has answered.
           Every reading in hand having outlived its day reads as no reading at
           all, and draws no meters rather than promising numbers. */
        voiceQuota && (
          <>
            <UsageMeter label={HOSTED_METER_LABEL.VOICE} quota={voiceQuota} />
            {reviewQuota ? (
              <UsageMeter label={HOSTED_METER_LABEL.REVIEWS} quota={reviewQuota} />
            ) : null}
            <p className="settings-note">
              {voiceQuota.remaining === 0
                ? hostedVoiceSpentNote(quotaResetsWhen(voiceQuota.resetsAt, now))
                : `Resets ${quotaResetsWhen(voiceQuota.resetsAt, now)}.`}
            </p>
          </>
        )
      )}
      {storageLocked ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}

/**
 * Who is signed in, and the two ways out of that. It sits at the foot of the
 * front page rather than at its head: what an account is spending is checked
 * daily and belongs up top, where What Luke runs on now draws it, while signing
 * out and deleting are done once or never. Both ways out ask before they act.
 */
function AccountSection({
  account,
  onSignOut,
  onDeleteAccount,
  panelOpen,
}: {
  account: Extract<AccountSnapshot, { status: typeof ACCOUNT_STATUS.SIGNED_IN }>;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<string | undefined>;
  panelOpen: boolean;
}): React.JSX.Element {
  // Signing out asks first, the way deleting a key does: getting back in costs
  // a whole trip through the browser, so the button asks and only the answer
  // acts. Deleting asks harder still — it erases the account at the service,
  // which no sign-in brings back. Each question follows the removal confirm's
  // one rule about surfaces — it does not survive the panel closing —
  // corrected during the render that discovers it rather than from an effect.
  const [asking, setAsking] = useState<AccountAsk>(ACCOUNT_ASK.NONE);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const keepSignedIn = useRef<HTMLButtonElement | null>(null);
  const keepAccount = useRef<HTMLButtonElement | null>(null);
  if (asking !== ACCOUNT_ASK.NONE && !panelOpen && !busy) setAsking(ACCOUNT_ASK.NONE);
  const askingSignOut = asking === ACCOUNT_ASK.SIGN_OUT;
  const askingDelete = asking === ACCOUNT_ASK.DELETE;

  // The question takes the focus to the answer that changes nothing, exactly
  // as the delete confirm does: the control that asked is inert by the time
  // the confirm is drawn.
  useStagedFocus(keepSignedIn, askingSignOut && !busy);
  useStagedFocus(keepAccount, askingDelete && !busy);

  // Escape withdraws the question rather than closing the panel it was asked
  // on — but only while it is still a question.
  const withdrawOnEscape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || busy) return;
    event.stopPropagation();
    setAsking(ACCOUNT_ASK.NONE);
  };

  const signOut = () => {
    setBusy(true);
    void onSignOut().finally(() => {
      setBusy(false);
      setAsking(ACCOUNT_ASK.NONE);
    });
  };

  // Success signs out, which unmounts this whole section; a refusal keeps the
  // account and says so under the row it was asked on.
  const deleteAccount = () => {
    setBusy(true);
    setRejection(undefined);
    void onDeleteAccount().then((reason) => {
      setRejection(reason);
      setBusy(false);
      setAsking(ACCOUNT_ASK.NONE);
    });
  };

  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 6 })}>
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
            // SAFETY: The preceding check establishes the asserted contract.
            of one grid, exactly as a credential row's are, so the line never
            // SAFETY: The preceding check establishes the asserted contract.
            re-shapes as they trade places. */}
        <span className="credential-actions">
          <span
            className="settings-actions credential-controls"
            data-drawn={String(!askingSignOut)}
            aria-hidden={askingSignOut}
            inert={askingSignOut}
          >
            <button
              type="button"
              className="quiet-button account-signout"
              disabled={busy}
              /* The ellipsis is the promise that it asks first. */
              title="Sign out…"
              onClick={() => setAsking(ACCOUNT_ASK.SIGN_OUT)}
            >
              Sign out
            </button>
          </span>
          <fieldset
            className="settings-actions credential-confirm"
            aria-label={`Sign out of ${account.email}?`}
            data-drawn={String(askingSignOut)}
            aria-hidden={!askingSignOut}
            inert={!askingSignOut}
            onKeyDown={withdrawOnEscape}
          >
            <button
              type="button"
              ref={keepSignedIn}
              className="quiet-button"
              style={answerOrder(REMOVAL_ANSWER_INDEX.KEEP)}
              disabled={busy}
              onClick={() => setAsking(ACCOUNT_ASK.NONE)}
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
              {busy && askingSignOut ? "Signing out…" : "Sign out"}
            </button>
          </fieldset>
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Delete account</strong>
        </span>
        <span className="credential-actions">
          <span
            className="settings-actions credential-controls"
            data-drawn={String(!askingDelete)}
            aria-hidden={askingDelete}
            inert={askingDelete}
          >
            <button
              type="button"
              className="quiet-button account-delete"
              disabled={busy}
              /* The ellipsis is the promise that it asks first. */
              title="Delete account…"
              onClick={() => setAsking(ACCOUNT_ASK.DELETE)}
            >
              Delete
            </button>
          </span>
          <fieldset
            className="settings-actions credential-confirm"
            aria-label={`Delete the account ${account.email}? This cannot be undone.`}
            data-drawn={String(askingDelete)}
            aria-hidden={!askingDelete}
            inert={!askingDelete}
            onKeyDown={withdrawOnEscape}
          >
            <button
              type="button"
              ref={keepAccount}
              className="quiet-button"
              style={answerOrder(REMOVAL_ANSWER_INDEX.KEEP)}
              disabled={busy}
              onClick={() => setAsking(ACCOUNT_ASK.NONE)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-button"
              style={answerOrder(REMOVAL_ANSWER_INDEX.DELETE)}
              disabled={busy}
              onClick={deleteAccount}
            >
              {busy && askingDelete ? "Deleting…" : "Delete account"}
            </button>
          </fieldset>
        </span>
      </div>
      {rejection ? <p className="error-message">{rejection}</p> : null}
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
  preferences: PreferenceWrites,
): React.JSX.Element | undefined {
  if (
    view === SETTINGS_VIEW.VOICE &&
    settings &&
    settingsScopeChanged(settings, SETTINGS_RESET_SCOPE.VOICE)
  ) {
    return (
      <ResetGroupButton
        scope={SETTINGS_RESET_SCOPE.VOICE}
        label="the Voice settings"
        onReset={preferences.onSettingsReset}
      />
    );
  }
  if (
    view === SETTINGS_VIEW.APPEARANCE &&
    settings &&
    settingsScopeChanged(settings, SETTINGS_RESET_SCOPE.APPEARANCE)
  ) {
    return (
      <ResetGroupButton
        scope={SETTINGS_RESET_SCOPE.APPEARANCE}
        label="the Appearance settings"
        onReset={preferences.onSettingsReset}
      />
    );
  }
  if (
    view === SETTINGS_VIEW.SHORTCUTS &&
    settings &&
    settingsScopeChanged(settings, SETTINGS_RESET_SCOPE.SHORTCUTS)
  ) {
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

/**
 * Where the build stands against the latest release. It sits below the pages
 * until a newer release is positively known, and leads the front page while
 * one is — the place in the stack is itself the answer to "is there news",
 * the same answer the Settings tab's dot gives from outside. The caller says
 * where it stands, because the arrival stagger is counted by the page.
 */
function UpdatesSection({
  control,
  rowIndex,
}: {
  control: UpdateControl;
  rowIndex: number;
}): React.JSX.Element {
  const row = updateRow(control.update);
  return (
    <section
      className="settings-section"
      // SAFETY: The preceding check establishes the asserted contract.
      style={{ "--row-index": rowIndex } as React.CSSProperties}
    >
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
          /* The one button on the page with somewhere new to go, in the same
             accent the tab's dot announced it with; every other state of this
             row keeps the quiet button, because checking is maintenance. */
          <button type="button" className="action-button" onClick={control.onOpenLatest}>
            Download
          </button>
        ) : (
          <button
            type="button"
            className="quiet-button"
            disabled={row.action === UPDATE_ROW_ACTION.CHECKING}
            onClick={() => void control.onCheck()}
          >
            {row.action === UPDATE_ROW_ACTION.CHECKING ? "Checking…" : "Check for updates"}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The one thing Luke sends without being asked, and the switch for it. It sits
 * beside Updates because both are always-on background behaviours rather than
 * features with a page: the section is where the developer learns the counting
 * happens at all, so the detail says what travels rather than only naming the
 * switch.
 */
function UsageDataSection({
  settings,
  preferences,
}: {
  settings: AppSettings;
  preferences: PreferenceWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 4 })}>
      <h2>
        <ShieldIcon />
        Usage data
      </h2>
      <SwitchRow
        label="Share usage data"
        ariaLabel="Share counts of how Luke's own features are used"
        errand={APP_SETTING_ID.SHARE_USAGE_DATA}
        // Tied to the account rather than anonymous, because that is the
        // honest claim and the narrow one is what the allowlist buys.
        detail="Counts of feature use, tied to your account. Never session contents."
        changed={settings.shareUsageData !== APP_SETTING_DEFAULTS.shareUsageData}
        checked={settings.shareUsageData}
        onChange={preferences.onShareUsageDataChange}
      />
    </section>
  );
}

export function SettingsPanel({
  account,
  onSignOut,
  onDeleteAccount,
  view,
  onViewChange,
  microphone,
  updates,
  settings,
  voiceService,
  hostedUsage,
  preferences,
  credentials,
  feedback,
  panelOpen,
  workspaceProviders,
  calendar,
  linear,
  superset,
  onQuit,
  shortcuts,
}: SettingsPanelProps): React.JSX.Element {
  // Why the front page's Voice row wears its mark, or nothing while voice is
  // fully set up. Judged here rather than on the Voice page because the mark
  // has to stand while that page is not drawn: it is the front page saying a
  // page one press away still needs a hand. The keyless half moved to the
  // Account and usage heading with the ways in, so the row marks only a
  // microphone still ungranted for a voice that can run.
  const voiceNote = microphone.voiceAvailable
    ? voiceAttentionNote({ voiceAvailable: true, status: microphone.status })
    : undefined;
  // Moving between pages moves the keyboard with it: into a page, onto its
  // back button; back out, onto the row that opened the page just left. Keyed
  // to the page, because the control being reached for only exists once the
  // new page is mounted. Only while the panel is the shape on screen — a
  // view reset behind a closed panel is housekeeping, and reaching into an
  // inert stage would find nothing focusable anyway.
  const backControl = useRef<HTMLButtonElement | null>(null);
  const heldView = useRef(view);
  useEffect(() => {
    const previous = heldView.current;
    heldView.current = view;
    if (previous === view || !panelOpen) return;
    if (view === SETTINGS_VIEW.ROOT) {
      if (previous !== SETTINGS_VIEW.ROOT) {
        document.getElementById(settingsNavRowId(previous))?.focus();
      }
      return;
    }
    backControl.current?.focus();
  }, [view, panelOpen]);
  // The drawn page's reset, absent while that page stands at its defaults.
  const pageReset = pageResetControl(view, settings, preferences);
  // Whether the Updates section leads the front page instead of sitting below
  // the pages: a newer release waiting is the one piece of news this page can
  // hold, and news is not filed under maintenance.
  const updateLeads = updateAvailable(updates.update);
  return (
    <div
      className="settings"
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SETTINGS)}
      aria-labelledby={panelTabId(PANEL_TAB.SETTINGS)}
    >
      {view !== SETTINGS_VIEW.ROOT ? (
        <SettingsPageHeader
          view={view}
          onBack={() => onViewChange(SETTINGS_VIEW.ROOT)}
          backControl={backControl}
          {...(pageReset ? { reset: pageReset } : undefined)}
        />
      ) : null}

      {view === SETTINGS_VIEW.ROOT ? (
        /* The front page: what voice runs on and what is left of it today,
           then one row per page, then the sections that answer at a glance —
           what Luke is allowed, what he counts about his own use, the way to
           the founders, whose account this is, and the way out. The allowance leads because it is the one
           thing here worth checking daily; the account itself follows the
           page down to the ways out, which are done once or never. A newer
           // SAFETY: The preceding check establishes the asserted contract.
           release waiting takes the head of the page for as long as it
           stands, because it is the one thing here that is news rather than
           state, and the row indexes below count past it so the arrival
           stagger keeps one order with the sections. */
        <>
          {updateLeads ? <UpdatesSection control={updates} rowIndex={1} /> : null}
          {account.status === ACCOUNT_STATUS.SIGNED_IN && settings ? (
            <WhatLukeRunsOnSection
              rowIndex={updateLeads ? 2 : 1}
              panelOpen={panelOpen}
              storageLocked={settings.secretStorage === SECRET_STORAGE.UNAVAILABLE}
              settings={settings}
              credentials={credentials}
              preferences={preferences}
              {...(voiceService ? { voiceService } : undefined)}
              {...(hostedUsage ? { hostedUsage } : undefined)}
            />
          ) : null}
          <section
            className="settings-section settings-index"
            // SAFETY: The preceding check establishes the asserted contract.
            style={{ "--row-index": updateLeads ? 3 : 2 } as React.CSSProperties}
          >
            {SETTINGS_SUBVIEW_LIST.map((subview) => (
              <SettingsNavRow
                key={subview}
                view={subview}
                onOpen={onViewChange}
                {...(subview === SETTINGS_VIEW.VOICE && voiceNote
                  ? { attention: voiceNote }
                  : undefined)}
              />
            ))}
          </section>
        </>
      ) : null}

      {view === SETTINGS_VIEW.VOICE && settings ? (
        <VoiceSection settings={settings} preferences={preferences} microphone={microphone} />
      ) : null}

      {view === SETTINGS_VIEW.APPEARANCE && settings ? (
        <AppearanceSection settings={settings} preferences={preferences} />
      ) : null}

      {view === SETTINGS_VIEW.SHORTCUTS ? (
        <ShortcutSection
          shortcuts={shortcuts}
          {...(settings ? { settings } : undefined)}
          voiceAvailable={microphone.voiceAvailable}
        />
      ) : null}

      {view === SETTINGS_VIEW.CONNECTIONS && settings ? (
        <>
          <CredentialsSection
            settings={settings}
            control={credentials}
            panelOpen={panelOpen}
            preferences={preferences}
            workspaceProviders={workspaceProviders}
          />
          <IntegrationsSection
            settings={settings}
            preferences={preferences}
            calendar={calendar}
            linear={linear}
            superset={superset}
            workspaceProviders={workspaceProviders}
          />
          <WorkspacesSection
            settings={settings}
            workspaceProviders={workspaceProviders}
            preferences={preferences}
          />
        </>
      ) : null}

      {view !== SETTINGS_VIEW.ROOT ? null : (
        <>
          {updateLeads ? null : <UpdatesSection control={updates} rowIndex={3} />}

          {settings ? <UsageDataSection settings={settings} preferences={preferences} /> : null}

          <FeedbackSection control={feedback} />

          {/* The account and the two ways out of it, last of the sections:
              signing out and deleting are rare, cannot be taken back, and
              have nothing to do with the allowance the page opens on. */}
          {account.status === ACCOUNT_STATUS.SIGNED_IN ? (
            <AccountSection
              account={account}
              onSignOut={onSignOut}
              onDeleteAccount={onDeleteAccount}
              panelOpen={panelOpen}
            />
          ) : null}

          <button
            type="button"
            className="quit-button"
            style={cssCustomProperties({ "--row-index": 7 })}
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
