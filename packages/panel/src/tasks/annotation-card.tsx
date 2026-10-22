import {
  DisclosureChevron,
  Tooltip,
  useDisclosureState,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@luke/ui";
import { MessageSquareIcon } from "lucide-react";
import type { AnimationEvent, ReactNode } from "react";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold.js";

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
 * steps out, a state is a dot whose word is its hint and its name, the
 * count drops its word, the card moves to the pane's inset, and the presses
 * at its foot draw closer.
 */

/** What a card says of how many comments it holds while folded, the word dropped where it is narrow. */
const COUNT_WORDS = {
  word: (count: number) => (count === 1 ? "comment" : "comments"),
} as const;

/** A state a card is in, by its word and the tone it is drawn in. */
export const ANNOTATION_TONE = {
  NEUTRAL: "neutral",
  ATTENTION: "attention",
  COMPLETE: "complete",
} as const;

type AnnotationTone = (typeof ANNOTATION_TONE)[keyof typeof ANNOTATION_TONE];

/** One state a card is in: its word, which a narrow card says as its dot's hint and name. */
export interface AnnotationState {
  readonly word: string;
  readonly tone: AnnotationTone;
}

/** A state's chip: its word in a capsule, or, narrow, a dot whose word is its hint and stays its name. */
function StateChip({ state }: { state: AnnotationState }): React.JSX.Element {
  return (
    <Tooltip label={state.word}>
      <span className="annotation-card-chip" data-tone={state.tone}>
        <VisuallyHidden under={VISUALLY_HIDDEN_UNDER.TIGHT}>{state.word}</VisuallyHidden>
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
  /** Who wrote it; a control in it, such as a link to the writer's page, sits in a `DisclosureAction`, so pressing it leaves the card folded as it stood. */
  name: ReactNode;
  time?: ReactNode;
  states?: readonly AnnotationState[];
  /** How many comments it holds, said while it is folded; none says nothing. */
  count?: number | undefined;
  /** Its ⋯, at the head's end; nothing where it offers nothing. */
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
    <article
      ref={landing?.ref}
      className={className === undefined ? "annotation-card" : `annotation-card ${className}`}
      aria-label={label}
      data-search-landed={landing?.ringed === true ? "" : undefined}
      onAnimationEnd={landing?.onAnimationEnd}
    >
      {where === undefined ? null : <div className="annotation-card-where">{where}</div>}
      <Fold className="annotation-card-fold" open={open} onOpenChange={onOpenChange}>
        <FoldSummary className="annotation-card-head">
          <DisclosureChevron />
          <span className="annotation-card-face">{face}</span>
          <span className="annotation-card-name">{name}</span>
          {time === undefined ? null : <span className="annotation-card-time">{time}</span>}
          {states.map((state) => (
            <StateChip key={state.word} state={state} />
          ))}
          {count === undefined ? null : <FoldedCount count={count} />}
          <span className="annotation-card-end">{menu}</span>
        </FoldSummary>
        <FoldBody className="annotation-card-body">
          {lead}
          <div className="annotation-card-content">{children}</div>
          {footer}
        </FoldBody>
      </Fold>
    </article>
  );
}

/** A card's comments, in order. */
export function AnnotationComments({ children }: { children: ReactNode }): React.JSX.Element {
  return <ol className="annotation-comments">{children}</ol>;
}

/**
 * One comment of a card: the first one's words alone, under the head's name,
 * since the head already says who and when; a reply's face in the faces'
 * column, its name and age beside it, and its words under them, in the
 * column the first comment's stand in.
 */
export function AnnotationComment({
  reply,
  className,
  children,
}: {
  /** A reply's face and the line beside it; none for the comment the card's head names. */
  reply?: { readonly face: ReactNode; readonly meta: ReactNode } | undefined;
  className?: string | undefined;
  /** Its words, and what stands under them. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <li
      className={className === undefined ? "annotation-comment" : `annotation-comment ${className}`}
    >
      {reply === undefined ? null : (
        <>
          <span className="annotation-comment-face">{reply.face}</span>
          <span className="annotation-comment-meta">{reply.meta}</span>
        </>
      )}
      <div className="annotation-comment-words">{children}</div>
    </li>
  );
}
