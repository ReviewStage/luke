/**
 * retry-button.tsx -- the one way a failure offers itself again: a turning-arrow glyph and "Retry" in the toolbar button's muted voice.
 *
 * A failure's words read as a sentence of their own and the retry stands
 * beside or after them, never as a link inside the sentence, the way Cursor
 * and Codex draw a failed load. A row that is itself the button, "Show older
 * versions" turned failure, cannot hold a second one, so it draws the same
 * glyph and word after its failure (`RetryRowLabel`), and its own press is
 * the retry. The failure's words are an alert, because they appear in the
 * row's place after a press or a scroll and a reader would otherwise hear
 * nothing of it.
 */

import { RotateCwIcon } from "lucide-react";

const RETRY_WORD = "Retry";

/**
 * The retry beside a failure's words; `label` names what it reads again where
 * "Retry" alone would not say. Its words stand in `.retry-word`, so a bar
 * short of room can draw the glyph alone, named still, with a `Tooltip`
 * around it, whose props it takes, saying the words.
 */
export function RetryButton({
  onRetry,
  label = RETRY_WORD,
  ...anchor
}: {
  onRetry: () => void;
  label?: string;
} & Omit<React.ComponentProps<"button">, "type" | "className" | "onClick">): React.JSX.Element {
  return (
    <button
      type="button"
      className="toolbar-button quiet-button"
      aria-label={label}
      {...anchor}
      onClick={onRetry}
    >
      <RotateCwIcon aria-hidden="true" />
      <span className="retry-word">{label}</span>
    </button>
  );
}

/** A failed row's words: the failure, then the glyph and word its press retries with. */
export function RetryRowLabel({ failure }: { failure: string }): React.JSX.Element {
  return (
    <>
      <span role="alert">{failure}</span>{" "}
      <span className="retry-label">
        <RotateCwIcon aria-hidden="true" />
        {RETRY_WORD}
      </span>
    </>
  );
}
