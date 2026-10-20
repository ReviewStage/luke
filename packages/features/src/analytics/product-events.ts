import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@luke/wire";
import {
  APP_PANEL_TAB,
  APP_SETTING_ID,
  type AppPanelTab,
  type AppSettingId,
} from "@luke/wire/app-settings";
import { Option, Schema } from "effect";
import { parseReleaseVersion } from "./release-version.js";

/**
 * What the desktop may count about its own use, and the one reader both sides
 * run over it. The rest of `@luke/features` holds the contracts for what Luke's service
 * *answers*; this holds the contract for what the desktop *asks* it to record.
 *
 * The vocabulary is the privacy boundary, not a convention on top of one. An
 * event is a name from this file, and every property value is a member of an
 * `as const` set here, a rung on the session-count ladder, or a release
 * version — so a session title, a branch, a path, a prompt, or an
 * error line has no shape it could travel in. Nothing observed and nothing
 * typed or spoken can be expressed, and the reader below builds its output
 * from the allowlist rather than from the envelope, so a field cannot be
 * smuggled through by naming it.
 */

export const PRODUCT_EVENT = {
  APP_LAUNCH: "app:launch",
  APP_DAY_ACTIVE: "app:day_active",
  ACCOUNT_SIGN_IN: "account:sign_in",
  ACCOUNT_ACTION: "account:action",
  PANEL_TAB_CHANGE: "panel:tab_change",
  SETTINGS_VIEW_OPEN: "settings:view_open",
  SETTINGS_RESET: "settings:reset",
  SEARCH_OPEN: "search:open",
  UPDATE_ACTION: "update:action",
  FEEDBACK_SEND: "feedback:send",
  VOICE_CALL_START: "voice:call_start",
  VOICE_EXCHANGE: "voice:exchange",
  VOICE_PERMISSION: "voice:permission",
  SETTING_UPDATE: "setting:update",
  EXPERIMENT_TOGGLE: "experiment:toggle",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENT)[keyof typeof PRODUCT_EVENT];

export const ProductEventNameSchema = Schema.Literals(Object.values(PRODUCT_EVENT));

/**
 * The events the renderer may ask the main process to count, and the whole of
 * what the surface channel carries. Everything else is emitted where the action
 * itself happens, in the main process; these are surface motion the main
 * process cannot see — which tab is drawn, which page a row opened, whether a
 * search field was summoned. Keeping the set small and separate is what makes
 * the channel narrow: the handler validates against this union rather than
 * against every name, so a compromised renderer gains no reach into the actions.
 */
export const PRODUCT_SURFACE_EVENT = {
  PANEL_TAB_CHANGE: PRODUCT_EVENT.PANEL_TAB_CHANGE,
  SETTINGS_VIEW_OPEN: PRODUCT_EVENT.SETTINGS_VIEW_OPEN,
  SEARCH_OPEN: PRODUCT_EVENT.SEARCH_OPEN,
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
  IMAGE_COUNT: "image_count",
  SESSION_SOURCE: "session_source",
  ACCOUNT_ACTION: "account_action",
  UPDATE_ACTION: "update_action",
  PANEL_TAB: "panel_tab",
  SETTINGS_VIEW: "settings_view",
  SEARCH_SURFACE: "search_surface",
  EXCHANGE_KIND: "exchange_kind",
  PERMISSION_RESULT: "permission_result",
  SETTING_ID: "setting_id",
  SETTING_VALUE: "setting_value",
  EXPERIMENT: "experiment",
} as const;

type ProductEventProperty = (typeof PRODUCT_EVENT_PROPERTY)[keyof typeof PRODUCT_EVENT_PROPERTY];

/** Which source opened a live voice session — Luke's hosted voice service on the account, or the introduction's accountless endpoint — never a credential or a session id. */
export const PRODUCT_VOICE_SESSION_SOURCE = {
  HOSTED: "hosted",
  /** The one-time onboarding introduction's own bounded, accountless session. */
  INTRODUCTION: "introduction",
} as const;

export type ProductVoiceSessionSource =
  (typeof PRODUCT_VOICE_SESSION_SOURCE)[keyof typeof PRODUCT_VOICE_SESSION_SOURCE];

