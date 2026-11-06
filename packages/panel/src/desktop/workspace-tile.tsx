import type { Workspace } from "@repo/features/workspace-wire";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { workspacePhotoQuery } from "../live-reads.js";

export const TILE_SIZE = {
  INLINE: "inline",
  ROW: "row",
  SIDEBAR: "sidebar",
  HEAD: "head",
  NESTED: "nested",
} as const;

type TileSize = (typeof TILE_SIZE)[keyof typeof TILE_SIZE];

const AVATAR_OF = {
  [TILE_SIZE.INLINE]: AVATAR_SIZE.MARK,
  [TILE_SIZE.ROW]: AVATAR_SIZE.INLINE,
  [TILE_SIZE.SIDEBAR]: AVATAR_SIZE.ROW,
  [TILE_SIZE.HEAD]: AVATAR_SIZE.CARD,
  [TILE_SIZE.NESTED]: AVATAR_SIZE.STACK,
} as const satisfies Record<TileSize, (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE]>;

function useWorkspacePhoto(workspaceId: string, version: string | undefined): string | undefined {
  const rows = useQuery(workspacePhotoQuery(version === undefined ? undefined : workspaceId)).data;
  return rows?.version === version ? rows?.url : undefined;
}

export function useWorkspaceTileUrl(
  workspace: Pick<Workspace, "id" | "photoVersion" | "pictureUrl">,
): string | undefined {
  const photo = useWorkspacePhoto(workspace.id, workspace.photoVersion);
  return workspace.photoVersion === undefined ? workspace.pictureUrl : photo;
}

export function WorkspaceTile({
  workspace,
  size = TILE_SIZE.ROW,
}: {
  workspace: Pick<Workspace, "id" | "name" | "photoVersion" | "pictureUrl">;
  size?: TileSize;
}): React.JSX.Element {
  const url = useWorkspaceTileUrl(workspace);
  return (
    <Avatar
      name={workspace.name}
      id={workspace.id}
      src={url}
      size={AVATAR_OF[size]}
      shape={AVATAR_SHAPE.TILE}
      decorative
    />
  );
}
