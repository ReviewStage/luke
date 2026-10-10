import type { ComponentProps, ReactNode } from "react";
import type { Components } from "streamdown";
import { MessageResponse, PANEL_MARKDOWN_COMPONENTS } from "../ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../ai-elements/reasoning";
import {
  Tool,
  type ToolBlock,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { cn } from "../ai-elements/utils";

/**
 * transcript-blocks.tsx -- the one way a transcript's blocks are drawn, on the Transcript tab, the Work tab, and a coding agent's tab alike.
 *
 * Each tab decides what its rows say from its own wire
 * (`transcript-model.ts`, `work-model.ts`, `coding-agent-model.ts` with
 * `tool-call-model.ts`); how a block of each kind looks is decided here
 * once, over the AI Elements components (`../ai-elements/`): words as
 * markdown at the panel's scale, reasoning folded under one quiet line,
 * a tool call as one collapsible row that opens onto its input and its
 * answer, and a note between the rows. A tab that drew one of these its
 * own way would be a second transcript style, which is what this file is
 * here to refuse.
 */

/**
 * How a transcript's markdown is drawn: at the panel's scale, but never
 * as an image, because an image is a request to wherever its address
 * points the moment the tab opens, and nothing said on a call or written
 * by a model should make one.
 */
export const TRANSCRIPT_COMPONENTS: Components = { ...PANEL_MARKDOWN_COMPONENTS, img: () => null };

/** A turn's words as markdown. */
export function TranscriptWords({
  text,
  components = TRANSCRIPT_COMPONENTS,
}: {
  text: string;
  components?: Components;
}): ReactNode {
  return (
    <MessageResponse mode="static" components={components}>
      {text}
    </MessageResponse>
  );
}

/** A model's reasoning, folded under one line until opened, its words as they are. */
export function TranscriptReasoning({ text }: { text: string }): ReactNode {
  return (
    <Reasoning>
      <ReasoningTrigger />
      <ReasoningContent>
        <p className="m-0 whitespace-pre-wrap">{text}</p>
      </ReasoningContent>
    </Reasoning>
  );
}

export type TranscriptToolProps = Omit<ComponentProps<typeof Tool>, "children"> &
  Pick<ToolHeaderProps, "state" | "icon" | "label" | "subject" | "subjectIsCode"> & {
    input: ToolBlock;
    /** Nothing while the call has not answered. */
    output: ToolBlock | undefined;
    errorText: string | undefined;
  };

/** One tool call: its row, closed until clicked, and its input and answer under it once opened. */
export function TranscriptTool({
  state,
  icon,
  label,
  subject,
  subjectIsCode = true,
  input,
  output,
  errorText,
  ...props
}: TranscriptToolProps): ReactNode {
  return (
    <Tool {...props}>
      <ToolHeader
        state={state}
        icon={icon}
        label={label}
        subject={subject}
        subjectIsCode={subjectIsCode}
      />
      <ToolContent>
        <ToolInput block={input} />
        <ToolOutput block={output} errorText={errorText} />
      </ToolContent>
    </Tool>
  );
}

/** A quiet note between a transcript's rows: what was left out, or what stands in a row's place. */
export function TranscriptNote({ className, ...props }: ComponentProps<"p">): ReactNode {
  return <p className={cn("m-0 text-[11.5px] text-muted-foreground", className)} {...props} />;
}
