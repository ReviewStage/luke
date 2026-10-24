/**
 * settings-fixture.ts -- the synthetic account a fixture run's Settings, Admin, and Automations profiles sign in as, and the answers its pages read in place of the service's.
 *
 * A fixture run signs in to nothing, so Settings draws its signed-out line on
 * every page that reads the account, and Admin and Automations stand nowhere.
 * Under one of these profiles the window's document holds a synthetic
 * account instead, the owner of the fixture's first workspace and an admin of
 * Acme, signed in and an admin of Luke, with the experiments its pages stand
 * behind turned on; the window opens on the page the profile names; and each
 * read those pages ask is answered here, through the act door (`act.ts`), as
 * main would answer it with the service behind it. Every person, address,
 * and repository here is invented, and no credential, token, or key is: a
 * stored key is drawn by its hint alone, as the service only ever answers it,
 * and an expired sign-in by its status, which carries nothing secret.
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import type { AdminMetrics, AdminRetentionCohort } from "@luke/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "@luke/features/admin-overview-vocabulary";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_READ,
  ADMIN_UNANSWERED,
  adminMetricsScope,
  adminMetricsWindow,
} from "@luke/features/admin-wire";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import type { MemorySummary } from "@luke/features/memory-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import type { TasksView } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { type AppStateSnapshot, RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { EXPERIMENT } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";

/** When the fixture stands, from which every instant here is counted: a fixed one, never the clock. */
const NOW = Date.parse("2026-10-24T09:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The fixture's workspaces, by the ids `tasks-fixture.ts` gives them. */
const WORKSPACE = { PERSONAL: "workspace-personal", ACME: "workspace-acme" } as const;

/** The account signed in: the owner of the fixture's first workspace, which is named for it. */
const ACCOUNT_ID = "user-ada";
const ACCOUNT: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: ACCOUNT_ID,
  email: "ada@example.com",
  name: "Ada Lovelace",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** An admin of Luke, read, so Admin stands rather than waiting on the read. */
const ADMIN_ACCESS = { admin: true } as const;

/** The experiments the staged pages stand behind: Memory's page, and the Code review automation the Automations page suggests. */
const STAGED_EXPERIMENTS = { [EXPERIMENT.MEMORY]: true, [EXPERIMENT.CODE_REVIEW]: true } as const;

/** The page each Settings profile opens on, and the workspace it shows where that is not the sidebar's first. */
const SETTINGS_LINKS: ReadonlyMap<string, SettingsLink> = new Map<string, SettingsLink>([
  [RUN_PROFILE.SETTINGS_ACCOUNT, { page: SETTINGS_VIEW.ACCOUNT }],
  [RUN_PROFILE.SETTINGS_WORKSPACE, { page: SETTINGS_VIEW.WORKSPACE, workspaceId: WORKSPACE.ACME }],
  [RUN_PROFILE.SETTINGS_AGENTS, { page: SETTINGS_VIEW.CODING_AGENTS }],
  [RUN_PROFILE.SETTINGS_INTEGRATIONS, { page: SETTINGS_VIEW.INTEGRATIONS }],
  [RUN_PROFILE.SETTINGS_SKILLS, { page: SETTINGS_VIEW.SKILLS, workspaceId: WORKSPACE.ACME }],
  [RUN_PROFILE.SETTINGS_MEMORY, { page: SETTINGS_VIEW.MEMORY, workspaceId: WORKSPACE.ACME }],
]);

/** Every profile the account is signed in under: Settings', Admin's, and Automations'. */
const SIGNED_IN_PROFILES: ReadonlySet<string> = new Set<string>([
  ...SETTINGS_LINKS.keys(),
  RUN_PROFILE.ADMIN,
  RUN_PROFILE.AUTOMATIONS,
  RUN_PROFILE.AUTOMATIONS_EDITOR,
  RUN_PROFILE.AUTOMATIONS_RUNS,
]);

/* ----- Settings › Workspace ----- */

/** A member of a fixture workspace, with no picture, as the service answers one who signed in without one. */
function member(userId: string, name: string, role: WorkspaceMember["role"]): WorkspaceMember {
  return { userId, name, email: `${userId.replace("user-", "")}@example.com`, role };
}

/** Acme's team, whose owner is someone else and whose admin the account is. */
const ACME_MEMBERS: readonly WorkspaceMember[] = [
  member("user-maya", "Maya Okafor", WORKSPACE_ROLE.OWNER),
  member(ACCOUNT_ID, "Ada Lovelace", WORKSPACE_ROLE.ADMIN),
  member("user-theo", "Theo Lindqvist", WORKSPACE_ROLE.MEMBER),
  member("user-priya", "Priya Raman", WORKSPACE_ROLE.MEMBER),
];

/** Each workspace's members: the account alone in its own, and Acme's team. */
const MEMBERS: ReadonlyMap<string, readonly WorkspaceMember[]> = new Map([
  [WORKSPACE.PERSONAL, [member(ACCOUNT_ID, "Ada Lovelace", WORKSPACE_ROLE.OWNER)]],
  [WORKSPACE.ACME, ACME_MEMBERS],
]);

/**
 * The workspaces as the Settings profiles list them, from the list the tasks
 * profiles draw: Acme counting its members, and its Linear connected with
 * its sign-in since expired, which its row says.
 */
export function settingsTasksView(profile: string, list: TasksView): TasksView | undefined {
  if (!SETTINGS_LINKS.has(profile)) return undefined;
  return {
    ...list,
    workspaces: list.workspaces.map((workspace) =>
      workspace.id === WORKSPACE.ACME
        ? { ...workspace, memberCount: ACME_MEMBERS.length, linear: { active: false } }
        : { ...workspace, memberCount: 1 },
    ),
  };
}

/* ----- Settings › Integrations ----- */

/** Where each account stands: GitHub, Notion's two, and Sentry connected; Linear's and Slack's sign-ins expired. */
const INTEGRATION_ACCOUNTS: readonly IntegrationAccount[] = [
  integrationAccount(INTEGRATION_PROVIDER.GITHUB, "github", INTEGRATION_STATUS.CONNECTED, "ada"),
  integrationAccount(INTEGRATION_PROVIDER.LINEAR, "linear", INTEGRATION_STATUS.EXPIRED, "Acme"),
  integrationAccount(INTEGRATION_PROVIDER.NOTION, "notion", INTEGRATION_STATUS.CONNECTED, "Work"),
  integrationAccount(
    INTEGRATION_PROVIDER.NOTION,
    "notion-2",
    INTEGRATION_STATUS.CONNECTED,
    "Personal",
  ),
  integrationAccount(INTEGRATION_PROVIDER.SENTRY, "sentry", INTEGRATION_STATUS.CONNECTED, "acme"),
  integrationAccount(INTEGRATION_PROVIDER.SLACK, "slack", INTEGRATION_STATUS.EXPIRED, "Acme"),
];

function integrationAccount(
  provider: IntegrationProvider,
  connection: string,
  status: IntegrationStatus,
  label: string,
): IntegrationAccount {
  return { provider, connection, status, label };
}

/** Each provider's first account's word, which a provider with none answers disconnected. */
function integrationStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  const statuses = Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.DISCONNECTED]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
  for (const account of INTEGRATION_ACCOUNTS) {
    if (account.connection === account.provider) statuses[account.provider] = account.status;
  }
  return statuses;
}

