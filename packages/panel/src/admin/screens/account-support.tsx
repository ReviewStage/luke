/**
 * account-support.tsx -- the account page's support sections: its work over
 * the window, its newest agents, its workspaces, keys and connections,
 * defaults and experiments, and its recent failures.
 *
 * Each section draws what `@luke/features/admin-answer-wire`'s `AdminAccountSupport` says and
 * nothing more: counts, statuses, models, names of workspaces and
 * repositories, and the service's own enumerated words for why something
 * failed, drawn as they are spelled so a maintainer can search the code
 * for them.
 */

import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "@luke/features/admin-account-wire";
import type {
  AdminAccountAgent,
  AdminAccountFailure,
  AdminAccountSupport,
  AdminAccountWorkspace,
} from "@luke/features/admin-answer-wire";
import { CODING_AGENT_STATUS, CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { GITHUB_INSTALLATION_STATUS } from "@luke/features/github-installation-wire";
import { INTEGRATION_ROW_STATUS } from "@luke/features/integration-row-wire";
import { formatCount, formatPercent } from "@luke/features/number-format";
import { FAST_ACCESS, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { formatInstant } from "@luke/features/time-format";
import {
  Badge,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  type DataTableMinWidth,
  GAP,
  Inline,
  Skeleton,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TEXT_ELEMENT,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";

/** What the page draws where a value is absent. */
const NONE = "—";

/**
 * How many rows each table's skeleton stands, about an active account's:
 * how many it holds is the answer's alone.
 */
const SKELETON_ROWS = { AGENTS: 5, WORKSPACES: 2, CREDENTIALS: 2, FAILURES: 3 } as const;

/** The defaults' line bones, about their sentences' width. */
const SKELETON_DEFAULTS_WIDTH = "320px";

const SKELETON_EXPERIMENTS_WIDTH = "192px";

/** A coding agent's status words, by the tone the panel's own pills would draw them in. */
const AGENT_STATUS_TONE = {
  [CODING_AGENT_STATUS.STARTING]: STATUS_TONE.WORKING,
  [CODING_AGENT_STATUS.RUNNING]: STATUS_TONE.WORKING,
  [CODING_AGENT_STATUS.COMPLETED]: STATUS_TONE.COMPLETE,
  [CODING_AGENT_STATUS.FAILED]: STATUS_TONE.DANGER,
  [CODING_AGENT_STATUS.CANCELLED]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<AdminAccountAgent["status"], StatusTone>;

const PULL_REQUEST_TONE = {
  [ADMIN_PULL_REQUEST.NONE]: STATUS_TONE.NEUTRAL,
  [ADMIN_PULL_REQUEST.OPEN]: STATUS_TONE.WORKING,
  [ADMIN_PULL_REQUEST.MERGED]: STATUS_TONE.MERGED,
  [ADMIN_PULL_REQUEST.CLOSED]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<AdminAccountAgent["pullRequest"], StatusTone>;

const GITHUB_TONE = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: STATUS_TONE.COMPLETE,
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: STATUS_TONE.ATTENTION,
  [GITHUB_INSTALLATION_STATUS.DELETED]: STATUS_TONE.DANGER,
} as const satisfies Record<AdminAccountWorkspace["github"][number], StatusTone>;

/** A connection's status words by tone; a status this build does not know reads as needing attention. */
const CONNECTION_TONE: ReadonlyMap<string, StatusTone> = new Map([
  [INTEGRATION_ROW_STATUS.CONNECTED, STATUS_TONE.COMPLETE],
  [INTEGRATION_ROW_STATUS.EXPIRED, STATUS_TONE.DANGER],
]);

/** What each kind of failure is called on the timeline. */
const FAILURE_SUBJECT = {
  [ADMIN_FAILURE_KIND.AGENT]: "Coding agent failed",
  [ADMIN_FAILURE_KIND.CALL]: "Call dropped",
  [ADMIN_FAILURE_KIND.KEY]: "Provider key",
  [ADMIN_FAILURE_KIND.CONNECTION]: "Connection",
  [ADMIN_FAILURE_KIND.AUTOMATION]: "Automation run failed",
} as const satisfies Record<AdminAccountFailure["kind"], string>;

/** What a fast-access word says beside a key's status. */
const FAST_ACCESS_WORDS = {
  [FAST_ACCESS.ENABLED]: "fast mode enabled",
  [FAST_ACCESS.NOT_ENABLED]: "fast mode not enabled",
} as const satisfies Record<
  NonNullable<AdminAccountSupport["providerKeys"][number]["fastAccess"]>,
  string
>;

/** The window a model runs on, said only where it is the smaller one. */
function windowWords(contextWindow: string | null): string {
  return contextWindow === CONTEXT_WINDOW.STANDARD ? " · standard window" : "";
}

/** A share of a whole as a whole percentage, or nothing where there is no whole. */
function percentOf(part: number, whole: number): string | undefined {
  return whole === 0 ? undefined : formatPercent(part / whole);
}

/** The window's work as four stat cards: tasks, agents, pull requests, and call minutes. */
function workStats(windowDays: number): readonly StatSpec<AdminAccountSupport>[] {
  return [
    {
      key: "tasks",
      label: () => `Tasks created · ${windowDays} days`,
      value: ({ totals }) => formatCount(totals.tasksCreated),
    },
    {
      key: "agents",
      label: () => `Coding agents · ${windowDays} days`,
      value: ({ totals }) => formatCount(totals.agentsStarted),
      hint: ({ totals }) => {
        const failed = percentOf(totals.agentsFailed, totals.agentsRead);
        const truncated = totals.agentsRead < totals.agentsStarted;
        return failed === undefined
          ? "none started"
          : `${failed} failed${truncated ? ` of the newest ${formatCount(totals.agentsRead)}` : ""}`;
      },
    },
    {
      key: "merged",
      label: () => `Pull requests merged · ${windowDays} days`,
      value: ({ totals }) => formatCount(totals.pullRequestsMerged),
      hint: ({ totals }) => `of ${formatCount(totals.pullRequestsOpened)} opened`,
      title: () => "Of the pull requests opened by the agents started in the window",
    },
    {
      key: "call-minutes",
      label: () => `Call minutes · ${windowDays} days`,
      value: ({ totals }) => formatCount(totals.callMinutes),
    },
  ];
}

const AGENT_COLUMNS: readonly DataTableColumn<AdminAccountAgent>[] = [
  { key: "started", label: "Started", cell: (agent) => formatInstant(agent.createdAt) },
  { key: "repository", label: "Repository", cell: (agent) => agent.repository },
  {
    key: "model",
    label: "Model",
    cell: (agent) => `${agent.model} · ${agent.effort}${windowWords(agent.contextWindow)}`,
  },
  {
    key: "status",
    label: "Status",
    cell: (agent) => (
      <Inline gap={GAP.TIGHT}>
        <Badge tone={AGENT_STATUS_TONE[agent.status]}>{agent.status}</Badge>
        {agent.failure === null ? null : <Text tone={TEXT_TONE.MUTED}>{agent.failure}</Text>}
      </Inline>
    ),
  },
  {
    key: "pull-request",
    label: "Pull request",
    cell: (agent) =>
      agent.pullRequest === ADMIN_PULL_REQUEST.NONE ? (
        NONE
      ) : (
        <Badge tone={PULL_REQUEST_TONE[agent.pullRequest]}>{agent.pullRequest}</Badge>
      ),
  },
];

const WORKSPACE_COLUMNS: readonly DataTableColumn<AdminAccountWorkspace>[] = [
  {
    key: "workspace",
    label: "Workspace",
    cell: (workspace) => (
      <Inline gap={GAP.TIGHT}>
        <Text>{workspace.name}</Text>
        <Badge>
          {workspace.kind === ADMIN_WORKSPACE_KIND.PERSONAL ? "Personal" : "Shared workspace"}
        </Badge>
      </Inline>
    ),
  },
  { key: "role", label: "Role", cell: (workspace) => workspace.role },
  {
    key: "members",
    label: "Members",
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    cell: (workspace) => formatCount(workspace.memberCount),
  },
  {
    key: "github",
    label: "GitHub",
    cell: (workspace) =>
      workspace.github.length === 0 ? (
        <Text tone={TEXT_TONE.MUTED}>not installed</Text>
      ) : (
        <Inline gap={GAP.TIGHT}>
          {[...new Set(workspace.github)].map((status) => (
            <Badge key={status} tone={GITHUB_TONE[status]}>
              {status}
            </Badge>
          ))}
        </Inline>
      ),
  },
];

/** One key or connection as the credentials table draws it. */
interface CredentialRow {
  /** Where the row stands in the table, which is all that tells two connections at one provider apart here. */
  order: number;
  kind: string;
  provider: string;
  status: string;
  tone: StatusTone;
  detail: string | undefined;
  at: number;
}

/** The account's keys and connections as one table's rows, keys first. */
function credentialRows(support: AdminAccountSupport): CredentialRow[] {
  const keys = support.providerKeys.map(
    (key): Omit<CredentialRow, "order"> => ({
      kind: "Provider key",
      provider: key.provider,
      status: key.status,
      tone: key.status === PROVIDER_KEY_STATUS.VERIFIED ? STATUS_TONE.COMPLETE : STATUS_TONE.DANGER,
      detail: key.fastAccess === null ? undefined : FAST_ACCESS_WORDS[key.fastAccess],
      at: key.statusAt,
    }),
  );
  const connections = support.connections.map(
    (connection): Omit<CredentialRow, "order"> => ({
      kind: "Connection",
      provider: connection.provider,
      status: connection.status,
      tone: CONNECTION_TONE.get(connection.status) ?? STATUS_TONE.ATTENTION,
      detail: undefined,
      at: connection.at,
    }),
  );
  return [...keys, ...connections].map((row, order) => ({ ...row, order }));
}

const CREDENTIAL_COLUMNS: readonly DataTableColumn<CredentialRow>[] = [
  { key: "kind", label: "Kind", cell: (row) => row.kind },
  { key: "provider", label: "Provider", cell: (row) => row.provider },
  {
    key: "status",
    label: "Status",
    cell: (row) => (
      <Inline gap={GAP.TIGHT}>
        <Badge tone={row.tone}>{row.status}</Badge>
        {row.detail === undefined ? null : <Text tone={TEXT_TONE.MUTED}>{row.detail}</Text>}
      </Inline>
    ),
  },
  { key: "changed", label: "Last changed", cell: (row) => formatInstant(row.at) },
];

/** What failed, with the provider where a key or a connection did. */
function failureSubject(failure: AdminAccountFailure): string {
  const subject = FAILURE_SUBJECT[failure.kind];
  return "provider" in failure ? `${subject} · ${failure.provider}` : subject;
}

/** One failure with where it stands on the timeline, which is what keys its row. */
interface FailureRow {
  order: number;
  failure: AdminAccountFailure;
}

const FAILURE_COLUMNS: readonly DataTableColumn<FailureRow>[] = [
  { key: "when", label: "When", cell: ({ failure }) => formatInstant(failure.at) },
  { key: "what", label: "What", cell: ({ failure }) => failureSubject(failure) },
  {
    key: "why",
    label: "Why",
    cell: ({ failure }) =>
      failure.reason === null ? (
        <Text tone={TEXT_TONE.MUTED}>no reason recorded</Text>
      ) : (
        <Badge tone={STATUS_TONE.DANGER}>{failure.reason}</Badge>
      ),
  },
];

/** The account's coding-agent defaults and the experiments it turned on. */
function DefaultsLines({ support }: { support: AdminAccountSupport }): React.JSX.Element {
  const { defaults } = support;
  const choice =
    defaults.model === null
      ? "the catalog's default"
      : `${defaults.model} · ${defaults.effort ?? NONE}${windowWords(defaults.contextWindow)}`;
  return (
    <Stack gap={GAP.CONTROL}>
      <Text>Coding agents start on {choice}.</Text>
      {defaults.experiments.length === 0 ? (
        <Text tone={TEXT_TONE.MUTED}>No experiments turned on.</Text>
      ) : (
        <Inline gap={GAP.TIGHT}>
          <Text tone={TEXT_TONE.MUTED}>Experiments:</Text>
          {defaults.experiments.map((experiment) => (
            <Badge key={experiment.key}>{experiment.name}</Badge>
          ))}
        </Inline>
      )}
    </Stack>
  );
}

/** The defaults while they are read: bones for the model line and the experiments' line under it. */
function DefaultsLinesSkeleton(): React.JSX.Element {
  return (
    <Stack gap={GAP.CONTROL}>
      <Text as={TEXT_ELEMENT.DIV}>
        <Skeleton width={SKELETON_DEFAULTS_WIDTH} />
      </Text>
      <Text as={TEXT_ELEMENT.DIV}>
        <Skeleton width={SKELETON_EXPERIMENTS_WIDTH} />
      </Text>
    </Stack>
  );
}

/** One support table: its label, its columns, its rows from the answer, and what it says with none. */
function SupportTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  empty,
  minWidth,
  skeletonRows,
}: {
  label: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  empty: string;
  minWidth: DataTableMinWidth;
  skeletonRows: number;
}): React.JSX.Element {
  return rows === undefined ? (
    <DataTableSkeleton label={label} columns={columns} rows={skeletonRows} minWidth={minWidth} />
  ) : (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      rowKey={rowKey}
      empty={empty}
      minWidth={minWidth}
    />
  );
}

/**
 * Every support section, in the order a maintainer reads an account by,
 * drawn from `support` once it is read and as their skeletons until then.
 */
export function AccountSupportSections({
  support,
  windowDays,
}: {
  support: AdminAccountSupport | undefined;
  windowDays: number;
}): React.JSX.Element {
  return (
    <>
      <AdminSection title="Work">
        <StatCards layout={STAT_LAYOUT.PAIRS} stats={workStats(windowDays)} data={support} />
      </AdminSection>

      <AdminSection title="Recent agents">
        <SupportTable
          label="The account's newest coding agents"
          columns={AGENT_COLUMNS}
          rows={support?.recentAgents}
          rowKey={(agent) => agent.id}
          empty="No coding agent started yet."
          minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          skeletonRows={SKELETON_ROWS.AGENTS}
        />
      </AdminSection>

      <AdminSection title="Workspaces">
        <SupportTable
          label="The account's workspaces"
          columns={WORKSPACE_COLUMNS}
          rows={support?.workspaces}
          rowKey={(workspace) => workspace.id}
          empty="In no workspace."
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          skeletonRows={SKELETON_ROWS.WORKSPACES}
        />
      </AdminSection>

      <AdminSection title="Keys and connections">
        <SupportTable
          label="The account's provider keys and integration connections"
          columns={CREDENTIAL_COLUMNS}
          rows={support === undefined ? undefined : credentialRows(support)}
          rowKey={(row) => String(row.order)}
          empty="No provider key or connection."
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          skeletonRows={SKELETON_ROWS.CREDENTIALS}
        />
      </AdminSection>

      <AdminSection title="Defaults and experiments">
        {support === undefined ? <DefaultsLinesSkeleton /> : <DefaultsLines support={support} />}
      </AdminSection>

      <AdminSection title={`Recent failures · ${windowDays} days`}>
        <SupportTable
          label="The account's recent failures"
          columns={FAILURE_COLUMNS}
          rows={support?.failures.map((failure, order) => ({ order, failure }))}
          rowKey={(row) => String(row.order)}
          empty="Nothing failed in this window."
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          skeletonRows={SKELETON_ROWS.FAILURES}
        />
      </AdminSection>
    </>
  );
}
