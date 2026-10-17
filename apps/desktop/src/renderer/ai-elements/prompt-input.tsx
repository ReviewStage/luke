import { cn } from "@luke/ui";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ComponentProps, FormEventHandler, HTMLAttributes, ReactNode } from "react";
import { SpinnerRing } from "../spinner";

/**
 * prompt-input.tsx -- AI Elements' PromptInput as Luke's one composer: the card a message is written in, and the row of controls under it.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled on the corner and the
 * hairline the window's menus and cards share: one card on the sidebar's
 * ground, ringed as every field is while its field holds the caret
 * (base.css), and nothing drawn behind it, so no shadow darkens the page or the
 * transcript around the card. The field
 * sizing itself to its words from one line to about eight and scrolling
 * past that, and under it a footer with whatever the owner puts at its
 * left and the round submit at its right. The agent tab's message box and
 * the Inbox's draw this one card, so a change here is the look of both.
 * Its type is one variable (`--composer-type`), set on the card, from which
 * the field's line and so its least and greatest heights follow.
 * The registry's attachments,
 * speech button, selects, hover cards, tabs, and command palette are not
 * here, because nothing draws them yet; each arrives with the surface that
 * first does, and the submit button's status icons are the registry's own.
 *
 * One change of substance from the registry: the form neither reads the
 * words back from its field nor resets itself after a submit: the owner
 * holds the words and clears them once the message has gone, so a message
 * that did not go stays in the box to be sent again. The registry's
 * textarea is not here: both boxes draw an editor in its place
 * (`../tasks/composer-field.tsx`) in its look (`PROMPT_INPUT_FIELD_CLASS`),
 * whose Enter submits through the one door (`submitPromptInput`).
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

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: () => void;
};

/** The card's one size: the type its field is set in. */
const COMPOSER_TYPE = {
  /** A message box under a transcript. */
  DEFAULT: "[--composer-type:13px]",
} as const;

export function PromptInput({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps): ReactNode {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form
      className={cn(
        COMPOSER_TYPE.DEFAULT,
        "field-well flex w-full flex-col rounded-xl border border-border bg-card",
        className,
      )}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </form>
  );
}

/** The field's look: one line to about eight, then scrolling, in the card's type. */
export const PROMPT_INPUT_FIELD_CLASS =
  "max-h-[calc(8*1.45em+24px)] min-h-[calc(1.45em+24px)] w-full overflow-y-auto bg-transparent px-4 pt-4 pb-2 text-(length:--composer-type) leading-[1.45] text-foreground outline-none select-text";

/** Submits the form around a field, as Enter there does, unless its submit button is disabled. */
export function submitPromptInput(field: Element): void {
  const form = field.closest("form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit?.disabled) return;
  form?.requestSubmit();
}

export type PromptInputFooterProps = ComponentProps<"div">;

/** The row under the field: what the owner puts at its left and at its right. */
export function PromptInputFooter({ className, ...props }: PromptInputFooterProps): ReactNode {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 px-3 pb-3", className)}
      {...props}
    />
  );
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

/** The footer's left: the owner's controls, or nothing, which still holds the submit at the right. */
export function PromptInputTools({ className, ...props }: PromptInputToolsProps): ReactNode {
  return <div className={cn("flex min-w-0 items-center gap-1", className)} {...props} />;
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

/** The submit: a filled round button at the window's control height that sends, or shows that a send is out or a reply streams; an owner may make the streaming one its Stop. */
export function PromptInputSubmit({
  className,
  status = PROMPT_INPUT_STATUS.READY,
  disabled,
  children,
  ...props
}: PromptInputSubmitProps): ReactNode {
  let icon = <ArrowUpIcon className="size-[15px]" />;
  if (status === PROMPT_INPUT_STATUS.SUBMITTED) {
    icon = (
      <span className="size-[15px]">
        <SpinnerRing />
      </span>
    );
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
        "flex size-[30px] shrink-0 cursor-default items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors disabled:bg-secondary disabled:text-muted-foreground",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children ?? icon}
    </button>
  );
}
