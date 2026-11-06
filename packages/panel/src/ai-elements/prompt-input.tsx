import { COMPOSER_ELEMENT, ComposerFrame, cn } from "@repo/ui";
import type { FormEventHandler, HTMLAttributes, ReactNode } from "react";

const PROMPT_INPUT_CLASS = "prompt-input flex w-full flex-col";

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "className" | "children"
> & {
  onSubmit: () => void;
  className?: string | undefined;
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

export function PromptInputCard({ children }: { children: ReactNode }): ReactNode {
  return <ComposerFrame className={PROMPT_INPUT_CLASS}>{children}</ComposerFrame>;
}

export function submitPromptInput(field: Element): void {
  const form = field.closest("form");
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit?.disabled) return;
  form?.requestSubmit();
}
