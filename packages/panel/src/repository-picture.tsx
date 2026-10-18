import { repositoryOwnerPictureUrl } from "@luke/ui/tasks-model";
import { useState } from "react";

/**
 * repository-picture.tsx -- a repository drawn as its owner's picture on GitHub, wherever a repository is named or picked.
 *
 * The owner's picture, an organization's logo or a person's avatar, is how
 * GitHub itself and every devtool beside it tells repositories apart at a
 * glance, so a repository's name is led by it: the sidebar's headers, the
 * repository chip and the rows of its menu, a task's row naming its
 * repository. A menu's action that opens GitHub keeps GitHub's mark, since
 * it is about GitHub rather than the repository. The picture is sized by
 * the glyph slot it stands in, as a glyph is. Where there is no picture to
 * draw, the slot holds the fallback the caller names: where it fails to
 * load, and in a fixture run, whose frames ask nothing of the network. A
 * picture that fails is remembered by its address for as long as this one
 * stands, so another repository gets its own chance. It loads lazily, so a
 * menu of a thousand repositories asks for the few rows in sight rather than
 * every row it holds, and the rest as they scroll in.
 */
export function RepositoryPicture({
  repository,
  pictures,
  fallback,
}: {
  /** The repository, `owner/name`. */
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  /** What stands in the picture's place where there is none to draw. */
  fallback: React.ReactNode;
}): React.ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const url = pictures ? repositoryOwnerPictureUrl(repository) : undefined;
  if (url === undefined || url === failedUrl) return fallback;
  return (
    <img
      className="repository-picture"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(url)}
    />
  );
}
