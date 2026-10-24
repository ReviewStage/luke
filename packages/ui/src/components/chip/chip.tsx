import type { ComponentPropsWithRef, ReactNode } from "react";
import { ChevronDownIcon, RemoveIcon } from "../../face/glyphs.js";
import { PRESS_FACE, PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import type { StatusTone } from "../../status-tone.js";
import { useClipped } from "../../use-clipped.js";
import { motionKey as motionKeyAttribute } from "../list-motion/list-motion.js";

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
 * a field, and ends in a × named for what lifting it does, which its caller
 * answers at once, so what it named is gone on the press. It springs in as
 * it arrives; its exit is the list's that draws it, a `ListMotion`
 * following it by its `motionKey`, which plays its arrival in its place,
 * since its caller has already let it go.
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
 *
 * It is drawn in Tailwind utilities over the shared theme, worked out here
 * from its options, so each look's rest, hover, open, and pressed faces are
 * the only ones it wears. Note that it stands on no shadcn/ui base: the
 * vendored badge (`../../shadcn/badge.tsx`) is a caption's capsule that
 * takes no press, whose every class a chip's control box would override,
 * and a chip's press must stay its own button's. `chip.css` keeps what
 * utilities cannot say: a tone's dot, which turns on what the chip holds
 * (`:has()`), the motions, and the fades.
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
  tone?: StatusTone | undefined;
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
  motionKey?: never;
} & Omit<ComponentPropsWithRef<"button">, "type" | "style" | "className" | "aria-busy">;

/** A chip naming what stands, ended by the × that lifts it. */
type RemovableChipProps = ChipFace & {
  /** Lifts what the chip names. */
  onRemove: () => void;
  /** What the × does, its name for a reader ("Show everyone's tasks"). */
  removeLabel: string;
  /** The key a `ListMotion` around its row follows it by, which plays its arrival and its exit. */
  motionKey?: string | undefined;
  children: ReactNode;
};

export type ChipProps = ButtonChipProps | RemovableChipProps;

/** What every chip draws: a control's box, its words at the label's type, and the group its parts answer. */
const CHIP_BASE =
  "luke-chip group/chip m-0 inline-flex max-w-full items-center border font-body whitespace-nowrap transition-[background-color,color] duration-(--luke-duration-hover) ease-plain";

/**
 * Each look's face at rest and under the pointer, while its menu is open,
 * and pressed. Note that hover is a plain `:hover`, as it always was, rather
 * than Tailwind's hover-capable one, and that a press outranks the hover it
 * lands on by its longer selector.
 */
const LOOK_FACE = {
  [CHIP_LOOK.TOOLBAR]:
    "border-transparent bg-transparent text-body-foreground [&:hover:not(:disabled,[aria-disabled=true])]:bg-fill-selected [&:hover:not(:disabled,[aria-disabled=true])]:text-foreground aria-expanded:bg-fill-selected aria-expanded:text-foreground active:not-disabled:not-aria-disabled:bg-fill-pressed",
  [CHIP_LOOK.FIELD]:
    "border-border bg-transparent text-foreground [&:hover:not(:disabled,[aria-disabled=true])]:bg-fill-selected aria-expanded:bg-fill-selected active:not-disabled:not-aria-disabled:bg-fill-pressed",
  [CHIP_LOOK.PILL]:
    "border-chip-edge bg-chip text-muted-foreground in-data-[luke-profile=web]:text-foreground [&:hover:not(:disabled,[aria-disabled=true])]:bg-chip-hover [&:hover:not(:disabled,[aria-disabled=true])]:text-foreground aria-expanded:bg-chip-hover aria-expanded:text-foreground",
  [CHIP_LOOK.FILTER]:
    "border-chip-edge bg-chip text-muted-foreground [&:hover:not(:disabled,[aria-disabled=true],[aria-pressed=true])]:bg-chip-hover [&:hover:not(:disabled,[aria-disabled=true],[aria-pressed=true])]:text-foreground aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-foreground",
} as const satisfies Record<ChipLook, string>;

/** A removable filter's face: chosen, inside the strong hairline, lighting under the pointer as any filter does. */
const REMOVABLE_FILTER_FACE =
  "border-chip-edge-strong bg-chip-selected text-foreground [&:hover]:bg-chip-hover";

/** A toned chip's face, whatever its look: the chip's own inside its hairline, its words in the text's ink, lighting as a pill does. */
const TONED_FACE = "border-chip-edge bg-chip text-foreground";

