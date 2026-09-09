import {
  APPLE_CALENDAR_ID,
  APPLE_CALENDAR_NAME,
  GOOGLE_CALENDAR_ID,
  GOOGLE_CALENDAR_NAME,
} from "@sidecar/calendar/vocabulary";
import type { CredentialProvider, CredentialSource } from "@sidecar/credentials/vocabulary";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_SOURCE,
  providerRunsSessionsInCloud,
  SECRET_STORAGE,
} from "@sidecar/credentials/vocabulary";
import {
  CheckIcon,
  CloudBadge,
  CloudIcon,
  FolderIcon,
  KeyIcon,
  PencilIcon,
  PlugIcon,
  ProviderMark,
  RefreshIcon,
  TrashIcon,
} from "@sidecar/panel";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  isProviderId,
  PROVIDER_ID,
  workspaceAgentModels,
} from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  SETTINGS_PAGE as SCHEMA_SETTINGS_PAGE,
  SETTING_SECTION,
  type SettingsRowsInput,
} from "@sidecar/settings";
import type { AccountCalendar, AppSettingsView, CalendarAccount } from "@sidecar/settings/wire";
import { CLI_CONNECTION, type CliConnection } from "@sidecar/settings/wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import type { ActionResult } from "@sidecar/wire";
import { Fragment, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "#shared/messages/session";
import { tell } from "../act";
import {
  CREDENTIAL_PLACEHOLDER,
  type CredentialEntryControl,
  entryForProvider,
  isSubmittable,
  useStagedFocus,
} from "../credential-entry";
import { DestinationNote } from "../destination-note";
import { APP_SETTING_ID } from "../luke-guide";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-search";
import { CalendarChoices } from "./calendar-choices";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";
import type {
  AppleCalendarControl,
  CalendarControl,
  LinearControl,
  SupersetControl,
  WorkspaceProviderOption,
} from "./controls";
import { HELD_TITLE, STORAGE_UNAVAILABLE_NOTE } from "./notes";
import { SchemaSettingRows } from "./schema-rows";
import { SelectRow } from "./select-row";
import { actionRejection } from "./use-setting-write";
import { PROVIDER_DEFAULT_VALUE, WorkspaceAgentRow, WorkspaceProjectRow } from "./workspace-rows";
import type { SettingsWrites } from "./writes";

/* What nothing else on the line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
export const CREDENTIAL_STATUS = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
} as const satisfies Partial<Record<CredentialSource, string>>;

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
export function ProviderCredential({
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
  const field = useRef<HTMLInputElement | null>(null);
  const fieldId = `${provider.id}-api-key`;
  const entry = entryForProvider(control, provider.id);
  const editing = entry !== undefined;
  // Deleting is only ever for a key kept here; one read from the environment is
  // not Luke's to remove. Either can be superseded by a key typed in, so both
  // connected states offer the same editor and only the unconnected one is
  // asked to connect.
  const stored = source === CREDENTIAL_SOURCE.ENCRYPTED_FILE;
  const connected = source !== CREDENTIAL_SOURCE.NONE;
  // Deleting is the one action that begins and ends on this line, question and
  // answer both. Entering a credential does not: it can leave for the slot and
  // come back, so it is held above.
  const removal = useConfirm({ subject: stored, surfaceOpen: panelOpen }, () =>
    control.remove(provider.id),
  );
  const busy = removal.busy || (entry?.busy ?? false);
  const rejection = removal.rejection ?? entry?.rejection;
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

  // Every control that offers to write one begins the one entry — which takes
  // the panel down to the slot — and clears whatever the last attempt was
  // rejected for on the way. Connect also opens the provider's key page,
  // because whoever is connecting has no key yet; the pencil does not, because
  // whoever is replacing one may already be holding the replacement.
  const beginEntry = () => {
    removal.clear();
    control.begin(provider.id);
  };

  const connectEntry = () => {
    removal.clear();
    control.connect(provider.id);
  };

  return (
    // Anchored by the provider's own id, so a pressed search result can bring
    // this line into view.
    <div className="credential" {...searchAnchorProps(provider.id)}>
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
        <ConfirmSwap
          {...(stored
            ? {
                question: `Delete the ${provider.displayName} ${credential}?`,
                stage: removal.stage,
                verb: "Delete",
                running: "Deleting…",
                onKeep: removal.keep,
                onAct: removal.run,
              }
            : undefined)}
        >
          {/* Only ever offered for a key Luke keeps, because that is the only
              key it has any business deleting. */}
          {stored ? (
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={busy}
              aria-label={`Delete the ${provider.displayName} ${credential}`}
              /* The ellipsis is the promise that it asks first. */
              title="Delete…"
              onClick={removal.ask}
            >
              <TrashIcon />
            </button>
          ) : null}
          {connected ? (
            <button
              type="button"
              className="icon-button"
              disabled={beginBlocked}
              aria-label={editLabel}
              title={held ? HELD_TITLE : editTitle}
              onClick={beginEntry}
            >
              <PencilIcon />
            </button>
          ) : (
            /* Named for its provider like the icon buttons beside it: a list of
               controls read on its own is otherwise two identical Connects. */
            <button
              type="button"
              className="quiet-button"
              disabled={beginBlocked}
              aria-label={`Connect ${provider.displayName}`}
              title={held ? HELD_TITLE : undefined}
              onClick={connectEntry}
            >
              Connect
            </button>
          )}
        </ConfirmSwap>
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
                tell(ACT_KIND.WINDOW_FOCUS_PANEL);
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
            {provider.hint ? (
              <DestinationNote
                {...provider.hint}
                disabled={busy}
                onOpen={() => control.fetchKey()}
              />
            ) : null}
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
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * What each answer the Codex CLI can give reads as on its row. Every state
 * has words — unlike a key row, whose check needs none — because the check
 * alone could not say the connection is a CLI login rather than a key, and
 * the disconnected states are exactly where the next step must be named.
 * The step is a command, so it is drawn as one.
 */
