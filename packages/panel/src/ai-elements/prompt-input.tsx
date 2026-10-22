import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  type ButtonType,
  cn,
  IconButton,
  SUBMIT_STATE,
  type SubmitState,
} from "@luke/ui";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  FormEventHandler,
  HTMLAttributes,
  ReactNode,
} from "react";

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
 * The registry's attachments,
 * speech button, selects, hover cards, tabs, and command palette are not
 * here, because nothing draws them yet; each arrives with the surface that
 * first does, and the submit's status glyphs are the shared submit's
 * (`@luke/ui`'s IconButton).
 *
 * One change of substance from the registry: the form neither reads the
 * words back from its field nor resets itself after a submit: the owner
 * holds the words and clears them once the message has gone, so a message
 * that did not go stays in the box to be sent again. The registry's
 * textarea is not here: both boxes draw an editor in its place
 * (`../tasks/composer-field.tsx`), whose Enter submits through the one
 * door (`submitPromptInput`).
 *
 * The submit is drawn the way Claude's and ChatGPT's are: one round
 * button that never changes size or place, filled in the panel's ink with
 * its glyph in the surface's own colour while it takes a press, and dimmed
 * to the raised ground with a muted glyph while it does not. Both are the
 * shared submit's own, never an opacity over the filled one, so the glyph
 * stays a colour apart from its disc in either state. The card and its foot
 * wear their own classes (`.prompt-input*`, tasks.css) on luke tokens, and
 * an owner's class beside them places the card in its surface.
 */

/** What the window's hint hands the submit it wraps: when to show and go, and the chord it names. */
type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "aria-keyshortcuts"
>;

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: () => void;
};

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
    <form className={cn("prompt-input", className)} onSubmit={handleSubmit} {...props}>
      {children}
    </form>
  );
}

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
  return <div className={cn("prompt-input-footer", className)} {...props} />;
}

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

/** The footer's left: the owner's controls, or nothing, which still holds the submit at the right. */
export function PromptInputTools({ className, ...props }: PromptInputToolsProps): ReactNode {
  return <div className={cn("prompt-input-tools", className)} {...props} />;
}

export type PromptInputSubmitProps = HintProps & {
  /** What it does, which is its accessible name: Send, or its owner's Stop. */
  label: string;
  /** Where the exchange stands, which decides its glyph: the registry's `ChatStatus` words. */
  status?: SubmitState;
  /** Whether it submits the form, as it does by default, or does `onClick` alone, as a Stop does. */
  type?: ButtonType;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
} & (
    | { busy?: false | undefined; busyLabel?: undefined }
    | {
        /** Whether a send it made is still out: it takes no press, and is named and announced as `busyLabel` meanwhile. */
        busy: boolean;
        busyLabel: string;
      }
  );

/** The submit: the shared round submit in the panel's ink that sends, or shows that a send is out or a reply streams; an owner may make the streaming one its Stop. */
export function PromptInputSubmit({
  label,
  status = SUBMIT_STATE.READY,
  type = BUTTON_TYPE.SUBMIT,
  ...props
}: PromptInputSubmitProps): ReactNode {
  return (
    <IconButton submit={status} label={label} type={type} variant={BUTTON_VARIANT.INK} {...props} />
  );
}
