import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AUTOMATION_SCOPE, type AutomationScope } from "@repo/features/automation-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACTOR_KIND, accountActor, SOMEONE_REASON } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { TILE_SIZE, WorkspaceTile } from "./workspace-tile.js";

export const OWNER_MARK_SIZE = {
  INLINE: "inline",
  ROW: "row",
} as const;

type OwnerMarkSize = (typeof OWNER_MARK_SIZE)[keyof typeof OWNER_MARK_SIZE];

export function OwnerMark({
  owner,
  workspace,
  mine,
  size,
}: {
  owner: AutomationScope;
  workspace: Workspace | undefined;
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
