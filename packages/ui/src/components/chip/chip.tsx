import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDownIcon, RemoveIcon } from "../../face/glyphs.js";
import { useClipped } from "../../use-clipped.js";
import { useRemoval } from "../../use-removal.js";

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
 *   repository a new plan is for), is a capsule on the chip's own opaque
 *   face inside a hairline;
 * - a field, a settings row's value, wears an outlined button's hairline,
 *   its words leading, so a picker and the buttons beside it read as one
 *   column.
 * - a filter, a pill that turns a mode or a kind on (New task's Planning,
 *   a pull request's reactions), is a capsule on the chip's face until it
 *   stands pressed (`aria-pressed`), when it is drawn in the ink, as the
 *   Ink button is; its caller holds which one is pressed.
 *
 * Beside its look a chip may say where a thing stands in the state palette
 * (`tone`), in its leading glyph's colour, or a dot of it before its words
 * where it leads with none, its face staying the chip's own, as a pull
 * request's state is; stand at a width its place shares (`width`); and draw its mark
 * alone where its place has no room for its words (`iconOnly`), its words
 * still read as its name. A removable chip (`onRemove`) is no button of its
 * own: it names what stands, a filter applied, a mention or a label added to
 * a field, and ends in a × named for what lifting it does. It springs in as
 * it arrives and, its × pressed, scales out before its caller is asked to
 * lift it (`useRemoval`), so it is never taken on the frame of the press.
 *
 * A chip comes at the control's size, or compact (`size`), a caption
 * line's pill, where it is one of a row of small counts (a pull request's
 * reactions), a compact filter on the chip's face at rest and in the ink
 * pressed, as any filter;
 * a compact pill, where it says where a thing stands among a header's words
 * (a pull request's state), is drawn in a `Badge`'s box, so it stands at
 * the size of the badges beside it, its chevron saying it opens. A busy chip
 * (`busy`), whose change is out, pulses until it is answered.
 *
 * A chip that opens a menu of values ends in the menu's small, muted
 * chevron where `chevron` asks for one. Its words go in a `ChipName`, which
 * cuts them short rather than letting them push past the row around it,
 * fading out at their end while it does, as a browser's tab does, or, where
 * their end is what tells one from another, in their middle at an ellipsis
 * (`cut`, a branch's last words, as GitHub cuts one), in the code face where
 * they name code (`mono`, a branch). A leading mark, a
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

/** How big a chip is: the control's own, or a caption line's pill, a compact pill a badge's size. */
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

/** Where a chip's words are cut short when they do not fit: at their end, or in their middle, keeping their last few. */
export const CHIP_CUT = {
  END: "end",
  MIDDLE: "middle",
} as const;

export type ChipCut = (typeof CHIP_CUT)[keyof typeof CHIP_CUT];

/** How many of its last characters a name cut in its middle keeps whole, at most. */
const MIDDLE_KEPT = 12;

/** Characters a name is read in parts by, which a name cut in its middle starts its kept end at. */
const NAME_JOINS = /[/\-_.:]/u;

/**
 * The end a name cut in its middle keeps whole: its last few characters,
 * after the first join among them where one stands, so it starts on a word
 * (“and-pill” rather than “u-and-pill”), the ellipsis standing for
 * the join; none for a name too short to cut in two.
 */
function keptEnd(name: string): string {
  if (name.length <= MIDDLE_KEPT + MIDDLE_KEPT / 3) return "";
  const last = name.slice(-MIDDLE_KEPT);
  const join = last.search(NAME_JOINS);
  const word = join === -1 ? "" : last.slice(join + 1);
  return word === "" ? last : word;
}

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
  const removal = useRemoval(onRemove);
  return (
    <span
      ref={removal.ref}
      className="luke-chip"
      data-removable="true"
      data-leaving={removal.leaving ? "true" : undefined}
      inert={removal.leaving}
      {...faceAttributes(face)}
    >
      <span className="luke-chip-face">{children}</span>
      <button
        type="button"
        className="luke-chip-remove"
        aria-label={removeLabel}
        onClick={removal.remove}
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

/** A chip's words: in the code face where they name code, and cut at their end, or, words alone, in their middle. */
type ChipNameProps = {
  /** Whether the words name code, a branch, and read in the code face. */
  mono?: boolean;
} & (
  | { cut?: typeof CHIP_CUT.END | undefined; children: ReactNode }
  | {
      /** Cut in the middle, keeping their end; a name too short to cut in two is cut at its end. */
      cut: typeof CHIP_CUT.MIDDLE;
      children: string;
    }
);

/**
 * A chip's words, cut short rather than pushing past the row it stands in:
 * fading out at their end, or cut in their middle at an ellipsis, which says
 * a cut stands there where a fade with words after it would not; in the code
 * face where they name code.
 */
export function ChipName(props: ChipNameProps): React.JSX.Element {
  const [measured, clipped] = useClipped();
  const kept = props.cut === CHIP_CUT.MIDDLE ? keptEnd(props.children) : "";
  return (
    <span
      ref={measured}
      className="luke-chip-name"
      data-mono={props.mono === true ? "true" : undefined}
      data-cut={kept === "" ? undefined : CHIP_CUT.MIDDLE}
      data-overflow={String(clipped)}
    >
      {props.cut !== CHIP_CUT.MIDDLE || kept === "" ? (
        props.children
      ) : (
        <>
          <span className="luke-chip-name-start">{props.children.slice(0, -kept.length)}</span>
          <span className="luke-chip-name-end">{kept}</span>
        </>
      )}
    </span>
  );
}

/**
 * The quiet count after a chip's words, what a filter would leave out: in the
 * subtle ink at fixed figures, and on a pressed filter stepped back from the
 * ground's colour its words are in, rather than the subtle ink it would
 * vanish into there. A reader hears the count where the chip's name or its
 * description says it, so it is hidden from them here.
 */
export function ChipCount({ children }: { children: string }): React.JSX.Element {
  return (
    <span className="luke-chip-count" aria-hidden="true">
      {children}
    </span>
  );
}
