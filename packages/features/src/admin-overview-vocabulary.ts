export const ACTIVITY_FEATURE = {
  AGENTS_STARTED: "agentsStarted",
  DESCRIPTION_REVISIONS: "descriptionRevisions",
  INBOX_ANSWERED: "inboxAnswered",
  AUTOMATION_RUNS: "automationRuns",
} as const;

export type ActivityFeature = (typeof ACTIVITY_FEATURE)[keyof typeof ACTIVITY_FEATURE];

export const DAILY_COUNT = {
  ...ACTIVITY_FEATURE,
  TASKS_CREATED: "tasksCreated",
  AGENTS_FROM_AUTOMATIONS: "agentsFromAutomations",
  AGENTS_FROM_SLACK: "agentsFromSlack",
  AGENTS_FROM_AGENTS: "agentsFromAgents",
  PILOTS_STARTED: "pilotsStarted",
  PRS_MERGED: "prsMerged",
} as const;

export type DailyCount = (typeof DAILY_COUNT)[keyof typeof DAILY_COUNT];

export const AGENT_ORIGIN = {
  AUTOMATION: "automation",
  SLACK: "slack",
  AGENT: "agent",
  HAND: "hand",
} as const;

export type AgentOrigin = (typeof AGENT_ORIGIN)[keyof typeof AGENT_ORIGIN];

export const DAY_ACCOUNT_COUNT = {
  TASKS_CREATED: DAILY_COUNT.TASKS_CREATED,
  DESCRIPTION_REVISIONS: DAILY_COUNT.DESCRIPTION_REVISIONS,
  AGENTS_STARTED: DAILY_COUNT.AGENTS_STARTED,
  INBOX_ANSWERED: DAILY_COUNT.INBOX_ANSWERED,
  AUTOMATION_RUNS: DAILY_COUNT.AUTOMATION_RUNS,
} as const;

export type DayAccountCount = (typeof DAY_ACCOUNT_COUNT)[keyof typeof DAY_ACCOUNT_COUNT];

export const FUNNEL_STEP = {
  SIGNED_UP: "signedUp",
  GITHUB_CONNECTED: "githubConnected",
  CREATED_TASK: "createdTask",
  STARTED_AGENT: "startedAgent",
  OPENED_PR: "openedPr",
  MERGED_PR: "mergedPr",
} as const;

export type FunnelStep = (typeof FUNNEL_STEP)[keyof typeof FUNNEL_STEP];

export const REACH_FEATURE = {
  TASKS: "tasks",
  AGENTS: "agents",
  INBOX: "inbox",
  INTEGRATIONS: "integrations",
  AUTOMATIONS: "automations",
} as const;

export type ReachFeature = (typeof REACH_FEATURE)[keyof typeof REACH_FEATURE];

export const RETENTION_BASIS = {
  MEANINGFUL: "meaningful",
  HOSTED_CALL: "hostedCall",
} as const;

export type RetentionBasis = (typeof RETENTION_BASIS)[keyof typeof RETENTION_BASIS];

export const MEANINGFUL_ACTION = {
  TASKS_CREATED: "tasksCreated",
  DESCRIPTION_REVISIONS: "descriptionRevisions",
  AGENTS_STARTED: "agentsStarted",
} as const;

export type MeaningfulAction = (typeof MEANINGFUL_ACTION)[keyof typeof MEANINGFUL_ACTION];
