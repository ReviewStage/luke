import type { ReactNode } from "react";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Tooltip } from "../tooltip/hint.js";
import type { CommentAuthor } from "./comment.js";

export const COMMENT_PIN_STANDS = {
  BESIDE: "beside",
  INSIDE: "inside",
} as const;

export type CommentPinStands = (typeof COMMENT_PIN_STANDS)[keyof typeof COMMENT_PIN_STANDS];

export const COMMENT_PIN_LOOK = {
  POSTED: "posted",
  HELD: "held",
} as const;

export type CommentPinLook = (typeof COMMENT_PIN_LOOK)[keyof typeof COMMENT_PIN_LOOK];

const EDGE = {
  [COMMENT_PIN_LOOK.POSTED]: "border-border",
  [COMMENT_PIN_LOOK.HELD]: "border-dashed border-accent-fill",
} as const satisfies Record<CommentPinLook, string>;

const POINT = {
  [COMMENT_PIN_STANDS.BESIDE]: "rounded-tr-none",
  [COMMENT_PIN_STANDS.INSIDE]: "rounded-tl-none",
} as const satisfies Record<CommentPinStands, string>;

function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

export function CommentPin({
  author,
  count,
  label,
  preview,
  open,
  stands = COMMENT_PIN_STANDS.BESIDE,
  look = COMMENT_PIN_LOOK.POSTED,
  onPress,
  onHover,
}: {
  author: CommentAuthor;
  count: number;
  label: string;
  preview: ReactNode;
  open: boolean;
  stands?: CommentPinStands | undefined;
  look?: CommentPinLook | undefined;
  onPress: () => void;
  onHover: (over: boolean) => void;
}): React.JSX.Element {
  const glyph = drawsSomething(author.glyph) ? author.glyph : undefined;
  return (
    <Tooltip label={label} card={preview}>
      <button
        type="button"
        className={`ui-comment-pin inline-flex cursor-press items-center gap-ui-2 rounded-ui-full ${POINT[stands]} border ${EDGE[look]} bg-popover p-ui-4 text-caption text-foreground shadow-menu aria-expanded:shadow-menu-open-edge pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:w-[max(100%,var(--ui-touch-target))] pointer-coarse:before:h-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']`}
        aria-label={label}
        aria-expanded={open}
        onClick={onPress}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        <Avatar
          name={author.name}
          {...(author.id === undefined ? {} : { id: author.id })}
          src={author.picture}
          shape={author.shape ?? AVATAR_SHAPE.CIRCLE}
          glyph={glyph}
          tiled={glyph !== undefined}
          size={AVATAR_SIZE.INLINE}
          decorative
        />
        {count > 1 ? (
          <span className="ui-comment-pin-count pe-ui-2 tabular-nums" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
