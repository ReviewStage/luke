import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@luke/settings/settings-views";
import { ChevronRightIcon, LockIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile";
import { CardHead, CardNote, CardRule, HoverCard } from "../hover-card";
import { useOpenSettings } from "../open-settings";
import { PersonAvatar } from "../person-avatar";
import { ROLE_WORDS } from "../settings/workspace-page";
import { Tooltip } from "../tooltip";

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
 * members in Settings. The members are read once per workspace the crumb
 * stands in; until they answer, or if they never do, the count stands
 * alone, from the workspace's own count.
 */

/** How many faces the crumb's end draws before the count says the rest. */
const FACES_DRAWN = 4;

/** A workspace's members as the crumb holds them: read, or not (yet). */
function useWorkspaceMembers(workspaceId: string): readonly WorkspaceMember[] | undefined {
  const { act } = useAct();
  const [read, setRead] = useState<{
    workspaceId: string;
    members: readonly WorkspaceMember[];
  }>();
  useEffect(() => {
    let live = true;
    act(ACT_KIND.WORKSPACE_MEMBERS_READ, { workspaceId }).then(
      (members) => {
        if (live) setRead({ workspaceId, members });
      },
      // Note that a refused read leaves the count alone, because the crumb says where the plan is either way.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId]);
  return read?.workspaceId === workspaceId ? read.members : undefined;
}

/** Who can edit, as the crumb's end and its card say it: the members counted, else the workspace's own count. */
function editorsOf(workspace: Workspace, members: readonly WorkspaceMember[] | undefined): number {
  return members?.length ?? workspace.memberCount ?? 1;
}

/** The card hung from the crumb's end: everyone who can edit, by name and role. */
function PeopleCard({
  workspace,
  members,
}: {
  workspace: Workspace;
  members: readonly WorkspaceMember[] | undefined;
}): React.JSX.Element {
  const count = editorsOf(workspace, members);
  const only = count <= 1;
  return (
    <HoverCard data-people-card="">
      <CardHead
        glyph={<WorkspaceTile workspace={workspace} />}
        name={only ? "Only you" : `Everyone in ${workspace.name}`}
        sub={only ? `${workspace.name} has no other members` : `${count} members`}
      />
      <CardNote>
        {only
          ? "Invite someone to this workspace and they can read and edit its plans."
          : "Each can read and edit this plan, join its calls, and message its agents."}
      </CardNote>
      {only || members === undefined ? null : (
        <>
          <CardRule />
          <ul className="plan-crumb-people-list">
            {members.map((member) => (
              <li key={member.userId}>
                <PersonAvatar name={member.name} pictureUrl={undefined} />
                <span className="plan-crumb-person">{member.name}</span>
                <span className="plan-crumb-role">{ROLE_WORDS[member.role]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </HoverCard>
  );
}

/** The crumb over a plan's title: its workspace, its repository, and who can edit it. */
export function PlanCrumb({
  workspace,
  repository,
}: {
  workspace: Workspace;
  /** The repository the plan is about, `owner/name`, or none. */
  repository: string | null;
}): React.JSX.Element {
  const openSettings = useOpenSettings();
  const members = useWorkspaceMembers(workspace.id);
  const count = editorsOf(workspace, members);
  const only = count <= 1;
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
      <Tooltip
        label={only ? "Only you" : `Everyone in ${workspace.name}`}
        card={<PeopleCard workspace={workspace} members={members} />}
      >
        <button
          type="button"
          className="plan-crumb-people"
          onClick={() => openSettings({ ...page, section: SETTINGS_SECTION.MEMBERS })}
        >
          {only ? (
            <>
              <LockIcon aria-hidden="true" />
              Only you
            </>
          ) : (
            <>
              {members === undefined ? null : (
                <span className="plan-crumb-faces" aria-hidden="true">
                  {members.slice(0, FACES_DRAWN).map((member) => (
                    <PersonAvatar key={member.userId} name={member.name} pictureUrl={undefined} />
                  ))}
                </span>
              )}
              {`${count} can edit`}
            </>
          )}
        </button>
      </Tooltip>
    </nav>
  );
}
