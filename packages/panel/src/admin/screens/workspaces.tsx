import type {
  AdminWorkspaceInstallation,
  AdminWorkspaceList,
  AdminWorkspaceRow,
} from "@repo/features/admin-answer-wire";
import { ADMIN_USERS_SEARCH_MAX_LENGTH } from "@repo/features/admin-wire";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { formatDate } from "@repo/features/time-format";
import {
  type Noun,
  noMatchWords,
  noneYetWords,
  readFailedWords,
  readingWords,
} from "@repo/features/words";
import {
  Badge,
  COLLECTION_STATE,
  GAP,
  Inline,
  MARK_PROVIDER,
  QuietWords,
  SearchField,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { matchesTokens, searchTokens } from "@repo/ui/search-tokens";
import { githubAccountPageUrl } from "@repo/ui/tasks-model";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminWorkspacesQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { AdminViewOptions, PageSections } from "../chrome/controls.js";
import { ExternalLink } from "../chrome/external-links.js";
import {
  AdminCollectionPage,
  CollectionCountSkeleton,
  type ViewerAccount,
} from "../chrome/page-header.js";
import { WORKSPACES_SHARED_ONLY } from "../prefs.js";
import { searchTerm, workspacesReadQuery } from "../routing.js";
import { useSettledSearch } from "../settled-search.js";
import { INSTALLATION_LABEL, installationMark } from "../status-words.js";
import { WorkspaceCell } from "../workspace-cell.js";

const WORKSPACES_ERROR = readFailedWords("workspaces");

const WORKSPACE: Noun = { one: "workspace", many: "workspaces" };

function workspacesEmpty(searched: boolean): string {
  return searched ? noMatchWords(WORKSPACE) : noneYetWords(WORKSPACE);
}

const WORKSPACE_COLUMN = {
  NAME: "name",
  OWNER: "owner",
  MEMBERS: "members",
  GITHUB: "github",
  TASKS: "tasks",
  AGENTS: "agents",
  MERGED: "merged",
  CREATED: "created",
} as const;

type WorkspaceColumnKey = (typeof WORKSPACE_COLUMN)[keyof typeof WORKSPACE_COLUMN];

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
          <ExternalLink
            place={{
              provider: MARK_PROVIDER.GITHUB,
              label: installation.login,
              href: githubAccountPageUrl(installation.login),
            }}
          />
          <span className="flex">
            <QuietWords mark={installationMark(installation.status)}>
              {INSTALLATION_LABEL[installation.status]}
            </QuietWords>
          </span>
        </Stack>
      ))}
    </Stack>
  );
}

const workspaceColumn = createDataTableColumnHelper<AdminWorkspaceRow>();

function workspaceColumns(
  onOpenAccount: (id: string) => void,
  onOpenWorkspace: (id: string) => void,
): DataTableColumns<AdminWorkspaceRow> {
  const count = (
    key: WorkspaceColumnKey,
    label: string,
    value: (row: AdminWorkspaceRow) => number,
  ) =>
    workspaceColumn.display({
      id: key,
      header: label,
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatCount(value(row)),
    });
  return workspaceColumn.columns([
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.NAME,
      header: "Workspace",
      cell: ({ row: { original: row } }) => (
        <Inline gap={GAP.ICON}>
          <WorkspaceCell workspace={row} onOpen={onOpenWorkspace} />
          {row.personal ? <Badge tone={STATUS_TONE.NEUTRAL}>Personal</Badge> : null}
        </Inline>
      ),
    }),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.OWNER,
      header: "Owner",
      cell: ({ row: { original: row } }) =>
        row.owner === null ? "—" : <AccountCell account={row.owner} onOpen={onOpenAccount} />,
    }),
    count(WORKSPACE_COLUMN.MEMBERS, "Members", (row) => row.members),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.GITHUB,
      header: "GitHub",
      cell: ({ row: { original: row } }) => <InstallationsCell installations={row.installations} />,
    }),
    count(WORKSPACE_COLUMN.TASKS, "Tasks", (row) => row.tasksWeek),
    count(WORKSPACE_COLUMN.AGENTS, "Agents", (row) => row.agentsWeek),
    count(WORKSPACE_COLUMN.MERGED, "Merged", (row) => row.prsMergedWeek),
    workspaceColumn.display({
      id: WORKSPACE_COLUMN.CREATED,
      header: "Created",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: row } }) => formatDate(row.createdAt),
    }),
  ]);
}

const WORKSPACE_STATS: readonly StatSpec<AdminWorkspaceList>[] = [
  {
    key: "shared",
    label: () => "Shared workspaces",
    value: ({ summary }) => formatCount(summary.shared),
    hint: () => "2+ members · excludes personal",
  },
  {
    key: "active",
    label: () => "Active this week",
    value: ({ summary }) => formatCount(summary.sharedActiveWeek),
    hint: ({ summary }) =>
      `${formatPercent(summary.shared === 0 ? null : summary.sharedActiveWeek / summary.shared)} of shared`,
    title: () => "A task or agent started, or a description revised, in the last 7 UTC days",
  },
  {
    key: "invites",
    label: () => "Invites accepted",
    value: ({ summary }) => formatPercent(summary.invitations.acceptanceRate),
    hint: ({ summary }) =>
      `${formatCount(summary.invitations.pending)} pending · ${formatCount(summary.invitations.expired)} expired`,
    title: ({ summary }) =>
      `${formatCount(summary.invitations.accepted)} accepted of ${formatCount(summary.invitations.settled)} no longer open, across every workspace`,
  },
  {
    key: "github",
    label: () => "With GitHub installed",
    value: ({ summary }) => formatPercent(summary.github.activeShare),
    hint: ({ summary }) => `${formatCount(summary.github.sharedWithSuspended)} suspended`,
    title: ({ summary }) =>
      `${formatCount(summary.github.sharedWithActive)} shared workspaces with an active installation`,
  },
];

