import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { PlanningRepositoriesAnswer } from "@luke/features/planning-view";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { ProviderMark } from "@luke/ui";
import { memberActor, ROLE_WORDS } from "@luke/ui/actor-model";
import { repositoryNameOf } from "@luke/ui/planning-model";
import { ChevronRightIcon, GitBranchIcon, LockIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, ActorStack, YouBadge } from "../actor-ref";
import { WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "../desktop/workspace-ref";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { CardHead, CardNote, CardRule, HoverCard } from "../hover-card";
import { useMemberDirectory } from "../member-directory";
import { useOpenSettings } from "../open-settings";
import { RepositoryPicture } from "../repository-picture";
import { Tooltip } from "../tooltip";

/**
 * plan-crumb.tsx -- the line over a plan's title that says where it lives and who can edit it: "Acme › relay", then "5 can edit".
 *
 * A plan belongs to one workspace, and everyone in it can read and edit the
 * plan, join its calls, and message its agents, so the plan says so where
 * GitHub's `owner / repo` and Vercel's `team / project` say theirs
 * (`docs/proposals/workspace-clarity.md`, decision 6). The crumb leads with
 * the workspace's tile and name (`workspace-ref.tsx`), which opens that
 * workspace's home page, the window switching to it first where another is
 * listed, and hangs the workspace's card. Then, where the plan is about a
 * repository, the repository drawn as the workspace is: its owner's picture
 * and its name alone, as the sidebar says it, hanging a card saying its
 * `owner/name`, its default branch, and the workspace's GitHub account it
 * comes through. It presses nowhere: the plan's own menu opens it on GitHub
 * and changes it, and the sidebar starts a new task in it. At its end
 * stands who can edit: the first few members' faces and "5 can edit", or a
 * lock and "Only you" for a workspace of one. Resting on it hangs a card
 * listing everyone by name and role, and pressing it opens the workspace's
 * members in Settings. Each face is drawn as the window draws any person
 * (`actor-ref.tsx`): the member's sign-in picture where the members read
 * lists one, their letter on its hue otherwise, and the reader's own row
 * wears You. The members are the plan's directory's (`member-directory.tsx`),
 * read once for the plan; until they answer, or if they never do, the count
 * stands alone, from the workspace's own count.
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
    ? "Each can read this task, and edit it once it is unarchived."
    : "Each can read and edit this task, join its calls, and message its agents.";
  return (
    <HoverCard data-people-card="">
      <CardHead
        glyph={<WorkspaceTile workspace={workspace} />}
        name={only ? "Only you" : `Everyone in ${workspace.name}`}
        sub={only ? `${workspace.name} has no other members` : `${count} members`}
      />
      <CardNote>
        {only ? "Invite someone to this workspace and they can read and edit its tasks." : note}
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

/** What the repository's crumb reaches: its owner's picture and its default branch. */
interface RepositoryCrumbDoors {
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  readonly pictures: boolean;
  /** Reads the repositories the plan's workspace reaches, which say each one's default branch. */
  readonly read: () => Promise<PlanningRepositoriesAnswer>;
}

/** Where the crumb's presses go. */
export interface PlanCrumbDoors {
  /** Opens the workspace's home page, switching the window to the workspace first where another is listed. */
  readonly onOpenWorkspace: () => void;
  /** Whether the workspace is the account's own first one, which its card calls personal. */
  readonly personal: boolean;
  readonly repository: RepositoryCrumbDoors;
}

/** A repository's default branch as the read says it: undefined until asked and answered, null where the read names none. */
type DefaultBranch = string | null | undefined;

/** The default branch the read names for a repository, or null where it names none or failed. */
function defaultBranchOf(answer: PlanningRepositoriesAnswer, repository: string): string | null {
  if ("failure" in answer) return null;
  const named = repository.toLowerCase();
  const found = answer.repositories.repositories.find(
    (each) => each.fullName.toLowerCase() === named,
  );
  return found?.defaultBranch ?? null;
}

/**
 * The repository's card: its picture and name, the workspace's GitHub
 * account it comes through, and its default branch once the read names it.
 * The read is asked the first time the card is drawn, as the card is what
 * wants it.
 */
function RepositoryCard({
  repository,
  workspace,
  pictures,
  branch,
  onShown,
}: {
  repository: string;
  workspace: Workspace;
  pictures: boolean;
  branch: DefaultBranch;
  onShown: () => void;
}): React.JSX.Element {
  // Note that asking twice reads once, because the crumb holds the read.
  useEffect(() => onShown(), [onShown]);
  const { github } = workspace;
  return (
    <HoverCard data-repository-card="">
      <CardHead
        glyph={
          <RepositoryPicture
            repository={repository}
            pictures={pictures}
            fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
          />
        }
        name={repository}
        sub={
          github == null
            ? `${workspace.name} has no GitHub connected`
            : `Through ${github.login} on GitHub · ${workspace.name}`
        }
      />
      {branch !== undefined && branch !== null ? (
        <CardNote>
          <span className="plan-crumb-branch">
            <GitBranchIcon aria-hidden="true" />
            {`Default branch ${branch}`}
          </span>
        </CardNote>
      ) : null}
    </HoverCard>
  );
}

/** The repository as the workspace stands before it: its owner's picture and its name, its card on rest. */
function RepositoryCrumb({
  repository,
  workspace,
  doors,
}: {
  repository: string;
  workspace: Workspace;
  doors: RepositoryCrumbDoors;
}): React.JSX.Element {
  const [branch, setBranch] = useState<DefaultBranch>(undefined);
  const reading = useRef(false);
  const readBranch = () => {
    if (reading.current) return;
    reading.current = true;
    doors.read().then(
      (answer) => setBranch(defaultBranchOf(answer, repository)),
      () => setBranch(null),
    );
  };
  return (
    <Tooltip
      label={repository}
      card={
        <RepositoryCard
          repository={repository}
          workspace={workspace}
          pictures={doors.pictures}
          branch={branch}
          onShown={readBranch}
        />
      }
    >
      <span className="plan-crumb-item plan-crumb-repository">
        <RepositoryPicture
          repository={repository}
          pictures={doors.pictures}
          fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
        />
        <span className="plan-crumb-name">{repositoryNameOf(repository)}</span>
      </span>
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
  doors,
}: {
  workspace: Workspace;
  /** The repository the plan is about, `owner/name`, or none. */
  repository: string | null;
  archived: boolean;
  doors: PlanCrumbDoors;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const { members, readerId } = useMemberDirectory();
  const count = editorsOf(workspace, members);
  const page = { page: SETTINGS_VIEW.WORKSPACE, workspaceId: workspace.id };
  return (
    <nav className="plan-crumb" aria-label="Where this task is">
      <Tooltip
        label={workspace.name}
        card={<WorkspaceCard workspace={workspace} personal={doors.personal} />}
      >
        <button type="button" className="plan-crumb-item" onClick={doors.onOpenWorkspace}>
          <WorkspaceRef workspace={workspace} size={WORKSPACE_REF_SIZE.ROW} />
        </button>
      </Tooltip>
      {repository === null ? null : (
        <>
          <ChevronRightIcon className="plan-crumb-separator" aria-hidden="true" />
          {/* Keyed by the workspace and then the repository, so a plan moved to
              another workspace reads its branch afresh, through that one's GitHub. */}
          <Fragment key={workspace.id}>
            <RepositoryCrumb
              key={repository}
              repository={repository}
              workspace={workspace}
              doors={doors.repository}
            />
          </Fragment>
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