/** Where a Luke account stands after an action, never who the account is. */
export const PRODUCT_ACCOUNT_ACTION = {
  SIGN_IN_START: "sign_in_start",
  SIGN_IN_CANCEL: "sign_in_cancel",
  SIGN_OUT: "sign_out",
  DELETE: "delete",
} as const;

export type ProductAccountAction =
  (typeof PRODUCT_ACCOUNT_ACTION)[keyof typeof PRODUCT_ACCOUNT_ACTION];

export const ProductAccountActionSchema = Schema.Literals(Object.values(PRODUCT_ACCOUNT_ACTION));

/**
 * The things the Updates section's buttons ever do, named as what happened: a
 * restart is counted as the install it schedules, `release_open` is the
 * browser trip to the latest release, and `changelog_open` is the Changelog
 * row's own browser trip, to the fixed changelog page rather than the
 * releases one.
 */
export const PRODUCT_UPDATE_ACTION = {
  CHECK: "check",
  INSTALL: "install",
  RELEASE_OPEN: "release_open",
  CHANGELOG_OPEN: "changelog_open",
} as const;

type ProductUpdateAction = (typeof PRODUCT_UPDATE_ACTION)[keyof typeof PRODUCT_UPDATE_ACTION];

/** Which half of the panel is drawn, said exactly as `APP_PANEL_TAB` says it. */
const PRODUCT_PANEL_TAB = {
  TASKS: APP_PANEL_TAB.TASKS,
  SETTINGS: APP_PANEL_TAB.SETTINGS,
} as const satisfies Record<string, AppPanelTab>;

type ProductPanelTab = (typeof PRODUCT_PANEL_TAB)[keyof typeof PRODUCT_PANEL_TAB];

/**
 * Which settings page a row of the Settings sidebar opened. It repeats the settings
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
  MEMORY: "memory",
  CODING_AGENTS: "coding_agents",
  INTEGRATIONS: "integrations",
  API_KEYS: "api_keys",
  PLAN_TEMPLATE: "plan_template",
  WORKSPACE: "workspace",
  ACCOUNT: "account",
  NOTIFICATIONS: "notifications",
  THIS_MAC: "this_mac",
  EXPERIMENTAL: "experimental",
  ABOUT: "about",
} as const;

export type ProductSettingsView =
  (typeof PRODUCT_SETTINGS_VIEW)[keyof typeof PRODUCT_SETTINGS_VIEW];

/** Which list a search field was summoned over — the Conversation thread and an agent's transcript apart — never what was typed into it. */
export const PRODUCT_SEARCH_SURFACE = {
  SESSIONS: "sessions",
  SETTINGS: "settings",
  CONVERSATION: "conversation",
  TRANSCRIPT: "transcript",
} as const;

type ProductSearchSurface = (typeof PRODUCT_SEARCH_SURFACE)[keyof typeof PRODUCT_SEARCH_SURFACE];

/**
 * Who opened the exchange being counted, never a word of it. The developer's
 * own turn comes two ways — the talk key and the composer — and the third is
 * no turn of theirs at all: the speak-only call Luke opens himself to read an
 * announcement out, which reaches the same status edge and would otherwise be
 * counted as somebody speaking to him.
 */
export const PRODUCT_EXCHANGE_KIND = {
  SPOKEN: "spoken",
  TYPED: "typed",
  ANNOUNCEMENT: "announcement",
} as const;

export type ProductExchangeKind =
  (typeof PRODUCT_EXCHANGE_KIND)[keyof typeof PRODUCT_EXCHANGE_KIND];

const PRODUCT_EXCHANGE_KINDS: ReadonlySet<string> = new Set(Object.values(PRODUCT_EXCHANGE_KIND));

/** Guards the kind the renderer names for the exchange it just opened. */
export function isProductExchangeKind(value: UnparsedWireValue): value is ProductExchangeKind {
  return isWireString(value) && PRODUCT_EXCHANGE_KINDS.has(value);
}

/** What the system answered a permission ask with. */
export const PRODUCT_PERMISSION_RESULT = {
  GRANTED: "granted",
  DENIED: "denied",
} as const;

