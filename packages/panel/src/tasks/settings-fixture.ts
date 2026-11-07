/**
 * settings-fixture.ts -- the synthetic account a fixture run's Settings, Admin, and Automations profiles sign in as, and the answers its pages read in place of the service's.
 *
 * A fixture run signs in to nothing, so Settings draws its signed-out line on
 * every page that reads the account, and Admin and Automations stand nowhere.
 * Under one of these profiles the window's document holds a synthetic
 * account instead, the owner of the fixture's first workspace and an admin of
 * Acme, signed in and an admin of the service, with the experiments its pages stand
 * behind turned on; the window opens on the page the profile names; and each
 * read those pages ask is answered here, through the act door (`act.ts`), as
 * main would answer it with the service behind it. The workspaces' members
 * are held under every profile, laid on the document as the host lays them,
 * since the window reads them wherever it stands, and a task names its
 * creator from the same people. Every person, address,
 * and repository here is invented, and no credential, token, or key is: a
 * stored key is drawn by its hint alone, as the service only ever answers it,
 * and an expired sign-in by its status, which carries nothing secret.
 */

import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import type { AdminMetrics, AdminRetentionCohort } from "@repo/features/admin-answer-wire";
import {
  ACTIVITY_FEATURE,
  AGENT_ORIGIN,
  FUNNEL_STEP,
  REACH_FEATURE,
} from "@repo/features/admin-overview-vocabulary";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_METRICS_SCOPE_PARAM,
  ADMIN_METRICS_WINDOW_DEFAULT,
  ADMIN_METRICS_WINDOW_PARAM,
  ADMIN_READ,
  ADMIN_UNANSWERED,
  adminMetricsScope,
  adminMetricsWindow,
} from "@repo/features/admin-wire";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { DEVICE_ARCH, DEVICE_PLATFORM, HOST_UPDATE } from "@repo/features/device-agent-wire";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type { MemorySummary } from "@repo/features/memory-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@repo/features/models-wire";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import type { WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import type { TasksView } from "@repo/features/tasks-view";
import type { WorkspaceVariable } from "@repo/features/workspace-environment-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppAccountPreferences,
  type AppDevicePresences,
  type AppGitHubTokens,
  type AppHosts,
  type AppInstalledSkills,
  type AppIntegrations,
  type AppIntegrationTools,
  type AppMcpClients,
  type AppMemories,
  type AppModels,
  type AppProviderKeys,
  type AppRepositoryLists,
  type AppSlackChannels,
  type AppStateSnapshot,
  type AppTokenRepositories,
  type AppWorkspaceIntegrations,
  type AppWorkspaceInvitations,
  type AppWorkspaceMembers,
  EVERY_WORKSPACE,
  RUN_PROFILE,
} from "@repo/host/app-state";
import {
  CLI_INSTALL_OUTCOME,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
} from "@repo/host/contract";
import { EXPERIMENT } from "@repo/settings";
import { SETTINGS_VIEW, type SettingsLink } from "@repo/settings/settings-views";

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

/** An admin of the service, read, so Admin stands rather than waiting on the read. */
const ADMIN_ACCESS = { admin: true } as const;

/** The experiments the staged pages stand behind: Hosts' page, Skills', and Memory's. */
const STAGED_EXPERIMENTS = {
  [EXPERIMENT.BRING_YOUR_OWN_HOST]: true,
  [EXPERIMENT.SKILLS]: true,
  [EXPERIMENT.MEMORY]: true,
} as const;

/** The staged hosts, by id. */
const FIXTURE_HOST = {
  ONLINE: "7d3c2a10-0000-4000-8000-000000000001",
  OLD: "7d3c2a10-0000-4000-8000-000000000002",
  OFFLINE: "7d3c2a10-0000-4000-8000-000000000003",
  MAC: "7d3c2a10-0000-4000-8000-000000000005",
  SETUP_FAILED: "7d3c2a10-0000-4000-8000-000000000006",
  UPDATE_WAITING: "7d3c2a10-0000-4000-8000-000000000007",
  UPDATING: "7d3c2a10-0000-4000-8000-000000000008",
  UPDATE_FAILED: "7d3c2a10-0000-4000-8000-000000000009",
} as const;

