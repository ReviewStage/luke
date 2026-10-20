import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { INTEGRATION_NAME } from "@luke/features/integration-wire";
import type {
  AdminWorkspaceInstallation,
  AdminWorkspaceIntegration,
  AdminWorkspaceList,
  AdminWorkspaceRow,
} from "@luke/service/admin/admin-workspaces";
import { ADMIN_USERS_SEARCH_MAX_LENGTH } from "@luke/service/admin/http";
import {
  BADGE_TONE,
  Badge,
  type BadgeTone,
  Checkbox,
  COLLECTION_STATE,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  EmptyState,
  GAP,
  Inline,
  SearchField,
  SearchIcon,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { formatDate, formatNumber } from "@luke/ui/admin-format";
import { useEffect, useState } from "react";
import { AccountCell } from "../accounts-table/accounts-table";
import { STAT_CELL, STAT_PAIR, STAT_ROW, StatCard } from "../charts/stat-card";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing } from "../chrome/controls";
import { AdminCollectionPage, type ViewerAccount } from "../chrome/page-header";
import { WORKSPACES_SHARED_ONLY } from "../prefs";
import {
  SEARCH_DEBOUNCE_MS,
  searchFromLocation,
  searchHref,
  searchTerm,
  workspacesReadPath,
} from "../routing";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

/**
 * workspaces.tsx -- the Workspaces tab: how many teams share a workspace,
 * whether they are active, invite each other, and installed the GitHub App,
 * over a table of the workspaces themselves, busiest week first.
 *
 * A row names its workspace, its owner, counts, and the GitHub account and
 * integrations it connected; opening one opens its owner's account page,
 * since a workspace has no page of its own.
 */

const WORKSPACES_ERROR = "The workspaces endpoint did not answer.";

const WORKSPACES_EMPTY = "No workspace matches.";

// SAFETY: a 200 from the admin workspaces endpoint is an AdminWorkspaceList body by its contract.
const readWorkspaceList: AdminReader<AdminWorkspaceList> = async (response) =>
  (await response.json()) as AdminWorkspaceList;

/** The table's columns by key; a fixed set, so a heading never carries a free string. */
const WORKSPACE_COLUMN = {
  NAME: "name",
  OWNER: "owner",
  MEMBERS: "members",
  GITHUB: "github",
  INTEGRATIONS: "integrations",
  TASKS: "tasks",
  AGENTS: "agents",
  MERGED: "merged",
  CREATED: "created",
} as const;

type WorkspaceColumnKey = (typeof WORKSPACE_COLUMN)[keyof typeof WORKSPACE_COLUMN];

/** The tone each installation status is drawn in: working, held, or gone. */
const INSTALLATION_TONE = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: BADGE_TONE.COMPLETE,
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: BADGE_TONE.ATTENTION,
  [GITHUB_INSTALLATION_STATUS.DELETED]: BADGE_TONE.NEUTRAL,
} as const satisfies Record<AdminWorkspaceInstallation["status"], BadgeTone>;

const INSTALLATION_LABEL = {
  [GITHUB_INSTALLATION_STATUS.ACTIVE]: "Active",
  [GITHUB_INSTALLATION_STATUS.SUSPENDED]: "Suspended",
  [GITHUB_INSTALLATION_STATUS.DELETED]: "Uninstalled",
} as const satisfies Record<AdminWorkspaceInstallation["status"], string>;

