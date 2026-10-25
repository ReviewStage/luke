import { COMPOSER_ELEMENT, ComposerFrame, cn } from "@luke/ui";
import type { FormEventHandler, HTMLAttributes, ReactNode } from "react";

/**
 * prompt-input.tsx -- AI Elements' PromptInput as Luke's one composer: the card a message is written in.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled on the corner and the hairline the window's menus and cards
 * share: one card on the sidebar's ground, ringed as every field is while
 * its field holds the caret (base.css), and nothing drawn behind it, so no
 * shadow darkens the page or the transcript around the card. The field
 * sizes itself to its words from one line to about eight and scrolls past
 * that, and under it stands the box's foot (`@luke/ui`'s `ComposerFoot`),
 * which draws the tools, the files and the round submit. The agent tab's
 * message box and the Inbox's draw this one card, so a change here is the
 * look of both. The registry's attachments, speech button, selects, hover
 * cards, tabs, and command palette are not here, because nothing draws
 * them yet; each arrives with the surface that first does.
 *
 * One change of substance from the registry: the form neither reads the
 * words back from its field nor resets itself after a submit: the owner
 * holds the words and clears them once the message has gone, so a message
 * that did not go stays in the box to be sent again. The registry's
 * textarea is not here: both boxes draw an editor in its place
 * (`../tasks/composer-field.tsx`), whose Enter submits through the one
 * door (`submitPromptInput`).
 *
 * The card is `@luke/ui`'s `ComposerFrame`, its edge brightened while files
 * are dragged over it; `.prompt-input*` (tasks.css) lays out what it holds,
 * and an owner's class beside them places the card in its surface.
 */

/** The card's own class, which `.prompt-input*` (tasks.css) lays out from. */
const PROMPT_INPUT_CLASS = "prompt-input flex w-full flex-col";

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "className" | "children"
> & {
  onSubmit: () => void;
  /** The owner's class, which places the card in its surface. */
  className?: string | undefined;
  /** Whether files are dragged over the box, which brightens its edge. */
  dropping?: boolean | undefined;
  children: ReactNode;
};

export function PromptInput({
  className,
  onSubmit,
  dropping = false,
  children,
  ...props
}: PromptInputProps): ReactNode {
  const handleSubmit: FormEventHandler<HTMLElement> = (event) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <ComposerFrame
      as={COMPOSER_ELEMENT.FORM}
      className={cn(PROMPT_INPUT_CLASS, className)}
      dropping={dropping}
      onSubmit={handleSubmit}
      {...props}
    >
      {children}
    </ComposerFrame>
  );
}

/** The card standing still, with no form around it: its frame and layout alone, as a box's placeholder draws them. */
export function PromptInputCard({ children }: { children: ReactNode }): ReactNode {
  return <ComposerFrame className={PROMPT_INPUT_CLASS}>{children}</ComposerFrame>;
}

/** Submits the form around a field, as Enter there does, unless its submit button is disabled. */
export function submitPromptInput(field: Element): void {
  const form = field.closest("form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit?.disabled) return;
  form?.requestSubmit();
}