/** The tools a connected server lists, a few of each, as its server describes them. */
const TOOLS = [
  {
    name: "search",
    title: "Search",
    description: "Find pages, issues, and messages by their words.",
  },
  { name: "read", title: "Read", description: "Read one item whole, by its id or address." },
  {
    name: "create",
    title: "Create",
    description: "Create an item where the account may write.",
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
] as const;

/* ----- Settings › Agents ----- */

/** The models the service offers, Claude's and Codex's. */
const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
    credentialMissing: true,
  },
];

/* ----- Settings › Skills ----- */

function skillId(n: number): string {
  return `5d2b7c1e-4a3f-4e8b-9c6d-${String(n).padStart(12, "0")}`;
}

/** A workspace's skills as its members see them: its own, then the account's. */
function skills(workspaceId: string) {
  return [
    {
      id: skillId(1),
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      name: "release-notes",
      description:
        "Write the release notes for a tag from the pull requests merged since the last.",
      userInvocable: true,
      source: {
        type: INSTALLED_SKILL_SOURCE.GITHUB,
        owner: "acme",
        repo: "agent-skills",
        path: "skills/release-notes",
        ref: "main",
        sha: "4f1c9e2a7b3d5f6081a2c3d4e5f6a7b8c9d0e1f2",
      },
      enabled: true,
      workspaceId,
      installedBy: "Maya Okafor",
      manageable: true,
      createdAt: NOW - 20 * DAY,
      updatedAt: NOW - 3 * DAY,
    },
    {
      id: skillId(2),
      scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
      name: "migration-check",
      description: "Check a schema change commutes with the migrations on every open branch.",
      userInvocable: false,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      enabled: false,
      workspaceId,
      installedBy: "Theo Lindqvist",
      manageable: true,
      createdAt: NOW - 12 * DAY,
      updatedAt: NOW - 12 * DAY,
    },
    {
      id: skillId(3),
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
      name: "plain-words",
      description: "Rewrite a paragraph in short, plain sentences, keeping every fact.",
      userInvocable: true,
      source: { type: INSTALLED_SKILL_SOURCE.TEXT },
      enabled: true,
      installedBy: "Ada Lovelace",
      manageable: true,
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 40 * DAY,
    },
  ];
}

