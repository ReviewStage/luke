import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "@repo/features/admin-account-wire";
import type {
  AdminAccountAgent,
  AdminAccountFailure,
  AdminAccountSupport,
  AdminAccountWorkspace,
} from "@repo/features/admin-answer-wire";
import { AGENT_STATUS, CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { AGENT_STATUS_WORDS } from "@repo/features/automation-list-model";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { FAST_ACCESS, PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import { formatInstant } from "@repo/features/time-format";
import {
  Badge,
  GAP,
  Inline,
  MARK_PROVIDER,
  QUIET_MARK,
  QuietWords,
  Skeleton,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  Text,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  type DataTableMinWidth,
  DataTableSkeleton,
  type RowData,
} from "@repo/ui/data-table";
import { repositoryPageUrl } from "@repo/ui/tasks-model";
import { useMemo } from "react";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { ExternalLink } from "../chrome/external-links.js";
import {
  connectionWord,
  INSTALLATION_LABEL,
  installationMark,
  pullRequestWord,
} from "../status-words.js";
import { WorkspaceCell } from "../workspace-cell.js";

const NONE = "—";

const SKELETON_ROWS = { AGENTS: 5, WORKSPACES: 2, CREDENTIALS: 2, FAILURES: 3 } as const;

const SKELETON_DEFAULTS_WIDTH = "320px";

const SKELETON_EXPERIMENTS_WIDTH = "192px";

const FAILURE_SUBJECT = {
  [ADMIN_FAILURE_KIND.AGENT]: "Agent failed",
  [ADMIN_FAILURE_KIND.KEY]: "Provider key",
  [ADMIN_FAILURE_KIND.CONNECTION]: "Connection",
  [ADMIN_FAILURE_KIND.AUTOMATION]: "Automation run failed",
} as const satisfies Record<AdminAccountFailure["kind"], string>;

const FAST_ACCESS_WORDS = {
  [FAST_ACCESS.ENABLED]: "fast mode enabled",
  [FAST_ACCESS.NOT_ENABLED]: "fast mode not enabled",
} as const satisfies Record<
  NonNullable<AdminAccountSupport["providerKeys"][number]["fastAccess"]>,
  string
>;

function windowWords(contextWindow: string | null): string {
  return contextWindow === CONTEXT_WINDOW.STANDARD ? " · standard window" : "";
}

function percentOf(part: number, whole: number): string | undefined {
  return whole === 0 ? undefined : formatPercent(part / whole);
}

function workStats(windowDays: number): readonly StatSpec<AdminAccountSupport>[] {
  return [
    {
      key: "tasks",
      label: () => `Tasks created · ${windowDays} days`,
      value: ({ totals }) => formatCount(totals.tasksCreated),
    },
    {
      key: "agents",
      label: () => `Agents · ${windowDays} days`,
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
  ];
}

const agentColumn = createDataTableColumnHelper<AdminAccountAgent>();

const AGENT_COLUMNS = agentColumn.columns([
  agentColumn.display({
    id: "started",
    header: "Started",
    cell: ({ row: { original: agent } }) => formatInstant(agent.createdAt),
  }),
  agentColumn.display({
    id: "repository",
    header: "Repository",
    cell: ({ row: { original: agent } }) =>
      agent.repository === null ? (
        NONE
      ) : (
        <ExternalLink
          place={{
            provider: MARK_PROVIDER.GITHUB,
            label: agent.repository,
            href: repositoryPageUrl(agent.repository),
          }}
        />
      ),
  }),
  agentColumn.display({
    id: "model",
    header: "Model",
    cell: ({ row: { original: agent } }) =>
      `${agent.model} · ${agent.effort}${windowWords(agent.contextWindow)}`,
  }),
  agentColumn.display({
    id: "status",
    header: "Status",
    cell: ({ row: { original: agent } }) => (
      <Inline gap={GAP.TIGHT}>
        <QuietWords mark={agent.status === AGENT_STATUS.FAILED ? QUIET_MARK.FAILED : undefined}>
          {AGENT_STATUS_WORDS[agent.status]}
        </QuietWords>
        {agent.failure === null ? null : <Text tone={TEXT_TONE.MUTED}>{agent.failure}</Text>}
      </Inline>
    ),
  }),
  agentColumn.display({
    id: "pull-request",
    header: "Pull request",
    cell: ({ row: { original: agent } }) =>
      agent.pullRequest === ADMIN_PULL_REQUEST.NONE ? (
        NONE
      ) : (
        <QuietWords>{pullRequestWord(agent.pullRequest)}</QuietWords>
      ),
  }),
]);

const workspaceColumn = createDataTableColumnHelper<AdminAccountWorkspace>();

function workspaceColumns(
  onOpenWorkspace: (id: string) => void,
): DataTableColumns<AdminAccountWorkspace> {
  return workspaceColumn.columns([
    workspaceColumn.display({
      id: "workspace",
      header: "Workspace",
      cell: ({ row: { original: workspace } }) => (
        <Inline gap={GAP.TIGHT}>
          <WorkspaceCell workspace={workspace} onOpen={onOpenWorkspace} />
          <Badge>
            {workspace.kind === ADMIN_WORKSPACE_KIND.PERSONAL ? "Personal" : "Shared workspace"}
          </Badge>
        </Inline>
      ),
    }),
    workspaceColumn.display({
      id: "role",
      header: "Role",
      cell: ({ row: { original: workspace } }) => workspace.role,
    }),
    workspaceColumn.display({
      id: "members",
      header: "Members",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: workspace } }) => formatCount(workspace.memberCount),
    }),
    workspaceColumn.display({
      id: "github",
      header: "GitHub",
      cell: ({ row: { original: workspace } }) =>
        workspace.github.length === 0 ? (
          <Text tone={TEXT_TONE.MUTED}>not installed</Text>
        ) : (
          <Inline gap={GAP.TIGHT}>
            {[...new Set(workspace.github)].map((status) => (
              <QuietWords key={status} mark={installationMark(status)}>
                {INSTALLATION_LABEL[status]}
              </QuietWords>
            ))}
          </Inline>
        ),
    }),
  ]);
}

