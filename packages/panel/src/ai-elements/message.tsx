import { useAtomValue } from "@effect/atom-react";
import {
  BUTTON_SIZE,
  cn,
  IconButton,
  MessageFrame,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@repo/ui";
import {
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
  type MarkdownProps,
} from "@repo/ui/markdown";
import { QUOTE_CLASS } from "@repo/ui/quote-face";
import type { UIMessage } from "ai";
import { AsyncResult } from "effect/reactivity";
import { type HTMLAttributes, memo, type ReactNode } from "react";
import { markdownHtmlParserAtom } from "../markdown-html-parser.js";

export type MessageProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick"> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <MessageFrame
      revealActionsOnTap
      className={cn(
        "transcript-message group/message relative flex w-full flex-col gap-tight-gap",
        from === "user"
          ? "is-user ml-auto max-w-bubble items-end justify-end data-editing:items-stretch"
          : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}

export const RECEIVED_MESSAGE_CLASS = "is-received mr-auto max-w-bubble items-start";

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps): ReactNode {
  return (
    <div
      className={cn(
        "message-content min-w-0 max-w-full overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)] text-body leading-reading text-foreground",
        "group-[:is(.is-user,.is-received)]/message:w-fit group-[:is(.is-user,.is-received)]/message:rounded-ui-14 group-[:is(.is-user,.is-received)]/message:bg-fill-strong group-[:is(.is-user,.is-received)]/message:px-list-inset group-[:is(.is-user,.is-received)]/message:py-row-inset",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageBeside({
  mark,
  children,
}: {
  mark: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="message-beside flex min-w-0 max-w-full items-center justify-end gap-tight-gap">
      {children}
      {mark}
    </div>
  );
}

export type MessageActionProps = {
  label: string;
  tooltip?: boolean | string;
  card?: ReactNode;
  onClick: () => void;
  children: ReactNode;
};

export function MessageAction({
  label,
  tooltip = false,
  card,
  onClick,
  children,
}: MessageActionProps): ReactNode {
  const button = (
    <IconButton icon={children} label={label} size={BUTTON_SIZE.COMPACT} onClick={onClick} />
  );
  if (card !== undefined) {
    return (
      <Tooltip label={label} card={card}>
        {button}
      </Tooltip>
    );
  }
  if (tooltip === false) return button;
  return <Tooltip label={tooltip === true ? label : tooltip}>{button}</Tooltip>;
}

const TRANSCRIPT_HEADING = {
  1: TEXT_VARIANT.DIALOG,
  2: TEXT_VARIANT.SECTION,
  3: TEXT_VARIANT.SECTION,
  4: TEXT_VARIANT.SECTION,
  5: TEXT_VARIANT.SECTION,
  6: TEXT_VARIANT.SECTION,
} as const;

function TranscriptHeading({
  level,
  children,
}: {
  level: keyof typeof TRANSCRIPT_HEADING;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.P}
      variant={TRANSCRIPT_HEADING[level]}
      className="transcript-heading mx-0 mt-control-gap mb-tight-gap data-[level=1]:mt-block-gap data-[level=2]:mt-block-gap"
      data-level={level}
    >
      {children}
    </Text>
  );
}

export const PANEL_MARKDOWN_COMPONENTS: MarkdownComponents = {
  h1: ({ children }) => <TranscriptHeading level={1}>{children}</TranscriptHeading>,
  h2: ({ children }) => <TranscriptHeading level={2}>{children}</TranscriptHeading>,
  h3: ({ children }) => <TranscriptHeading level={3}>{children}</TranscriptHeading>,
  h4: ({ children }) => <TranscriptHeading level={4}>{children}</TranscriptHeading>,
  h5: ({ children }) => <TranscriptHeading level={5}>{children}</TranscriptHeading>,
  h6: ({ children }) => <TranscriptHeading level={6}>{children}</TranscriptHeading>,
  ul: ({ children }) => <ul className="my-tight-gap list-disc pl-ui-20">{children}</ul>,
  ol: ({ children }) => <ol className="my-tight-gap list-decimal pl-ui-20">{children}</ol>,
  li: ({ children }) => <li className="my-list-gap">{children}</li>,
  blockquote: ({ children }) => <blockquote className={QUOTE_CLASS}>{children}</blockquote>,
};

export type MessageResponseProps = Omit<MarkdownProps, "look" | "className"> & {
  line?: boolean | undefined;
};

export const MessageResponse = memo(
  ({ line = false, ...props }: MessageResponseProps): ReactNode => {
    const parser = useAtomValue(markdownHtmlParserAtom);
    if (AsyncResult.isInitial(parser)) return null;
    return (
      <Markdown
        look={line ? MARKDOWN_LOOK.TRANSCRIPT_LINE : MARKDOWN_LOOK.TRANSCRIPT}
        className="transcript-markdown"
        {...props}
      />
    );
  },
);

MessageResponse.displayName = "MessageResponse";
