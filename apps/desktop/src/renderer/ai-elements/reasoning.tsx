import * as Collapsible from "@radix-ui/react-collapsible";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * reasoning.tsx -- AI Elements' Reasoning: what a model thought on its way to an answer, folded behind one line.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens. The registry's timer, which measures how long
 * the model thought and folds the block a moment after, is not here: a
 * reasoning part reaches the Mac whole once its step is done, so there is
 * nothing streaming to time and the block starts folded.
 */

export type ReasoningProps = ComponentProps<typeof Collapsible.Root>;

export function Reasoning({ className, ...props }: ReasoningProps): ReactNode {
  return <Collapsible.Root className={cn("group/reasoning not-prose", className)} {...props} />;
}

export type ReasoningTriggerProps = ComponentProps<typeof Collapsible.Trigger>;

export function ReasoningTrigger({
  className,
  children,
  ...props
}: ReasoningTriggerProps): ReactNode {
  return (
    <Collapsible.Trigger
      className={cn("ai-trigger flex w-full items-center gap-1.5", className)}
      {...props}
    >
      <ChevronRightIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/reasoning:rotate-90" />
      <BrainIcon className="size-3.5 shrink-0" />
      <span>{children ?? "Thought"}</span>
    </Collapsible.Trigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof Collapsible.Content> & {
  children: string;
};

export function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps): ReactNode {
  return (
    <Collapsible.Content
      className={cn(
        "mt-1 whitespace-pre-wrap pl-[18px] text-muted-foreground text-xs leading-relaxed outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Collapsible.Content>
  );
}