/** One staged skill read whole: its `SKILL.md`, its frontmatter naming it, and its one file; none for an id no staged skill has. */
function skillContent(id: string) {
  const skill = skills("").find((each) => each.id === id);
  if (skill === undefined) return undefined;
  const skillFile = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.description,
    "",
  ].join("\n");
  return { id, skillFile, files: [{ path: "SKILL.md", bytes: skillFile.length }] };
}

/* ----- Settings › Memory ----- */

function memory(
  n: number,
  text: string,
  keptBy: MemorySummary["keptBy"],
  agoDays: number,
  patch: Partial<MemorySummary> = {},
): MemorySummary {
  return {
    id: `7a3e5c9b-2d4f-4b6a-8e1c-${String(n).padStart(12, "0")}`,
    text,
    keptBy,
    forgettable: true,
    private: false,
    createdAt: NOW - agoDays * DAY,
    updatedAt: NOW - agoDays * DAY,
    ...patch,
  };
}

const ADA = { userId: ACCOUNT_ID, name: "Ada Lovelace" } as const;
const MAYA = { userId: "user-maya", name: "Maya Okafor" } as const;
const THEO = { userId: "user-theo", name: "Theo Lindqvist" } as const;

/** The workspace's memories, the most recently kept first. */
const MEMORIES: readonly MemorySummary[] = [
  memory(1, "Migrations are generated with `pnpm db:generate`, never written by hand.", MAYA, 1),
  memory(2, "Invite links expire after 7 days; an accepted one is never reused.", ADA, 2),
  memory(
    3,
    "I review pull requests in the morning, so a review request after noon waits a day.",
    ADA,
    4,
    { private: true },
  ),
  memory(4, "The billing export runs nightly at 02:00 UTC and must finish by 04:00.", THEO, 9),
  memory(5, "Feature flags live in `src/flags.ts`, one constant per flag.", null, 30),
];

/* ----- Admin ----- */

/** The `days` UTC days up to the fixture's day, oldest first, as YYYY-MM-DD. */
function trailingDays(days: number): readonly string[] {
  return Array.from({ length: days }, (_, index) =>
    new Date(NOW - (days - 1 - index) * DAY).toISOString().slice(0, 10),
  );
}

/** A count that rises over the window and dips at weekends, so a chart of it reads as a real one. */
function wave(index: number, base: number, step: number): number {
  const weekend = index % 7 === 5 || index % 7 === 6;
  return Math.round((base + index * step) * (weekend ? 0.4 : 1) + ((index * 7) % 5));
}

