/**
 * retry-button.tsx -- the one way a failure offers itself again: a turning-arrow glyph and "Retry" in the toolbar button's muted voice.
 *
 * A failure's words read as a sentence of their own and the retry stands
 * beside or after them, never as a link inside the sentence, the way Cursor
 * and Codex draw a failed load. A row that is itself the button, "Show older
 * versions" turned failure, cannot hold a second one, so it draws the same
 * glyph and word after its failure (`RetryRowLabel`), and its own press is
 * the retry.
 */

import { RotateCwIcon } from "lucide-react";

const RETRY_WORD = "Retry";

/** The retry beside a failure's words; `label` names what it reads again where "Retry" alone would not say. */
export function RetryButton({
  onRetry,
  label = RETRY_WORD,
}: {
  onRetry: () => void;
  label?: string;
}): React.JSX.Element {
  return (
    <button type="button" className="toolbar-button quiet-button" onClick={onRetry}>
      <RotateCwIcon aria-hidden="true" />
      {label}
    </button>
  );
}

/** A failed row's words: the failure, then the glyph and word its press retries with. */
export function RetryRowLabel({ failure }: { failure: string }): React.JSX.Element {
  return (
    <>
      {failure}{" "}
      <span className="retry-label">
        <RotateCwIcon aria-hidden="true" />
        {RETRY_WORD}
      </span>
    </>
  );
}
