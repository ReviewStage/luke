import { SCROLL_OVERSCROLL, SCROLL_SIZE, ScrollArea } from "@luke/ui";
import type { ReactNode } from "react";

/**
 * code-block.tsx -- AI Elements' CodeBlock: a run of code or data drawn as it is, in mono, bounded and scrolling past its height.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens, without the registry's highlighter: what a coding
 * agent's tool call carries is a command, a path, or JSON, read for what
 * it says rather than coloured, and a reply's own fenced code is already
 * drawn by the markdown renderer. The registry's copy button is not here,
 * because the words are selectable and nothing draws it yet. The block
 * carries no frame of its own: the body that holds it does, and its look is
 * `.code-block`'s (tasks.css). It scrolls past its height in `@luke/ui`'s
 * `ScrollArea`, the bound standing on the box around it, and hands a swipe
 * past its end on to the transcript it stands in.
 */

export function CodeBlock({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="code-block">
      <ScrollArea size={SCROLL_SIZE.CONTENT} overscroll={SCROLL_OVERSCROLL.CHAIN}>
        <pre className="code-block-words">
          <code>{children}</code>
        </pre>
      </ScrollArea>
    </div>
  );
}
