/**
 * retry-button.tsx -- the one way a failure offers itself again: a turning-arrow glyph and "Retry" on a quiet folding button.
 *
 * A failure's words read as a sentence of their own and the retry stands
 * beside or after them, never as a link inside the sentence, the way Cursor
 * and Codex draw a failed load. A row that is itself the button, "Show older
 * versions" turned failure, cannot hold a second one, so it draws
 * `@luke/ui`'s `RetryRowLabel` instead, and its own press is the retry.
 */

import { RotateCwIcon } from "lucide-react";
import { FoldingButton } from "./folding-button.js";

const RETRY_WORD = "Retry";

/**
 * The retry beside a failure's words; `label` names what it reads again where
 * "Retry" alone would not say. Its words fold away where a bar short of room
 * folds them (`FoldingButton`), leaving the glyph, named still, whose hint
 * then says the words.
 */
export function RetryButton({
  onRetry,
  label = RETRY_WORD,
}: {
  onRetry: () => void;
  label?: string;
}): React.JSX.Element {
  return (
    <FoldingButton label={label} icon={<RotateCwIcon aria-hidden="true" />} onClick={onRetry} />
  );
}
