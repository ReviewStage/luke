import { APP_PANEL_TAB, APP_SETTING_ID, type AppPanelTab, type AppSettingId } from "@sidecar/guide";
import { ISSUE_TRACKER_ID, type IssueTrackerId } from "@sidecar/issues";
import {
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  type ProviderId,
  SESSION_STATUS,
  type SessionStatus,
} from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  isWireString,
  parseReleaseVersion,
  type UnparsedWireValue,
} from "@sidecar/wire";

/**
 * What the desktop may count about its own use, and the one reader both sides
 * run over it. `hosted-service.ts` holds the contracts for what Luke's service
 * *answers*; this holds the contract for what the desktop *asks* it to record.
 *
 * The vocabulary is the privacy boundary, not a convention on top of one. An
 * event is a name from this file, and every property value is a member of an
 * `as const` set here, a rung on the session-count ladder, or a release
 * version — so a session title, a branch, a path, a recap, a prompt, or an
 * error line has no shape it could travel in. Nothing observed and nothing
 * typed or spoken can be expressed, and the reader below builds its output
 * from the allowlist rather than from the envelope, so a field cannot be
 * smuggled through by naming it.
 */

export const PRODUCT_EVENT = {
  APP_LAUNCH: "app:launch",
  APP_DAY_ACTIVE: "app:day_active",
  ACCOUNT_SIGN_IN: "account:sign_in",
  ACCOUNT_ACT: "account:act",
  PROVIDER_CONNECT: "provider:connect",
  PROVIDER_DISCONNECT: "provider:disconnect",
  TRACKER_CONNECT: "tracker:connect",
  TRACKER_DISCONNECT: "tracker:disconnect",
  CALENDAR_CONNECT: "calendar:connect",
  CALENDAR_DISCONNECT: "calendar:disconnect",
  SUPERSET_ACT: "superset:act",
  SESSION_OBSERVE: "session:observe",
  SESSION_ACT_SEND: "session:act_send",
  ISSUE_ACT_SEND: "issue:act_send",
  PANEL_OPEN: "panel:open",
  PANEL_TAB_CHANGE: "panel:tab_change",
  SETTINGS_VIEW_OPEN: "settings:view_open",
  SETTINGS_RESET: "settings:reset",
  SEARCH_OPEN: "search:open",
  UPDATE_ACT: "update:act",
  FEEDBACK_OPEN: "feedback:open",
  FEEDBACK_SEND: "feedback:send",
  ASK_SUBMIT: "ask:submit",
  VOICE_CALL_START: "voice:call_start",
  VOICE_EXCHANGE: "voice:exchange",
  VOICE_PERMISSION: "voice:permission",
  VOICE_ANNOUNCEMENT_SPEAK: "voice:announcement_speak",
  SETTING_UPDATE: "setting:update",
  USAGE_SHARING_STOP: "usage:sharing_stop",
  USAGE_SHARING_RESUME: "usage:sharing_resume",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENT)[keyof typeof PRODUCT_EVENT];

/**
 * The events the renderer may ask the main process to count, and the whole of
 * what the surface channel carries. Everything else is emitted where the act
 * itself happens, in the main process; these are surface motion the main
 * process cannot see — which tab is drawn, which page a row opened, whether a
 * search field was summoned. Keeping the set small and separate is what makes
 * the channel narrow: the handler validates against this union rather than
 * against every name, so a compromised renderer gains no reach into the acts.
 */
export const PRODUCT_SURFACE_EVENT = {
  PANEL_OPEN: PRODUCT_EVENT.PANEL_OPEN,
  PANEL_TAB_CHANGE: PRODUCT_EVENT.PANEL_TAB_CHANGE,
  SETTINGS_VIEW_OPEN: PRODUCT_EVENT.SETTINGS_VIEW_OPEN,
  SEARCH_OPEN: PRODUCT_EVENT.SEARCH_OPEN,
  ASK_SUBMIT: PRODUCT_EVENT.ASK_SUBMIT,
} as const;

