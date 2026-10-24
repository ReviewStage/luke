import {
  Badge,
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
  STATUS_TONE,
  Stack,
  type StatusTone,
  Tooltip,
  useDisclosureState,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@luke/ui";
import { landedMark } from "@luke/ui/landed";
import { MessageSquareIcon } from "lucide-react";
import type { AnimationEvent, ReactNode } from "react";
import { Fold, FoldBody } from "../ai-elements/fold.js";

/**
 * annotation-card.tsx -- one card for whatever is written on lines of code: a review thread in Files changed and in the Conversation, and an agent's note on lines of a File tab.
 *
 * The card is the review thread's quiet one (surface ground, quiet border,
 * its corners rounded), standing under the last line it is on, from the
 * code's column. Its head is one line that never wraps: the fold's chevron,
 * in the slot a Files changed file header's stands in, then the first
 * writer's face and name, how long ago, the states it is in (Outdated,
 * Resolved, Pending), how many comments it holds while folded, and its ⋯ at
 * the end; the whole row folds the card. Folded, the card is its head
 * alone, no words of it previewed. It names no lines, since the lines it
 * lights and the place it stands in say which; a card standing where its
 * place does not say, the Conversation's or one above a diff, wears a strip
 * over its head that does (`where`).
 *
 * The card keeps one column of faces and one of words: the head's face
 * over every reply's face, and the first comment's words under the head's
 * name, with every reply's beside its face (`AnnotationComment`). Each
 * column's place is one custom property of the card (`tasks.css`'s
 * `.annotation-card`), which the head and the comments both read, so no
 * part is nudged into line with another.
 *
 * In a narrow place (`@container annotation`, under 440 pixels) the age
 * is said to a reader alone, a state is its badge's dot whose word is its
 * hint and its name, the
 * count drops its word, the card moves to the pane's inset, and the presses
 * at its foot draw closer.
 */

/** What a card says of how many comments it holds while folded, the word dropped where it is narrow. */
const COUNT_WORDS = {
  word: (count: number) => (count === 1 ? "comment" : "comments"),
} as const;

/** A state a card is in, by its word and the tone it is drawn in. */
export const ANNOTATION_TONE = {
  NEUTRAL: STATUS_TONE.NEUTRAL,
  ATTENTION: STATUS_TONE.ATTENTION,
  COMPLETE: STATUS_TONE.COMPLETE,
} as const satisfies Record<string, StatusTone>;

type AnnotationTone = (typeof ANNOTATION_TONE)[keyof typeof ANNOTATION_TONE];

/** One state a card is in: its word, which a narrow card says as its dot's hint and name. */
export interface AnnotationState {
  readonly word: string;
  readonly tone: AnnotationTone;
}

/** A state's badge: its word after its tone's dot, or, narrow, the dot alone, whose word is its hint and stays its name. */
function StateChip({ state }: { state: AnnotationState }): React.JSX.Element {
  return (
    <Tooltip label={state.word}>
      <span className="annotation-card-state">
        <Badge
          tone={state.tone}
          dot={state.tone === ANNOTATION_TONE.NEUTRAL}
          hideWordsUnder={VISUALLY_HIDDEN_UNDER.TIGHT}
        >
          {state.word}
        </Badge>
      </span>
    </Tooltip>
  );
}

/** How many comments the card holds, beside a message's glyph, drawn while it is folded alone. */
function FoldedCount({ count }: { count: number }): React.JSX.Element | null {
  const { open } = useDisclosureState();
  if (open) return null;
  return (
    <span className="annotation-card-count">
      <MessageSquareIcon aria-hidden="true" />
      {count}
      <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>
        {" "}
        {COUNT_WORDS.word(count)}
      </VisuallyHidden>
    </span>
  );
}

/** Where a card was landed on, by a link or a jump: its element, and its ring while the landing stands. */
export interface AnnotationLanding {
  readonly ref: (card: HTMLElement | null) => void;
  readonly ringed: boolean;
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

/**
 * The card: `where` over its head where its place does not say which lines,
 * its head, then, open, its comments and its foot. The fold is the
 * holder's, as each kind keeps its own (`open`, `onOpenChange`).
 */
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
  /** What the card is called to a screen reader. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first writer's face, 20 pixels across. */
  face: ReactNode;
  /** Who wrote it, in words alone, since the head that says it is the card's summary, which holds no control. */
  name: ReactNode;
  time?: ReactNode;
  states?: readonly AnnotationState[];
  /** How many comments it holds, said while it is folded; none says nothing. */
  count?: number | undefined;
  /** Its ⋯, beside the head's end rather than in it; nothing where it offers nothing. */
  menu?: ReactNode;
  /** The strip over its head naming its file and lines, where its place does not. */
  where?: ReactNode;
  /** What stands open over its comments across its whole width, the lines a Conversation card is on. */
  lead?: ReactNode;
  /** What stands at its foot while it is open, under a rule. */
  footer?: ReactNode;
  landing?: AnnotationLanding | undefined;
  className?: string | undefined;
  /** What it holds open: its comments (`AnnotationComments`), and anything they stand under. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.ARTICLE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      ref={landing?.ref}
      className={className === undefined ? "annotation-card" : `annotation-card ${className}`}
      aria-label={label}
      {...landedMark(landing?.ringed === true)}
      onAnimationEnd={landing?.onAnimationEnd}
    >
      {where === undefined ? null : <div className="annotation-card-where">{where}</div>}
      <DisclosureFrame
        actions={
          menu === undefined ? undefined : <span className="annotation-card-end">{menu}</span>
        }
      >
        <Fold className="annotation-card-fold" open={open} onOpenChange={onOpenChange}>
          <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
            <span className="annotation-card-turn">
              <DisclosureChevron />
            </span>
            <span className="annotation-card-face">{face}</span>
            <span className="annotation-card-name">{name}</span>
            {time === undefined ? null : (
              <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>
                <span className="annotation-card-time">{time}</span>
              </VisuallyHidden>
            )}
            {states.map((state) => (
              <StateChip key={state.word} state={state} />
            ))}
            {count === undefined ? null : <FoldedCount count={count} />}
          </DisclosureSummary>
          <FoldBody className="annotation-card-body">
            {lead}
            <div className="annotation-card-content">{children}</div>
            {footer}
          </FoldBody>
        </Fold>
      </DisclosureFrame>
    </Card>
  );
}

/** A card's comments, in order. */
export function AnnotationComments({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.BLOCK} className="annotation-comments">
      {children}
    </Stack>
  );
}

/** A reply's head as `Comment` draws it: who wrote it, how long ago, and what stands at the head's end. */
export interface AnnotationReply {
  readonly author: CommentAuthor;
  /** The name as the caller's own ref, hanging the writer's card. */
  readonly nameRef: ReactNode;
  readonly at: number;
  readonly now: number;
  readonly trailing?: ReactNode;
}

/**
 * One comment of a card: the first one's words alone, under the head's name,
 * since the head already says who and when; a reply a comment (`Comment`),
 * its face in the faces' column, its name and age beside it, and its words
 * under them, in the column the first comment's stand in.
 */
export function AnnotationComment({
  reply,
  className,
  children,
}: {
  /** A reply's head; none for the comment the card's head names. */
  reply?: AnnotationReply | undefined;
  className?: string | undefined;
  /** Its words, and what stands under them. */
  children: ReactNode;
}): React.JSX.Element {
  const words = <div className="annotation-comment-words">{children}</div>;
  if (reply === undefined) {
    return (
      <li
        className={
          className === undefined ? "annotation-comment" : `annotation-comment ${className}`
        }
      >
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
