import { LIVE_READ } from "@repo/features/live-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "@repo/ui";
import { useHostRead } from "../use-host-read.js";

/**
 * workspace-tile.tsx -- a workspace's mark: its photo, its owner's picture on a personal one, or the first letter of its name on a square of one of six hues.
 *
 * The square says a workspace is a team, as GitHub draws an organization
 * square and a person round. A photo an owner or admin uploaded stands first:
 * the list names only its version, and the host fetches its bytes once per
 * version and holds them for every window (`LIVE_READ.WORKSPACE_PHOTOS`), so
 * the tile draws the one held at the version the list names.
 * The account's own first workspace with no photo shows the account's
 * sign-in picture, which the list carries as an address. Until either loads,
 * and where one fails to, the tile draws its letter. A picture that loaded
 * replaces the letter and its hue rather than covering them, so a photo
 * with a transparent ground sits on the surface around the tile, in the light
 * and the dark alike. The hue is read off the
 * workspace's id rather than its name, so a rename keeps the mark the members
 * know it by, and two workspaces of one name still read apart more often than
 * not. The letter is the tile's own text, the name's first character as a
 * reader sees it, an emoji's whole, because text is what session replay masks
 * (`session-replay.ts`), as it masks an image's address. It is an `@repo/ui` Avatar tile. The tile is hidden
 * from a screen reader, since the row beside it already says the name.
 */

/** The tile's sizes: a line of words', a row's glyph, a mark a step smaller under a row, or the sidebar's head and Settings › Workspace's first row. */
export const TILE_SIZE = {
  INLINE: "inline",
  ROW: "row",
  HEAD: "head",
  NESTED: "nested",
} as const;

type TileSize = (typeof TILE_SIZE)[keyof typeof TILE_SIZE];

/** The avatar size each tile size is drawn at. */
const AVATAR_OF = {
  [TILE_SIZE.INLINE]: AVATAR_SIZE.MARK,
  [TILE_SIZE.ROW]: AVATAR_SIZE.INLINE,
  [TILE_SIZE.HEAD]: AVATAR_SIZE.CARD,
  [TILE_SIZE.NESTED]: AVATAR_SIZE.STACK,
} as const satisfies Record<TileSize, (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE]>;

/** The workspace's photo as a `data:` URL, as the host holds it at the version the list names; nothing where it has none, while it loads, or where it could not be read. */
function useWorkspacePhoto(workspaceId: string, version: string | undefined): string | undefined {
  const { rows } = useHostRead(
    LIVE_READ.WORKSPACE_PHOTOS,
    version === undefined ? undefined : workspaceId,
  );
  return rows?.version === version ? rows?.url : undefined;
}

/** A workspace's tile, at a row's glyph size unless said otherwise. */
export function WorkspaceTile({
  workspace,
  size = TILE_SIZE.ROW,
}: {
  workspace: Pick<Workspace, "id" | "name" | "photoVersion" | "pictureUrl">;
  size?: TileSize;
}): React.JSX.Element {
  const photo = useWorkspacePhoto(workspace.id, workspace.photoVersion);
  const url = workspace.photoVersion === undefined ? workspace.pictureUrl : photo;
  // Note that the letter and its hue stand until the picture has loaded, because an avatar on the network may take a while, and go once it has, because a transparent photo would show them through.
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