const WORKSPACES_SKELETON_ROWS = 10;

function WorkspacesNote({ list }: { list: AdminWorkspaceList }): React.JSX.Element {
  const truncated = list.total > list.rows.length;
  return (
    <Text tone={TEXT_TONE.MUTED}>
      Tasks and Agents count those started in the last {list.activityDays} UTC days, and Merged the
      distinct pull requests from the workspace's agents that merged in them.
      {truncated
        ? ` Only the ${formatCount(list.rows.length)} busiest of ${formatCount(list.total)} are listed. Search reads every workspace.`
        : ""}
    </Text>
  );
}

function WorkspacesSections({
  list,
  rows,
  searched,
  onOpenAccount,
  onOpenWorkspace,
}: {
  list: AdminWorkspaceList | undefined;
  rows: readonly AdminWorkspaceRow[];
  searched: boolean;
  onOpenAccount: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
}): React.JSX.Element {
  const workspaceTableColumns = useMemo(
    () => workspaceColumns(onOpenAccount, onOpenWorkspace),
    [onOpenAccount, onOpenWorkspace],
  );
  return (
    <>
      <StatCards layout={STAT_LAYOUT.PAIRS} stats={WORKSPACE_STATS} data={list} />
      <AdminSection>
        {list === undefined ? (
          <DataTableSkeleton
            label="Workspaces"
            columns={workspaceTableColumns}
            rows={WORKSPACES_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.WIDE}
            cells={{ [WORKSPACE_COLUMN.OWNER]: <AccountCellSkeleton /> }}
          />
        ) : (
          <>
            <DataTable
              label="Workspaces"
              columns={workspaceTableColumns}
              rows={rows}
              getRowId={(row) => row.id}
              empty={workspacesEmpty(searched)}
              minWidth={DATA_TABLE_MIN_WIDTH.WIDE}
              onRowPress={(row) => onOpenWorkspace(row.id)}
            />
            <WorkspacesNote list={list} />
          </>
        )}
      </AdminSection>
    </>
  );
}

export function WorkspacesScreen({
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onOpenAccount,
  onOpenWorkspace,
  frame,
}: {
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onOpenAccount: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate, address } = useAdminDoors();
  const [query, setQuery] = useState(address.search);
  const changeQuery = (typed: string) => {
    const next = typed.slice(0, ADMIN_USERS_SEARCH_MAX_LENGTH);
    setQuery(next);
    address.keepSearch(next.trim());
  };
  useEffect(() => address.onSearchMoved(() => setQuery(address.search())), [address]);

  const [sharedOnly, setSharedOnly] = useState(WORKSPACES_SHARED_ONLY.read);
  const changeSharedOnly = (next: boolean) => {
    WORKSPACES_SHARED_ONLY.write(next);
    setSharedOnly(next);
  };

  const asked = workspacesReadQuery(hideAdmins, sharedOnly, useSettledSearch(searchTerm(query)));
  const read = useQuery({ ...adminWorkspacesQuery(reads, asked), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();

  const page = (
    content: Pick<
      React.ComponentProps<typeof AdminCollectionPage>,
      "filters" | "state" | "skeleton" | "empty" | "error" | "children"
    >,
  ) =>
    frame(
      <AdminCollectionPage
        title="Workspaces"
        controls={
          <AdminViewOptions
            hideAdmins={hideAdmins}
            onHideAdminsChange={onHideAdminsChange}
            sharedOnly={sharedOnly}
            onSharedOnlyChange={changeSharedOnly}
          />
        }
        loadingLabel={readingWords("workspaces")}
        {...content}
      />,
    );
  const search = (
    <SearchField
      label="Search workspaces by name"
      placeholder="Search workspaces"
      value={query}
      onChange={changeQuery}
      onClear={() => changeQuery("")}
    />
  );

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: WORKSPACES_ERROR,
    loading: () =>
      page({
        filters: (
          <>
            {search}
            <CollectionCountSkeleton />
          </>
        ),
        state: COLLECTION_STATE.LOADING,
        skeleton: (
          <PageSections>
            <WorkspacesSections
              list={undefined}
              rows={[]}
              searched={false}
              onOpenAccount={onOpenAccount}
              onOpenWorkspace={onOpenWorkspace}
            />
          </PageSections>
        ),
      }),
    failed: (error) => page({ filters: search, state: COLLECTION_STATE.ERROR, error }),
    ready: (list, refreshed) => {
      const tokens = searchTokens(query);
      const rows =
        tokens.length > 0
          ? list.rows.filter((row) => matchesTokens([row.name], tokens))
          : list.rows;
      return page({
        filters: (
          <>
            {search}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {formatCount(rows.length)} of {formatCount(list.total)} workspaces
              {list.search === undefined ? "" : " matching"}
            </Text>
          </>
        ),
        state: COLLECTION_STATE.READY,
        children: refreshed(
          <WorkspacesSections
            list={list}
            rows={rows}
            searched={tokens.length > 0 || list.search !== undefined}
            onOpenAccount={onOpenAccount}
            onOpenWorkspace={onOpenWorkspace}
          />,
        ),
      });
    },
  });
}
