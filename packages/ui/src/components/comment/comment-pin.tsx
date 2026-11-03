import type { ReactNode } from "react";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { Tooltip } from "../tooltip/hint.js";
import type { CommentAuthor } from "./comment.js";

/**
 * comment-pin.tsx -- comments pinned to what they are on, as a design tool pins them: a speech bubble whose pointed corner touches it, wearing the face of who started its first thread, and a count where more than one thread stands there.
 *
 * It is the comments' own marker, as small as the plan's folded count, a
 * line's face over the menus' raised surface, so it reads as the plan's
 * comments do wherever it stands over something the owner drew; on a touch
 * screen its press takes a finger's target around it, as a text press's
 * does, while it stays drawn as small. Its owner stands it where the
 * bubble's pointed corner, its upper end corner, touches the top start corner
 * of what it is on, so it stands beside what it is on, level with its first
 * line, rather than by what comes before it; or, where there is no room
 * beside it, inside that corner, its upper start corner the point. It hears
 * the pointer over it, which the owner answers by
 * marking what the pin is on. Over it, the pointer is told the first
 * comment by its writer and its first line, in a hint's card; a finger has
 * no pointer over it, so its press opens the comments at once, which say
 * the same and more. The count is a picture of the number its name says, so
 * it is hidden from a reader.
 */

/**
 * Where a pin stands by the corner it touches: beside what it is on, its
 * upper end corner the point, or inside it, its upper start corner the
 * point, where there is no room beside it.
 */
export const COMMENT_PIN_STANDS = {
  BESIDE: "beside",
  INSIDE: "inside",
} as const;

export type CommentPinStands = (typeof COMMENT_PIN_STANDS)[keyof typeof COMMENT_PIN_STANDS];

/** The corner each stand makes its point. */
const POINT = {
  [COMMENT_PIN_STANDS.BESIDE]: "rounded-tr-none",
  [COMMENT_PIN_STANDS.INSIDE]: "rounded-tl-none",
} as const satisfies Record<CommentPinStands, string>;

/** Whether a node draws anything: none, null, and a boolean, as a condition leaves it, draw nothing. */
function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

/** A pin of the comments on one thing, `count` threads of them, the first started by `author`. */
export function CommentPin({
  author,
  count,
  label,
  preview,
  open,
  stands = COMMENT_PIN_STANDS.BESIDE,
  onPress,
  onHover,
}: {
  /** Who started the first thread, whose face the pin wears. */
  author: CommentAuthor;
  /** How many threads stand on what it is pinned to; drawn only past one. */
  count: number;
  /** The pin's name, which says how many comments it opens. */
  label: string;
  /** The first comment as the pointer over the pin is told it: its writer and its first line. */
  preview: ReactNode;
  /** Whether its comments are open. */
  open: boolean;
  /** Where it stands by the corner it touches; beside what it is on unless told. */
  stands?: CommentPinStands | undefined;
  onPress: () => void;
  /** Told the pointer or the focus came onto the pin, and went. */
  onHover: (over: boolean) => void;
}): React.JSX.Element {
  // Note that a glyph drawn conditionally may arrive as nothing to draw, which is no glyph, so the letter still stands.
  const glyph = drawsSomething(author.glyph) ? author.glyph : undefined;
  return (
    <Tooltip label={label} card={preview}>
      <button
        type="button"
        className={`luke-comment-pin inline-flex cursor-press items-center gap-luke-2 rounded-luke-full ${POINT[stands]} border border-border bg-popover p-luke-4 text-caption text-foreground shadow-menu aria-expanded:shadow-menu-open-edge pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:w-[max(100%,var(--luke-touch-target))] pointer-coarse:before:h-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']`}
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
          <span className="luke-comment-pin-count pe-luke-2 tabular-nums" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
