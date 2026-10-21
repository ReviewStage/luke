import type { ReviewThread } from "@luke/features/coding-agent-wire";
import { actorName } from "@luke/ui/actor-model";
import { CircleCheckIcon, CircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold.js";
import { Tooltip } from "../tooltip.js";
import { useNamer } from "./pull-request-people.js";

/**
 * minimized-threads.tsx -- a line's cards drawn small while Minimize inline comments is on, a review thread's or one of Luke's notes in a File tab, as stage-cli draws them: one chip at the end of the line, the faces of who wrote on it, how many comments, and whether every thread is resolved, which shows the threads or puts them away.
 *
 * The chip stands in a row of no height of its own, floated up over the end
 * of the line it is on, so the diff reads as if the line held no comments;
 * the threads, once shown, are drawn under the chip as they are while
 * nothing is minimized. Shown or put away, the line is told the view
 * (`onShown`), which keeps it so while the setting stands.
 */

/** How many faces a chip draws before the rest go uncounted, as stage-cli's does. */
const CHIP_FACES = 4;

/** What a chip says of a line's threads, and what pressing it does. */
const CHIP_WORDS = {
  comments: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
  open: (count: number) => (count === 0 ? "all resolved" : `${count} open`),
  SHOW: "show",
  HIDE: "hide",
  SHOW_HINT: "Show comments",
  HIDE_HINT: "Hide comments",
} as const;

/** Everyone who wrote on the threads, each once, in the order they first wrote. */
function writersOf(threads: readonly ReviewThread[]) {
  const seen = new Map<string, ReviewThread["comments"][number]["by"]>();
  for (const comment of threads.flatMap((thread) => thread.comments)) {
    if (!seen.has(comment.by.login)) seen.set(comment.by.login, comment.by);
  }
  return [...seen.values()];
}

/**
 * A line's cards drawn small: the chip, a fold's summary, which shows whether
 * every thread on it is resolved where its cards have a state, the faces of
 * who wrote them, and how many, said whole to a screen reader with what
 * pressing it does; and the cards it folds, drawn under it once shown. Note
 * that a fold is what lets the tab's find reach the cards while they are
 * put away, and open the line whose words it brings into view. Review
 * threads (`MinimizedThreads`) and Luke's notes in a File tab
 * (`file-note.tsx`) stand on it alike.
 */
export function MinimizedChip({
  label,
  faces,
  count,
  resolved,
  shown,
  onShown,
  above = false,
  children,
}: {
  /** The chip said whole, ending with what pressing it does. */
  label: string;
  /** The faces of who wrote the cards, as many as the chip draws. */
  faces: ReactNode;
  /** How many comments the cards hold. */
  count: number;
  /** Whether every thread under the chip is resolved; none for cards with no state, as Luke's notes have none. */
  resolved?: boolean | undefined;
  /** Whether the cards stand above the code, on no line, where the chip takes a row of its own rather than floating over a line. */
  above?: boolean;
  /** Whether the cards stand under the chip. */
  shown: boolean;
  /** Told the cards were shown or put away, by the chip or by the find. */
  onShown: (shown: boolean) => void;
  /** The cards as they are drawn while nothing is minimized. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fold
      className="diff-thread-chip-row"
      data-above={above ? "" : undefined}
      open={shown}
      onOpenChange={onShown}
    >
      <Tooltip label={shown ? CHIP_WORDS.HIDE_HINT : CHIP_WORDS.SHOW_HINT}>
        <FoldSummary className="diff-thread-chip" aria-label={label}>
          {resolved === undefined ? null : resolved ? (
            <CircleCheckIcon className="diff-thread-chip-resolved" aria-hidden="true" />
          ) : (
            <CircleIcon aria-hidden="true" />
          )}
          <span className="diff-thread-chip-faces">{faces}</span>
          {count}
        </FoldSummary>
      </Tooltip>
      <FoldBody className="diff-thread-chip-threads">{children}</FoldBody>
    </Fold>
  );
}

/** What pressing a chip does, as its label ends: shows the cards, or puts them away. */
export function chipPress(shown: boolean): string {
  return shown ? CHIP_WORDS.HIDE : CHIP_WORDS.SHOW;
}

/**
 * One line's threads minimized (`MinimizedChip`): who wrote on them, how
 * many comments, and how many are still open ("3 comments by dana, sam · 1
 * open, show").
 */
export function MinimizedThreads({
  threads,
  shown,
  onShown,
  above = false,
  children,
}: {
  threads: readonly ReviewThread[];
  /** Whether the threads stand above the diff, on no line, where the chip takes a row of its own rather than floating over a line. */
  above?: boolean;
  /** Whether the threads stand under the chip. */
  shown: boolean;
  /** Told the threads were shown or put away, by the chip or by the find. */
  onShown: (shown: boolean) => void;
  /** The threads as they are drawn while nothing is minimized. */
  children: ReactNode;
}): React.JSX.Element {
  const name = useNamer();
  const writers = writersOf(threads).map(name);
  const count = threads.reduce((sum, thread) => sum + thread.comments.length + thread.more, 0);
  const open = threads.filter((thread) => !thread.resolved).length;
  const label = [
    `${CHIP_WORDS.comments(count)} by ${writers.map((writer) => actorName(writer)).join(", ")}`,
    `${CHIP_WORDS.open(open)}, ${chipPress(shown)}`,
  ].join(" · ");
  return (
    <MinimizedChip
      label={label}
      faces={writers
        .slice(0, CHIP_FACES)
        .map((writer, at) => <ActorMark key={at} actor={writer} size={ACTOR_SIZE.MARK} tiled />)}
      count={count}
      resolved={open === 0}
      shown={shown}
      onShown={onShown}
      above={above}
    >
      {children}
    </MinimizedChip>
  );
}