/** Six weekly cohorts, each retained a little less week on week, the newest still accruing. */
function cohorts(): AdminRetentionCohort[] {
  const weeks = 6;
  return Array.from({ length: weeks }, (_, cohort) => {
    const size = 18 + cohort * 4;
    const reached = weeks - cohort;
    return {
      weekStart: new Date(NOW - (weeks - cohort) * 7 * DAY).toISOString().slice(0, 10),
      size,
      cells: Array.from({ length: reached }, (_, offset) => {
        const activeAccounts = offset === 0 ? size : Math.round(size * (0.62 - offset * 0.07));
        return {
          offset,
          activeAccounts,
          share: activeAccounts / size,
          inProgress: offset === reached - 1,
        };
      }),
    };
  });
}

/** One of the most active accounts, its numbers counted over the window. */
function topAccount(id: string, name: string, activeDays: number, admin = false) {
  return {
    id,
    name,
    email: `${id.replace("user-", "")}@example.com`,
    image: null,
    admin,
    activeDays,
    tasks: activeDays * 2,
    agents: activeDays * 3,
    prsMerged: activeDays,
    callMinutes: activeDays * 14,
    lastSeenAt: NOW - activeDays * HOUR,
  };
}

/** How many of the fixture's accounts are admins, whom the Overview leaves out unless asked for everyone. */
const ADMIN_ACCOUNTS = 3;

/** Every other account, more than a quarter's signups add up to, so no window counts more new accounts than there are. */
const NON_ADMIN_ACCOUNTS = 640;

/**
 * The Overview's numbers over the window the read asks for, the last 30 days
 * where it names none, and over every account or every account but the
 * admins, as its Hide admins asks: a window's counts scaled to its length,
 * and the admins left out of the totals and the most active accounts.
 */
function adminMetrics(query: Readonly<Record<string, string>>): AdminMetrics {
  const windowDays =
    adminMetricsWindow(query[ADMIN_METRICS_WINDOW_PARAM]) ?? ADMIN_METRICS_WINDOW_DEFAULT;
  const adminsHidden =
    adminMetricsScope(query[ADMIN_METRICS_SCOPE_PARAM]) !== ADMIN_METRICS_SCOPE.ALL;
  // A month's active days scaled to the window, at least one and never more than the window holds.
  const activeIn = (monthly: number) =>
    Math.min(windowDays, Math.max(1, Math.round((monthly * windowDays) / 30)));
  const days = trailingDays(windowDays);
  const retention = { weeks: 6, cohorts: cohorts() };
  const funnel = [
    [FUNNEL_STEP.SIGNED_UP, 64],
    [FUNNEL_STEP.GITHUB_CONNECTED, 51],
    [FUNNEL_STEP.CREATED_TASK, 43],
    [FUNNEL_STEP.HELD_CALL, 31],
    [FUNNEL_STEP.STARTED_AGENT, 27],
    [FUNNEL_STEP.OPENED_PR, 19],
    [FUNNEL_STEP.MERGED_PR, 14],
  ] as const;
  // The signups are the daily series summed, as the service counts them, so the total and the funnel's base agree with the bars.
  const dailySignups = days.map((day, index) => ({ day, count: wave(index, 1, 0.08) }));
  const signedUp = dailySignups.reduce((sum, day) => sum + day.count, 0);
  const reach = [
    [REACH_FEATURE.TASKS, 38],
    [REACH_FEATURE.CODING_AGENTS, 33],
    [REACH_FEATURE.INBOX, 26],
    [REACH_FEATURE.VOICE_CALLS, 21],
    [REACH_FEATURE.INTEGRATIONS, 29],
    [REACH_FEATURE.AUTOMATIONS, 9],
    [REACH_FEATURE.CHAT, 12],
  ] as const;
  const activeDevelopers = adminsHidden ? 42 : 42 + ADMIN_ACCOUNTS;
  const topAccounts = [
    topAccount("user-maya", "Maya Okafor", activeIn(27)),
    topAccount(ACCOUNT_ID, "Ada Lovelace", activeIn(24), true),
    topAccount("user-theo", "Theo Lindqvist", activeIn(19)),
    topAccount("user-priya", "Priya Raman", activeIn(12)),
  ];
  return {
    generatedAt: NOW,
    windowDays,
    users: {
      total: adminsHidden ? NON_ADMIN_ACCOUNTS : NON_ADMIN_ACCOUNTS + ADMIN_ACCOUNTS,
      newInWindow: signedUp,
      signupTrend: { days: 7, recent: 18, prior: 14 },
      dailySignups,
    },
    overview: {
      headline: {
        activeDevelopers: { days: 7, recent: activeDevelopers, prior: 37 },
        tasksCreated: { days: 7, recent: 96, prior: 81 },
        agentsStarted: { days: 7, recent: 214, prior: 188 },
        agentsFromAutomations: 37,
        prsMerged: { days: 7, recent: 71, prior: 66 },
        prsOpened: { opened: 102, merged: 64 },
      },
      activity: {
        daily: days.map((day, index) => ({
          day,
          [ACTIVITY_FEATURE.AGENTS_STARTED]: wave(index, 20, 0.6),
          [ACTIVITY_FEATURE.PLAN_REVISIONS]: wave(index, 34, 0.5),
          [ACTIVITY_FEATURE.CALLS_HELD]: wave(index, 8, 0.2),
          [ACTIVITY_FEATURE.INBOX_ANSWERED]: wave(index, 15, 0.4),
          [ACTIVITY_FEATURE.AUTOMATION_RUNS]: wave(index, 4, 0.2),
        })),
        trend: { days: 7, recent: 1840, prior: 1622 },
      },
      funnel: funnel.map(([step, monthly]) => {
        // Each step keeps its month's share of the signups, so no step outnumbers the one before it.
        const accounts = Math.round((signedUp * monthly) / 64);
        return { step, accounts, share: signedUp === 0 ? null : accounts / signedUp };
      }),
      reach: {
        activeDevelopers,
        features: reach.map(([feature, developers]) => ({
          feature,
          developers,
          share: developers / activeDevelopers,
        })),
      },
      topAccounts: adminsHidden ? topAccounts.filter((account) => !account.admin) : topAccounts,
      retention,
    },
    retention,
  };
}

