/**
 * workspace.tsx -- one workspace's page: what its row in the Workspaces
 * table counts, the GitHub accounts it installed the App on, and every
 * member, each opening their account's page.
 *
 * It is the step between a workspace and the people in it: the Workspaces
 * table and an account's own list of workspaces open it, and each member
 * opens their account, so a maintainer walks either way without searching.
 */

import type { AdminWorkspaceDetail, AdminWorkspaceMember } from "@repo/features/admin-answer-wire";
import { ADMIN_READ } from "@repo/features/admin-wire";
import { formatCount } from "@repo/features/number-format";
import { formatDate } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  Badge,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
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
import { githubAccountPageUrl } from "@repo/ui/tasks-model";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { AccountCell, AccountCellSkeleton } from "../accounts-table/accounts-table.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReadView } from "../admin-read-view.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { ExternalLink } from "../chrome/external-links.js";
import { AdminPage, type AdminWayBack, type ViewerAccount } from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { DataTableSkeleton } from "../chrome/table-skeleton.js";
import { ADMIN_TAB, workspaceReadQuery } from "../routing.js";
import { INSTALLATION_LABEL, installationMark } from "../status-words.js";
import { useAdminRead } from "../use-admin-read.js";

const WORKSPACE_ERROR = readFailedWords("this workspace");

/** What the page is called until its workspace is read, or where it cannot be. */
const WORKSPACE_TITLE = "Workspace";

/** The masthead's line bone, about the created line's width. */
const SKELETON_CREATED_WIDTH = "192px";

/** How many members the table's skeleton stands a row for, about a small team's. */
const MEMBERS_SKELETON_ROWS = 3;

/** The members table's columns by key; a fixed set, so a heading never carries a free string. */
const MEMBER_COLUMN = {
  ACCOUNT: "account",
  ROLE: "role",
  JOINED: "joined",
} as const;

type MemberColumnKey = (typeof MEMBER_COLUMN)[keyof typeof MEMBER_COLUMN];

/** The week's work, as the Workspaces table counts it, and how many are in it. */
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

function memberColumns(
  onOpenAccount: (id: string) => void,
): DataTableColumn<AdminWorkspaceMember, MemberColumnKey>[] {
  return [
    {
      key: MEMBER_COLUMN.ACCOUNT,
      label: "Member",
      cell: (member) => <AccountCell account={member.account} onOpen={onOpenAccount} />,
    },
    { key: MEMBER_COLUMN.ROLE, label: "Role", cell: (member) => member.role },
    { key: MEMBER_COLUMN.JOINED, label: "Joined", cell: (member) => formatDate(member.joinedAt) },
  ];
}

/** The masthead's frame: the badges line over the created line and the workspace's GitHub accounts. */
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

/** What the workspace is: whether it is someone's personal one, when it was made, and the GitHub accounts it installed the App on. */
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

/** The masthead while the workspace is read: a bone for its created line. */
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

/** The page's sections, drawn from `detail` once it is read and as their skeletons until then. */
function WorkspaceSections({
  detail,
  onOpenAccount,
}: {
  detail: AdminWorkspaceDetail | undefined;
  onOpenAccount: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {detail === undefined ? <MastheadSkeleton /> : <Masthead detail={detail} />}
      <StatCards layout={STAT_LAYOUT.PAIRS} stats={WORKSPACE_STATS} data={detail} />
      <AdminSection title="Members">
        {detail === undefined ? (
          <DataTableSkeleton
            label="Members"
            columns={memberColumns(onOpenAccount)}
            rows={MEMBERS_SKELETON_ROWS}
            minWidth={DATA_TABLE_MIN_WIDTH.MEDIUM}
            cells={{ [MEMBER_COLUMN.ACCOUNT]: <AccountCellSkeleton /> }}
          />
        ) : (
          <DataTable
            label="Members"
            columns={memberColumns(onOpenAccount)}
            rows={detail.members}
            rowKey={(member) => member.account.id}
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
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate } = useAdminDoors();
  const query = workspaceReadQuery(id);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.WORKSPACE, query },
    (signal) => reads.workspace(query, signal),
    WORKSPACE_ERROR,
    { keeps: (shown) => shown.workspace.id === id },
  );
  const signOut = () => void withdraw(onSignOut);
  const back: AdminWayBack = { tab: ADMIN_TAB.WORKSPACES, onBack };

  return adminReadView({
    read: { state, refreshing, reload },
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