interface CredentialRow {
  order: number;
  kind: string;
  provider: string;
  status: string;
  failed: boolean;
  detail: string | undefined;
  at: number;
}

function credentialRows(support: AdminAccountSupport): CredentialRow[] {
  const keys = support.providerKeys.map(
    (key): Omit<CredentialRow, "order"> => ({
      kind: "Provider key",
      provider: key.provider,
      status: key.status,
      failed: key.status !== PROVIDER_KEY_STATUS.VERIFIED,
      detail: key.fastAccess === null ? undefined : FAST_ACCESS_WORDS[key.fastAccess],
      at: key.statusAt,
    }),
  );
  const connections = support.connections.map(
    (connection): Omit<CredentialRow, "order"> => ({
      kind: "Connection",
      provider: connection.provider,
      status: connectionWord(connection.status),
      failed: false,
      detail: undefined,
      at: connection.at,
    }),
  );
  return [...keys, ...connections].map((row, order) => ({ ...row, order }));
}

const credentialColumn = createDataTableColumnHelper<CredentialRow>();

const CREDENTIAL_COLUMNS = credentialColumn.columns([
  credentialColumn.display({
    id: "kind",
    header: "Kind",
    cell: ({ row: { original: row } }) => row.kind,
  }),
  credentialColumn.display({
    id: "provider",
    header: "Provider",
    cell: ({ row: { original: row } }) => row.provider,
  }),
  credentialColumn.display({
    id: "status",
    header: "Status",
    cell: ({ row: { original: row } }) => (
      <Inline gap={GAP.TIGHT}>
        <QuietWords mark={row.failed ? QUIET_MARK.FAILED : undefined}>{row.status}</QuietWords>
        {row.detail === undefined ? null : <Text tone={TEXT_TONE.MUTED}>{row.detail}</Text>}
      </Inline>
    ),
  }),
  credentialColumn.display({
    id: "changed",
    header: "Last changed",
    cell: ({ row: { original: row } }) => formatInstant(row.at),
  }),
]);