/* ----- The act door ----- */

type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind>;

/** Every read the staged pages ask, answered as the service would answer it for this account. */
const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.GITHUB_TOKEN_READ]: () => ({
    token: {
      login: "ada",
      hint: "…7f2c",
      status: GITHUB_TOKEN_STATUS.VERIFIED,
      statusAt: NOW - 2 * DAY,
      addedAt: NOW - 30 * DAY,
      expiresAt: NOW + 60 * DAY,
    },
  }),
  [ACT_KIND.PROVIDER_KEYS_READ]: () => ({
    keys: [],
    subscriptions: [
      {
        provider: MODEL_PROVIDER.ANTHROPIC,
        kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        hint: "…41d0",
        addedAt: NOW - 21 * DAY,
        status: PROVIDER_KEY_STATUS.VERIFIED,
        statusAt: NOW - HOUR,
        forAgents: true,
      },
      {
        provider: MODEL_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        hint: "…9b3e",
        addedAt: NOW - 45 * DAY,
        status: PROVIDER_KEY_STATUS.INVALID,
        statusAt: NOW - 3 * DAY,
        forAgents: true,
      },
    ],
  }),
  [ACT_KIND.CODING_AGENTS_MODELS]: () => ({ models: MODELS }),
  [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: () => ({
    choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
  }),
  [ACT_KIND.CHAPTERS_MODEL_READ]: () => ({ model: CHAPTERS_MODEL.SONNET }),
  [ACT_KIND.INTEGRATIONS_STATUS]: () => ({
    integrations: integrationStatuses(),
    accounts: INTEGRATION_ACCOUNTS,
    addable: [INTEGRATION_PROVIDER.NOTION, INTEGRATION_PROVIDER.SLACK],
  }),
  [ACT_KIND.INTEGRATIONS_TOOLS]: () => ({ tools: TOOLS }),
  [ACT_KIND.WORKSPACE_MEMBERS_READ]: ({ workspaceId }) => MEMBERS.get(workspaceId) ?? [],
  [ACT_KIND.WORKSPACE_INVITATIONS_READ]: ({ workspaceId }) =>
    workspaceId === WORKSPACE.ACME
      ? [
          {
            id: "invitation-sam",
            email: "sam@example.com",
            role: WORKSPACE_ROLE.MEMBER,
            expiresAt: new Date(NOW + 5 * DAY).toISOString(),
            acceptUrl: "https://tryluke.dev/invite/fixture",
          },
        ]
      : [],
  [ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_READ]: ({ workspaceId }) =>
    workspaceId === WORKSPACE.ACME
      ? [
          {
            fullName: "theo/acme-scripts",
            addedBy: "Theo Lindqvist",
            addedAt: NOW - 6 * DAY,
            removable: true,
          },
        ]
      : [],
  [ACT_KIND.WORKSPACE_SENTRY_READ]: ({ workspaceId }) => ({
    configured: true,
    installations:
      workspaceId === WORKSPACE.ACME ? [{ installationId: "sentry-acme", account: "acme" }] : [],
  }),
  [ACT_KIND.INSTALLED_SKILLS_LIST]: ({ workspaceId }) => ({ skills: skills(workspaceId) }),
  [ACT_KIND.INSTALLED_SKILLS_READ]: ({ skillId: id }) =>
    skillContent(id) ?? { failure: INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND },
  [ACT_KIND.INSTALLED_SKILLS_CHECK_UPDATE]: ({ skillId: id }) => ({
    available: id === skillId(1),
    latestSha: "9a8b7c6d5e4f30211a2b3c4d5e6f708192a3b4c5",
  }),
  [ACT_KIND.MEMORIES_READ]: () => ({ memories: MEMORIES }),
  [ACT_KIND.ADMIN_READ]: ({ procedure, query }) =>
    procedure === ADMIN_READ.METRICS
      ? { answer: adminMetrics(query) }
      : { refused: ADMIN_UNANSWERED },
};

