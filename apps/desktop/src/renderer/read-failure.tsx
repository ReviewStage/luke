import { FailureNote } from "./failure-note";
import { FAILURE_REASON } from "./failure-remedy";

/**
 * read-failure.tsx -- a read that did not land: its sentence in the fault's red, then Retry, where the rows or the region it would have drawn stand.
 *
 * Every surface that reads says a failed read the same way: one sentence,
 * "The inbox could not be read.", in the `.error-message` red, because a
 * read that did not land is a fault rather than a state of the account,
 * then Retry (`failure-note.tsx`, `retry-button.tsx`). Only where it stands
 * differs. In a list, a card, or under a transcript it is a line, Retry
 * beside the sentence; alone in a region the read would have filled, a tab
 * or a page, it is centred, Retry under the sentence, in the region's type.
 * The surface's own wrapper places it, an inset or a card's line, and lends
 * it no colour of its own.
 */

/** Where the failure stands: among the rows it failed to read, or alone in the region it would have filled. */
export const READ_FAILURE_PLACE = {
  INLINE: "inline",
  CENTRED: "centred",
} as const;

export type ReadFailurePlace = (typeof READ_FAILURE_PLACE)[keyof typeof READ_FAILURE_PLACE];

const PLACE_CLASS = {
  [READ_FAILURE_PLACE.INLINE]: "error-message read-failure",
  [READ_FAILURE_PLACE.CENTRED]: "error-message read-failure read-failure-centred",
} as const satisfies Record<ReadFailurePlace, string>;

/** A failed read's sentence and its Retry, an alert so a reader hears it land in the rows' place. */
export function ReadFailure({
  line,
  onRetry,
  place = READ_FAILURE_PLACE.INLINE,
}: {
  /** What could not be read, as "The inbox could not be read." */
  line: string;
  onRetry: () => void;
  place?: ReadFailurePlace;
}): React.JSX.Element {
  return (
    <FailureNote
      failure={{ reason: FAILURE_REASON.OTHER, text: line }}
      className={PLACE_CLASS[place]}
      onRetry={onRetry}
    />
  );
}
