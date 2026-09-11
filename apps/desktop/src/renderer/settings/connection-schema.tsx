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
  VOICE_CREDENTIAL_PROVIDER,
} from "@sidecar/credentials/vocabulary";
import { CloudBadge, ProviderMark } from "@sidecar/panel";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  isProviderId,
  workspaceAgentModels,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA, type SettingsRowsInput } from "@sidecar/settings";
import type { AppSettingsView, CalendarAccount } from "@sidecar/settings/wire";
import { VOICE_SOURCE } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import type { CredentialEntryControl } from "../credential-entry";
import { entryForProvider } from "../credential-entry";
import { SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { CalendarChoices } from "./calendar-choices";
import type {
  AppleCalendarControl,
  CalendarControl,
  LinearControl,
  WorkspaceProviderOption,
} from "./controls";
import { CredentialField } from "./credential-field";
import { HELD_TITLE } from "./notes";
import { WorkspaceAgentRow, WorkspaceProjectRow } from "./workspace-rows";
import type { SettingsWrites } from "./writes";

/**
 * Which run of connections a row stands in. The Voice page draws the one key
 * voice can run on beside the feature it turns on; the Connections page draws
 * the agents Luke watches and the services he merely uses under headings of
 * their own.
 */
export const CONNECTION_SECTION = {
  VOICE_PROVIDER: "voice-provider",
  PROVIDERS: "providers",
  INTEGRATIONS: "integrations",
  /** The two ways into the same meetings, drawn as one block. */
  CALENDAR: "calendar",
} as const;

export type ConnectionSection = (typeof CONNECTION_SECTION)[keyof typeof CONNECTION_SECTION];

/**
 * How much of a block a connection is. A provider gets one of its own, because
 * its key, its creation defaults, and its refusals all belong under one rule; a
 * calendar shares the block its sibling calendar is in, because they are two
 * ways into the same meetings; a Google account is a row inside its own.
 */
export const CONNECTION_LAYOUT = {
  /** Its own block, anchored by its own id. */
  BLOCK: "block",
  /** A line inside a block another entry owns, anchored on the line itself. */
  LINE: "line",
  /** A row inside a connection's own block, named rather than marked. */
  NESTED: "nested",
} as const;

type ConnectionLayout = (typeof CONNECTION_LAYOUT)[keyof typeof CONNECTION_LAYOUT];

/** The control an action wears, which is what says how it reads on the line. */
export const CONNECTION_CONTROL = {
  /** A word on a quiet button: "Connect", "Add account". */
  WORD: "word",
  /** The pencil: this connection stands, and this replaces what it stands on. */
  EDIT: "edit",
  /** The circling arrows: one observation pass, now, by hand. */
  REFRESH: "refresh",
  /** The can: what this row holds, gone. */
  TRASH: "trash",
} as const;

export type ConnectionControl = (typeof CONNECTION_CONTROL)[keyof typeof CONNECTION_CONTROL];

/** How an action that cannot be undone from here asks first, and answers. */
interface ConnectionConfirm {
  /** What is being asked, in the words a hand and a reader both get. */
  question: string;
  /** The dangerous answer's word, and its word while it runs. */
  verb: string;
  running: string;
  act: () => Promise<ActionResult>;
}

/**
 * One thing a connection's row offers. Exactly one of `confirm` and `run`
 * stands: an action that asks first is answered through the confirm, and one
 * that asks nothing runs on its own press. A row offers at most one confirming
 * action, because the question is drawn in the cell its controls were.
 */
export type ConnectionAction = {
  control: ConnectionControl;
  /** The word a `WORD` control wears. */
  word?: string;
  /** Its own name for a hand and a reader alike: "Connect Linear". */
  label: string;
  /** The hover, absent where the label is the whole message. */
  title?: string;
  /** Whether it cannot be pressed right now. */
  disabled?: boolean;
  /** Whether the glyph is turning, for a pass asked for by hand. */
  spinning?: boolean;
} & ({ confirm: ConnectionConfirm; run?: never } | { confirm?: never; run: () => void });

/** What a row says about the connection now. */
interface ConnectionStatus {
  connected: boolean;
  /**
   * Words for what neither the check nor the controls can say. Absent where the
   * check is the whole message.
   */
  words?: React.ReactNode;
}

/**
 * What every row's own condition is judged from: the settings as they stand,
 * and the few facts about the surface around them that decide whether a row is
 * drawn at all. One record, read by the page to decide what to draw and by the
 * settings search to decide what to offer, so a result can never lead to a page
 * without its row.
 */
export interface ConnectionVisibility {
  settings: SettingsRowsInput["settings"];
  /** Whether the Account section — and so the Voice page's Provider — stands. */
  accountDrawn: boolean;
  /** The providers currently offering projects, each drawing a row of its own. */
  workspaceProjects: readonly { id: string; name: string }[];
}

/** Everything one row is judged from, and acted through. */
export interface ConnectionInput {
  /** The one record every row's own condition is judged from. */
  visibility: ConnectionVisibility;
  /** The same settings, resolved, for the rows that draw a stored value. */
  settings: AppSettingsView;
  credentials: CredentialEntryControl;
  calendar: CalendarControl;
  appleCalendar: AppleCalendarControl;
  linear: LinearControl;
  workspaceProviders: readonly WorkspaceProviderOption[];
  writes: SettingsWrites;
  /** True while the surface these rows are drawn on is the shape on screen. */
  panelOpen: boolean;
  /** One observation pass over every calendar source, asked for by hand. */
  refreshing: boolean;
  onRefreshCalendars: () => void;
}

/**
 * One connection Luke can hold, declared once: where its row stands, its mark,
 * its name, how its status is read off the settings snapshot, and every action
 * its row offers. `<ConnectionRow>` is the only thing that draws one.
 *
 * A row is drawn only where `offered` says this build can offer the connection
 * at all — a row whose one action cannot run is not a row.
 */
export interface ConnectionSpec {
  /** The row's own id: its anchor, and what a pressed search result lands on. */
  id: string;
  layout: ConnectionLayout;
  page: SettingsView;
  section: ConnectionSection;
  /** Where in its section it stands, ascending. */
  order: number;
  /**
   * Whether this build can offer the connection at all, judged from the
   * snapshot alone — so the settings search reads the same answer the page
   * does, and a result can never lead to a page without its row.
   */
  offered: (visibility: ConnectionVisibility) => boolean;
  /** Drawn beyond what `offered` says, for a row an entry in flight keeps on
   * screen: a field being filled is not a place a search should send anyone. */
  alsoDrawn?: (input: ConnectionInput) => boolean;
  name: (visibility: ConnectionVisibility) => string;
  /** The mark, always the provider's own — the same mark its session rows wear. */
  mark?: React.ReactNode;
  status: (input: ConnectionInput) => ConnectionStatus;
  actions: (input: ConnectionInput) => readonly ConnectionAction[];
  /**
   * More of the connection itself, drawn under its line and above its refusal.
   * `settling` is true while an answer the row gave is still running, which is
   * what stills anything below the line that writes to the same thing — a
   * checkbox pressed while its account's disconnect is in flight would write to
   * a grant already leaving.
   */
  body?: (input: ConnectionInput, settling: boolean) => React.ReactNode;
  /** Why something a hand asked for was refused, beside the confirm's own answer. */
  refusal?: (input: ConnectionInput) => string | undefined;
  /**
   * What the latest observation pass reported about this connection, which is a
   * state rather than an answer — a revoked grant surfaces on its own row, not
   * in a log, and it is not drawn over a refusal somebody is waiting on.
   */
  note?: (input: ConnectionInput) => string | undefined;
  /** The settings that hang off this connection, drawn under it. */
  children?: (input: ConnectionInput) => React.ReactNode;
  /**
   * Rows this one holds beneath it, whose ids and membership come from
   * observation rather than from the table — a table whose membership changed
   * at run time would not be one.
   */
  nested?: (input: ConnectionInput) => readonly ConnectionSpec[];
  /**
   * The words a query finds this row by, beside its own name — which the search
   * reads from `name`, so a row's label and what finds it cannot drift.
   */
  haystack: readonly string[];
}

/** The words every key row can be found by, beside its provider's name. */
const KEY_WORDS = "API key credential connect cloud agent sync synced";

/* What nothing else on a key line can say on its own. A key kept here needs no
   words at all — the check is the whole message — and no key at all is already
   said by the Connect button standing where the check would be. */
const CREDENTIAL_STATUS = {
  [CREDENTIAL_SOURCE.ENVIRONMENT]: "From environment",
} as const satisfies Partial<Record<CredentialSource, string>>;

/** Whether this system has been asked for encrypted storage and refused. */
export function storageUnavailable(input: ConnectionInput): boolean {
  return input.settings.secretStorage === SECRET_STORAGE.UNAVAILABLE;
}

/** What a provider calls the thing it hands out, which is what the field asks for. */
function credentialWord(provider: CredentialProvider): string {
  return provider.connection === CREDENTIAL_CONNECTION.KEY
    ? (provider.keyFormat?.label ?? "API key")
    : "API key";
}

function workspaceOption(input: ConnectionInput, id: string): WorkspaceProviderOption | undefined {
  return input.workspaceProviders.find((option) => option.id === id);
}

/**
 * A provider's key, as its row: connect, supersede, or delete, whichever the
 * state actually allows. The field only exists while a key is being entered,
 * because a settings tab that is mostly empty input boxes reads as work to do
 * rather than as a state to check.
 *
 * The credential is write-only from here: this can replace or clear the stored
 * key, and the main process never sends one back — only where it was resolved
 * from.
 */
function credentialConnection(
  provider: CredentialProvider,
  where: { page: SettingsView; section: ConnectionSection; order: number },
  offered: (visibility: ConnectionVisibility) => boolean = () => true,
  alsoDrawn?: (input: ConnectionInput) => boolean,
  /** What else this one row can be found by, beside every key row's own words. */
  extraWords?: string,
): ConnectionSpec {
  const credential = credentialWord(provider);
  const source = (input: ConnectionInput): CredentialSource =>
    input.settings.credentialSources[provider.id];
  return {
    id: provider.id,
    layout: CONNECTION_LAYOUT.BLOCK,
    ...where,
    offered,
    ...(alsoDrawn ? { alsoDrawn } : undefined),
    name: () => provider.displayName,
    /* An agent provider's mark carries the same cloud badge its session rows
       do — the key buys the observation of cloud sessions, and the same mark
       cannot differ between the row and the sessions it stands for. Linear and
       OpenAI are services Luke uses rather than sessions he watches, so their
       marks stand alone. */
    mark: (
      <>
        <ProviderMark providerId={provider.id} />
        {providerRunsSessionsInCloud(provider.id) ? <CloudBadge /> : null}
      </>
    ),
    status: (input) => ({
      connected: source(input) !== CREDENTIAL_SOURCE.NONE,
      ...(source(input) === CREDENTIAL_SOURCE.ENVIRONMENT
        ? { words: CREDENTIAL_STATUS[CREDENTIAL_SOURCE.ENVIRONMENT] }
        : undefined),
    }),
    actions: (input) => {
      const control = input.credentials;
      const entry = entryForProvider(control, provider.id);
      const editing = entry !== undefined;
      // Deleting is only ever for a key kept here; one read from the
      // environment is not Luke's to remove. Either can be superseded by a key
      // typed in, so both connected states offer the same editor and only the
      // unconnected one is asked to connect.
      const stored = source(input) === CREDENTIAL_SOURCE.ENCRYPTED_FILE;
      const connected = source(input) !== CREDENTIAL_SOURCE.NONE;
      const busy = entry?.busy ?? false;
      // One credential is entered at a time, because there is one slot to enter
      // it in. A row cannot begin a second entry over the top of one already
      // open — not even another provider's, whose draft is just as likely to be
      // something already pasted — and it says why rather than going quiet for
      // no visible reason.
      const held = control.entry !== undefined && !editing;
      const blocked = busy || storageUnavailable(input) || editing || held;
      // The pencil opens the same editor from either connected state, but it
      // does not mean the same thing: one replaces the key Luke keeps, the
      // other stands in front of one it only reads.
      const editTitle = stored ? "Replace" : "Use a credential stored here";
      return [
        ...(stored
          ? [
              {
                control: CONNECTION_CONTROL.TRASH,
                label: `Delete the ${provider.displayName} ${credential}`,
                /* The ellipsis is the promise that it asks first. */
                title: "Delete…",
                disabled: busy,
                confirm: {
                  question: `Delete the ${provider.displayName} ${credential}?`,
                  verb: "Delete",
                  running: "Deleting…",
                  act: () => control.remove(provider.id),
                },
              } satisfies ConnectionAction,
            ]
          : []),
        connected
          ? ({
              control: CONNECTION_CONTROL.EDIT,
              label: stored
                ? `Replace the ${provider.displayName} ${credential}`
                : `Store a ${provider.displayName} ${credential} instead of the one from the environment`,
              title: held ? HELD_TITLE : editTitle,
              disabled: blocked,
              // Every control that offers to write one begins the one entry,
              // which takes the panel down to the slot. Connect also opens the
              // provider's key page, because whoever is connecting has no key
              // yet; the pencil does not, because whoever is replacing one may
              // already be holding the replacement.
              run: () => control.begin(provider.id),
            } satisfies ConnectionAction)
          : /* Named for its provider like the icon buttons beside it: a list of
               controls read on its own is otherwise two identical Connects. */
            ({
              control: CONNECTION_CONTROL.WORD,
              word: "Connect",
              label: `Connect ${provider.displayName}`,
              ...(held ? { title: HELD_TITLE } : undefined),
              disabled: blocked,
              run: () => control.connect(provider.id),
            } satisfies ConnectionAction),
      ];
    },
    body: (input, settling) => {
      const entry = entryForProvider(input.credentials, provider.id);
      if (!entry) return null;
      return (
        <CredentialField
          provider={provider}
          credential={credential}
          source={source(input)}
          entry={entry}
          control={input.credentials}
          panelOpen={input.panelOpen}
          stilled={settling}
        />
      );
    },
    refusal: (input) => entryForProvider(input.credentials, provider.id)?.rejection,
    children: (input) => {
      // The agent row belongs to providers the build documents a table for, and
      // only while connected: disconnected, there is nothing the choice could
      // apply to, and the line above already says what to do first.
      const agentRow =
        isProviderId(provider.id) &&
        source(input) !== CREDENTIAL_SOURCE.NONE &&
        workspaceAgentModels(provider.id).length > 0
          ? provider.id
          : undefined;
      const workspaceProvider = workspaceOption(input, provider.id);
      return (
        <>
          {agentRow ? (
            <WorkspaceAgentRow
              provider={provider}
              providerId={agentRow}
              {...(input.settings.workspaceAgentDefaults?.[agentRow]
                ? { selection: input.settings.workspaceAgentDefaults[agentRow] }
                : undefined)}
              onChange={(providerId, selection) =>
                input.writes.entry(
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
              settings={input.settings}
              writes={input.writes}
            />
          ) : null}
        </>
      );
    },
    haystack: [
      KEY_WORDS,
      ...(provider.keyFormat ? [provider.keyFormat.label] : []),
      ...(extraWords ? [extraWords] : []),
    ],
  };
}

/** One connected Google account: its address, and which of its calendars count. */
function googleAccountConnection(account: CalendarAccount, order: number): ConnectionSpec {
  return {
    id: `${GOOGLE_CALENDAR_ID}:${account.id}`,
    layout: CONNECTION_LAYOUT.NESTED,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.CALENDAR,
    order,
    offered: () => true,
    name: () => account.id,
    status: () => ({ connected: true }),
    actions: (input) => [
      {
        control: CONNECTION_CONTROL.TRASH,
        label: `Disconnect ${account.id}`,
        /* The ellipsis is the promise that it asks first. */
        title: "Disconnect…",
        confirm: {
          question: `Disconnect ${account.id}?`,
          verb: "Disconnect",
          running: "Disconnecting…",
          act: () => input.calendar.onRemoveAccount(account.id),
        },
      },
    ],
    body: (input, settling) => (
      <CalendarChoices
        account={account}
        calendars={
          input.calendar.choices.find((choice) => choice.accountId === account.id)?.calendars ?? []
        }
        stilled={settling}
        onToggle={(calendarId, selected) =>
          input.calendar.onToggleCalendar(account.id, calendarId, selected)
        }
      />
    ),
    note: (input) =>
      input.calendar.choices.find((choice) => choice.accountId === account.id)?.failure,
    haystack: ["Google Calendar account meetings"],
  };
}

export const CONNECTION_SCHEMA: readonly ConnectionSpec[] = [
  // The key voice can run on, beside the feature it turns on. Its half of the
  // Provider section's picker is what draws it, so it stands only while that
  // half is the live one — or while a key is being entered into it.
  credentialConnection(
    VOICE_CREDENTIAL_PROVIDER,
    { page: SETTINGS_VIEW.VOICE, section: CONNECTION_SECTION.VOICE_PROVIDER, order: 10 },
    (visibility) => visibility.accountDrawn && visibility.settings.voiceSource === VOICE_SOURCE.KEY,
    // An entry in flight keeps the row on screen whichever half is live: the
    // panel brought back around it has to find the field still drawn, and the
    // source itself does not move until the key lands.
    (input) => entryForProvider(input.credentials, VOICE_CREDENTIAL_PROVIDER.id) !== undefined,
    "voice provider",
  ),
  ...CLOUD_AGENT_PROVIDER_LIST.map((provider, index) =>
    credentialConnection(provider, {
      page: SETTINGS_VIEW.CONNECTIONS,
      section: CONNECTION_SECTION.PROVIDERS,
      order: 110 + index * 10,
    }),
  ),
  // Right below the cloud Conductor key row: the local app on this Mac,
  // recognized read-only from its own index with no key and nothing to connect,
  // so the block has no Connect and no disconnect — it stands only while
  // repositories are actually detected, and its whole control is the
  // default-project row every workspace creator draws. Its own block so the two
  // Conductors read as the different places they are.
  {
    id: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
    layout: CONNECTION_LAYOUT.BLOCK,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.PROVIDERS,
    order: 115,
    offered: (visibility) =>
      visibility.workspaceProjects.some(
        (option) => option.id === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
      ),
    name: (visibility) =>
      visibility.workspaceProjects.find(
        (option) => option.id === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
      )?.name ?? "Conductor (local)",
    mark: <ProviderMark providerId={CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID} />,
    status: () => ({ connected: true }),
    actions: () => [],
    children: (input) => {
      const workspaceProvider = workspaceOption(input, CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID);
      if (!workspaceProvider) return null;
      return (
        <WorkspaceProjectRow
          provider={workspaceProvider}
          settings={input.settings}
          writes={input.writes}
        />
      );
    },
    haystack: ["local", "workspaces create this Mac no key integration"],
  },
  // The issue tracker: connected by signing in with Linear, never by a pasted
  // credential, and drawn at all only in a build that carries the OAuth client
  // the sign-in runs on — a row whose one action cannot run is not a row.
  {
    id: CREDENTIAL_PROVIDER_ID.LINEAR,
    layout: CONNECTION_LAYOUT.BLOCK,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.INTEGRATIONS,
    order: 1000,
    offered: (visibility) => visibility.settings.linearSignInAvailable,
    name: () => CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR].displayName,
    mark: <ProviderMark providerId={CREDENTIAL_PROVIDER_ID.LINEAR} />,
    status: (input) => ({
      connected:
        input.settings.credentialSources[CREDENTIAL_PROVIDER_ID.LINEAR] !== CREDENTIAL_SOURCE.NONE,
    }),
    actions: (input) => {
      const provider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
      const connected = input.settings.credentialSources[provider.id] !== CREDENTIAL_SOURCE.NONE;
      if (!connected) {
        return [
          {
            /* The consent page does the connecting: the same word every other
               integration's row uses. */
            control: CONNECTION_CONTROL.WORD,
            word: input.linear.connecting ? "Waiting for Linear…" : "Connect",
            label: `Connect ${provider.displayName} by signing in`,
            ...(input.linear.held ? { title: HELD_TITLE } : undefined),
            disabled: input.linear.held || input.linear.connecting,
            run: input.linear.onSignIn,
          },
        ];
      }
      return [
        {
          control: CONNECTION_CONTROL.TRASH,
          label: `Disconnect ${provider.displayName}`,
          /* The ellipsis is the promise that it asks first. */
          title: "Disconnect…",
          confirm: {
            // Nothing here can hand the grant back, so a disconnect taken on
            // the first press would cost a trip through Linear's consent to
            // undo.
            question: `Disconnect ${provider.displayName}?`,
            verb: "Disconnect",
            running: "Disconnecting…",
            act: input.linear.onDisconnect,
          },
        },
      ];
    },
    haystack: ["issues issue tracker sign in connect integration"],
  },
  // This Mac's own Calendar: the line carries the connection's whole surface —
  // Connect while there is no usable grant, else the refresh and the trash —
  // and the calendar checkboxes sit directly beneath, because one connection
  // needs no second line naming it.
  {
    id: APPLE_CALENDAR_ID,
    layout: CONNECTION_LAYOUT.LINE,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.CALENDAR,
    order: 10,
    offered: (visibility) => visibility.settings.appleCalendarAvailable,
    name: () => APPLE_CALENDAR_NAME,
    mark: <ProviderMark providerId={APPLE_CALENDAR_ID} />,
    // A withdrawn grant reads as not connected: the stored choice stands for a
    // reconnect, but every affordance returns to the beginning.
    status: (input) => ({
      connected: input.settings.appleCalendar !== undefined && !input.appleCalendar.revoked,
    }),
    actions: (input) => {
      const connected = input.settings.appleCalendar !== undefined && !input.appleCalendar.revoked;
      if (!connected) {
        return [
          {
            /* The system's consent dialog does the connecting: the same word
               every other integration's row uses. The panel stands down to the
               slot for it, because Luke floats above the dialog macOS is about
               to show. */
            control: CONNECTION_CONTROL.WORD,
            word: input.appleCalendar.connecting ? "Waiting for macOS…" : "Connect",
            label: "Connect this Mac's calendars",
            ...(input.appleCalendar.held ? { title: HELD_TITLE } : undefined),
            disabled: input.appleCalendar.held || input.appleCalendar.connecting,
            run: input.appleCalendar.onSignIn,
          },
        ];
      }
      return [
        {
          /* A calendar made a moment ago appears on the next pass; this is the
             next pass, asked for by hand. */
          control: CONNECTION_CONTROL.REFRESH,
          label: "Refresh the calendar list",
          title: "Refresh",
          spinning: input.refreshing,
          disabled: input.refreshing,
          run: input.onRefreshCalendars,
        },
        {
          control: CONNECTION_CONTROL.TRASH,
          label: `Disconnect ${APPLE_CALENDAR_NAME}`,
          /* The ellipsis is the promise that it asks first. */
          title: "Disconnect…",
          confirm: {
            question: `Disconnect ${APPLE_CALENDAR_NAME}?`,
            verb: "Disconnect",
            running: "Disconnecting…",
            act: input.appleCalendar.onDisconnect,
          },
        },
      ];
    },
    body: (input, settling) => {
      const account = input.settings.appleCalendar;
      if (!account || input.appleCalendar.revoked) return null;
      return (
        <CalendarChoices
          account={account}
          calendars={input.appleCalendar.choices}
          stilled={settling}
          onToggle={input.appleCalendar.onToggleCalendar}
        />
      );
    },
    haystack: ["meetings Mac calendar connect integration"],
  },
  {
    id: GOOGLE_CALENDAR_ID,
    layout: CONNECTION_LAYOUT.LINE,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.CALENDAR,
    order: 20,
    offered: (visibility) => visibility.settings.calendarSignInAvailable,
    name: () => GOOGLE_CALENDAR_NAME,
    mark: <ProviderMark providerId={GOOGLE_CALENDAR_ID} />,
    status: (input) => ({ connected: input.settings.calendarAccounts.length > 0 }),
    actions: (input) => {
      const connected = input.settings.calendarAccounts.length > 0;
      return [
        {
          /* The consent page does the connecting: the same word every other
             integration's row uses, and a second account is the same action
             worded for what it adds. */
          control: CONNECTION_CONTROL.WORD,
          word: input.calendar.connecting
            ? "Waiting for Google…"
            : connected
              ? "Add account"
              : "Connect",
          label: connected ? "Add another Google account" : "Connect Google Calendar by signing in",
          ...(input.calendar.held ? { title: HELD_TITLE } : undefined),
          disabled: input.calendar.held || input.calendar.connecting,
          run: input.calendar.onSignIn,
        },
      ];
    },
    nested: (input) =>
      input.settings.calendarAccounts.map((account, index) =>
        googleAccountConnection(account, 20 + (index + 1) / 100),
      ),
    haystack: ["meetings account sign in connect integration"],
  },
];

/** Every connection one section of one page draws, in the order the table claims. */
export function connectionsFor(
  page: SettingsView,
  section: ConnectionSection,
): readonly ConnectionSpec[] {
  return CONNECTION_SCHEMA.filter(
    (spec) => spec.page === page && spec.section === section,
  ).toSorted((left, right) => left.order - right.order);
}

/**
 * Where each section stands among the others, which is what orders rows read
 * across them. An entry's own `order` places it inside its section alone — the
 * calendars' 10 and 20 sit below providers' 100 on the page — so sorting by
 * `order` by itself would answer in the reverse of what is drawn.
 */
const SECTION_ORDER = {
  [CONNECTION_SECTION.VOICE_PROVIDER]: 0,
  [CONNECTION_SECTION.PROVIDERS]: 1,
  [CONNECTION_SECTION.INTEGRATIONS]: 2,
  [CONNECTION_SECTION.CALENDAR]: 3,
} satisfies Record<ConnectionSection, number>;

/**
 * Every connection a query can find right now, whatever section draws it, in
 * the order the table claims rather than the order the literal happens to be
 * written in — so a row inserted in the wrong place reads wrong on the page and
 * in the results together, rather than only in one of them.
 */
export function offeredConnections(visibility: ConnectionVisibility): readonly ConnectionSpec[] {
  return CONNECTION_SCHEMA.filter((spec) => spec.offered(visibility)).toSorted(
    (left, right) =>
      SECTION_ORDER[left.section] - SECTION_ORDER[right.section] || left.order - right.order,
  );
}
