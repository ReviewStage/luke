/**
 * retry-button.tsx -- the one way a failure offers itself again: a turning-arrow glyph and "Retry" in the toolbar button's muted voice.
 *
 * A failure's words read as a sentence of their own and the retry stands
 * beside or after them, never as a link inside the sentence, the way Cursor
 * and Codex draw a failed load. A row that is itself the button, "Show older
 * versions" turned failure, cannot hold a second one, so it draws
 * `@luke/ui`'s `RetryRowLabel` instead, and its own press is the retry.
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
