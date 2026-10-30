import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar, type AvatarShape } from "../avatar/avatar.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TIME_LOOK, Time } from "../time/time.js";

/**
 * comment.tsx -- one comment: its writer's face, their name, when they wrote it, what stands at the line's end, and what they wrote under it.
 *
 * Every thread draws its comments this way, an Inbox item's, a plan's, and
 * a review's, so a face stands the same size, a name in the
 * same weight, and a time in the same words wherever a comment is read. The
 * face is the writer's picture, or their letter on their hue until it loads
 * or where there is none, at a row's size on the head's line, and an
 * agent's or an app's glyph on a quiet tile; the name is
 * the label role's, as the caller's name helper says it (`actorName`,
 * `agentName`), on one line cut where the head runs out of room, and
 * after it, in the muted ink, what the writer did where the comment is a
 * line of what happened to its thread (`said`, "resolved this"); the time
 * is `Time`'s age in the caption role, a step quieter, its moment in full
 * on hover; and the trailing slot holds the line's end, its actions or a
 * status, against the head's far edge. What they wrote stands under the
 * name, on the name's column, in the body role.
 *
 * The face is said once: the name beside it already names the writer, so
 * the disc is decorative to a reader. A name that does more than name, a
 * chip hanging the writer's card, is the caller's (`nameRef`), drawn in
 * the name's place in the same role.
 *
 * While a list of comments is read, each stands as its skeleton
 * (`CommentSkeleton`): the face's disc, a block where the name will be, and
 * a block for each line of the words, in the same cells, so the list does
 * not move when the comments land.
 */

/** The element a comment stands in: a box of its own, or a row of a thread's list. */
export const COMMENT_ELEMENT = {
  DIV: "div",
  LI: "li",
} as const;

export type CommentElement = (typeof COMMENT_ELEMENT)[keyof typeof COMMENT_ELEMENT];

/** Who wrote a comment, as their face draws them. */
export interface CommentAuthor {
  /** Their name, as the caller's person or agent name helper says it. */
  readonly name: string;
  /** What their hue is read off, so a rename keeps the colour they are known by. */
  readonly id?: string | undefined;
  /** Their picture's address; none stands their letter on their hue. */
  readonly picture?: string | undefined;
  /** A person's circle, or an agent's or an app's square. */
  readonly shape?: AvatarShape | undefined;
  /** What stands on a square in place of the letter: an agent's or an app's glyph. */
  readonly glyph?: ReactNode;
}

/** The comment's frame: a face column beside the name's, the head on the first line and the words under it. */
const FRAME = "luke-comment grid grid-cols-[auto_minmax(0,1fr)] gap-x-icon-gap gap-y-tight-gap";

/** How wide a skeleton's face stands: a row's disc, as `Comment` draws the face. */
const SKELETON_FACE = "var(--spacing-avatar-row)";
const FACE = "luke-comment-face col-start-1 row-start-1 inline-flex self-center";
const HEAD =
  "luke-comment-head col-start-2 row-start-1 flex min-w-0 items-baseline gap-icon-gap text-label";
const NAME = "luke-comment-name min-w-0";
const SAID = "luke-comment-said flex-none whitespace-pre font-luke-regular text-muted-foreground";
const TIME = "luke-comment-time flex-none";
// Note that the trailing slot is the head's line tall, its controls centred on it and standing over its edges, because a control's height would push every comment's words down by a different amount.
const TRAILING =
  "luke-comment-trailing ms-auto inline-flex h-lh flex-none items-center gap-control-gap self-start";
const BODY = "luke-comment-body col-start-2 row-start-2 min-w-0 text-body";

/** Whether a node draws anything: none, null, and a boolean, as a condition leaves it, draw nothing. */
function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

/**
 * The comment's frame, the element it stands in, holding its cells.
 * Note that the element is made rather than written, because a ref typed
 * for either element is no ref for their union.
 */
function Frame({
  as: Element,
  ref,
  children,
  ...attributes
}: {
  as: CommentElement;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">): React.JSX.Element {
  return createElement(Element, { ...attributes, ref, className: FRAME }, children);
}

/** The face's cell. */
function FaceCell({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={FACE}>{children}</span>;
}

/** The head's line: the name, the time, and the trailing slot. */
function HeadLine({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={HEAD}>{children}</div>;
}

/** What was written, on the name's column. */
function BodyCell({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={BODY}>{children}</div>;
}

/** One comment by `author`, written `at`, with `trailing` at its head's end and `children` under it. */
export function Comment({
  author,
  nameRef,
  said,
  at,
  now,
  trailing,
  as: Element = COMMENT_ELEMENT.DIV,
  ref,
  children,
  ...attributes
}: {
  author: CommentAuthor;
  /** The name drawn as the caller's own ref, a chip that hangs the writer's card, in place of `author.name`'s words. */
  nameRef?: ReactNode;
  /** What the writer did, said after their name, for a line of what happened to a thread: "resolved this". */
  said?: string | undefined;
  /** When it was written; none for a draft not yet sent. */
  at?: number | undefined;
  /** What its age counts from; none counts from the window's minute. */
  now?: number | undefined;
  /** What stands at the head's end: the comment's actions, or a status. */
  trailing?: ReactNode;
  as?: CommentElement;
  /** The element, for an owner that scrolls to it or rings it where a link lands. */
  ref?: Ref<HTMLElement> | undefined;
  /** What they wrote. */
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">): React.JSX.Element {
  // Note that a glyph drawn conditionally may arrive as nothing to draw, which is no glyph, so the letter still stands.
  const glyph = drawsSomething(author.glyph) ? author.glyph : undefined;
  return (
    <Frame as={Element} ref={ref} {...attributes}>
      <FaceCell>
        <Avatar
          name={author.name}
          {...(author.id === undefined ? {} : { id: author.id })}
          src={author.picture}
          shape={author.shape ?? AVATAR_SHAPE.CIRCLE}
          glyph={glyph}
          tiled={glyph !== undefined}
          size={AVATAR_SIZE.ROW}
          decorative
        />
      </FaceCell>
      <HeadLine>
        <Text className={NAME} variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN} truncate>
          {nameRef ?? author.name}
          {said === undefined ? null : <span className={SAID}>{` ${said}`}</span>}
        </Text>
        {at === undefined ? null : (
          <Text
            className={TIME}
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.MUTED}
            as={TEXT_ELEMENT.SPAN}
          >
            <Time at={at} now={now} look={TIME_LOOK.SINCE} />
          </Text>
        )}
        {trailing === undefined ? null : <span className={TRAILING}>{trailing}</span>}
      </HeadLine>
      {children === undefined ? null : <BodyCell>{children}</BodyCell>}
    </Frame>
  );
}

/** One line of a comment's words while it is read, as wide as the share of the line it is given. */
export interface CommentSkeletonLine {
  /** What tells the line from its neighbours, as a list's key. */
  readonly key: string;
  readonly width: string;
}

/** A comment while it is read: its face's disc, a block `name` wide where the name will stand, and its words' `lines`. */
export function CommentSkeleton({
  name,
  lines,
}: {
  name: string;
  lines: readonly CommentSkeletonLine[];
}): React.JSX.Element {
  return (
    <Frame as={COMMENT_ELEMENT.DIV}>
      <FaceCell>
        <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_FACE} />
      </FaceCell>
      <HeadLine>
        <Skeleton width={name} />
      </HeadLine>
      <BodyCell>
        {lines.map((line) => (
          <Skeleton key={line.key} width={line.width} />
        ))}
      </BodyCell>
    </Frame>
  );
}
