import type { AdminWorkspaceDetail, AdminWorkspaceMember } from "@repo/features/admin-answer-wire";
import { formatCount } from "@repo/features/number-format";
import { formatDate } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  Badge,
  GAP,
  Inline,
  MARK_PROVIDER,
  QuietWords,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  DataTableSkeleton,
} from "@repo/ui/data-table";
import { githubAccountPageUrl } from "@repo/ui/tasks-model";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminWorkspaceQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { ExternalLink } from "../chrome/external-links.js";
import { AdminPage, type AdminWayBack, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { ADMIN_TAB, workspaceReadQuery } from "../routing.js";
import { INSTALLATION_LABEL, installationMark } from "../status-words.js";

const WORKSPACE_ERROR = readFailedWords("this workspace");

const WORKSPACE_TITLE = "Workspace";

const SKELETON_CREATED_WIDTH = "192px";

const MEMBERS_SKELETON_ROWS = 3;

const MEMBER_COLUMN = {
  ACCOUNT: "account",
  ROLE: "role",
  JOINED: "joined",
} as const;

const WORKSPACE_STATS: readonly StatSpec<AdminWorkspaceDetail>[] = [
  {
    key: "members",
    label: () => "Members",
    value: ({ workspace }) => formatCount(workspace.members),
  },
  {
    key: "tasks",
    label: ({ activityDays }) => `Tasks · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.tasksWeek),
  },
  {
    key: "agents",
    label: ({ activityDays }) => `Agents · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.agentsWeek),
  },
  {
    key: "merged",
    label: ({ activityDays }) => `Pull requests merged · ${activityDays} days`,
    value: ({ workspace }) => formatCount(workspace.prsMergedWeek),
    title: () => "Distinct pull requests from the workspace's agents that merged",
  },
];

const memberColumn = createDataTableColumnHelper<AdminWorkspaceMember>();

function memberColumns(
  onOpenAccount: (id: string) => void,
): DataTableColumns<AdminWorkspaceMember> {
  return memberColumn.columns([
    memberColumn.display({
      id: MEMBER_COLUMN.ACCOUNT,
      header: "Member",
      cell: ({ row: { original: member } }) => (
        <AccountCell account={member.account} onOpen={onOpenAccount} />
      ),
    }),
    memberColumn.display({
      id: MEMBER_COLUMN.ROLE,
      header: "Role",
      cell: ({ row: { original: member } }) => member.role,
    }),
    memberColumn.display({
      id: MEMBER_COLUMN.JOINED,
      header: "Joined",
      cell: ({ row: { original: member } }) => formatDate(member.joinedAt),
    }),
  ]);
}

function MastheadFrame({
  created,
  links,
}: {
  created: React.ReactNode;
  links: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={GAP.TIGHT}>
      {created}
      {links}
    </Stack>
  );
}

function Masthead({ detail }: { detail: AdminWorkspaceDetail }): React.JSX.Element {
  const { workspace } = detail;
  return (
    <MastheadFrame
      created={
        <Inline>
          {workspace.personal ? <Badge tone={STATUS_TONE.NEUTRAL}>Personal</Badge> : null}
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Created {formatDate(workspace.createdAt)}
            {workspace.installations.length === 0 ? " · GitHub App not installed" : ""}
          </Text>
        </Inline>
      }
      links={
        workspace.installations.length === 0 ? null : (
          <Inline gap={GAP.FIELD}>
            {workspace.installations.map((installation) => (
              <Inline key={installation.login} gap={GAP.ICON}>
                <ExternalLink
                  place={{
                    provider: MARK_PROVIDER.GITHUB,
                    label: installation.login,
                    href: githubAccountPageUrl(installation.login),
                  }}
                />
                <QuietWords mark={installationMark(installation.status)}>
                  {INSTALLATION_LABEL[installation.status]}
                </QuietWords>
              </Inline>
            ))}
          </Inline>
        )
      }
    />
  );
}

function MastheadSkeleton(): React.JSX.Element {
  return (
    <MastheadFrame
      created={
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
          <Skeleton shape={SKELETON_SHAPE.LINE} width={SKELETON_CREATED_WIDTH} />
        </Text>
      }
      links={null}
    />
  );
}

function WorkspaceSections({
  detail,
  onOpenAccount,
}: {
  detail: AdminWorkspaceDetail | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  const memberTableColumns = useMemo(() => memberColumns(onOpenAccount), [onOpenAccount]);
  return (
    <>
      {detail === undefined ? <MastheadSkeleton /> : <Masthead detail={detail} />}
      <StatCards layout={STAT_LAYOUT.PAIRS} stats={WORKSPACE_STATS} data={detail} />
      <AdminSection title="Members">
        {detail === undefined ? (
          <DataTableSkeleton
            label="Members"
            columns={memberTableColumns}
            rows={MEMBERS_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [MEMBER_COLUMN.ACCOUNT]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label="Members"
            columns={memberTableColumns}
            rows={detail.members}
            getRowId={(member) => member.account.id}
            empty="No members"
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            onRowPress={(member) => onOpenAccount(member.account.id)}
          />
        )}
      </AdminSection>
    </>
  );
}

export function WorkspaceScreen({
  id,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  frame,
}: {
  id: string;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const query = workspaceReadQuery(id);
  const read = useQuery({ ...adminWorkspaceQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const back: AdminWayBack = { tab: ADMIN_TAB.WORKSPACES, onBack };

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: WORKSPACE_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={WORKSPACE_TITLE} back={back} controls={null}>
          <WorkspaceSections detail={undefined} onOpenAccount={onOpenAccount} />
        </PageSkeleton>,
      ),
    missing: () =>
      frame(
        <AdminPage title={WORKSPACE_TITLE} back={back} controls={null}>
          <NotFound thing={NOT_FOUND_THING.WORKSPACE} />
        </AdminPage>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={WORKSPACE_TITLE} back={back} controls={null}>
          {error}
        </AdminPage>,
      ),
    ready: (detail, refreshed) =>
      frame(
        <AdminPage title={detail.workspace.name} back={back} controls={null}>
          {refreshed(<WorkspaceSections detail={detail} onOpenAccount={onOpenAccount} />)}
        </AdminPage>,
      ),
  });
}
