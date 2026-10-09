import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon, CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * tool.tsx -- AI Elements' Tool: one tool call as a line that opens onto what it was handed and what it answered.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens the way Stage draws Stagent's calls: a quiet
 * single line, the tool's icon, what the call did with its subject set
 * apart, and its state, rather than the registry's bordered card with a
 * status badge. The state is the call's as the caller says it, so this
 * knows no tool vocabulary of its own. The registry's approval controls are
 * not here, because nothing a planning turn calls asks for one.
 */

/** How far a call has got, as the line marks it. */
export const TOOL_STATE = {
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

export type ToolProps = ComponentProps<typeof Collapsible.Root>;

export function Tool({ className, ...props }: ToolProps): ReactNode {
  return <Collapsible.Root className={cn("group/tool not-prose w-full", className)} {...props} />;
}

/** The mark at the line's end: a turning ring while it runs, a cross where it failed, and a check once done. */
function ToolStateMark({ state }: { state: ToolState }): ReactNode {
  switch (state) {
    case TOOL_STATE.RUNNING:
      return (
        <LoaderCircleIcon aria-label="Running" className="ai-spin size-3 shrink-0 text-luke" />
      );
    case TOOL_STATE.FAILED:
      return <CircleXIcon aria-label="Failed" className="size-3 shrink-0 text-error" />;
    case TOOL_STATE.DONE:
      return <CircleCheckIcon aria-label="Done" className="size-3 shrink-0 opacity-50" />;
  }
}

export type ToolHeaderProps = Omit<ComponentProps<typeof Collapsible.Trigger>, "title"> & {
  icon: ReactNode;
  /** What the call did, in words. */
  title: string;
  /** The input a reader looks for first; absent for a call that has none. */
  subject?: string | undefined;
  /** Whether the subject is code, set in monospace. */
  subjectIsCode?: boolean;
  state: ToolState;
};

export function ToolHeader({
  className,
  icon,
  title,
  subject,
  subjectIsCode = false,
  state,
  ...props
}: ToolHeaderProps): ReactNode {
  return (
    <Collapsible.Trigger
      className={cn(
        "ai-trigger flex w-full min-w-0 items-center gap-1.5 rounded-md py-0.5",
        className,
      )}
      {...props}
    >
      <ChevronRightIcon className="size-3 shrink-0 transition-transform group-data-[state=open]/tool:rotate-90" />
      <span className="flex size-3.5 shrink-0 items-center justify-center [&>svg]:size-3.5">
        {icon}
      </span>
      <span className="shrink-0">{title}</span>
      {subject === undefined ? null : (
        <span
          className={cn(
            "min-w-0 truncate text-foreground",
            subjectIsCode && "font-mono text-[11.5px]",
          )}
        >
          {subject}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center pl-1">
        <ToolStateMark state={state} />
      </span>
    </Collapsible.Trigger>
  );
}

export type ToolContentProps = ComponentProps<typeof Collapsible.Content>;

export function ToolContent({ className, ...props }: ToolContentProps): ReactNode {
  return (
    <Collapsible.Content
      className={cn("space-y-2 pt-1.5 pb-1 pl-[18px] outline-none", className)}
      {...props}
    />
  );
}

/** A block of the call's text under its own small heading: what it was handed, or what it answered. */
export function ToolText({
  label,
  text,
  failed = false,
}: {
  label: string;
  text: string;
  failed?: boolean;
}): ReactNode {
  return (
    <div className="space-y-1">
      <p className="m-0 font-semibold text-[11px] text-muted-foreground">{label}</p>
      <pre
        className={cn(
          "m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] text-foreground leading-relaxed",
          failed && "text-error",
        )}
      >
        {text}
      </pre>
    </div>
  );
}
