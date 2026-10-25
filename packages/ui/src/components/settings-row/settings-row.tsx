import { type ReactNode, useId } from "react";
import { cn } from "../../cn.js";
import { CheckIcon } from "../../face/glyphs.js";
import { AlertIcon } from "../../icons/lucide-glyphs.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../shadcn/item.js";
import { ANNOUNCE } from "../announcer/announcer.js";
import { ErrorLine } from "../error-line/error-line.js";
import { LANDED, landedMark } from "../landed/landed.js";
import { GAP, type Gap, Inline } from "../layout/layout.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * settings-row.tsx -- one setting on a line: its name and what it does on the left, the control that sets it at the end, and what went wrong with its last write under both.
 *
 * The row mints the ids and hands its controls what they need to be read
 * with its words: the label's id, for a control named by `aria-labelledby`,
 * and the description and the error, which describe it. The error is the
 * one `ErrorLine` a form field's is too, said as an alert, since a write
 * that was refused is one the developer believes landed. The row is its own inline-size
 * container, so where its controls stand is decided by the row's width and
 * not the window's: under 380px they stay on the name's line, the name
 * fading where it is cut and only the description wrapping, and they drop
 * below the words to the row's end only where the words would be left with
 * too little room beside them.
 * The row owns its padding, the least height its profile gives a row (the
 * window's rows stand even whether or not they carry a description), and the
 * room between its parts; its edges and the rules between rows are its
 * section's.
 *
 * A row that stands for someone or something of its own, an account or a
 * provider, leads with its face or mark (`leading`), centred before its
 * words. The mark stays beside the words when the controls drop below them,
 * and names nothing: the label alone names the row's control.
 *
 * A compact row (`SETTINGS_ROW_DENSITY.COMPACT`) stands bare, without
 * padding and at a menu row's least height, where the surface around it, a
 * popover, already insets it. Unlike a card's row it does not stack under
 * 380px: a popover is narrower than that throughout, so its controls stay
 * beside its words and wrap below them only where they cannot fit at all.
 *
 * A list row (`SETTINGS_ROW_DENSITY.LIST`) is a card's row read rather than
 * set, a line of a reference list such as the window's keyboard shortcuts:
 * padded at the card's inline inset, ruled, and narrowing under 380px as a
 * card's row does, but at a list's tighter block inset and least height and
 * with its label at body weight.
 *
 * What rides the label's line without being its name, a Modified word or a
 * mark that something needs a hand, is the row's `adornment`: it stands after
 * the label, a short step off it, and the label alone still names the
 * control. What the row itself grows under its line, a control that needs
 * the row's whole width such as a gallery of faces, or the field a stored
 * key is replaced in, is its `below`: it stands inside the row's rule, inset
 * to the words where a mark leads them, handed the same ids, so the label
 * still names it and the description and the error still describe it; the
 * row's error stands under it, so a refusal reads after the thing refused.
 * `below` is for content the row owns alone, never a layout of the page's:
 * a page lays itself out with sections and rows. A row that belongs to the
 * row above it, an account under its provider, is indented
 * (`SETTINGS_ROW_INDENT.MARK`) to its parent's words, its rule starting
 * there too, so the card reads as one subject with its parts under it.
 *
 * A row whose one control is set by a press, a switch, says so
 * (`labelsControl`): its label is then that control's `<label>`, so a press
 * on the words sets it as a press on the control does, and under a finger
 * a press anywhere on the row does; and the control, as narrow as a word,
 * stays beside the words at any width rather than dropping under them. The
 * control wears the id the row hands it (`controlId`).
 *
 * A row that just arrived, a skill just installed, says so (`landed`): it
 * is lit as every place landed on is (`../landed/landed.ts`), its wash a
 * step inside the card it stands flush in, so the eye finds it among the
 * rest; reduced motion keeps the wash, still, for as long.
 *
 * It is drawn by shadcn/ui's item (`../../shadcn/item.tsx`) in Tailwind
 * utilities over the theme, the row's density picking the item's padding and
 * least height. What a utility cannot say stays in `settings-row.css`: the
 * narrow container's rules and the properties they undo, a finger's
 * whole-row press, and the size of a glyph another component draws in a
 * mark.
 */

/** How a row stands: padded in a section's card, a reference list's line in one, or bare inside a surface that insets it. */
export const SETTINGS_ROW_DENSITY = {
  CARD: "card",
  COMPACT: "compact",
  LIST: "list",
} as const;

export type SettingsRowDensity = (typeof SETTINGS_ROW_DENSITY)[keyof typeof SETTINGS_ROW_DENSITY];

/** Where a row's edge stands: at the card's, or at the words of a parent row a mark leads. */
export const SETTINGS_ROW_INDENT = {
  NONE: "none",
  MARK: "mark",
} as const;

export type SettingsRowIndent = (typeof SETTINGS_ROW_INDENT)[keyof typeof SETTINGS_ROW_INDENT];

/** What a row hands the controls it holds. */
export interface SettingsRowControl {
  /** The label's id, for a control named by `aria-labelledby`. */
  readonly labelId: string;
  /** The id the row's one control wears, which its label names where the row `labelsControl`. */
  readonly controlId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

/** Whether a row's words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/**
 * The label's type at each density: a setting's name at a label's weight, a
 * reference list's line at the body's, since it is read rather than set.
 */
const LABEL_CLASS = {
  [SETTINGS_ROW_DENSITY.CARD]:
    "luke-settings-row-label font-sans text-label font-label text-foreground",
  [SETTINGS_ROW_DENSITY.COMPACT]:
    "luke-settings-row-label font-sans text-label font-label text-foreground",
  [SETTINGS_ROW_DENSITY.LIST]:
    "luke-settings-row-label font-sans text-label font-text text-foreground",
} as const satisfies Record<SettingsRowDensity, string>;

/** The row's name: the `<label>` of the control it sets where it labels one, words beside its controls otherwise. */
function RowLabel({
  id,
  control,
  density,
  children,
}: {
  id: string;
  control: string | undefined;
  density: SettingsRowDensity;
  children: ReactNode;
}): React.JSX.Element {
  if (control === undefined) {
    return (
      <span className={LABEL_CLASS[density]} id={id}>
        {children}
      </span>
    );
  }
  return (
    <label className={LABEL_CLASS[density]} id={id} htmlFor={control}>
      {children}
    </label>
  );
}

/** A setting named `label`, described by `description`, set by `children`, and failed by `error` while it says something. */
export function SettingsRow({
  label,
  description,
  error,
  leading,
  adornment,
  density = SETTINGS_ROW_DENSITY.CARD,
  indent = SETTINGS_ROW_INDENT.NONE,
  labelsControl = false,
  landed = false,
  children,
  below,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The face or mark the row leads with, before its words, where it stands for something of its own. */
  leading?: ReactNode;
  /** What rides the label's line after it without naming the control: a Modified word, a mark. */
  adornment?: ReactNode;
  /** What went wrong with the last write, or nothing while none did. */
  error?: ReactNode;
  /** How the row stands; in a section's card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** Where the row's edge stands; at the card's where none is named. */
  indent?: SettingsRowIndent | undefined;
  /** Whether the row's words label its one control, a switch, wearing `controlId`: a press on them sets it, and it stays beside them. */
  labelsControl?: boolean | undefined;
  /** Whether the row just arrived, which lights it once. */
  landed?: boolean | undefined;
  /** The row's controls at its end, handed the row's ids to name and describe them by. */
  children?: ((control: SettingsRowControl) => ReactNode) | undefined;
  /** What the row grows under its words and owns alone, handed the same ids; never a page's layout. */
  below?: ((control: SettingsRowControl) => ReactNode) | undefined;
}): React.JSX.Element {
  const id = useId();
  const labelId = `${id}label`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const controlId = `${id}control`;
  const failed = said(error);
  const described = said(description);
  const led = said(leading);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  const control: SettingsRowControl = {
    labelId,
    controlId,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": failed ? true : undefined,
  };
  const name = (
    <RowLabel id={labelId} control={labelsControl ? controlId : undefined} density={density}>
      {label}
    </RowLabel>
  );
  return (
    <div
      className="luke-settings-row @container/luke-settings-row min-w-0 data-[indent=mark]:ms-settings-row-indent"
      data-invalid={failed}
      data-density={density}
      data-indent={indent}
      data-labels-control={labelsControl}
      {...landedMark(landed, LANDED.WITHIN)}
    >
      <Item size={density} className={indent === SETTINGS_ROW_INDENT.MARK ? "ps-0" : undefined}>
        <div
          className={
            density === SETTINGS_ROW_DENSITY.COMPACT
              ? "luke-settings-row-line flex flex-wrap items-center"
              : "luke-settings-row-line flex items-center"
          }
        >
          <div className="luke-settings-row-subject flex min-w-0 items-center gap-luke-12">
            {led ? <ItemMedia>{leading}</ItemMedia> : null}
            <ItemContent>
              {said(adornment) ? (
                <ItemTitle>
                  {name}
                  {adornment}
                </ItemTitle>
              ) : (
                name
              )}
              {described ? (
                <ItemDescription id={descriptionId}>{description}</ItemDescription>
              ) : null}
            </ItemContent>
          </div>
          <ItemActions>{children?.(control)}</ItemActions>
        </div>
        {below === undefined ? null : (
          <div
            className={
              led
                ? "luke-settings-row-below mt-luke-8 min-w-0 ps-settings-row-words-inset"
                : "luke-settings-row-below mt-luke-8 min-w-0"
            }
            data-led={led}
          >
            {below(control)}
          </div>
        )}
        <ErrorLine id={errorId} level={ANNOUNCE.ALERT}>
          {failed ? error : null}
        </ErrorLine>
      </Item>
    </div>
  );
}

/** The box a provider's or a service's mark leads its row in, one size whatever the artwork's proportions. */
export function SettingsRowMark({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="luke-settings-row-mark grid size-settings-row-mark flex-none place-items-center">
      {children}
    </span>
  );
}

/** Where a row's subject stands, as its line under the name says it. */
export const SETTINGS_ROW_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  PLAIN: "plain",
} as const;

export type SettingsRowState = (typeof SETTINGS_ROW_STATE)[keyof typeof SETTINGS_ROW_STATE];

/** What each state draws: the finished session's dot before the words, the attention tint, or nothing. */
const STATE_CLASS = {
  [SETTINGS_ROW_STATE.CONNECTED]:
    "before:size-settings-row-state-dot before:flex-none before:rounded-luke-full before:bg-complete",
  [SETTINGS_ROW_STATE.ATTENTION]: "text-attention",
  [SETTINGS_ROW_STATE.PLAIN]: "",
} as const satisfies Record<SettingsRowState, string>;

/**
 * Where a row's subject stands, under its name: connected with the dot a
 * finished session wears, what needs a hand in the attention tint, or plain.
 * `block` stands it on a line of its own under the row's description, and
 * `wrap` lets its parts break between each other, never inside one.
 */
export function SettingsRowStateLine({
  state = SETTINGS_ROW_STATE.PLAIN,
  block = false,
  wrap = false,
  role,
  children,
}: {
  state?: SettingsRowState;
  block?: boolean;
  wrap?: boolean;
  role?: "alert" | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "luke-settings-row-state items-center gap-luke-6",
        block ? "flex w-fit" : "inline-flex",
        wrap && "flex-wrap whitespace-nowrap",
        STATE_CLASS[state],
      )}
      data-state={state}
      data-block={block ? "" : undefined}
      data-wrap={wrap ? "" : undefined}
      role={role}
    >
      {children}
    </span>
  );
}