export type ProductSurfaceEventName =
  (typeof PRODUCT_SURFACE_EVENT)[keyof typeof PRODUCT_SURFACE_EVENT];

const PRODUCT_SURFACE_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(PRODUCT_SURFACE_EVENT),
);

/** Guards a name arriving from the renderer's own surface-event channel. */
export function isProductSurfaceEventName(
  value: UnparsedWireValue,
): value is ProductSurfaceEventName {
  return isWireString(value) && PRODUCT_SURFACE_EVENT_NAMES.has(value);
}

export const PRODUCT_EVENT_PROPERTY = {
  APP_VERSION: "app_version",
  CONNECTION_ID: "connection_id",
  PROVIDER_ID: "provider_id",
  TRACKER_ID: "tracker_id",
  CALENDAR_SOURCE: "calendar_source",
  SESSION_COUNT: "session_count",
  IMAGE_COUNT: "image_count",
  SESSION_STATUS: "session_status",
  CREDENTIAL_SOURCE: "credential_source",
  SESSION_ACT: "session_act",
  ISSUE_ACT: "issue_act",
  ACCOUNT_ACT: "account_act",
  SUPERSET_ACT: "superset_act",
  UPDATE_ACT: "update_act",
  PANEL_TAB: "panel_tab",
  PANEL_SOURCE: "panel_source",
  SETTINGS_VIEW: "settings_view",
  SEARCH_SURFACE: "search_surface",
  ASK_OUTCOME: "ask_outcome",
  PERMISSION_RESULT: "permission_result",
  SETTING_ID: "setting_id",
  SETTING_VALUE: "setting_value",
} as const;

export type ProductEventProperty =
  (typeof PRODUCT_EVENT_PROPERTY)[keyof typeof PRODUCT_EVENT_PROPERTY];

/**
 * Every service a credential row connects, as a count names it. It repeats
 * the desktop's own credential-provider set rather than importing it, because
 * that set knows about Electron and this file may not; the desktop closes the
 * gap with a total `Record` bridge, so a new credential provider does not
 * build until this vocabulary answers for it.
 */
export const PRODUCT_CONNECTION_ID = {
  CONDUCTOR: PROVIDER_ID.CONDUCTOR,
  COPILOT: PROVIDER_ID.COPILOT,
  CURSOR: PROVIDER_ID.CURSOR,
  DEVIN: PROVIDER_ID.DEVIN,
  JULES: PROVIDER_ID.JULES,
  LINEAR: ISSUE_TRACKER_ID.LINEAR,
  OPENAI: "openai",
  REPLICAS: PROVIDER_ID.REPLICAS,
} as const;

export type ProductConnectionId =
  (typeof PRODUCT_CONNECTION_ID)[keyof typeof PRODUCT_CONNECTION_ID];

/** Which credential a spoken call ran on, never which credential it was. */
export const PRODUCT_CREDENTIAL_SOURCE = {
  ACCOUNT: "account",
  KEY: "key",
} as const;

export type ProductCredentialSource =
  (typeof PRODUCT_CREDENTIAL_SOURCE)[keyof typeof PRODUCT_CREDENTIAL_SOURCE];

/** Which act a session took, never what it carried. */
export const PRODUCT_SESSION_ACT = {
  MESSAGE_SEND: "message_send",
  CONTROL_RUN: "control_run",
  SESSION_OPEN: "session_open",
  TRANSCRIPT_READ: "transcript_read",
  WORKSPACE_CREATE: "workspace_create",
  WORKSPACE_RENAME: "workspace_rename",
  SESSION_RENAME: "session_rename",
  AGENT_ADD: "agent_add",
  NOTICE_REQUEST: "notice_request",
  NOTICE_WITHDRAW: "notice_withdraw",
} as const;

export type ProductSessionAct = (typeof PRODUCT_SESSION_ACT)[keyof typeof PRODUCT_SESSION_ACT];

/** Which calendar a connection is to, never whose or what is on it. */
export const PRODUCT_CALENDAR_SOURCE = {
  GOOGLE: "google",
  APPLE: "apple",
} as const;

