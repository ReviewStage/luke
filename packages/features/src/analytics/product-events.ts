import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@repo/wire";
import {
  APP_PANEL_TAB,
  APP_SETTING_ID,
  type AppPanelTab,
  type AppSettingId,
} from "@repo/wire/app-settings";
import { Option, Schema } from "effect";
import { parseReleaseVersion } from "./release-version.js";

export const PRODUCT_EVENT = {
  APP_LAUNCH: "app:launch",
  APP_DAY_ACTIVE: "app:day_active",
  ACCOUNT_SIGN_IN: "account:sign_in",
  ACCOUNT_ACTION: "account:action",
  PANEL_TAB_CHANGE: "panel:tab_change",
  SETTINGS_VIEW_OPEN: "settings:view_open",
  SETTINGS_RESET: "settings:reset",
  SEARCH_OPEN: "search:open",
  SURFACE_OPEN: "surface:open",
  UPDATE_ACTION: "update:action",
  FEEDBACK_SEND: "feedback:send",
  VOICE_PERMISSION: "voice:permission",
  SETTING_UPDATE: "setting:update",
  EXPERIMENT_TOGGLE: "experiment:toggle",
} as const;

export type ProductEventName = (typeof PRODUCT_EVENT)[keyof typeof PRODUCT_EVENT];

export const ProductEventNameSchema = Schema.Literals(Object.values(PRODUCT_EVENT));

export const PRODUCT_SURFACE_EVENT = {
  PANEL_TAB_CHANGE: PRODUCT_EVENT.PANEL_TAB_CHANGE,
  SETTINGS_VIEW_OPEN: PRODUCT_EVENT.SETTINGS_VIEW_OPEN,
  SEARCH_OPEN: PRODUCT_EVENT.SEARCH_OPEN,
  SURFACE_OPEN: PRODUCT_EVENT.SURFACE_OPEN,
} as const;

export type ProductSurfaceEventName =
  (typeof PRODUCT_SURFACE_EVENT)[keyof typeof PRODUCT_SURFACE_EVENT];

const PRODUCT_SURFACE_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(PRODUCT_SURFACE_EVENT),
);

export function isProductSurfaceEventName(
  value: UnparsedWireValue,
): value is ProductSurfaceEventName {
  return isWireString(value) && PRODUCT_SURFACE_EVENT_NAMES.has(value);
}

export const PRODUCT_EVENT_PROPERTY = {
  APP_VERSION: "app_version",
  IMAGE_COUNT: "image_count",
  ACCOUNT_ACTION: "account_action",
  UPDATE_ACTION: "update_action",
  PANEL_TAB: "panel_tab",
  SETTINGS_VIEW: "settings_view",
  SEARCH_SURFACE: "search_surface",
  SURFACE: "surface",
  LAYOUT: "layout",
  PERMISSION_RESULT: "permission_result",
  SETTING_ID: "setting_id",
  SETTING_VALUE: "setting_value",
  EXPERIMENT: "experiment",
} as const;

type ProductEventProperty = (typeof PRODUCT_EVENT_PROPERTY)[keyof typeof PRODUCT_EVENT_PROPERTY];

export const PRODUCT_ACCOUNT_ACTION = {
  SIGN_IN_START: "sign_in_start",
  SIGN_IN_CANCEL: "sign_in_cancel",
  SIGN_OUT: "sign_out",
  DELETE: "delete",
} as const;

export type ProductAccountAction =
  (typeof PRODUCT_ACCOUNT_ACTION)[keyof typeof PRODUCT_ACCOUNT_ACTION];

export const ProductAccountActionSchema = Schema.Literals(Object.values(PRODUCT_ACCOUNT_ACTION));

export const PRODUCT_UPDATE_ACTION = {
  CHECK: "check",
  INSTALL: "install",
  RELEASE_OPEN: "release_open",
  CHANGELOG_OPEN: "changelog_open",
} as const;

type ProductUpdateAction = (typeof PRODUCT_UPDATE_ACTION)[keyof typeof PRODUCT_UPDATE_ACTION];

const PRODUCT_PANEL_TAB = {
  TASKS: APP_PANEL_TAB.TASKS,
  SETTINGS: APP_PANEL_TAB.SETTINGS,
} as const satisfies Record<string, AppPanelTab>;

type ProductPanelTab = (typeof PRODUCT_PANEL_TAB)[keyof typeof PRODUCT_PANEL_TAB];