export type ProductPermissionResult =
  (typeof PRODUCT_PERMISSION_RESULT)[keyof typeof PRODUCT_PERMISSION_RESULT];

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

export const ProductSettingValueSchema = Schema.Literals(Object.values(PRODUCT_SETTING_VALUE));

/**
 * Which experiment a developer switched on or off in Settings ›
 * Experimental, by its key. It repeats the settings package's own set rather
 * than importing it, because that package reads this file and the edge would
 * close a loop; the settings package closes the gap with a total `Record`
 * bridge, so a new experiment does not build until this set answers for it.
 */
export const PRODUCT_EXPERIMENT = {
  BROWSER: "browser",
  CHAT: "chat",
  FACTORY: "factory",
  /** Graduated, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  AUTOMATIONS: "automations",
  CODE_REVIEW: "code-review",
  VIDEO_CALLS: "video-calls",
  /** Removed with Luke's own issues, so no build sends it now; kept because an older Mac's batch still may, and one unread value refuses the batch. */
  ISSUES: "issues",
  SECTIONS: "sections",
  GITHUB_TOKEN: "github-token",
} as const;

export type ProductExperiment = (typeof PRODUCT_EXPERIMENT)[keyof typeof PRODUCT_EXPERIMENT];

/**
 * The rungs every count travels on. A raw count is a weak fingerprint —
 * "137 Codex sessions" identifies a machine across days — where a rung says
 * the same thing about adoption and says it about a crowd rather than a
 * person. Each rung is the smallest count that reaches it. The ladder is
 * shared rather than per-property: a second ladder would be a second thing to
 * keep honest, and the question every count answers here is the same one.
 */
const PRODUCT_SESSION_COUNT_BUCKET = {
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

interface ProductEventPropertyValue {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: string;
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.SESSION_SOURCE]: ProductVoiceSessionSource;
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: ProductAccountAction;
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: ProductUpdateAction;
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: ProductPanelTab;
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: ProductSettingsView;
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: ProductSearchSurface;
  [PRODUCT_EVENT_PROPERTY.EXCHANGE_KIND]: ProductExchangeKind;
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: ProductPermissionResult;
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: AppSettingId;
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: ProductSettingValue;
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: ProductExperiment;
}

/**
 * The properties no set can enumerate. Each gets a named reader instead, and
 * all are narrower than free text by construction: a version parses as `x.y.z`
 * or not at all, and a count must be a rung of the ladder above.
 */
type EnumeratedProductEventProperty = Exclude<
  ProductEventProperty,
  typeof PRODUCT_EVENT_PROPERTY.APP_VERSION | typeof PRODUCT_EVENT_PROPERTY.IMAGE_COUNT
>;

/** Every value each enumerable property may ever hold. */
const PRODUCT_EVENT_PROPERTY_VALUES = {
  [PRODUCT_EVENT_PROPERTY.SESSION_SOURCE]: Object.values(PRODUCT_VOICE_SESSION_SOURCE),
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: Object.values(PRODUCT_ACCOUNT_ACTION),
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: Object.values(PRODUCT_UPDATE_ACTION),
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: Object.values(PRODUCT_PANEL_TAB),
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: Object.values(PRODUCT_SETTINGS_VIEW),
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: Object.values(PRODUCT_SEARCH_SURFACE),
  [PRODUCT_EVENT_PROPERTY.EXCHANGE_KIND]: Object.values(PRODUCT_EXCHANGE_KIND),
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: Object.values(PRODUCT_PERMISSION_RESULT),
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: Object.values(APP_SETTING_ID),
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: Object.values(PRODUCT_SETTING_VALUE),
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: Object.values(PRODUCT_EXPERIMENT),
} as const satisfies Record<EnumeratedProductEventProperty, readonly string[]>;

/**
 * Which properties each event may carry. A name without an entry here does
 * not build, the same lever the settings schema uses — so widening the
 * vocabulary is a deliberate edit to this table rather than a call site that
 * quietly started sending more.
 */