export type ProductCalendarSource =
  (typeof PRODUCT_CALENDAR_SOURCE)[keyof typeof PRODUCT_CALENDAR_SOURCE];

/** Where a Luke account stands after an act, never who the account is. */
export const PRODUCT_ACCOUNT_ACT = {
  SIGN_IN_START: "sign_in_start",
  SIGN_IN_CANCEL: "sign_in_cancel",
  SIGN_OUT: "sign_out",
  DELETE: "delete",
} as const;

export type ProductAccountAct = (typeof PRODUCT_ACCOUNT_ACT)[keyof typeof PRODUCT_ACCOUNT_ACT];

/** How far a Superset connection got, never the code or the organization. */
export const PRODUCT_SUPERSET_ACT = {
  SIGN_IN_START: "sign_in_start",
  SIGN_IN_COMPLETE: "sign_in_complete",
  SIGN_IN_CANCEL: "sign_in_cancel",
  DISCONNECT: "disconnect",
} as const;

export type ProductSupersetAct = (typeof PRODUCT_SUPERSET_ACT)[keyof typeof PRODUCT_SUPERSET_ACT];

/**
 * The things the Updates section's buttons ever do. It repeats the guide's
 * own act set rather than importing it, because the guide names the act a
 * spoken ask may reach and this names the act that happened: the row offers a
 * browser trip where the guide says `download`, and a restart the count sees
 * as the install it schedules. `changelog_open` is the Changelog row's own
 * browser trip, to the fixed changelog page rather than the releases one.
 */
export const PRODUCT_UPDATE_ACT = {
  CHECK: "check",
  INSTALL: "install",
  RELEASE_OPEN: "release_open",
  CHANGELOG_OPEN: "changelog_open",
} as const;

export type ProductUpdateAct = (typeof PRODUCT_UPDATE_ACT)[keyof typeof PRODUCT_UPDATE_ACT];

/** Which half of the panel is drawn, said exactly as the guide says it. */
export const PRODUCT_PANEL_TAB = {
  SESSIONS: APP_PANEL_TAB.SESSIONS,
  SETTINGS: APP_PANEL_TAB.SETTINGS,
} as const satisfies Record<string, AppPanelTab>;

export type ProductPanelTab = (typeof PRODUCT_PANEL_TAB)[keyof typeof PRODUCT_PANEL_TAB];

/**
 * What opened the panel, never what was on it when it opened. The two the
 * build actually has: a press on the capsule, and the ask key claimed from
 * anywhere. The notice band under the housing draws without a press and there
 * is no menu, so neither is listed — a value nothing can emit would read on a
 * dashboard as a way in that nobody uses rather than one that does not exist.
 */
export const PRODUCT_PANEL_SOURCE = {
  CAPSULE: "capsule",
  HOTKEY: "hotkey",
} as const;

export type ProductPanelSource = (typeof PRODUCT_PANEL_SOURCE)[keyof typeof PRODUCT_PANEL_SOURCE];

/**
 * Which settings page a front-page row opened. It repeats the settings
 * package's own page set rather than importing it, because that package reads
 * this file for a setting's counted value and the edge would close a loop; the
 * desktop closes the gap with a total `Record` bridge, so a new page does not
 * build until this vocabulary answers for it.
 */
export const PRODUCT_SETTINGS_VIEW = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
} as const;

export type ProductSettingsView =
  (typeof PRODUCT_SETTINGS_VIEW)[keyof typeof PRODUCT_SETTINGS_VIEW];

/** Which list a search field was summoned over, never what was typed into it. */
export const PRODUCT_SEARCH_SURFACE = {
  SESSIONS: "sessions",
  SETTINGS: "settings",
} as const;

export type ProductSearchSurface =
  (typeof PRODUCT_SEARCH_SURFACE)[keyof typeof PRODUCT_SEARCH_SURFACE];

/** Whether an ask reached a conversation, never the words it carried. */
export const PRODUCT_ASK_OUTCOME = {
  SENT: "sent",
  REFUSED: "refused",
} as const;