/** A share drawn as a whole percent, or a dash where there was nothing to share out. */
function formatShare(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

function InstallationsCell({
  installations,
}: {
  installations: readonly AdminWorkspaceInstallation[];
}): React.JSX.Element {
  if (installations.length === 0) {
    return (
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        Not installed
      </Text>
    );
  }
  return (
    <Stack gap={GAP.CONTROL}>
      {installations.map((installation) => (
        <Stack key={installation.login} gap={GAP.TIGHT}>
          <Text as={TEXT_ELEMENT.SPAN}>{installation.login}</Text>
          <span className="flex">
            <Badge tone={INSTALLATION_TONE[installation.status]}>
              {INSTALLATION_LABEL[installation.status]}
            </Badge>
          </span>
        </Stack>
      ))}
    </Stack>
  );
}

function IntegrationsCell({
  integrations,
}: {
  integrations: readonly AdminWorkspaceIntegration[];
}): React.JSX.Element {
  if (integrations.length === 0) {
    return (
      <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
        None
      </Text>
    );
  }
  return (
    <Inline gap={GAP.ICON}>
      {integrations.map((integration) => (
        <Badge
          key={integration.provider}
          tone={
            integration.status === INTEGRATION_ROW_STATUS.EXPIRED
              ? BADGE_TONE.ATTENTION
              : BADGE_TONE.NEUTRAL
          }
        >
          {integration.status === INTEGRATION_ROW_STATUS.EXPIRED
            ? `${INTEGRATION_NAME[integration.provider]} · expired`
            : INTEGRATION_NAME[integration.provider]}
        </Badge>
      ))}
    </Inline>
  );
}

function workspaceColumns(
  onOpenAccount: (id: string) => void,
): DataTableColumn<AdminWorkspaceRow, WorkspaceColumnKey>[] {
  const count = (
    key: WorkspaceColumnKey,
    label: string,
    value: (row: AdminWorkspaceRow) => number,
  ) => ({
    key,
    label,
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    cell: (row: AdminWorkspaceRow) => formatNumber(value(row)),
  });
  return [
    {
      key: WORKSPACE_COLUMN.NAME,
      label: "Workspace",
      cell: (row) => (
        <Inline gap={GAP.ICON}>
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
            {row.name}
          </Text>
          {row.personal ? <Badge tone={BADGE_TONE.NEUTRAL}>Personal</Badge> : null}
        </Inline>
      ),
    },
    {
      key: WORKSPACE_COLUMN.OWNER,
      label: "Owner",
      cell: (row) =>
        row.owner === null ? "—" : <AccountCell account={row.owner} onOpen={onOpenAccount} />,
    },
    count(WORKSPACE_COLUMN.MEMBERS, "Members", (row) => row.members),
    {
      key: WORKSPACE_COLUMN.GITHUB,
      label: "GitHub",
      cell: (row) => <InstallationsCell installations={row.installations} />,
    },
    {
      key: WORKSPACE_COLUMN.INTEGRATIONS,
      label: "Integrations",
      cell: (row) => <IntegrationsCell integrations={row.integrations} />,
    },
    count(WORKSPACE_COLUMN.TASKS, "Tasks", (row) => row.tasksWeek),
    count(WORKSPACE_COLUMN.AGENTS, "Agents", (row) => row.agentsWeek),
    count(WORKSPACE_COLUMN.MERGED, "Merged", (row) => row.prsMergedWeek),
    {
      key: WORKSPACE_COLUMN.CREATED,
      label: "Created",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      cell: (row) => formatDate(row.createdAt),
    },
  ];
}

/** The four headline counts, in the stat row's two wrapping pairs. */
function WorkspaceTiles({ list }: { list: AdminWorkspaceList }): React.JSX.Element {
  const { summary } = list;
  const activeShare = summary.shared === 0 ? null : summary.sharedActiveWeek / summary.shared;
  return (
    <div className={STAT_ROW}>
      <div className={STAT_PAIR}>
        <div className={STAT_CELL}>
          <StatCard
            label="Shared workspaces"
            value={formatNumber(summary.shared)}
            hint="2+ members · excludes personal"
          />
        </div>
        <div className={STAT_CELL}>
          <StatCard
            label="Active this week"
            value={formatNumber(summary.sharedActiveWeek)}
            hint={`${formatShare(activeShare)} of shared`}
            title="A task or coding agent started, or a plan revised, in the last 7 UTC days"
          />
        </div>
      </div>
      <div className={STAT_PAIR}>
        <div className={STAT_CELL}>
          <StatCard
            label="Invites accepted"
            value={formatShare(summary.invitations.acceptanceRate)}
            hint={`${formatNumber(summary.invitations.pending)} pending · ${formatNumber(summary.invitations.expired)} expired`}
            title={`${formatNumber(summary.invitations.accepted)} accepted of ${formatNumber(summary.invitations.settled)} no longer open, across every workspace`}
          />
        </div>
        <div className={STAT_CELL}>
          <StatCard
            label="With GitHub installed"
            value={formatShare(summary.github.activeShare)}
            hint={`${formatNumber(summary.github.sharedWithSuspended)} suspended`}
            title={`${formatNumber(summary.github.sharedWithActive)} shared workspaces with an active installation`}
          />
        </div>
      </div>
    </div>
  );
}

/** What the table's figures mean, and where its bound cut it. */
function WorkspacesNote({ list }: { list: AdminWorkspaceList }): React.JSX.Element {
  const truncated = list.total > list.rows.length;
  return (
    <div className="mt-3">
      <Text tone={TEXT_TONE.MUTED}>
        Tasks and Agents count those started in the last {list.activityDays} UTC days, and Merged
        the distinct pull requests from the workspace's agents that merged in them; the table is
        sorted by that week's activity. The headline counts read shared workspaces whatever the
        table lists.
        {truncated
          ? ` Only the ${formatNumber(list.rows.length)} busiest of ${formatNumber(list.total)} are listed. Search reads every workspace.`
          : ""}
      </Text>
    </div>
  );
}

export function WorkspacesScreen({
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onOpenAccount,
  frame,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  // The search follows the roster's: the box filters what is loaded at once,
  // the debounced read searches every workspace, and the address keeps it.
  const [query, setQuery] = useState(searchFromLocation);
  const changeQuery = (typed: string) => {
    const next = typed.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
    setQuery(next);
    window.history.replaceState(null, "", searchHref(next.trim()));
  };
  useEffect(() => {
    const onPopState = () => setQuery(searchFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const [sharedOnly, setSharedOnly] = useState(WORKSPACES_SHARED_ONLY.read);
  const changeSharedOnly = (next: boolean) => {
    WORKSPACES_SHARED_ONLY.write(next);
    setSharedOnly(next);
  };

  const { state, refreshing, reload, withdraw } = useAdminRead(
    workspacesReadPath(hideAdmins, sharedOnly, searchTerm(query)),
    readWorkspaceList,
    WORKSPACES_ERROR,
    { debounceMs: SEARCH_DEBOUNCE_MS },
  );
  const signOut = () => void withdraw(onSignOut);

  const page = (
    content: Pick<
      React.ComponentProps<typeof AdminCollectionPage>,
      "filters" | "state" | "empty" | "children"
    >,
  ) =>
    frame(
      <AdminCollectionPage
        title="Workspaces"
        controls={
          <>
            <Checkbox checked={sharedOnly} onChange={changeSharedOnly}>
              Shared only
            </Checkbox>
            <HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />
          </>
        }
        account={account}
        onSignOut={signOut}
        loadingLabel="Loading…"
        {...content}
      />,
    );
  const search = (
    <SearchField
      label="Search workspaces by name"
      placeholder="Search workspaces…"
      value={query}
      onChange={changeQuery}
      onClear={() => changeQuery("")}
    />
  );

  switch (state.status) {
    case "loading":
      return page({ filters: search, state: COLLECTION_STATE.LOADING });
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return frame(
        <AdminErrorCard
          detail={adminReadFailure(state, WORKSPACES_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const list = state.value;
      const needle = query.trim().toLowerCase();
      const rows = needle
        ? list.rows.filter((row) => row.name.toLowerCase().includes(needle))
        : list.rows;
      // Note that the tiles stand whatever the search narrows, so they lead
      // both the table and the empty answer.
      const body = (table: React.ReactNode) => (
        <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
          <WorkspaceTiles list={list} />
          <div className="mt-6">{table}</div>
          <WorkspacesNote list={list} />
        </Refreshing>
      );

      return page({
        filters: (
          <>
            {search}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {formatNumber(rows.length)} of {formatNumber(list.total)} workspaces
              {list.search === undefined ? "" : " matching"}
            </Text>
          </>
        ),
        state: rows.length === 0 ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY,
        empty: body(<EmptyState icon={<SearchIcon />}>{WORKSPACES_EMPTY}</EmptyState>),
        children: body(
          <DataTable
            label="Workspaces"
            columns={workspaceColumns(onOpenAccount)}
            rows={rows}
            rowKey={(row) => row.id}
            empty={WORKSPACES_EMPTY}
            minWidth={DATA_TABLE_MIN_WIDTH.WIDE}
            rowPressable={(row) => row.owner !== null}
            onRowPress={(row) => {
              if (row.owner !== null) onOpenAccount(row.owner.id);
            }}
          />,
        ),
      });
    }
  }
}
