import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar, type AvatarShape } from "../avatar/avatar.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { TIME_LOOK, Time } from "../time/time.js";

export const COMMENT_ELEMENT = {
  DIV: "div",
  LI: "li",
} as const;

export type CommentElement = (typeof COMMENT_ELEMENT)[keyof typeof COMMENT_ELEMENT];

export interface CommentAuthor {
  readonly name: string;
  readonly id?: string | undefined;
  readonly picture?: string | undefined;
  readonly shape?: AvatarShape | undefined;
  readonly glyph?: ReactNode;
}

const FRAME = "ui-comment grid grid-cols-[auto_minmax(0,1fr)] gap-x-icon-gap gap-y-tight-gap";

const SKELETON_FACE = "var(--spacing-avatar-row)";
const FACE = "ui-comment-face col-start-1 row-start-1 inline-flex self-center";
const HEAD =
  "ui-comment-head col-start-2 row-start-1 flex min-w-0 items-baseline gap-icon-gap text-label";
const NAME = "ui-comment-name min-w-0";
const NAME_SAYING = "ui-comment-name flex min-w-0 items-baseline";
const WHO = "ui-comment-who";
const SAID = "ui-comment-said flex-none whitespace-pre font-ui-regular text-muted-foreground";
const TIME = "ui-comment-time flex-none";
const TRAILING =
  "ui-comment-trailing ms-auto inline-flex h-lh flex-none items-center gap-control-gap self-start";
const BODY = "ui-comment-body col-start-2 row-start-2 min-w-0 text-body";

function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

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

function FaceCell({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={FACE}>{children}</span>;
}

function HeadLine({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={HEAD}>{children}</div>;
}

function BodyCell({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={BODY}>{children}</div>;
}

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
  nameRef?: ReactNode;
  said?: string | undefined;
  at?: number | undefined;
  now?: number | undefined;
  trailing?: ReactNode;
  as?: CommentElement;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style">): React.JSX.Element {
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
        {said === undefined ? (
          <Text className={NAME} variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN} truncate>
            {nameRef ?? author.name}
          </Text>
        ) : (
          <Text className={NAME_SAYING} variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
            <Text className={WHO} variant={TEXT_VARIANT.INHERIT} as={TEXT_ELEMENT.SPAN} truncate>
              {nameRef ?? author.name}
            </Text>
            <span className={SAID}>{` ${said}`}</span>
          </Text>
        )}
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

export interface CommentSkeletonLine {
  readonly key: string;
  readonly width: string;
}

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