/**
 * The page a Settings profile opens Settings on at launch, with the
 * workspace it shows where that is not the sidebar's; none under any other.
 */
export function settingsLaunchLink(profile: string): SettingsLink | undefined {
  return SETTINGS_LINKS.get(profile);
}

/**
 * Main's document as these profiles draw it: the account signed in, an
 * admin of Luke, with the staged pages' experiments on. The same document,
 * the very object, under any other profile. Each slice laid over is one
 * object across deliveries, but the settings, which carry main's own, so a
 * delivery that moves nothing of them draws nothing again.
 */
export function settingsAppState(profile: string, state: AppStateSnapshot): AppStateSnapshot {
  if (!SIGNED_IN_PROFILES.has(profile)) return state;
  return {
    ...state,
    account: ACCOUNT,
    access: ADMIN_ACCESS,
    ...(state.settings === undefined ? undefined : { settings: stagedSettings(state.settings) }),
  };
}

/** Main's settings with the staged experiments on, one object for each of main's. */
const STAGED_SETTINGS = new WeakMap<
  NonNullable<AppStateSnapshot["settings"]>,
  NonNullable<AppStateSnapshot["settings"]>
>();

function stagedSettings(
  settings: NonNullable<AppStateSnapshot["settings"]>,
): NonNullable<AppStateSnapshot["settings"]> {
  const held = STAGED_SETTINGS.get(settings);
  if (held !== undefined) return held;
  const staged = { ...settings, experiments: { ...settings.experiments, ...STAGED_EXPERIMENTS } };
  STAGED_SETTINGS.set(settings, staged);
  return staged;
}

/**
 * What these profiles answer an act with, in place of main, held in a box so
 * an act that answers nothing is told from one left to main; none for a kind
 * their pages do not read, and under any other profile.
 */
export function settingsActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  if (!SIGNED_IN_PROFILES.has(profile)) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload and answering its result.
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined ? undefined : { answer: answer(payload) };
}