export type ProductAskOutcome = (typeof PRODUCT_ASK_OUTCOME)[keyof typeof PRODUCT_ASK_OUTCOME];

/** What the system answered a permission ask with. */
export const PRODUCT_PERMISSION_RESULT = {
  GRANTED: "granted",
  DENIED: "denied",
} as const;

export type ProductPermissionResult =
  (typeof PRODUCT_PERMISSION_RESULT)[keyof typeof PRODUCT_PERMISSION_RESULT];

/** Which act a tracker took, never the state moved to or the comment written. */
export const PRODUCT_ISSUE_ACT = {
  STATE_MOVE: "state_move",
  COMMENT_ADD: "comment_add",
  /**
   * The issue's own page, handed to the operating system. It sits here rather
   * than beside the session acts because an issue has a tracker and no
   * provider, and `session:act_send` cannot be built without a provider id.
   */
  ISSUE_OPEN: "issue_open",
} as const;

export type ProductIssueAct = (typeof PRODUCT_ISSUE_ACT)[keyof typeof PRODUCT_ISSUE_ACT];

/**
 * The shape a setting's new value is counted in, never the value itself: a
 * chosen workspace project is a project name, and a hotkey is a chord the
 * developer chose. Whether a switch went on or off, and whether a choice was
 * made or returned to nothing, is the whole of what travels.
 */
export const PRODUCT_SETTING_VALUE = {
  ON: "on",
  OFF: "off",
  SET: "set",
  CLEARED: "cleared",
} as const;

export type ProductSettingValue =
  (typeof PRODUCT_SETTING_VALUE)[keyof typeof PRODUCT_SETTING_VALUE];

/**
 * The rungs every count travels on. A raw count is a weak fingerprint —
 * "137 Codex sessions" identifies a machine across days — where a rung says
 * the same thing about adoption and says it about a crowd rather than a
 * person. Each rung is the smallest count that reaches it. The ladder is
 * shared rather than per-property: a second ladder would be a second thing to
 * keep honest, and the question every count answers here is the same one.
 */
export const PRODUCT_SESSION_COUNT_BUCKET = {
  NONE: 0,
  ONE: 1,
  FEW: 2,
  SEVERAL: 5,
  MANY: 10,
  CROWD: 25,
} as const;

export type ProductSessionCountBucket =
  (typeof PRODUCT_SESSION_COUNT_BUCKET)[keyof typeof PRODUCT_SESSION_COUNT_BUCKET];

const PRODUCT_SESSION_COUNT_LADDER: readonly ProductSessionCountBucket[] = Object.values(
  PRODUCT_SESSION_COUNT_BUCKET,
).sort((left, right) => right - left);

/** The highest rung a count reaches; anything below the first rung is none. */
export function productSessionCountBucket(count: number): ProductSessionCountBucket {
  if (!Number.isFinite(count)) return PRODUCT_SESSION_COUNT_BUCKET.NONE;
  return (
    PRODUCT_SESSION_COUNT_LADDER.find((rung) => count >= rung) ?? PRODUCT_SESSION_COUNT_BUCKET.NONE
  );
}

/** What each property's value is, once it has been read. */
interface ProductEventPropertyValue {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: string;
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: ProductConnectionId;
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: ProviderId;
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: IssueTrackerId;
  [PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE]: ProductCalendarSource;
  [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: SessionStatus;
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: ProductCredentialSource;
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: ProductSessionAct;
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: ProductIssueAct;
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT]: ProductAccountAct;
  [PRODUCT_EVENT_PROPERTY.SUPERSET_ACT]: ProductSupersetAct;
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACT]: ProductUpdateAct;
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: ProductPanelTab;
  [PRODUCT_EVENT_PROPERTY.PANEL_SOURCE]: ProductPanelSource;
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: ProductSettingsView;
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: ProductSearchSurface;
  [PRODUCT_EVENT_PROPERTY.ASK_OUTCOME]: ProductAskOutcome;
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: ProductPermissionResult;
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: AppSettingId;
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: ProductSettingValue;
}