function failureSubject(failure: AdminAccountFailure): string {
  const subject = FAILURE_SUBJECT[failure.kind];
  return "provider" in failure ? `${subject} · ${failure.provider}` : subject;
}

interface FailureRow {
  order: number;
  failure: AdminAccountFailure;
}

const failureColumn = createDataTableColumnHelper<FailureRow>();

const FAILURE_COLUMNS = failureColumn.columns([
  failureColumn.display({
    id: "when",
    header: "When",
    cell: ({
      row: {
        original: { failure },
      },
    }) => formatInstant(failure.at),
  }),
  failureColumn.display({
    id: "what",
    header: "What",
    cell: ({
      row: {
        original: { failure },
      },
    }) => failureSubject(failure),
  }),
  failureColumn.display({
    id: "why",
    header: "Why",
    cell: ({
      row: {
        original: { failure },
      },
    }) =>
      failure.reason === null ? (
        <Text tone={TEXT_TONE.MUTED}>no reason recorded</Text>
      ) : (
        <QuietWords mark={QUIET_MARK.FAILED}>{failure.reason}</QuietWords>
      ),
  }),
]);

function DefaultsLines({ support }: { support: AdminAccountSupport }): React.JSX.Element {
  const { defaults } = support;
  const choice =
    defaults.model === null
      ? "the catalog's default"
      : `${defaults.model} · ${defaults.effort ?? NONE}${windowWords(defaults.contextWindow)}`;
  return (
    <Stack gap={GAP.CONTROL}>
      <Text>Agents start on {choice}.</Text>
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

function SupportTable<Row extends RowData>({
  label,
  columns,
  rows,
  getRowId,
  empty,
  minWidth,
  skeletonRows,
  onRowPress,
}: {
  label: string;
  columns: DataTableColumns<Row>;
  rows: readonly Row[] | undefined;
  getRowId: (row: Row) => string;
  empty: string;
  minWidth: DataTableMinWidth;
  skeletonRows: number;
  onRowPress?: ((row: Row) => void) | undefined;
}): React.JSX.Element {
  return rows === undefined ? (
    <DataTableSkeleton label={label} columns={columns} rows={skeletonRows} minWidth={minWidth} />
  ) : (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      getRowId={getRowId}
      empty={empty}
      minWidth={minWidth}
      onRowPress={onRowPress}
    />
  );
}

export function AccountSupportSections({
  support,
  windowDays,
  onOpenWorkspace,
}: {
  support: AdminAccountSupport | undefined;
  windowDays: number;
  onOpenWorkspace: (id: string) => void;
}): React.JSX.Element {
  const workspaceTableColumns = useMemo(() => workspaceColumns(onOpenWorkspace), [onOpenWorkspace]);
  return (
    <>
      <AdminSection title="Work">
        <StatCards layout={STAT_LAYOUT.PAIRS} stats={workStats(windowDays)} data={support} />
      </AdminSection>

      <AdminSection title="Recent agents">
        <SupportTable
          label="The account's newest agents"
          columns={AGENT_COLUMNS}
          rows={support?.recentAgents}
          getRowId={(agent) => agent.id}
          empty="No agent started yet."
          minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
          skeletonRows={SKELETON_ROWS.AGENTS}
        />
      </AdminSection>

      <AdminSection title="Workspaces">
        <SupportTable
          label="The account's workspaces"
          columns={workspaceTableColumns}
          rows={support?.workspaces}
          getRowId={(workspace) => workspace.id}
          empty="In no workspace."
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          skeletonRows={SKELETON_ROWS.WORKSPACES}
          onRowPress={(workspace) => onOpenWorkspace(workspace.id)}
        />
      </AdminSection>

      <AdminSection title="Keys and connections">
        <SupportTable
          label="The account's provider keys and integration connections"
          columns={CREDENTIAL_COLUMNS}
          rows={support === undefined ? undefined : credentialRows(support)}
          getRowId={(row) => String(row.order)}
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
          getRowId={(row) => String(row.order)}
          empty="Nothing failed in this window."
          minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          skeletonRows={SKELETON_ROWS.FAILURES}
        />
      </AdminSection>
    </>
  );
}