/** A toned chip lighting under the pointer, and while its menu is open. */
const TONED_HOVER =
  "[&:hover:not(:disabled,[aria-disabled=true])]:bg-chip-hover aria-expanded:bg-chip-hover";

/** A toned chip lighting while its menu is open alone, a removable one but a filter taking no hover. */
const TONED_OPEN = "aria-expanded:bg-chip-hover";

/** A toned toolbar chip or field still darkening under a press, as its look does. */
const TONED_PRESS = "active:not-disabled:not-aria-disabled:bg-fill-pressed";

/** A look's corner where no tone or removal redraws it. */
const LOOK_CORNER = {
  [CHIP_LOOK.TOOLBAR]: "rounded-control",
  [CHIP_LOOK.FIELD]: "rounded-control",
  [CHIP_LOOK.PILL]: "rounded-full",
  [CHIP_LOOK.FILTER]: "rounded-full",
} as const satisfies Record<ChipLook, string>;

/** A look's side room inside its box. */
const LOOK_INSET = {
  [CHIP_LOOK.TOOLBAR]: "px-chip-inset",
  [CHIP_LOOK.FIELD]: "ps-chip-inset-wide pe-chip-inset",
  [CHIP_LOOK.PILL]: "ps-chip-inset pe-chip-inset-wide",
  [CHIP_LOOK.FILTER]: "px-chip-inset-wide",
} as const satisfies Record<ChipLook, string>;

/** A removable chip's side room: its look's start, and its × near the end. */
const REMOVABLE_INSET = {
  [CHIP_LOOK.TOOLBAR]: "ps-chip-inset pe-chip-tight",
  [CHIP_LOOK.FIELD]: "ps-chip-inset-wide pe-chip-tight",
  [CHIP_LOOK.PILL]: "ps-chip-inset pe-chip-tight",
  [CHIP_LOOK.FILTER]: "ps-chip-inset-wide pe-chip-tight",
} as const satisfies Record<ChipLook, string>;

/** Each width a place shares; a chip at its words' own may still shrink to nothing. */
const WIDTH_BOX = {
  [CHIP_WIDTH.AUTO]: "",
  [CHIP_WIDTH.FIELD]: "w-chip-field",
  [CHIP_WIDTH.MIN_FIELD]: "min-w-chip-min-field",
  [CHIP_WIDTH.FIXED]: "w-chip-field-half",
} as const satisfies Record<ChipWidth, string>;

/** The face inside a chip, holding all it draws, so an unavailable chip fades it once. */
const FACE_BASE =
  "luke-chip-face inline-flex min-w-0 items-center gap-[inherit] [&>:is(svg,img)]:flex-none [&>svg.settings-chevron]:size-chip-chevron [&>svg.settings-chevron]:text-muted-foreground";

