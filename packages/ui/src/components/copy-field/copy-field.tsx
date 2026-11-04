import { CopyButton } from "../copy-button/copy-button.js";
import { TEXT_FIELD_FONT, TextField } from "../text-field/text-field.js";

/**
 * copy-field.tsx -- a value shown to be copied whole: one line in the code face that can be selected but not changed, with the one Copy after it.
 *
 * What a person takes elsewhere stands here, a webhook's address and its
 * secret, or the address and the command that connect an agent: the field
 * is named by `label`, and `CopyButton` after it copies the value whole,
 * named for what it copies. A value longer than its field scrolls within
 * it rather than widening the row. It stands at a picker's width beside a
 * row's words (`COPY_FIELD_WIDTH.CONTROL`), or as wide as the row it is
 * laid under (`COPY_FIELD_WIDTH.FULL`), as a command a person reads whole
 * does. It is drawn in the Tailwind theme's utilities.
 */

/** How wide a copy field stands: a control beside a row's words, or the row's whole width under them. */
export const COPY_FIELD_WIDTH = {
  CONTROL: "control",
  FULL: "full",
} as const;

export type CopyFieldWidth = (typeof COPY_FIELD_WIDTH)[keyof typeof COPY_FIELD_WIDTH];

/** The field's width at each width, the Copy standing after it. */
const FIELD_WIDTH = {
  [COPY_FIELD_WIDTH.CONTROL]: "w-copy-field max-w-full",
  [COPY_FIELD_WIDTH.FULL]: "min-w-0 flex-1",
} as const satisfies Record<CopyFieldWidth, string>;

/** The line each width draws the field and its Copy on. */
const LINE = {
  [COPY_FIELD_WIDTH.CONTROL]: "contents",
  [COPY_FIELD_WIDTH.FULL]: "flex w-full items-center gap-ui-8",
} as const satisfies Record<CopyFieldWidth, string>;

/** `value` shown read-only in the code face, named `label`, with a Copy that copies it through `copy`, named "Copy {what}". */
export function CopyField({
  label,
  value,
  what,
  copy,
  width = COPY_FIELD_WIDTH.CONTROL,
}: {
  /** What the field is named, as a reader hears it. */
  label: string;
  /** The value shown, and copied whole. */
  value: string;
  /** What it copies, as a sentence goes on after "Copy": "address", "command". */
  what: string;
  /** The caller's platform act that puts words on the clipboard; a rejection is a refused copy. */
  copy: (text: string) => Promise<void>;
  width?: CopyFieldWidth | undefined;
}): React.JSX.Element {
  return (
    <span className={LINE[width]}>
      <span className={FIELD_WIDTH[width]}>
        <TextField
          label={label}
          font={TEXT_FIELD_FONT.MONO}
          spellCheck={false}
          readOnly
          value={value}
          onChange={() => undefined}
        />
      </span>
      <CopyButton text={value} what={what} copy={copy} />
    </span>
  );
}
