import { APP_SETTING_ID, type AppSettingId } from "./app-settings.js";
import { parseReleaseVersion } from "./app-update.js";
import { ISSUE_TRACKER_ID, type IssueTrackerId } from "./issues.js";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "./json.js";
import { PROVIDER_ID, PROVIDER_ID_LIST, type ProviderId } from "./providers.js";
import { SESSION_STATUS, type SessionStatus } from "./session.js";

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
  PROVIDER_CONNECT: "provider:connect",
  PROVIDER_DISCONNECT: "provider:disconnect",
  TRACKER_CONNECT: "tracker:connect",
  CALENDAR_CONNECT: "calendar:connect",
  SESSION_OBSERVE: "session:observe",
  SESSION_ACT_SEND: "session:act_send",
  ISSUE_ACT_SEND: "issue:act_send",
  VOICE_CALL_START: "voice:call_start",
  VOICE_ANNOUNCEMENT_SPEAK: "voice:announcement_speak",
  SETTING_UPDATE: "setting:update",
  USAGE_SHARING_STOP: "usage:sharing_stop",
  USAGE_SHARING_RESUME: "usage:sharing_resume",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENT)[keyof typeof PRODUCT_EVENT];

export const PRODUCT_EVENT_PROPERTY = {
  APP_VERSION: "app_version",
  CONNECTION_ID: "connection_id",
  PROVIDER_ID: "provider_id",
  TRACKER_ID: "tracker_id",
  SESSION_COUNT: "session_count",
  SESSION_STATUS: "session_status",
  CREDENTIAL_SOURCE: "credential_source",
  SESSION_ACT: "session_act",
  ISSUE_ACT: "issue_act",
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
} as const;

export type ProductSessionAct = (typeof PRODUCT_SESSION_ACT)[keyof typeof PRODUCT_SESSION_ACT];

/** Which act a tracker took, never the state moved to or the comment written. */
export const PRODUCT_ISSUE_ACT = {
  STATE_MOVE: "state_move",
  COMMENT_ADD: "comment_add",
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
 * The rungs a session count travels on. A raw count is a weak fingerprint —
 * "137 Codex sessions" identifies a machine across days — where a rung says
 * the same thing about adoption and says it about a crowd rather than a
 * person. Each rung is the smallest count that reaches it.
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
  [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: SessionStatus;
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: ProductCredentialSource;
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: ProductSessionAct;
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: ProductIssueAct;
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: AppSettingId;
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: ProductSettingValue;
}

/**
 * The two properties no set can enumerate. Each gets a named reader instead,
 * and both are narrower than free text by construction: a version parses as
 * `x.y.z` or not at all, and a count must be a rung of the ladder above.
 */
export type EnumeratedProductEventProperty = Exclude<
  ProductEventProperty,
  typeof PRODUCT_EVENT_PROPERTY.APP_VERSION | typeof PRODUCT_EVENT_PROPERTY.SESSION_COUNT
>;

/** Every value each enumerable property may ever hold. */
export const PRODUCT_EVENT_PROPERTY_VALUES = {
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: Object.values(PRODUCT_CONNECTION_ID),
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: PROVIDER_ID_LIST,
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: Object.values(ISSUE_TRACKER_ID),
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: Object.values(SESSION_STATUS),
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: Object.values(PRODUCT_CREDENTIAL_SOURCE),
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: Object.values(PRODUCT_SESSION_ACT),
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: Object.values(PRODUCT_ISSUE_ACT),
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
  [PRODUCT_EVENT.PROVIDER_CONNECT]: [PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  [PRODUCT_EVENT.PROVIDER_DISCONNECT]: [PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  [PRODUCT_EVENT.TRACKER_CONNECT]: [PRODUCT_EVENT_PROPERTY.TRACKER_ID],
  [PRODUCT_EVENT.CALENDAR_CONNECT]: [],
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

const SESSION_COUNT_BUCKETS: ReadonlySet<number> = new Set(
  Object.values(PRODUCT_SESSION_COUNT_BUCKET),
);

/**
 * How each property's value is read. The two unenumerable ones are named
 * here, which is what makes "no free text" a property of the type rather than
 * a promise about call sites: a version that is not `x.y.z` and a count that
 * is not a rung are both discarded.
 */
const PRODUCT_EVENT_PROPERTY_READER: PropertyReader = {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: (value) =>
    isWireString(value) && parseReleaseVersion(value) ? value.trim() : undefined,
  [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: (value) => {
    if (!isWireNumber(value) || !SESSION_COUNT_BUCKETS.has(value)) return undefined;
    // SAFETY: the value is a member of the bucket ladder declared above.
    return value as ProductSessionCountBucket;
  },
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.CONNECTION_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.PROVIDER_ID],
  ),
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: memberReader(
    PRODUCT_EVENT_PROPERTY_VALUES[PRODUCT_EVENT_PROPERTY.TRACKER_ID],
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
