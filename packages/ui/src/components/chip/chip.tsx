import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import { ChevronDownIcon, RemoveIcon } from "../../face/glyphs.js";
import { PRESS_FACE, PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import type { StatusTone } from "../../status-tone.js";
import { motionKey as motionKeyAttribute } from "../list-motion/list-motion.js";
import { TEXT_ELEMENT, TEXT_FONT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

export const CHIP_LOOK = {
  TOOLBAR: "toolbar",
  PILL: "pill",
  FIELD: "field",
  FILTER: "filter",
} as const;

export type ChipLook = (typeof CHIP_LOOK)[keyof typeof CHIP_LOOK];

export const CHIP_SIZE = {
  CONTROL: "control",
  COMPACT: "compact",
} as const;

export type ChipSize = (typeof CHIP_SIZE)[keyof typeof CHIP_SIZE];

export const CHIP_WIDTH = {
  AUTO: "auto",
  FIELD: "field",
  MIN_FIELD: "min-field",
  FIXED: "fixed",
} as const;

export type ChipWidth = (typeof CHIP_WIDTH)[keyof typeof CHIP_WIDTH];

export const CHIP_CUT = {
  END: "end",
  MIDDLE: "middle",
} as const;

export type ChipCut = (typeof CHIP_CUT)[keyof typeof CHIP_CUT];

const MIDDLE_KEPT = 12;

const NAME_JOINS = /[/\-_.:]/u;

function keptEnd(name: string): string {
  if (name.length <= MIDDLE_KEPT + MIDDLE_KEPT / 3) return "";
  const last = name.slice(-MIDDLE_KEPT);
  const join = last.search(NAME_JOINS);
  const word = join === -1 ? "" : last.slice(join + 1);
  return word === "" ? last : word;
}

interface ChipFace {
  look: ChipLook;
  tone?: StatusTone | undefined;
  width?: ChipWidth | undefined;
  size?: ChipSize | undefined;
  iconOnly?: boolean | undefined;
}

type ButtonChipProps = ChipFace & {
  chevron?: boolean;
  busy?: boolean | undefined;
  onRemove?: never;
  motionKey?: never;
  href?: never;
} & Omit<ComponentPropsWithRef<"button">, "type" | "style" | "className" | "aria-busy">;

type LinkChipProps = ChipFace & {
  href: string;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  chevron?: never;
  busy?: never;
  onRemove?: never;
  motionKey?: never;
} & Omit<ComponentPropsWithRef<"a">, "style" | "className" | "href" | "onClick">;

type RemovableChipProps = ChipFace & {
  onRemove: () => void;
  removeLabel: string;
  onOpen?: (() => void) | undefined;
  motionKey?: string | undefined;
  hint?: string | undefined;
  href?: never;
  children: ReactNode;
};

export type ChipProps = ButtonChipProps | LinkChipProps | RemovableChipProps;

const CHIP_BASE =
  "ui-chip group/chip m-0 inline-flex items-center border font-body no-underline whitespace-nowrap transition-[background-color,color] duration-(--ui-duration-hover) ease-plain";

const LOOK_FACE = {
  [CHIP_LOOK.TOOLBAR]:
    "border-transparent bg-transparent text-body-foreground hover:not-disabled:not-aria-disabled:bg-fill-selected hover:not-disabled:not-aria-disabled:text-foreground aria-expanded:bg-fill-selected aria-expanded:text-foreground active:not-disabled:not-aria-disabled:bg-fill-pressed",
  [CHIP_LOOK.FIELD]:
    "border-border bg-transparent text-foreground hover:not-disabled:not-aria-disabled:bg-fill-selected aria-expanded:bg-fill-selected active:not-disabled:not-aria-disabled:bg-fill-pressed",
  [CHIP_LOOK.PILL]:
    "border-chip-edge bg-chip text-foreground hover:not-disabled:not-aria-disabled:bg-chip-hover aria-expanded:bg-chip-hover",
  [CHIP_LOOK.FILTER]:
    "border-chip-edge bg-chip text-muted-foreground hover:not-disabled:not-aria-disabled:not-aria-pressed:bg-chip-hover hover:not-disabled:not-aria-disabled:not-aria-pressed:text-foreground aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-foreground",
} as const satisfies Record<ChipLook, string>;

const REMOVABLE_FILTER_FACE =
  "border-chip-edge-strong bg-chip-selected text-foreground hover:bg-chip-hover";

const TONED_FACE = "border-chip-edge bg-chip text-foreground";

const TONED_HOVER =
  "hover:not-disabled:not-aria-disabled:bg-chip-hover aria-expanded:bg-chip-hover";

const TONED_OPEN = "aria-expanded:bg-chip-hover";

const TONED_PRESS = "active:not-disabled:not-aria-disabled:bg-fill-pressed";

const LOOK_CORNER = {
  [CHIP_LOOK.TOOLBAR]: "rounded-control",
  [CHIP_LOOK.FIELD]: "rounded-control",
  [CHIP_LOOK.PILL]: "rounded-full",
  [CHIP_LOOK.FILTER]: "rounded-full",
} as const satisfies Record<ChipLook, string>;

const LOOK_INSET = {
  [CHIP_LOOK.TOOLBAR]: "px-chip-inset",
  [CHIP_LOOK.FIELD]: "ps-control-inset pe-chip-inset",
  [CHIP_LOOK.PILL]: "ps-chip-inset pe-chip-inset-wide",
  [CHIP_LOOK.FILTER]: "px-chip-inset-wide",
} as const satisfies Record<ChipLook, string>;

const REMOVABLE_INSET = {
  [CHIP_LOOK.TOOLBAR]: "ps-chip-inset pe-chip-tight",
  [CHIP_LOOK.FIELD]: "ps-chip-inset-wide pe-chip-tight",
  [CHIP_LOOK.PILL]: "ps-chip-inset pe-chip-tight",
  [CHIP_LOOK.FILTER]: "ps-chip-inset-wide pe-chip-tight",
} as const satisfies Record<ChipLook, string>;

const WIDTH_BOX = {
  [CHIP_WIDTH.AUTO]: "",
  [CHIP_WIDTH.FIELD]: "w-chip-field",
  [CHIP_WIDTH.MIN_FIELD]: "min-w-chip-min-field",
  [CHIP_WIDTH.FIXED]: "w-chip-field-half",
} as const satisfies Record<ChipWidth, string>;

const FACE_BASE =
  "ui-chip-face inline-flex min-w-0 items-center gap-[inherit] [&>:is(svg,img)]:flex-none [&>svg.settings-chevron]:size-chip-chevron [&>svg.settings-chevron]:text-muted-foreground";

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
  const inset = compact
    ? look === CHIP_LOOK.PILL
      ? "px-chip-compact-inset"
      : iconOnly
        ? "p-0"
        : "px-chip-inset"
    : iconOnly
      ? "p-0"
      : removable
        ? REMOVABLE_INSET[look]
        : LOOK_INSET[look];
  return [
    CHIP_BASE,
    LOOK_CORNER[look],
    ...face,
    inset,
    look === CHIP_LOOK.FIELD && !iconOnly ? "justify-start" : "justify-center",
    width === CHIP_WIDTH.MIN_FIELD ? "" : "min-w-0",
    WIDTH_BOX[width],
    compact
      ? "h-chip-compact gap-chip-tight text-caption leading-caption"
      : `h-control text-label ${removable ? "gap-chip-tight" : "gap-icon-gap"}`,
    !compact ? "font-label" : look === CHIP_LOOK.PILL ? "font-tag" : "font-caption",
    iconOnly ? `flex-none ${compact ? "w-chip-compact" : "w-control"}` : "flex-initial",
    busy ? "cursor-progress" : removable ? "cursor-default" : "cursor-press",
    "max-w-full",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

function faceClasses(
  { look, size = CHIP_SIZE.CONTROL, iconOnly = false }: ChipFace,
  busy: boolean,
): string {
  const smallGlyphs = look === CHIP_LOOK.PILL && size === CHIP_SIZE.COMPACT;
  return [
    FACE_BASE,
    smallGlyphs ? "[&>:is(svg,img)]:size-chip-chevron" : "[&>:is(svg,img)]:size-control-icon",
    look === CHIP_LOOK.FIELD && !iconOnly ? "flex-1 [&>.settings-chevron]:ml-auto" : "flex-initial",
    iconOnly ? "[&>.settings-chevron]:hidden" : "",
    busy ? "" : "group-disabled/chip:opacity-disabled group-aria-disabled/chip:opacity-disabled",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

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

const REMOVE =
  "ui-chip-remove m-0 grid size-chip-remove flex-none place-items-center rounded-full border-0 bg-transparent p-0 text-muted-foreground cursor-[inherit] transition-[background-color,color] duration-(--ui-duration-hover) ease-plain hover:bg-secondary hover:text-foreground [&>svg]:size-chip-remove-glyph";

const OPEN_FACE = "m-0 border-0 bg-transparent p-0 text-inherit font-[inherit] cursor-press";

function RemovableChip({
  onRemove,
  removeLabel,
  onOpen,
  motionKey,
  hint,
  children,
  ...face
}: RemovableChipProps): React.JSX.Element {
  const words =
    onOpen === undefined ? (
      <span className={faceClasses(face, false)}>{children}</span>
    ) : (
      <button
        type="button"
        className={`${faceClasses(face, false)} ${OPEN_FACE}`}
        onClick={pulseOnPress(onOpen, PRESS_PULSE.FACE)}
        {...PRESS_FACE}
      >
        {children}
      </button>
    );
  return (
    <span
      className={chipClasses(face, true, false)}
      data-removable="true"
      {...faceAttributes(face)}
      {...(motionKey === undefined ? {} : motionKeyAttribute(motionKey))}
    >
      {hint === undefined ? words : <Tooltip label={hint}>{words}</Tooltip>}
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

function LinkChip({
  look,
  tone,
  width,
  size,
  iconOnly,
  href,
  onClick,
  children,
  ...anchor
}: LinkChipProps): React.JSX.Element {
  return (
    <a
      {...anchor}
      className={chipClasses({ look, tone, width, size, iconOnly }, false, false)}
      {...faceAttributes({ look, tone, width, size, iconOnly })}
      href={href}
      onClick={pulseOnPress(onClick, PRESS_PULSE.FACE)}
    >
      <span className={faceClasses({ look, size, iconOnly }, false)} {...PRESS_FACE}>
        {children}
      </span>
    </a>
  );
}

export function Chip(props: ChipProps): React.JSX.Element {
  if (props.onRemove !== undefined) return <RemovableChip {...props} />;
  if (props.href !== undefined) return <LinkChip {...props} />;
  const { look, tone, width, size, iconOnly, chevron = false, busy, children, ...button } = props;
  return (
    <button
      type="button"
      {...button}
      className={chipClasses({ look, tone, width, size, iconOnly }, false, busy === true)}
      aria-busy={busy === true ? true : undefined}
      {...faceAttributes({ look, tone, width, size, iconOnly })}
      onClick={busy === true ? button.onClick : pulseOnPress(button.onClick, PRESS_PULSE.FACE)}
    >
      <span className={faceClasses({ look, size, iconOnly }, busy === true)} {...PRESS_FACE}>
        {children}
        {chevron ? <ChevronDownIcon /> : null}
      </span>
    </button>
  );
}

type StaticChipLook = typeof CHIP_LOOK.TOOLBAR | typeof CHIP_LOOK.PILL;

type StaticChipProps = Pick<ChipFace, "tone" | "iconOnly" | "size"> & {
  look?: StaticChipLook | undefined;
  children: ReactNode;
} & Omit<ComponentPropsWithRef<"span">, "style" | "className" | "children">;

const STATIC_BOX =
  "ui-chip group/chip m-0 inline-flex min-w-0 max-w-full items-center justify-center border font-body whitespace-nowrap cursor-default";

const STATIC_FACE = {
  [CHIP_LOOK.TOOLBAR]: "rounded-control border-transparent bg-transparent text-body-foreground",
  [CHIP_LOOK.PILL]: "rounded-full border-chip-edge bg-chip text-foreground",
} as const satisfies Record<StaticChipLook, string>;

export function StaticChip({
  look = CHIP_LOOK.TOOLBAR,
  tone,
  size = CHIP_SIZE.CONTROL,
  iconOnly = false,
  children,
  ...span
}: StaticChipProps): React.JSX.Element {
  const compact = size === CHIP_SIZE.COMPACT;
  const room = iconOnly
    ? "flex-none w-control p-0"
    : compact
      ? "flex-initial px-chip-compact-inset"
      : look === CHIP_LOOK.PILL
        ? `flex-initial ${LOOK_INSET[CHIP_LOOK.PILL]}`
        : "flex-initial px-chip-inset";
  const box = compact
    ? "h-chip-compact gap-chip-tight text-caption leading-caption font-tag"
    : "h-control text-label gap-icon-gap font-label";
  return (
    <span
      {...span}
      className={`${STATIC_BOX} ${STATIC_FACE[look]} ${box} ${room}`}
      {...faceAttributes({ look, tone, size, iconOnly })}
    >
      <span className={faceClasses({ look, size, iconOnly }, false)}>{children}</span>
    </span>
  );
}

type ChipNameProps = {
  mono?: boolean;
} & (
  | { cut?: typeof CHIP_CUT.END | undefined; children: ReactNode }
  | {
      cut: typeof CHIP_CUT.MIDDLE;
      children: string;
    }
);

const NAME =
  "ui-chip-name group-data-[look=field]/chip:flex-1 group-data-[look=field]/chip:text-left group-data-[icon-only=true]/chip:absolute group-data-[icon-only=true]/chip:-m-px group-data-[icon-only=true]/chip:size-px group-data-[icon-only=true]/chip:[clip-path:inset(50%)]";

function ChipNameStart({ children }: { children: string }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="ui-chip-name-start whitespace-pre"
    >
      {children}
    </Text>
  );
}

export function ChipName(props: ChipNameProps): React.JSX.Element {
  const kept = props.cut === CHIP_CUT.MIDDLE ? keptEnd(props.children) : "";
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      font={props.mono === true ? TEXT_FONT.MONO : TEXT_FONT.SANS}
      truncate={kept === ""}
      className={[
        NAME,
        props.mono === true ? "text-caption leading-[inherit]" : "",
        kept === "" ? "" : "inline-flex min-w-0 overflow-hidden whitespace-nowrap",
      ]
        .filter((part) => part !== "")
        .join(" ")}
      data-cut={kept === "" ? undefined : CHIP_CUT.MIDDLE}
    >
      {props.cut !== CHIP_CUT.MIDDLE || kept === "" ? (
        props.children
      ) : (
        <>
          <ChipNameStart>{props.children.slice(0, -kept.length)}</ChipNameStart>
          <span className="ui-chip-name-end">{kept}</span>
        </>
      )}
    </Text>
  );
}

export function ChipCount({ children }: { children: string }): React.JSX.Element {
  return (
    <span
      className="ui-chip-count text-muted-foreground tabular-nums group-aria-pressed/chip:text-chip-count-pressed"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
