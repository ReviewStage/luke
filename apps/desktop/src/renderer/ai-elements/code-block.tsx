import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * code-block.tsx -- AI Elements' CodeBlock: a run of code or data drawn as it is, in a box of its own.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens, without the registry's highlighter: what a coding
 * agent's tool call carries is a command, a path, or JSON, read for what
 * it says rather than coloured, and a reply's own fenced code is already
 * drawn by the markdown renderer. The registry's copy button is not here,
 * because the words are selectable and nothing draws it yet.
 */

export type CodeBlockProps = ComponentProps<"pre"> & {
  code: string;
};

export function CodeBlock({ code, className, ...props }: CodeBlockProps): ReactNode {
  return (
    <pre
      className={cn(
        "m-0 max-h-72 overflow-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground select-text [overflow-wrap:anywhere] whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code>{code}</code>
    </pre>
  );
}
