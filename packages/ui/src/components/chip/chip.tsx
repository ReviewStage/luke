import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDownIcon, RemoveIcon } from "../../face/glyphs.js";

/**
 * chip.tsx -- the one chip: a button naming a value or a thing, drawn in the look of the place it stands.
 *
 * A chip is one control of the shared contract, a control's height, corner,
 * glyph, and label type in its profile, and differs only in the look its
 * place asks for:
 *
 * - a toolbar chip, a control that picks what the place it stands in runs
 *   on (a plan toolbar's repository, an agent's model), is quiet until the
 *   pointer is on it or its menu is open, as the toolbar's own buttons are;
 * - a pill, a thing named rather than a setting (what an agent published, the
 *   repository a new plan is for), is a filled, hairlined capsule;
 * - a field, a settings row's value, wears an outlined button's hairline,
 *   its words leading, so a picker and the buttons beside it read as one
 *   column.
 * - a filter, one of a row of pills that narrow a list to one kind (⌘K's
 *   All, Tasks, Files), is a quiet capsule until it stands pressed
 *   (`aria-pressed`), when it fills inside the selection's hairline; its
 *   caller holds which one is pressed.
 *
 * Beside its look a chip may say where a thing stands in the state palette
 * (`tone`), tinted and hairlined in that state's ink, as a pull request's
 * state is; stand at a width its place shares (`width`); and draw its mark
 * alone where its place has no room for its words (`iconOnly`), its words
 * still read as its name. A removable chip (`onRemove`) is no button of its
 * own: it names what stands, a filter applied, and ends in a × named for
 * what lifting it does.
 *
 * A chip comes at the control's size, or compact (`size`), a caption
 * line's pill, where it is one of a row of small counts (a pull request's
 * reactions); a compact filter stands inside a hairline at rest, so the row
 * reads as pills before one is pressed, and pressed is lit in the accent. A busy chip
 * (`busy`), whose change is out, pulses until it is answered.
 *
 * A chip that opens a menu of values ends in the menu's small, muted
 * chevron where `chevron` asks for one. Its words go in a `ChipName`, which
 * cuts them short rather than letting them push past the row around it, in
 * the code face where they name code (`mono`, a branch). A leading mark, a
 * glyph or a picture, stands at the control's glyph size. It takes no class
 * or style: its outer layout is its container's.
 */

/** The looks a chip comes in, by the place it stands. */
export const CHIP_LOOK = {
  TOOLBAR: "toolbar",
  PILL: "pill",
  FIELD: "field",
  FILTER: "filter",
} as const;

export type ChipLook = (typeof CHIP_LOOK)[keyof typeof CHIP_LOOK];

/** How big a chip is: the control's own, or a caption line's pill. */
export const CHIP_SIZE = {
  CONTROL: "control",
  COMPACT: "compact",
} as const;

export type ChipSize = (typeof CHIP_SIZE)[keyof typeof CHIP_SIZE];

/** Where the thing a chip names stands, in the state palette `Badge` says it in. */
export const CHIP_TONE = {
  NEUTRAL: "neutral",
  ATTENTION: "attention",
  COMPLETE: "complete",
  MERGED: "merged",
  DANGER: "danger",
} as const;

export type ChipTone = (typeof CHIP_TONE)[keyof typeof CHIP_TONE];

/**
 * How wide a chip stands: its words' own width; the field column a settings
 * row's pop-ups share, so a change of value cannot re-shape its row; at least
 * that column, growing to name its whole value; or half of it, for a chip
 * choosing among a few short words (a role).
 */
export const CHIP_WIDTH = {
  AUTO: "auto",
  FIELD: "field",
  MIN_FIELD: "min-field",
  FIXED: "fixed",
} as const;

export type ChipWidth = (typeof CHIP_WIDTH)[keyof typeof CHIP_WIDTH];

/** What every chip takes, a button or a removable one: its look and the options beside it. */
interface ChipFace {
  look: ChipLook;
  /** Where the thing it names stands; the look's own ink where none is named. */
  tone?: ChipTone | undefined;
  /** How wide it stands; its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** How big it is; the control's own size where none is named. */
  size?: ChipSize | undefined;
  /** Whether it draws its mark alone, its words read as its name and drawn nowhere. */
  iconOnly?: boolean | undefined;
}

/** A chip that is a button: its face, whether it ends in a menu's chevron, and its button's own attributes. */
type ButtonChipProps = ChipFace & {
  /** Whether the chip ends in a chevron, saying it opens a menu of values. */
  chevron?: boolean;
  /** Whether a change it made is out, which it says, and pulses, until answered. */
  busy?: boolean | undefined;
  onRemove?: never;
} & Omit<ComponentPropsWithRef<"button">, "type" | "style" | "className" | "aria-busy">;

/** A chip naming what stands, ended by the × that lifts it. */
type RemovableChipProps = ChipFace & {
  /** Lifts what the chip names. */
  onRemove: () => void;
  /** What the × does, its name for a reader ("Show everyone's tasks"). */
  removeLabel: string;
  children: ReactNode;
};

export type ChipProps = ButtonChipProps | RemovableChipProps;

/** The attributes a chip's face options draw as, on the button or the removable chip's box alike. */
function faceAttributes({
  look,
  tone,
  width = CHIP_WIDTH.AUTO,
  size = CHIP_SIZE.CONTROL,
  iconOnly = false,
}: ChipFace) {
  return {
    "data-look": look,
    "data-size": size === CHIP_SIZE.COMPACT ? size : undefined,
    "data-tone": tone,
    "data-width": width,
    "data-icon-only": iconOnly ? "true" : undefined,
  };
}

/** A removable chip: its face, then a × named for what it lifts. */
function RemovableChip({
  onRemove,
  removeLabel,
  children,
  ...face
}: RemovableChipProps): React.JSX.Element {
  return (
    <span className="luke-chip" data-removable="true" {...faceAttributes(face)}>
      <span className="luke-chip-face">{children}</span>
      <button
        type="button"
        className="luke-chip-remove"
        aria-label={removeLabel}
        onClick={onRemove}
      >
        <RemoveIcon />
      </button>
    </span>
  );
}

/** A chip: a button in the look of its place, or a removable chip where `onRemove` is given. */
export function Chip(props: ChipProps): React.JSX.Element {
  if (props.onRemove !== undefined) return <RemovableChip {...props} />;
  const { look, tone, width, size, iconOnly, chevron = false, busy, children, ...button } = props;
  return (
    <button
      type="button"
      {...button}
      className="luke-chip"
      aria-busy={busy === true ? true : undefined}
      {...faceAttributes({ look, tone, width, size, iconOnly })}
    >
      <span className="luke-chip-face">
        {children}
        {chevron ? <ChevronDownIcon /> : null}
      </span>
    </button>
  );
}

/** A chip's words, cut short at its end rather than pushing past the row it stands in; in the code face where they name code. */
export function ChipName({
  mono = false,
  children,
}: {
  /** Whether the words name code, a branch, and read in the code face. */
  mono?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-chip-name" data-mono={mono ? "true" : undefined}>
      {children}
    </span>
  );
}
