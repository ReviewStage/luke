import { useDisclosureBodyDrawn } from "@luke/ui";
import { BrainIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Fold, FoldBody, type FoldProps, FoldSummary } from "./fold.js";

/**
 * reasoning.tsx -- AI Elements' Reasoning: a model's thinking, folded under one quiet line until the reader opens it.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx` rather than the registry's
 * collapsible. Closed by default, as docs/TASKS.md's rule for an
 * agent's transcript asks: the reasoning is there to be read, never in
 * the way. The line leads with a brain in the 16px seat a call's icon
 * stands in, so it lines up with the calls around it, then says
 * "Thought", because the stored part carries the words alone and no
 * measure of how long they took, and while closed the thought's own words
 * after it, cut to the line, as a command's row reads its command. Open,
 * the line says "Thought" alone, since the words are under it whole. As a
 * call's line, "Thought" is in the full ink, and the brain and the preview
 * in the muted one. Its look is `.reasoning`'s (tasks.css).
 */

/** What the folded line says. */
const REASONING_LINE = "Thought";

export type ReasoningProps = Omit<FoldProps, "className">;

export function Reasoning({ children, ...props }: ReasoningProps): ReactNode {
  return (
    <Fold className="reasoning" {...props}>
      {children}
    </Fold>
  );
}

export interface ReasoningTriggerProps {
  /** The thought as plain words on one line, said after the line's word while the body is not drawn; empty for the word alone. */
  preview?: string;
}

/** The one line a folded reasoning shows. */
export function ReasoningTrigger({ preview = "" }: ReasoningTriggerProps): ReactNode {
  const drawn = useDisclosureBodyDrawn();
  return (
    <FoldSummary className="reasoning-line">
      <BrainIcon className="reasoning-icon" aria-hidden="true" />
      <span className="reasoning-preview">
        <span className="reasoning-label">{REASONING_LINE}</span>
        {drawn || preview === "" ? null : ` ${preview}`}
      </span>
    </FoldSummary>
  );
}

/** The thinking itself, drawn quieter than the reply it led to, only once opened, as plain words set in under the line's, as a call's body is. */
export function ReasoningContent({ text }: { text: string }): ReactNode {
  return (
    <FoldBody className="reasoning-body">
      <p className="reasoning-words">{text}</p>
    </FoldBody>
  );
}
