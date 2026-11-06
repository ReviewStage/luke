import { Fragment, useState } from "react";
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

const TOKEN_LABEL = "Token";

const PRIMARY_LABEL = "Primary";

export interface RepositoryRowMarks {
  readonly token?: boolean | undefined;
  readonly primary?: boolean | undefined;
}

export function RepositoryPicture({
  repository,
  pictures,
  size = AVATAR_SIZE.INLINE,
}: {
  repository: string;
  pictures: boolean;
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

export function NoRepositoryGlyph(): React.JSX.Element {
  return <FolderXIcon />;
}

export function RepositoryName({
  repository,
  label,
  pictures,
}: {
  repository: string | null;
  label?: string | undefined;
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

export function RepositoryCard({
  repository,
  pictures,
}: {
  repository: string;
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

export function repositoryMenuRow(
  repository: string,
  pictures: boolean,
  marks: RepositoryRowMarks = {},
): MenuRow {
  const { owner, name } = repositoryParts(repository);
  const badges = [
    ...(marks.token === true ? [TOKEN_LABEL] : []),
    ...(marks.primary === true ? [PRIMARY_LABEL] : []),
  ];
  return {
    id: repository,
    label: name,
    detail:
      badges.length === 0 ? (
        owner
      ) : (
        <>
          {owner}
          {badges.map((badge) => (
            <Fragment key={badge}>
              {" "}
              <Badge>{badge}</Badge>
            </Fragment>
          ))}
        </>
      ),
    terms: [repository],
    icon: <RepositoryPicture repository={repository} pictures={pictures} />,
  };
}
