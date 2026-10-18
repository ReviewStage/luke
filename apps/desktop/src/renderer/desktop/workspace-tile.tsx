import type { TasksWorkspacePhotoAnswer } from "@luke/features/tasks-view";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { identityHue, identityLetter } from "@luke/ui/actor-model";
import { useEffect, useReducer, useState } from "react";

/**
 * workspace-tile.tsx -- a workspace's mark: its photo, its owner's picture on a personal one, or the first letter of its name on a square of one of six hues.
 *
 * The square says a workspace is a team, as GitHub draws an organization
 * square and a person round. A photo an owner or admin uploaded stands first:
 * the list names only its version, so the tile reads its bytes through the
 * host once per workspace and version, and keeps them for the window's life.
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
 * (`session-replay.ts`), as it masks an image's address. The tile is hidden
 * from a screen reader, since the row beside it already says the name.
 */

/** A photo read or being read: the read every tile asking for it shares, and its `data:` URL once it landed. */
interface KeptPhoto {
  readonly read: Promise<string | undefined>;
  url?: string;
}

/**
 * The photos this window read, by workspace and then by version. Note that
 * a workspace keeps only the version asked for last, because an older one
 * stands for a photo the workspace no longer shows, and that a read which
 * did not land is not kept, so the next tile to ask reads it again.
 */
const keptPhotos = new Map<string, Map<string, KeptPhoto>>();

/** The tile's sizes: a line of words', a row's glyph, or the sidebar's head and Settings › Workspace's first row. */
export const TILE_SIZE = {
  INLINE: "inline",
  ROW: "row",
  HEAD: "head",
} as const;

type TileSize = (typeof TILE_SIZE)[keyof typeof TILE_SIZE];

/** The workspace's photo at this version, read through `read` the first time any tile asks and shared after. */
function keptPhoto(
  workspaceId: string,
  version: string,
  read: () => Promise<TasksWorkspacePhotoAnswer>,
): KeptPhoto {
  const versions = keptPhotos.get(workspaceId) ?? new Map<string, KeptPhoto>();
  keptPhotos.set(workspaceId, versions);
  const standing = versions.get(version);
  if (standing !== undefined) return standing;
  versions.clear();
  const kept: KeptPhoto = {
    read: read()
      .then(
        (answer) =>
          "failure" in answer ? undefined : `data:${answer.contentType};base64,${answer.base64}`,
        () => undefined,
      )
      .then((url) => {
        // Note that a failure lets go only of its own read, because the version may have been asked for again since.
        if (url === undefined) {
          if (versions.get(version) === kept) versions.delete(version);
        } else kept.url = url;
        return url;
      }),
  };
  versions.set(version, kept);
  return kept;
}

/** The workspace's photo as a `data:` URL once it is read; nothing where it has none, while it loads, or where it could not be read. */
function useWorkspacePhoto(workspaceId: string, version: string | undefined): string | undefined {
  const { act } = useAct();
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (version === undefined) return;
    let standing = true;
    const kept = keptPhoto(workspaceId, version, () =>
      act(ACT_KIND.WORKSPACE_PHOTO_READ, { workspaceId }),
    );
    kept.read.then((url) => {
      if (standing && url !== undefined) redraw();
    });
    return () => {
      standing = false;
    };
  }, [act, workspaceId, version]);
  return version === undefined ? undefined : keptPhotos.get(workspaceId)?.get(version)?.url;
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
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
  const url = workspace.photoVersion === undefined ? workspace.pictureUrl : photo;
  const drawn = url !== undefined && url !== failedUrl ? url : undefined;
  const shown = drawn !== undefined && drawn === loadedUrl;
  // Note that the letter and its hue stand until the picture has loaded, because an avatar on the network may take a while, and go once it has, because a transparent photo would show them through.
  return (
    <span
      className="workspace-tile"
      data-size={size}
      data-hue={shown ? undefined : identityHue(workspace.id)}
      aria-hidden="true"
    >
      {shown ? null : identityLetter(workspace.name)}
      {drawn === undefined ? null : (
        <img
          className="workspace-tile-picture"
          data-loaded={String(shown)}
          src={drawn}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoadedUrl(drawn)}
          onError={() => setFailedUrl(drawn)}
        />
      )}
    </span>
  );
}