/** What every chip draws, as one class list, worked out from its options. */
function chipClasses(
  { look, tone, width = CHIP_WIDTH.AUTO, size = CHIP_SIZE.CONTROL, iconOnly = false }: ChipFace,
  removable: boolean,
  busy: boolean,
): string {
  const compact = size === CHIP_SIZE.COMPACT;
  const toned = tone !== undefined;
  const filterish = look === CHIP_LOOK.FILTER;
  const face = toned
    ? [
        TONED_FACE,
        removable && !filterish ? TONED_OPEN : TONED_HOVER,
        look === CHIP_LOOK.TOOLBAR || look === CHIP_LOOK.FIELD ? TONED_PRESS : "",
      ]
    : [removable && filterish ? REMOVABLE_FILTER_FACE : LOOK_FACE[look]];
  // Note that the side room is the last of look, removal, mark alone, and compact to name it, as each narrows the one before.
  const inset = compact
    ? look === CHIP_LOOK.PILL
      ? "px-chip-compact-inset"
      : iconOnly
        ? "p-0"
        : "px-chip-inset"
    : iconOnly
      ? "px-chip-inset"
      : removable
        ? REMOVABLE_INSET[look]
        : LOOK_INSET[look];
  return [
    CHIP_BASE,
    LOOK_CORNER[look],
    ...face,
    inset,
    look === CHIP_LOOK.FIELD ? "justify-start" : "justify-center",
    width === CHIP_WIDTH.MIN_FIELD ? "" : "min-w-0",
    WIDTH_BOX[width],
    compact
      ? "h-chip-compact gap-chip-tight text-caption leading-caption"
      : `h-control text-label ${removable ? "gap-chip-tight" : "gap-icon-gap"}`,
    !compact ? "font-label" : look === CHIP_LOOK.PILL ? "font-tag" : "font-caption",
    compact && iconOnly ? "flex-none aspect-square" : "flex-initial",
    busy
      ? "cursor-progress"
      : removable
        ? "cursor-default"
        : "cursor-pointer in-data-[luke-profile=desktop]:cursor-default",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** The face's own classes: its glyphs at the chip's size, its field's chevron at the far end, faded while the chip is unavailable. */
function faceClasses(
  { look, size = CHIP_SIZE.CONTROL, iconOnly = false }: ChipFace,
  busy: boolean,
): string {
  const smallGlyphs = look === CHIP_LOOK.PILL && size === CHIP_SIZE.COMPACT;
  return [
    FACE_BASE,
    smallGlyphs ? "[&>:is(svg,img)]:size-chip-chevron" : "[&>:is(svg,img)]:size-control-icon",
    look === CHIP_LOOK.FIELD ? "flex-1 [&>.settings-chevron]:ml-auto" : "flex-initial",
    iconOnly ? "[&>.settings-chevron]:hidden" : "",
    // Note that a busy chip's face pulses whole rather than standing faded, so only an idle one fades.
    busy ? "" : "group-disabled/chip:opacity-disabled group-aria-disabled/chip:opacity-disabled",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

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

/** The × ending a removable chip: a round press inside its capsule, lighting under the pointer. */
const REMOVE =
  "luke-chip-remove m-0 grid size-chip-remove flex-none place-items-center rounded-full border-0 bg-transparent p-0 text-muted-foreground cursor-[inherit] [&:hover]:bg-secondary [&:hover]:text-foreground [&>svg]:size-chip-remove-glyph";

/** A removable chip: its face, then a × named for what it lifts. */
function RemovableChip({
  onRemove,
  removeLabel,
  motionKey,
  children,
  ...face
}: RemovableChipProps): React.JSX.Element {
  return (
    <span
      className={chipClasses(face, true, false)}
      data-removable="true"
      {...faceAttributes(face)}
      {...(motionKey === undefined ? {} : motionKeyAttribute(motionKey))}
    >
      <span className={faceClasses(face, false)}>{children}</span>
      <button
        type="button"
        className={REMOVE}
        aria-label={removeLabel}
        onClick={pulseOnPress(onRemove)}
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
      className={chipClasses({ look, tone, width, size, iconOnly }, false, busy === true)}
      aria-busy={busy === true ? true : undefined}
      {...faceAttributes({ look, tone, width, size, iconOnly })}
      // Note that a busy chip's face is already moving, as its wait, so a press plays nothing over it.
      onClick={busy === true ? button.onClick : pulseOnPress(button.onClick, PRESS_PULSE.FACE)}
    >
      <span className={faceClasses({ look, size, iconOnly }, busy === true)} {...PRESS_FACE}>
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

/** A chip's words on one line, and, drawn as its mark alone, read and drawn nowhere; a field's lead and fill it. */
const NAME =
  "luke-chip-name overflow-hidden whitespace-nowrap group-data-[look=field]/chip:flex-1 group-data-[look=field]/chip:text-left group-data-[icon-only=true]/chip:absolute group-data-[icon-only=true]/chip:-m-px group-data-[icon-only=true]/chip:size-px group-data-[icon-only=true]/chip:[clip-path:inset(50%)]";

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
      className={[
        NAME,
        props.mono === true ? "font-mono text-caption leading-[inherit]" : "",
        kept === "" ? "" : "inline-flex min-w-0",
      ]
        .filter((part) => part !== "")
        .join(" ")}
      data-mono={props.mono === true ? "true" : undefined}
      data-cut={kept === "" ? undefined : CHIP_CUT.MIDDLE}
      data-overflow={String(clipped)}
    >
      {props.cut !== CHIP_CUT.MIDDLE || kept === "" ? (
        props.children
      ) : (
        <>
          <span className="luke-chip-name-start min-w-0 overflow-hidden whitespace-pre">
            {props.children.slice(0, -kept.length)}
          </span>
          <span className="luke-chip-name-end">{kept}</span>
        </>
      )}
    </span>
  );
}

/**
 * The quiet count after a chip's words, what a filter would leave out: in the
 * muted ink at fixed figures, and on a pressed filter stepped back from the
 * ground's colour its words are in, rather than the muted ink it would
 * vanish into there. A reader hears the count where the chip's name or its
 * description says it, so it is hidden from them here.
 */
export function ChipCount({ children }: { children: string }): React.JSX.Element {
  return (
    <span
      className="luke-chip-count text-muted-foreground tabular-nums group-aria-pressed/chip:text-chip-count-pressed"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
