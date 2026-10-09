import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * code-block.tsx -- AI Elements' CodeBlock: a run of code or data drawn as it is, in mono, bounded and scrolling past its height.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens, without the registry's highlighter: what a coding
 * agent's tool call carries is a command, a path, or JSON, read for what
 * it says rather than coloured, and a reply's own fenced code is already
 * drawn by the markdown renderer. The registry's copy button is not here,
 * because the words are selectable and nothing draws it yet. The block
 * carries no frame of its own: the body that holds it does.
 */

export type CodeBlockProps = ComponentProps<"pre">;

export function CodeBlock({ className, children, ...props }: CodeBlockProps): ReactNode {
  return (
    <pre
      className={cn(
        "m-0 max-h-64 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground select-text [overflow-wrap:anywhere] whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code>{children}</code>
    </pre>
  );
}