/**
 * The properties no set can enumerate. Each gets a named reader instead, and
 * all are narrower than free text by construction: a version parses as `x.y.z`
 * or not at all, and a count must be a rung of the ladder above.
 */
export type EnumeratedProductEventProperty = Exclude<
  ProductEventProperty,
  | typeof PRODUCT_EVENT_PROPERTY.APP_VERSION
  | typeof PRODUCT_EVENT_PROPERTY.SESSION_COUNT
  | typeof PRODUCT_EVENT_PROPERTY.IMAGE_COUNT
>;

/** Every value each enumerable property may ever hold. */
export const PRODUCT_EVENT_PROPERTY_VALUES = {
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: Object.values(PRODUCT_CONNECTION_ID),
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: PROVIDER_ID_LIST,
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: Object.values(ISSUE_TRACKER_ID),
  [PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE]: Object.values(PRODUCT_CALENDAR_SOURCE),
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: Object.values(SESSION_STATUS),
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: Object.values(PRODUCT_CREDENTIAL_SOURCE),
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: Object.values(PRODUCT_SESSION_ACT),
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: Object.values(PRODUCT_ISSUE_ACT),
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT]: Object.values(PRODUCT_ACCOUNT_ACT),
  [PRODUCT_EVENT_PROPERTY.SUPERSET_ACT]: Object.values(PRODUCT_SUPERSET_ACT),
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACT]: Object.values(PRODUCT_UPDATE_ACT),
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: Object.values(PRODUCT_PANEL_TAB),
  [PRODUCT_EVENT_PROPERTY.PANEL_SOURCE]: Object.values(PRODUCT_PANEL_SOURCE),
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: Object.values(PRODUCT_SETTINGS_VIEW),
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: Object.values(PRODUCT_SEARCH_SURFACE),
  [PRODUCT_EVENT_PROPERTY.ASK_OUTCOME]: Object.values(PRODUCT_ASK_OUTCOME),
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: Object.values(PRODUCT_PERMISSION_RESULT),
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: Object.values(APP_SETTING_ID),
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: Object.values(PRODUCT_SETTING_VALUE),
} as const satisfies Record<EnumeratedProductEventProperty, readonly string[]>;

/**
 * Which properties each event may carry. A name without an entry here does
 * not build, the same lever the settings schema uses — so widening the
 * vocabulary is a deliberate edit to this table rather than a call site that
 * quietly started sending more.
 */
