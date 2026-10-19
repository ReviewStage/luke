/**
 * account-support.tsx -- the account page's support sections: its work over
 * the window, its newest agents, its workspaces, keys and connections,
 * defaults and experiments, and its recent failures.
 *
 * Each section draws what `@luke/service/admin/admin-account` answers and
 * nothing more: counts, statuses, models, names of workspaces and
 * repositories, and the service's own enumerated words for why something
 * failed, drawn as they are spelled so a maintainer can search the code
 * for them.
 */

import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { CODING_AGENT_STATUS, CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { FAST_ACCESS, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import type {
  AdminAccountAgent,
  AdminAccountFailure,
  AdminAccountSupport,
  AdminAccountWorkspace,
} from "@luke/service/admin/admin-account";
import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "@luke/service/admin/admin-account-wire";
import {
  BADGE_TONE,
  Badge,
  type BadgeTone,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  GAP,
  Inline,
  Stack,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { formatNumber } from "@luke/ui/admin-format";
import { SectionHeading, STAT_CELL, STAT_PAIR, STAT_ROW, StatCard } from "../charts/stat-card";

/** What the page draws where a value is absent. */
const NONE = "—";

/** A coding agent's status words, by the tone the panel's own pills would draw them in. */
const AGENT_STATUS_TONE: Record<AdminAccountAgent["status"], BadgeTone> = {
  [CODING_AGENT_STATUS.STARTING]: BADGE_TONE.WORKING,
  [CODING_AGENT_STATUS.RUNNING]: BADGE_TONE.WORKING,
  [CODING_AGENT_STATUS.COMPLETED]: BADGE_TONE.COMPLETE,
  [CODING_AGENT_STATUS.FAILED]: BADGE_TONE.DANGER,
  [CODING_AGENT_STATUS.CANCELLED]: BADGE_TONE.NEUTRAL,
};

const PULL_REQUEST_TONE: Record<AdminAccountAgent["pullRequest"], BadgeTone> = {
  [ADMIN_PULL_REQUEST.NONE]: BADGE_TONE.NEUTRAL,
  [ADMIN_PULL_REQUEST.OPEN]: BADGE_TONE.WORKING,
  [ADMIN_PULL_REQUEST.MERGED]: BADGE_TONE.MERGED,
  [ADMIN_PULL_REQUEST.CLOSED]: BADGE_TONE.NEUTRAL,
};

const GITHUB_TONE: Record<AdminAccountWorkspace["github"][number], BadgeTone> = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: BADGE_TONE.COMPLETE,
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: BADGE_TONE.ATTENTION,
  [GITHUB_INSTALLATION_STATUS.DELETED]: BADGE_TONE.DANGER,
};

/** A connection's status words by tone; a status this build does not know reads as needing attention. */
const CONNECTION_TONE: ReadonlyMap<string, BadgeTone> = new Map([
  [INTEGRATION_ROW_STATUS.CONNECTED, BADGE_TONE.COMPLETE],
  [INTEGRATION_ROW_STATUS.EXPIRED, BADGE_TONE.DANGER],
]);

/** What each kind of failure is called on the timeline. */
const FAILURE_SUBJECT: Record<AdminAccountFailure["kind"], string> = {
  [ADMIN_FAILURE_KIND.AGENT]: "Coding agent failed",
  [ADMIN_FAILURE_KIND.CALL]: "Call dropped",
  [ADMIN_FAILURE_KIND.KEY]: "Provider key",
  [ADMIN_FAILURE_KIND.CONNECTION]: "Connection",
  [ADMIN_FAILURE_KIND.AUTOMATION]: "Automation run failed",
};

/** What a fast-access word says beside a key's status. */
const FAST_ACCESS_WORDS: Record<
  NonNullable<AdminAccountSupport["providerKeys"][number]["fastAccess"]>,
  string
> = {
  [FAST_ACCESS.ENABLED]: "fast mode enabled",
  [FAST_ACCESS.NOT_ENABLED]: "fast mode not enabled",
};

/** The window a model runs on, said only where it is the smaller one. */
function windowWords(contextWindow: string | null): string {
  return contextWindow === CONTEXT_WINDOW.STANDARD ? " · standard window" : "";
}

/** An instant drawn as its UTC date and time, e.g. "Oct 21, 12:04 UTC". */
export function formatInstant(epochMs: number): string {
  const drawn = new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  return `${drawn} UTC`;
}

/** A share of a whole as a whole percentage, or nothing where there is no whole. */
function percentOf(part: number, whole: number): string | undefined {
  return whole === 0 ? undefined : `${Math.round((part / whole) * 100)}%`;
}

/** The window's work as four stat cards: tasks, agents, pull requests, and call minutes. */
function WorkCards({
  support,
  windowDays,
}: {
  support: AdminAccountSupport;
  windowDays: number;
}): React.JSX.Element {
  const { totals } = support;
  const failed = percentOf(totals.agentsFailed, totals.agentsRead);
  const truncated = totals.agentsRead < totals.agentsStarted;
  return (
    <div className={STAT_ROW}>
      <div className={STAT_PAIR}>
        <div className={STAT_CELL}>
          <StatCard
            label={`Tasks created · ${windowDays} days`}
            value={formatNumber(totals.tasksCreated)}
          />
        </div>
        <div className={STAT_CELL}>
          <StatCard
            label={`Coding agents · ${windowDays} days`}
            value={formatNumber(totals.agentsStarted)}
            hint={
              failed === undefined
                ? "none started"
                : `${failed} failed${truncated ? ` of the newest ${formatNumber(totals.agentsRead)}` : ""}`
            }
          />
        </div>
      </div>
      <div className={STAT_PAIR}>
        <div className={STAT_CELL}>
          <StatCard
            label="Pull requests merged"
            value={formatNumber(totals.pullRequestsMerged)}
            hint={`of ${formatNumber(totals.pullRequestsOpened)} opened by the window's agents`}
          />
        </div>
        <div className={STAT_CELL}>
          <StatCard
            label={`Call minutes · ${windowDays} days`}
            value={formatNumber(totals.callMinutes)}
          />
        </div>
      </div>
    </div>
  );
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
    cell: (workspace) => formatNumber(workspace.memberCount),
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
  tone: BadgeTone;
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
      tone: key.status === PROVIDER_KEY_STATUS.VERIFIED ? BADGE_TONE.COMPLETE : BADGE_TONE.DANGER,
      detail: key.fastAccess === null ? undefined : FAST_ACCESS_WORDS[key.fastAccess],
      at: key.statusAt,
    }),
  );
  const connections = support.connections.map(
    (connection): Omit<CredentialRow, "order"> => ({
      kind: "Connection",
      provider: connection.provider,
      status: connection.status,
      tone: CONNECTION_TONE.get(connection.status) ?? BADGE_TONE.ATTENTION,
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
  { key: "since", label: "Since", cell: (row) => formatInstant(row.at) },
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
        <Badge tone={BADGE_TONE.DANGER}>{failure.reason}</Badge>
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

/** Every support section, in the order a maintainer reads an account by. */
export function AccountSupportSections({
  support,
  windowDays,
}: {
  support: AdminAccountSupport;
  windowDays: number;
}): React.JSX.Element {
  return (
    <>
      <SectionHeading>Work</SectionHeading>
      <WorkCards support={support} windowDays={windowDays} />

      <SectionHeading>Recent agents</SectionHeading>
      <DataTable
        label="The account's newest coding agents"
        columns={AGENT_COLUMNS}
        rows={support.recentAgents}
        rowKey={(agent) => agent.id}
        empty="No coding agent started yet."
        minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
      />

      <SectionHeading>Workspaces</SectionHeading>
      <DataTable
        label="The account's workspaces"
        columns={WORKSPACE_COLUMNS}
        rows={support.workspaces}
        rowKey={(workspace) => workspace.id}
        empty="In no workspace."
        minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
      />

      <SectionHeading>Keys and connections</SectionHeading>
      <DataTable
        label="The account's provider keys and integration connections"
        columns={CREDENTIAL_COLUMNS}
        rows={credentialRows(support)}
        rowKey={(row) => String(row.order)}
        empty="No provider key or connection."
        minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
      />

      <SectionHeading>Defaults and experiments</SectionHeading>
      <DefaultsLines support={support} />

      <SectionHeading>{`Recent failures · ${windowDays} days`}</SectionHeading>
      <DataTable
        label="The account's recent failures"
        columns={FAILURE_COLUMNS}
        rows={support.failures.map((failure, order) => ({ order, failure }))}
        rowKey={(row) => String(row.order)}
        empty="Nothing failed in this window."
        minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
      />
    </>
  );
}
