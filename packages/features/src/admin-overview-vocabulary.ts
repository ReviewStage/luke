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
  /** A coding agent started (`coding_agent.created_at`), by hand, by Luke, or by an automation. */
  AGENTS_STARTED: "agentsStarted",
  /** A plan revision written by the developer, or by Luke's notetaker on their call. */
  PLAN_REVISIONS: "planRevisions",
  /** A voice call held (`voice_sessions.started_at`). */
  CALLS_HELD: "callsHeld",
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
  /** Coding agents an automation started, a subset of `AGENTS_STARTED`. */
  AGENTS_FROM_AUTOMATIONS: "agentsFromAutomations",
  /** Pull requests merged, dated by `coding_agent.published.mergedAt`. */
  PRS_MERGED: "prsMerged",
} as const;

export type DailyCount = (typeof DAILY_COUNT)[keyof typeof DAILY_COUNT];

/** The activation funnel's steps, in the order a new account is expected to take them. */
export const FUNNEL_STEP = {
  SIGNED_UP: "signedUp",
  GITHUB_CONNECTED: "githubConnected",
  CREATED_TASK: "createdTask",
  HELD_CALL: "heldCall",
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
  CODING_AGENTS: "codingAgents",
  /** Answered an inbox item. */
  INBOX: "inbox",
  VOICE_CALLS: "voiceCalls",
  /** Has an integration connected, their own or their workspace's; a state, not a use. */
  INTEGRATIONS: "integrations",
  /** Owns an automation that fired and was not held back. */
  AUTOMATIONS: "automations",
  /** Posted a message in a workspace's chat. */
  CHAT: "chat",
} as const;

export type ReachFeature = (typeof REACH_FEATURE)[keyof typeof REACH_FEATURE];

/** What the retention grid counts an account as retained by. */
export const RETENTION_BASIS = {
  /** A task created, a plan revision written as the developer, an agent started, or a call held. */
  MEANINGFUL: "meaningful",
  /** Any metered hosted-tier call, the grid's basis before the Overview was rebuilt. */
  HOSTED_CALL: "hostedCall",
} as const;

export type RetentionBasis = (typeof RETENTION_BASIS)[keyof typeof RETENTION_BASIS];