/** A value a row ends in, in a column of its own: a member's role, as the shortcuts page sets a chord. */
export function SettingsRowValue({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="luke-settings-row-value min-w-luke-64 flex-none text-right text-body text-muted-foreground">
      {children}
    </span>
  );
}

/** The room of a row's ⋯ on a row with none, so every row's value ends in one column. */
export function SettingsRowActSlot(): React.JSX.Element {
  return <span className="luke-settings-row-act-slot w-control flex-none" aria-hidden="true" />;
}

/** What is true of a saved credential, on one muted line beside its presses: its hint, its login, its status, wrapping between facts, never inside one. */
export function SettingsFacts({
  gap = GAP.CONTROL,
  children,
}: {
  gap?: Gap;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.INHERIT} tone={TEXT_TONE.MUTED}>
      <Inline gap={gap}>{children}</Inline>
    </Text>
  );
}

/** The complete green's check a saved credential or a connected row ends in. */
export function SettingsSavedMark(): React.JSX.Element {
  return (
    <span className="luke-settings-saved-mark inline-flex text-complete in-[.luke-button]:ml-luke-4">
      <CheckIcon />
    </span>
  );
}

/** The word beside a row's name while its value differs from the default: a fact about a preference, never an urgency. */
export function SettingsChangedMark(): React.JSX.Element {
  return (
    <span className="luke-settings-changed-mark text-caption leading-tag font-tag text-muted-foreground">
      Modified
    </span>
  );
}

/** The small mark beside a name while the feature it belongs to still needs a hand, its `note` the hover's and the screen reader's words. */
export function SettingsAttentionMark({ note }: { note: string }): React.JSX.Element {
  return (
    <span
      className="luke-settings-attention-mark inline-flex flex-none text-attention"
      title={note}
    >
      <AlertIcon />
      <VisuallyHidden>({note})</VisuallyHidden>
    </span>
  );
}
