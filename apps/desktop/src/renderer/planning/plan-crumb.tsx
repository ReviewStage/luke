import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { memberActor, ROLE_WORDS } from "@luke/ui/actor-model";
import { ChevronRightIcon, LockIcon } from "lucide-react";
import { ACTOR_SIZE, ActorMark, ActorStack, YouBadge } from "../actor-ref";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile";
import { CardHead, CardNote, CardRule, HoverCard } from "../hover-card";
import { useOpenSettings } from "../open-settings";
import { Tooltip } from "../tooltip";
import { useWorkspaceMembers } from "./use-workspace-members";

/**
 * plan-crumb.tsx -- the line over a plan's title that says where it lives and who can edit it: "Acme › relay", then "5 can edit".
 *
 * A plan belongs to one workspace, and everyone in it can read and edit the
 * plan, join its calls, and message its agents, so the plan says so where
 * GitHub's `owner / repo` and Vercel's `team / project` say theirs
 * (`docs/proposals/workspace-clarity.md`, decision 6). The crumb leads with
 * the workspace's tile and name, which opens that workspace's Settings
 * page, then the repository's name where the plan is about one. At its end
 * stands who can edit: the first few members' faces and "5 can edit", or a
 * lock and "Only you" for a workspace of one. Resting on it hangs a card
 * listing everyone by name and role, and pressing it opens the workspace's
 * members in Settings. Each face is drawn as the window draws any person
 * (`actor-ref.tsx`): the member's sign-in picture where the members read
 * lists one, their letter on its hue otherwise, and the reader's own row
 * wears You. The members are read
 * once per workspace the crumb stands in (`use-workspace-members.ts`); until
 * they answer, or if they never do, the count stands alone, from the
 * workspace's own count.
 */

/** How many faces the crumb's end draws before the count says the rest. */
const FACES_DRAWN = 4;

/** How many can edit: the workspace's own count, the newer word, else the members read; none where neither is known. */
function editorsOf(
  workspace: Workspace,
  members: readonly WorkspaceMember[] | undefined,
): number | undefined {
  return workspace.memberCount ?? members?.length;
}

/** The card hung from the crumb's end: everyone who can edit, by name and role. */
function PeopleCard({
  workspace,
  members,
  count,
  archived,
  readerId,
}: {
  workspace: Workspace;
  members: readonly WorkspaceMember[] | undefined;
  count: number;
  archived: boolean;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
}): React.JSX.Element {
  const only = count <= 1;
  const note = archived
    ? "Each can read this plan, and edit it once it is unarchived."
    : "Each can read and edit this plan, join its calls, and message its agents.";
  return (
    <HoverCard data-people-card="">
      <CardHead
        glyph={<WorkspaceTile workspace={workspace} />}
        name={only ? "Only you" : `Everyone in ${workspace.name}`}
        sub={only ? `${workspace.name} has no other members` : `${count} members`}
      />
      <CardNote>
        {only ? "Invite someone to this workspace and they can read and edit its plans." : note}
      </CardNote>
      {only || members === undefined ? null : (
        <>
          <CardRule />
          <ul className="plan-crumb-people-list">
            {members.map((member) => (
              <li key={member.userId}>
                <ActorMark actor={memberActor(member, readerId)} size={ACTOR_SIZE.ROW} />
                <span className="plan-crumb-person">{member.name}</span>
                {member.userId === readerId ? <YouBadge /> : null}
                <span className="plan-crumb-role">{ROLE_WORDS[member.role]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </HoverCard>
  );
}

/** The crumb's end: who can edit, its card on rest and the workspace's members on a press. */
function People({
  workspace,
  members,
  count,
  archived,
  readerId,
  onOpen,
}: {
  workspace: Workspace;
  members: readonly WorkspaceMember[] | undefined;
  count: number;
  archived: boolean;
  readerId: string | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const only = count <= 1;
  return (
    <Tooltip
      label={only ? "Only you" : `Everyone in ${workspace.name}`}
      card={
        <PeopleCard
          workspace={workspace}
          members={members}
          count={count}
          archived={archived}
          readerId={readerId}
        />
      }
    >
      <button type="button" className="plan-crumb-people" onClick={onOpen}>
        {only ? (
          <>
            <LockIcon aria-hidden="true" />
            Only you
          </>
        ) : (
          <>
            {members === undefined ? null : (
              <ActorStack
                actors={members.map((member) => memberActor(member, readerId))}
                drawn={FACES_DRAWN}
                counted={false}
              />
            )}
            {archived ? `${count} members` : `${count} can edit`}
          </>
        )}
      </button>
    </Tooltip>
  );
}

/**
 * The crumb over a plan's title: its workspace, its repository, and who can
 * edit it, which an archived plan says as who is in the workspace, since
 * nobody edits it until it is unarchived, and which stands nowhere while
 * neither the workspace's count nor its members are known.
 */
export function PlanCrumb({
  workspace,
  repository,
  archived,
  readerId,
}: {
  workspace: Workspace;
  /** The repository the plan is about, `owner/name`, or none. */
  repository: string | null;
  archived: boolean;
  /** The reader's account id, whose own face and row are drawn as theirs. */
  readerId: string | undefined;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const members = useWorkspaceMembers(workspace);
  const count = editorsOf(workspace, members);
  const page = { page: SETTINGS_VIEW.WORKSPACE, workspaceId: workspace.id };
  return (
    <nav className="plan-crumb" aria-label="Where this plan is">
      <button type="button" className="plan-crumb-item" onClick={() => openSettings(page)}>
        <WorkspaceTile workspace={workspace} size={TILE_SIZE.ROW} />
        {workspace.name}
      </button>
      {repository === null ? null : (
        <>
          <ChevronRightIcon className="plan-crumb-separator" aria-hidden="true" />
          <span className="plan-crumb-item">{repository.split("/").at(-1)}</span>
        </>
      )}
      {count === undefined ? null : (
        <People
          workspace={workspace}
          members={members}
          count={count}
          archived={archived}
          readerId={readerId}
          onOpen={() => openSettings({ ...page, section: SETTINGS_SECTION.MEMBERS })}
        />
      )}
    </nav>
  );
}
