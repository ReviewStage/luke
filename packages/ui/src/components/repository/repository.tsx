import { useState } from "react";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { FolderXIcon, GLYPH } from "../../icons/icons.js";
import { NO_REPOSITORY, repositoryParts } from "../../task-list-model.js";
import { repositoryOwnerPictureUrl } from "../../tasks-model.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar, type AvatarSize } from "../avatar/avatar.js";
import { Badge } from "../badge/badge.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { HoverCard, HoverCardHead } from "../hover-card/hover-card.js";
import { OneLine } from "../one-line/one-line.js";
import type { MenuRow } from "../searchable-menu/searchable-menu.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * repository.tsx -- a GitHub repository as every surface draws it: its owner's picture, then its name.
 *
 * The owner's picture, an organization's logo or a person's avatar, is how
 * GitHub itself and every devtool beside it tells repositories apart at a
 * glance, so a repository's name is led by it wherever one is named: the
 * sidebar's and the Tasks page's headers and rows, a board's card, the
 * repository chip and the rows of its menu, a task's card, Settings. The
 * words are the repository's name alone, unless another repository the same
 * view names shares it, where they are `owner/name` (`repositoryLabel`); the
 * hover names it whole, through the tooltip or the card of whatever holds it.
 * Where one repository is being set, the composer's chip and the task's
 * path, the words are its whole `owner/name`, the picture before them. No
 * repository is one state, a crossed-out folder and "No repository", and a
 * picture that cannot be drawn is the repository's own glyph.
 *
 * Prose is the exception and keeps `owner/name` as plain words: a sentence,
 * a pull request's key, a file's path, an admin table's cell.
 */

/** The mark beside a repository the developer's own GitHub token reaches rather than the App. */
const TOKEN_LABEL = "Token";

/**
 * A repository's owner's picture, a tile of `Avatar`, edged, blank until it
 * has loaded, sized by the glyph slot it stands in. Where there is no
 * picture to draw, the repository's own glyph stands in its place: where it
 * fails to load, and in a fixture run, whose frames ask nothing of the
 * network. A picture that fails is remembered by its address for as long as
 * this one stands, so another repository gets its own chance. It loads
 * lazily, so a menu of a thousand repositories asks for the few rows in
 * sight rather than every row it holds.
 */
export function RepositoryPicture({
  repository,
  pictures,
  size = AVATAR_SIZE.INLINE,
}: {
  /** The repository, `owner/name`. */
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  /** The tile's size, the glyph slot's it stands in. */
  size?: AvatarSize;
}): React.ReactNode {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const url = pictures ? repositoryOwnerPictureUrl(repository) : undefined;
  if (url === undefined || url === failedUrl) return <GLYPH.REPOSITORY />;
  return (
    <Avatar
      name=""
      src={url}
      size={size}
      shape={AVATAR_SHAPE.TILE}
      decorative
      edged
      blank
      lazy
      onFail={() => setFailedUrl(url)}
    />
  );
}

/** The mark of a place that names no repository, a crossed-out folder. */
export function NoRepositoryGlyph(): React.JSX.Element {
  return <FolderXIcon />;
}

/**
 * A repository named in a line: its owner's picture in a glyph's slot, then
 * its words, cut short where the line ends, the whole `owner/name` hung over
 * them on hover; or, for none, the crossed-out folder and "No repository".
 */
export function RepositoryName({
  repository,
  label,
  pictures,
}: {
  /** The repository, `owner/name`, or none. */
  repository: string | null;
  /** The words the view says for it (`repositoryLabel`): its name alone where none is given. */
  label?: string | undefined;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const words = repository === null ? NO_REPOSITORY : (label ?? repositoryParts(repository).name);
  return (
    <span className="ui-repository-name inline-flex min-w-0 items-center gap-icon-gap">
      <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.MEDIUM}>
        {repository === null ? (
          <NoRepositoryGlyph />
        ) : (
          <RepositoryPicture repository={repository} pictures={pictures} />
        )}
      </GlyphSlot>
      <OneLine
        hint={
          repository === null
            ? undefined
            : (line, clipped) => (
                <Tooltip label={clipped || words !== repository ? repository : undefined}>
                  {line}
                </Tooltip>
              )
        }
      >
        {words}
      </OneLine>
    </span>
  );
}

/** A repository's card: its owner's picture and its name, and its owner under the name. */
export function RepositoryCard({
  repository,
  pictures,
}: {
  /** The repository, `owner/name`. */
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
}): React.JSX.Element {
  const { owner, name } = repositoryParts(repository);
  return (
    <HoverCard data-repository-card="">
      <HoverCardHead
        glyph={
          <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.GLYPH} />
        }
        name={name}
        sub={owner}
      />
    </HoverCard>
  );
}

/**
 * A repository's row in a searched menu or a picker: its owner's picture,
 * its name, its owner muted after it, since the owner is the part rows most
 * often share and a narrow menu cuts the end of a row, and, where the
 * developer's own GitHub token reaches it rather than the App, the Token
 * mark; found by its whole `owner/name` all the same.
 */
export function repositoryMenuRow(repository: string, pictures: boolean, token = false): MenuRow {
  const { owner, name } = repositoryParts(repository);
  return {
    id: repository,
    label: name,
    detail: token ? (
      <>
        {owner} <Badge>{TOKEN_LABEL}</Badge>
      </>
    ) : (
      owner
    ),
    terms: [repository],
    icon: <RepositoryPicture repository={repository} pictures={pictures} />,
  };
}
