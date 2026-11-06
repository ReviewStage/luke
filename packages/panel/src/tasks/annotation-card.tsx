import {
  CARD_CORNER,
  CARD_ELEMENT,
  CARD_PADDING,
  Card,
  Comment,
  type CommentAuthor,
  DISCLOSURE_SUMMARY,
  DisclosureChevron,
  DisclosureFrame,
  DisclosureSummary,
  GAP,
  LAYOUT_ELEMENT,
  QuietWords,
  Stack,
  useDisclosureState,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@repo/ui";
import { landedMark } from "@repo/ui/landed";
import { MessageSquareIcon } from "lucide-react";
import type { AnimationEvent, ReactNode } from "react";
import { Fold, FoldBody } from "../ai-elements/fold.js";

const COUNT_WORDS = {
  word: (count: number) => (count === 1 ? "comment" : "comments"),
} as const;

const CARD_CLASS = "annotation-card min-w-0 max-w-annotation font-sans text-body text-foreground";

const COMMENT_CLASS =
  "annotation-comment grid min-w-0 grid-cols-annotation-comment gap-x-annotation-gap gap-y-tight-gap";

function StateWords({ word }: { word: string }): React.JSX.Element {
  return (
    <span className="annotation-card-state flex flex-none">
      <QuietWords>{word}</QuietWords>
    </span>
  );
}

function FoldedCount({ count }: { count: number }): React.JSX.Element | null {
  const { open } = useDisclosureState();
  if (open) return null;
  return (
    <span className="annotation-card-count inline-flex flex-none items-center gap-tight-gap text-muted-foreground">
      <MessageSquareIcon className="size-ui-12" aria-hidden="true" />
      {count}
      <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>
        {" "}
        {COUNT_WORDS.word(count)}
      </VisuallyHidden>
    </span>
  );
}

export interface AnnotationLanding {
  readonly ref: (card: HTMLElement | null) => void;
  readonly ringed: boolean;
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

export function AnnotationCard({
  label,
  open,
  onOpenChange,
  face,
  name,
  time,
  states = [],
  count,
  menu,
  where,
  lead,
  footer,
  landing,
  className,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  face: ReactNode;
  name: ReactNode;
  time?: ReactNode;
  states?: readonly string[];
  count?: number | undefined;
  menu?: ReactNode;
  where?: ReactNode;
  lead?: ReactNode;
  footer?: ReactNode;
  landing?: AnnotationLanding | undefined;
  className?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.ARTICLE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      ref={landing?.ref}
      className={className === undefined ? CARD_CLASS : `${CARD_CLASS} ${className}`}
      aria-label={label}
      {...landedMark(landing?.ringed === true)}
      onAnimationEnd={landing?.onAnimationEnd}
    >
      {where === undefined ? null : (
        <div className="annotation-card-where flex min-w-0 border-b border-border text-caption text-muted-foreground">
          {where}
        </div>
      )}
      <DisclosureFrame
        actions={
          menu === undefined ? undefined : <span className="ms-auto flex flex-none">{menu}</span>
        }
      >
        <Fold className="annotation-card-fold" open={open} onOpenChange={onOpenChange}>
          <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
            <span className="annotation-card-turn flex size-annotation-turn flex-none items-center justify-center">
              <DisclosureChevron />
            </span>
            <span className="annotation-card-face flex size-annotation-face flex-none items-center justify-center">
              {face}
            </span>
            <span className="flex min-w-0 flex-initial overflow-hidden font-ui-semibold">
              {name}
            </span>
            {time === undefined ? null : (
              <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>
                <span className="annotation-card-time flex-none text-muted-foreground">{time}</span>
              </VisuallyHidden>
            )}
            {states.map((word) => (
              <StateWords key={word} word={word} />
            ))}
            {count === undefined ? null : <FoldedCount count={count} />}
          </DisclosureSummary>
          <FoldBody className="annotation-card-body">
            {lead}
            <div className="annotation-card-content pt-ui-2 pr-list-inset pb-list-inset pl-annotation-face-x">
              {children}
            </div>
            {footer}
          </FoldBody>
        </Fold>
      </DisclosureFrame>
    </Card>
  );
}

export function AnnotationComments({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.BLOCK} className="annotation-comments">
      {children}
    </Stack>
  );
}

export interface AnnotationReply {
  readonly author: CommentAuthor;
  readonly nameRef: ReactNode;
  readonly at: number;
  readonly now: number;
  readonly trailing?: ReactNode;
}

export function AnnotationComment({
  reply,
  className,
  children,
}: {
  reply?: AnnotationReply | undefined;
  className?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const words = (
    <div className="annotation-comment-words col-2 flex min-w-0 flex-col gap-item-gap wrap-anywhere">
      {children}
    </div>
  );
  if (reply === undefined) {
    return (
      <li className={className === undefined ? COMMENT_CLASS : `${COMMENT_CLASS} ${className}`}>
        {words}
      </li>
    );
  }
  return (
    <li className={className}>
      <Comment
        author={reply.author}
        nameRef={reply.nameRef}
        at={reply.at}
        now={reply.now}
        trailing={reply.trailing}
      >
        {words}
      </Comment>
    </li>
  );
}