const PRODUCT_EVENT_PROPERTIES = {
  [PRODUCT_EVENT.APP_LAUNCH]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.APP_DAY_ACTIVE]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.ACCOUNT_SIGN_IN]: [],
  [PRODUCT_EVENT.ACCOUNT_ACTION]: [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION],
  [PRODUCT_EVENT.PANEL_TAB_CHANGE]: [PRODUCT_EVENT_PROPERTY.PANEL_TAB],
  [PRODUCT_EVENT.SETTINGS_VIEW_OPEN]: [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW],
  [PRODUCT_EVENT.SETTINGS_RESET]: [],
  [PRODUCT_EVENT.SEARCH_OPEN]: [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE],
  [PRODUCT_EVENT.UPDATE_ACTION]: [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION],
  [PRODUCT_EVENT.FEEDBACK_SEND]: [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT],
  [PRODUCT_EVENT.VOICE_EXCHANGE]: [PRODUCT_EVENT_PROPERTY.EXCHANGE_KIND],
  [PRODUCT_EVENT.VOICE_PERMISSION]: [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT],
  [PRODUCT_EVENT.VOICE_CALL_START]: [PRODUCT_EVENT_PROPERTY.SESSION_SOURCE],
  [PRODUCT_EVENT.SETTING_UPDATE]: [
    PRODUCT_EVENT_PROPERTY.SETTING_ID,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
  [PRODUCT_EVENT.EXPERIMENT_TOGGLE]: [
    PRODUCT_EVENT_PROPERTY.EXPERIMENT,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
} as const satisfies { [Name in ProductEventName]: readonly ProductEventProperty[] };

/** Exactly the properties one event carries, each with its own value type. */
export type ProductEventPropertiesFor<Name extends ProductEventName> = {
  readonly [Property in (typeof PRODUCT_EVENT_PROPERTIES)[Name][number]]: ProductEventPropertyValue[Property];
};

/** Any event's properties, as a validated event holds them. */
type ProductEventProperties = {
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

/**
 * How far back an event's own `at` may date it when the service records it.
 * The service clamps an older instant into this window ending at its own
 * clock, so a Mac set to the wrong year cannot scatter counts across the
 * timeline; the desktop's hold drops an event it would otherwise post to be
 * re-dated, so the two sides read one number.
 */
export const PRODUCT_EVENT_MAXIMUM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Event names this vocabulary once held and no build since 0.8.0 emits. A
 * batch from a 0.7.1 or older build may still carry one, and the batch reader
 * refuses a batch whole on any name it does not know, so it skips these items
 * instead and keeps the rest of that build's counts. A name that was never in
 * the vocabulary is still refused. Delete this set once no build at or below
 * 0.7.1 is active.
 */
const RETIRED_PRODUCT_EVENT = {
  PROVIDER_CONNECT: "provider:connect",
  PROVIDER_DISCONNECT: "provider:disconnect",
  CALENDAR_CONNECT: "calendar:connect",
  CALENDAR_DISCONNECT: "calendar:disconnect",
  SESSION_OBSERVE: "session:observe",
  SESSION_ACTION_SEND: "session:action_send",
  PANEL_OPEN: "panel:open",
  INTRODUCTION_COMPLETE: "introduction:complete",
  VOICE_ANNOUNCEMENT_SPEAK: "voice:announcement_speak",
  VOICE_FIRST_ANNOUNCEMENT: "voice:first_announcement",
  CONVERSATION_RATED: "conversation:rated",
} as const;

const RETIRED_PRODUCT_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(RETIRED_PRODUCT_EVENT),
);

function isRetiredProductEvent(value: UnparsedWireValue): boolean {
  return isRecord(value) && isWireString(value.name) && RETIRED_PRODUCT_EVENT_NAMES.has(value.name);
}

type PropertyReader = {
  [Property in ProductEventProperty]: (
    value: UnparsedWireValue,
  ) => ProductEventPropertyValue[Property] | undefined;
};

function memberReader(values: readonly string[]): (value: UnparsedWireValue) => string | undefined {
  const members: ReadonlySet<string> = new Set(values);
  return (value: UnparsedWireValue) =>
    isWireString(value) && members.has(value) ? value : undefined;
}

const COUNT_BUCKETS: ReadonlySet<number> = new Set(Object.values(PRODUCT_SESSION_COUNT_BUCKET));

function bucketReader(value: UnparsedWireValue): ProductSessionCountBucket | undefined {
  if (!isWireNumber(value) || !COUNT_BUCKETS.has(value)) return undefined;
  // SAFETY: the value is a member of the bucket ladder declared above.
  return value as ProductSessionCountBucket;
}

/**
 * How each property's value is read. Every enumerable property's reader comes
 * from that property's own declared set rather than from a second list, so the
 * two can never disagree; the two no set can enumerate are named here, which
 * is what makes "no free text" a property of the type rather than a promise
 * about call sites: a version that is not `x.y.z` and a count that is not a
 * rung are both discarded.
 */
const PRODUCT_EVENT_PROPERTY_READER: PropertyReader = {
  // SAFETY: the source is keyed by exactly the enumerable properties, and each
  // reader answers a member of the set filed under the key it lands on, which
  // is that property's own value type; the cast restores what `Object.entries`
  // and `Object.fromEntries` widen away.
  ...(Object.fromEntries(
    Object.entries(PRODUCT_EVENT_PROPERTY_VALUES).map(([property, values]) => [
      property,
      memberReader(values),
    ]),
  ) as Pick<PropertyReader, EnumeratedProductEventProperty>),
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: (value) =>
    isWireString(value) && parseReleaseVersion(value) ? value.trim() : undefined,
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: bucketReader,
};

const readsProductEventName = Schema.is(ProductEventNameSchema);

function isProductEventName(value: UnparsedWireValue): value is ProductEventName {
  return readsProductEventName(value);
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
 * up as a quiet gap in the counts instead of a refusal somebody notices. The
 * one exception is a retired name, which an older build still sends and which
 * is skipped, so a batch of nothing but retired names reads as empty.
 */
export function productEventBatchFromWire(value: UnparsedWireValue): ProductEventBatch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events)) return undefined;
  if (value.events.length === 0 || value.events.length > PRODUCT_EVENT_BATCH_LIMIT) {
    return undefined;
  }
  const events: ProductEvent[] = [];
  for (const candidate of value.events) {
    if (isRetiredProductEvent(candidate)) continue;
    const event = productEventFromWire(candidate);
    if (!event) return undefined;
    events.push(event);
  }
  return events;
}

