import { BUTTON_SIZE } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * copy-field.tsx -- a value shown to be copied whole: one line of code on a quiet well, selectable but never a field, with the one Copy inside its right edge.
 *
 * What a person takes elsewhere stands here, a webhook's address and its
 * secret, or the address and the command that connect an agent. It is drawn
 * as a block of code rather than a text box, as a devtool's docs draw a
 * command: the well's ground under a hairline, the words in the code face
 * and the code's ink, and no caret, ring, or inset edge that would say the
 * words can be changed. They can still be selected, by whoever wants a part
 * of them. A shell command leads with a muted `$` (`COPY_FIELD_PROMPT.SHELL`)
 * that is neither selected nor copied nor read aloud; an address or a secret
 * goes without.
 *
 * A reader hears the block's `label` before its value, and its one control
 * is the `CopyButton` at its right edge, named for what it copies, which turns to
 * the check and says "Copied" as every Copy does. Note that a press on the
 * words copies nothing, because a press there is how a person starts a
 * selection, and a second way to copy would be a second control no keyboard
 * reaches. A value longer than the block stays one line and scrolls sideways
 * within it, its end fading under the Copy (`copy-field.css`), rather than
 * wrapping or widening the row. It stands at a picker's width beside a row's
 * words (`COPY_FIELD_WIDTH.CONTROL`), as wide as the row it is laid under
 * (`COPY_FIELD_WIDTH.FULL`), as a command a person reads whole does, or
 * hugging a short value under a step's words (`COPY_FIELD_WIDTH.HUG`), as the
 * buttons beside it hug theirs, up to the row's width. It is
 * drawn in the Tailwind theme's utilities.
 */

/** How wide a copy field stands: a control beside a row's words, the row's whole width under them, or its value's own. */
export const COPY_FIELD_WIDTH = {
  CONTROL: "control",
  FULL: "full",
  HUG: "hug",
} as const;

export type CopyFieldWidth = (typeof COPY_FIELD_WIDTH)[keyof typeof COPY_FIELD_WIDTH];

/** What a copy field's value leads with: nothing, or the shell's `$` before a command. */
export const COPY_FIELD_PROMPT = {
  NONE: "none",
  SHELL: "shell",
} as const;

export type CopyFieldPrompt = (typeof COPY_FIELD_PROMPT)[keyof typeof COPY_FIELD_PROMPT];

/** The block: the well under a hairline, a control tall, the Copy nested inside its right edge. */
const BLOCK =
  "ui-copy-field flex h-control items-center gap-ui-8 rounded-control border border-border bg-well py-0 pr-ui-2 pl-list-inset font-mono text-label text-code";

/** The block's width at each width. */
const BLOCK_WIDTH = {
  [COPY_FIELD_WIDTH.CONTROL]: "w-copy-field max-w-full",
  [COPY_FIELD_WIDTH.FULL]: "w-full min-w-0",
  [COPY_FIELD_WIDTH.HUG]: "w-fit max-w-full",
} as const satisfies Record<CopyFieldWidth, string>;

/** The value on one line, scrolling sideways with no bar, and selectable. */
const VALUE =
  "ui-copy-field-value min-w-0 flex-1 overflow-x-auto overscroll-x-contain whitespace-pre select-text [font:inherit] [scrollbar-width:none]";

/** The shell's prompt, muted, and left out of a selection. */
const PROMPT = "flex-none select-none text-muted-foreground";

/** `value` shown on a well in the code face, named `label`, with a Copy that copies it through `copy`, named "Copy {what}". */
export function CopyField({
  label,
  value,
  what,
  copy,
  width = COPY_FIELD_WIDTH.CONTROL,
  prompt = COPY_FIELD_PROMPT.NONE,
}: {
  /** What the value is named, as a reader hears it. */
  label: string;
  /** The value shown, and copied whole. */
  value: string;
  /** What it copies, as a sentence goes on after "Copy": "address", "command". */
  what: string;
  /** The caller's platform act that puts words on the clipboard; a rejection is a refused copy. */
  copy: (text: string) => Promise<void>;
  width?: CopyFieldWidth | undefined;
  /** What the value leads with: the shell's `$` for a command to run in a terminal. */
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