export const CODEX_CLOUD_STATUS = {
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
export function CodexCloudConnection({
  connection,
  settings,
  writes,
  workspaceProvider,
}: {
  connection: CliConnection;
  settings: AppSettingsView;
  writes: SettingsWrites;
  /**
   * Codex's own projects, absent until an observation pass reports any. Codex
   * connects by CLI login rather than by key, so it has no credential row to
   * hang its creation defaults under and carries them here instead.
   */
  workspaceProvider?: WorkspaceProviderOption;
}): React.JSX.Element {
  return (
    <div className="credential" {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODEX_CLOUD)}>
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
        <WorkspaceProjectRow provider={workspaceProvider} settings={settings} writes={writes} />
      ) : null}
    </div>
  );
}

/**
 * Every agent provider that can hold a key, one line each. A provider is
 * listed whether or not it has one, because the list is how you learn which
 * services Luke can watch at all.
 */
export function CredentialsSection({
  settings,
  control,
  panelOpen,
  writes,
  superset,
  workspaceProviders,
}: {
  settings: AppSettingsView;
  control: CredentialEntryControl;
  panelOpen: boolean;
  writes: SettingsWrites;
  superset: SupersetControl;
  workspaceProviders: readonly WorkspaceProviderOption[];
}): React.JSX.Element {
  // Only a system Luke has actually asked, and been refused by, is reported as
  // one that cannot hold a key. Until then the rows stand as usual: a warning
  // about storage nobody has tried to use yet would be a guess.
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  const codexWorkspace = workspaceProviders.find((option) => option.id === PROVIDER_ID.CODEX);
  const supersetWorkspace = workspaceProviders.find(
    (option) => option.id === SUPERSET_WORKSPACE_PROVIDER_ID,
  );
  const conductorLocalWorkspace = workspaceProviders.find(
    (option) => option.id === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  );
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 3 })}>
      <h2>
        <KeyIcon />
        Providers
      </h2>
      {/* First because the list reads alphabetically, like the key rows below. */}
      <CodexCloudConnection
        connection={settings.codexCloudConnection}
        settings={settings}
        writes={writes}
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
          <Fragment key={provider.id}>
            <ProviderCredential
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
                  onChange={(providerId, selection) =>
                    writes.entry(
                      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
                      providerId,
                      selection,
                    )
                  }
                />
              ) : null}
              {workspaceProvider ? (
                <WorkspaceProjectRow
                  provider={workspaceProvider}
                  settings={settings}
                  writes={writes}
                />
              ) : null}
            </ProviderCredential>
            {/* Right below the cloud Conductor key row: the local app on this
                Mac, recognized with no key. Its own block so the two Conductors
                read as the different places they are — a repository here versus
                a cloud project behind a key — rather than one name twice. */}
            {provider.id === PROVIDER_ID.CONDUCTOR && conductorLocalWorkspace ? (
              <ConductorLocalIntegration
                workspaceProvider={conductorLocalWorkspace}
                settings={settings}
                writes={writes}
              />
            ) : null}
          </Fragment>
        );
      })}
      {/* Last because the list reads alphabetically. Superset is the other
          agent surface connected through its own CLI's login rather than a
          key, so it stands as its own block the way the Codex row does. */}
      <SupersetIntegration
        control={superset}
        settings={settings}
        panelOpen={panelOpen}
        writes={writes}
        {...(supersetWorkspace ? { workspaceProvider: supersetWorkspace } : {})}
      />
      {/* The same refusal the trackers' section explains: a Connect stilled by
          missing storage needs its why in this section too. */}
      {storageUnavailable ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}

