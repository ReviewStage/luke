import { ArrowUpIcon, Loader2Icon, SquareIcon } from "lucide-react";
import {
  type ComponentProps,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
  useState,
} from "react";
import { cn } from "./utils";

/**
 * prompt-input.tsx -- AI Elements' PromptInput: the box a message to a model is written in, and the row of controls under it.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: one rounded card on the panel's raised
 * surface behind its hairline, which brightens while the card holds focus,
 * the textarea in the panel's own font sizing itself to its words from one
 * line to about eight and scrolling past that, and under it a footer with
 * whatever the owner puts at either end. The field is the panel's font and
 * no border because base.css resets a textarea to that, where Tailwind's
 * preflight would have; the utilities here say only what the reset does
 * not. The registry's
 * attachments, speech button, selects, hover cards, tabs, and command
 * palette are not here, because nothing draws them yet; each arrives with
 * the surface that first does, and the submit button's status icons are
 * the registry's own.
 *
 * Two changes of substance from the registry. The form reads the words
 * from the textarea named `message` as the registry does, but it does not
 * reset itself after a submit: the owner holds the words, controlled, and
 * clears them once the message has gone, so a message that did not go
 * stays in the box to be sent again. And the textarea runs the owner's
 * `onKeyDown` before its own Enter handling and stops where the owner
 * prevented the default, so an owner can give a modified Enter a meaning
 * of its own without re-stating what plain Enter and Shift+Enter do.
 *
 * The submit is drawn the way Claude's and ChatGPT's are: one round
 * button that never changes size or place, filled in the panel's ink with
 * its glyph in the surface's own colour while it takes a press, and dimmed
 * to the raised ground with a muted glyph while it does not. Both are the
 * tokens above, never an opacity over the filled one, so the glyph stays
 * a colour apart from its disc in either state. Note that the colours are
 * utilities on a `button`, which base.css resets in its `base` layer under
 * them, because a reset outside every layer would outrank them and draw
 * the arrow in the disc's own colour.
 */

type PromptInputMessage = {
  text: string;
};

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void;
};

/** The name the textarea stands under in its form, which the form reads the words back by. */
const MESSAGE_FIELD = "message";

export function PromptInput({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps): ReactNode {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem(MESSAGE_FIELD);
    onSubmit({ text: field instanceof HTMLTextAreaElement ? field.value : "" }, event);
  };
  return (
    <form
      className={cn(
        "flex w-full flex-col rounded-xl border border-border bg-muted transition-colors focus-within:border-muted-foreground/40",
        className,
      )}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </form>
  );
}

export type PromptInputTextareaProps = ComponentProps<"textarea">;

/**
 * The field itself. Enter submits the form around it, unless the submit
 * button is disabled or an input method is still composing; Shift+Enter is
 * left to the browser, which is a new line.
 */
export function PromptInputTextarea({
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps): ReactNode {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "Enter") return;
    if (isComposing || event.nativeEvent.isComposing) return;
    if (event.shiftKey) return;
    event.preventDefault();
    const form = event.currentTarget.form;
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit?.disabled) return;
    form?.requestSubmit();
  };

  return (
    <textarea
      className={cn(
        "field-sizing-content max-h-[calc(8*1.45em+20px)] min-h-[calc(1.45em+20px)] w-full resize-none overflow-y-auto bg-transparent px-3 py-[10px] text-[13px] leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60",
        className,
      )}
      name={MESSAGE_FIELD}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      {...props}
    />
  );
}

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

/** The row under the field: what the owner puts at its left and at its right. */
export function PromptInputFooter({ className, ...props }: PromptInputFooterProps): ReactNode {
  return (
    <div
      className={cn("flex items-center justify-between gap-1 px-2 pb-2", className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputTools({ className, ...props }: PromptInputToolsProps): ReactNode {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

/** Where the exchange stands, which decides the submit's icon: the registry's `ChatStatus` words. */
export const PROMPT_INPUT_STATUS = {
  READY: "ready",
  SUBMITTED: "submitted",
  STREAMING: "streaming",
} as const;

type PromptInputStatus = (typeof PROMPT_INPUT_STATUS)[keyof typeof PROMPT_INPUT_STATUS];

export type PromptInputSubmitProps = ComponentProps<"button"> & {
  status?: PromptInputStatus;
};

/** The submit: a filled round 28px button that sends, or shows that a send is out or a reply streams; an owner may make the streaming one its Stop. */
export function PromptInputSubmit({
  className,
  status = PROMPT_INPUT_STATUS.READY,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps): ReactNode {
  let icon = <ArrowUpIcon className="size-4" />;
  if (status === PROMPT_INPUT_STATUS.SUBMITTED) {
    icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === PROMPT_INPUT_STATUS.STREAMING) {
    // Filled, as every chat draws its Stop; the registry's outline reads as a checkbox at this size.
    icon = <SquareIcon className="size-3.5 fill-current" />;
  }
  return (
    <button
      type="submit"
      aria-label="Send"
      aria-disabled={disabled === true ? true : undefined}
      className={cn(
        "flex size-7 cursor-default items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors disabled:bg-secondary disabled:text-muted-foreground",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children ?? icon}
    </button>
  );
}
