import { CheckIcon, CopyIcon } from "@sidecar/panel";
import { useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "./act";

const COPY_CONFIRMATION_MS = 1500;

/**
 * The copy control a settled bubble carries in its free margin. It copies the
 * words as written, Markdown marks included, so a paste carries the structure
 * the bubble drew — and never the structured model context behind them. The
 * glyph alone speaks: the accessible name captions it, and the confirmation is
 * the same green check a finished session wears, standing for a moment before
 * the control returns to its resting glyph.
 */
export function ConversationCopyButton({ words }: { words: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="conversation-copy"
      data-copied={copied ? "true" : undefined}
      aria-label={copied ? "Copied" : "Copy message"}
      onClick={() => {
        tell(ACT_KIND.WINDOW_COPY_TEXT, { words });
        setCopied(true);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