export const PRODUCT_SETTINGS_VIEW = {
  ROOT: "root",
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  CONNECTIONS: "connections",
  MEMORY: "memory",
  AGENTS: "agents",
  HOSTS: "hosts",
  INTEGRATIONS: "integrations",
  MCP: "mcp",
  CLI: "cli",
  SKILLS: "skills",
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

export const PRODUCT_SEARCH_SURFACE = {
  SETTINGS: "settings",
} as const;

type ProductSearchSurface = (typeof PRODUCT_SEARCH_SURFACE)[keyof typeof PRODUCT_SEARCH_SURFACE];

export const PRODUCT_SURFACE = {
  HOME: "home",
  TASK: "task",
  VERSION_HISTORY: "version_history",
  INBOX: "inbox",
  CHANNEL: "channel",
  THREAD: "thread",
  AGENT: "agent",
  SUBAGENT: "subagent",
  PERSON: "person",
  AUTOMATIONS: "automations",
  BOARD: "board",
  ADMIN: "admin",
  SETTINGS: "settings",
  COMMENTS: "comments",
  PULL_REQUEST: "pull_request",
  FILES: "files",
  TERMINAL: "terminal",
  BROWSER: "browser",
  PAGE: "page",
} as const;

export type ProductSurface = (typeof PRODUCT_SURFACE)[keyof typeof PRODUCT_SURFACE];

export const PRODUCT_LAYOUT = {
  WIDE: "wide",
  NARROW: "narrow",
} as const;

export type ProductLayout = (typeof PRODUCT_LAYOUT)[keyof typeof PRODUCT_LAYOUT];

export const PRODUCT_PERMISSION_RESULT = {
  GRANTED: "granted",
  DENIED: "denied",
} as const;

export type ProductPermissionResult =
  (typeof PRODUCT_PERMISSION_RESULT)[keyof typeof PRODUCT_PERMISSION_RESULT];

export const PRODUCT_SETTING_VALUE = {
  ON: "on",
  OFF: "off",
  SET: "set",
  CLEARED: "cleared",
} as const;

export type ProductSettingValue =
  (typeof PRODUCT_SETTING_VALUE)[keyof typeof PRODUCT_SETTING_VALUE];

export const ProductSettingValueSchema = Schema.Literals(Object.values(PRODUCT_SETTING_VALUE));

export const PRODUCT_EXPERIMENT = {
  BROWSER: "browser",
  CHAT: "chat",
  FACTORY: "factory",
  AUTOMATIONS: "automations",
  CODE_REVIEW: "code-review",
  VIDEO_CALLS: "video-calls",
  MEMORY: "memory",
  ISSUES: "issues",
  SECTIONS: "sections",
  GITHUB_TOKEN: "github-token",
  INBOX_FIRST: "inbox-first",
  LOCAL_AGENTS: "local-agents",
  CHANNELS: "channels",
  PILOT: "pilot",
  SKILLS: "skills",
  BRING_YOUR_OWN_HOST: "bring-your-own-host",
  SEVERAL_REPOSITORIES: "several-repositories",
  DESCRIPTIONS: "descriptions",
  PLANS: "plans",
  CHAT_ON_THE_RIGHT: "chat-on-the-right",
} as const;

export type ProductExperiment = (typeof PRODUCT_EXPERIMENT)[keyof typeof PRODUCT_EXPERIMENT];

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

export function productSessionCountBucket(count: number): ProductSessionCountBucket {
  if (!Number.isFinite(count)) return PRODUCT_SESSION_COUNT_BUCKET.NONE;
  return (
    PRODUCT_SESSION_COUNT_LADDER.find((rung) => count >= rung) ?? PRODUCT_SESSION_COUNT_BUCKET.NONE
  );
}

interface ProductEventPropertyValue {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: string;
  [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT]: ProductSessionCountBucket;
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: ProductAccountAction;
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: ProductUpdateAction;
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: ProductPanelTab;
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: ProductSettingsView;
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: ProductSearchSurface;
  [PRODUCT_EVENT_PROPERTY.SURFACE]: ProductSurface;
  [PRODUCT_EVENT_PROPERTY.LAYOUT]: ProductLayout;
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: ProductPermissionResult;
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: AppSettingId;
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: ProductSettingValue;
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: ProductExperiment;
}

type EnumeratedProductEventProperty = Exclude<
  ProductEventProperty,
  typeof PRODUCT_EVENT_PROPERTY.APP_VERSION | typeof PRODUCT_EVENT_PROPERTY.IMAGE_COUNT
>;

const PRODUCT_EVENT_PROPERTY_VALUES = {
  [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION]: Object.values(PRODUCT_ACCOUNT_ACTION),
  [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION]: Object.values(PRODUCT_UPDATE_ACTION),
  [PRODUCT_EVENT_PROPERTY.PANEL_TAB]: Object.values(PRODUCT_PANEL_TAB),
  [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW]: Object.values(PRODUCT_SETTINGS_VIEW),
  [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE]: Object.values(PRODUCT_SEARCH_SURFACE),
  [PRODUCT_EVENT_PROPERTY.SURFACE]: Object.values(PRODUCT_SURFACE),
  [PRODUCT_EVENT_PROPERTY.LAYOUT]: Object.values(PRODUCT_LAYOUT),
  [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT]: Object.values(PRODUCT_PERMISSION_RESULT),
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: Object.values(APP_SETTING_ID),
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: Object.values(PRODUCT_SETTING_VALUE),
  [PRODUCT_EVENT_PROPERTY.EXPERIMENT]: Object.values(PRODUCT_EXPERIMENT),
} as const satisfies Record<EnumeratedProductEventProperty, readonly string[]>;

const PRODUCT_EVENT_PROPERTIES = {
  [PRODUCT_EVENT.APP_LAUNCH]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.APP_DAY_ACTIVE]: [PRODUCT_EVENT_PROPERTY.APP_VERSION],
  [PRODUCT_EVENT.ACCOUNT_SIGN_IN]: [],
  [PRODUCT_EVENT.ACCOUNT_ACTION]: [PRODUCT_EVENT_PROPERTY.ACCOUNT_ACTION],
  [PRODUCT_EVENT.PANEL_TAB_CHANGE]: [PRODUCT_EVENT_PROPERTY.PANEL_TAB],
  [PRODUCT_EVENT.SETTINGS_VIEW_OPEN]: [PRODUCT_EVENT_PROPERTY.SETTINGS_VIEW],
  [PRODUCT_EVENT.SETTINGS_RESET]: [],
  [PRODUCT_EVENT.SEARCH_OPEN]: [PRODUCT_EVENT_PROPERTY.SEARCH_SURFACE],
  [PRODUCT_EVENT.SURFACE_OPEN]: [PRODUCT_EVENT_PROPERTY.SURFACE, PRODUCT_EVENT_PROPERTY.LAYOUT],
  [PRODUCT_EVENT.UPDATE_ACTION]: [PRODUCT_EVENT_PROPERTY.UPDATE_ACTION],
  [PRODUCT_EVENT.FEEDBACK_SEND]: [PRODUCT_EVENT_PROPERTY.IMAGE_COUNT],
  [PRODUCT_EVENT.VOICE_PERMISSION]: [PRODUCT_EVENT_PROPERTY.PERMISSION_RESULT],
  [PRODUCT_EVENT.SETTING_UPDATE]: [
    PRODUCT_EVENT_PROPERTY.SETTING_ID,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
  [PRODUCT_EVENT.EXPERIMENT_TOGGLE]: [
    PRODUCT_EVENT_PROPERTY.EXPERIMENT,
    PRODUCT_EVENT_PROPERTY.SETTING_VALUE,
  ],
} as const satisfies { [Name in ProductEventName]: readonly ProductEventProperty[] };

export type ProductEventPropertiesFor<Name extends ProductEventName> = {
  readonly [Property in (typeof PRODUCT_EVENT_PROPERTIES)[Name][number]]: ProductEventPropertyValue[Property];
};

type ProductEventProperties = {
  readonly [Property in ProductEventProperty]?: ProductEventPropertyValue[Property];
};

export interface ProductEvent {
  name: ProductEventName;
  at: number;
  properties: ProductEventProperties;
}

export type ProductEventBatch = readonly ProductEvent[];

export const productEventsAnswerSchema = Schema.Struct({
  accepted: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const PRODUCT_EVENT_BATCH_LIMIT = 50;

export const PRODUCT_EVENT_MAXIMUM_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  VOICE_CALL_START: "voice:call_start",
  VOICE_EXCHANGE: "voice:exchange",
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
  return value as ProductSessionCountBucket;
}

const PRODUCT_EVENT_PROPERTY_READER: PropertyReader = {
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
  return { name: value.name, at, properties: properties as ProductEventProperties };
}

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

export const PRODUCT_PLATFORM = {
  DESKTOP: "desktop",
  WEB: "web",
  SERVER: "server",
} as const;

export type ProductPlatform = (typeof PRODUCT_PLATFORM)[keyof typeof PRODUCT_PLATFORM];

export type ProductClientPlatform = Exclude<ProductPlatform, typeof PRODUCT_PLATFORM.SERVER>;

export const PRODUCT_EVENT_BUILD_FIELD = {
  APP_VERSION: PRODUCT_EVENT_PROPERTY.APP_VERSION,
  PACKAGED: "packaged",
  PLATFORM: "platform",
} as const;

const ProductEventBuildSchema = Schema.Struct({
  [PRODUCT_EVENT_BUILD_FIELD.APP_VERSION]: Schema.optionalKey(
    Schema.String.check(
      Schema.makeFilter(
        (value) => value === value.trim() && parseReleaseVersion(value) !== undefined,
      ),
    ),
  ),
  [PRODUCT_EVENT_BUILD_FIELD.PACKAGED]: Schema.optionalKey(Schema.Boolean),
  [PRODUCT_EVENT_BUILD_FIELD.PLATFORM]: Schema.optionalKey(
    Schema.Literals([PRODUCT_PLATFORM.DESKTOP, PRODUCT_PLATFORM.WEB]),
  ),
});

export type ProductEventBuild = typeof ProductEventBuildSchema.Type;

const decodeProductEventBuild = Schema.decodeUnknownOption(ProductEventBuildSchema);

export function productEventBuildFromWire(value: UnparsedWireValue): ProductEventBuild {
  if (!isRecord(value)) return {};
  return Option.getOrElse(decodeProductEventBuild(value.build), () => ({}));
}

export type RecordProductEvent = <Name extends ProductEventName>(
  name: Name,
  properties: ProductEventPropertiesFor<Name>,
) => void;