export const PRODUCT_EVENT_PROPERTIES = {
  [PRODUCT_EVENT.APP_LAUNCH]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.APP_DAY_ACTIVE]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.ACCOUNT_SIGN_IN]: [],
  [PRODUCT_EVENT.ACCOUNT_ACT]: [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT],
  [PRODUCT_EVENT.PROVIDER_CONNECT]: [PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  [PRODUCT_EVENT.PROVIDER_DISCONNECT]: [PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  [PRODUCT_EVENT.TRACKER_CONNECT]: [PRODUCT_EVENT_PROPERTY.TRACKER_ID],
  [PRODUCT_EVENT.TRACKER_DISCONNECT]: [PRODUCT_EVENT_PROPERTY.TRACKER_ID],
  [PRODUCT_EVENT.CALENDAR_CONNECT]: [PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE],
  [PRODUCT_EVENT.CALENDAR_DISCONNECT]: [PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE],
  [PRODUCT_EVENT.SUPERSET_ACT]: [PRODUCT_EVENT_PROPERTY.SUPERSET_ACT],
  [PRODUCT_EVENT.PANEL_OPEN]: [PRODUCT_EVENT_PROPERTY.PANEL_SOURCE],
  [PRODUCT_EVENT.PANEL_TAB_CHANGE]: [PRODUCT_EVENT_PROPERTY.PANEL_TAB],
  [PRODUCT_EVENT.SETTINGS_VIEW_OPEN]: [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW],
  [PRODUCT_EVENT.SETTINGS_RESET]: [],
  [PRODUCT_EVENT.SEARCH_OPEN]: [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE],
  [PRODUCT_EVENT.UPDATE_ACT]: [PRODUCT_EVENT_PROPERTY.UPDATE_ACT],
  [PRODUCT_EVENT.FEEDBACK_OPEN]: [],
  [PRODUCT_EVENT.FEEDBACK_SEND]: [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT],
  [PRODUCT_EVENT.ASK_SUBMIT]: [PRODUCT_EVENT_PROPERTY.ASK_OUTCOME],
  [PRODUCT_EVENT.VOICE_EXCHANGE]: [],
  [PRODUCT_EVENT.VOICE_PERMISSION]: [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT],
  [PRODUCT_EVENT.SESSION_OBSERVE]: [
    PRODUCT_EVENT_PROPERTY.PROVIDER_ID,
    PRODUCT_EVENT_PROPERTY.SESSION_COUNT,
  ],
  [PRODUCT_EVENT.SESSION_ACT_SEND]: [
    PRODUCT_EVENT_PROPERTY.PROVIDER_ID,
    PRODUCT_EVENT_PROPERTY.SESSION_ACT,
  ],
  [PRODUCT_EVENT.ISSUE_ACT_SEND]: [
    PRODUCT_EVENT_PROPERTY.TRACKER_ID,
    PRODUCT_EVENT_PROPERTY.ISSUE_ACT,
  ],
  [PRODUCT_EVENT.VOICE_CALL_START]: [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE],
  [PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK]: [
    PRODUCT_EVENT_PROPERTY.PROVIDER_ID,
    PRODUCT_EVENT_PROPERTY.SESSION_STATUS,
  ],
  [PRODUCT_EVENT.SETTING_UPDATE]: [
    PRODUCT_EVENT_PROPERTY.SETTING_ID,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
  [PRODUCT_EVENT.USAGE_SHARING_STOP]: [],
  [PRODUCT_EVENT.USAGE_SHARING_RESUME]: [],
} as const satisfies { [Name in ProductEventName]: readonly ProductEventProperty[] };

/** Exactly the properties one event carries, each with its own value type. */
export type ProductEventPropertiesFor<Name extends ProductEventName> = {
  readonly [Property in (typeof PRODUCT_EVENT_PROPERTIES)[Name][number]]: ProductEventPropertyValue[Property];
};

/** Any event's properties, as a validated event holds them. */
export type ProductEventProperties = {
  readonly [Property in ProductEventProperty]?: ProductEventPropertyValue[Property];
};

/** One counted event: what happened, when, and the properties it may carry. */
export interface ProductEvent {
  name: ProductEventName;
  /** When it happened on the desktop's clock, as epoch milliseconds. */
  at: number;
  properties: ProductEventProperties;
}

export type ProductEventBatch = readonly ProductEvent[];

/**
 * How many events one request may carry. A flush past this is a desktop bug
 * rather than a busy day, so the endpoint refuses the batch whole.
 */
export const PRODUCT_EVENT_BATCH_LIMIT = 50;

/** The one shape a recording request has: events and nothing else. */
export interface ProductEventBatchRequest {
  events: readonly unknown[];
}

type PropertyReader = {
  [Property in ProductEventProperty]: (
    value: UnparsedWireValue,
  ) => ProductEventPropertyValue[Property] | undefined;
};

function memberReader<Value extends string>(
  values: readonly string[],
): (value: UnparsedWireValue) => Value | undefined {
  const members: ReadonlySet<string> = new Set(values);
  return (value: UnparsedWireValue) => {
    if (!isWireString(value) || !members.has(value)) return undefined;
    // SAFETY: the value is a member of this property's own declared set.
    return value as Value;
  };
}

const COUNT_BUCKETS: ReadonlySet<number> = new Set(Object.values(PRODUCT_SESSION_COUNT_BUCKET));

function bucketReader(value: UnparsedWireValue): ProductSessionCountBucket | undefined {
  if (!isWireNumber(value) || !COUNT_BUCKETS.has(value)) return undefined;
  // SAFETY: the value is a member of the bucket ladder declared above.
  return value as ProductSessionCountBucket;
}

/**
 * How each property's value is read. The unenumerable ones are named here,
 * which is what makes "no free text" a property of the type rather than a
 * promise about call sites: a version that is not `x.y.z` and a count that is
 * not a rung are both discarded.
 */
const PRODUCT_EVENT_PROPERTY_READER: PropertyReader = {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: (value) =>
    isWireString(value) && parseReleaseVersion(value) ? value.trim() : undefined,
  [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: bucketReader,
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: bucketReader,
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.PROVIDER_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.TRACKER_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.CALENDAR_SOURCE],
  ),
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SESSION_STATUS],
  ),
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE],
  ),
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SESSION_ACT],
  ),
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.ISSUE_ACT],
  ),
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.ACCOUNT_ACT],
  ),
  [PRODUCT_EVENT_PROPERTY.SUPERSET_ACT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SUPERSET_ACT],
  ),
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.UPDATE_ACT],
  ),
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.PANEL_TAB],
  ),
  [PRODUCT_EVENT_PROPERTY.PANEL_SOURCE]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.PANEL_SOURCE],
  ),
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW],
  ),
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE],
  ),
  [PRODUCT_EVENT_PROPERTY.ASK_OUTCOME]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.ASK_OUTCOME],
  ),
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT],
  ),
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SETTING_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.SETTING_VALUE],
  ),
};

