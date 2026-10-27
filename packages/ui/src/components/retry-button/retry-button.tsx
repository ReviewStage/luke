/**
 * retry-button.tsx -- the one way a failure offers itself again: a turning arrow and "Retry" on a quiet folding button.
 *
 * A failure's words read as a sentence of their own and the retry stands
 * beside or after them, never as a link inside the sentence, the way Cursor
 * and Codex draw a failed load. A row that is itself the button, "Show older
 * versions" turned failure, cannot hold a second one, so it draws
 * `RetryRowLabel` instead, and its own press is the retry. Its arrow is
 * `ErrorState`'s own (`RetryIcon`), turning once as it is pressed; its words
 * fold away where a bar short of room folds them (`FoldingButton`), leaving
 * the glyph, named still, whose hint then says the words.
 */

import { RetryIcon } from "../../icons/lucide-glyphs.js";
import { FoldingButton } from "../folding-button/folding-button.js";

const RETRY_WORD = "Retry";

/** The retry beside a failure's words; `label` names what it reads again where "Retry" alone would not say. */
export function RetryButton({
  onRetry,
  label = RETRY_WORD,
}: {
  onRetry: () => void;
  label?: string;
}): React.JSX.Element {
  return <FoldingButton label={label} icon={<RetryIcon />} turns onClick={onRetry} />;
}
