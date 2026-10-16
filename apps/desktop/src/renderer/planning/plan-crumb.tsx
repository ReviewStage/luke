import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import type { TasksRepositoriesAnswer } from "@luke/features/tasks-view";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ProviderMark } from "@luke/ui";
import { type Actor, actorName, memberActor, ROLE_WORDS } from "@luke/ui/actor-model";
import { ChevronRightIcon, GitBranchIcon, LockIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, ActorStack, YouBadge } from "../actor-ref";
import { WORKSPACE_REF_SIZE, WorkspaceCard, WorkspaceRef } from "../desktop/workspace-ref";
import { WorkspaceTile } from "../desktop/workspace-tile";
import { CardHead, CardNote, CardRule, HoverCard } from "../hover-card";
import { useCreator, useMemberDirectory } from "../member-directory";
import { useActorDoor } from "../person-door";
import { RepositoryPicture } from "../repository-picture";
import { Tooltip } from "../tooltip";
import { useMinute } from "./plan-time";
import { RelativeTime } from "./relative-time";

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
 * listing everyone by name and role, and, as the repository, it presses
 * nowhere. Where the list names who created the task, its
 * creator leads the faces and the list, the card says "Created by Charles
 * Pan · 3d ago" over the list, and the creator's row says so beside their role. Each face is drawn as the window draws any person
 * (`actor-ref.tsx`): the member's sign-in picture where the members read
 * lists one, their letter on its hue otherwise, and the reader's own row
 * wears You. The members are the plan's directory's (`member-directory.tsx`),
 * read once for the plan; until they answer, or if they never do, the count
 * stands alone, from the workspace's own count.
 *
 * Who can edit is never cut short: the names give way first. In a narrow
 * column the crumb wraps rather than cutting the names to a letter, the
 * repository and its separator onto a line together (desktop.css's
 * `@container plan-document`).
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

/** Who created the task, and when, where the list names its creator. */
interface Creation {
  readonly creator: Actor;
  /** The creator's account id, whose row leads the faces and the list. */
  readonly userId: string;
  readonly at: number;
}

/** What a task's creation says to the crumb; none where the list names no creator. */
function useCreation(
  created: Pick<TaskSummary, "createdBy" | "ownerId" | "createdAt"> | undefined,
): Creation | undefined {
  const creator = useCreator(created ?? {});
  const userId = created?.createdBy?.userId ?? created?.ownerId;
  if (created === undefined || userId === undefined) return undefined;
  return { creator, userId, at: created.createdAt };
}

/** The members with the task's creator first, the rest in the members' own order. */
function creatorFirst(
  members: readonly WorkspaceMember[],
  creation: Creation | undefined,
): readonly WorkspaceMember[] {
  if (creation === undefined) return members;
  const isCreator = (member: WorkspaceMember) => member.userId === creation.userId;
  return [...members.filter(isCreator), ...members.filter((member) => !isCreator(member))];
}

/** The card's line saying who created the task: "Created by [face] Charles Pan · 3d ago". */
function CreatedBy({ creation }: { creation: Creation }): React.JSX.Element {
  const now = useMinute();
  return (
    <CardNote>
      <span className="actor-line plan-crumb-created">
        {"Created by "}
        <ActorMark actor={creation.creator} />
        {` ${actorName(creation.creator, { sentence: true })} · `}
        <RelativeTime at={creation.at} now={now} hint={false} ago />
      </span>
    </CardNote>
  );
}

/** One member in the people card: their face, name, You for the reader, and role, a press opening their page where the window offers one. */
function PersonRow({
  member,
  readerId,
  creator,
}: {
  member: WorkspaceMember;
  readerId: string | undefined;
  /** Whether they created the task, which their role's words say first. */
  creator: boolean;
}): React.JSX.Element {
  const actor = memberActor(member, readerId);
  const door = useActorDoor(actor);
  const words = (
    <>
      <ActorMark actor={actor} size={ACTOR_SIZE.ROW} />
      <span className="plan-crumb-person">{member.name}</span>
      {member.userId === readerId ? <YouBadge /> : null}
      <span className="plan-crumb-role">
        {creator ? `Creator · ${ROLE_WORDS[member.role]}` : ROLE_WORDS[member.role]}
      </span>
    </>
  );
  return (
    <li>
      {door === undefined ? (
        <span className="plan-crumb-person-row">{words}</span>
      ) : (
        <button
          type="button"
          className="plan-crumb-person-row"
          data-card-choice=""
          aria-label={`Open ${member.name}'s profile`}
          onClick={door}
        >
          {words}
        </button>
      )}
    </li>
  );
}

