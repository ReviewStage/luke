import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AUTOMATION_SCOPE, type AutomationScope } from "@repo/features/automation-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACTOR_KIND, accountActor, SOMEONE_REASON } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

/**
 * automation-owner.tsx -- who owns an automation, drawn by picture: the workspace's photo for the workspace's, the account's own sign-in picture for its own personal one.
 *
 * The Owner picker and the list's Owner column draw an owner the same way
 * the workspace switcher and Settings' heir picker draw a workspace and a
 * person, so a personal automation reads as its maker's and a workspace's
 * as everyone's. A personal one the account did not make, which an owner
 * or admin may see, stands on the quiet outline of someone unnamed, since
 * the list does not say whose it is.
 */

/** How large an owner is drawn: in a line beside its name, or as a menu row's mark. */
export const OWNER_MARK_SIZE = {
  INLINE: "inline",
  ROW: "row",
} as const;

type OwnerMarkSize = (typeof OWNER_MARK_SIZE)[keyof typeof OWNER_MARK_SIZE];

/** An owner's picture: the workspace's tile, the account's own picture, or someone unnamed. */
export function OwnerMark({
  owner,
  workspace,
  mine,
  size,
}: {
  owner: AutomationScope;
  workspace: Workspace | undefined;
  /** Whether the reading account made it, so a personal one is drawn as its own; a service that does not say is not taken as saying so. */
  mine: boolean;
  size: OwnerMarkSize;
}): React.JSX.Element | null {
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  if (owner === AUTOMATION_SCOPE.WORKSPACE) {
    if (workspace === undefined) return null;
    return (
      <WorkspaceTile
        workspace={workspace}
        size={size === OWNER_MARK_SIZE.INLINE ? TILE_SIZE.INLINE : TILE_SIZE.ROW}
      />
    );
  }
  const actorSize = size === OWNER_MARK_SIZE.INLINE ? ACTOR_SIZE.INLINE : ACTOR_SIZE.ROW;
  if (mine && account?.status === ACCOUNT_STATUS.SIGNED_IN) {
    return <ActorMark actor={accountActor(account)} size={actorSize} />;
  }
  return (
    <ActorMark
      actor={{ kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED }}
      size={actorSize}
    />
  );
}