/** The staged hosts that beat just now, so they read online: every one but the one staged offline. */
const BEATING_HOSTS = [
  FIXTURE_HOST.ONLINE,
  FIXTURE_HOST.OLD,
  FIXTURE_HOST.MAC,
  FIXTURE_HOST.SETUP_FAILED,
  FIXTURE_HOST.UPDATE_WAITING,
  FIXTURE_HOST.UPDATING,
  FIXTURE_HOST.UPDATE_FAILED,
] as const;

/** Where the staged install commands fetch their script. */
const STAGED_INSTALL_SCRIPT = "https://app.test/install.sh";

/** The page each Settings profile opens on, and the workspace it shows where that is not the sidebar's first. */
const SETTINGS_LINKS: ReadonlyMap<string, SettingsLink> = new Map<string, SettingsLink>([
  [RUN_PROFILE.SETTINGS_ACCOUNT, { page: SETTINGS_VIEW.ACCOUNT }],
  [RUN_PROFILE.SETTINGS_WORKSPACE, { page: SETTINGS_VIEW.WORKSPACE, workspaceId: WORKSPACE.ACME }],
  [RUN_PROFILE.SETTINGS_AGENTS, { page: SETTINGS_VIEW.AGENTS }],
  [RUN_PROFILE.SETTINGS_HOSTS, { page: SETTINGS_VIEW.HOSTS }],
  [RUN_PROFILE.SETTINGS_INTEGRATIONS, { page: SETTINGS_VIEW.INTEGRATIONS }],
  [RUN_PROFILE.SETTINGS_MCP, { page: SETTINGS_VIEW.MCP }],
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

/** Someone by id and name, as a task names its creator and a member is listed. */
type Person = Pick<WorkspaceMember, "userId" | "name">;

/**
 * The fixture's people, by id and the name their account holds, as a task
 * names who created it: the account, and the teammates its workspaces share.
 */
export const FIXTURE_PERSON = {
  ADA: { userId: ACCOUNT_ID, name: "Ada Lovelace" },
  MAYA: { userId: "user-maya", name: "Maya Okafor" },
  THEO: { userId: "user-theo", name: "Theo Lindqvist" },
  PRIYA: { userId: "user-priya", name: "Priya Raman" },
} as const satisfies Record<string, Person>;

/** A member of a fixture workspace, with no picture, as the service answers one who signed in without one. */
function member(person: Person, role: WorkspaceMember["role"]): WorkspaceMember {
  return { ...person, email: `${person.userId.replace("user-", "")}@example.com`, role };
}

/** The account's own workspace: the account, and two teammates it brought in. */
const PERSONAL_MEMBERS: readonly WorkspaceMember[] = [
  member(FIXTURE_PERSON.ADA, WORKSPACE_ROLE.OWNER),
  member(FIXTURE_PERSON.THEO, WORKSPACE_ROLE.MEMBER),
  member(FIXTURE_PERSON.PRIYA, WORKSPACE_ROLE.MEMBER),
];

/** Acme's team, whose owner is someone else and whose admin the account is. */
const ACME_MEMBERS: readonly WorkspaceMember[] = [
  member(FIXTURE_PERSON.MAYA, WORKSPACE_ROLE.OWNER),
  member(FIXTURE_PERSON.ADA, WORKSPACE_ROLE.ADMIN),
  member(FIXTURE_PERSON.THEO, WORKSPACE_ROLE.MEMBER),
  member(FIXTURE_PERSON.PRIYA, WORKSPACE_ROLE.MEMBER),
];

/** Each workspace's members: the account's own and Acme's team. */
const MEMBERS: ReadonlyMap<string, readonly WorkspaceMember[]> = new Map([
  [WORKSPACE.PERSONAL, PERSONAL_MEMBERS],
  [WORKSPACE.ACME, ACME_MEMBERS],
]);

/**
 * The workspaces as the Settings profiles list them, from the list the tasks
 * profiles draw: each counting its members.
 */
export function settingsTasksView(profile: string, list: TasksView): TasksView | undefined {
  if (!SETTINGS_LINKS.has(profile)) return undefined;
  return {
    ...list,
    workspaces: list.workspaces.map((workspace) => ({
      ...workspace,
      memberCount: MEMBERS.get(workspace.id)?.length ?? 1,
    })),
  };
}

/** Each workspace's members as the host holds them read (`LIVE_READ.WORKSPACE_MEMBERS`), one object for every delivery. */
const HELD_MEMBERS: AppWorkspaceMembers = Object.fromEntries(
  [...MEMBERS].map(([workspaceId, members]) => [workspaceId, { rows: { members } }]),
);

/** Each workspace's pending invitations as the host holds them read (`LIVE_READ.WORKSPACE_INVITATIONS`): one in Acme, none elsewhere, one object for every delivery. */
const HELD_INVITATIONS: AppWorkspaceInvitations = Object.fromEntries(
  [...MEMBERS.keys()].map((workspaceId) => [
    workspaceId,
    {
      rows:
        workspaceId === WORKSPACE.ACME
          ? [
              {
                id: "invitation-sam",
                email: "sam@example.com",
                role: WORKSPACE_ROLE.MEMBER,
                expiresAt: new Date(NOW + 5 * DAY).toISOString(),
                acceptUrl: "https://vespin.dev/invite/fixture",
              },
            ]
          : [],
    },
  ]),
);

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
  { name: "search", description: "Find pages, issues, and messages by their words." },
  { name: "read", description: "Read one item whole, by its id or address." },
  { name: "create", description: "Create an item where the account may write." },
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

/** Every connected staged server's tools, as the host holds them for the windows. */
const STAGED_TOOLS: AppIntegrationTools = Object.fromEntries(
  INTEGRATION_ACCOUNTS.filter((account) => account.status === INTEGRATION_STATUS.CONNECTED).map(
    (account) => [account.connection, { rows: { tools: TOOLS } }],
  ),
);

/* ----- Settings › Skills ----- */

function skillId(n: number): string {
  return `5d2b7c1e-4a3f-4e8b-9c6d-${String(n).padStart(12, "0")}`;
}

/** A workspace's skills as its members see them: its own, then the account's. */
function skills(workspaceId: string): InstalledSkillSummary[] {
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
      enabled: true,
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
    createdAt: NOW - agoDays * DAY,
    updatedAt: NOW - agoDays * DAY,
    ...patch,
  };
}

const { ADA, MAYA, THEO } = FIXTURE_PERSON;

/** The workspace's memories, the most recently kept first. */
const MEMORIES: readonly MemorySummary[] = [
  memory(1, "Migrations are generated with `pnpm db:generate`, never written by hand.", MAYA, 1),
  memory(2, "Invite links expire after 7 days; an accepted one is never reused.", ADA, 2),
  memory(3, "Pull requests are reviewed in the morning; one asked after noon waits a day.", ADA, 4),
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
    [FUNNEL_STEP.STARTED_AGENT, 27],
    [FUNNEL_STEP.OPENED_PR, 19],
    [FUNNEL_STEP.MERGED_PR, 14],
  ] as const;
  // The signups are the daily series summed, as the service counts them, so the total and the funnel's base agree with the bars.
  const dailySignups = days.map((day, index) => ({ day, count: wave(index, 1, 0.08) }));
  const signedUp = dailySignups.reduce((sum, day) => sum + day.count, 0);
  const reach = [
    [REACH_FEATURE.TASKS, 38],
    [REACH_FEATURE.AGENTS, 33],
    [REACH_FEATURE.INBOX, 26],
    [REACH_FEATURE.INTEGRATIONS, 29],
    [REACH_FEATURE.AUTOMATIONS, 9],
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
        prsMerged: { days: 7, recent: 71, prior: 66 },
        prsOpened: { opened: 102, merged: 64 },
      },
      agentOrigins: {
        agentsStarted: 214,
        origins: (
          [
            [AGENT_ORIGIN.AUTOMATION, 37],
            [AGENT_ORIGIN.SLACK, 18],
            [AGENT_ORIGIN.AGENT, 63],
            [AGENT_ORIGIN.HAND, 96],
          ] as const
        ).map(([origin, agents]) => ({ origin, agents, share: agents / 214 })),
        pilots: 11,
      },
      activity: {
        daily: days.map((day, index) => ({
          day,
          [ACTIVITY_FEATURE.AGENTS_STARTED]: wave(index, 20, 0.6),
          [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: wave(index, 34, 0.5),
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

/* ----- Acme's Slack bot ----- */

/** The repositories Acme's GitHub reaches, which the Slack bot's pickers list. */
const ACME_REPOSITORIES = ["relay", "web", "api"].map((name, index) => ({
  owner: "acme",
  name,
  fullName: `acme/${name}`,
  defaultBranch: "main",
  private: true,
  updatedAt: Date.parse("2026-10-06T11:00:00Z") - index * 86_400_000,
}));

/** Acme's Slack bot as the staged page last changed it: connected, a default repository, and the team's channels. */
let acmeSlackBot: WorkspaceSlackBot = {
  configured: true,
  team: { id: "T0ACME", name: "Acme" },
  notifications: true,
  defaultRepository: "acme/relay",
  channels: [
    { id: "C0ENG", name: "eng", private: false, member: true, repository: "acme/api" },
    { id: "C0BUGS", name: "bugs", private: false, member: true },
    { id: "G0INCIDENTS", name: "incidents", private: true, member: true },
    { id: "C0DESIGN", name: "design", private: false, member: false },
    { id: "C0GENERAL", name: "general", private: false, member: false },
  ],
};

/* ----- Settings › Environment ----- */

/** Acme's environment variables by name, as an add, a replace, and a delete leave them. */
let acmeVariables: readonly WorkspaceVariable[] = [
  { name: "DATABASE_URL", updatedAt: NOW - 3 * DAY },
  { name: "OPENAI_API_KEY", updatedAt: NOW - DAY },
  { name: "SENTRY_AUTH_TOKEN", updatedAt: NOW - 2 * HOUR },
];

/** The variables a write leaves, in name order as the service answers them. */
function variablesAnswer(variables: readonly WorkspaceVariable[]) {
  acmeVariables = [...variables].sort((one, other) => one.name.localeCompare(other.name));
  return { variables: acmeVariables };
}

/* ----- The act door ----- */

type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
) => PortActResult<Kind>;

/** Every read the staged pages ask, answered as the service would answer it for this account. */
const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  // A box waiting on its code, as a pairing's link opened over Settings › Hosts reads it.
  [ACT_KIND.HOSTS_PAIRING_READ]: () => ({
    name: "fra-02",
    platform: DEVICE_PLATFORM.LINUX,
    arch: DEVICE_ARCH.X64,
    ip: "203.0.113.24",
    expiresAt: NOW + 15 * MINUTE,
  }),
  [ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS]: ({ notifications }) => {
    acmeSlackBot = { ...acmeSlackBot, notifications };
    return acmeSlackBot;
  },
  [ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY]: ({ repository }) => {
    const { defaultRepository: _cleared, ...rest } = acmeSlackBot;
    acmeSlackBot = repository === null ? rest : { ...rest, defaultRepository: repository };
    return acmeSlackBot;
  },
  [ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL]: ({ channelId, member, repository }) => {
    const channels = (acmeSlackBot.channels ?? []).map((channel) => {
      if (channel.id !== channelId) return channel;
      const { repository: _named, ...plain } = channel;
      const joined = member ?? channel.member;
      // A channel the bot left keeps no repository, as the service forgets it.
      const kept = !joined || repository === null ? undefined : (repository ?? channel.repository);
      return kept === undefined
        ? { ...plain, member: joined }
        : { ...plain, member: joined, repository: kept };
    });
    acmeSlackBot = { ...acmeSlackBot, channels };
    return acmeSlackBot;
  },
  [ACT_KIND.WORKSPACE_ENVIRONMENT_LIST]: () => ({ variables: acmeVariables }),
  [ACT_KIND.WORKSPACE_ENVIRONMENT_PUT]: ({ name }) =>
    variablesAnswer([
      ...acmeVariables.filter((variable) => variable.name !== name),
      { name, updatedAt: NOW },
    ]),
  [ACT_KIND.WORKSPACE_ENVIRONMENT_DELETE]: ({ name }) =>
    variablesAnswer(acmeVariables.filter((variable) => variable.name !== name)),
  [ACT_KIND.INSTALLED_SKILLS_READ]: ({ skillId: id }) =>
    skillContent(id) ?? { failure: INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND },
  // The command-line tool installed on this Mac, as Settings' MCP page's Install asks, without running the install script: a fixture run reaches no network and installs nothing.
  [ACT_KIND.CLI_INSTALL]: () => ({
    outcome: CLI_INSTALL_OUTCOME.INSTALLED,
    version: "0.1.0",
    onPath: true,
  }),
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

/** The clients the account allowed: an outside agent on this computer that refreshed lately, one on the web that never has, and the vespin command, signed in. */
const STAGED_MCP_CLIENTS: AppMcpClients = {
  [ACCOUNT_ID]: {
    rows: {
      serverUrl: "https://app.example.com/api/mcp",
      clients: [
        {
          clientId: "https://claude.example/.well-known/oauth-client-metadata.json",
          name: "Claude Code",
          redirectUris: ["http://localhost:51703/callback"],
          allowedAt: NOW - 2 * DAY,
          lastRefreshedAt: NOW - 3 * HOUR,
        },
        {
          clientId: "dcr-7f3a9c2e",
          name: "ChatGPT",
          redirectUris: ["https://chatgpt.example/connector/oauth/callback"],
          allowedAt: NOW - 9 * DAY,
          lastRefreshedAt: null,
        },
        // The vespin command, signed in, which Settings › CLI shows and Connected leaves out.
        {
          clientId: FIRST_PARTY_OAUTH_CLIENT_ID.CLI,
          name: `${PRODUCT_NAME} CLI`,
          redirectUris: ["http://127.0.0.1/callback"],
          allowedAt: NOW - 4 * DAY,
          lastRefreshedAt: NOW - 20 * MINUTE,
        },
      ],
    },
  },
};

/** The account's staged credentials, as the host holds them: no API key, Claude's plan connected, and the ChatGPT sign-in OpenAI no longer honors. */
const STAGED_KEYS: AppProviderKeys = {
  [ACCOUNT_ID]: {
    rows: {
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
    },
  },
};

/** The models the staged account is offered, as the host holds them. */
const STAGED_MODELS: AppModels = { [ACCOUNT_ID]: { rows: { models: MODELS } } };

/** The staged account's preferences row, as the host holds it: Opus on high, chapters on Sonnet, and Slack notifications on. */
const STAGED_PREFERENCES: AppAccountPreferences = {
  [ACCOUNT_ID]: {
    rows: {
      agent: { model: "anthropic/claude-opus-5.5", effort: "high" },
      chaptersModel: CHAPTERS_MODEL.SONNET,
      slackNotifications: true,
    },
  },
};

/** Each staged workspace's repositories as the host holds them, Acme's its three and every other workspace's none. */
const STAGED_REPOSITORIES: AppRepositoryLists = Object.fromEntries(
  [WORKSPACE.PERSONAL, WORKSPACE.ACME, EVERY_WORKSPACE].map((workspace) => [
    workspace,
    {
      rows: {
        installed: true,
        repositories: workspace === WORKSPACE.ACME ? ACME_REPOSITORIES : [],
        installationUrl: "https://github.com/apps/vespin-agent/installations/new",
      },
    },
  ]),
);

/** The account's staged hosts, as the host holds them for Settings › Hosts: a Mac, a box on each update phase, and one gone quiet. */
const STAGED_HOSTS: AppHosts = {
  [ACCOUNT_ID]: {
    rows: {
      hosts: [
        { id: FIXTURE_HOST.ONLINE, name: "fra-01" },
        { id: FIXTURE_HOST.MAC, name: "studio-mini", platform: DEVICE_PLATFORM.DARWIN },
        { id: FIXTURE_HOST.SETUP_FAILED, name: "hel-01" },
        { id: FIXTURE_HOST.OLD, name: "sgp-01" },
        { id: FIXTURE_HOST.UPDATE_WAITING, name: "ams-01", update: HOST_UPDATE.WAITING },
        { id: FIXTURE_HOST.UPDATING, name: "ord-01", update: HOST_UPDATE.UPDATING },
        { id: FIXTURE_HOST.UPDATE_FAILED, name: "nrt-01", update: HOST_UPDATE.FAILED },
        { id: FIXTURE_HOST.OFFLINE, name: "sfo-02" },
      ],
      installScriptUrl: STAGED_INSTALL_SCRIPT,
    },
  },
};

/** The account's staged GitHub token, as the host holds it: a made-up hint, never a token. */
const STAGED_GITHUB_TOKEN: AppGitHubTokens = {
  [ACCOUNT_ID]: {
    rows: {
      token: {
        login: "ada",
        hint: "…7f2c",
        status: GITHUB_TOKEN_STATUS.VERIFIED,
        statusAt: NOW - 2 * DAY,
        addedAt: NOW - 30 * DAY,
        expiresAt: NOW + 60 * DAY,
      },
    },
  },
};

/** Each staged workspace's token repositories, as the host holds them: one a teammate added to Acme, and none in the personal workspace. */
const STAGED_TOKEN_REPOSITORIES: AppTokenRepositories = {
  [WORKSPACE.ACME]: {
    rows: [
      {
        fullName: "theo/acme-scripts",
        addedBy: "Theo Lindqvist",
        addedAt: NOW - 6 * DAY,
        removable: true,
      },
    ],
  },
  [WORKSPACE.PERSONAL]: { rows: [] },
};

/** The staged workspace's memories, as the host holds them for Settings › Memory; one object across deliveries. */
const STAGED_MEMORIES: AppMemories = { [WORKSPACE.ACME]: { rows: MEMORIES } };

/** The staged workspace's skills and the account's own, as the host holds them for Settings › Skills; one object across deliveries. */
const STAGED_SKILLS: AppInstalledSkills = { [WORKSPACE.ACME]: { rows: skills(WORKSPACE.ACME) } };

/**
 * The staged workspaces' own integrations, as the host holds them for
 * Settings › Workspace and an automation's editor: Acme's Sentry installed
 * and its Slack bot connected as the staged page first draws it, and the
 * personal workspace's offered with neither; one object across deliveries.
 */
const STAGED_WORKSPACE_INTEGRATIONS: AppWorkspaceIntegrations = {
  [WORKSPACE.ACME]: {
    rows: {
      sentry: {
        configured: true,
        installations: [{ installationId: "sentry-acme", account: "acme" }],
      },
      slack: {
        configured: acmeSlackBot.configured,
        ...(acmeSlackBot.team === undefined ? undefined : { team: acmeSlackBot.team }),
        ...(acmeSlackBot.defaultRepository === undefined
          ? undefined
          : { defaultRepository: acmeSlackBot.defaultRepository }),
        channelRepositories: Object.fromEntries(
          (acmeSlackBot.channels ?? []).flatMap((channel) =>
            channel.repository === undefined ? [] : [[channel.id, channel.repository]],
          ),
        ),
      },
    },
  },
  [WORKSPACE.PERSONAL]: {
    rows: {
      sentry: { configured: true, installations: [] },
      slack: { configured: true, channelRepositories: {} },
    },
  },
};

/** Acme's Slack channels, as the host holds Slack's list of them for an owner's Settings › Workspace; one object across deliveries. */
const STAGED_SLACK_CHANNELS: AppSlackChannels = {
  [WORKSPACE.ACME]: {
    rows: (acmeSlackBot.channels ?? []).map(({ repository: _repository, ...channel }) => channel),
  },
};

/** The staged hosts' beats, every one but the one staged offline beating as the window first stages them, so they read online; one object across deliveries. */
let stagedBeats: AppDevicePresences | undefined;

function beatsStaged(): AppDevicePresences {
  if (stagedBeats !== undefined) return stagedBeats;
  // Note that the beats are aged on the window's own clock, which no staged instant stands still for, so they beat as staging begins.
  const at = Date.now();
  stagedBeats = {
    [ACCOUNT_ID]: {
      rows: { beats: BEATING_HOSTS.map((deviceId) => ({ deviceId, beatAt: at })), askedAt: at },
    },
  };
  return stagedBeats;
}

/** The staged integrations as the host holds them for the account signed in, one object across deliveries. */
const STAGED_INTEGRATIONS: AppIntegrations = {
  [ACCOUNT_ID]: {
    rows: {
      integrations: integrationStatuses(),
      accounts: INTEGRATION_ACCOUNTS,
      addable: [INTEGRATION_PROVIDER.NOTION, INTEGRATION_PROVIDER.SLACK],
    },
  },
};

/**
 * Main's document as these profiles draw it: the fixture workspaces'
 * members held read, and under the signed-in profiles the account signed
 * in, an admin of the service, with the staged pages' experiments on, the
 * staged hosts beating, and its integrations, credentials, GitHub token,
 * servers' tools, the staged workspaces' token repositories, invitations,
 * own integrations, and Acme's Slack channels, and the staged workspace's
 * memories and skills held. The members are held under every profile rather
 * than only the signed-in ones, because ⌘K's People, a task's assignee and
 * creator faces, and the person page read them wherever the window stands.
 * Each slice laid over is one object across deliveries, but the settings,
 * which carry main's own, so a delivery that moves nothing of them draws
 * nothing again.
 */
export function settingsAppState(profile: string, state: AppStateSnapshot): AppStateSnapshot {
  const held = { ...state, [LIVE_READ.WORKSPACE_MEMBERS]: HELD_MEMBERS };
  if (!SIGNED_IN_PROFILES.has(profile)) return held;
  return {
    ...held,
    account: ACCOUNT,
    access: ADMIN_ACCESS,
    [LIVE_READ.ACCOUNT_PREFERENCES]: STAGED_PREFERENCES,
    [LIVE_READ.DEVICE_PRESENCE]: beatsStaged(),
    [LIVE_READ.HOSTS]: STAGED_HOSTS,
    [LIVE_READ.INSTALLED_SKILLS]: STAGED_SKILLS,
    [LIVE_READ.INTEGRATIONS]: STAGED_INTEGRATIONS,
    [LIVE_READ.WORKSPACE_INVITATIONS]: HELD_INVITATIONS,
    [LIVE_READ.INTEGRATION_TOOLS]: STAGED_TOOLS,
    [LIVE_READ.MEMORIES]: STAGED_MEMORIES,
    [LIVE_READ.MODELS]: STAGED_MODELS,
    [LIVE_READ.WORKSPACE_INTEGRATIONS]: STAGED_WORKSPACE_INTEGRATIONS,
    [LIVE_READ.SLACK_CHANNELS]: STAGED_SLACK_CHANNELS,
    [LIVE_READ.PROVIDER_KEYS]: STAGED_KEYS,
    [LIVE_READ.GITHUB_TOKEN]: STAGED_GITHUB_TOKEN,
    [LIVE_READ.TOKEN_REPOSITORIES]: STAGED_TOKEN_REPOSITORIES,
    [LIVE_READ.MCP_CLIENTS]: STAGED_MCP_CLIENTS,
    [LIVE_READ.REPOSITORY_LISTS]: STAGED_REPOSITORIES,
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