/** The card hung from the crumb's end: who created the task, then everyone who can edit, by name and role, each opening their page. */
function PeopleCard({
  workspace,
  members,
  count,
  archived,
  readerId,
  creation,
}: {
  workspace: Workspace;
  members: readonly WorkspaceMember[] | undefined;
  count: number;
  archived: boolean;
  /** The reader's account id, whose own row wears You. */
  readerId: string | undefined;
  creation: Creation | undefined;
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
      {only || creation === undefined ? null : <CreatedBy creation={creation} />}
      {only ? null : <CardNote>{note}</CardNote>}
      {only || members === undefined ? null : (
        <>
          <CardRule />
          <ul className="plan-crumb-people-list">
            {creatorFirst(members, creation).map((member) => (
              <PersonRow
                key={member.userId}
                member={member}
                readerId={readerId}
                creator={member.userId === creation?.userId}
              />
            ))}
          </ul>
        </>
      )}
    </HoverCard>
  );
}

/** The crumb's end: who can edit, its card on rest; no press. */
function People({
  workspace,
  members,
  count,
  archived,
  readerId,
  creation,
}: {
  workspace: Workspace;
  members: readonly WorkspaceMember[] | undefined;
  count: number;
  archived: boolean;
  readerId: string | undefined;
  creation: Creation | undefined;
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
          creation={creation}
        />
      }
    >
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: it takes the keyboard though it presses nowhere, because its card is the only place the members are listed. */}
      <span className="plan-crumb-item plan-crumb-people" tabIndex={0}>
        {only ? (
          <>
            <LockIcon aria-hidden="true" />
            Only you
          </>
        ) : (
          <>
            {members === undefined ? null : (
              <ActorStack
                actors={creatorFirst(members, creation).map((member) =>
                  memberActor(member, readerId),
                )}
                drawn={FACES_DRAWN}
                counted={false}
              />
            )}
            {archived ? `${count} members` : `${count} can edit`}
          </>
        )}
      </span>
    </Tooltip>
  );
}

/** What the repository's crumb says and reaches: its name, its owner's picture, and its default branch. */
interface RepositoryCrumbDoors {
  /** Says a repository as the sidebar's header does: its name, or `owner/name` where another shares the name. */
  readonly label: (repository: string) => string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  readonly pictures: boolean;
  /** Reads the repositories the plan's workspace reaches, which say each one's default branch. */
  readonly read: () => Promise<TasksRepositoriesAnswer>;
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
function defaultBranchOf(answer: TasksRepositoriesAnswer, repository: string): string | null {
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
        <span className="plan-crumb-name">{doors.label(repository)}</span>
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
  created,
  doors,
}: {
  workspace: Workspace;
  /** The repository the plan is about, `owner/name`, or none. */
  repository: string | null;
  archived: boolean;
  /** Who created the task and when, as the list names them; none where it names nobody. */
  created?: Pick<TaskSummary, "createdBy" | "ownerId" | "createdAt"> | undefined;
  doors: PlanCrumbDoors;
}): React.JSX.Element {
  const { members, readerId } = useMemberDirectory();
  const creation = useCreation(created);
  const count = editorsOf(workspace, members);
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
        // The separator and the repository wrap as one, so a narrow column never leaves the separator alone on a line.
        <span className="plan-crumb-step">
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
        </span>
      )}
      {count === undefined ? null : (
        <People
          workspace={workspace}
          members={members}
          count={count}
          archived={archived}
          readerId={readerId}
          creation={creation}
        />
      )}
    </nav>
  );
}
