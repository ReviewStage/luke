import { isWireString, type WireValue } from "@sidecar/wire";
import type { ComponentProps, ReactNode } from "react";
import { CodeBlock } from "./code-block";
import { cn } from "./utils";

/**
 * tool.tsx -- AI Elements' Tool: one tool call, folded under its name and state until the reader opens it, with its input and its output inside.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens, and folded on the platform's own `details` as the
 * reasoning is. The states are the AI SDK's own words for a tool part;
 * the header says the tool's name and where the call stands, and the body
 * shows what it was given and what it answered, or the error it ended in.
 */

/** The states a tool part may stand in, as the AI SDK spells them. */
export const TOOL_STATE = {
  INPUT_STREAMING: "input-streaming",
  INPUT_AVAILABLE: "input-available",
  OUTPUT_AVAILABLE: "output-available",
  OUTPUT_ERROR: "output-error",
} as const;

export type ToolState = (typeof TOOL_STATE)[keyof typeof TOOL_STATE];

/** What each state says beside the tool's name. */
const STATE_LABEL = {
  [TOOL_STATE.INPUT_STREAMING]: "Pending",
  [TOOL_STATE.INPUT_AVAILABLE]: "Running",
  [TOOL_STATE.OUTPUT_AVAILABLE]: "Completed",
  [TOOL_STATE.OUTPUT_ERROR]: "Error",
} as const satisfies Record<ToolState, string>;

export type ToolProps = ComponentProps<"details">;

export function Tool({ className, children, ...props }: ToolProps): ReactNode {
  return (
    <details
      className={cn(
        "group/tool min-w-0 overflow-hidden rounded-lg border border-border text-[12.5px]",
        className,
      )}
      {...props}
    >
      {children}
    </details>
  );
}

export type ToolHeaderProps = ComponentProps<"summary"> & {
  name: string;
  state: ToolState;
};

/** The one line a folded call shows: the tool's name, and where the call stands. */
export function ToolHeader({ name, state, className, ...props }: ToolHeaderProps): ReactNode {
  return (
    <summary
      className={cn(
        "flex cursor-default list-none items-center gap-2 px-3 py-1.5 select-none transition-colors hover:bg-secondary [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      <span className="inline-block w-3 text-muted-foreground transition-transform group-open/tool:rotate-90">
        ▸
      </span>
      <span className="min-w-0 flex-1 truncate font-mono font-medium">{name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground" data-tool-state={state}>
        {STATE_LABEL[state]}
      </span>
    </summary>
  );
}

export type ToolContentProps = ComponentProps<"div">;

export function ToolContent({ className, children, ...props }: ToolContentProps): ReactNode {
  return (
    <div className={cn("flex flex-col gap-2 border-t border-border p-3", className)} {...props}>
      {children}
    </div>
  );
}

/** A value as the box draws it: a string as it is, anything else as its JSON. */
function drawn(value: WireValue | undefined): string {
  if (value === undefined) return "";
  return isWireString(value) ? value : JSON.stringify(value, null, 2);
}

export type ToolInputProps = ComponentProps<"div"> & {
  input: WireValue | undefined;
};

/** What the call was given. */
export function ToolInput({ input, className, ...props }: ToolInputProps): ReactNode {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h4 className="m-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Input
      </h4>
      <CodeBlock code={drawn(input)} />
    </div>
  );
}

export type ToolOutputProps = ComponentProps<"div"> & {
  output: WireValue | undefined;
  errorText: string | undefined;
};

/** What the call answered, or the error it ended in; nothing while it has answered neither. */
export function ToolOutput({ output, errorText, className, ...props }: ToolOutputProps): ReactNode {
  if (output === undefined && errorText === undefined) return null;
  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h4 className="m-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {errorText === undefined ? "Output" : "Error"}
      </h4>
      {errorText === undefined ? (
        <CodeBlock code={drawn(output)} />
      ) : (
        <p className="m-0 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger" role="alert">
          {errorText}
        </p>
      )}
    </div>
  );
}
