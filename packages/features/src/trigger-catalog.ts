import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "./integration-wire.js";

export const TRIGGER_PROVIDER = {
  SENTRY: INTEGRATION_PROVIDER.SENTRY,
} as const;

export type TriggerProvider = (typeof TRIGGER_PROVIDER)[keyof typeof TRIGGER_PROVIDER];

export const SENTRY_TRIGGER_EVENT = {
  ALERT_TRIGGERED: "alert-triggered",
  ISSUE_CREATED: "issue-created",
} as const;

export type SentryTriggerEvent = (typeof SENTRY_TRIGGER_EVENT)[keyof typeof SENTRY_TRIGGER_EVENT];

export const INTEGRATION_TRIGGER_FILTER = {
  PROJECT: "project",
  ENVIRONMENT: "environment",
  LEVEL: "level",
} as const;

export type IntegrationTriggerFilter =
  (typeof INTEGRATION_TRIGGER_FILTER)[keyof typeof INTEGRATION_TRIGGER_FILTER];

export const SENTRY_LEVEL = {
  DEBUG: "debug",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
  FATAL: "fatal",
} as const;

export type SentryLevel = (typeof SENTRY_LEVEL)[keyof typeof SENTRY_LEVEL];

interface TriggerFilterField {
  readonly field: IntegrationTriggerFilter;
  readonly words: string;
  readonly options?: readonly string[];
}

interface TriggerEventEntry {
  readonly words: string;
  readonly sentence: string;
}

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
