import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "./integration-wire.js";

/**
 * trigger-catalog.ts -- the integrations an automation may be fired by, the events each delivers, and the words each is named in.
 *
 * An integration trigger is one provider's event, delivered to Luke by that
 * provider's own app installed on a workspace, and filtered by the fields
 * its events carry. A provider is here only once Luke can receive its
 * deliveries; the catalog is data, which the wire's schemas, the list's and
 * history's words, and a run's prompt all read, so a provider added later is
 * a row here and a module that receives it, never a new trigger kind.
 */

/** The integrations whose events may fire an automation: each an `INTEGRATION_PROVIDER` that has a trigger source. */
export const TRIGGER_PROVIDER = {
  SENTRY: INTEGRATION_PROVIDER.SENTRY,
} as const;

export type TriggerProvider = (typeof TRIGGER_PROVIDER)[keyof typeof TRIGGER_PROVIDER];

/** The Sentry events an automation listens for. */
export const SENTRY_TRIGGER_EVENT = {
  /** An issue alert rule fired whose action is the Luke integration. */
  ALERT_TRIGGERED: "alert-triggered",
  /** Sentry opened a new issue in a project of the installation. */
  ISSUE_CREATED: "issue-created",
} as const;

export type SentryTriggerEvent = (typeof SENTRY_TRIGGER_EVENT)[keyof typeof SENTRY_TRIGGER_EVENT];

/** The fields an integration trigger may filter its provider's events by. */
export const INTEGRATION_TRIGGER_FILTER = {
  PROJECT: "project",
  ENVIRONMENT: "environment",
  LEVEL: "level",
} as const;

export type IntegrationTriggerFilter =
  (typeof INTEGRATION_TRIGGER_FILTER)[keyof typeof INTEGRATION_TRIGGER_FILTER];

/** The levels Sentry gives an event, least severe first. */
export const SENTRY_LEVEL = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  FATAL: "fatal",
} as const;

export type SentryLevel = (typeof SENTRY_LEVEL)[keyof typeof SENTRY_LEVEL];

/** One field a trigger filters on: its words, and the values it may take where they are a fixed list rather than the developer's own. */
export interface TriggerFilterField {
  readonly field: IntegrationTriggerFilter;
  readonly words: string;
  readonly options?: readonly string[];
}

/** One event a provider delivers: its words in a list ("An alert fires"), and the sentence a run's prompt tells the agent what fired it in. */
export interface TriggerEventEntry {
  readonly words: string;
  readonly sentence: string;
}

/** One provider as the catalog holds it: its name, its events, and the fields its events filter on. */
export interface TriggerProviderEntry<Event extends string> {
  readonly name: string;
  readonly events: Readonly<Record<Event, TriggerEventEntry>>;
  readonly filters: readonly TriggerFilterField[];
}

const SENTRY_FILTERS: readonly TriggerFilterField[] = [
  { field: INTEGRATION_TRIGGER_FILTER.PROJECT, words: "Projects" },
  { field: INTEGRATION_TRIGGER_FILTER.ENVIRONMENT, words: "Environments" },
  {
    field: INTEGRATION_TRIGGER_FILTER.LEVEL,
    words: "Levels",
    options: Object.values(SENTRY_LEVEL),
  },
];

/** Every provider an automation may be fired by, with its events and filters. */
export const TRIGGER_CATALOG = {
  [TRIGGER_PROVIDER.SENTRY]: {
    name: INTEGRATION_NAME[INTEGRATION_PROVIDER.SENTRY],
    events: {
      [SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED]: {
        words: "an alert fires",
        sentence: "a Sentry alert rule fired",
      },
      [SENTRY_TRIGGER_EVENT.ISSUE_CREATED]: {
        words: "a new issue is created",
        sentence: "Sentry opened a new issue",
      },
    },
    filters: SENTRY_FILTERS,
  },
} as const satisfies {
  readonly [TRIGGER_PROVIDER.SENTRY]: TriggerProviderEntry<SentryTriggerEvent>;
};

/** The catalog's entry for a provider's event. */
export function triggerEventEntry(
  provider: TriggerProvider,
  event: SentryTriggerEvent,
): TriggerEventEntry {
  return TRIGGER_CATALOG[provider].events[event];
}
