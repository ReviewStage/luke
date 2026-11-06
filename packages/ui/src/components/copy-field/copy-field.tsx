import { BUTTON_SIZE } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export const COPY_FIELD_WIDTH = {
  CONTROL: "control",
  FULL: "full",
  HUG: "hug",
} as const;

export type CopyFieldWidth = (typeof COPY_FIELD_WIDTH)[keyof typeof COPY_FIELD_WIDTH];

export const COPY_FIELD_PROMPT = {
  NONE: "none",
  SHELL: "shell",
} as const;

export type CopyFieldPrompt = (typeof COPY_FIELD_PROMPT)[keyof typeof COPY_FIELD_PROMPT];

const BLOCK =
  "ui-copy-field flex h-control items-center gap-ui-8 rounded-control border border-border bg-well py-0 pr-ui-2 pl-list-inset font-mono text-label text-code";

const BLOCK_WIDTH = {
  [COPY_FIELD_WIDTH.CONTROL]: "w-copy-field max-w-full",
  [COPY_FIELD_WIDTH.FULL]: "w-full min-w-0",
  [COPY_FIELD_WIDTH.HUG]: "w-fit max-w-full",
} as const satisfies Record<CopyFieldWidth, string>;

const VALUE =
  "ui-copy-field-value min-w-0 flex-1 overflow-x-auto overscroll-x-contain whitespace-pre select-text [font:inherit] [scrollbar-width:none]";

const PROMPT = "flex-none select-none text-muted-foreground";

export function CopyField({
  label,
  value,
  what,
  copy,
  width = COPY_FIELD_WIDTH.CONTROL,
  prompt = COPY_FIELD_PROMPT.NONE,
}: {
  label: string;
  value: string;
  what: string;
  copy: (text: string) => Promise<void>;
  width?: CopyFieldWidth | undefined;
  prompt?: CopyFieldPrompt | undefined;
}): React.JSX.Element {
  return (
    <span className={`${BLOCK} ${BLOCK_WIDTH[width]}`}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {prompt === COPY_FIELD_PROMPT.SHELL ? (
        <span className={PROMPT} aria-hidden="true">
          $
        </span>
      ) : null}
      <code className={VALUE}>{value}</code>
      <CopyButton text={value} what={what} copy={copy} size={BUTTON_SIZE.COMPACT} />
    </span>
  );
}
