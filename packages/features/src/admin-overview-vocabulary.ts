/**
 * admin-overview-vocabulary.ts -- the names the Overview's answer keys its
 * series, funnel steps, reach rows, and retention bases by.
 *
 * Both sides speak them: the read keys its answer by them and the page draws
 * its legend, labels, and toggle from them. The module imports nothing, so the
 * page reaches these constants without pulling a line of query code into the
 * browser bundle, which `admin-overview.ts` (through `admin-metrics.ts`) would.
 */

/**
 * The daily counts the activity chart stacks, one per feature, in the order the
 * stack is drawn from its base. Each is attributed to the account that did it,
 * so the hide-admins scope filters every series the same way.
 */
export const ACTIVITY_FEATURE = {
  /** A coding agent started (`agent.created_at`), by hand, by the app, or by an automation. */
  AGENTS_STARTED: "agentsStarted",
  /** A plan revision written by the developer, or by the retired notetaker on their behalf before agents wrote plans. */
  PLAN_REVISIONS: "planRevisions",
  /** An inbox item the developer answered (`inbox_item.settled_at`, answered). */
  INBOX_ANSWERED: "inboxAnswered",
  /** An automation that fired and was not held back by a guard (`automation_run.fired_at`). */
  AUTOMATION_RUNS: "automationRuns",
} as const;

export type ActivityFeature = (typeof ACTIVITY_FEATURE)[keyof typeof ACTIVITY_FEATURE];

/**
 * Every daily count the overview reads: the chart's features, and the ones only
 * the headline tiles fold into a trend.
 */
export const DAILY_COUNT = {
  ...ACTIVITY_FEATURE,
  TASKS_CREATED: "tasksCreated",
  /** Coding agents an automation started, a subset of `AGENTS_STARTED`: `AGENT_ORIGIN.AUTOMATION`'s. */
  AGENTS_FROM_AUTOMATIONS: "agentsFromAutomations",
  /** Coding agents the Slack bot started and no automation did: `AGENT_ORIGIN.SLACK`'s. */
  AGENTS_FROM_SLACK: "agentsFromSlack",
  /** Coding agents another agent started, and neither an automation nor Slack: `AGENT_ORIGIN.AGENT`'s. */
  AGENTS_FROM_AGENTS: "agentsFromAgents",
  /** Task pilots started, whatever started them, a subset of `AGENTS_STARTED` and no origin of its own. */
  PILOTS_STARTED: "pilotsStarted",
  /** Pull requests merged, dated by `agent.published.mergedAt`. */
  PRS_MERGED: "prsMerged",
} as const;

export type DailyCount = (typeof DAILY_COUNT)[keyof typeof DAILY_COUNT];

/**
 * How a coding agent started, each agent counted under exactly one so the
 * origins sum to every agent started. Where an agent fits more than one, the
 * first in this order wins: an automation, then Slack, then another agent,
 * then by hand, which is every agent the others leave. A task's pilot is what
 * an agent is, not how it started, so it is counted beside the origins
 * (`DAILY_COUNT.PILOTS_STARTED`) rather than as one.
 */
export const AGENT_ORIGIN = {
  /** An automation's run started it (`automation_origin`, or `automation_id` on a row from before that column). */
  AUTOMATION: "automation",
  /** A member's message to the Slack bot started it (`source`'s kind `slack`). */
  SLACK: "slack",
  /** Another coding agent's `start_agent` started it, a pilot's coders among them (`started_by_agent_id`). */
  AGENT: "agent",
  /** A member started it in the app: every agent the origins above leave. */
  HAND: "hand",
} as const;

export type AgentOrigin = (typeof AGENT_ORIGIN)[keyof typeof AGENT_ORIGIN];

/**
 * The daily counts the Day page counts per account, one column each: the
 * chart's features, and the tasks a feature reach row folds in beside them.
 */
export const DAY_ACCOUNT_COUNT = {
  TASKS_CREATED: DAILY_COUNT.TASKS_CREATED,
  PLAN_REVISIONS: DAILY_COUNT.PLAN_REVISIONS,
  AGENTS_STARTED: DAILY_COUNT.AGENTS_STARTED,
  INBOX_ANSWERED: DAILY_COUNT.INBOX_ANSWERED,
  AUTOMATION_RUNS: DAILY_COUNT.AUTOMATION_RUNS,
} as const;

export type DayAccountCount = (typeof DAY_ACCOUNT_COUNT)[keyof typeof DAY_ACCOUNT_COUNT];

/** The activation funnel's steps, in the order a new account is expected to take them. */
export const FUNNEL_STEP = {
  SIGNED_UP: "signedUp",
  GITHUB_CONNECTED: "githubConnected",
  CREATED_TASK: "createdTask",
  STARTED_AGENT: "startedAgent",
  OPENED_PR: "openedPr",
  MERGED_PR: "mergedPr",
} as const;

export type FunnelStep = (typeof FUNNEL_STEP)[keyof typeof FUNNEL_STEP];

/**
 * The features whose reach among the week's active developers the tables can
 * state honestly. Run on this Mac is not among them: its command rows are
 * withdrawn once the call that queued them stops waiting, so a week's use
 * leaves nothing to count.
 */
export const REACH_FEATURE = {
  /** Created a task or wrote a plan revision as the developer. */
  TASKS: "tasks",
  AGENTS: "agents",
  /** Answered an inbox item. */
  INBOX: "inbox",
  /** Has an integration of their own connected; a state, not a use. */
  INTEGRATIONS: "integrations",
  /** Owns an automation that fired and was not held back. */
  AUTOMATIONS: "automations",
} as const;

export type ReachFeature = (typeof REACH_FEATURE)[keyof typeof REACH_FEATURE];

/** What the retention grid counts an account as retained by. */
export const RETENTION_BASIS = {
  /** A task created, a plan revision written as the developer, or an agent started. */
  MEANINGFUL: "meaningful",
  /** Any metered hosted-tier call, the grid's basis before the Overview was rebuilt; retired, since only dictation still meters one. */
  HOSTED_CALL: "hostedCall",
} as const;

export type RetentionBasis = (typeof RETENTION_BASIS)[keyof typeof RETENTION_BASIS];