/**
 * The one choice spanning every key row: whether a saved key also syncs to
 * the account's vault on Luke's service. Its own section between the
 * workspace choice and the key rows it governs, because it belongs to all of
 * them and to none; the switch's whole act runs in the main process, where
 * the keys are.
 */
export function KeySyncSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 2 })}>
      <h2>
        <CloudIcon />
        Sync
      </h2>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
        section={SETTING_SECTION.SYNC}
        view={view}
        writes={writes}
      />
    </section>
  );
}

/**
 * One connected Google account: its address, the trash that disconnects it,
 * and the checkboxes choosing which of its calendars count.
 */
export function CalendarAccountRow({
  account,
  calendars,
  failure,
  panelOpen,
  onRemove,
  onToggle,
}: {
  account: CalendarAccount;
  calendars: readonly AccountCalendar[];
  /** Why the latest pass could not read the account, when it could not. */
  failure?: string;
  /** True while the surface this row is drawn on is the shape on screen. */
  panelOpen: boolean;
  onRemove: () => Promise<ActionResult>;
  onToggle: (calendarId: string, selected: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  // The account going takes this row with it, so the question's subject is the
  // row itself; the surface is what it has to be asked in front of.
  const removal = useConfirm({ subject: true, surfaceOpen: panelOpen }, onRemove);
  const [toggling, setToggling] = useState(false);
  const [toggleRejection, setToggleRejection] = useState<string>();
  const busy = removal.busy || toggling;

  const toggleCalendar = async (calendarId: string, selected: boolean) => {
    setToggling(true);
    setToggleRejection(actionRejection(await onToggle(calendarId, selected)));
    setToggling(false);
  };

  return (
    <div className="calendar-account">
      <div className="calendar-account-row">
        <span className="calendar-account-name">{account.id}</span>
        <ConfirmSwap
          question={`Disconnect ${account.id}?`}
          stage={removal.stage}
          verb="Disconnect"
          running="Disconnecting…"
          onKeep={removal.keep}
          onAct={removal.run}
        >
          <button
            type="button"
            className="icon-button credential-remove"
            disabled={busy}
            aria-label={`Disconnect ${account.id}`}
            /* The ellipsis is the promise that it asks first. */
            title="Disconnect…"
            onClick={removal.ask}
          >
            <TrashIcon />
          </button>
        </ConfirmSwap>
      </div>
      <CalendarChoices
        account={account}
        calendars={calendars}
        disabled={busy}
        onToggle={(calendarId, selected) => void toggleCalendar(calendarId, selected)}
      />
      {/* An action just refused, else what the latest pass reported — a revoked
          grant surfaces on its own row, not in a log. */}
      {(removal.rejection ?? toggleRejection ?? failure) ? (
        <p className="error-message">{removal.rejection ?? toggleRejection ?? failure}</p>
      ) : null}
    </div>
  );
}

/**
 * This Mac's own Calendar as one row: the header carries the connection's
 * whole surface — Connect while there is no usable grant, else the refresh
 * and the trash — and the calendar checkboxes sit directly beneath, because
 * one connection needs no second line naming it.
 */
export function AppleCalendarRow({
  account,
  appleCalendar,
  panelOpen,
  onRefresh,
}: {
  /** The stored connection, absent while not connected. */
  account: CalendarAccount | undefined;
  appleCalendar: AppleCalendarControl;
  /** True while the surface this row is drawn on is the shape on screen. */
  panelOpen: boolean;
  /** Runs one observation pass now, so a calendar just created appears. */
  onRefresh: () => Promise<void>;
}): React.JSX.Element {
  const [toggling, setToggling] = useState(false);
  const [toggleRejection, setToggleRejection] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  // A withdrawn grant reads as not connected: the stored choice stands for a
  // reconnect, but every affordance returns to the beginning.
  const connected = account !== undefined && !appleCalendar.revoked;
  // The grant is the question's subject: withdrawn in System Settings, there is
  // nothing left to disconnect and the row is offering Connect again.
  const removal = useConfirm(
    { subject: connected, surfaceOpen: panelOpen },
    appleCalendar.onDisconnect,
  );
  const busy = removal.busy || toggling;

  const toggleCalendar = async (calendarId: string, selected: boolean) => {
    setToggling(true);
    setToggleRejection(actionRejection(await appleCalendar.onToggleCalendar(calendarId, selected)));
    setToggling(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <div className="credential-row" {...searchAnchorProps(APPLE_CALENDAR_ID)}>
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={APPLE_CALENDAR_ID} />
          </span>
          <span className="credential-name">{APPLE_CALENDAR_NAME}</span>
          {connected ? <CheckIcon /> : null}
        </span>
        {connected ? (
          <ConfirmSwap
            question={`Disconnect ${APPLE_CALENDAR_NAME}?`}
            stage={removal.stage}
            verb="Disconnect"
            running="Disconnecting…"
            onKeep={removal.keep}
            onAct={removal.run}
          >
            {/* A calendar made a moment ago appears on the next pass; this
                is the next pass, asked for by hand. */}
            <button
              type="button"
              className="icon-button"
              data-spinning={String(refreshing)}
              disabled={refreshing || busy}
              aria-label="Refresh the calendar list"
              title="Refresh"
              onClick={() => void refresh()}
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={busy}
              aria-label={`Disconnect ${APPLE_CALENDAR_NAME}`}
              /* The ellipsis is the promise that it asks first. */
              title="Disconnect…"
              onClick={removal.ask}
            >
              <TrashIcon />
            </button>
          </ConfirmSwap>
        ) : (
          <span className="settings-actions">
            {/* The system's consent dialog does the connecting: the same
                word every other integration's row uses. The panel stands
                down to the slot for it, because Luke floats above the
                dialog macOS is about to show. */}
            <button
              type="button"
              className="quiet-button"
              disabled={appleCalendar.held || appleCalendar.connecting}
              aria-label="Connect this Mac's calendars"
              title={appleCalendar.held ? HELD_TITLE : undefined}
              onClick={appleCalendar.onSignIn}
            >
              {appleCalendar.connecting ? "Waiting for macOS…" : "Connect"}
            </button>
          </span>
        )}
      </div>
      {connected && account ? (
        <CalendarChoices
          account={account}
          calendars={appleCalendar.choices}
          disabled={busy}
          onToggle={(calendarId, selected) => void toggleCalendar(calendarId, selected)}
        />
      ) : null}
      {/* Only an action just refused: a pass that could not read surfaces as
          the row's own state — a withdrawn grant is the Connect button
          standing again — never as standing red text. */}
      {(removal.rejection ?? toggleRejection) ? (
        <p className="error-message">{removal.rejection ?? toggleRejection}</p>
      ) : null}
    </>
  );
}

/**
 * The calendar integrations, drawn as one block because they are one
 * capability: two ways into the same meetings — this Mac's own Calendar
 * behind macOS's consent dialog, and Google accounts behind Google's consent
 * page — sharing one line about what is read and the quiet switch the
 * intervals exist to drive. Each row appears only in a build that can offer
 * it, and the block only when either can.
 */
export function CalendarIntegrations({
  settings,
  view,
  calendar,
  appleCalendar,
  panelOpen,
  writes,
}: {
  settings: AppSettingsView;
  /**
   * What the quiet row's own condition is judged from, absent for the
   * onboarding gate, which borrows this block without that row: the setting
   * defaults on, and a switch offered before the first calendar is even
   * confirmed reads as one more demand rather than a choice.
   */
  view?: SettingsRowsInput;
  calendar: CalendarControl;
  appleCalendar: AppleCalendarControl;
  /** True while the surface this block is drawn on is the shape on screen. */
  panelOpen: boolean;
  writes: SettingsWrites;
}): React.JSX.Element | null {
  if (!settings.calendarSignInAvailable && !settings.appleCalendarAvailable) return null;
  const accounts = settings.calendarAccounts;

  return (
    <div className="credential">
      {settings.appleCalendarAvailable ? (
        <AppleCalendarRow
          account={settings.appleCalendar}
          appleCalendar={appleCalendar}
          panelOpen={panelOpen}
          onRefresh={calendar.onRefresh}
        />
      ) : null}
      {settings.calendarSignInAvailable ? (
        <>
          <div className="credential-row" {...searchAnchorProps(GOOGLE_CALENDAR_ID)}>
            <span className="credential-identity">
              <span className="credential-mark">
                <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
              </span>
              <span className="credential-name">{GOOGLE_CALENDAR_NAME}</span>
              {accounts.length > 0 ? <CheckIcon /> : null}
            </span>
            <span className="settings-actions">
              {/* The consent page does the connecting: the same word every
                  other integration's row uses, and a second account is the
                  same action worded for what it adds. */}
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
          {accounts.map((account) => {
            const observed = calendar.choices.find((choice) => choice.accountId === account.id);
            return (
              <CalendarAccountRow
                key={account.id}
                account={account}
                calendars={observed?.calendars ?? []}
                {...(observed?.failure ? { failure: observed.failure } : {})}
                panelOpen={panelOpen}
                onRemove={() => calendar.onRemoveAccount(account.id)}
                onToggle={(calendarId, selected) =>
                  calendar.onToggleCalendar(account.id, calendarId, selected)
                }
              />
            );
          })}
        </>
      ) : null}
      <p className="settings-note">
        Luke reads when your meetings start and end — never their titles — and can hold
        announcements until they finish.
      </p>
      {/* The quiet is a fact about the calendars above it, so it appears with
          the first connection and leaves with the last — a switch gating what
          a disconnected calendar cannot do would be a control over nothing.
          That condition is the setting's own, so this only says where. */}
      {view ? (
        <SchemaSettingRows
          page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
          section={SETTING_SECTION.CALENDAR}
          view={view}
          writes={writes}
        />
      ) : null}
    </div>
  );
}

/**
 * Local Conductor: the app on this Mac, recognized read-only from its own
 * index with no key and nothing to connect, so the block has no Connect and no
 * disconnect — it stands only while repositories are actually detected, and its
 * whole control is the default-project row every workspace creator draws. It
 * is deliberately its own block beside the cloud Conductor key row, so the two
 * Conductors are told apart by where they are rather than sharing one name.
 */
export function ConductorLocalIntegration({
  workspaceProvider,
  settings,
  writes,
}: {
  /** Local Conductor's repositories, present only once a read reported any. */
  workspaceProvider: WorkspaceProviderOption;
  settings: AppSettingsView;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <div className="credential" {...searchAnchorProps(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID)}>
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID} />
          </span>
          <span className="credential-name">{workspaceProvider.name}</span>
          <CheckIcon />
        </span>
      </div>
      <WorkspaceProjectRow provider={workspaceProvider} settings={settings} writes={writes} />
    </div>
  );
}

export function SupersetIntegration({
  control,
  settings,
  panelOpen,
  writes,
  workspaceProvider,
}: {
  control: SupersetControl;
  settings: AppSettingsView;
  /** True while the surface this row is drawn on is the shape on screen. */
  panelOpen: boolean;
  writes: SettingsWrites;
  /** Superset's own projects, absent until an observation pass reports any. */
  workspaceProvider?: WorkspaceProviderOption;
}): React.JSX.Element | null {
  // Disconnecting asks first, exactly like deleting a key: the sign-out
  // clears the CLI's stored login, so a disconnect taken on the first press
  // would cost a whole new sign-in to undo.
  const removal = useConfirm(
    { subject: control.connected, surfaceOpen: panelOpen },
    control.onDisconnect,
  );

  if (!control.installed) return null;

  return (
    <div className="credential" {...searchAnchorProps(SUPERSET_WORKSPACE_PROVIDER_ID)}>
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />
          </span>
          <span className="credential-name">Superset</span>
          {control.connected ? <CheckIcon /> : null}
        </span>
        {control.connected ? (
          <ConfirmSwap
            question="Disconnect Superset?"
            stage={removal.stage}
            verb="Disconnect"
            running="Disconnecting…"
            onKeep={removal.keep}
            onAct={removal.run}
          >
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={removal.busy}
              aria-label="Disconnect Superset"
              /* The ellipsis is the promise that it asks first. */
              title="Disconnect…"
              onClick={removal.ask}
            >
              <TrashIcon />
            </button>
            {/* The pencil is the credential rows' word for editing a
                connection that already stands. Here the connection is the
                CLI's own login, so editing it is signing in again — the same
                action the Connect button runs, which is how the CLI switches
                organizations. */}
            <button
              type="button"
              className="icon-button"
              disabled={removal.busy || control.held || control.connecting}
              aria-label="Sign in to Superset again"
              title={control.held ? HELD_TITLE : "Sign in again"}
              onClick={() => {
                removal.clear();
                control.onConnect();
              }}
            >
              <PencilIcon />
            </button>
          </ConfirmSwap>
        ) : (
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
        )}
      </div>
      {removal.rejection ? (
        <p className="error-message" role="alert">
          {removal.rejection}
        </p>
      ) : null}
      {control.connected && control.agents.length > 0 ? (
        <SelectRow
          label="New Superset sessions run"
          anchor={APP_SETTING_ID.SUPERSET_AGENT}
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
        <WorkspaceProjectRow provider={workspaceProvider} settings={settings} writes={writes} />
      ) : null}
    </div>
  );
}

/**
 * The issue tracker: connected by signing in with Linear, never by a pasted
 * credential, and drawn at all only in a build that carries the OAuth client
 * the sign-in runs on — a row whose one action cannot run is not a row.
 */
export function LinearIntegration({
  settings,
  linear,
  panelOpen,
}: {
  settings: AppSettingsView;
  linear: LinearControl;
  /** True while the surface this row is drawn on is the shape on screen. */
  panelOpen: boolean;
}): React.JSX.Element | null {
  const provider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
  const connected = settings.credentialSources[provider.id] !== CREDENTIAL_SOURCE.NONE;
  // Disconnecting asks first, exactly like deleting a key: nothing here can
  // hand the grant back, so a disconnect taken on the first press would cost
  // a trip through Linear's consent to undo.
  const removal = useConfirm({ subject: connected, surfaceOpen: panelOpen }, linear.onDisconnect);

  if (!settings.linearSignInAvailable) return null;

  return (
    <div className="credential" {...searchAnchorProps(provider.id)}>
      <div className="credential-row">
        <span className="credential-identity">
          <span className="credential-mark">
            <ProviderMark providerId={provider.id} />
          </span>
          <span className="credential-name">{provider.displayName}</span>
          {connected ? <CheckIcon /> : null}
        </span>
        {connected ? (
          <ConfirmSwap
            question={`Disconnect ${provider.displayName}?`}
            stage={removal.stage}
            verb="Disconnect"
            running="Disconnecting…"
            onKeep={removal.keep}
            onAct={removal.run}
          >
            <button
              type="button"
              className="icon-button credential-remove"
              disabled={removal.busy}
              aria-label={`Disconnect ${provider.displayName}`}
              /* The ellipsis is the promise that it asks first. */
              title="Disconnect…"
              onClick={removal.ask}
            >
              <TrashIcon />
            </button>
          </ConfirmSwap>
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
      {removal.rejection ? (
        <p className="error-message" role="alert">
          {removal.rejection}
        </p>
      ) : null}
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
export function IntegrationsSection({
  settings,
  view,
  panelOpen,
  writes,
  calendar,
  appleCalendar,
  linear,
}: {
  settings: AppSettingsView;
  view: SettingsRowsInput;
  panelOpen: boolean;
  writes: SettingsWrites;
  calendar: CalendarControl;
  appleCalendar: AppleCalendarControl;
  linear: LinearControl;
}): React.JSX.Element {
  const storageUnavailable = settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 4 })}>
      <h2>
        <PlugIcon />
        Integrations
      </h2>
      <LinearIntegration settings={settings} linear={linear} panelOpen={panelOpen} />
      <CalendarIntegrations
        settings={settings}
        view={view}
        calendar={calendar}
        appleCalendar={appleCalendar}
        panelOpen={panelOpen}
        writes={writes}
      />
      {/* The same refusal the agents' section explains: a Connect stilled by
          missing storage needs its why in this section too. */}
      {storageUnavailable ? <p className="settings-note">{STORAGE_UNAVAILABLE_NOTE}</p> : null}
    </section>
  );
}

/**
 * What a conversational ask creates and where, beside the connections it
 * creates through: its own named group on the Connections page, because the
 * default is about every provider at once rather than any one row.
 */
export function WorkspacesSection({
  view,
  writes,
}: {
  view: SettingsRowsInput;
  writes: SettingsWrites;
}): React.JSX.Element {
  return (
    <section className="settings-section" style={cssCustomProperties({ "--row-index": 1 })}>
      {/* No group reset here: the workspace-creation defaults live as rows
          beside the providers they belong to, and a reset by this one select
          would reach settings drawn under other headings. */}
      <h2>
        <FolderIcon />
        Workspaces
      </h2>
      <SchemaSettingRows
        page={SCHEMA_SETTINGS_PAGE.CONNECTIONS}
        section={SETTING_SECTION.WORKSPACES}
        view={view}
        writes={writes}
      />
    </section>
  );
}