/** The fields of a batch's `build`, which the service stamps on every event the batch carries. */
export const PRODUCT_EVENT_BUILD_FIELD = {
  APP_VERSION: PRODUCT_EVENT_PROPERTY.APP_VERSION,
  PACKAGED: "packaged",
} as const;

/**
 * What the desktop says about the build a whole batch came from: its release
 * version, read as strictly as an event's own, and whether it runs from a
 * packaged bundle rather than a development checkout. It rides beside the
 * events rather than inside each one, because it is a fact of the sender and
 * not of anything counted, and one place on the request keeps it out of every
 * event's allowlist.
 */
const ProductEventBuildSchema = Schema.Struct({
  [PRODUCT_EVENT_BUILD_FIELD.APP_VERSION]: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (value) => value === value.trim() && parseReleaseVersion(value) !== undefined,
      ),
    ),
  ),
  [PRODUCT_EVENT_BUILD_FIELD.PACKAGED]: Schema.optionalKey(Schema.Boolean),
});

export type ProductEventBuild = typeof ProductEventBuildSchema.Type;

const decodeProductEventBuild = Schema.decodeUnknownOption(ProductEventBuildSchema);

/**
 * Reads a batch's `build`, which is never a reason to refuse it. Note that a
 * missing or unreadable `build` is left off whole rather than refusing the
 * batch, because builds 0.7 to 0.17 send none at all and their counts still
 * have to land; an event then carries no claim about its build rather than a
 * wrong one. A field the schema does not name is not copied forward.
 */
export function productEventBuildFromWire(value: UnparsedWireValue): ProductEventBuild {
  if (!isRecord(value)) return {};
  return Option.getOrElse(decodeProductEventBuild(value.build), () => ({}));
}

/** What every emitter is handed: a name, and exactly that name's properties. */
export type RecordProductEvent = <Name extends ProductEventName>(
  name: Name,
  properties: ProductEventPropertiesFor<Name>,
) => void;