const PRODUCT_EVENT_NAMES: ReadonlySet<string> = new Set(Object.values(PRODUCT_EVENT));

function isProductEventName(value: UnparsedWireValue): value is ProductEventName {
  return isWireString(value) && PRODUCT_EVENT_NAMES.has(value);
}

/**
 * Reads one event out of an untrusted envelope, or nothing. The result is
 * assembled from the event's own allowlist rather than copied from what
 * arrived, so a `distinct_id`, an `$ip`, an `email`, or a `$set` on the way in
 * has nowhere to land — naming a field is not a way to send one. A missing or
 * unreadable property discards the whole event rather than being repaired: the
 * desktop only sends what it built from this same table, so anything else is a
 * bug that should be loud.
 */
export function productEventFromWire(value: UnparsedWireValue): ProductEvent | undefined {
  if (!isRecord(value) || !isProductEventName(value.name)) return undefined;
  const at = value.at;
  if (!isWireNumber(at) || !Number.isFinite(at) || at < 0) return undefined;
  const source = isRecord(value.properties) ? value.properties : undefined;
  const allowed: readonly ProductEventProperty[] = PRODUCT_EVENT_PROPERTIES[value.name];
  const properties: Record<string, string | number> = {};
  for (const property of allowed) {
    const read = PRODUCT_EVENT_PROPERTY_READER[property](source?.[property]);
    if (read === undefined) return undefined;
    properties[property] = read;
  }
  // SAFETY: every key came from this event's allowlist and every value from
  // that property's own reader, which is exactly the declared shape.
  return { name: value.name, at, properties: properties as ProductEventProperties };
}

/**
 * Reads a whole batch, or nothing. One unreadable event refuses the batch
 * rather than trimming it: a partial acceptance would let a desktop bug show
 * up as a quiet gap in the counts instead of a refusal somebody notices.
 */
export function productEventBatchFromWire(value: UnparsedWireValue): ProductEventBatch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events)) return undefined;
  if (value.events.length === 0 || value.events.length > PRODUCT_EVENT_BATCH_LIMIT) {
    return undefined;
  }
  const events: ProductEvent[] = [];
  for (const candidate of value.events) {
    const event = productEventFromWire(candidate);
    if (!event) return undefined;
    events.push(event);
  }
  return events;
}

/** What every emitter is handed: a name, and exactly that name's properties. */
export type RecordProductEvent = <Name extends ProductEventName>(
  name: Name,
  properties: ProductEventPropertiesFor<Name>,
) => void;
